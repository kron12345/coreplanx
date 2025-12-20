import { DestroyRef, Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { catchError, finalize, take, tap } from 'rxjs/operators';
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
import { PlanningResourceApiService, ResourceSnapshotDto } from '../../core/api/planning-resource-api.service';
import type { PlanningStageData, PlanningTimelineRange, PlanningVariantContext } from './planning-data.types';
import {
  cloneActivities,
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
  normalizeStage,
  normalizeTimelineRange,
  rangesEqual,
  resourceListsEqual,
  type ActivityDiff,
  type ResourceDiff,
} from './planning-data.utils';
import { reflectBaseActivities } from './planning-base-activity-reflection.utils';
import { flattenResourceSnapshot } from './planning-resource-snapshot.utils';

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
  private baseTemplatePeriods: TemplatePeriod[] | null = null;
  private baseTemplateSpecialDays: Set<string> = new Set();
  private baseTimelineLoading = false;
  private lastBaseTimelineSignature: string | null = null;
  private readonly planningVariantContext = signal<PlanningVariantContext | null>(null);

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
    return computed(() => cloneResources(this.stageDataSignal()[stage].resources), {
      equal: resourceListsEqual,
    });
  }

  stageActivities(stage: PlanningStageId): Signal<Activity[]> {
    return computed(() => cloneActivities(this.stageDataSignal()[stage].activities));
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

  resourceSnapshot(): Signal<ResourceSnapshotDto | null> {
    return computed(() => {
      const snapshot = this.resourceSnapshotSignal();
      return snapshot ? cloneResourceSnapshot(snapshot) : null;
    });
  }

  planningVariant(): Signal<PlanningVariantContext | null> {
    return computed(() => this.planningVariantContext());
  }

  setPlanningVariant(context: PlanningVariantContext | null): void {
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
    const dto = this.activityToTimelineDto('base', activity);
    this.timelineApi
      .upsertTemplateActivity(templateId, dto, this.currentApiContext())
      .pipe(
        take(1),
        tap((saved) => {
          this.applyTemplateActivity(saved);
          // Force a fresh timeline load so the UI immediately reflects the change.
          this.lastBaseTimelineSignature = null;
          this.reloadBaseTimeline();
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to upsert template activity', error);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  deleteTemplateActivity(templateId: string, activityId: string): void {
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
          this.lastBaseTimelineSignature = null;
          this.reloadBaseTimeline();
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

  private applyTemplateActivity(entry: TimelineActivityDto): void {
    if (!this.baseTemplateId) {
      return;
    }
    const [activity] = this.mapTimelineActivities([entry], 'base');
    this.stageDataSignal.update((record) => {
      const baseStage = record.base;
      const next = mergeActivityList(baseStage.activities, [activity], []);
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
    const activities = entries.map((entry) => ({
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
      attributes: entry.attributes ?? undefined,
      participants: entry.resourceAssignments.map((assignment) => ({
        resourceId: assignment.resourceId,
        kind: assignment.resourceType,
        role: (assignment.role ?? undefined) as ActivityParticipant['role'],
      })),
    }));
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
      attributes: activity.attributes ?? null,
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
    const current = this.stageDataSignal();
    const previousStage = cloneStageData(current[stage]);
    const nextStage = normalizeStage(updater(previousStage));
    this.stageDataSignal.set({
      ...current,
      [stage]: nextStage,
    });
    const activityDiff = diffActivities(previousStage.activities, nextStage.activities);
    const resourceDiff = diffResources(previousStage.resources, nextStage.resources);
    activityDiff.clientRequestId = this.decorateClientRequestId(activityDiff.clientRequestId);
    resourceDiff.clientRequestId = this.decorateClientRequestId(resourceDiff.clientRequestId);
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
      const merged = mergeResourceList(stage.resources, upserts, deleteIds);
      if (merged === stage.resources) {
        return record;
      }
      return {
        ...record,
        [stageId]: {
          ...stage,
          resources: merged,
          version: version ?? stage.version,
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
    this.stageDataSignal.update((record) => {
      const stage = record[stageId];
      if (!stage) {
        return record;
      }
      const normalizedUpserts = normalizeActivityParticipants(upserts, stage.resources);
      const merged = mergeActivityList(stage.activities, normalizedUpserts, deleteIds);
      if (merged === stage.activities) {
        return record;
      }
      return {
        ...record,
        [stageId]: {
          ...stage,
          activities: merged,
          version: version ?? stage.version,
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
    this.api
      .batchMutateActivities(stage, {
        upserts: diff.upserts,
        deleteIds: diff.deleteIds,
        clientRequestId: diff.clientRequestId,
      }, this.currentApiContext())
      .pipe(
        take(1),
        tap((response) => this.applyMutationResponse(stage, response)),
        catchError((error) => {
          console.error(`[PlanningDataService] Failed to sync activities for ${stage}`, error);
          this.refreshStage(stage);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  private applyMutationResponse(stage: PlanningStageId, response: ActivityBatchMutationResponse): void {
    if (!response.version) {
      return;
    }
    this.stageDataSignal.update((record) => ({
      ...record,
      [stage]: {
        ...record[stage],
        version: response.version ?? record[stage].version,
      },
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
