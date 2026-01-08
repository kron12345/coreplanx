import { EMPTY } from 'rxjs';
import { catchError, finalize, take, tap } from 'rxjs/operators';
import type { Activity, ActivityParticipant, ServiceRole } from '../../models/activity';
import { MS_IN_HOUR } from '../../core/utils/time-math';
import type { PlanningApiContext } from '../../core/api/planning-api-context';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import type { TemplatePeriod, TimelineActivityDto } from '../../core/api/timeline-api.types';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import type { PlanningStageData, PlanningTimelineRange } from './planning-data.types';
import {
  cloneTimelineRange,
  mergeActivityList,
  normalizeActivityParticipants,
  rangesEqual,
} from './planning-data.utils';
import { reflectBaseActivities } from './planning-base-activity-reflection.utils';
import { PlanningDebugService } from './planning-debug.service';
import type { PlanningStageId } from './planning-stage.model';
import type { StageViewportMap } from './planning-viewport.types';
import {
  readActivityGroupMeta,
  readActivityGroupMetaFromAttributes,
  stripDayScope,
  writeActivityGroupMetaToAttributes,
} from './planning-activity-group.utils';

const MS_IN_DAY = 24 * MS_IN_HOUR;
const TEMPLATE_PATTERN_KEY = 'template_pattern';

export type WritableSignalLike<T> = {
  (): T;
  set(value: T): void;
  update(updater: (value: T) => T): void;
};

export class PlanningBaseDataController {
  private baseTemplateId: string | null = null;
  private baseTimelineRange: PlanningTimelineRange | null = null;
  private baseTemplatePeriods: TemplatePeriod[] | null = null;
  private baseTemplateSpecialDays: Set<string> = new Set();
  private baseTimelineLoading = false;
  private lastBaseTimelineSignature: string | null = null;

  constructor(
    private readonly deps: {
      stageDataSignal: WritableSignalLike<Record<PlanningStageId, PlanningStageData>>;
      stageViewportSignal: WritableSignalLike<StageViewportMap>;
      timelineErrorSignal: WritableSignalLike<Record<PlanningStageId, string | null>>;
      activityErrorSignal: WritableSignalLike<Record<PlanningStageId, string | null>>;
      setStageLoading: (stage: PlanningStageId, value: boolean) => void;
      invalidateViewportSignature: (stage: PlanningStageId) => void;
      scheduleViewportSync: (stage: PlanningStageId) => void;
      timelineApi: TimelineApiService;
      debug: PlanningDebugService;
      timetableYear: TimetableYearService;
      currentApiContext: () => PlanningApiContext;
    },
  ) {}

  resetForVariantChange(): void {
    this.lastBaseTimelineSignature = null;
    this.baseTimelineLoading = false;
  }

  templateId(): string | null {
    return this.baseTemplateId;
  }

  isLoading(): boolean {
    return this.baseTimelineLoading;
  }

  setBaseTemplateContext(
    templateId: string | null,
    context?: { periods?: TemplatePeriod[] | null; specialDays?: string[] | null },
  ): void {
    if (this.baseTemplateId === templateId) {
      if (context) {
        this.baseTemplatePeriods = context.periods ?? null;
        this.baseTemplateSpecialDays = new Set(context.specialDays ?? []);
      }
      return;
    }
    this.baseTemplateId = templateId;
    this.baseTemplatePeriods = context?.periods ?? null;
    this.baseTemplateSpecialDays = new Set(context?.specialDays ?? []);
    this.lastBaseTimelineSignature = null;
    this.baseTimelineLoading = false;
    if (!templateId) {
      this.deps.stageDataSignal.update((record) => ({
        ...record,
        base: {
          ...record.base,
          activities: [],
        },
      }));
      this.deps.setStageLoading('base', false);
      return;
    }
    const viewport = this.deps.stageViewportSignal().base;
    if (viewport) {
      this.deps.invalidateViewportSignature('base');
      this.deps.scheduleViewportSync('base');
    }
  }

