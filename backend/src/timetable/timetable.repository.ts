import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import type { TrainRun, TrainSegment } from '../planning/planning.types';
import type {
  TimetableRevisionRecord,
  TimetableSnapshot,
  TimetableStageId,
  TrainServicePartLinkRecord,
  TrainServicePartRecord,
} from './timetable.types';

interface RevisionRow {
  id: string;
  variant_id: string;
  stage_id: string;
  created_at: string;
  created_by: string | null;
  message: string | null;
  data: any;
}

interface TrainRunRow {
  id: string;
  train_number: string;
  timetable_id: string | null;
  attributes: Record<string, unknown> | null;
}

interface TrainSegmentRow {
  id: string;
  train_run_id: string;
  section_index: number;
  start_time: string | Date;
  end_time: string | Date;
  from_location_id: string;
  to_location_id: string;
  path_id: string | null;
  distance_km: number | null;
  attributes: Record<string, unknown> | null;
}

interface TrainServicePartRow {
  id: string;
  variant_id: string;
  stage_id: string;
  timetable_year_label: string | null;
  train_run_id: string;
  attributes: Record<string, unknown> | null;
}

interface TrainServicePartSegmentDetailRow {
  id: string;
  train_run_id: string;
  start_time: string;
  end_time: string;
  from_location_id: string;
  to_location_id: string;
}

@Injectable()
export class TimetableRepository {
  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async loadSnapshot(
    variantId: string,
    stageId: TimetableStageId,
  ): Promise<TimetableSnapshot> {
    if (!this.isEnabled) {
      return { variantId, stageId, trainRuns: [], trainSegments: [] };
    }
    const normalizedVariantId = variantId.trim() || 'default';
    const normalizedStageId = (stageId?.trim() as TimetableStageId) || 'base';

    const runs = await this.database.query<TrainRunRow>(
      `
        SELECT id, train_number, timetable_id, attributes
        FROM train_run
        WHERE variant_id = $1
        ORDER BY train_number, id
      `,
      [normalizedVariantId],
    );

    const segments = await this.database.query<TrainSegmentRow>(
      `
        SELECT
          id,
          train_run_id,
          section_index,
          start_time,
          end_time,
          from_location_id,
          to_location_id,
          path_id,
          distance_km,
          attributes
        FROM train_segment
        WHERE variant_id = $1
        ORDER BY train_run_id, section_index, id
      `,
      [normalizedVariantId],
    );

    return {
      variantId: normalizedVariantId,
      stageId: normalizedStageId,
      trainRuns: runs.rows.map((row) => ({
        id: row.id,
        trainNumber: row.train_number,
        timetableId: row.timetable_id,
        attributes: row.attributes ?? undefined,
      })),
      trainSegments: segments.rows.map((row) => ({
        id: row.id,
        trainRunId: row.train_run_id,
        sectionIndex: row.section_index,
        startTime: this.toIso(row.start_time),
        endTime: this.toIso(row.end_time),
        fromLocationId: row.from_location_id,
        toLocationId: row.to_location_id,
        pathId: row.path_id,
        distanceKm: row.distance_km,
        attributes: row.attributes ?? undefined,
      })),
    };
  }

