import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VariantPartitionService } from '../database/variant-partition.service';
import {
  buildProductiveVariantId,
  deriveTimetableYearLabelFromVariantId,
  isProductiveVariantId,
} from '../shared/variant-scope';
import { TemplateService } from '../template/template.service';
import { DatabaseService } from '../database/database.service';
import {
  PlanningVariantRecord,
  VariantsRepository,
} from './variants.repository';

const SIMULATION_PREFIX = 'SIM-';

@Injectable()
export class TimetableYearService {
  constructor(
    private readonly repository: VariantsRepository,
    private readonly partitions: VariantPartitionService,
    private readonly database: DatabaseService,
    private readonly templateService: TemplateService,
  ) {}

  async listYears(): Promise<string[]> {
    return this.repository.listTimetableYears();
  }

  async listVariants(
    timetableYearLabel?: string,
  ): Promise<PlanningVariantRecord[]> {
    return this.repository.listVariants(timetableYearLabel);
  }

  async createYear(
    label: string,
  ): Promise<{ label: string; variantId: string }> {
    const trimmed = label?.trim();
    if (!trimmed) {
      throw new BadRequestException('label ist erforderlich (z. B. 2025/26).');
    }

    await this.repository.upsertTimetableYear(trimmed);
    const variantId = buildProductiveVariantId(trimmed);
    await this.repository.upsertVariant({
      id: variantId,
      timetableYearLabel: trimmed,
      kind: 'productive',
      label: `Produktiv ${trimmed}`,
      description: null,
    });
    await this.partitions.ensurePlanningPartitions(variantId);
    return { label: trimmed, variantId };
  }

  async createSimulationVariant(payload: {
    timetableYearLabel: string;
    label: string;
    description?: string | null;
  }): Promise<PlanningVariantRecord> {
    const yearLabel = payload.timetableYearLabel?.trim();
    const label = payload.label?.trim();
    if (!yearLabel) {
      throw new BadRequestException(
        'timetableYearLabel ist erforderlich (z. B. 2025/26).',
      );
    }
    if (!label) {
      throw new BadRequestException('label ist erforderlich.');
    }

    // Ensure the year exists (and therefore its productive variant exists).
    await this.createYear(yearLabel);

    const id = this.buildSimulationVariantId(yearLabel, label);
    await this.repository.upsertVariant({
      id,
      timetableYearLabel: yearLabel,
      kind: 'simulation',
      label,
      description: payload.description ?? null,
    });
    await this.partitions.ensurePlanningPartitions(id);
    await this.copyTimetableIfEmpty(buildProductiveVariantId(yearLabel), id);
    const created = await this.repository.getVariantById(id);
    if (!created) {
      throw new Error(`Failed to load created variant ${id}`);
    }
    return created;
  }

  async updateSimulationVariant(
    variantId: string,
    payload: { label?: string; description?: string | null },
  ): Promise<PlanningVariantRecord> {
    const normalizedId = variantId?.trim();
    if (!normalizedId) {
      throw new BadRequestException('variantId ist erforderlich.');
    }

    const existing = await this.repository.getVariantById(normalizedId);
    if (!existing) {
      throw new NotFoundException(`Variante ${normalizedId} existiert nicht.`);
    }
    if (existing.kind !== 'simulation') {
      throw new BadRequestException(
        'Nur Simulationen können hier geändert werden.',
      );
    }

    const nextLabel = payload.label?.trim() ?? existing.label;
    if (!nextLabel.trim()) {
      throw new BadRequestException('label ist erforderlich.');
    }
    await this.repository.upsertVariant({
      id: existing.id,
      timetableYearLabel: existing.timetableYearLabel,
      kind: 'simulation',
      label: nextLabel,
      description: payload.description ?? existing.description ?? null,
    });

    const updated = await this.repository.getVariantById(existing.id);
    if (!updated) {
      throw new Error(`Failed to load updated variant ${existing.id}`);
    }
    return updated;
  }

  async deleteVariant(variantId: string): Promise<void> {
    const normalizedId = variantId?.trim();
    if (!normalizedId) {
      throw new BadRequestException('variantId ist erforderlich.');
    }
    const existing = await this.repository.getVariantById(normalizedId);
    if (!existing) {
      return;
    }
    if (existing.kind === 'productive' || isProductiveVariantId(existing.id)) {
      throw new BadRequestException(
        'Produktive Varianten werden über das Löschen des Fahrplanjahres entfernt.',
      );
    }

    await this.deleteVariantData(existing.id);
    await this.repository.deleteVariant(existing.id);
  }

