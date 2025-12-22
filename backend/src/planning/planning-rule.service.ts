import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { VariantPartitionService } from '../database/variant-partition.service';
import type {
  PlanningRule,
  PlanningRuleKind,
  PlanningRuleFormat,
  StageId,
} from './planning.types';
import { PlanningRuleRepository } from './planning-rule.repository';

export interface DutyAutopilotConfig {
  serviceStartTypeId: string;
  serviceEndTypeId: string;
  breakTypeIds: string[];
  conflictAttributeKey: string;
  conflictCodesAttributeKey: string;
  maxConflictLevel: number;
  maxWorkMinutes: number;
  maxContinuousWorkMinutes: number;
  minBreakMinutes: number;
  maxDutySpanMinutes: number;
  enforceOneDutyPerDay: boolean;
}

@Injectable()
export class PlanningRuleService {
  private readonly logger = new Logger(PlanningRuleService.name);
  private readonly cache = new Map<string, PlanningRule[]>();
  private readonly defaultDutyRules = new Map<string, Omit<PlanningRule, 'stageId' | 'variantId'>>();

  constructor(
    private readonly repository: PlanningRuleRepository,
    private readonly partitions: VariantPartitionService,
  ) {
    this.loadDefaultDutyRules();
  }

  async listRules(stageId: StageId, variantId: string): Promise<PlanningRule[]> {
    const key = `${stageId}:${variantId}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    if (!this.repository.isEnabled) {
      const rules = stageId === 'base' ? this.materializeDefaults(stageId, variantId) : [];
      this.cache.set(key, rules);
      return rules;
    }

    await this.partitions.ensurePlanningPartitions(variantId);
    if (stageId === 'base') {
      await this.repository.insertDefaults(stageId, variantId, this.materializeDefaults(stageId, variantId));
    }

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

    const normalizedUpserts: PlanningRule[] = [];
    const derivedDeleteIds: string[] = [];
    for (const incoming of upserts) {
      const { rule, deleteId } = this.normalizeUpsert(stageId, variantId, incoming);
      normalizedUpserts.push(rule);
      if (deleteId) {
        derivedDeleteIds.push(deleteId);
      }
    }

    if (normalizedUpserts.length) {
      await this.repository.upsertRules(stageId, variantId, normalizedUpserts);
    }

    const allDeleteIds = Array.from(new Set([...deleteIds, ...derivedDeleteIds]));
    if (allDeleteIds.length) {
      await this.repository.deleteRules(stageId, variantId, allDeleteIds);
    }

    this.cache.delete(`${stageId}:${variantId}`);
    return { appliedUpserts: normalizedUpserts.map((r) => r.id), deletedIds: allDeleteIds };
  }

  async getDutyAutopilotConfig(
    stageId: StageId,
    variantId: string,
  ): Promise<DutyAutopilotConfig | null> {
    const rules = await this.listRules(stageId, variantId);
    const generator = rules.find((rule) => rule.executor === 'duty/autopilot' || rule.id === 'duty.generator');
    if (!generator?.enabled) {
      return null;
    }
    if (generator.kind !== 'generator') {
      return null;
    }

    const pickNumber = (ruleId: string, key: string, fallback: number): number => {
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
    const serviceStartTypeId = String(params['serviceStartTypeId'] ?? 'service-start');
    const serviceEndTypeId = String(params['serviceEndTypeId'] ?? 'service-end');
    const breakTypeIdsRaw = params['breakTypeIds'];
    const breakTypeIds = Array.isArray(breakTypeIdsRaw)
      ? breakTypeIdsRaw.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0)
      : ['break'];
    const conflictAttributeKey = String(params['conflictAttributeKey'] ?? 'service_conflict_level');
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

    const enforceOneDutyPerDay = !!rules.find((r) => r.id === 'duty.one_per_day' && r.enabled);

    return {
      serviceStartTypeId,
      serviceEndTypeId,
      breakTypeIds,
      conflictAttributeKey,
      conflictCodesAttributeKey,
      maxConflictLevel: Number.isFinite(maxConflictLevel) ? maxConflictLevel : 2,
      maxWorkMinutes: pickNumber('duty.max_work_minutes', 'maxMinutes', 600),
      maxContinuousWorkMinutes: pickNumber('duty.max_continuous_work_minutes', 'maxMinutes', 300),
      minBreakMinutes: pickNumber('duty.min_break_minutes', 'minMinutes', 30),
      maxDutySpanMinutes: pickNumber('duty.max_duty_span_minutes', 'maxMinutes', 720),
      enforceOneDutyPerDay,
    };
  }

  private loadDefaultDutyRules(): void {
    const dir = this.resolveDutyRulesDir();
    if (!dir) {
      this.logger.warn('Duty rules directory not found; defaults will be empty.');
      return;
    }
    const files = readdirSync(dir)
      .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml') || entry.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
    for (const filename of files) {
      const fullPath = join(dir, filename);
      const raw = readFileSync(fullPath, 'utf-8');
      const format = filename.endsWith('.json') ? 'json' : 'yaml';
      let parsed: any;
      try {
        parsed = format === 'json' ? JSON.parse(raw) : yaml.load(raw);
      } catch (error) {
        this.logger.error(`Failed to parse rule file ${fullPath}`, (error as Error).stack ?? String(error));
        continue;
      }
      const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
      if (!id) {
        this.logger.warn(`Skipping rule file without id: ${fullPath}`);
        continue;
      }
      const kind = (parsed?.kind as PlanningRuleKind) ?? 'constraint';
      const executor = typeof parsed?.executor === 'string' ? parsed.executor : id;
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

  private materializeDefaults(stageId: StageId, variantId: string): PlanningRule[] {
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

    const id = typeof doc.id === 'string' ? doc.id.trim() : (incoming.id ?? '').trim();
    if (!id) {
      throw new BadRequestException('Rule id ist erforderlich.');
    }

    const kindRaw = doc.kind ?? incoming.kind ?? 'constraint';
    const kind = (kindRaw === 'generator' ? 'generator' : 'constraint') as PlanningRuleKind;
    const executor = typeof doc.executor === 'string' && doc.executor.trim().length ? doc.executor.trim() : incoming.executor?.trim() || id;
    const enabled = typeof doc.enabled === 'boolean' ? doc.enabled : incoming.enabled !== false;
    const params = this.ensureRecord(doc.params ?? incoming.params ?? {});

    const timetableYearLabel =
      typeof doc.timetableYearLabel === 'string'
        ? doc.timetableYearLabel.trim() || null
        : incoming.timetableYearLabel ?? null;

    const deleteId = incoming.id && incoming.id.trim().length && incoming.id !== id ? incoming.id : null;

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
        definition: doc as Record<string, unknown>,
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

  private parseRaw(raw: string, format: PlanningRuleFormat): Record<string, unknown> {
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
