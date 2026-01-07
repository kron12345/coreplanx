import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { PlanningStageService } from './planning-stage.service';

type PlanningAdminClearScope =
  | 'all'
  | 'stages'
  | 'resources'
  | 'activities'
  | 'templates'
  | 'train-runs'
  | 'train-segments';

type PlanningStageSampleRow = Record<string, unknown> & {
  stage_id: string;
  variant_id: string;
  timetable_year_label: string | null;
  version: string | null;
  timeline_start: string;
  timeline_end: string;
};

type PlanningResourceSampleRow = Record<string, unknown> & {
  stage_id: string;
  variant_id: string;
  id: string;
  kind: string;
  name: string;
};

type PlanningActivitySampleRow = Record<string, unknown> & {
  stage_id: string;
  variant_id: string;
  id: string;
  type: string | null;
  start: string;
  end: string | null;
  service_id: string | null;
  service_role: string | null;
};

type PlanningTrainRunSampleRow = Record<string, unknown> & {
  id: string;
  stage_id: string;
  variant_id: string;
  train_number: string;
  timetable_id: string | null;
};

type PlanningTrainSegmentSampleRow = Record<string, unknown> & {
  id: string;
  stage_id: string;
  variant_id: string;
  train_run_id: string;
  section_index: number;
  start_time: string;
  end_time: string;
  from_location_id: string;
  to_location_id: string;
};

