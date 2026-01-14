import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  Activity,
  PlanningStageSnapshot,
  StageId,
} from './planning.types';
import { PlanningStageService } from './planning-stage.service';
import { PlanningRuleService } from './planning-rule.service';
import { PlanningRulesetService } from './planning-ruleset.service';
import {
  PlanningCandidateBuilder,
  PlanningCandidateBuildResult,
} from './planning-candidate-builder.service';
import type { RulesetIR } from './planning-ruleset.types';
import {
  PlanningSolverService,
  PlanningSolverResult,
} from './planning-solver.service';
import { TemplateService } from '../template/template.service';
import type { ActivityDto } from '../timeline/timeline.types';
import type { TemplatePeriod } from '../template/template.types';
import { DebugStreamService } from '../debug/debug-stream.service';

const DAY_MS = 24 * 3600_000;
const TEMPLATE_PATTERN_KEY = 'template_pattern';

type TemplatePattern = {
  sliceId?: string | null;
  weekday?: number | null;
  startOffsetDays?: number | null;
  startTimeMs?: number | null;
  endOffsetDays?: number | null;
  endTimeMs?: number | null;
};

export interface RulesetSelectionInput {
  rulesetId?: string;
  rulesetVersion?: string;
  templateId?: string;
  timelineRange?: { start: string; end: string };
  activityIds?: string[];
}

export interface PlanningSolveResult extends PlanningSolverResult {
  rulesetId: string;
  rulesetVersion: string;
  stats: PlanningCandidateBuildResult['stats'];
}

@Injectable()
export class PlanningOptimizationService {
  private readonly logger = new Logger(PlanningOptimizationService.name);

  constructor(
    private readonly stageService: PlanningStageService,
    private readonly rules: PlanningRuleService,
    private readonly rulesets: PlanningRulesetService,
    private readonly candidates: PlanningCandidateBuilder,
    private readonly solver: PlanningSolverService,
    private readonly templates: TemplateService,
    private readonly debugStream: DebugStreamService,
  ) {}

  async buildCandidates(
    stageId: StageId,
    variantId: string,
    timetableYearLabel?: string | null,
    selection?: RulesetSelectionInput,
    requestId?: string,
  ): Promise<PlanningCandidateBuildResult> {
    this.debugStream.log('info', 'solver', 'Kandidatenaufbau gestartet', {
      stageId,
      variantId,
      requestId,
      ...this.describeSelection(selection),
    });
    const snapshot = await this.buildSnapshotForOptimization(
      stageId,
      variantId,
      timetableYearLabel,
      selection,
    );
    const resolved = await this.resolveRulesetSelection(
      stageId,
      variantId,
      selection,
      true,
    );
    if (!resolved.ruleset) {
      throw new BadRequestException('Ruleset konnte nicht aufgeloest werden.');
    }
    const result = this.candidates.buildCandidates(snapshot, resolved.ruleset);
    this.debugStream.log('info', 'solver', 'Kandidatenaufbau abgeschlossen', {
      stageId,
      variantId,
      requestId,
      rulesetId: result.rulesetId,
      rulesetVersion: result.rulesetVersion,
      stats: result.stats,
    });
    return result;
  }

  async solve(
    stageId: StageId,
    variantId: string,
    timetableYearLabel?: string | null,
    selection?: RulesetSelectionInput,
    requestId?: string,
  ): Promise<PlanningSolveResult> {
    this.debugStream.log('info', 'solver', 'Solver gestartet', {
      stageId,
      variantId,
      requestId,
      ...this.describeSelection(selection),
    });
    const snapshot = await this.buildSnapshotForOptimization(
      stageId,
      variantId,
      timetableYearLabel,
      selection,
    );
    const resolved = await this.resolveRulesetSelection(
      stageId,
      variantId,
      selection,
      true,
    );
    if (!resolved.ruleset) {
      throw new BadRequestException('Ruleset konnte nicht aufgeloest werden.');
    }
    const candidateResult = this.candidates.buildCandidates(
      snapshot,
      resolved.ruleset,
    );
    const solverResult = await this.solver.solve(
      snapshot,
      resolved.ruleset,
      candidateResult,
    );
    this.debugStream.log('info', 'solver', 'Solver abgeschlossen', {
      stageId,
      variantId,
      requestId,
      rulesetId: candidateResult.rulesetId,
      rulesetVersion: candidateResult.rulesetVersion,
      stats: candidateResult.stats,
      upsertCount: solverResult.upserts.length,
      deleteCount: solverResult.deletedIds.length,
      selectedCandidates: solverResult.candidatesUsed.length,
    });
    return {
      ...solverResult,
      rulesetId: candidateResult.rulesetId,
      rulesetVersion: candidateResult.rulesetVersion,
      stats: candidateResult.stats,
    };
  }

