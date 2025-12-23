import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { PlanningRule, PlanningRuleFormat, PlanningRuleKind, StageId } from './planning.types';

type PlanningRuleRow = {
  id: string;
  stage_id: StageId;
  variant_id: string;
  timetable_year_label: string | null;
  kind: PlanningRuleKind;
  executor: string;
  enabled: boolean;
  format: PlanningRuleFormat;
  raw: string;
  params: Record<string, unknown>;
  definition: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class PlanningRuleRepository {
  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async listRules(stageId: StageId, variantId: string): Promise<PlanningRule[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<PlanningRuleRow>(
      `
        SELECT
          id,
          stage_id,
          variant_id,
          timetable_year_label,
          kind,
          executor,
          enabled,
          format,
          raw,
          params,
          definition,
          created_at,
          updated_at
        FROM planning_rule
        WHERE stage_id = $1
          AND variant_id = $2
        ORDER BY id
      `,
      [stageId, variantId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      stageId: row.stage_id,
      variantId: row.variant_id,
      timetableYearLabel: row.timetable_year_label,
      kind: row.kind,
      executor: row.executor,
      enabled: row.enabled,
      format: row.format,
      raw: row.raw,
      params: row.params ?? {},
      definition: row.definition ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async upsertRules(stageId: StageId, variantId: string, rules: PlanningRule[]): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    if (!rules.length) {
      return;
    }
    await this.database.query(
      `
        WITH payload AS (
          SELECT *
          FROM jsonb_to_recordset($3::jsonb)
               AS r(
                 id TEXT,
                 kind TEXT,
                 executor TEXT,
                 enabled BOOLEAN,
                 format TEXT,
                 raw TEXT,
                 params JSONB,
                 definition JSONB,
                 "timetableYearLabel" TEXT
               )
        )
        INSERT INTO planning_rule (
          id,
          stage_id,
          variant_id,
          timetable_year_label,
          kind,
          executor,
          enabled,
          format,
          raw,
          params,
          definition,
          created_at,
          updated_at
        )
        SELECT
          id,
          $1,
          $2,
          NULLIF("timetableYearLabel", ''),
          kind,
          executor,
          COALESCE(enabled, TRUE),
          COALESCE(format, 'yaml'),
          raw,
          COALESCE(params, '{}'::jsonb),
          COALESCE(definition, '{}'::jsonb),
          now(),
          now()
        FROM payload
        ON CONFLICT (id, variant_id, stage_id) DO UPDATE SET
          timetable_year_label = EXCLUDED.timetable_year_label,
          kind = EXCLUDED.kind,
          executor = EXCLUDED.executor,
          enabled = EXCLUDED.enabled,
          format = EXCLUDED.format,
          raw = EXCLUDED.raw,
          params = EXCLUDED.params,
          definition = EXCLUDED.definition,
          updated_at = now()
      `,
      [stageId, variantId, JSON.stringify(rules)],
    );
  }

  async insertDefaults(stageId: StageId, variantId: string, rules: PlanningRule[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    if (!rules.length) {
      return;
    }
    await this.database.query(
      `
        WITH payload AS (
          SELECT *
          FROM jsonb_to_recordset($3::jsonb)
               AS r(
                 id TEXT,
                 kind TEXT,
                 executor TEXT,
                 enabled BOOLEAN,
                 format TEXT,
                 raw TEXT,
                 params JSONB,
                 definition JSONB,
                 "timetableYearLabel" TEXT
               )
        )
        INSERT INTO planning_rule (
          id,
          stage_id,
          variant_id,
          timetable_year_label,
          kind,
          executor,
          enabled,
          format,
          raw,
          params,
          definition
        )
        SELECT
          id,
          $1,
          $2,
          NULLIF("timetableYearLabel", ''),
          kind,
          executor,
          COALESCE(enabled, TRUE),
          COALESCE(format, 'yaml'),
          raw,
          COALESCE(params, '{}'::jsonb),
          COALESCE(definition, '{}'::jsonb)
        FROM payload
        ON CONFLICT (id, variant_id, stage_id) DO NOTHING
      `,
      [stageId, variantId, JSON.stringify(rules)],
    );
  }

  async deleteRules(stageId: StageId, variantId: string, deleteIds: string[]): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    if (!deleteIds.length) {
      return;
    }
    await this.database.query(
      `
        DELETE FROM planning_rule
        WHERE stage_id = $1
          AND variant_id = $2
          AND id = ANY($3::text[])
      `,
      [stageId, variantId, deleteIds],
    );
  }

  async deleteAllRules(stageId: StageId, variantId: string): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.query(
      `
        DELETE FROM planning_rule
        WHERE stage_id = $1
          AND variant_id = $2
      `,
      [stageId, variantId],
    );
  }
}