  async replaceSnapshot(options: {
    variantId: string;
    stageId: TimetableStageId;
    trainRuns: TrainRun[];
    trainSegments: TrainSegment[];
  }): Promise<{ trainRuns: number; trainSegments: number }> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }

    const variantId = options.variantId.trim() || 'default';
    const stageId = (options.stageId?.trim() as TimetableStageId) || 'base';

    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        // Ensure the referenced planning stage exists (FK for train_run/train_segment).
        const now = Date.now();
        const defaultStart = new Date(now).toISOString();
        const defaultEnd = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
        const segStarts = options.trainSegments
          .map((s) => Date.parse(s.startTime))
          .filter((v) => Number.isFinite(v));
        const segEnds = options.trainSegments
          .map((s) => Date.parse(s.endTime))
          .filter((v) => Number.isFinite(v));
        const timelineStart =
          segStarts.length > 0
            ? new Date(Math.min(...segStarts)).toISOString()
            : defaultStart;
        const timelineEnd =
          segEnds.length > 0
            ? new Date(Math.max(...segEnds)).toISOString()
            : defaultEnd;
        await client.query(
          `
            INSERT INTO planning_stage (stage_id, variant_id, timeline_start, timeline_end)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (stage_id, variant_id) DO NOTHING
          `,
          [stageId, variantId, timelineStart, timelineEnd],
        );

        // Replace segments first (FK to train_run).
        await client.query(`DELETE FROM train_segment WHERE variant_id = $1`, [
          variantId,
        ]);
        await client.query(`DELETE FROM train_run WHERE variant_id = $1`, [
          variantId,
        ]);

        if (options.trainRuns.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb)
                     AS r(
                       id TEXT,
                       "trainNumber" TEXT,
                       "timetableId" TEXT,
                       attributes JSONB
                     )
              )
              INSERT INTO train_run (id, stage_id, variant_id, train_number, timetable_id, attributes)
              SELECT
                id,
                $2,
                $3,
                "trainNumber",
                "timetableId",
                attributes
              FROM payload
              ON CONFLICT (id, variant_id) DO UPDATE
              SET stage_id = EXCLUDED.stage_id,
                  train_number = EXCLUDED.train_number,
                  timetable_id = EXCLUDED.timetable_id,
                  attributes = EXCLUDED.attributes,
                  updated_at = now()
            `,
            [JSON.stringify(options.trainRuns), stageId, variantId],
          );
        }

        if (options.trainSegments.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb)
                     AS s(
                       id TEXT,
                       "trainRunId" TEXT,
                       "sectionIndex" INTEGER,
                       "startTime" TIMESTAMPTZ,
                       "endTime" TIMESTAMPTZ,
                       "fromLocationId" TEXT,
                       "toLocationId" TEXT,
                       "pathId" TEXT,
                       "distanceKm" NUMERIC,
                       attributes JSONB
                     )
              )
              INSERT INTO train_segment (
                id,
                stage_id,
                variant_id,
                train_run_id,
                section_index,
                start_time,
                end_time,
                from_location_id,
                to_location_id,
                path_id,
                distance_km,
                attributes
              )
              SELECT
                id,
                $2,
                $3,
                "trainRunId",
                "sectionIndex",
                "startTime",
                "endTime",
                "fromLocationId",
                "toLocationId",
                "pathId",
                "distanceKm",
                attributes
              FROM payload
              ON CONFLICT (id, variant_id) DO UPDATE
              SET stage_id = EXCLUDED.stage_id,
                  train_run_id = EXCLUDED.train_run_id,
                  section_index = EXCLUDED.section_index,
                  start_time = EXCLUDED.start_time,
                  end_time = EXCLUDED.end_time,
                  from_location_id = EXCLUDED.from_location_id,
                  to_location_id = EXCLUDED.to_location_id,
                  path_id = EXCLUDED.path_id,
                  distance_km = EXCLUDED.distance_km,
                  attributes = EXCLUDED.attributes,
                  updated_at = now()
            `,
            [JSON.stringify(options.trainSegments), stageId, variantId],
          );
        }

        await client.query('COMMIT');
        return {
          trainRuns: options.trainRuns.length,
          trainSegments: options.trainSegments.length,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async createRevision(options: {
    variantId: string;
    stageId: TimetableStageId;
    createdBy?: string | null;
    message?: string | null;
  }): Promise<TimetableRevisionRecord> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const variantId = options.variantId.trim() || 'default';
    const stageId = (options.stageId?.trim() as TimetableStageId) || 'base';
    const snapshot = await this.loadSnapshot(variantId, stageId);

    const revisionId = randomUUID();
    const payload = {
      trainRuns: snapshot.trainRuns,
      trainSegments: snapshot.trainSegments,
    };
    const result = await this.database.query<RevisionRow>(
      `
        INSERT INTO timetable_revision (id, variant_id, stage_id, created_by, message, data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING id, variant_id, stage_id, created_at, created_by, message, data
      `,
      [
        revisionId,
        variantId,
        stageId,
        options.createdBy ?? null,
        options.message ?? null,
        JSON.stringify(payload),
      ],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      variantId: row.variant_id,
      stageId: row.stage_id as TimetableStageId,
      createdAt: row.created_at,
      createdBy: row.created_by,
      message: row.message,
      trainRunCount: Array.isArray(row.data?.trainRuns)
        ? row.data.trainRuns.length
        : snapshot.trainRuns.length,
      trainSegmentCount: Array.isArray(row.data?.trainSegments)
        ? row.data.trainSegments.length
        : snapshot.trainSegments.length,
    };
  }

  async listRevisions(
    variantId: string,
    stageId: TimetableStageId,
  ): Promise<TimetableRevisionRecord[]> {
    if (!this.isEnabled) {
      return [];
    }
    const normalizedVariantId = variantId.trim() || 'default';
    const normalizedStageId = (stageId?.trim() as TimetableStageId) || 'base';
    const result = await this.database.query<RevisionRow>(
      `
        SELECT id, variant_id, stage_id, created_at, created_by, message, data
        FROM timetable_revision
        WHERE variant_id = $1
          AND stage_id = $2
        ORDER BY created_at DESC, id DESC
      `,
      [normalizedVariantId, normalizedStageId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      stageId: row.stage_id as TimetableStageId,
      createdAt: row.created_at,
      createdBy: row.created_by,
      message: row.message,
      trainRunCount: Array.isArray(row.data?.trainRuns)
        ? row.data.trainRuns.length
        : 0,
      trainSegmentCount: Array.isArray(row.data?.trainSegments)
        ? row.data.trainSegments.length
        : 0,
    }));
  }

  async loadRevisionSnapshot(revisionId: string): Promise<{
    variantId: string;
    stageId: TimetableStageId;
    trainRuns: TrainRun[];
    trainSegments: TrainSegment[];
  } | null> {
    if (!this.isEnabled) {
      return null;
    }
    const result = await this.database.query<RevisionRow>(
      `
        SELECT id, variant_id, stage_id, created_at, created_by, message, data
        FROM timetable_revision
        WHERE id = $1
      `,
      [revisionId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const data = row.data ?? {};
    return {
      variantId: row.variant_id,
      stageId: row.stage_id as TimetableStageId,
      trainRuns: Array.isArray((data as any).trainRuns)
        ? (data as any).trainRuns
        : [],
      trainSegments: Array.isArray((data as any).trainSegments)
        ? (data as any).trainSegments
        : [],
    };
  }

  async listTrainServiceParts(
    variantId: string,
    stageId: TimetableStageId,
  ): Promise<TrainServicePartRecord[]> {
    if (!this.isEnabled) {
      return [];
    }
    const normalizedVariantId = variantId.trim() || 'default';
    const normalizedStageId = (stageId?.trim() as TimetableStageId) || 'base';
    const result = await this.database.query<{
      id: string;
      variant_id: string;
      stage_id: string;
      timetable_year_label: string | null;
      train_run_id: string;
      train_number: string | null;
      from_location_id: string;
      to_location_id: string;
      start_time: string;
      end_time: string;
      attributes: Record<string, unknown> | null;
      segment_ids: string[] | null;
    }>(
      `
        SELECT
          p.id,
          p.variant_id,
          p.stage_id,
          p.timetable_year_label,
          p.train_run_id,
          r.train_number,
          p.from_location_id,
          p.to_location_id,
          p.start_time,
          p.end_time,
          p.attributes,
          COALESCE(
            ARRAY_AGG(s.segment_id ORDER BY s.order_index)
              FILTER (WHERE s.segment_id IS NOT NULL),
            '{}'::text[]
          ) AS segment_ids
        FROM train_service_part p
        LEFT JOIN train_run r
          ON r.id = p.train_run_id
         AND r.variant_id = p.variant_id
        LEFT JOIN train_service_part_segment s
          ON s.part_id = p.id
         AND s.variant_id = p.variant_id
        WHERE p.variant_id = $1
          AND p.stage_id = $2
        GROUP BY
          p.id,
          p.variant_id,
          p.stage_id,
          p.timetable_year_label,
          p.train_run_id,
          r.train_number,
          p.from_location_id,
          p.to_location_id,
          p.start_time,
          p.end_time,
          p.attributes
        ORDER BY p.start_time, p.id
      `,
      [normalizedVariantId, normalizedStageId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      stageId: row.stage_id as TimetableStageId,
      timetableYearLabel: row.timetable_year_label,
      trainRunId: row.train_run_id,
      trainNumber: row.train_number,
      fromLocationId: row.from_location_id,
      toLocationId: row.to_location_id,
      startTime: row.start_time,
      endTime: row.end_time,
      segmentIds: row.segment_ids ?? [],
      attributes: row.attributes ?? null,
    }));
  }

  async rebuildTrainServiceParts(options: {
    variantId: string;
    stageId: TimetableStageId;
    timetableYearLabel?: string | null;
  }): Promise<{ parts: number }> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const variantId = options.variantId.trim() || 'default';
    const stageId = (options.stageId?.trim() as TimetableStageId) || 'base';
    const yearLabel = options.timetableYearLabel?.trim().length
      ? options.timetableYearLabel?.trim()
      : null;

    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `DELETE FROM train_service_part WHERE variant_id = $1 AND stage_id = $2`,
          [variantId, stageId],
        );

        const runs = await client.query<{ id: string }>(
          `SELECT id FROM train_run WHERE variant_id = $1 ORDER BY id`,
          [variantId],
        );
        if (!runs.rows.length) {
          await client.query('COMMIT');
          return { parts: 0 };
        }

        const segments = await client.query<{
          id: string;
          train_run_id: string;
          section_index: number;
          start_time: string;
          end_time: string;
          from_location_id: string;
          to_location_id: string;
        }>(
          `
            SELECT
              id,
              train_run_id,
              section_index,
              start_time,
              end_time,
              from_location_id,
              to_location_id
            FROM train_segment
            WHERE variant_id = $1
            ORDER BY train_run_id, section_index, id
          `,
          [variantId],
        );

        const segmentsByRun = new Map<string, typeof segments.rows>();
        segments.rows.forEach((seg) => {
          const list = segmentsByRun.get(seg.train_run_id);
          if (list) {
            list.push(seg);
          } else {
            segmentsByRun.set(seg.train_run_id, [seg]);
          }
        });

        const partPayload: Array<{
          id: string;
          trainRunId: string;
          fromLocationId: string;
          toLocationId: string;
          startTime: string;
          endTime: string;
        }> = [];
        const segmentPayload: Array<{
          partId: string;
          segmentId: string;
          orderIndex: number;
        }> = [];

        for (const run of runs.rows) {
          const segs = segmentsByRun.get(run.id) ?? [];
          if (!segs.length) {
            continue;
          }
          const first = segs[0];
          const last = segs[segs.length - 1];
          const minIdx = Math.min(...segs.map((s) => s.section_index));
          const maxIdx = Math.max(...segs.map((s) => s.section_index));
          const partId = `tsp:${run.id}:${minIdx}-${maxIdx}`;
          partPayload.push({
            id: partId,
            trainRunId: run.id,
            fromLocationId: first.from_location_id,
            toLocationId: last.to_location_id,
            startTime: first.start_time,
            endTime: last.end_time,
          });
          segs.forEach((seg) => {
            segmentPayload.push({
              partId,
              segmentId: seg.id,
              orderIndex: seg.section_index,
            });
          });
        }

        if (partPayload.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb)
                     AS p(
                       id TEXT,
                       "trainRunId" TEXT,
                       "fromLocationId" TEXT,
                       "toLocationId" TEXT,
                       "startTime" TIMESTAMPTZ,
                       "endTime" TIMESTAMPTZ
                     )
              )
              INSERT INTO train_service_part (
                id,
                variant_id,
                stage_id,
                timetable_year_label,
                train_run_id,
                from_location_id,
                to_location_id,
                start_time,
                end_time,
                attributes
              )
              SELECT
                id,
                $2,
                $3,
                $4,
                "trainRunId",
                "fromLocationId",
                "toLocationId",
                "startTime",
                "endTime",
                NULL
              FROM payload
              ON CONFLICT (id, variant_id) DO UPDATE
              SET stage_id = EXCLUDED.stage_id,
                  timetable_year_label = EXCLUDED.timetable_year_label,
                  train_run_id = EXCLUDED.train_run_id,
                  from_location_id = EXCLUDED.from_location_id,
                  to_location_id = EXCLUDED.to_location_id,
                  start_time = EXCLUDED.start_time,
                  end_time = EXCLUDED.end_time,
                  updated_at = now()
            `,
            [JSON.stringify(partPayload), variantId, stageId, yearLabel],
          );
        }

        if (segmentPayload.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb)
                     AS s(
                       "partId" TEXT,
                       "segmentId" TEXT,
                       "orderIndex" INTEGER
                     )
              )
              INSERT INTO train_service_part_segment (part_id, variant_id, segment_id, order_index)
              SELECT
                "partId",
                $2,
                "segmentId",
                "orderIndex"
              FROM payload
              ON CONFLICT (part_id, variant_id, segment_id) DO UPDATE
              SET order_index = EXCLUDED.order_index
            `,
            [JSON.stringify(segmentPayload), variantId],
          );
        }

        await client.query('COMMIT');
        return { parts: partPayload.length };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async upsertTrainServicePartLink(options: {
    variantId: string;
    fromPartId: string;
    toPartId: string;
    kind?: TrainServicePartLinkRecord['kind'];
  }): Promise<TrainServicePartLinkRecord> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const variantId = options.variantId.trim() || 'default';
    const fromPartId = options.fromPartId.trim();
    const toPartId = options.toPartId.trim();
    const kind: TrainServicePartLinkRecord['kind'] =
      options.kind ?? 'circulation';
    const result = await this.database.query<{
      variant_id: string;
      from_part_id: string;
      to_part_id: string;
      kind: string;
      created_at: string;
    }>(
      `
        INSERT INTO train_service_part_link (variant_id, from_part_id, to_part_id, kind)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (variant_id, from_part_id, kind) DO UPDATE
        SET to_part_id = EXCLUDED.to_part_id
        RETURNING variant_id, from_part_id, to_part_id, kind, created_at
      `,
      [variantId, fromPartId, toPartId, kind],
    );
    const row = result.rows[0];
    return {
      variantId: row.variant_id,
      fromPartId: row.from_part_id,
      toPartId: row.to_part_id,
      kind: row.kind as TrainServicePartLinkRecord['kind'],
      createdAt: row.created_at,
    };
  }

  async splitTrainServicePart(options: {
    variantId: string;
    stageId: TimetableStageId;
    partId: string;
    splitAfterSegmentId?: string | null;
    splitAfterOrderIndex?: number | null;
    newPartId?: string | null;
  }): Promise<{ leftPartId: string; rightPartId: string }> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const variantId = options.variantId.trim() || 'default';
    const stageId = (options.stageId?.trim() as TimetableStageId) || 'base';
    const partId = options.partId.trim();
    if (!partId) {
      throw new BadRequestException('partId ist erforderlich.');
    }

    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const part = await client.query<TrainServicePartRow>(
          `
            SELECT id, variant_id, stage_id, timetable_year_label, train_run_id, attributes
            FROM train_service_part
            WHERE variant_id = $1
              AND stage_id = $2
              AND id = $3
            FOR UPDATE
          `,
          [variantId, stageId, partId],
        );
        const partRow = part.rows[0];
        if (!partRow) {
          throw new NotFoundException(
            `TrainServicePart ${partId} existiert nicht.`,
          );
        }

        const segResult = await client.query<{
          segment_id: string;
          order_index: number;
        }>(
          `
            SELECT segment_id, order_index
            FROM train_service_part_segment
            WHERE variant_id = $1
              AND part_id = $2
            ORDER BY order_index ASC, segment_id ASC
            FOR UPDATE
          `,
          [variantId, partId],
        );
        const segments = segResult.rows.map((row) => ({
          segmentId: row.segment_id,
          orderIndex: row.order_index,
        }));
        if (segments.length < 2) {
          throw new BadRequestException(
            'Split erfordert mindestens zwei Segmente im TrainServicePart.',
          );
        }

        const splitAfterSegmentId = options.splitAfterSegmentId?.trim() || null;
        const splitAfterOrderIndex =
          typeof options.splitAfterOrderIndex === 'number' &&
          Number.isFinite(options.splitAfterOrderIndex)
            ? options.splitAfterOrderIndex
            : null;
        if (!splitAfterSegmentId && splitAfterOrderIndex === null) {
          throw new BadRequestException(
            'splitAfterSegmentId oder splitAfterOrderIndex ist erforderlich.',
          );
        }

        let splitIndex = -1;
        if (splitAfterSegmentId) {
          splitIndex = segments.findIndex(
            (seg) => seg.segmentId === splitAfterSegmentId,
          );
        } else if (splitAfterOrderIndex !== null) {
          splitIndex = segments.findIndex(
            (seg) => seg.orderIndex === splitAfterOrderIndex,
          );
        }
        if (splitIndex < 0) {
          throw new BadRequestException(
            'Split-Position wurde im TrainServicePart nicht gefunden.',
          );
        }
        if (splitIndex >= segments.length - 1) {
          throw new BadRequestException(
            'Split-Position muss vor dem letzten Segment liegen.',
          );
        }

        const leftSegments = segments.slice(0, splitIndex + 1);
        const rightSegments = segments.slice(splitIndex + 1);
        const allSegmentIds = Array.from(
          new Set([
            ...leftSegments.map((s) => s.segmentId),
            ...rightSegments.map((s) => s.segmentId),
          ]),
        );

        const segDetailsResult =
          await client.query<TrainServicePartSegmentDetailRow>(
            `
            SELECT id, train_run_id, start_time, end_time, from_location_id, to_location_id
            FROM train_segment
            WHERE variant_id = $1
              AND id = ANY($2::text[])
          `,
            [variantId, allSegmentIds],
          );
        const segDetails = new Map<string, TrainServicePartSegmentDetailRow>(
          segDetailsResult.rows.map((row) => [row.id, row]),
        );
        if (segDetails.size !== allSegmentIds.length) {
          throw new BadRequestException(
            'Mindestens ein Segment existiert nicht (TrainSegment).',
          );
        }
        for (const segId of allSegmentIds) {
          const detail = segDetails.get(segId);
          if (!detail || detail.train_run_id !== partRow.train_run_id) {
            throw new BadRequestException(
              'Segments müssen zum selben TrainRun gehören.',
            );
          }
        }

        const leftFirst = segDetails.get(leftSegments[0].segmentId)!;
        const leftLast = segDetails.get(
          leftSegments[leftSegments.length - 1].segmentId,
        )!;
        const rightFirst = segDetails.get(rightSegments[0].segmentId)!;
        const rightLast = segDetails.get(
          rightSegments[rightSegments.length - 1].segmentId,
        )!;

        const requestedNewPartId = options.newPartId?.trim() || null;
        const newPartId =
          requestedNewPartId || `tsp:${partRow.train_run_id}:${randomUUID()}`;

        await client.query(
          `
            UPDATE train_service_part
            SET from_location_id = $1,
                to_location_id = $2,
                start_time = $3,
                end_time = $4,
                updated_at = now()
            WHERE variant_id = $5
              AND stage_id = $6
              AND id = $7
          `,
          [
            leftFirst.from_location_id,
            leftLast.to_location_id,
            leftFirst.start_time,
            leftLast.end_time,
            variantId,
            stageId,
            partId,
          ],
        );

        await client.query(
          `DELETE FROM train_service_part_segment WHERE variant_id = $1 AND part_id = $2`,
          [variantId, partId],
        );

        const insertSegmentMappings = async (
          payload: Array<{ segmentId: string; orderIndex: number }>,
          part: string,
        ) => {
          if (!payload.length) {
            return;
          }
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb)
                     AS s(
                       "segmentId" TEXT,
                       "orderIndex" INTEGER
                     )
              )
              INSERT INTO train_service_part_segment (part_id, variant_id, segment_id, order_index)
              SELECT
                $2,
                $3,
                "segmentId",
                "orderIndex"
              FROM payload
            `,
            [JSON.stringify(payload), part, variantId],
          );
        };

        await insertSegmentMappings(
          leftSegments.map((seg, index) => ({
            segmentId: seg.segmentId,
            orderIndex: index,
          })),
          partId,
        );

        const exists = await client.query<{ id: string }>(
          `SELECT id FROM train_service_part WHERE variant_id = $1 AND id = $2`,
          [variantId, newPartId],
        );
        if (exists.rows[0]) {
          throw new BadRequestException(
            `newPartId ${newPartId} ist bereits vergeben.`,
          );
        }

        await client.query(
          `
            INSERT INTO train_service_part (
              id,
              variant_id,
              stage_id,
              timetable_year_label,
              train_run_id,
              from_location_id,
              to_location_id,
              start_time,
              end_time,
              attributes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `,
          [
            newPartId,
            variantId,
            stageId,
            partRow.timetable_year_label,
            partRow.train_run_id,
            rightFirst.from_location_id,
            rightLast.to_location_id,
            rightFirst.start_time,
            rightLast.end_time,
            partRow.attributes,
          ],
        );

        await insertSegmentMappings(
          rightSegments.map((seg, index) => ({
            segmentId: seg.segmentId,
            orderIndex: index,
          })),
          newPartId,
        );

        await client.query('COMMIT');
        return { leftPartId: partId, rightPartId: newPartId };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async mergeTrainServiceParts(options: {
    variantId: string;
    stageId: TimetableStageId;
    leftPartId: string;
    rightPartId: string;
  }): Promise<{ mergedPartId: string }> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const variantId = options.variantId.trim() || 'default';
    const stageId = (options.stageId?.trim() as TimetableStageId) || 'base';
    const leftPartId = options.leftPartId.trim();
    const rightPartId = options.rightPartId.trim();
    if (!leftPartId || !rightPartId) {
      throw new BadRequestException(
        'leftPartId und rightPartId sind erforderlich.',
      );
    }
    if (leftPartId === rightPartId) {
      throw new BadRequestException(
        'leftPartId und rightPartId müssen unterschiedlich sein.',
      );
    }

    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const parts = await client.query<TrainServicePartRow>(
          `
            SELECT id, variant_id, stage_id, timetable_year_label, train_run_id, attributes
            FROM train_service_part
            WHERE variant_id = $1
              AND stage_id = $2
              AND id = ANY($3::text[])
            FOR UPDATE
          `,
          [variantId, stageId, [leftPartId, rightPartId]],
        );
        const byId = new Map<string, TrainServicePartRow>(
          parts.rows.map((row) => [row.id, row]),
        );
        const leftPart = byId.get(leftPartId);
        const rightPart = byId.get(rightPartId);
        if (!leftPart) {
          throw new NotFoundException(
            `TrainServicePart ${leftPartId} existiert nicht.`,
          );
        }
        if (!rightPart) {
          throw new NotFoundException(
            `TrainServicePart ${rightPartId} existiert nicht.`,
          );
        }
        if (leftPart.train_run_id !== rightPart.train_run_id) {
          throw new BadRequestException(
            'Merge ist nur für Parts desselben TrainRun möglich.',
          );
        }

        const segRows = await client.query<{
          part_id: string;
          segment_id: string;
          order_index: number;
        }>(
          `
            SELECT part_id, segment_id, order_index
            FROM train_service_part_segment
            WHERE variant_id = $1
              AND part_id = ANY($2::text[])
            ORDER BY part_id, order_index ASC, segment_id ASC
            FOR UPDATE
          `,
          [variantId, [leftPartId, rightPartId]],
        );

        const leftSegmentsRaw = segRows.rows
          .filter((row) => row.part_id === leftPartId)
          .map((row) => row.segment_id);
        const rightSegmentsRaw = segRows.rows
          .filter((row) => row.part_id === rightPartId)
          .map((row) => row.segment_id);
        if (!leftSegmentsRaw.length || !rightSegmentsRaw.length) {
          throw new BadRequestException(
            'Merge erfordert, dass beide Parts mindestens ein Segment besitzen.',
          );
        }

        const rightSet = new Set(rightSegmentsRaw);
        const overlap = new Set(
          leftSegmentsRaw.filter((id) => rightSet.has(id)),
        );
        if (overlap.size) {
          throw new BadRequestException(
            'Parts dürfen keine gemeinsamen Segmente besitzen.',
          );
        }

        const runSegments = await client.query<{
          id: string;
          section_index: number;
          start_time: string;
          end_time: string;
          from_location_id: string;
          to_location_id: string;
        }>(
          `
            SELECT id, section_index, start_time, end_time, from_location_id, to_location_id
            FROM train_segment
            WHERE variant_id = $1
              AND train_run_id = $2
            ORDER BY section_index ASC, id ASC
          `,
          [variantId, leftPart.train_run_id],
        );
        const posBySegId = new Map<string, number>(
          runSegments.rows.map((row, index) => [row.id, index]),
        );
        const detailsBySegId = new Map<
          string,
          (typeof runSegments.rows)[number]
        >(runSegments.rows.map((row) => [row.id, row]));

        const leftSegments = [...leftSegmentsRaw].sort(
          (a, b) => (posBySegId.get(a) ?? 1e9) - (posBySegId.get(b) ?? 1e9),
        );
        const rightSegments = [...rightSegmentsRaw].sort(
          (a, b) => (posBySegId.get(a) ?? 1e9) - (posBySegId.get(b) ?? 1e9),
        );

        const leftFirstPos = posBySegId.get(leftSegments[0]);
        const leftLastPos = posBySegId.get(
          leftSegments[leftSegments.length - 1],
        );
        const rightFirstPos = posBySegId.get(rightSegments[0]);
        const rightLastPos = posBySegId.get(
          rightSegments[rightSegments.length - 1],
        );
        if (
          leftFirstPos === undefined ||
          leftLastPos === undefined ||
          rightFirstPos === undefined ||
          rightLastPos === undefined
        ) {
          throw new BadRequestException(
            'Mindestens ein Segment existiert nicht (TrainSegment).',
          );
        }
        if (leftLastPos >= rightFirstPos) {
          throw new BadRequestException(
            'leftPart muss vor rightPart liegen (nach Segment-Reihenfolge).',
          );
        }
        if (leftLastPos + 1 !== rightFirstPos) {
          throw new BadRequestException(
            'Merge ist nur für direkt benachbarte Parts möglich.',
          );
        }

        const mergedSegmentIds = [...leftSegments, ...rightSegments];
        const first = detailsBySegId.get(mergedSegmentIds[0])!;
        const last = detailsBySegId.get(
          mergedSegmentIds[mergedSegmentIds.length - 1],
        )!;

        await client.query(
          `
            UPDATE train_service_part
            SET from_location_id = $1,
                to_location_id = $2,
                start_time = $3,
                end_time = $4,
                updated_at = now()
            WHERE variant_id = $5
              AND stage_id = $6
              AND id = $7
          `,
          [
            first.from_location_id,
            last.to_location_id,
            first.start_time,
            last.end_time,
            variantId,
            stageId,
            leftPartId,
          ],
        );

        await client.query(
          `DELETE FROM train_service_part_segment WHERE variant_id = $1 AND part_id = $2`,
          [variantId, leftPartId],
        );

        await client.query(
          `
            WITH payload AS (
              SELECT *
              FROM jsonb_to_recordset($1::jsonb)
                   AS s(
                     "segmentId" TEXT,
                     "orderIndex" INTEGER
                   )
            )
            INSERT INTO train_service_part_segment (part_id, variant_id, segment_id, order_index)
            SELECT
              $2,
              $3,
              "segmentId",
              "orderIndex"
            FROM payload
          `,
          [
            JSON.stringify(
              mergedSegmentIds.map((segmentId, index) => ({
                segmentId,
                orderIndex: index,
              })),
            ),
            leftPartId,
            variantId,
          ],
        );

        await client.query(
          `DELETE FROM train_service_part WHERE variant_id = $1 AND stage_id = $2 AND id = $3`,
          [variantId, stageId, rightPartId],
        );

        await client.query('COMMIT');
        return { mergedPartId: leftPartId };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  private toIso(value: string | Date): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
