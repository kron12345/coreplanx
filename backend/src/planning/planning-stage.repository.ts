import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { Activity, Resource, StageId, TimelineRange, TrainRun, TrainSegment } from './planning.types';
import type { StageData } from './planning.repository.types';

interface StageRow {
  stage_id: string;
  version: string | null;
  timeline_start: string;
  timeline_end: string;
}

interface ResourceRow {
  id: string;
  name: string;
  kind: string;
  daily_service_capacity: number | null;
  attributes: Record<string, unknown> | null;
}

interface ActivityRow {
  id: string;
  client_id: string | null;
  title: string;
  start: string;
  end: string | null;
  type: string | null;
  from: string | null;
  to: string | null;
  remark: string | null;
  service_id: string | null;
  service_template_id: string | null;
  service_date: string | Date | null;
  service_category: string | null;
  service_role: string | null;
  location_id: string | null;
  location_label: string | null;
  capacity_group_id: string | null;
  required_qualifications: string[] | null;
  assigned_qualifications: string[] | null;
  work_rule_tags: string[] | null;
  row_version: string | null;
  created_at: string | Date | null;
  created_by: string | null;
  updated_at: string | Date | null;
  updated_by: string | null;
  scope: string | null;
  participants: unknown | null;
  group_id: string | null;
  group_order: number | null;
  train_run_id: string | null;
  train_segment_ids: string[] | null;
  attributes: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

@Injectable()
export class PlanningStageRepository {
  private readonly logger = new Logger(PlanningStageRepository.name);

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async loadStageData(stageId: StageId): Promise<StageData | null> {
    if (!this.isEnabled) {
      return null;
    }

    const stageResult = await this.database.query<StageRow>(
      `
        SELECT stage_id, version, timeline_start, timeline_end
        FROM planning_stage
        WHERE stage_id = $1
      `,
      [stageId],
    );
    const stageRow = stageResult.rows[0];
    if (!stageRow) {
      return null;
    }

    const resourcesResult = await this.database.query<ResourceRow>(
      `
        SELECT id, name, kind, daily_service_capacity, attributes
        FROM planning_resource
        WHERE stage_id = $1
        ORDER BY name
      `,
      [stageId],
    );

    const activitiesResult = await this.database.query<ActivityRow>(
      `
        SELECT
          id,
          client_id,
          title,
          start,
          "end",
          type,
          "from",
          "to",
          remark,
          service_id,
          service_template_id,
          service_date,
          service_category,
          service_role,
          location_id,
          location_label,
          capacity_group_id,
          required_qualifications,
          assigned_qualifications,
          work_rule_tags,
          row_version,
          created_at,
          created_by,
          updated_at,
          updated_by,
          scope,
          participants,
          group_id,
          group_order,
          train_run_id,
          train_segment_ids,
          attributes,
          meta
        FROM planning_activity
        WHERE stage_id = $1
        ORDER BY start
      `,
      [stageId],
    );

    const trainRunsResult = await this.database.query<{
      id: string;
      train_number: string;
      timetable_id: string | null;
      attributes: Record<string, unknown> | null;
    }>(
      `
        SELECT id, train_number, timetable_id, attributes
        FROM train_run
        WHERE stage_id = $1
        ORDER BY train_number, id
      `,
      [stageId],
    );

    const trainSegmentsResult = await this.database.query<{
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
    }>(
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
        WHERE stage_id = $1
        ORDER BY train_run_id, section_index, id
      `,
      [stageId],
    );

    const trainRuns: TrainRun[] = trainRunsResult.rows.map((row) => ({
      id: row.id,
      trainNumber: row.train_number,
      timetableId: row.timetable_id ?? undefined,
      attributes: row.attributes ?? undefined,
    }));
    const trainSegments: TrainSegment[] = trainSegmentsResult.rows.map((row) => ({
      id: row.id,
      trainRunId: row.train_run_id,
      sectionIndex: row.section_index,
      startTime: this.toIso(row.start_time),
      endTime: this.toIso(row.end_time),
      fromLocationId: row.from_location_id,
      toLocationId: row.to_location_id,
      pathId: row.path_id ?? undefined,
      distanceKm: row.distance_km ?? undefined,
      attributes: row.attributes ?? undefined,
    }));

    return {
      stageId,
      timelineRange: {
        start: this.toIso(stageRow.timeline_start),
        end: this.toIso(stageRow.timeline_end),
      },
      version: stageRow.version ? this.toIso(stageRow.version) : null,
      resources: resourcesResult.rows.map((row) => this.mapResource(row)),
      activities: this.markActivitiesWithinService(
        activitiesResult.rows.map((row) => this.mapActivity(row)),
      ),
      trainRuns,
      trainSegments,
    };
  }

  async updateStageMetadata(
    stageId: StageId,
    timeline: TimelineRange,
    version?: string | null,
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    const resolvedVersion = version ?? new Date().toISOString();
    await this.database.query(
      `
        INSERT INTO planning_stage (stage_id, version, timeline_start, timeline_end)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (stage_id) DO UPDATE
        SET version = EXCLUDED.version,
            timeline_start = EXCLUDED.timeline_start,
            timeline_end = EXCLUDED.timeline_end
      `,
      [stageId, resolvedVersion, timeline.start, timeline.end],
    );
  }

  async applyResourceMutations(
    stageId: StageId,
    upserts: Resource[],
    deleteIds: string[],
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    if (!upserts.length && !deleteIds.length) {
      return;
    }

    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        if (upserts.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($2::jsonb)
                     AS r(
                       id TEXT,
                       name TEXT,
                       kind TEXT,
                       "dailyServiceCapacity" INTEGER,
                       attributes JSONB
                     )
              )
              INSERT INTO planning_resource (
                id, stage_id, name, kind, daily_service_capacity, attributes
              )
              SELECT
                id,
                $1,
                name,
                kind,
                "dailyServiceCapacity",
                attributes
              FROM payload
              ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                kind = EXCLUDED.kind,
                daily_service_capacity = EXCLUDED.daily_service_capacity,
                attributes = EXCLUDED.attributes,
                updated_at = now()
            `,
            [stageId, JSON.stringify(upserts)],
          );
        }