  async deleteYear(label: string): Promise<void> {
    const trimmed = label?.trim();
    if (!trimmed) {
      throw new BadRequestException('label ist erforderlich (z. B. 2025/26).');
    }

    const variants = await this.repository.listVariants(trimmed);
    const variantIds = variants.map((variant) => variant.id);

    for (const variantId of variantIds) {
      await this.deleteVariantData(variantId);
    }

    await this.repository.deleteTimetableYear(trimmed);
  }

  private async deleteVariantData(variantId: string): Promise<void> {
    await this.partitions.dropPlanningPartitions(variantId);
    if (this.database.enabled) {
      await this.database.query(
        `DELETE FROM activities WHERE variant_id = $1`,
        [variantId],
      );
      await this.database.query(
        `DELETE FROM timetable_revision WHERE variant_id = $1`,
        [variantId],
      );
    }
    await this.deleteTemplatesForVariant(variantId);
  }

  private async deleteTemplatesForVariant(variantId: string): Promise<void> {
    if (!variantId.trim().length) {
      return;
    }
    // Hard-delete all template sets belonging to the variant (drops their backing tables).
    const sets = await this.templateService.listTemplateSets(variantId, true);
    for (const set of sets) {
      await this.templateService.deleteTemplateSet(set.id, variantId);
    }
  }

  resolveYearLabelFromVariantId(variantId: string): string | null {
    const derived = deriveTimetableYearLabelFromVariantId(variantId);
    return derived ?? null;
  }

  private buildSimulationVariantId(
    timetableYearLabel: string,
    label: string,
  ): string {
    const yearLabel = timetableYearLabel.trim();
    const slugBase = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const slug = slugBase.length ? slugBase.slice(0, 24) : 'sim';
    const short = randomUUID().split('-')[0];
    return `${SIMULATION_PREFIX}${yearLabel}-${slug}-${short}`;
  }

  private async copyTimetableIfEmpty(
    sourceVariantId: string,
    targetVariantId: string,
  ): Promise<void> {
    if (!this.database.enabled) {
      return;
    }
    const target = targetVariantId.trim();
    const source = sourceVariantId.trim();
    if (!target || !source) {
      return;
    }
    const existing = await this.database.query<{ id: string }>(
      `SELECT id FROM train_run WHERE variant_id = $1 LIMIT 1`,
      [target],
    );
    if (existing.rows.length) {
      return;
    }

    const stageSegments = await this.database.query<{
      stage_id: string;
      min_start: string | null;
      max_end: string | null;
    }>(
      `
        SELECT stage_id, MIN(start_time) AS min_start, MAX(end_time) AS max_end
        FROM train_segment
        WHERE variant_id = $1
        GROUP BY stage_id
      `,
      [source],
    );

    const stageIds = stageSegments.rows.length
      ? stageSegments.rows.map((row) => row.stage_id)
      : (
          await this.database.query<{ stage_id: string }>(
            `SELECT DISTINCT stage_id FROM train_run WHERE variant_id = $1`,
            [source],
          )
        ).rows.map((row) => row.stage_id);

    if (!stageIds.length) {
      return;
    }

    const now = Date.now();
    const defaultStart = new Date(now).toISOString();
    const defaultEnd = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
    const rangesByStage = new Map<string, { start: string; end: string }>(
      stageSegments.rows.map((row) => [
        row.stage_id,
        {
          start: row.min_start ?? defaultStart,
          end: row.max_end ?? defaultEnd,
        },
      ]),
    );

    for (const stageId of stageIds) {
      const range = rangesByStage.get(stageId) ?? {
        start: defaultStart,
        end: defaultEnd,
      };
      await this.database.query(
        `
          INSERT INTO planning_stage (stage_id, variant_id, timeline_start, timeline_end)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (stage_id, variant_id) DO NOTHING
        `,
        [stageId, target, range.start, range.end],
      );
    }

    await this.database.query(
      `
        INSERT INTO train_run (id, stage_id, variant_id, train_number, timetable_id, attributes)
        SELECT id, stage_id, $2, train_number, timetable_id, attributes
        FROM train_run
        WHERE variant_id = $1
        ON CONFLICT (id, variant_id) DO UPDATE
        SET stage_id = EXCLUDED.stage_id,
            train_number = EXCLUDED.train_number,
            timetable_id = EXCLUDED.timetable_id,
            attributes = EXCLUDED.attributes,
            updated_at = now()
      `,
      [source, target],
    );

    await this.database.query(
      `
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
          stage_id,
          $2,
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
      [source, target],
    );
  }
}
