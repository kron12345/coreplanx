import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { DatabaseService } from '../database/database.service';
import { VariantPartitionService } from '../database/variant-partition.service';
import { deriveTimetableYearLabelFromVariantId } from '../shared/variant-scope';
import type {
  PlanningRule,
  PlanningRuleKind,
  PlanningRuleFormat,
  ResourceKind,
  StageId,
} from './planning.types';
import { PlanningRuleRepository } from './planning-rule.repository';

export interface DutyAutopilotConfig {
  serviceStartTypeId?: string | null;
  serviceEndTypeId?: string | null;
  personnelStartTypeId?: string | null;
  personnelEndTypeId?: string | null;
  vehicleStartTypeId?: string | null;
  vehicleEndTypeId?: string | null;
  rulesetId?: string | null;
  rulesetVersion?: string | null;
  breakTypeIds?: string[] | null;
  shortBreakTypeId?: string | null;
  commuteTypeId?: string | null;
  conflictAttributeKey: string;
  conflictCodesAttributeKey: string;
  maxConflictLevel: number;
  maxWorkMinutes: number;
  maxContinuousWorkMinutes: number;
  minBreakMinutes: number;
  minShortBreakMinutes: number;
  maxDutySpanMinutes: number;
  enforceOneDutyPerDay: boolean;
  azg: {
    enabled: boolean;
    exceedBufferMinutes: number;
    workAvg7d: {
      enabled: boolean;
      windowWorkdays: number;
      maxAverageMinutes: number;
      resourceKinds?: ResourceKind[] | null;
    };
    workAvg365d: {
      enabled: boolean;
      windowDays: number;
      maxAverageMinutes: number;
      resourceKinds?: ResourceKind[] | null;
    };
    dutySpanAvg28d: {
      enabled: boolean;
      windowDays: number;
      maxAverageMinutes: number;
      resourceKinds?: ResourceKind[] | null;
    };
    restMin: {
      enabled: boolean;
      minMinutes: number;
      resourceKinds?: ResourceKind[] | null;
    };
    restAvg28d: {
      enabled: boolean;
      windowDays: number;
      minAverageMinutes: number;
      resourceKinds?: ResourceKind[] | null;
    };
    breakMaxCount: { enabled: boolean; maxCount: number };
    breakForbiddenNight: {
      enabled: boolean;
      startHour: number;
      endHour: number;
    };
    breakStandard: { enabled: boolean; minMinutes: number };
    breakMidpoint: { enabled: boolean; toleranceMinutes: number };
    breakInterruption: {
      enabled: boolean;
      minMinutes: number;
      maxDutyMinutes: number;
      maxWorkMinutes: number;
    };
    nightMaxStreak: {
      enabled: boolean;
      maxConsecutive: number;
      resourceKinds?: ResourceKind[] | null;
    };
    nightMax28d: {
      enabled: boolean;
      windowDays: number;
      maxCount: number;
      resourceKinds?: ResourceKind[] | null;
    };
    restDaysYear: {
      enabled: boolean;
      minRestDays: number;
      minSundayRestDays: number;
      additionalSundayLikeHolidays: string[];
      resourceKinds?: ResourceKind[] | null;
    };
  };
}

@Injectable()
export class PlanningRuleService {
  private readonly logger = new Logger(PlanningRuleService.name);
  private readonly cache = new Map<string, PlanningRule[]>();
  private readonly defaultDutyRules = new Map<
    string,
    Omit<PlanningRule, 'stageId' | 'variantId'>
  >();

  constructor(
    private readonly repository: PlanningRuleRepository,
    private readonly partitions: VariantPartitionService,
    private readonly database: DatabaseService,
  ) {
    this.loadDefaultDutyRules();
  }