        if (deleteIds.length) {
          await client.query(
            `
              DELETE FROM planning_resource
              WHERE stage_id = $1
                AND id = ANY($2::text[])
            `,
            [stageId, deleteIds],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Fehler beim Speichern der Ressourcen für Stage ${stageId}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async applyActivityMutations(
    stageId: StageId,
    upserts: Activity[],
    deleteIds: string[],
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    if (!upserts.length && !deleteIds.length) {
      return;
    }

    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const normalizedUpserts: Activity[] = [];
        for (const activity of upserts) {
          normalizedUpserts.push(
            await this.prepareServiceMetadata(client, stageId, activity),
          );
        }
        if (normalizedUpserts.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($2::jsonb)
                     AS a(
                       id TEXT,
                       "clientId" TEXT,
                       title TEXT,
                       start TIMESTAMPTZ,
                       "end" TIMESTAMPTZ,
                       type TEXT,
                       "from" TEXT,
                       "to" TEXT,
                       remark TEXT,
                       "serviceId" TEXT,
                       "serviceTemplateId" TEXT,
                       "serviceDate" DATE,
                       "serviceCategory" TEXT,
                       "serviceRole" TEXT,
                       "locationId" TEXT,
                       "locationLabel" TEXT,
                       "capacityGroupId" TEXT,
                       "requiredQualifications" TEXT[],
                       "assignedQualifications" TEXT[],
                       "workRuleTags" TEXT[],
                       "rowVersion" TEXT,
                       "createdAt" TIMESTAMPTZ,
                       "createdBy" TEXT,
                       "updatedAt" TIMESTAMPTZ,
                       "updatedBy" TEXT,
                       scope TEXT,
                       participants JSONB,
                       "groupId" TEXT,
                       "groupOrder" INTEGER,
                       "trainRunId" TEXT,
                       "trainSegmentIds" TEXT[],
                       attributes JSONB,
                       meta JSONB
                     )
              )
              INSERT INTO planning_activity (
                id,
                stage_id,
                client_id,
                title,
                start,
                "end",
                type,
                "from",
                "to",
                remark,
                service_id,
                service_template_id,
                service_date,
                service_category,
                service_role,
                location_id,
                location_label,
                capacity_group_id,
                required_qualifications,
                assigned_qualifications,
                work_rule_tags,
                row_version,
                created_at,
                created_by,
                updated_at,
                updated_by,
                scope,
                participants,
                group_id,
                group_order,
                train_run_id,
                train_segment_ids,
                attributes,
                meta
              )
              SELECT
                id,
                $1,
                "clientId",
                title,
                start,
                "end",
                type,
                "from",
                "to",
                remark,
                "serviceId",
                "serviceTemplateId",
                "serviceDate",
                "serviceCategory",
                "serviceRole",
                "locationId",
                "locationLabel",
                "capacityGroupId",
                "requiredQualifications",
                "assignedQualifications",
                "workRuleTags",
                COALESCE("rowVersion", now()::text),
                COALESCE("createdAt", now()),
                "createdBy",
                now(),
                "updatedBy",
                scope,
                participants,
                "groupId",
                "groupOrder",
                "trainRunId",
                "trainSegmentIds",
                attributes,
                meta
              FROM payload
              ON CONFLICT (id) DO UPDATE SET
                client_id = EXCLUDED.client_id,
                title = EXCLUDED.title,
                start = EXCLUDED.start,
                "end" = EXCLUDED."end",
                type = EXCLUDED.type,
                "from" = EXCLUDED."from",
                "to" = EXCLUDED."to",
                remark = EXCLUDED.remark,
                service_id = EXCLUDED.service_id,
                service_template_id = EXCLUDED.service_template_id,
                service_date = EXCLUDED.service_date,
                service_category = EXCLUDED.service_category,
                service_role = EXCLUDED.service_role,
                location_id = EXCLUDED.location_id,
                location_label = EXCLUDED.location_label,
                capacity_group_id = EXCLUDED.capacity_group_id,
                required_qualifications = EXCLUDED.required_qualifications,
                assigned_qualifications = EXCLUDED.assigned_qualifications,
                work_rule_tags = EXCLUDED.work_rule_tags,
                row_version = EXCLUDED.row_version,
                attributes = EXCLUDED.attributes,
                meta = EXCLUDED.meta,
                updated_by = EXCLUDED.updated_by,
                scope = EXCLUDED.scope,
                participants = EXCLUDED.participants,
                group_id = EXCLUDED.group_id,
                group_order = EXCLUDED.group_order,
                train_run_id = EXCLUDED.train_run_id,
                train_segment_ids = EXCLUDED.train_segment_ids,
                updated_at = now()
            `,
            [stageId, JSON.stringify(normalizedUpserts)],
          );
        }

        if (deleteIds.length) {
          await client.query(
            `
              DELETE FROM planning_activity
              WHERE stage_id = $1
                AND id = ANY($2::text[])
            `,
            [stageId, deleteIds],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Fehler beim Speichern der Aktivitäten für Stage ${stageId}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async deleteActivities(stageId: StageId, deleteIds: string[]): Promise<void> {
    if (!this.isEnabled || !deleteIds.length) {
      return;
    }
    await this.database.query(
      `
        DELETE FROM planning_activity
        WHERE stage_id = $1
          AND id = ANY($2::text[])
      `,
      [stageId, deleteIds],
    );
  }

  private mapResource(row: ResourceRow): Resource {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as Resource['kind'],
      dailyServiceCapacity: row.daily_service_capacity ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapActivity(row: ActivityRow): Activity {
    let participants: Activity['participants'] | undefined;
    if (row.participants && Array.isArray(row.participants)) {
      participants = row.participants.map((entry) => ({
        resourceId: String((entry as any).resourceId),
        kind: (entry as any).kind,
        role: (entry as any).role ?? undefined,
      }));
    }

    return {
      id: row.id,
      clientId: row.client_id ?? undefined,
      title: row.title,
      start: this.toIso(row.start),
      end: row.end ? this.toIso(row.end) : undefined,
      type: row.type ?? undefined,
      from: row.from ?? undefined,
      to: row.to ?? undefined,
      remark: row.remark ?? undefined,
      serviceId: row.service_id ?? undefined,
      serviceTemplateId: row.service_template_id ?? undefined,
      serviceDate: this.toDateString(row.service_date),
      serviceCategory: row.service_category ?? undefined,
      serviceRole: row.service_role ?? undefined,
      locationId: row.location_id ?? undefined,
      locationLabel: row.location_label ?? undefined,
      capacityGroupId: row.capacity_group_id ?? undefined,
      requiredQualifications: row.required_qualifications ?? undefined,
      assignedQualifications: row.assigned_qualifications ?? undefined,
      workRuleTags: row.work_rule_tags ?? undefined,
      rowVersion: row.row_version ?? undefined,
      createdAt: row.created_at ? this.toIso(row.created_at) : undefined,
      createdBy: row.created_by ?? undefined,
      updatedAt: row.updated_at ? this.toIso(row.updated_at) : undefined,
      updatedBy: row.updated_by ?? undefined,
      scope: (row.scope as any) ?? undefined,
      participants,
      groupId: row.group_id ?? undefined,
      groupOrder: row.group_order ?? undefined,
      trainRunId: row.train_run_id ?? undefined,
      trainSegmentIds: row.train_segment_ids ?? undefined,
      attributes: row.attributes ?? undefined,
      meta: row.meta ?? undefined,
    };
  }

  private enrichServiceMetadata(stageId: StageId, activity: Activity): Activity {
    const role = this.resolveServiceRole(activity);
    if (!role) {
      return activity;
    }
    const ownerId = this.resolveServiceOwner(activity);
    if (!ownerId) {
      return activity;
    }
    const serviceId = this.computeServiceId(stageId, ownerId, activity.start);
    return {
      ...activity,
      serviceId,
      serviceRole: role,
    };
  }

  private async prepareServiceMetadata(
    client: PoolClient,
    stageId: StageId,
    activity: Activity,
  ): Promise<Activity> {
    const role = this.resolveServiceRole(activity);
    const ownerId = this.resolveServiceOwner(activity);
    if (!ownerId) {
      return activity;
    }
    const withinPref = this.resolveWithinPreference(activity);
    if (!role) {
      await this.enforceWithinPreference(
        client,
        stageId,
        ownerId,
        activity,
        withinPref,
      );
      return activity;
    }
    if (role === 'end') {
      const match = await this.findLatestServiceStart(
        client,
        stageId,
        ownerId,
        activity.start,
      );
      const serviceId =
        match?.serviceId ??
        this.computeServiceId(stageId, ownerId, match?.start ?? activity.start);
      await this.ensureNoDuplicate(client, stageId, serviceId, 'end', activity.id);
      await this.enforceWithinPreference(
        client,
        stageId,
        ownerId,
        activity,
        withinPref,
        serviceId,
      );
      return {
        ...activity,
        serviceId,
        serviceRole: 'end',
      };
    }
    // role === 'start'
    const serviceId = this.computeServiceId(stageId, ownerId, activity.start);
    await this.ensureNoDuplicate(client, stageId, serviceId, 'start', activity.id);
    await this.attachPendingEnd(client, stageId, ownerId, serviceId, activity.start);
    await this.enforceWithinPreference(
      client,
      stageId,
      ownerId,
      activity,
      withinPref,
      serviceId,
    );
    return {
      ...activity,
      serviceId,
      serviceRole: 'start',
    };
  }

  private resolveServiceOwner(activity: Activity): string | null {
    const participants = activity.participants ?? [];
    const preferredKinds = new Set(['personnel-service', 'vehicle-service']);
    const owner =
      participants.find(
        (p) =>
          (p as any)?.resourceId &&
          preferredKinds.has(((p as any).kind ?? (p as any).role ?? '') as string),
      ) ?? null;
    return (owner as any)?.resourceId ?? null;
  }

  private resolveServiceRole(activity: Activity): 'start' | 'end' | 'segment' | null {
    if (activity.serviceRole) {
      return activity.serviceRole as 'start' | 'end' | 'segment';
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
    return null;
  }

  private resolveWithinPreference(activity: Activity): 'within' | 'outside' | 'both' {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const meta = activity.meta as Record<string, unknown> | undefined;
    const raw =
      attrs && attrs['is_within_service'] !== undefined
        ? attrs['is_within_service']
        : meta?.['is_within_service'];
    if (typeof raw === 'boolean') {
      return raw ? 'within' : 'outside';
    }
    if (typeof raw === 'string') {
      const val = raw.trim().toLowerCase();
      if (val === 'yes' || val === 'true' || val === 'inside' || val === 'in') {
        return 'within';
      }
      if (val === 'no' || val === 'false' || val === 'outside' || val === 'out') {
        return 'outside';
      }
      if (val === 'both') {
        return 'both';
      }
    }
    return 'both';
  }

  private computeServiceId(stageId: StageId, ownerId: string, startIso: string): string {
    const date = new Date(startIso);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `svc:${stageId}:${ownerId}:${y}-${m}-${d}`;
  }

  private async findLatestServiceStart(
    client: PoolClient,
    stageId: StageId,
    ownerId: string,
    beforeIso: string,
    serviceId?: string,
  ): Promise<{ id: string; start: string; serviceId: string | null } | null> {
    const params: any[] = [stageId, beforeIso, JSON.stringify([{ resourceId: ownerId }])];
    let serviceFilter = '';
    if (serviceId) {
      params.push(serviceId);
      serviceFilter = 'AND service_id = $4';
    }
    const sql = `
      SELECT id, start, service_id
      FROM planning_activity
      WHERE stage_id = $1
        AND service_role = 'start'
        AND start <= $2
        AND participants @> $3::jsonb
        ${serviceFilter}
      ORDER BY start DESC
      LIMIT 1
    `;
    const result = await client.query<{ id: string; start: string; service_id: string | null }>(
      sql,
      params,
    );
    const row = result.rows[0];
    return row ? { id: row.id, start: row.start, serviceId: row.service_id } : null;
  }

  private async ensureNoDuplicate(
    client: PoolClient,
    stageId: StageId,
    serviceId: string,
    role: 'start' | 'end',
    selfId: string,
  ): Promise<void> {
    const result = await client.query<{ id: string }>(
      `
        SELECT id
        FROM planning_activity
        WHERE stage_id = $1
          AND service_id = $2
          AND service_role = $3
          AND id <> $4
        LIMIT 1
      `,
      [stageId, serviceId, role, selfId],
    );
    if (result.rows.length) {
      throw new ConflictException(`Service ${serviceId} hat bereits ein ${role}.`);
    }
  }

  private async attachPendingEnd(
    client: PoolClient,
    stageId: StageId,
    ownerId: string,
    serviceId: string,
    startIso: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE planning_activity
        SET service_id = $3
        WHERE stage_id = $1
          AND service_role = 'end'
          AND service_id IS NULL
          AND start >= $2
          AND participants @> $4::jsonb
        ORDER BY start
        LIMIT 1
      `,
      [stageId, startIso, serviceId, JSON.stringify([{ resourceId: ownerId }])],
    );
  }

  private async enforceWithinPreference(
    client: PoolClient,
    stageId: StageId,
    ownerId: string,
    activity: Activity,
    pref: 'within' | 'outside' | 'both',
    predefinedServiceId?: string,
  ): Promise<void> {
    if (pref === 'both') {
      return;
    }
    const latestStart = await this.findLatestServiceStart(
      client,
      stageId,
      ownerId,
      activity.start,
    );
    const serviceId =
      predefinedServiceId ??
      latestStart?.serviceId ??
      this.computeServiceId(stageId, ownerId, latestStart?.start ?? activity.start);
    const window = await this.findServiceWindow(
      client,
      stageId,
      ownerId,
      serviceId,
      latestStart?.start ?? activity.start,
    );
    const inWindow = window ? this.isWithinWindow(activity.start, window) : false;
    if (pref === 'within' && !inWindow) {
      throw new ConflictException(
        'Aktivität muss innerhalb eines Dienstes liegen, aber kein Dienstfenster gefunden.',
      );
    }
    if (pref === 'outside' && inWindow) {
      throw new ConflictException(
        'Aktivität muss außerhalb eines Dienstes liegen, liegt aber in einem Dienstfenster.',
      );
    }
  }

  private async findServiceWindow(
    client: PoolClient,
    stageId: StageId,
    ownerId: string,
    serviceId: string,
    referenceIso: string,
  ): Promise<{ startMs: number; endMs: number } | null> {
    const startRow =
      (await this.findLatestServiceStart(
        client,
        stageId,
        ownerId,
        referenceIso,
        serviceId,
      )) ?? (await this.findLatestServiceStart(client, stageId, ownerId, referenceIso));
    if (!startRow) {
      return null;
    }
    const effectiveServiceId = startRow.serviceId ?? serviceId;
    const endRow = await this.findFirstServiceEnd(
      client,
      stageId,
      ownerId,
      effectiveServiceId,
      startRow.start,
    );
    const startMs = Date.parse(startRow.start);
    const endMs = endRow ? Date.parse(endRow.start) : startMs + 36 * 3600 * 1000;
    return { startMs, endMs };
  }

  private async findFirstServiceEnd(
    client: PoolClient,
    stageId: StageId,
    ownerId: string,
    serviceId: string,
    afterIso: string,
  ): Promise<{ id: string; start: string } | null> {
    const result = await client.query<{ id: string; start: string }>(
      `
        SELECT id, start
        FROM planning_activity
        WHERE stage_id = $1
          AND service_role = 'end'
          AND service_id = $2
          AND start >= $3
          AND participants @> $4::jsonb
        ORDER BY start ASC
        LIMIT 1
      `,
      [stageId, serviceId, afterIso, JSON.stringify([{ resourceId: ownerId }])],
    );
    return result.rows[0] ?? null;
  }

  private isWithinWindow(startIso: string, window: { startMs: number; endMs: number }): boolean {
    const ts = Date.parse(startIso);
    if (!Number.isFinite(ts)) {
      return false;
    }
    return ts >= window.startMs && ts <= window.endMs;
  }

  private toIso(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toDateString(value: string | Date | null): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value instanceof Date) {
      return value.toISOString().substring(0, 10);
    }
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
      return value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().substring(0, 10);
  }

  private markActivitiesWithinService(activities: Activity[]): Activity[] {
    if (!activities.length) {
      return activities;
    }
    const byOwner = new Map<string, Activity[]>();
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
        .map((a) => ({
          serviceId: a.serviceId as string,
          start: Date.parse(a.start),
        }))
        .filter((s) => Number.isFinite(s.start));
      const ends = list
        .filter((a) => a.serviceRole === 'end' && a.serviceId)
        .map((a) => ({
          serviceId: a.serviceId as string,
          start: Date.parse(a.start),
        }))
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
            // Keine Persistenz nötig; Kennzeichnung bleibt optional.
            void idx;
          }
        });
      });
    });

    return result;
  }
}