  setBaseTimelineRange(range: PlanningTimelineRange | null): void {
    if (!range) {
      this.baseTimelineRange = null;
      return;
    }
    const current = this.deps.stageDataSignal().base.timelineRange;
    const next = cloneTimelineRange(range);
    if (rangesEqual(current, next)) {
      this.baseTimelineRange = next;
      return;
    }
    this.baseTimelineRange = next;
    this.deps.stageDataSignal.update((record) => ({
      ...record,
      base: {
        ...record.base,
        timelineRange: next,
      },
    }));
  }

  reloadBaseTimeline(rangeOverride?: PlanningTimelineRange | null, resourceIds: string[] = []): void {
    const viewport = this.deps.stageViewportSignal().base;
    const baseRange = rangeOverride ?? viewport?.window ?? this.baseTimelineRange;
    if (!baseRange || !this.baseTemplateId) {
      // Ohne Template kein Ladevorgang auslösen; Bereinigung passiert in setBaseTemplateContext.
      return;
    }
    if (!rangeOverride && !viewport) {
      return;
    }
    if (this.baseTimelineLoading) {
      return;
    }
    const context = this.deps.currentApiContext();
    const effectiveResourceIds = resourceIds.length ? resourceIds : viewport?.resourceIds ?? [];
    const range = {
      from: baseRange.start.toISOString(),
      to: baseRange.end.toISOString(),
      lod: 'activity' as const,
      stage: 'base' as const,
      variantId: context.variantId ?? undefined,
      timetableYearLabel: context.timetableYearLabel ?? undefined,
    };
    const signature = [
      this.baseTemplateId,
      range.from,
      range.to,
      range.variantId ?? '',
      effectiveResourceIds.join(','),
    ].join('|');
    if (signature === this.lastBaseTimelineSignature) {
      return;
    }
    this.lastBaseTimelineSignature = signature;
    this.baseTimelineLoading = true;
    this.deps.setStageLoading('base', true);
    this.deps.timelineApi
      .loadTemplateTimeline(this.baseTemplateId, range)
      .pipe(
        take(1),
        tap((response) => {
          this.applyTimelineActivities(response.activities ?? []);
          this.deps.debug.reportViewportLoad('base', baseRange, (response.activities ?? []).length);
        }),
        finalize(() => {
          this.baseTimelineLoading = false;
          this.deps.setStageLoading('base', false);
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to load base timeline', error);
          this.deps.timelineErrorSignal.update((state) => ({ ...state, base: 'Basis-Timeline konnte nicht geladen werden.' }));
          this.deps.debug.reportViewportError('base', 'Basis-Timeline konnte nicht geladen werden', error);
          this.baseTimelineLoading = false;
          this.deps.setStageLoading('base', false);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  upsertTemplateActivity(templateId: string, activity: Activity): void {
    const dayScopedMatch = /^(.+)@(\d{4}-\d{2}-\d{2})$/.exec((activity.id ?? '').toString());
    const baseId = dayScopedMatch?.[1] ?? (activity.id.split('@')[0] ?? activity.id);
    const serviceDayIso = dayScopedMatch?.[2] ?? null;
    const baseResources = this.deps.stageDataSignal().base.resources;
    const normalizedActivity =
      this.ensureSingleServiceOwnerForManagedActivity(
        normalizeActivityParticipants([activity], baseResources)[0] ?? activity,
      );

    const parsedStartMs = Date.parse(normalizedActivity.start);
    const startDate = Number.isFinite(parsedStartMs) ? new Date(parsedStartMs) : null;
    const fallbackDayIso = startDate ? startDate.toISOString().slice(0, 10) : null;
    const resolvedServiceDayIso = serviceDayIso ?? fallbackDayIso;
    const serviceDayMs = resolvedServiceDayIso ? Date.parse(`${resolvedServiceDayIso}T00:00:00.000Z`) : NaN;
    const serviceMidnightMs = Number.isFinite(serviceDayMs)
      ? serviceDayMs
      : startDate
        ? Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
        : NaN;

    const startOffsetDays =
      Number.isFinite(parsedStartMs) && Number.isFinite(serviceMidnightMs)
        ? Math.floor((parsedStartMs - serviceMidnightMs) / MS_IN_DAY)
        : 0;
    const startTimeMs =
      Number.isFinite(parsedStartMs) && Number.isFinite(serviceMidnightMs)
        ? parsedStartMs - serviceMidnightMs - startOffsetDays * MS_IN_DAY
        : 0;

    const endIso = normalizedActivity.end ?? null;
    const parsedEndMs = endIso ? Date.parse(endIso) : NaN;
    const endOffsetDays =
      endIso && Number.isFinite(parsedEndMs) && Number.isFinite(serviceMidnightMs)
        ? Math.floor((parsedEndMs - serviceMidnightMs) / MS_IN_DAY)
        : null;
    const endTimeMs =
      endIso && Number.isFinite(parsedEndMs) && Number.isFinite(serviceMidnightMs) && endOffsetDays !== null
        ? parsedEndMs - serviceMidnightMs - endOffsetDays * MS_IN_DAY
        : null;

    const weekday = Number.isFinite(serviceDayMs)
      ? new Date(serviceDayMs).getUTCDay()
      : startDate
        ? startDate.getUTCDay()
        : 0;

    const periods =
      this.baseTemplatePeriods && this.baseTemplatePeriods.length > 0 ? this.baseTemplatePeriods : this.defaultPeriods();
    const defaultYearEnd = this.deps.timetableYear.defaultYearBounds()?.end ?? null;
    const slice =
      Number.isFinite(serviceDayMs)
        ? periods.find((period) => {
            const startMs = Date.parse(period.validFrom);
            const endMs = period.validTo ? Date.parse(period.validTo) : defaultYearEnd?.getTime() ?? NaN;
            if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
              return false;
            }
            return serviceDayMs >= startMs && serviceDayMs <= endMs;
          }) ?? null
        : null;

    let canonicalServiceDayMs = serviceMidnightMs;
    if (slice) {
      const sliceStart = new Date(slice.validFrom);
      if (Number.isFinite(sliceStart.getTime())) {
        const base = new Date(Date.UTC(sliceStart.getUTCFullYear(), sliceStart.getUTCMonth(), sliceStart.getUTCDate()));
        const diff = (weekday - base.getUTCDay() + 7) % 7;
        base.setUTCDate(base.getUTCDate() + diff);
        canonicalServiceDayMs = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
      }
    }

    const nextAttributes = {
      ...(normalizedActivity.attributes ?? {}),
      [TEMPLATE_PATTERN_KEY]: {
        sliceId: slice?.id ?? null,
        weekday,
        startOffsetDays,
        startTimeMs,
        endOffsetDays,
        endTimeMs,
      },
    } as Record<string, unknown>;

    const canonicalStart =
      Number.isFinite(canonicalServiceDayMs)
        ? new Date(canonicalServiceDayMs + startOffsetDays * MS_IN_DAY + startTimeMs).toISOString()
        : normalizedActivity.start;
    const canonicalEnd =
      endOffsetDays !== null && endTimeMs !== null && Number.isFinite(canonicalServiceDayMs)
        ? new Date(canonicalServiceDayMs + endOffsetDays * MS_IN_DAY + endTimeMs).toISOString()
        : null;

    const dto = this.activityToTimelineDto('base', {
      ...normalizedActivity,
      id: baseId,
      start: canonicalStart,
      end: canonicalEnd,
      attributes: nextAttributes,
    });
    const context = this.deps.currentApiContext();
    this.deps.activityErrorSignal.update((state) => ({ ...state, base: null }));

    this.deps.debug.log('info', 'api', 'Basis: Template-Aktivität speichern', {
      stageId: 'base',
      context: {
        templateId,
        activityId: (activity.id ?? '').toString(),
        baseId,
        serviceDayIso: resolvedServiceDayIso,
        weekday,
        sliceId: slice?.id ?? null,
        canonicalStart,
        canonicalEnd,
        templatePattern: nextAttributes[TEMPLATE_PATTERN_KEY] as Record<string, unknown>,
      },
    });

    this.deps.timelineApi
      .upsertTemplateActivity(templateId, dto, context)
      .pipe(
        take(1),
        tap((saved) => {
          const attrs = (saved.attributes ?? {}) as Record<string, unknown>;
          this.deps.debug.log('info', 'api', 'Basis: Template-Aktivität gespeichert', {
            stageId: 'base',
            context: {
              templateId,
              activityId: saved.id,
              start: saved.start,
              end: saved.end ?? null,
              serviceId: saved.serviceId ?? null,
              serviceRole: saved.serviceRole ?? null,
              templatePattern: (attrs[TEMPLATE_PATTERN_KEY] ?? null) as Record<string, unknown> | null,
            },
          });
          this.deps.activityErrorSignal.update((state) => ({ ...state, base: null }));
          if (saved.id !== baseId) {
            this.removeTemplateActivityFamily(baseId);
          }
          this.applyTemplateActivity(saved);
          this.lastBaseTimelineSignature = null;
          this.reloadBaseTimeline();
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to upsert template activity', error);
          this.deps.activityErrorSignal.update((state) => ({
            ...state,
            base: this.describeActivitySyncError(error),
          }));
          this.deps.debug.reportApiError('Template-Aktivität konnte nicht gespeichert werden.', error, {
            stageId: 'base',
            templateId,
            activityId: (activity.id ?? '').toString(),
          });
          return EMPTY;
        }),
      )
      .subscribe();
  }

  deleteTemplateActivity(templateId: string, activityId: string): void {
    this.deps.activityErrorSignal.update((state) => ({ ...state, base: null }));
    this.deps.timelineApi
      .deleteTemplateActivity(templateId, activityId, this.deps.currentApiContext())
      .pipe(
        take(1),
        tap(() => {
          this.deps.activityErrorSignal.update((state) => ({ ...state, base: null }));
          this.removeTemplateActivity(activityId);
          // Auch reflektierte Instanzen (id@datum) entfernen.
          this.deps.stageDataSignal.update((record) => {
            const baseStage = record.base;
            const baseId = activityId.split('@')[0] ?? activityId;
            const filtered = baseStage.activities.filter((activity) => {
              const candidateBase = activity.id.split('@')[0] ?? activity.id;
              return activity.id !== activityId && candidateBase !== baseId;
            });
            return {
              ...record,
              base: {
                ...baseStage,
                activities: this.attachServiceWorktimeToBaseActivities(filtered),
              },
            };
          });
          this.lastBaseTimelineSignature = null;
          this.reloadBaseTimeline();
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to delete template activity', error);
          this.deps.activityErrorSignal.update((state) => ({
            ...state,
            base: this.describeActivitySyncError(error),
          }));
          this.deps.debug.reportApiError('Template-Aktivität konnte nicht gelöscht werden.', error, {
            stageId: 'base',
            templateId,
            activityId,
          });
          return EMPTY;
        }),
      )
      .subscribe();
  }

  applyTemplateActivity(entry: TimelineActivityDto): void {
    if (!this.baseTemplateId) {
      return;
    }
    const activities = this.mapTimelineActivities([entry]);
    const baseId = entry.id;
    const prefix = `${baseId}@`;
    const nextIds = new Set(activities.map((activity) => activity.id));
    this.deps.stageDataSignal.update((record) => {
      const baseStage = record.base;
      const persistedIds = new Set(
        baseStage.activities.filter((activity) => !!activity.rowVersion).map((activity) => activity.id),
      );
      const safeUpserts = activities.filter((activity) => !persistedIds.has(activity.id));
      const deleteIds = baseStage.activities
        .filter((activity) => {
          if (!activity.id.startsWith(prefix)) {
            return false;
          }
          if (nextIds.has(activity.id)) {
            return false;
          }
          return !activity.rowVersion;
        })
        .map((activity) => activity.id);
      const next = mergeActivityList(baseStage.activities, safeUpserts, deleteIds);
      const derived = this.attachServiceWorktimeToBaseActivities(next);
      return {
        ...record,
        base: {
          ...baseStage,
          activities: derived,
        },
      };
    });
  }

  attachServiceWorktime(activities: Activity[]): Activity[] {
    return this.attachServiceWorktimeToBaseActivities(activities);
  }

  private applyTimelineActivities(entries: TimelineActivityDto[]): void {
    const baseActivities = this.mapTimelineActivities(entries);
    const normalized = normalizeActivityParticipants(baseActivities, this.deps.stageDataSignal().base.resources);
    const derived = this.attachServiceWorktimeToBaseActivities(normalized);
    this.deps.stageDataSignal.update((record) => ({
      ...record,
      base: {
        ...record.base,
        activities: derived,
      },
    }));
  }

  private removeTemplateActivity(activityId: string): void {
    this.deps.stageDataSignal.update((record) => {
      const baseStage = record.base;
      const filtered = baseStage.activities.filter((activity) => activity.id !== activityId);
      if (filtered === baseStage.activities) {
        return record;
      }
      return {
        ...record,
        base: {
          ...baseStage,
          activities: this.attachServiceWorktimeToBaseActivities(filtered),
        },
      };
    });
  }

  private removeTemplateActivityFamily(baseId: string): void {
    this.deps.stageDataSignal.update((record) => {
      const baseStage = record.base;
      const filtered = baseStage.activities.filter((activity) => {
        const candidateBase = activity.id.split('@')[0] ?? activity.id;
        return activity.id !== baseId && candidateBase !== baseId;
      });
      if (filtered === baseStage.activities) {
        return record;
      }
      return {
        ...record,
        base: {
          ...baseStage,
          activities: this.attachServiceWorktimeToBaseActivities(filtered),
        },
      };
    });
  }

  private mapTimelineActivities(entries: TimelineActivityDto[]): Activity[] {
    const activities = entries.map((entry) => {
      const groupMeta = readActivityGroupMetaFromAttributes(entry.attributes ?? undefined);
      return {
        id: entry.id,
        title: entry.label?.trim().length ? entry.label : entry.type ?? entry.id,
        start: entry.start,
        end: entry.end ?? null,
        type: entry.type,
        from: entry.from ?? undefined,
        to: entry.to ?? undefined,
        remark: entry.remark ?? undefined,
        serviceId: entry.serviceId ?? undefined,
        serviceRole: (entry.serviceRole ?? undefined) as ServiceRole | undefined,
        groupId: groupMeta?.id ?? undefined,
        groupOrder: groupMeta?.order ?? undefined,
        attributes: entry.attributes ?? undefined,
        participants: entry.resourceAssignments.map((assignment) => ({
          resourceId: assignment.resourceId,
          kind: assignment.resourceType,
          role: (assignment.role ?? undefined) as ActivityParticipant['role'],
        })),
      } satisfies Activity;
    });
    return this.reflectBaseActivities(activities);
  }

  private activityToTimelineDto(stage: PlanningStageId, activity: Activity): TimelineActivityDto {
    const participants = activity.participants ?? [];
    const resourceAssignments = participants.map((participant) => ({
      resourceId: participant.resourceId,
      resourceType: participant.kind,
      role: participant.role ?? null,
      lineIndex: null,
    }));
    const groupMeta = readActivityGroupMeta(activity);
    const attributes =
      writeActivityGroupMetaToAttributes(
        this.stripComputedActivityAttributes(activity.attributes ?? undefined),
        groupMeta ? { ...groupMeta, attachedToActivityId: stripDayScope(groupMeta.attachedToActivityId ?? null) } : null,
      ) ?? null;
    const isOpenEnded = !activity.end;
    return {
      id: activity.id,
      stage,
      type: activity.type ?? '',
      start: activity.start,
      end: activity.end ?? null,
      isOpenEnded,
      status: (activity as any).status ?? null,
      serviceRole: activity.serviceRole ?? null,
      from: activity.from ?? null,
      to: activity.to ?? null,
      remark: activity.remark ?? null,
      label: activity.title ?? null,
      serviceId: activity.serviceId ?? null,
      resourceAssignments,
      attributes,
      version: (activity as any).version ?? null,
    };
  }

  private reflectBaseActivities(activities: Activity[]): Activity[] {
    const periods =
      this.baseTemplatePeriods && this.baseTemplatePeriods.length > 0 ? this.baseTemplatePeriods : this.defaultPeriods();
    const viewport = this.deps.stageViewportSignal().base?.range ?? null;
    const viewStart = viewport?.start ?? this.baseTimelineRange?.start ?? null;
    const viewEnd = viewport?.end ?? this.baseTimelineRange?.end ?? null;
    const defaultYearEnd = this.deps.timetableYear.defaultYearBounds()?.end ?? null;
    return reflectBaseActivities({
      activities,
      periods,
      specialDays: this.baseTemplateSpecialDays,
      viewStart,
      viewEnd,
      defaultPeriodEnd: defaultYearEnd,
    });
  }

  private defaultPeriods(): TemplatePeriod[] {
    const year = this.deps.timetableYear.defaultYearBounds();
    if (!year) {
      return [];
    }
    return [
      {
        id: 'default-year',
        validFrom: year.startIso,
        validTo: year.endIso,
      },
    ];
  }

  private attachServiceWorktimeToBaseActivities(activities: Activity[]): Activity[] {
    if (!activities.length) {
      return activities;
    }
    const worktimeByService = this.computeServiceWorktimeByService(activities);
    if (worktimeByService.size === 0) {
      return activities;
    }
    let mutated = false;
    const next = activities.map((activity) => {
      if (!this.isServiceStartActivity(activity)) {
        return activity;
      }
      const serviceId = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
      if (!serviceId) {
        return activity;
      }
      const worktime = worktimeByService.get(serviceId);
      if (worktime === undefined) {
        return activity;
      }
      const meta = (activity.meta ?? {}) as Record<string, unknown>;
      if (meta['service_worktime_ms'] === worktime) {
        return activity;
      }
      mutated = true;
      return {
        ...activity,
        meta: {
          ...meta,
          service_worktime_ms: worktime,
        },
      };
    });
    return mutated ? next : activities;
  }

  private stripComputedActivityAttributes(
    attributes: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | undefined {
    const next = { ...(attributes ?? {}) } as Record<string, unknown>;
    delete next['service_by_owner'];
    delete next['service_conflict_level'];
    delete next['service_conflict_codes'];
    delete next['service_conflict_details'];
    return Object.keys(next).length ? next : undefined;
  }

  private computeServiceWorktimeByService(activities: Activity[]): Map<string, number> {
    const windows = new Map<string, { startMs: number | null; endMs: number | null }>();
    activities.forEach((activity) => {
      const serviceId = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
      if (!serviceId) {
        return;
      }
      const startMs = this.parseTimestamp(activity.start);
      if (startMs === null) {
        return;
      }
      if (this.isServiceStartActivity(activity)) {
        const entry = windows.get(serviceId) ?? { startMs: null, endMs: null };
        entry.startMs = entry.startMs === null ? startMs : Math.min(entry.startMs, startMs);
        windows.set(serviceId, entry);
      }
      if (this.isServiceEndActivity(activity)) {
        const entry = windows.get(serviceId) ?? { startMs: null, endMs: null };
        entry.endMs = entry.endMs === null ? startMs : Math.max(entry.endMs, startMs);
        windows.set(serviceId, entry);
      }
    });

    const breakMsMap = new Map<string, number>();
    activities.forEach((activity) => {
      if (!this.isBreakActivity(activity)) {
        return;
      }
      const serviceId = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
      if (!serviceId) {
        return;
      }
      const startMs = this.parseTimestamp(activity.start);
      const endMs = this.parseTimestamp(activity.end ?? null);
      if (startMs === null || endMs === null || endMs <= startMs) {
        return;
      }
      const window = windows.get(serviceId);
      if (!window || window.startMs === null || window.endMs === null) {
        return;
      }
      const overlapStart = Math.max(startMs, window.startMs);
      const overlapEnd = Math.min(endMs, window.endMs);
      if (overlapEnd <= overlapStart) {
        return;
      }
      const current = breakMsMap.get(serviceId) ?? 0;
      breakMsMap.set(serviceId, current + (overlapEnd - overlapStart));
    });

    const worktimeByService = new Map<string, number>();
    windows.forEach((window, serviceId) => {
      if (window.startMs === null || window.endMs === null) {
        return;
      }
      if (window.endMs <= window.startMs) {
        return;
      }
      const total = window.endMs - window.startMs;
      const breakMs = breakMsMap.get(serviceId) ?? 0;
      worktimeByService.set(serviceId, Math.max(0, total - breakMs));
    });
    return worktimeByService;
  }

  private describeActivitySyncError(error: unknown): string {
    const fallback = 'Änderungen konnten nicht gespeichert werden.';
    const anyError = error as any;
    const payload = anyError?.error;
    const message =
      typeof payload?.message === 'string'
        ? payload.message
        : Array.isArray(payload?.message)
          ? payload.message.filter((entry: any) => typeof entry === 'string').join(' · ')
          : null;
    const violations = Array.isArray(payload?.violations) ? payload.violations : [];
    if (violations.length) {
      const first = violations[0] as Record<string, unknown>;
      const detail = typeof first['message'] === 'string' ? (first['message'] as string) : null;
      const ownerId = typeof first['ownerId'] === 'string' ? (first['ownerId'] as string) : null;
      const activityId = typeof first['activityId'] === 'string' ? (first['activityId'] as string) : null;
      const context = ownerId ?? activityId ?? null;
      const suffix = context && detail ? `${context}: ${detail}` : detail;
      if (message && suffix) {
        return `${message} (${suffix})`;
      }
      return message ?? suffix ?? fallback;
    }
    if (message) {
      return message;
    }
    const generic = typeof anyError?.message === 'string' ? anyError.message : null;
    return generic ?? fallback;
  }

  private parseTimestamp(value: string | null | undefined): number | null {
    const trimmed = (value ?? '').toString().trim();
    if (!trimmed) {
      return null;
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }

  private isServiceStartActivity(activity: Activity): boolean {
    const role = activity.serviceRole ?? null;
    const type = (activity.type ?? '').toString().trim();
    const id = (activity.id ?? '').toString();
    if (role === 'start') {
      return true;
    }
    if (type === 'service-start') {
      return true;
    }
    return id.startsWith('svcstart:');
  }

  private isServiceEndActivity(activity: Activity): boolean {
    const role = activity.serviceRole ?? null;
    const type = (activity.type ?? '').toString().trim();
    const id = (activity.id ?? '').toString();
    if (role === 'end') {
      return true;
    }
    if (type === 'service-end') {
      return true;
    }
    return id.startsWith('svcend:');
  }

  private isBreakActivity(activity: Activity): boolean {
    const type = (activity.type ?? '').toString().trim();
    if (type === 'break' || type === 'short-break') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    if (attrs) {
      if (this.toBool(attrs['is_break']) || this.toBool(attrs['is_short_break'])) {
        return true;
      }
    }
    const id = (activity.id ?? '').toString();
    return id.startsWith('svcbreak:') || id.startsWith('svcshortbreak:');
  }

  private ensureSingleServiceOwnerForManagedActivity(activity: Activity): Activity {
    if (!this.isBreakActivity(activity) && !this.isServiceStartActivity(activity) && !this.isServiceEndActivity(activity)) {
      return activity;
    }
    const participants = activity.participants ?? [];
    if (participants.length === 0) {
      return activity;
    }
    const serviceOwners = participants.filter(
      (participant) =>
        participant.kind === 'personnel-service' || participant.kind === 'vehicle-service',
    );
    if (serviceOwners.length <= 1) {
      return activity;
    }
    const preferredKind = activity.serviceCategory ?? null;
    const preferredOwner =
      (preferredKind
        ? serviceOwners.find((participant) => participant.kind === preferredKind)
        : null) ??
      serviceOwners.find(
        (participant) =>
          participant.role === 'primary-personnel' || participant.role === 'primary-vehicle',
      ) ??
      serviceOwners[0];
    if (!preferredOwner) {
      return activity;
    }
    const keepIds = new Set([preferredOwner.resourceId]);
    const nextParticipants = participants.filter((participant) => {
      if (participant.kind !== 'personnel-service' && participant.kind !== 'vehicle-service') {
        return true;
      }
      return keepIds.has(participant.resourceId);
    });
    if (nextParticipants.length === participants.length) {
      return activity;
    }
    return {
      ...activity,
      participants: nextParticipants,
    };
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
}