type PlanningTemplateSetSampleRow = Record<string, unknown> & {
  id: string;
  name: string;
  table_name: string;
  variant_id: string;
  timetable_year_label: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

type PlanningTemplateActivityRow = Record<string, unknown> & {
  id: string;
  type: string;
  stage: string;
  deleted: boolean;
  deleted_at: string | null;
  start_time: string;
  end_time: string | null;
  is_open_ended: boolean;
  created_at: string;
  updated_at: string;
  attributes: Record<string, unknown>;
  audit_trail: Record<string, unknown>;
};

type PlanningAdminSummary = {
  generatedAt: string;
  sampleLimit: number;
  totals: {
    stages: number;
    resources: number;
    activities: number;
    templates: number;
    trainRuns: number;
    trainSegments: number;
  };
  byStage: {
    base: { resources: number; activities: number };
    operations: { resources: number; activities: number };
  };
  samples: {
    stages: Array<{
      stageId: string;
      variantId: string;
      timetableYearLabel: string | null;
      version: string | null;
      timelineStart: string;
      timelineEnd: string;
      raw: Record<string, unknown>;
    }>;
    resources: Array<{
      stageId: string;
      variantId: string;
      id: string;
      kind: string;
      name: string;
      raw: Record<string, unknown>;
    }>;
    activities: Array<{
      stageId: string;
      variantId: string;
      id: string;
      type: string | null;
      start: string;
      end: string | null;
      serviceId: string | null;
      serviceRole: string | null;
      raw: Record<string, unknown>;
    }>;
    templateActivities: Array<{
      templateId: string;
      templateName: string;
      tableName: string;
      variantId: string;
      id: string;
      type: string;
      stage: string;
      startTime: string;
      endTime: string | null;
      raw: Record<string, unknown>;
    }>;
    trainRuns: Array<{
      id: string;
      stageId: string;
      variantId: string;
      trainNumber: string;
      timetableId: string | null;
      raw: Record<string, unknown>;
    }>;
    trainSegments: Array<{
      id: string;
      stageId: string;
      variantId: string;
      trainRunId: string;
      sectionIndex: number;
      startTime: string;
      endTime: string;
      fromLocationId: string;
      toLocationId: string;
      raw: Record<string, unknown>;
    }>;
  };
};

type PlanningAdminClearResponse = {
  clearedAt: string;
  deleted: {
    stages: number;
    resources: number;
    activities: number;
    templates: number;
    trainRuns: number;
    trainSegments: number;
  };
};

@Injectable()
export class PlanningAdminService {
  private readonly logger = new Logger(PlanningAdminService.name);
  private readonly defaultSampleLimit = 30;
  private readonly maxSampleLimit = 40;

  constructor(
    private readonly database: DatabaseService,
    private readonly stageService: PlanningStageService,
  ) {}

  async getPlanningDataSummary(limit?: number): Promise<PlanningAdminSummary> {
    this.ensureAccess();
    const sampleLimit = this.clampLimit(limit);

    const [
      stageCounts,
      resourceCounts,
      activityCounts,
      trainRunCount,
      trainSegmentCount,
      stageSamples,
      resourceSamples,
      activitySamples,
      templateSetCount,
      templateSetSamples,
      trainRunSamples,
      trainSegmentSamples,
    ] = await Promise.all([
      this.database.query<{ stage_id: string; count: string }>(
        `SELECT stage_id, COUNT(*)::int AS count FROM planning_stage GROUP BY stage_id`,
      ),
      this.database.query<{ stage_id: string; count: string }>(
        `SELECT stage_id, COUNT(*)::int AS count FROM planning_resource GROUP BY stage_id`,
      ),
      this.database.query<{ stage_id: string; count: string }>(
        `SELECT stage_id, COUNT(*)::int AS count FROM planning_activity GROUP BY stage_id`,
      ),
      this.database.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM train_run`),
      this.database.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM train_segment`),
      this.database.query<PlanningStageSampleRow>(
        `
          SELECT stage_id, variant_id, timetable_year_label, version, timeline_start, timeline_end
          FROM planning_stage
          ORDER BY variant_id, stage_id
          LIMIT $1
        `,
        [sampleLimit],
      ),
      this.database.query<PlanningResourceSampleRow>(
        `
          SELECT *
          FROM planning_resource
          ORDER BY variant_id, stage_id, name
          LIMIT $1
        `,
        [sampleLimit],
      ),
      this.database.query<PlanningActivitySampleRow>(
        `
          SELECT *
          FROM planning_activity
          ORDER BY COALESCE(updated_at, created_at, start) DESC NULLS LAST
          LIMIT $1
        `,
        [sampleLimit],
      ),
      this.database.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM activity_template_set`),
      this.database.query<PlanningTemplateSetSampleRow>(
        `
          SELECT id, name, table_name, variant_id, timetable_year_label, is_archived, created_at, updated_at
          FROM activity_template_set
          ORDER BY name
          LIMIT $1
        `,
        [sampleLimit],
      ),
      this.database.query<PlanningTrainRunSampleRow>(
        `
          SELECT *
          FROM train_run
          ORDER BY train_number, id
          LIMIT $1
        `,
        [sampleLimit],
      ),
      this.database.query<PlanningTrainSegmentSampleRow>(
        `
          SELECT *
          FROM train_segment
          ORDER BY start_time DESC NULLS LAST, id
          LIMIT $1
        `,
        [sampleLimit],
      ),
    ]);

    const templateActivitySamples = await this.loadTemplateActivitySamples(
      templateSetSamples.rows,
      sampleLimit,
    );

    const stageCountMap = this.countByStage(stageCounts.rows);
    const resourceCountMap = this.countByStage(resourceCounts.rows);
    const activityCountMap = this.countByStage(activityCounts.rows);

    const totals = {
      stages: this.sumCounts(stageCounts.rows),
      resources: this.sumCounts(resourceCounts.rows),
      activities: this.sumCounts(activityCounts.rows),
      templates: this.parseCount(templateSetCount.rows[0]?.count),
      trainRuns: this.parseCount(trainRunCount.rows[0]?.count),
      trainSegments: this.parseCount(trainSegmentCount.rows[0]?.count),
    };

    return {
      generatedAt: new Date().toISOString(),
      sampleLimit,
      totals,
      byStage: {
        base: {
          resources: resourceCountMap.get('base') ?? 0,
          activities: activityCountMap.get('base') ?? 0,
        },
        operations: {
          resources: resourceCountMap.get('operations') ?? 0,
          activities: activityCountMap.get('operations') ?? 0,
        },
      },
      samples: {
        stages: stageSamples.rows.map((row) => ({
          stageId: row.stage_id,
          variantId: row.variant_id,
          timetableYearLabel: row.timetable_year_label ?? null,
          version: row.version ?? null,
          timelineStart: row.timeline_start,
          timelineEnd: row.timeline_end,
          raw: row,
        })),
        resources: resourceSamples.rows.map((row) => ({
          stageId: row.stage_id,
          variantId: row.variant_id,
          id: row.id,
          kind: row.kind,
          name: row.name,
          raw: row,
        })),
        activities: activitySamples.rows.map((row) => ({
          stageId: row.stage_id,
          variantId: row.variant_id,
          id: row.id,
          type: row.type ?? null,
          start: row.start,
          end: row.end ?? null,
          serviceId: row.service_id ?? null,
          serviceRole: row.service_role ?? null,
          raw: row,
        })),
        templateActivities: templateActivitySamples,
        trainRuns: trainRunSamples.rows.map((row) => ({
          id: row.id,
          stageId: row.stage_id,
          variantId: row.variant_id,
          trainNumber: row.train_number,
          timetableId: row.timetable_id ?? null,
          raw: row,
        })),
        trainSegments: trainSegmentSamples.rows.map((row) => ({
          id: row.id,
          stageId: row.stage_id,
          variantId: row.variant_id,
          trainRunId: row.train_run_id,
          sectionIndex: row.section_index,
          startTime: row.start_time,
          endTime: row.end_time,
          fromLocationId: row.from_location_id,
          toLocationId: row.to_location_id,
          raw: row,
        })),
      },
    };
  }

  async clearPlanningData(confirmation: string, scope?: string): Promise<PlanningAdminClearResponse> {
    this.ensureAccess();
    const trimmed = (confirmation ?? '').trim();
    if (trimmed !== 'DELETE') {
      throw new BadRequestException('Bestaetigung fehlt. Bitte DELETE eingeben.');
    }

    const resolvedScope = this.resolveScope(scope);
    const deleted = await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const deleted = await this.deleteByScope(client, resolvedScope);
        await client.query('COMMIT');
        return deleted;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    this.applyStageCacheReset(resolvedScope);
    this.logger.warn(`Planning data cleared via admin endpoint (${resolvedScope}).`, deleted);

    return {
      clearedAt: new Date().toISOString(),
      deleted,
    };
  }

  private ensureAccess(): void {
    if (!this.database.enabled) {
      throw new BadRequestException('Datenbank ist nicht konfiguriert.');
    }
    if (!this.isAdminEnabled()) {
      throw new ForbiddenException('Admin-Endpoint ist deaktiviert (nur Dev).');
    }
  }

  private isAdminEnabled(): boolean {
    const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
    if (env === 'production') {
      return false;
    }
    const flag = (process.env.PLANNING_ADMIN_ENABLED ?? '').trim().toLowerCase();
    if (!flag) {
      return true;
    }
    return flag === 'true' || flag === '1' || flag === 'yes';
  }

  private clampLimit(limit?: number): number {
    const raw = Number(limit);
    if (!Number.isFinite(raw)) {
      return this.defaultSampleLimit;
    }
    return Math.min(this.maxSampleLimit, Math.max(1, Math.round(raw)));
  }

  private parseCount(value: unknown): number {
    const parsed = Number.parseInt(`${value ?? 0}`, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private sumCounts(rows: Array<{ count: string }>): number {
    return rows.reduce((sum, row) => sum + this.parseCount(row.count), 0);
  }

  private countByStage(rows: Array<{ stage_id: string; count: string }>): Map<string, number> {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      map.set(row.stage_id, this.parseCount(row.count));
    });
    return map;
  }

  private resolveScope(scope?: string): PlanningAdminClearScope {
    const raw = (scope ?? '').trim().toLowerCase();
    if (!raw) {
      return 'all';
    }
    if (raw === 'all') {
      return 'all';
    }
    if (raw === 'stages') {
      return 'stages';
    }
    if (raw === 'resources') {
      return 'resources';
    }
    if (raw === 'activities') {
      return 'activities';
    }
    if (raw === 'templates' || raw === 'template' || raw === 'base-templates') {
      return 'templates';
    }
    if (raw === 'train-runs' || raw === 'train_runs' || raw === 'trainruns') {
      return 'train-runs';
    }
    if (raw === 'train-segments' || raw === 'train_segments' || raw === 'trainsegments') {
      return 'train-segments';
    }
    throw new BadRequestException('Ungueltiger Scope fuer das Loeschen.');
  }

  private async deleteByScope(
    client: PoolClient,
    scope: PlanningAdminClearScope,
  ): Promise<PlanningAdminClearResponse['deleted']> {
    switch (scope) {
      case 'all': {
        const templates = await this.deleteTemplateSets(client);
        const trainSegments = await client.query(`DELETE FROM train_segment`);
        const trainRuns = await client.query(`DELETE FROM train_run`);
        const activities = await client.query(`DELETE FROM planning_activity`);
        const resources = await client.query(`DELETE FROM planning_resource`);
        const stages = await client.query(`DELETE FROM planning_stage`);
        return {
          stages: stages.rowCount ?? 0,
          resources: resources.rowCount ?? 0,
          activities: activities.rowCount ?? 0,
          templates,
          trainRuns: trainRuns.rowCount ?? 0,
          trainSegments: trainSegments.rowCount ?? 0,
        };
      }
      case 'stages': {
        const counts = await this.getCurrentCounts(client);
        await client.query(`DELETE FROM planning_stage`);
        return counts;
      }
      case 'resources': {
        const deleted = this.emptyDeletedCounts();
        const resources = await client.query(`DELETE FROM planning_resource`);
        deleted.resources = resources.rowCount ?? 0;
        return deleted;
      }
      case 'activities': {
        const deleted = this.emptyDeletedCounts();
        const activities = await client.query(`DELETE FROM planning_activity`);
        deleted.activities = activities.rowCount ?? 0;
        return deleted;
      }
      case 'templates': {
        const deleted = this.emptyDeletedCounts();
        deleted.templates = await this.deleteTemplateSets(client);
        return deleted;
      }
      case 'train-runs': {
        const deleted = this.emptyDeletedCounts();
        deleted.trainRuns = await this.countTableRows(client, 'train_run');
        deleted.trainSegments = await this.countTableRows(client, 'train_segment');
        await client.query(`DELETE FROM train_run`);
        return deleted;
      }
      case 'train-segments': {
        const deleted = this.emptyDeletedCounts();
        const trainSegments = await client.query(`DELETE FROM train_segment`);
        deleted.trainSegments = trainSegments.rowCount ?? 0;
        return deleted;
      }
    }
  }

  private emptyDeletedCounts(): PlanningAdminClearResponse['deleted'] {
    return {
      stages: 0,
      resources: 0,
      activities: 0,
      templates: 0,
      trainRuns: 0,
      trainSegments: 0,
    };
  }

  private async getCurrentCounts(client: PoolClient): Promise<PlanningAdminClearResponse['deleted']> {
    const [stages, resources, activities, trainRuns, trainSegments] = await Promise.all([
      this.countTableRows(client, 'planning_stage'),
      this.countTableRows(client, 'planning_resource'),
      this.countTableRows(client, 'planning_activity'),
      this.countTableRows(client, 'train_run'),
      this.countTableRows(client, 'train_segment'),
    ]);
    return {
      stages,
      resources,
      activities,
      templates: 0,
      trainRuns,
      trainSegments,
    };
  }

  private async countTableRows(
    client: PoolClient,
    tableName: 'planning_stage' | 'planning_resource' | 'planning_activity' | 'train_run' | 'train_segment',
  ): Promise<number> {
    const result = await client.query<{ count: string }>(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
    return this.parseCount(result.rows[0]?.count);
  }

  private async loadTemplateActivitySamples(
    templateSets: PlanningTemplateSetSampleRow[],
    sampleLimit: number,
  ): Promise<PlanningAdminSummary['samples']['templateActivities']> {
    if (!templateSets.length || sampleLimit <= 0) {
      return [];
    }

    const samples: PlanningAdminSummary['samples']['templateActivities'] = [];

    for (const set of templateSets) {
      if (samples.length >= sampleLimit) {
        break;
      }
      const safeName = this.sanitizeTemplateTableName(set.table_name);
      if (!safeName) {
        this.logger.warn('Template table name is invalid; skipping sample load.', set.table_name);
        continue;
      }
      const remaining = sampleLimit - samples.length;
      try {
        const rows = await this.database.query<PlanningTemplateActivityRow>(
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
              created_at,
              updated_at,
              attributes,
              audit_trail
            FROM ${safeName}
            WHERE deleted = FALSE
            ORDER BY updated_at DESC NULLS LAST, start_time DESC
            LIMIT $1
          `,
          [remaining],
        );
        rows.rows.forEach((row) => {
          samples.push({
            templateId: set.id,
            templateName: set.name,
            tableName: set.table_name,
            variantId: set.variant_id,
            id: row.id,
            type: row.type,
            stage: row.stage,
            startTime: row.start_time,
            endTime: row.end_time ?? null,
            raw: row,
          });
        });
      } catch (error) {
        this.logger.warn(
          `Template table ${safeName} konnte nicht gelesen werden.`,
          (error as Error).stack ?? String(error),
        );
      }
    }

    return samples;
  }

  private async deleteTemplateSets(client: PoolClient): Promise<number> {
    const templateSets = await client.query<{ table_name: string }>(
      `SELECT table_name FROM activity_template_set`,
    );
    for (const row of templateSets.rows) {
      const safeName = this.sanitizeTemplateTableName(row.table_name);
      if (!safeName) {
        this.logger.warn('Template table name is invalid; skipping drop.', row.table_name);
        continue;
      }
      await client.query(`DROP TABLE IF EXISTS ${safeName}`);
    }
    const deleted = await client.query(`DELETE FROM activity_template_set`);
    return deleted.rowCount ?? 0;
  }

  private sanitizeTemplateTableName(value: string | null | undefined): string | null {
    const raw = typeof value === 'string' ? value : '';
    const safe = raw.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!safe) {
      return null;
    }
    return safe;
  }

  private applyStageCacheReset(scope: PlanningAdminClearScope): void {
    const clearResources = scope === 'all' || scope === 'stages' || scope === 'resources';
    const clearActivities = scope === 'all' || scope === 'stages' || scope === 'activities';
    const clearTrainRuns = scope === 'all' || scope === 'stages' || scope === 'train-runs';
    const clearTrainSegments =
      scope === 'all' || scope === 'stages' || scope === 'train-segments' || scope === 'train-runs';
    const resetTimeline = scope === 'all' || scope === 'stages';

    if (!clearResources && !clearActivities && !clearTrainRuns && !clearTrainSegments && !resetTimeline) {
      return;
    }

    this.stageService.applyAdminClear({
      clearResources,
      clearActivities,
      clearTrainRuns,
      clearTrainSegments,
      resetTimeline,
    });
  }
}
