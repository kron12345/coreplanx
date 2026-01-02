import { DestroyRef, Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { catchError, finalize, switchMap, take, tap } from 'rxjs/operators';
import { Activity, ServiceRole, type ActivityParticipant } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityApiService } from '../../core/api/activity-api.service';
import { PlanningApiContext } from '../../core/api/planning-api-context';
import {
  ActivityBatchMutationResponse,
  ActivityValidationRequest,
  ActivityValidationResponse,
} from '../../core/api/activity-api.types';
import { PlanningStageId } from './planning-stage.model';
import { PlanningRealtimeEvent, PlanningRealtimeService } from './planning-realtime.service';
import { ClientIdentityService } from '../../core/services/client-identity.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import { TemplatePeriod, TimelineActivityDto } from '../../core/api/timeline-api.types';
import {
  PlanningResourceApiService,
  ResourceSnapshotDto,
  ResourceSnapshotResetScope,
} from '../../core/api/planning-resource-api.service';
import type { PlanningStageData, PlanningTimelineRange, PlanningVariantContext } from './planning-data.types';
import {
  cloneResources,
  cloneResourceSnapshot,
  cloneStageData,
  cloneTimelineRange,
  convertIncomingTimelineRange,
  createEmptyStageData,
  diffActivities,
  diffResources,
  mergeActivityList,
  mergeResourceList,
  normalizeActivityParticipants,
  normalizeTimelineRange,
  rangesEqual,
  resourceListsEqual,
  type ActivityDiff,
  type ResourceDiff,
} from './planning-data.utils';
import { reflectBaseActivities } from './planning-base-activity-reflection.utils';
import { flattenResourceSnapshot } from './planning-resource-snapshot.utils';
import {
  readActivityGroupMeta,
  readActivityGroupMetaFromAttributes,
  stripDayScope,
  writeActivityGroupMetaToAttributes,
} from './planning-activity-group.utils';

const STAGE_IDS: PlanningStageId[] = ['base', 'operations'];