  async listRules(
    stageId: StageId,
    variantId: string,
  ): Promise<PlanningRule[]> {
    const key = `${stageId}:${variantId}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    if (!this.repository.isEnabled) {
      const rules = this.materializeDefaults(stageId, variantId);
      this.cache.set(key, rules);
      return rules;
    }

    await this.partitions.ensurePlanningPartitions(variantId);
    await this.ensureStageRow(stageId, variantId);
    await this.repository.insertDefaults(
      stageId,
      variantId,
      this.materializeDefaults(stageId, variantId),
    );

    const rules = await this.repository.listRules(stageId, variantId);
    this.cache.set(key, rules);
    return rules;
  }

  async mutateRules(
    stageId: StageId,
    variantId: string,
    request?: { upserts?: PlanningRule[]; deleteIds?: string[] },
  ): Promise<{ appliedUpserts: string[]; deletedIds: string[] }> {
    const upserts = request?.upserts ?? [];
    const deleteIds = request?.deleteIds ?? [];
    if (!this.repository.isEnabled) {
      throw new Error('Rules mutation requires a database');
    }
    await this.partitions.ensurePlanningPartitions(variantId);
    await this.ensureStageRow(stageId, variantId);

    const normalizedUpserts: PlanningRule[] = [];
    const derivedDeleteIds: string[] = [];
    for (const incoming of upserts) {
      const { rule, deleteId } = this.normalizeUpsert(
        stageId,
        variantId,
        incoming,
      );
      normalizedUpserts.push(rule);
      if (deleteId) {
        derivedDeleteIds.push(deleteId);
      }
    }

    if (normalizedUpserts.length) {
      await this.repository.upsertRules(stageId, variantId, normalizedUpserts);
    }

    const allDeleteIds = Array.from(
      new Set([...deleteIds, ...derivedDeleteIds]),
    );
    if (allDeleteIds.length) {
      await this.repository.deleteRules(stageId, variantId, allDeleteIds);
    }

    this.cache.delete(`${stageId}:${variantId}`);
    return {
      appliedUpserts: normalizedUpserts.map((r) => r.id),
      deletedIds: allDeleteIds,
    };
  }

  async resetRulesToDefaults(
    stageId: StageId,
    variantId: string,
  ): Promise<PlanningRule[]> {
    if (!this.repository.isEnabled) {
      const rules = this.materializeDefaults(stageId, variantId);
      this.cache.set(`${stageId}:${variantId}`, rules);
      return rules;
    }
    await this.partitions.ensurePlanningPartitions(variantId);
    await this.ensureStageRow(stageId, variantId);

    await this.repository.deleteAllRules(stageId, variantId);
    const defaults = this.materializeDefaults(stageId, variantId);
    if (defaults.length) {
      await this.repository.upsertRules(stageId, variantId, defaults);
    }

    this.cache.delete(`${stageId}:${variantId}`);
    return this.listRules(stageId, variantId);
  }

  async getDutyAutopilotConfig(
    stageId: StageId,
    variantId: string,
    options?: { includeDisabled?: boolean },
  ): Promise<DutyAutopilotConfig | null> {
    const rules = await this.listRules(stageId, variantId);
    const generator = rules.find(
      (rule) =>
        rule.executor === 'duty/autopilot' || rule.id === 'duty.generator',
    );
    if (!generator) {
      return null;
    }
    const includeDisabled = options?.includeDisabled ?? false;
    if (!includeDisabled && !generator.enabled) {
      return null;
    }
    if (generator.kind !== 'generator') {
      return null;
    }

    const pickNumber = (
      ruleId: string,
      key: string,
      fallback: number,
    ): number => {
      const rule = rules.find((r) => r.id === ruleId && r.enabled);
      const raw = rule?.params?.[key];
      const parsed =
        typeof raw === 'number'
          ? raw
          : typeof raw === 'string'
            ? Number.parseFloat(raw)
            : Number.NaN;
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const params = generator.params ?? {};
    const readOptionalTypeId = (key: string): string | null => {
      const raw = params[key];
      if (typeof raw !== 'string') {
        return null;
      }
      const trimmed = raw.trim();
      return trimmed.length ? trimmed : null;
    };
    const serviceStartTypeId = readOptionalTypeId('serviceStartTypeId');
    const serviceEndTypeId = readOptionalTypeId('serviceEndTypeId');
    const personnelStartTypeId =
      readOptionalTypeId('personnelStartTypeId') ??
      readOptionalTypeId('personnelServiceStartTypeId');
    const personnelEndTypeId =
      readOptionalTypeId('personnelEndTypeId') ??
      readOptionalTypeId('personnelServiceEndTypeId');
    const vehicleStartTypeId =
      readOptionalTypeId('vehicleStartTypeId') ??
      readOptionalTypeId('vehicleServiceStartTypeId');
    const vehicleEndTypeId =
      readOptionalTypeId('vehicleEndTypeId') ??
      readOptionalTypeId('vehicleServiceEndTypeId');
    const rulesetId = readOptionalTypeId('rulesetId');
    const rulesetVersion = readOptionalTypeId('rulesetVersion');
    const breakTypeIdsRaw = params['breakTypeIds'];
    const breakTypeIds = Array.isArray(breakTypeIdsRaw)
      ? breakTypeIdsRaw
          .map((entry) => String(entry))
          .filter((entry) => entry.trim().length > 0)
      : null;
    const shortBreakTypeId = readOptionalTypeId('shortBreakTypeId');
    const commuteTypeId = readOptionalTypeId('commuteTypeId');
    const conflictAttributeKey = String(
      params['conflictAttributeKey'] ?? 'service_conflict_level',
    );
    const conflictCodesAttributeKey = String(
      params['conflictCodesAttributeKey'] ?? 'service_conflict_codes',
    );
    const maxConflictLevelRaw = params['maxConflictLevel'];
    const maxConflictLevel =
      typeof maxConflictLevelRaw === 'number'
        ? maxConflictLevelRaw
        : typeof maxConflictLevelRaw === 'string'
          ? Number.parseInt(maxConflictLevelRaw, 10)
          : 2;

    const enforceOneDutyPerDay = !!rules.find(
      (r) => r.id === 'duty.one_per_day' && r.enabled,
    );

    const isRuleEnabled = (ruleId: string): boolean =>
      !!rules.find((r) => r.id === ruleId && r.enabled);
    const pickInt = (ruleId: string, key: string, fallback: number): number => {
      const rule = rules.find((r) => r.id === ruleId && r.enabled);
      const raw = rule?.params?.[key];
      const parsed =
        typeof raw === 'number'
          ? Math.trunc(raw)
          : typeof raw === 'string'
            ? Number.parseInt(raw, 10)
            : Number.NaN;
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const pickStringList = (ruleId: string, key: string): string[] => {
      const rule = rules.find((r) => r.id === ruleId && r.enabled);
      const raw = rule?.params?.[key];
      if (Array.isArray(raw)) {
        return raw
          .map((entry) => `${entry ?? ''}`.trim())
          .filter((entry) => entry.length > 0);
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        return trimmed ? [trimmed] : [];
      }
      return [];
    };
    const pickResourceKinds = (ruleId: string): ResourceKind[] | null => {
      const rule = rules.find((r) => r.id === ruleId && r.enabled);
      return this.normalizeResourceKinds(rule?.params?.['resourceKinds']);
    };

    return {
      serviceStartTypeId,
      serviceEndTypeId,
      personnelStartTypeId,
      personnelEndTypeId,
      vehicleStartTypeId,
      vehicleEndTypeId,
      rulesetId,
      rulesetVersion,
      breakTypeIds,
      shortBreakTypeId,
      commuteTypeId,
      conflictAttributeKey,
      conflictCodesAttributeKey,
      maxConflictLevel: Number.isFinite(maxConflictLevel)
        ? maxConflictLevel
        : 2,
      maxWorkMinutes: pickNumber('duty.max_work_minutes', 'maxMinutes', 600),
      maxContinuousWorkMinutes: pickNumber(
        'duty.max_continuous_work_minutes',
        'maxMinutes',
        300,
      ),
      minBreakMinutes: pickNumber('duty.min_break_minutes', 'minMinutes', 30),
      minShortBreakMinutes: pickNumber(
        'duty.min_short_break_minutes',
        'minMinutes',
        20,
      ),
      maxDutySpanMinutes: pickNumber(
        'duty.max_duty_span_minutes',
        'maxMinutes',
        720,
      ),
      enforceOneDutyPerDay,
      azg: {
        enabled: rules.some((r) => r.id.startsWith('azg.') && r.enabled),
        exceedBufferMinutes: pickInt(
          'azg.exceed_buffer_minutes',
          'bufferMinutes',
          10,
        ),
        workAvg7d: {
          enabled: isRuleEnabled('azg.work_avg_7d'),
          windowWorkdays: pickInt('azg.work_avg_7d', 'windowWorkdays', 7),
          maxAverageMinutes: pickInt(
            'azg.work_avg_7d',
            'maxAverageMinutes',
            540,
          ),
          resourceKinds: pickResourceKinds('azg.work_avg_7d'),
        },
        workAvg365d: {
          enabled: isRuleEnabled('azg.work_avg_365d'),
          windowDays: pickInt('azg.work_avg_365d', 'windowDays', 365),
          maxAverageMinutes: pickInt(
            'azg.work_avg_365d',
            'maxAverageMinutes',
            420,
          ),
          resourceKinds: pickResourceKinds('azg.work_avg_365d'),
        },
        dutySpanAvg28d: {
          enabled: isRuleEnabled('azg.duty_span_avg_28d'),
          windowDays: pickInt('azg.duty_span_avg_28d', 'windowDays', 28),
          maxAverageMinutes: pickInt(
            'azg.duty_span_avg_28d',
            'maxAverageMinutes',
            720,
          ),
          resourceKinds: pickResourceKinds('azg.duty_span_avg_28d'),
        },
        restMin: {
          enabled: isRuleEnabled('azg.rest_min'),
          minMinutes: pickInt('azg.rest_min', 'minMinutes', 660),
          resourceKinds: pickResourceKinds('azg.rest_min'),
        },
        restAvg28d: {
          enabled: isRuleEnabled('azg.rest_avg_28d'),
          windowDays: pickInt('azg.rest_avg_28d', 'windowDays', 28),
          minAverageMinutes: pickInt(
            'azg.rest_avg_28d',
            'minAverageMinutes',
            720,
          ),
          resourceKinds: pickResourceKinds('azg.rest_avg_28d'),
        },
        breakMaxCount: {
          enabled: isRuleEnabled('azg.break_max_count'),
          maxCount: pickInt('azg.break_max_count', 'maxCount', 3),
        },
        breakForbiddenNight: {
          enabled: isRuleEnabled('azg.break_forbidden_night'),
          startHour: pickInt('azg.break_forbidden_night', 'startHour', 23),
          endHour: pickInt('azg.break_forbidden_night', 'endHour', 5),
        },
        breakStandard: {
          enabled: isRuleEnabled('azg.break_standard_minutes'),
          minMinutes: pickInt('azg.break_standard_minutes', 'minMinutes', 60),
        },
        breakMidpoint: {
          enabled: isRuleEnabled('azg.break_midpoint'),
          toleranceMinutes: pickInt(
            'azg.break_midpoint',
            'toleranceMinutes',
            60,
          ),
        },
        breakInterruption: {
          enabled: isRuleEnabled('azg.break_interruption'),
          minMinutes: pickInt('azg.break_interruption', 'minMinutes', 20),
          maxDutyMinutes: pickInt(
            'azg.break_interruption',
            'maxDutyMinutes',
            540,
          ),
          maxWorkMinutes: pickInt(
            'azg.break_interruption',
            'maxWorkMinutes',
            360,
          ),
        },
        nightMaxStreak: {
          enabled: isRuleEnabled('azg.night_max_streak'),
          maxConsecutive: pickInt('azg.night_max_streak', 'maxConsecutive', 7),
          resourceKinds: pickResourceKinds('azg.night_max_streak'),
        },
        nightMax28d: {
          enabled: isRuleEnabled('azg.night_max_28d'),
          windowDays: pickInt('azg.night_max_28d', 'windowDays', 28),
          maxCount: pickInt('azg.night_max_28d', 'maxCount', 14),
          resourceKinds: pickResourceKinds('azg.night_max_28d'),
        },
        restDaysYear: {
          enabled: isRuleEnabled('azg.rest_days_year'),
          minRestDays: pickInt('azg.rest_days_year', 'minRestDays', 62),
          minSundayRestDays: pickInt(
            'azg.rest_days_year',
            'minSundayRestDays',
            20,
          ),
          additionalSundayLikeHolidays: pickStringList(
            'azg.rest_days_year',
            'additionalSundayLikeHolidays',
          ),
          resourceKinds: pickResourceKinds('azg.rest_days_year'),
        },
      },
    };
  }

  private loadDefaultDutyRules(): void {
    const dir = this.resolveDutyRulesDir();
    if (!dir) {
      this.logger.warn(
        'Duty rules directory not found; defaults will be empty.',
      );
      return;
    }
    const files = readdirSync(dir)
      .filter(
        (entry) =>
          entry.endsWith('.yaml') ||
          entry.endsWith('.yml') ||
          entry.endsWith('.json'),
      )
      .sort((a, b) => a.localeCompare(b));
    for (const filename of files) {
      const fullPath = join(dir, filename);
      const raw = readFileSync(fullPath, 'utf-8');
      const format = filename.endsWith('.json') ? 'json' : 'yaml';
      let parsed: any;
      try {
        parsed = format === 'json' ? JSON.parse(raw) : yaml.load(raw);
      } catch (error) {
        this.logger.error(
          `Failed to parse rule file ${fullPath}`,
          (error as Error).stack ?? String(error),
        );
        continue;
      }
      const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
      if (!id) {
        this.logger.warn(`Skipping rule file without id: ${fullPath}`);
        continue;
      }
      const kind = (parsed?.kind as PlanningRuleKind) ?? 'constraint';
      const executor =
        typeof parsed?.executor === 'string' ? parsed.executor : id;
      const enabled = parsed?.enabled !== false;
      const params = (parsed?.params ?? {}) as Record<string, unknown>;

      this.defaultDutyRules.set(id, {
        id,
        timetableYearLabel: null,
        kind,
        executor,
        enabled,
        format,
        raw,
        params,
        definition: (parsed ?? {}) as Record<string, unknown>,
      });
    }
  }

  private materializeDefaults(
    stageId: StageId,
    variantId: string,
  ): PlanningRule[] {
    return Array.from(this.defaultDutyRules.values()).map((rule) => ({
      ...rule,
      stageId,
      variantId,
    }));
  }

  private normalizeUpsert(
    stageId: StageId,
    variantId: string,
    incoming: PlanningRule,
  ): { rule: PlanningRule; deleteId: string | null } {
    const raw = typeof incoming.raw === 'string' ? incoming.raw : '';
    const format = this.normalizeFormat(incoming.format, raw);
    const parsed = raw.trim().length ? this.parseRaw(raw, format) : null;
    const doc = parsed ?? this.buildDocFromFields(incoming);

    const id =
      typeof doc.id === 'string' ? doc.id.trim() : (incoming.id ?? '').trim();
    if (!id) {
      throw new BadRequestException('Rule id ist erforderlich.');
    }

    const kindRaw = doc.kind ?? incoming.kind ?? 'constraint';
    const kind = (
      kindRaw === 'generator' ? 'generator' : 'constraint'
    ) as PlanningRuleKind;
    const executor =
      typeof doc.executor === 'string' && doc.executor.trim().length
        ? doc.executor.trim()
        : incoming.executor?.trim() || id;
    const enabled =
      typeof doc.enabled === 'boolean'
        ? doc.enabled
        : incoming.enabled !== false;
    const params = this.ensureRecord(doc.params ?? incoming.params ?? {});

    const timetableYearLabel =
      typeof doc.timetableYearLabel === 'string'
        ? doc.timetableYearLabel.trim() || null
        : (incoming.timetableYearLabel ?? null);

    const deleteId =
      incoming.id && incoming.id.trim().length && incoming.id !== id
        ? incoming.id
        : null;

    return {
      rule: {
        id,
        stageId,
        variantId,
        timetableYearLabel,
        kind,
        executor,
        enabled,
        format,
        raw,
        params,
        definition: doc,
      },
      deleteId,
    };
  }

  private normalizeFormat(value: unknown, raw: string): PlanningRuleFormat {
    if (value === 'json' || value === 'yaml') {
      return value;
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return 'json';
    }
    return 'yaml';
  }

  private parseRaw(
    raw: string,
    format: PlanningRuleFormat,
  ): Record<string, unknown> {
    try {
      const parsed = format === 'json' ? JSON.parse(raw) : yaml.load(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Rule root must be an object');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw new BadRequestException(
        `Rule konnte nicht als ${format.toUpperCase()} geparst werden: ${(error as Error).message}`,
      );
    }
  }

  private buildDocFromFields(rule: PlanningRule): Record<string, unknown> {
    return {
      id: rule.id,
      kind: rule.kind,
      executor: rule.executor,
      enabled: rule.enabled,
      params: rule.params ?? {},
      timetableYearLabel: rule.timetableYearLabel ?? null,
    };
  }

  private ensureRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private normalizeResourceKinds(value: unknown): ResourceKind[] | null {
    const entries: string[] = [];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          if (trimmed) {
            entries.push(trimmed);
          }
        }
      }
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        trimmed.split(',').forEach((part) => {
          const normalized = part.trim();
          if (normalized) {
            entries.push(normalized);
          }
        });
      }
    }
    if (!entries.length) {
      return null;
    }
    const allowed = new Set<ResourceKind>([
      'personnel',
      'vehicle',
      'personnel-service',
      'vehicle-service',
    ]);
    const filtered = entries.filter((entry) =>
      allowed.has(entry as ResourceKind),
    ) as ResourceKind[];
    if (!filtered.length) {
      return null;
    }
    return Array.from(new Set(filtered));
  }

  private async ensureStageRow(stageId: StageId, variantId: string): Promise<void> {
    if (!this.database.enabled) {
      return;
    }
    const normalizedVariant = variantId.trim();
    if (!normalizedVariant) {
      return;
    }
    const exists = await this.database.query<{ id: string }>(
      `
        SELECT stage_id as id
        FROM planning_stage
        WHERE stage_id = $1 AND variant_id = $2
        LIMIT 1
      `,
      [stageId, normalizedVariant],
    );
    if (exists.rows.length) {
      return;
    }

    const now = new Date();
    const timelineStart = now.toISOString();
    const timelineEnd = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
    const timetableYearLabel = deriveTimetableYearLabelFromVariantId(normalizedVariant);
    await this.database.query(
      `
        INSERT INTO planning_stage (stage_id, variant_id, timetable_year_label, version, timeline_start, timeline_end)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (stage_id, variant_id) DO NOTHING
      `,
      [
        stageId,
        normalizedVariant,
        timetableYearLabel ?? null,
        timelineStart,
        timelineStart,
        timelineEnd,
      ],
    );
  }

  private resolveDutyRulesDir(): string | null {
    const candidates = [
      join(process.cwd(), 'rules', 'duty'),
      join(process.cwd(), 'backend', 'rules', 'duty'),
      join(__dirname, '..', '..', 'rules', 'duty'),
    ];
    for (const candidate of candidates) {
      try {
        const entries = readdirSync(candidate);
        if (entries.length >= 0) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }
}