  private describeSelection(
    selection?: RulesetSelectionInput,
  ): Record<string, unknown> {
    if (!selection) {
      return {};
    }
    const activityIds =
      selection.activityIds?.filter((id) => id.trim().length > 0) ?? [];
    return {
      rulesetId: selection.rulesetId ?? null,
      rulesetVersion: selection.rulesetVersion ?? null,
      templateId: selection.templateId ?? null,
      activityCount: activityIds.length,
      activityIds: activityIds.length <= 20 ? activityIds : undefined,
      timelineRange: selection.timelineRange ?? null,
    };
  }

  private async resolveRulesetSelection(
    stageId: StageId,
    variantId: string,
    selection: RulesetSelectionInput | undefined,
    required: boolean,
  ): Promise<{
    ruleset?: RulesetIR;
    rulesetId?: string;
    rulesetVersion?: string;
  }> {
    const trimmed = (value?: string | null) =>
      typeof value === 'string' ? value.trim() : '';
    const config = await this.rules.getDutyAutopilotConfig(stageId, variantId, {
      includeDisabled: true,
    });
    const preferredId = trimmed(selection?.rulesetId);
    const preferredVersion = trimmed(selection?.rulesetVersion);
    const configId = trimmed(config?.rulesetId);
    const configVersion = trimmed(config?.rulesetVersion);

    let rulesetId = preferredId || configId;
    if (!rulesetId) {
      const available = this.safeListRulesets();
      if (!available.length) {
        if (required) {
          throw new BadRequestException('Keine Rulesets vorhanden.');
        }
        return {};
      }
      rulesetId = available.includes('coreplanx') ? 'coreplanx' : available[0];
    }

    let rulesetVersion = preferredVersion || configVersion;
    const availableVersions = this.safeListVersions(rulesetId);
    if (!availableVersions.length) {
      if (required) {
        throw new BadRequestException(
          `Ruleset ${rulesetId} hat keine Versionen.`,
        );
      }
      return { rulesetId };
    }
    if (!rulesetVersion) {
      rulesetVersion = availableVersions[availableVersions.length - 1];
    } else if (!availableVersions.includes(rulesetVersion)) {
      if (required) {
        throw new BadRequestException(
          `Ruleset ${rulesetId} hat keine Version ${rulesetVersion}. Verfuegbar: ${availableVersions.join(', ')}`,
        );
      }
      rulesetVersion = availableVersions[availableVersions.length - 1];
    }

    try {
      const ruleset = this.rulesets.getCompiledRuleset(
        rulesetId,
        rulesetVersion,
      );
      return { ruleset, rulesetId, rulesetVersion };
    } catch (error) {
      this.logger.warn(
        `Ruleset ${rulesetId}/${rulesetVersion} konnte nicht geladen werden: ${(error as Error).message ?? String(error)}`,
      );
      if (required) {
        throw new BadRequestException(
          `Ruleset ${rulesetId}/${rulesetVersion} konnte nicht geladen werden.`,
        );
      }
      return { rulesetId, rulesetVersion };
    }
  }

  private safeListRulesets(): string[] {
    try {
      return this.rulesets.listRulesets();
    } catch (error) {
      this.logger.warn(
        `Ruleset-Liste konnte nicht geladen werden: ${(error as Error).message ?? String(error)}`,
      );
      return [];
    }
  }

  private safeListVersions(rulesetId: string): string[] {
    try {
      return this.rulesets.listVersions(rulesetId);
    } catch (error) {
      this.logger.warn(
        `Ruleset-Versionen fuer ${rulesetId} konnten nicht geladen werden: ${(error as Error).message ?? String(error)}`,
      );
      return [];
    }
  }

