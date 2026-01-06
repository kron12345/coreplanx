import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ActivityDto, TimelineServiceDto } from '../timeline/timeline.types';
import {
  TimelineActivityRow,
  mapActivityRow,
  aggregateServices,
} from '../timeline/timeline.helpers';
import { TemplateTableUtil } from './template.util';
import { ActivityTemplateSet } from './template.types';
import { randomUUID } from 'crypto';

interface TemplateSetRow {
  id: string;
  name: string;
  description: string | null;
  table_name: string;
  variant_id: string;
  timetable_year_label: string | null;
  is_archived: boolean;
  archived_at: string | null;
  archived_reason: string | null;
  published_from_variant_id: string | null;
  published_from_template_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  periods: any | null;
  special_days: any | null;
  attributes: any | null;
}

interface ActivityRow extends TimelineActivityRow {
  deleted: boolean;
  deleted_at: string | null;
}

@Injectable()
export class TemplateRepository {
  private readonly logger = new Logger(TemplateRepository.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly tableUtil: TemplateTableUtil,
  ) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async listTemplateSets(variantId?: string, includeArchived = false): Promise<ActivityTemplateSet[]> {
    if (!this.isEnabled) {
      return [];
    }
    const normalizedVariantId = variantId?.trim().length ? variantId.trim() : 'default';
    const archiveFilter = includeArchived ? '' : 'AND is_archived = FALSE';
    const result = await this.database.query<TemplateSetRow>(
      `
        SELECT
          id,
          name,
          description,
          table_name,
          variant_id,
          timetable_year_label,
          is_archived,
          archived_at,
          archived_reason,
          published_from_variant_id,
          published_from_template_id,
          published_at,
          created_at,
          updated_at,
          periods,
          special_days,
          attributes
        FROM activity_template_set
        WHERE variant_id = $1
          ${archiveFilter}
        ORDER BY name
      `,
      [normalizedVariantId],
    );
    return result.rows.map((row) => this.mapTemplateSet(row));
  }

  async getTemplateSet(id: string, variantId?: string): Promise<ActivityTemplateSet | null> {
    if (!this.isEnabled) {
      return null;
    }
    const normalizedVariantId = variantId?.trim().length ? variantId.trim() : 'default';
    const result = await this.database.query<TemplateSetRow>(
      `
        SELECT
          id,
          name,
          description,
          table_name,
          variant_id,
          timetable_year_label,
          is_archived,
          archived_at,
          archived_reason,
          published_from_variant_id,
          published_from_template_id,
          published_at,
          created_at,
          updated_at,
          periods,
          special_days,
          attributes
        FROM activity_template_set
        WHERE id = $1
          AND variant_id = $2
      `,
      [id, normalizedVariantId],
    );
    const row = result.rows[0];
    return row ? this.mapTemplateSet(row) : null;
  }

  async createTemplateSet(set: ActivityTemplateSet): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `
            INSERT INTO activity_template_set (
              id,
              name,
              description,
              table_name,
              variant_id,
              timetable_year_label,
              is_archived,
              archived_at,
              archived_reason,
              published_from_variant_id,
              published_from_template_id,
              published_at,
              created_at,
              updated_at,
              periods,
              special_days,
              attributes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          `,
          [
            set.id,
            set.name,
            set.description ?? null,
            set.tableName,
            set.variantId,
            set.timetableYearLabel ?? null,
            set.isArchived ?? false,
            set.archivedAt ?? null,
            set.archivedReason ?? null,
            set.publishedFromVariantId ?? null,
            set.publishedFromTemplateId ?? null,
            set.publishedAt ?? null,
            set.createdAt,
            set.updatedAt,
            JSON.stringify(set.periods ?? []),
            JSON.stringify(set.specialDays ?? []),
            set.attributes ?? null,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    await this.tableUtil.createTemplateTable(set.tableName);
  }