@Injectable({ providedIn: 'root' })
export class PlanningDataService {
  private readonly api = inject(ActivityApiService);
  private readonly timelineApi = inject(TimelineApiService);
  private readonly resourceApi = inject(PlanningResourceApiService);
  private readonly realtime = inject(PlanningRealtimeService);
  private readonly identity = inject(ClientIdentityService);
  private readonly timetableYear = inject(TimetableYearService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userId = this.identity.userId();
  private readonly connectionId = this.identity.connectionId();
  private baseTemplateId: string | null = null;
  private baseTimelineRange: PlanningTimelineRange | null = null;
  private readonly resourceSnapshotSignal = signal<ResourceSnapshotDto | null>(null);
  private readonly resourceErrorSignal = signal<string | null>(null);
  private readonly timelineErrorSignal = signal<Record<PlanningStageId, string | null>>({
    base: null,
    operations: null,
  });
  private readonly activityErrorSignal = signal<Record<PlanningStageId, string | null>>({
    base: null,
    operations: null,
  });
  private baseTemplatePeriods: TemplatePeriod[] | null = null;
  private baseTemplateSpecialDays: Set<string> = new Set();
  private baseTimelineLoading = false;
  private lastBaseTimelineSignature: string | null = null;
  private skipAutopilot = false;
  private readonly planningVariantContext = signal<PlanningVariantContext | null>(null);
  private readonly clonedResourceCache = new WeakMap<Resource[], Resource[]>();
  private readonly clonedResourceItemCache = new WeakMap<Resource, Resource>();
  private readonly clonedActivityCache = new WeakMap<Activity[], Activity[]>();
  private readonly clonedActivityItemCache = new WeakMap<Activity, Activity>();

  private readonly pendingActivityMutations: Record<
    PlanningStageId,
    { upserts: Map<string, Activity>; deleteIds: Set<string> }
  > = {
    base: { upserts: new Map<string, Activity>(), deleteIds: new Set<string>() },
    operations: { upserts: new Map<string, Activity>(), deleteIds: new Set<string>() },
  };

  private readonly inFlightActivityMutations = new Set<PlanningStageId>();
  private readonly inFlightActivityMutationIds: Record<
    PlanningStageId,
    { upsertIds: Set<string>; deleteIds: Set<string>; clientRequestId: string | null }
  > = {
    base: { upsertIds: new Set<string>(), deleteIds: new Set<string>(), clientRequestId: null },
    operations: { upsertIds: new Set<string>(), deleteIds: new Set<string>(), clientRequestId: null },
  };

  private readonly deferredRemoteActivityMutations: Record<
    PlanningStageId,
    Map<string, { kind: 'upsert' | 'delete'; activity?: Activity; version?: string | null }>
  > = {
    base: new Map(),
    operations: new Map(),
  };

  private readonly syncingActivityIdsSignal = signal<Record<PlanningStageId, ReadonlySet<string>>>({
    base: new Set<string>(),
    operations: new Set<string>(),
  });

  private readonly stageDataSignal = signal<Record<PlanningStageId, PlanningStageData>>(
    STAGE_IDS.reduce((record, stage) => {
      record[stage] = createEmptyStageData();
      return record;
    }, {} as Record<PlanningStageId, PlanningStageData>),
  );

  constructor() {
    this.loadResourceSnapshot();
    this.refreshStage('operations');

    effect((onCleanup) => {
      const context = this.currentApiContext();
      const subs = STAGE_IDS.map((stage) =>
        this.realtime
          .events(stage, context)
          .subscribe((event) => this.handleRealtimeEvent(event)),
      );
      onCleanup(() => subs.forEach((sub) => sub.unsubscribe()));
    });
  }

  private loadResourceSnapshot(): void {
    this.resourceApi
      .fetchSnapshot()
      .pipe(
        take(1),
        tap((snapshot) => {
          const clone = cloneResourceSnapshot(snapshot);
          this.resourceSnapshotSignal.set(cloneResourceSnapshot(clone));
          this.applyResourceSnapshot(clone);
          this.resourceErrorSignal.set(null);
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to load resource snapshot', error);
          this.resourceErrorSignal.set('Ressourcen konnten nicht geladen werden.');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  resetResourceSnapshotToDefaults(scope?: ResourceSnapshotResetScope): void {
    this.resourceApi
      .resetSnapshot(scope)
      .pipe(
        take(1),
        tap((snapshot) => {
          const clone = cloneResourceSnapshot(snapshot);
          this.resourceSnapshotSignal.set(cloneResourceSnapshot(clone));
          this.applyResourceSnapshot(clone);
          this.resourceErrorSignal.set(null);
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to reset resource snapshot', error);
          this.resourceErrorSignal.set('Werkseinstellungen konnten nicht geladen werden.');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  updateResourceSnapshot(updater: (snapshot: ResourceSnapshotDto) => ResourceSnapshotDto): void {
    const current = this.resourceSnapshotSignal();
    if (!current) {
      return;
    }
    const previous = cloneResourceSnapshot(current);
    const next = updater(cloneResourceSnapshot(current));
    this.resourceSnapshotSignal.set(cloneResourceSnapshot(next));
    this.applyResourceSnapshot(next);
    this.resourceApi
      .replaceSnapshot(next)
      .pipe(
        take(1),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to persist resource snapshot', error);
          this.resourceSnapshotSignal.set(previous);
          this.applyResourceSnapshot(previous);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  syncResourceSnapshot(snapshot: ResourceSnapshotDto): void {
    const clone = cloneResourceSnapshot(snapshot);
    this.resourceSnapshotSignal.set(cloneResourceSnapshot(clone));
    this.applyResourceSnapshot(clone);
    this.resourceErrorSignal.set(null);
  }

  applyActivityMutation(stage: PlanningStageId, upserts: Activity[], deleteIds: string[]): void {
    if (!upserts.length && !deleteIds.length) {
      return;
    }
    this.enqueueActivityMutations(stage, upserts, deleteIds);
  }

  private applyResourceSnapshot(snapshot: ResourceSnapshotDto): void {
    const resources = flattenResourceSnapshot(snapshot);
    this.stageDataSignal.update((record) => {
      const next = { ...record };
      STAGE_IDS.forEach((stage) => {
        next[stage] = {
          ...next[stage],
          resources: cloneResources(resources),
        };
      });
      return next;
    });
  }

  stageResources(stage: PlanningStageId): Signal<Resource[]> {
    return computed(() => this.cloneResourcesCached(this.stageDataSignal()[stage].resources), {
      equal: resourceListsEqual,
    });
  }

  stageActivities(stage: PlanningStageId): Signal<Activity[]> {
    return computed(() => this.cloneActivitiesCached(this.stageDataSignal()[stage].activities));
  }

  stageTimelineRange(stage: PlanningStageId): Signal<PlanningTimelineRange> {
    return computed(
      () => cloneTimelineRange(this.stageDataSignal()[stage].timelineRange),
      { equal: rangesEqual },
    );
  }

  resourceError(): Signal<string | null> {
    return computed(() => this.resourceErrorSignal());
  }

  timelineError(stage: PlanningStageId): Signal<string | null> {
    return computed(() => this.timelineErrorSignal()[stage] ?? null);
  }

  activityError(stage: PlanningStageId): Signal<string | null> {
    return computed(() => this.activityErrorSignal()[stage] ?? null);
  }

  resourceSnapshot(): Signal<ResourceSnapshotDto | null> {
    return computed(() => {
      const snapshot = this.resourceSnapshotSignal();
      return snapshot ? cloneResourceSnapshot(snapshot) : null;
    });
  }

  planningVariant(): Signal<PlanningVariantContext | null> {
    return computed(() => this.planningVariantContext());
  }

  syncingActivityIds(stage: PlanningStageId): Signal<ReadonlySet<string>> {
    return computed(() => this.syncingActivityIdsSignal()[stage] ?? new Set<string>());
  }

  setPlanningVariant(context: PlanningVariantContext | null): void {
    const current = this.planningVariantContext();
    if (this.areVariantContextsEqual(current, context)) {
      return;
    }
    this.planningVariantContext.set(context);
    if (context?.timetableYearLabel) {
      try {
        const bounds = this.timetableYear.getYearByLabel(context.timetableYearLabel);
        const range: PlanningTimelineRange = { start: bounds.start, end: bounds.end };
        this.setStageTimelineRange('base', range);
        this.setStageTimelineRange('operations', range);
      } catch {
        // ignore invalid labels in mock
      }
    }
    this.refreshStage('operations');
  }

  private areVariantContextsEqual(a: PlanningVariantContext | null, b: PlanningVariantContext | null): boolean {
    if (a === b) {
      return true;
    }
    if (!a || !b) {
      return !a && !b;
    }
    return (
      a.id === b.id &&
      a.type === b.type &&
      (a.timetableYearLabel ?? null) === (b.timetableYearLabel ?? null) &&
      (a.label ?? '') === (b.label ?? '')
    );
  }

  private cloneResourcesCached(resources: Resource[]): Resource[] {
    const cached = this.clonedResourceCache.get(resources);
    if (cached) {
      return cached;
    }
    const cloned = resources.map((resource) => this.cloneResourceItem(resource));
    this.clonedResourceCache.set(resources, cloned);
    return cloned;
  }

  private cloneActivitiesCached(activities: Activity[]): Activity[] {
    const cached = this.clonedActivityCache.get(activities);
    if (cached) {
      return cached;
    }
    const cloned = activities.map((activity) => this.cloneActivityItem(activity));
    this.clonedActivityCache.set(activities, cloned);
    return cloned;
  }

  private cloneResourceItem(resource: Resource): Resource {
    const cached = this.clonedResourceItemCache.get(resource);
    if (cached) {
      return cached;
    }
    const cloned: Resource = {
      ...resource,
      attributes: resource.attributes ? { ...resource.attributes } : undefined,
    };
    this.clonedResourceItemCache.set(resource, cloned);
    return cloned;
  }

  private cloneActivityItem(activity: Activity): Activity {
    const cached = this.clonedActivityItemCache.get(activity);
    if (cached) {
      return cached;
    }
    const cloned: Activity = {
      ...activity,
      participants: activity.participants ? activity.participants.map((participant) => ({ ...participant })) : undefined,
      requiredQualifications: activity.requiredQualifications ? [...activity.requiredQualifications] : undefined,
      assignedQualifications: activity.assignedQualifications ? [...activity.assignedQualifications] : undefined,
      workRuleTags: activity.workRuleTags ? [...activity.workRuleTags] : undefined,
      attributes: activity.attributes ? { ...activity.attributes } : undefined,
      meta: activity.meta ? { ...activity.meta } : undefined,
    };
    this.clonedActivityItemCache.set(activity, cloned);
    return cloned;
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
      this.stageDataSignal.update((record) => ({
        ...record,
        base: {
          ...record.base,
          activities: [],
        },
      }));
    }
  }

  setBaseTimelineRange(range: PlanningTimelineRange | null): void {
    if (!range) {
      this.baseTimelineRange = null;
      return;
    }
    const current = this.stageDataSignal().base.timelineRange;
    const next = cloneTimelineRange(range);
    if (rangesEqual(current, next)) {
      this.baseTimelineRange = next;
      return;
    }
    this.baseTimelineRange = next;
    this.stageDataSignal.update((record) => ({
      ...record,
      base: {
        ...record.base,
        timelineRange: next,
      },
    }));
  }

  setAutopilotSuppressed(value: boolean): void {
    this.skipAutopilot = value;
  }

  setStageTimelineRange(stage: PlanningStageId, range: PlanningTimelineRange): void {
    const normalized = normalizeTimelineRange(cloneTimelineRange(range));
    this.stageDataSignal.update((record) => ({
      ...record,
      [stage]: { ...record[stage], timelineRange: normalized },
    }));
    if (stage === 'base') {
      this.baseTimelineRange = normalized;
    }
  }

  reloadBaseTimeline(): void {
    if (!this.baseTimelineRange || !this.baseTemplateId) {
      // Ohne Template kein Ladevorgang auslösen; Bereinigung passiert in setBaseTemplateContext.
      return;
    }
    if (this.baseTimelineLoading) {
      return;
    }
    const context = this.currentApiContext();
    const range = {
      from: this.baseTimelineRange.start.toISOString(),
      to: this.baseTimelineRange.end.toISOString(),
      lod: 'activity' as const,
      stage: 'base' as const,
      variantId: context.variantId ?? undefined,
      timetableYearLabel: context.timetableYearLabel ?? undefined,
    };
    const signature = `${this.baseTemplateId}|${range.from}|${range.to}|${range.variantId ?? ''}`;
    if (signature === this.lastBaseTimelineSignature) {
      return;
    }
    this.lastBaseTimelineSignature = signature;
    this.baseTimelineLoading = true;
    this.timelineApi
      .loadTemplateTimeline(this.baseTemplateId, range)
      .pipe(
        take(1),
        tap((response) => this.applyTimelineActivities('base', response.activities ?? [])),
        switchMap(() =>
          this.api
            .listActivities(
              'base',
              { from: range.from, to: range.to },
              this.currentApiContext(),
            )
            .pipe(
              take(1),
              tap((planningActivities) => this.mergeBasePlanningActivities(planningActivities)),
              catchError((error) => {
                console.warn('[PlanningDataService] Failed to merge base activities from planning stage', error);
                return EMPTY;
              }),
            ),
        ),
        finalize(() => {
          this.baseTimelineLoading = false;
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to load base timeline', error);
          this.timelineErrorSignal.update((state) => ({ ...state, base: 'Basis-Timeline konnte nicht geladen werden.' }));
          this.baseTimelineLoading = false;
          return EMPTY;
        }),
      )
      .subscribe();
  }

  upsertTemplateActivity(templateId: string, activity: Activity): void {
    const baseId = activity.id.split('@')[0] ?? activity.id;
    const startDate = new Date(activity.start);
    const isoDay = Number.isFinite(startDate.getTime()) ? startDate.toISOString().slice(0, 10) : null;
    const stageActivityId = isoDay ? `${baseId}@${isoDay}` : null;
    const currentStageActivity = stageActivityId
      ? this.stageDataSignal().base.activities.find((entry) => entry.id === stageActivityId) ?? null
      : null;
    const baseResources = this.stageDataSignal().base.resources;
    const normalizedActivity = normalizeActivityParticipants([activity], baseResources)[0] ?? activity;
    const stageUpsert = stageActivityId
      ? {
          ...normalizedActivity,
          id: stageActivityId,
          rowVersion: currentStageActivity?.rowVersion ?? normalizedActivity.rowVersion ?? activity.rowVersion,
        }
      : undefined;
    const dto = this.activityToTimelineDto('base', { ...normalizedActivity, id: baseId });
    const context = this.currentApiContext();

    this.timelineApi
      .upsertTemplateActivity(templateId, dto, context)
      .pipe(
        take(1),
        tap((saved) => this.applyTemplateActivity(saved)),
        tap(() => {
          if (!stageUpsert || !stageActivityId) {
            return;
          }
          this.enqueueActivityMutations('base', [stageUpsert], []);
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to upsert template activity', error);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  deleteTemplateActivity(templateId: string, activityId: string): void {
    const baseId = activityId.split('@')[0] ?? activityId;
    const planningDeleteIds = Array.from(
      new Set(
        this.stageDataSignal()
          .base.activities.filter((activity) => (activity.id.split('@')[0] ?? activity.id) === baseId)
          .map((activity) => activity.id),
      ),
    );
    this.timelineApi
      .deleteTemplateActivity(templateId, activityId, this.currentApiContext())
      .pipe(
        take(1),
        tap(() => {
          this.removeTemplateActivity(activityId);
          // Auch reflektierte Instanzen (id@datum) entfernen.
          this.stageDataSignal.update((record) => {
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
                activities: filtered,
              },
            };
          });

          if (planningDeleteIds.length) {
            this.enqueueActivityMutations('base', [], planningDeleteIds);
          }
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to delete template activity', error);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  requestActivityValidation(
    stage: PlanningStageId,
    payload?: ActivityValidationRequest,
  ): Observable<ActivityValidationResponse> {
    const current = this.stageDataSignal()[stage];
    const defaultPayload: ActivityValidationRequest = payload ?? {
      activityIds: current.activities.map((activity) => activity.id),
    };
    return this.api.validateActivities(stage, defaultPayload, this.currentApiContext());
  }

  refreshStage(stage: PlanningStageId): void {
    if (stage === 'base') {
      this.reloadBaseTimeline();
      return;
    }
    const range = this.stageDataSignal()[stage].timelineRange;
    this.api
      .listActivities(
        stage,
        { from: range.start.toISOString(), to: range.end.toISOString() },
        this.currentApiContext(),
      )
      .pipe(
        take(1),
        tap((activities) => {
          const normalized = normalizeActivityParticipants(activities, this.stageDataSignal()[stage].resources);
          this.stageDataSignal.update((record) => ({
            ...record,
            [stage]: {
              ...record[stage],
              activities: normalized,
            },
          }));
          this.timelineErrorSignal.update((state) => ({ ...state, [stage]: null }));
        }),
        catchError((error) => {
          console.warn(`[PlanningDataService] Failed to load activities for stage ${stage}`, error);
          this.timelineErrorSignal.update((state) => ({
            ...state,
            [stage]: 'Timeline konnte nicht geladen werden.',
          }));
          return EMPTY;
        }),
      )
      .subscribe();
  }

  private applyTimelineActivities(stage: PlanningStageId, entries: TimelineActivityDto[]): void {
    const baseActivities = this.mapTimelineActivities(entries, stage);
    const normalized = normalizeActivityParticipants(baseActivities, this.stageDataSignal()[stage].resources);
    this.stageDataSignal.update((record) => ({
      ...record,
      [stage]: {
        ...record[stage],
        activities: normalized,
      },
    }));
  }

  private mergeBasePlanningActivities(activities: Activity[]): void {
    if (!activities.length) {
      return;
    }
    this.stageDataSignal.update((record) => {
      const baseStage = record.base;
      const normalizedUpserts = normalizeActivityParticipants(activities, baseStage.resources);
      const merged = mergeActivityList(baseStage.activities, normalizedUpserts, []);
      if (merged === baseStage.activities) {
        return record;
      }
      return {
        ...record,
        base: {
          ...baseStage,
          activities: merged,
        },
      };
    });
  }

  private applyTemplateActivity(entry: TimelineActivityDto): void {
    if (!this.baseTemplateId) {
      return;
    }
    const activities = this.mapTimelineActivities([entry], 'base');
    const baseId = entry.id;
    const prefix = `${baseId}@`;
    const nextIds = new Set(activities.map((activity) => activity.id));
    this.stageDataSignal.update((record) => {
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
      return {
        ...record,
        base: {
          ...baseStage,
          activities: next,
        },
      };
    });
  }

  private removeTemplateActivity(activityId: string): void {
    this.stageDataSignal.update((record) => {
      const baseStage = record.base;
      const filtered = baseStage.activities.filter((activity) => activity.id !== activityId);
      if (filtered === baseStage.activities) {
        return record;
      }
      return {
        ...record,
        base: {
          ...baseStage,
          activities: filtered,
        },
      };
    });
  }

  private mapTimelineActivities(entries: TimelineActivityDto[], stage: PlanningStageId): Activity[] {
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
    if (stage !== 'base') {
      return activities;
    }
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
    const attributes = writeActivityGroupMetaToAttributes(activity.attributes ?? undefined, groupMeta
      ? { ...groupMeta, attachedToActivityId: stripDayScope(groupMeta.attachedToActivityId ?? null) }
      : null) ?? null;
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
      this.baseTemplatePeriods && this.baseTemplatePeriods.length > 0
        ? this.baseTemplatePeriods
        : this.defaultPeriods();
    const viewStart = this.baseTimelineRange?.start ?? null;
    const viewEnd = this.baseTimelineRange?.end ?? null;
    const defaultYearEnd = this.timetableYear.defaultYearBounds()?.end ?? null;
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
    const year = this.timetableYear.defaultYearBounds();
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

  updateStageData(stage: PlanningStageId, updater: (data: PlanningStageData) => PlanningStageData) {
    const currentStage = this.stageDataSignal()[stage];
    const draft = cloneStageData(currentStage);
    const updatedDraft = updater(draft);
    const nextStage: PlanningStageData = {
      ...updatedDraft,
      timelineRange: normalizeTimelineRange(cloneTimelineRange(updatedDraft.timelineRange)),
    };

    const resourceDiff = diffResources(currentStage.resources, nextStage.resources);
    const activityDiff = diffActivities(currentStage.activities, nextStage.activities);
    resourceDiff.clientRequestId = this.decorateClientRequestId(resourceDiff.clientRequestId);
    activityDiff.clientRequestId = this.decorateClientRequestId(activityDiff.clientRequestId);

    const resourceUpserts = resourceDiff.upserts ?? [];
    const resourceDeletes = resourceDiff.deleteIds ?? [];
    const activityUpserts = activityDiff.upserts ?? [];
    const activityDeletes = activityDiff.deleteIds ?? [];

    this.stageDataSignal.update((record) => {
      const stageData = record[stage];
      const mergedResources = mergeResourceList(stageData.resources, resourceUpserts, resourceDeletes);
      const normalizedActivityUpserts = activityUpserts.length
        ? normalizeActivityParticipants(activityUpserts, mergedResources)
        : [];
      const mergedActivities = mergeActivityList(stageData.activities, normalizedActivityUpserts, activityDeletes);
      const nextRange = rangesEqual(stageData.timelineRange, nextStage.timelineRange)
        ? stageData.timelineRange
        : nextStage.timelineRange;
      if (
        mergedResources === stageData.resources &&
        mergedActivities === stageData.activities &&
        nextRange === stageData.timelineRange
      ) {
        return record;
      }
      return {
        ...record,
        [stage]: {
          ...stageData,
          resources: mergedResources,
          activities: mergedActivities,
          timelineRange: nextRange,
        },
      };
    });

    this.syncResources(stage, resourceDiff);
    this.syncActivities(stage, activityDiff);
  }

  private handleRealtimeEvent(event: PlanningRealtimeEvent): void {
    if (!event) {
      return;
    }
    if (event.sourceConnectionId && event.sourceConnectionId === this.connectionId) {
      return;
    }
    if (!event.sourceConnectionId && event.sourceClientId === this.userId) {
      return;
    }
    const { stageId } = event;
    if (!STAGE_IDS.includes(stageId)) {
      return;
    }
    if (event.scope === 'resources') {
      this.applyIncomingResources(stageId, (event.upserts as Resource[]) ?? [], event.deleteIds ?? [], event.version);
      return;
    }
    if (event.scope === 'activities') {
      this.applyIncomingActivities(stageId, (event.upserts as Activity[]) ?? [], event.deleteIds ?? [], event.version);
      return;
    }
    if (event.scope === 'timeline' && event.timelineRange) {
      this.applyIncomingTimeline(stageId, event.timelineRange, event.version);
    }
  }

  private applyIncomingResources(
    stageId: PlanningStageId,
    upserts: Resource[],
    deleteIds: string[],
    version?: string | null,
  ): void {
    if (upserts.length === 0 && deleteIds.length === 0) {
      return;
    }
    this.stageDataSignal.update((record) => {
      const stage = record[stageId];
      if (!stage) {
        return record;
      }
      if (version && stage.version && version < stage.version) {
        return record;
      }
      const merged = mergeResourceList(stage.resources, upserts, deleteIds);
      const nextVersion = this.maxVersion(stage.version ?? null, version ?? null);
      if (merged === stage.resources && nextVersion === (stage.version ?? null)) {
        return record;
      }
      return {
        ...record,
        [stageId]: {
          ...stage,
          resources: merged,
          version: nextVersion ?? stage.version,
        },
      };
    });
  }

  private applyIncomingActivities(
    stageId: PlanningStageId,
    upserts: Activity[],
    deleteIds: string[],
    version?: string | null,
  ): void {
    if (upserts.length === 0 && deleteIds.length === 0) {
      return;
    }
    const currentStage = this.stageDataSignal()[stageId];
    const currentVersion = currentStage?.version ?? null;
    if (version && currentVersion && version < currentVersion) {
      return;
    }

    const blocked = this.blockedActivityIds(stageId);
    const applyUpserts: Activity[] = [];
    const applyDeletes: string[] = [];
    const deferred = this.deferredRemoteActivityMutations[stageId];

    upserts.forEach((activity) => {
      if (blocked.has(activity.id)) {
        this.deferRemoteActivityMutation(deferred, activity.id, { kind: 'upsert', activity, version });
        return;
      }
      applyUpserts.push(activity);
    });
    deleteIds.forEach((id) => {
      if (blocked.has(id)) {
        this.deferRemoteActivityMutation(deferred, id, { kind: 'delete', version });
        return;
      }
      applyDeletes.push(id);
    });

    if (!applyUpserts.length && !applyDeletes.length) {
      // Don't bump stage.version while a local mutation is pending; we'll apply the deferred data once the activity is idle again.
      return;
    }
    this.stageDataSignal.update((record) => {
      const stage = record[stageId];
      if (!stage) {
        return record;
      }
      if (version && stage.version && version < stage.version) {
        return record;
      }
      const normalizedUpserts = normalizeActivityParticipants(applyUpserts, stage.resources);
      const currentById = new Map(stage.activities.map((activity) => [activity.id, activity.rowVersion ?? null]));
      const filteredUpserts = normalizedUpserts.filter((activity) => {
        const currentVersion = currentById.get(activity.id);
        const incomingVersion = activity.rowVersion ?? null;
        if (!currentVersion || !incomingVersion) {
          return true;
        }
        return incomingVersion >= currentVersion;
      });
      const merged = mergeActivityList(stage.activities, filteredUpserts, applyDeletes);
      const nextVersion = this.maxVersion(stage.version ?? null, version ?? null);
      if (merged === stage.activities && nextVersion === (stage.version ?? null)) {
        return record;
      }
      return {
        ...record,
        [stageId]: {
          ...stage,
          activities: merged,
          version: nextVersion ?? stage.version,
        },
      };
    });
  }

  private applyIncomingTimeline(
    stageId: PlanningStageId,
    range: PlanningTimelineRange | { start: string | Date; end: string | Date },
    version?: string | null,
  ): void {
    const normalizedRange = convertIncomingTimelineRange(range);
    this.stageDataSignal.update((record) => {
      const stage = record[stageId];
      if (!stage) {
        return record;
      }
      if (version && stage.version && version < stage.version) {
        return record;
      }
      return {
        ...record,
        [stageId]: {
          ...stage,
          timelineRange: normalizeTimelineRange(normalizedRange),
          version: version ?? stage.version,
        },
      };
    });
  }

  private decorateClientRequestId(value?: string): string {
    const base = value && value.length > 0 ? value : `client-sync-${Date.now().toString(36)}`;
    return `${this.userId}|${this.connectionId}|${base}`;
  }

  private currentApiContext(): PlanningApiContext {
    const variant = this.planningVariantContext();
    return {
      variantId: variant?.id ?? 'default',
      timetableYearLabel: variant?.timetableYearLabel ?? null,
    };
  }

  private syncActivities(stage: PlanningStageId, diff: ActivityDiff): void {
    if (!diff.hasChanges) {
      return;
    }
    const stageData = this.stageDataSignal()[stage];
    if (diff.upserts && stageData) {
      diff.upserts = normalizeActivityParticipants(diff.upserts, stageData.resources);
    }
    this.enqueueActivityMutations(stage, diff.upserts ?? [], diff.deleteIds ?? []);
  }

  private applyMutationResponse(stage: PlanningStageId, response: ActivityBatchMutationResponse): void {
    const pending = this.pendingActivityMutations[stage];
    const pendingUpsertIds = pending.upserts;
    const pendingDeleteIds = pending.deleteIds;

    const rowVersionOnly = new Map<string, string>();

    const applyUpserts: Activity[] = [];
    (response.upserts ?? []).forEach((activity) => {
      if (pendingDeleteIds.has(activity.id)) {
        return;
      }
      if (pendingUpsertIds.has(activity.id)) {
        if (activity.rowVersion) {
          rowVersionOnly.set(activity.id, activity.rowVersion);
          const pendingActivity = pendingUpsertIds.get(activity.id);
          if (pendingActivity) {
            pendingUpsertIds.set(activity.id, {
              ...pendingActivity,
              rowVersion: this.maxVersion(pendingActivity.rowVersion ?? null, activity.rowVersion) ?? activity.rowVersion,
            });
          }
        }
        return;
      }
      applyUpserts.push(activity);
    });

    const applyDeletes = (response.deletedIds ?? []).filter((id) => !pendingUpsertIds.has(id));

    this.stageDataSignal.update((record) => {
      const stageData = record[stage];
      const currentVersion = stageData.version ?? null;
      const nextVersion = this.maxVersion(currentVersion, response.version ?? null) ?? currentVersion;

      let activities = stageData.activities;
      if (rowVersionOnly.size) {
        let mutated = false;
        const next = activities.map((activity) => {
          const incoming = rowVersionOnly.get(activity.id);
          if (!incoming) {
            return activity;
          }
          const mergedVersion = this.maxVersion(activity.rowVersion ?? null, incoming) ?? activity.rowVersion ?? incoming;
          if ((activity.rowVersion ?? null) === mergedVersion) {
            return activity;
          }
          mutated = true;
          return {
            ...activity,
            rowVersion: mergedVersion,
          };
        });
        activities = mutated ? next : activities;
      }

      const normalizedUpserts = applyUpserts.length
        ? normalizeActivityParticipants(applyUpserts, stageData.resources)
        : [];
      const currentById = new Map(activities.map((activity) => [activity.id, activity.rowVersion ?? null]));
      const filteredUpserts = normalizedUpserts.filter((activity) => {
        const currentVersion = currentById.get(activity.id);
        const incomingVersion = activity.rowVersion ?? null;
        if (!currentVersion || !incomingVersion) {
          return true;
        }
        return incomingVersion >= currentVersion;
      });

      const merged = mergeActivityList(activities, filteredUpserts, applyDeletes);
      if (merged === stageData.activities && nextVersion === currentVersion) {
        return record;
      }
      return {
        ...record,
        [stage]: {
          ...stageData,
          activities: merged,
          version: nextVersion ?? stageData.version,
        },
      };
    });
  }

  private enqueueActivityMutations(stage: PlanningStageId, upserts: Activity[], deleteIds: string[]): void {
    const pending = this.pendingActivityMutations[stage];
    deleteIds.forEach((id) => {
      pending.upserts.delete(id);
      pending.deleteIds.add(id);
    });
    upserts.forEach((activity) => {
      pending.deleteIds.delete(activity.id);
      pending.upserts.set(activity.id, activity);
    });
    this.updateSyncingActivityIds(stage);
    this.flushActivityMutations(stage);
  }

  private flushActivityMutations(stage: PlanningStageId): void {
    if (this.inFlightActivityMutations.has(stage)) {
      return;
    }
    const pending = this.pendingActivityMutations[stage];
    if (!pending.upserts.size && !pending.deleteIds.size) {
      return;
    }
    const upserts = Array.from(pending.upserts.values());
    const deleteIds = Array.from(pending.deleteIds.values());
    pending.upserts.clear();
    pending.deleteIds.clear();

    const stageData = this.stageDataSignal()[stage];
    const currentRowVersions = new Map(
      (stageData?.activities ?? []).map((activity) => [activity.id, activity.rowVersion ?? null]),
    );
    const effectiveUpserts = upserts.map((activity) => {
      const current = currentRowVersions.get(activity.id);
      const merged = this.maxVersion(activity.rowVersion ?? null, current);
      if (merged && merged !== (activity.rowVersion ?? null)) {
        return { ...activity, rowVersion: merged };
      }
      return activity;
    });

    this.inFlightActivityMutations.add(stage);
    this.activityErrorSignal.update((state) => ({ ...state, [stage]: null }));
    const inFlight = this.inFlightActivityMutationIds[stage];
    inFlight.upsertIds = new Set(effectiveUpserts.map((activity) => activity.id));
    inFlight.deleteIds = new Set(deleteIds);
    inFlight.clientRequestId = this.decorateClientRequestId(`activity-sync-${Date.now().toString(36)}`);
    this.updateSyncingActivityIds(stage);
    this.api
      .batchMutateActivities(
        stage,
        {
          upserts: effectiveUpserts,
          deleteIds,
          skipAutopilot: this.skipAutopilot,
          clientRequestId: inFlight.clientRequestId,
        },
        this.currentApiContext(),
      )
      .pipe(
        take(1),
        tap(() => {
          this.activityErrorSignal.update((state) => ({ ...state, [stage]: null }));
        }),
        tap((response) => this.applyMutationResponse(stage, response)),
        catchError((error) => {
          console.error(`[PlanningDataService] Failed to sync activities for ${stage}`, error);
          this.activityErrorSignal.update((state) => ({ ...state, [stage]: this.describeActivitySyncError(error) }));
          this.refreshStage(stage);
          return EMPTY;
        }),
        finalize(() => {
          this.inFlightActivityMutations.delete(stage);
          const current = this.inFlightActivityMutationIds[stage];
          current.upsertIds = new Set<string>();
          current.deleteIds = new Set<string>();
          current.clientRequestId = null;
          this.updateSyncingActivityIds(stage);
          this.drainDeferredRemoteActivityMutations(stage);
          this.flushActivityMutations(stage);
        }),
      )
      .subscribe();
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

  private blockedActivityIds(stage: PlanningStageId): Set<string> {
    const blocked = new Set<string>();
    const pending = this.pendingActivityMutations[stage];
    pending.upserts.forEach((_activity, id) => blocked.add(id));
    pending.deleteIds.forEach((id) => blocked.add(id));
    const inFlight = this.inFlightActivityMutationIds[stage];
    inFlight.upsertIds.forEach((id) => blocked.add(id));
    inFlight.deleteIds.forEach((id) => blocked.add(id));
    return blocked;
  }

  private deferRemoteActivityMutation(
    deferred: Map<string, { kind: 'upsert' | 'delete'; activity?: Activity; version?: string | null }>,
    id: string,
    mutation: { kind: 'upsert' | 'delete'; activity?: Activity; version?: string | null },
  ): void {
    const existing = deferred.get(id);
    if (!existing) {
      deferred.set(id, mutation);
      return;
    }
    const existingVersion = existing.version ?? null;
    const incomingVersion = mutation.version ?? null;
    if (existingVersion && incomingVersion && incomingVersion < existingVersion) {
      return;
    }
    deferred.set(id, {
      ...mutation,
      version: this.maxVersion(existingVersion, incomingVersion),
    });
  }

  private drainDeferredRemoteActivityMutations(stage: PlanningStageId): void {
    const deferred = this.deferredRemoteActivityMutations[stage];
    if (!deferred.size) {
      return;
    }
    const blocked = this.blockedActivityIds(stage);
    const upserts: Activity[] = [];
    const deleteIds: string[] = [];
    let version: string | null = null;

    Array.from(deferred.entries()).forEach(([id, mutation]) => {
      if (blocked.has(id)) {
        return;
      }
      deferred.delete(id);
      if (mutation.kind === 'delete') {
        deleteIds.push(id);
      } else if (mutation.activity) {
        upserts.push(mutation.activity);
      }
      version = this.maxVersion(version, mutation.version ?? null);
    });

    if (!upserts.length && !deleteIds.length) {
      return;
    }

    this.stageDataSignal.update((record) => {
      const stageData = record[stage];
      if (!stageData) {
        return record;
      }
      const normalizedUpserts = upserts.length
        ? normalizeActivityParticipants(upserts, stageData.resources)
        : [];
      const currentById = new Map(stageData.activities.map((activity) => [activity.id, activity.rowVersion ?? null]));
      const filteredUpserts = normalizedUpserts.filter((activity) => {
        const currentVersion = currentById.get(activity.id);
        const incomingVersion = activity.rowVersion ?? null;
        if (!currentVersion || !incomingVersion) {
          return true;
        }
        return incomingVersion >= currentVersion;
      });
      const merged = mergeActivityList(stageData.activities, filteredUpserts, deleteIds);
      const nextVersion = this.maxVersion(stageData.version ?? null, version);
      if (merged === stageData.activities && nextVersion === (stageData.version ?? null)) {
        return record;
      }
      return {
        ...record,
        [stage]: {
          ...stageData,
          activities: merged,
          version: nextVersion ?? stageData.version,
        },
      };
    });
  }

  private maxVersion(a: string | null | undefined, b: string | null | undefined): string | null {
    const left = a ?? null;
    const right = b ?? null;
    if (!left) {
      return right;
    }
    if (!right) {
      return left;
    }
    return left >= right ? left : right;
  }

  private updateSyncingActivityIds(stage: PlanningStageId): void {
    const pending = this.pendingActivityMutations[stage];
    const inFlight = this.inFlightActivityMutationIds[stage];
    const ids = new Set<string>();
    pending.upserts.forEach((_value, id) => ids.add(id));
    pending.deleteIds.forEach((id) => ids.add(id));
    inFlight.upsertIds.forEach((id) => ids.add(id));
    inFlight.deleteIds.forEach((id) => ids.add(id));
    this.syncingActivityIdsSignal.update((record) => ({
      ...record,
      [stage]: ids,
    }));
  }

  private syncResources(stage: PlanningStageId, diff: ResourceDiff): void {
    if (!diff.hasChanges) {
      return;
    }
    this.api
      .batchMutateResources(stage, {
        upserts: diff.upserts,
        deleteIds: diff.deleteIds,
        clientRequestId: diff.clientRequestId,
      }, this.currentApiContext())
      .pipe(
        take(1),
        catchError((error) => {
          console.error(`[PlanningDataService] Failed to sync resources for ${stage}`, error);
          this.refreshStage(stage);
          return EMPTY;
        }),
      )
      .subscribe();
  }
}