  private cloneActivities(activities: Activity[]): Activity[] {
    return activities.map(
      (activity) => JSON.parse(JSON.stringify(activity)) as Activity,
    );
  }

  private async buildSnapshotForOptimization(
    stageId: StageId,
    variantId: string,
    timetableYearLabel?: string | null,
    selection?: RulesetSelectionInput,
  ): Promise<PlanningStageSnapshot> {
    const snapshot = await this.stageService.getStageSnapshot(
      stageId,
      variantId,
      timetableYearLabel,
    );
    if (stageId !== 'base') {
      return this.applyActivitySelection(snapshot, selection);
    }
    const templateId = selection?.templateId?.trim();
    const range = selection?.timelineRange;
    if (!templateId || !range?.start || !range?.end) {
      return this.applyActivitySelection(snapshot, selection);
    }
    const viewStart = new Date(range.start);
    const viewEnd = new Date(range.end);
    if (
      !Number.isFinite(viewStart.getTime()) ||
      !Number.isFinite(viewEnd.getTime())
    ) {
      return this.applyActivitySelection(snapshot, selection);
    }

    let templateSet;
    try {
      templateSet = await this.templates.getTemplateSet(templateId, variantId);
    } catch (error) {
      this.logger.warn(
        `Template ${templateId} konnte nicht geladen werden: ${(error as Error).message ?? String(error)}`,
      );
      return snapshot;
    }

    const effectiveYearLabel =
      timetableYearLabel?.trim() ||
      templateSet.timetableYearLabel?.trim() ||
      null;
    const periods = templateSet.periods?.length
      ? templateSet.periods
      : this.defaultPeriodsFromYear(effectiveYearLabel);
    const defaultPeriodEnd =
      this.resolveDefaultPeriodEnd(periods, effectiveYearLabel) ?? viewEnd;
    const specialDays = new Set<string>(
      (templateSet.specialDays ?? [])
        .map((day) => day.trim())
        .filter((day) => day.length > 0),
    );

    let templateActivities: Activity[] = [];
    try {
      const timeline = await this.templates.getTemplateTimeline(
        templateId,
        range.start,
        range.end,
        'activity',
        'base',
        variantId,
      );
      templateActivities = this.mapTimelineActivities(
        timeline.activities ?? [],
      );
    } catch (error) {
      this.logger.warn(
        `Template-Timeline konnte nicht geladen werden: ${(error as Error).message ?? String(error)}`,
      );
    }

    const reflected = this.reflectBaseActivities({
      activities: templateActivities,
      periods,
      specialDays,
      viewStart,
      viewEnd,
      defaultPeriodEnd,
    });
    const stageActivities = this.filterActivitiesByRange(
      snapshot.activities,
      viewStart,
      viewEnd,
    );
    const merged = this.mergeActivitiesById(reflected, stageActivities);

    const mergedSnapshot = {
      ...snapshot,
      activities: merged,
    };
    return this.applyActivitySelection(mergedSnapshot, selection);
  }