  async updateTemplateSet(set: ActivityTemplateSet): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.query(
      `
        UPDATE activity_template_set
        SET name = $2,
            description = $3,
            updated_at = $4,
            periods = $5,
            special_days = $6,
            attributes = $7
        WHERE id = $1
      `,
      [
        set.id,
        set.name,
        set.description ?? null,
        set.updatedAt,
        JSON.stringify(set.periods ?? []),
        JSON.stringify(set.specialDays ?? []),
        set.attributes ?? null,
      ],
    );
  }

  async publishTemplateSet(options: {
    sourceTableName: string;
    target: ActivityTemplateSet;
    archiveReason?: string | null;
  }): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const safeSource = this.tableUtil.sanitize(options.sourceTableName);
    const safeTarget = this.tableUtil.sanitize(options.target.tableName);
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `
            UPDATE activity_template_set
            SET is_archived = TRUE,
                archived_at = now(),
                archived_reason = $2,
                updated_at = now()
            WHERE variant_id = $1
              AND is_archived = FALSE
          `,
          [options.target.variantId, options.archiveReason ?? 'published'],
        );

        await client.query(
          `
            INSERT INTO activity_template_set (
              id,
              name,
              description,
              table_name,
              variant_id,
              timetable_year_label,
              is_archived,
              archived_at,
              archived_reason,
              published_from_variant_id,
              published_from_template_id,
              published_at,
              created_at,
              updated_at,
              periods,
              special_days,
              attributes
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              FALSE, NULL, NULL,
              $7, $8, $9,
              $10, $11, $12, $13, $14
            )
          `,
          [
            options.target.id,
            options.target.name,
            options.target.description ?? null,
            options.target.tableName,
            options.target.variantId,
            options.target.timetableYearLabel ?? null,
            options.target.publishedFromVariantId ?? null,
            options.target.publishedFromTemplateId ?? null,
            options.target.publishedAt ?? null,
            options.target.createdAt,
            options.target.updatedAt,
            JSON.stringify(options.target.periods ?? []),
            JSON.stringify(options.target.specialDays ?? []),
            options.target.attributes ?? null,
          ],
        );

        await client.query(
          `
            CREATE TABLE IF NOT EXISTS ${safeTarget} (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL,
              stage TEXT NOT NULL DEFAULT 'base',
              deleted BOOLEAN NOT NULL DEFAULT FALSE,
              deleted_at TIMESTAMPTZ,
              start_time TIMESTAMPTZ NOT NULL,
              end_time TIMESTAMPTZ,
              is_open_ended BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              attributes JSONB NOT NULL,
              audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb
            );

            CREATE INDEX IF NOT EXISTS idx_${safeTarget}_timerange
              ON ${safeTarget} (stage, start_time, end_time)
              WHERE deleted = FALSE;
          `,
        );

        await client.query(
          `
            INSERT INTO ${safeTarget} (
              id,
              type,
              stage,
              deleted,
              deleted_at,
              start_time,
              end_time,
              is_open_ended,
              created_at,
              updated_at,
              attributes,
              audit_trail
            )
            SELECT
              id,
              type,
              stage,
              deleted,
              deleted_at,
              start_time,
              end_time,
              is_open_ended,
              now(),
              now(),
              attributes,
              audit_trail
            FROM ${safeSource}
          `,
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async deleteTemplateSet(id: string, variantId?: string): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const normalizedVariantId = variantId?.trim().length ? variantId.trim() : 'default';
    const row = await this.getTemplateSet(id, normalizedVariantId);
    if (!row) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `DELETE FROM activity_template_set WHERE id = $1 AND variant_id = $2`,
          [id, normalizedVariantId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    await this.tableUtil.dropTemplateTable(row.tableName);
  }

  async listActivities(
    tableName: string,
    from: string,
    to: string,
    stage: 'base' | 'operations',
  ): Promise<ActivityDto[]> {
    const safeTable = this.tableUtil.sanitize(tableName);
    const result = await this.database.query<ActivityRow>(
      `
        SELECT
          id,
          type,
          stage,
          deleted,
          deleted_at,
          start_time,
          end_time,
          is_open_ended,
          attributes
        FROM ${safeTable}
        WHERE deleted = FALSE
          AND stage = $1
          AND start_time < $3
          AND (end_time IS NULL OR end_time > $2 OR is_open_ended = TRUE)
      `,
      [stage, from, to],
    );
    const mapped = result.rows
      .map((row) => mapActivityRow(row, this.logger))
      .filter((dto): dto is ActivityDto => dto !== null);
    return this.markActivitiesWithinService(mapped);
  }

  async listAggregatedServices(
    tableName: string,
    from: string,
    to: string,
    stage: 'base' | 'operations',
  ): Promise<TimelineServiceDto[]> {
    const activities = await this.listActivities(tableName, from, to, stage);
    return aggregateServices(activities);
  }

  async upsertActivity(
    tableName: string,
    activity: ActivityDto,
  ): Promise<ActivityDto> {
    const normalized = this.enrichServiceMetadata(activity);
    const safeTable = this.tableUtil.sanitize(tableName);
    const isOpenEnded = normalized.isOpenEnded || !normalized.end;
    const attributes = {
      versions: [
        {
          version: normalized.version ?? 1,
          validFrom: normalized.start,
          validTo: null,
          data: {
            label: normalized.label ?? null,
            serviceId: normalized.serviceId ?? null,
            serviceRole: normalized.serviceRole ?? null,
            start: normalized.start,
            end: normalized.end ?? null,
            status: normalized.status ?? null,
            from: normalized.from ?? null,
            to: normalized.to ?? null,
            remark: normalized.remark ?? null,
            resourceAssignments: normalized.resourceAssignments ?? [],
            attributes: normalized.attributes ?? null,
          },
        },
      ],
    };
    const params: any[] = [
      normalized.id,
      normalized.type,
      normalized.stage,
      normalized.start,
      normalized.end ?? null,
      isOpenEnded,
      JSON.stringify(attributes),
    ];
    try {
      await this.database.query(
        `
          INSERT INTO ${safeTable} (
            id, type, stage, deleted, start_time, end_time, is_open_ended, attributes, audit_trail
          )
          VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7::jsonb, '[]'::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            type = EXCLUDED.type,
            stage = EXCLUDED.stage,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            is_open_ended = EXCLUDED.is_open_ended,
            attributes = EXCLUDED.attributes,
            updated_at = now()
        `,
        params,
      );
    } catch (error) {
      if (error?.code === '22P02' || /uuid/i.test((error as Error).message)) {
        await this.tableUtil.recreateTemplateTable(safeTable);
        await this.database.query(
          `
            INSERT INTO ${safeTable} (
              id, type, stage, deleted, start_time, end_time, is_open_ended, attributes, audit_trail
            )
            VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7::jsonb, '[]'::jsonb)
            ON CONFLICT (id) DO UPDATE SET
              type = EXCLUDED.type,
              stage = EXCLUDED.stage,
              start_time = EXCLUDED.start_time,
              end_time = EXCLUDED.end_time,
              is_open_ended = EXCLUDED.is_open_ended,
              attributes = EXCLUDED.attributes,
              updated_at = now()
          `,
          params,
        );
      } else {
        throw error;
      }
    }
    return {
      ...normalized,
      resourceAssignments: normalized.resourceAssignments ?? [],
    };
  }

  private enrichServiceMetadata(activity: ActivityDto): ActivityDto {
    const role = this.resolveServiceRole(activity);
    if (!role) {
      return activity;
    }
    const ownerId = this.resolveServiceOwner(activity);
    if (!ownerId) {
      return activity;
    }
    const serviceId = this.computeServiceId(
      activity.stage,
      ownerId,
      activity.start,
    );
    return {
      ...activity,
      serviceId,
      serviceRole: role,
    };
  }

  private resolveServiceOwner(activity: ActivityDto): string | null {
    const assignments = activity.resourceAssignments ?? [];
    const preferred = new Set(['personnel-service', 'vehicle-service']);
    const primary =
      assignments.find(
        (a) => a?.resourceId && preferred.has((a as any).resourceType ?? ''),
      ) ?? assignments.find((a) => a?.resourceId);
    return primary?.resourceId ?? null;
  }

  private resolveServiceRole(
    activity: ActivityDto,
  ): 'start' | 'end' | 'segment' | undefined {
    if (activity.serviceRole) {
      return activity.serviceRole;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (val: unknown) =>
      typeof val === 'boolean'
        ? val
        : typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : false;
    if (attrs) {
      if (toBool((attrs as any)['is_service_start'])) {
        return 'start';
      }
      if (toBool((attrs as any)['is_service_end'])) {
        return 'end';
      }
    }
    return undefined;
  }

  private computeServiceId(
    stage: 'base' | 'operations',
    ownerId: string,
    startIso: string,
  ): string {
    const date = new Date(startIso);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `svc:${stage}:${ownerId}:${y}-${m}-${d}`;
  }

  async deleteActivity(tableName: string, activityId: string): Promise<void> {
    const safeTable = this.tableUtil.sanitize(tableName);
    try {
      await this.database.query(
        `
          DELETE FROM ${safeTable}
          WHERE id = $1
        `,
        [activityId],
      );
    } catch (error) {
      if (error?.code === '22P02' || /uuid/i.test((error as Error).message)) {
        await this.tableUtil.recreateTemplateTable(safeTable);
        await this.database.query(
          `
            DELETE FROM ${safeTable}
            WHERE id = $1
          `,
          [activityId],
        );
      } else {
        throw error;
      }
    }
  }

  async rolloutToPlanning(
    tableName: string,
    targetStage: 'base' | 'operations',
    anchorStart?: string,
    variantId?: string,
  ): Promise<ActivityDto[]> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const activities = await this.listActivities(
      tableName,
      '1900-01-01T00:00:00Z',
      '9999-12-31T23:59:59Z',
      targetStage,
    );
    if (!activities.length) {
      return [];
    }
    let offsetMs = 0;
    if (anchorStart) {
      const minStart = Math.min(
        ...activities
          .map((a) => Date.parse(a.start))
          .filter((v) => !Number.isNaN(v)),
      );
      const anchorMs = Date.parse(anchorStart);
      if (!Number.isNaN(anchorMs) && !Number.isNaN(minStart)) {
        offsetMs = anchorMs - minStart;
      }
    }

    const payload = activities.map((activity) => {
      const startMs = Date.parse(activity.start);
      const endMs = activity.end ? Date.parse(activity.end) : NaN;
      const shiftedStart = Number.isNaN(startMs)
        ? activity.start
        : new Date(startMs + offsetMs).toISOString();
      const shiftedEnd =
        activity.end && !Number.isNaN(endMs)
          ? new Date(endMs + offsetMs).toISOString()
          : null;
      const isOpenEnded = activity.isOpenEnded || !shiftedEnd;
      const newId = randomUUID();
      const attributes = {
        versions: [
          {
            version: 1,
            validFrom: shiftedStart,
            validTo: null,
            data: {
              label: activity.label ?? null,
              serviceId: activity.serviceId ?? null,
              serviceRole: activity.serviceRole ?? null,
              start: shiftedStart,
              end: shiftedEnd,
              status: activity.status ?? null,
              from: activity.from ?? null,
              to: activity.to ?? null,
              remark: activity.remark ?? null,
              resourceAssignments: activity.resourceAssignments ?? [],
              attributes: activity.attributes ?? null,
            },
          },
        ],
      };
      return {
        id: newId,
        type: activity.type,
        stage: targetStage,
        variant_id: (variantId?.trim().length ? variantId.trim() : 'default'),
        start_time: shiftedStart,
        end_time: shiftedEnd,
        is_open_ended: isOpenEnded,
        attributes,
      };
    });

    await this.database.query(
      `
        INSERT INTO activities (
          id, type, stage, variant_id, deleted, start_time, end_time, is_open_ended, attributes, audit_trail
        )
        SELECT
          id,
          type,
          stage,
          variant_id,
          FALSE,
          start_time,
          end_time,
          is_open_ended,
          attributes,
          '[]'::jsonb
        FROM jsonb_to_recordset($1::jsonb) AS x(
          id TEXT,
          type TEXT,
          stage TEXT,
          variant_id TEXT,
          start_time TIMESTAMPTZ,
          end_time TIMESTAMPTZ,
          is_open_ended BOOLEAN,
          attributes JSONB
        )
      `,
      [JSON.stringify(payload)],
    );

    return payload.map((row) => {
      const version = row.attributes.versions?.[0];
      const data = version?.data ?? {};
      const activityAttributes =
        data.attributes === undefined ? undefined : data.attributes;
      return {
        id: row.id,
        stage: row.stage,
        type: row.type,
        start: row.start_time,
        end: row.end_time,
        isOpenEnded: row.is_open_ended,
        label: data.label ?? undefined,
        serviceId: data.serviceId ?? undefined,
        serviceRole: data.serviceRole ?? undefined,
        from: data.from ?? undefined,
        to: data.to ?? undefined,
        remark: data.remark ?? undefined,
        resourceAssignments: data.resourceAssignments ?? [],
        attributes: activityAttributes,
        version: version?.version ?? 1,
      };
    });
  }

  private markActivitiesWithinService(activities: ActivityDto[]): ActivityDto[] {
    if (!activities.length) {
      return activities;
    }
    const byOwner = new Map<string, ActivityDto[]>();
    activities.forEach((activity) => {
      const owner = this.resolveServiceOwner(activity);
      if (!owner) {
        return;
      }
      const list = byOwner.get(owner);
      if (list) {
        list.push(activity);
      } else {
        byOwner.set(owner, [activity]);
      }
    });

    const result = activities.map((activity) => ({ ...activity }));
    const idMap = new Map<string, number>();
    result.forEach((activity, index) => idMap.set(activity.id, index));

    byOwner.forEach((list) => {
      const starts = list
        .filter((a) => a.serviceRole === 'start' && a.serviceId)
        .map((a) => ({ serviceId: a.serviceId as string, start: Date.parse(a.start) }))
        .filter((s) => Number.isFinite(s.start));
      const ends = list
        .filter((a) => a.serviceRole === 'end' && a.serviceId)
        .map((a) => ({ serviceId: a.serviceId as string, start: Date.parse(a.start) }))
        .filter((e) => Number.isFinite(e.start));
      if (!starts.length) {
        return;
      }
      starts.forEach((startEntry) => {
        const windowStart = startEntry.start;
        const endEntry = ends
          .filter((e) => e.serviceId === startEntry.serviceId && e.start >= windowStart)
          .sort((a, b) => a.start - b.start)[0];
        const windowEnd = endEntry ? endEntry.start : windowStart + 36 * 3600 * 1000;
        list.forEach((activity) => {
          const begin = Date.parse(activity.start);
          if (!Number.isFinite(begin)) {
            return;
          }
          if (begin >= windowStart && begin <= windowEnd) {
            const idx = idMap.get(activity.id);
            if (idx === undefined) {
              return;
            }
            // Keine Attribut-Persistenz hier erforderlich.
          }
        });
      });
    });

    return result;
  }

  private mapTemplateSet(row: TemplateSetRow): ActivityTemplateSet {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      tableName: row.table_name,
      variantId: row.variant_id,
      timetableYearLabel: row.timetable_year_label ?? undefined,
      isArchived: row.is_archived,
      archivedAt: row.archived_at,
      archivedReason: row.archived_reason,
      publishedFromVariantId: row.published_from_variant_id,
      publishedFromTemplateId: row.published_from_template_id,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      periods: Array.isArray(row.periods) ? row.periods : [],
      specialDays: Array.isArray(row.special_days) ? row.special_days : [],
      attributes: row.attributes ?? undefined,
    };
  }
}