  private applyActivitySelection(
    snapshot: PlanningStageSnapshot,
    selection?: RulesetSelectionInput,
  ): PlanningStageSnapshot {
    const rawIds = selection?.activityIds ?? [];
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return snapshot;
    }
    const ids = new Set(
      rawIds
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0),
    );
    if (!ids.size) {
      return snapshot;
    }
    const filtered = snapshot.activities.filter((activity) =>
      ids.has(activity.id),
    );
    const expanded = this.extendSelectionWithServiceContext(
      snapshot.stageId,
      snapshot.activities,
      filtered,
    );
    return { ...snapshot, activities: expanded };
  }

  private extendSelectionWithServiceContext(
    stageId: StageId,
    allActivities: Activity[],
    selected: Activity[],
  ): Activity[] {
    if (!selected.length) {
      return selected;
    }
    const serviceIds = this.collectServiceIds(stageId, selected);
    if (serviceIds.size === 0) {
      return selected;
    }
    const expanded = new Map<string, Activity>();
    selected.forEach((activity) => expanded.set(activity.id, activity));
    allActivities.forEach((activity) => {
      const ids = this.collectServiceIds(stageId, [activity]);
      if (ids.size === 0 || !Array.from(ids).some((id) => serviceIds.has(id))) {
        return;
      }
      expanded.set(activity.id, activity);
    });
    return Array.from(expanded.values());
  }

  private collectServiceIds(
    stageId: StageId,
    activities: Activity[],
  ): Set<string> {
    const serviceIds = new Set<string>();
    activities.forEach((activity) => {
      const local = new Set<string>();
      const addServiceId = (value: unknown) => {
        const id = typeof value === 'string' ? value.trim() : '';
        if (id) {
          local.add(id);
        }
      };

      addServiceId(activity.serviceId);
      const attrs = activity.attributes as Record<string, unknown> | undefined;
      const map = attrs?.['service_by_owner'];
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        Object.values(map as Record<string, any>).forEach((entry) => {
          addServiceId(entry?.serviceId);
        });
      }

      if (local.size === 0) {
        const start = Date.parse(activity.start);
        if (Number.isFinite(start)) {
          const dayKey = new Date(start).toISOString().slice(0, 10);
          (activity.participants ?? []).forEach((participant) => {
            const ownerId = `${participant?.resourceId ?? ''}`.trim();
            if (!ownerId) {
              return;
            }
            local.add(`svc:${stageId}:${ownerId}:${dayKey}`);
          });
        }
      }

      local.forEach((id) => serviceIds.add(id));
    });
    return serviceIds;
  }

  private isBreakActivity(activity: Activity): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === 'object') {
      if (
        this.toBool(attrs['is_break']) ||
        this.toBool(attrs['is_short_break'])
      ) {
        return true;
      }
    }
    return false;
  }

  private toBool(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value.trim().toLowerCase() === 'true';
    }
    return false;
  }

  private mapTimelineActivities(entries: ActivityDto[]): Activity[] {
    return entries.map((entry) => ({
      id: entry.id,
      title: entry.label?.trim().length
        ? entry.label
        : (entry.type ?? entry.id),
      start: entry.start,
      end: entry.end ?? null,
      type: entry.type ?? undefined,
      from: entry.from ?? undefined,
      to: entry.to ?? undefined,
      remark: entry.remark ?? undefined,
      serviceId: entry.serviceId ?? undefined,
      serviceRole: entry.serviceRole ?? undefined,
      attributes: entry.attributes ?? undefined,
      participants: (entry.resourceAssignments ?? []).map((assignment) => ({
        resourceId: assignment.resourceId,
        kind: assignment.resourceType,
        role: assignment.role ?? undefined,
      })),
    }));
  }

  private reflectBaseActivities(options: {
    activities: Activity[];
    periods: TemplatePeriod[];
    specialDays: ReadonlySet<string>;
    viewStart: Date;
    viewEnd: Date;
    defaultPeriodEnd: Date | null;
  }): Activity[] {
    const {
      activities,
      periods,
      specialDays,
      viewStart,
      viewEnd,
      defaultPeriodEnd,
    } = options;
    if (!activities.length || !periods.length || !defaultPeriodEnd) {
      return activities;
    }

    const reflected: Activity[] = [];
    const uniqueIds = new Set<string>();

    periods.forEach((period) => {
      const periodStart = new Date(period.validFrom);
      const periodEnd = period.validTo
        ? new Date(period.validTo)
        : defaultPeriodEnd;
      if (
        !Number.isFinite(periodStart.getTime()) ||
        !Number.isFinite(periodEnd.getTime())
      ) {
        return;
      }
      if (periodEnd < periodStart) {
        return;
      }
      const windowStart = viewStart > periodStart ? viewStart : periodStart;
      const windowEnd = viewEnd < periodEnd ? viewEnd : periodEnd;
      if (windowEnd < windowStart) {
        return;
      }

      activities.forEach((activity) => {
        const pattern = this.readTemplatePattern(activity);
        if (pattern.sliceId && pattern.sliceId !== period.id) {
          return;
        }

        const first = this.alignToWeekday(windowStart, pattern.weekday);
        if (!first || first > windowEnd) {
          return;
        }

        for (
          let cursor = new Date(first.getTime());
          cursor <= windowEnd;
          cursor.setUTCDate(cursor.getUTCDate() + 7)
        ) {
          const iso = cursor.toISOString().slice(0, 10);
          if (specialDays.has(iso)) {
            continue;
          }
          const baseDayMs = Date.UTC(
            cursor.getUTCFullYear(),
            cursor.getUTCMonth(),
            cursor.getUTCDate(),
          );
          const newStart = new Date(
            baseDayMs + pattern.startOffsetDays * DAY_MS + pattern.startTimeMs,
          );
          const newEnd =
            pattern.endOffsetDays !== null && pattern.endTimeMs !== null
              ? new Date(
                  baseDayMs +
                    pattern.endOffsetDays * DAY_MS +
                    pattern.endTimeMs,
                )
              : null;
          const id = `${activity.id}@${iso}`;
          if (uniqueIds.has(id)) {
            continue;
          }
          uniqueIds.add(id);
          reflected.push({
            ...activity,
            id,
            start: newStart.toISOString(),
            end: newEnd ? newEnd.toISOString() : null,
            serviceId:
              this.rewriteServiceIdForIso(activity.serviceId ?? null, iso) ??
              activity.serviceId ??
              null,
          });
        }
      });
    });

    return reflected;
  }

  private readTemplatePattern(activity: Activity): {
    sliceId: string | null;
    weekday: number;
    startOffsetDays: number;
    startTimeMs: number;
    endOffsetDays: number | null;
    endTimeMs: number | null;
  } {
    const parsedStartMs = Date.parse(activity.start);
    const startDate = Number.isFinite(parsedStartMs)
      ? new Date(parsedStartMs)
      : null;
    const fallbackWeekday = startDate ? startDate.getUTCDay() : 0;
    const fallbackStartTimeMs = startDate
      ? startDate.getUTCHours() * 3600_000 +
        startDate.getUTCMinutes() * 60_000 +
        startDate.getUTCSeconds() * 1000 +
        startDate.getUTCMilliseconds()
      : 0;

    const serviceMidnightMs = startDate
      ? Date.UTC(
          startDate.getUTCFullYear(),
          startDate.getUTCMonth(),
          startDate.getUTCDate(),
        )
      : NaN;
    const parsedEndMs = activity.end ? Date.parse(activity.end) : NaN;
    const fallbackEndDiff =
      activity.end &&
      Number.isFinite(parsedEndMs) &&
      Number.isFinite(serviceMidnightMs)
        ? parsedEndMs - serviceMidnightMs
        : null;
    let fallbackEndOffsetDays: number | null = null;
    let fallbackEndTimeMs: number | null = null;
    if (fallbackEndDiff !== null) {
      fallbackEndOffsetDays = Math.floor(fallbackEndDiff / DAY_MS);
      fallbackEndTimeMs = fallbackEndDiff - fallbackEndOffsetDays * DAY_MS;
    }

    const attrs = (activity.attributes ?? {}) as Record<string, unknown>;
    const raw = attrs[TEMPLATE_PATTERN_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        sliceId: null,
        weekday: fallbackWeekday,
        startOffsetDays: 0,
        startTimeMs: fallbackStartTimeMs,
        endOffsetDays: fallbackEndOffsetDays,
        endTimeMs: fallbackEndTimeMs,
      };
    }

    const pattern = raw as TemplatePattern;
    const sliceId =
      typeof pattern.sliceId === 'string' && pattern.sliceId.trim().length
        ? pattern.sliceId.trim()
        : null;
    const weekday =
      typeof pattern.weekday === 'number' &&
      Number.isInteger(pattern.weekday) &&
      pattern.weekday >= 0 &&
      pattern.weekday <= 6
        ? pattern.weekday
        : fallbackWeekday;
    const startOffsetDays =
      typeof pattern.startOffsetDays === 'number' &&
      Number.isInteger(pattern.startOffsetDays)
        ? pattern.startOffsetDays
        : 0;
    const startTimeMs =
      typeof pattern.startTimeMs === 'number' &&
      Number.isFinite(pattern.startTimeMs)
        ? pattern.startTimeMs
        : fallbackStartTimeMs;
    const endOffsetDays =
      typeof pattern.endOffsetDays === 'number' &&
      Number.isInteger(pattern.endOffsetDays)
        ? pattern.endOffsetDays
        : fallbackEndOffsetDays;
    const endTimeMs =
      typeof pattern.endTimeMs === 'number' &&
      Number.isFinite(pattern.endTimeMs)
        ? pattern.endTimeMs
        : fallbackEndTimeMs;

    return {
      sliceId,
      weekday,
      startOffsetDays,
      startTimeMs,
      endOffsetDays,
      endTimeMs,
    };
  }

  private rewriteServiceIdForIso(
    serviceId: string | null,
    iso: string,
  ): string | null {
    const trimmed = (serviceId ?? '').toString().trim();
    if (!trimmed) {
      return null;
    }
    if (!trimmed.startsWith('svc:')) {
      return trimmed;
    }
    const parts = trimmed.split(':');
    if (parts.length < 4) {
      return trimmed;
    }
    const stageId = parts[1] ?? '';
    const ownerId = parts[2] ?? '';
    if (!stageId || !ownerId) {
      return trimmed;
    }
    return `svc:${stageId}:${ownerId}:${iso}`;
  }

  private alignToWeekday(date: Date, weekday: number): Date | null {
    if (!Number.isFinite(date.getTime())) {
      return null;
    }
    const result = new Date(date.getTime());
    const diff = (weekday - result.getUTCDay() + 7) % 7;
    result.setUTCDate(result.getUTCDate() + diff);
    return result;
  }

  private resolveDefaultPeriodEnd(
    periods: TemplatePeriod[],
    timetableYearLabel: string | null,
  ): Date | null {
    const explicitEnds = periods
      .map((period) => period.validTo)
      .filter(
        (val): val is string =>
          typeof val === 'string' && val.trim().length > 0,
      )
      .map((iso) => new Date(iso))
      .filter((date) => Number.isFinite(date.getTime()))
      .map((date) => date.getTime());
    if (explicitEnds.length) {
      return new Date(Math.max(...explicitEnds));
    }
    if (!timetableYearLabel) {
      return null;
    }
    return this.computeYearBounds(timetableYearLabel).end;
  }

  private defaultPeriodsFromYear(
    timetableYearLabel: string | null,
  ): TemplatePeriod[] {
    if (!timetableYearLabel) {
      return [];
    }
    const bounds = this.computeYearBounds(timetableYearLabel);
    return [
      {
        id: `default-${timetableYearLabel}`,
        validFrom: bounds.start.toISOString().slice(0, 10),
        validTo: bounds.end.toISOString().slice(0, 10),
      },
    ];
  }

  private computeYearBounds(label: string): { start: Date; end: Date } {
    const trimmed = label.trim();
    const match = /^(\d{4})(?:[/-](\d{2}))?$/.exec(trimmed);
    if (!match) {
      throw new BadRequestException(
        `Ungültiges Fahrplanjahr "${label}". Erwartet wird z. B. 2025/26.`,
      );
    }
    const startYear = Number.parseInt(match[1], 10);
    if (!Number.isFinite(startYear)) {
      throw new BadRequestException(`Ungültiges Fahrplanjahr "${label}".`);
    }
    const start = this.buildYearStart(startYear);
    const end = new Date(this.buildYearStart(startYear + 1).getTime() - 1);
    return { start, end };
  }

  private buildYearStart(decemberYear: number): Date {
    const date = new Date(Date.UTC(decemberYear, 11, 10, 0, 0, 0, 0));
    while (date.getUTCDay() !== 0) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return date;
  }

  private filterActivitiesByRange(
    activities: Activity[],
    start: Date,
    end: Date,
  ): Activity[] {
    const startMs = start.getTime();
    const endMs = end.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return activities;
    }
    return activities.filter((activity) => {
      const activityStart = Date.parse(activity.start);
      const activityEnd = Date.parse(activity.end ?? activity.start);
      if (!Number.isFinite(activityStart) || !Number.isFinite(activityEnd)) {
        return false;
      }
      return activityStart <= endMs && activityEnd >= startMs;
    });
  }

  private mergeActivitiesById(
    base: Activity[],
    overrides: Activity[],
  ): Activity[] {
    if (!overrides.length) {
      return base;
    }
    const merged = new Map<string, Activity>(
      base.map((entry) => [entry.id, entry]),
    );
    overrides.forEach((entry) => merged.set(entry.id, entry));
    return Array.from(merged.values());
  }
}
