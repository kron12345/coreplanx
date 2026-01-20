import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { catchError, take, tap } from 'rxjs/operators';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityApiService } from '../../core/api/activity-api.service';
import type { PlanningApiContext } from '../../core/api/planning-api-context';
import type {
  ActivityValidationRequest,
  ActivityValidationResponse,
} from '../../core/api/activity-api.types';
import { PlanningStageId } from './planning-stage.model';
import { PlanningRealtimeService, type PlanningRealtimeEvent } from './planning-realtime.service';
import { PlanningDebugService } from './planning-debug.service';
import { ClientIdentityService } from '../../core/services/client-identity.service';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import type { TemplatePeriod, TimelineActivityDto } from '../../core/api/timeline-api.types';
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
import { flattenResourceSnapshot } from './planning-resource-snapshot.utils';
import type { StageViewportMap } from './planning-viewport.types';
import { PlanningBaseDataController } from './planning-data.base';
import { PlanningOperationsDataController } from './planning-data.operations';
import { MS_IN_HOUR } from '../../core/utils/time-math';

const STAGE_IDS: PlanningStageId[] = ['base', 'operations'];
const VIEWPORT_PADDING_HOURS = 24;
const VIEWPORT_SYNC_DELAY_MS = 250;

@Injectable({ providedIn: 'root' })
export class PlanningDataService {
  private readonly api = inject(ActivityApiService);
  private readonly timelineApi = inject(TimelineApiService);
  private readonly resourceApi = inject(PlanningResourceApiService);
  private readonly realtime = inject(PlanningRealtimeService);
  private readonly debug = inject(PlanningDebugService);
  private readonly identity = inject(ClientIdentityService);
  private readonly timetableYear = inject(TimetableYearService);

  private readonly stageViewportSignal = signal<StageViewportMap>({
    base: null,
    operations: null,
  });
  private readonly stageLoadingSignal = signal<Record<PlanningStageId, boolean>>({
    base: false,
    operations: false,
  });
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
  private readonly lastViewportSignature: Record<PlanningStageId, string | null> = {
    base: null,
    operations: null,
  };
  private readonly viewportSyncHandles: Record<PlanningStageId, number | null> = {
    base: null,
    operations: null,
  };
  private readonly planningVariantContext = signal<PlanningVariantContext | null>(null);
  private readonly clonedResourceCache = new WeakMap<Resource[], Resource[]>();
  private readonly clonedResourceItemCache = new WeakMap<Resource, Resource>();
  private readonly clonedActivityCache = new WeakMap<Activity[], Activity[]>();
  private readonly clonedActivityItemCache = new WeakMap<Activity, Activity>();
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

  private readonly base = new PlanningBaseDataController({
    stageDataSignal: this.stageDataSignal,
    stageViewportSignal: this.stageViewportSignal,
    timelineErrorSignal: this.timelineErrorSignal,
    activityErrorSignal: this.activityErrorSignal,
    setStageLoading: (stage, value) => this.setStageLoading(stage, value),
    invalidateViewportSignature: (stage) => this.invalidateViewportSignature(stage),
    scheduleViewportSync: (stage) => this.scheduleViewportSync(stage),
    timelineApi: this.timelineApi,
    debug: this.debug,
    timetableYear: this.timetableYear,
    currentApiContext: () => this.currentApiContext(),
  });

  private readonly operations = new PlanningOperationsDataController({
    api: this.api,
    debug: this.debug,
    identity: this.identity,
    realtimeConnectionId: () => this.realtime.connectionId(),
    stageDataSignal: this.stageDataSignal,
    stageViewportSignal: this.stageViewportSignal,
    syncingActivityIdsSignal: this.syncingActivityIdsSignal,
    timelineErrorSignal: this.timelineErrorSignal,
    activityErrorSignal: this.activityErrorSignal,
    setStageLoading: (stage, value) => this.setStageLoading(stage, value),
    currentApiContext: () => this.currentApiContext(),
    decorateClientRequestId: (value) => this.decorateClientRequestId(value),
  });

  constructor() {
    this.loadResourceSnapshot();

    effect((onCleanup) => {
      const context = this.currentApiContext();
      const subs = STAGE_IDS.map((stage) =>
        this.realtime.events(stage, context).subscribe((event) => {
          if (event.stageId === 'base') {
            this.handleBaseRealtimeEvent(event);
            return;
          }
          this.operations.handleRealtimeEvent(event);
        }),
      );
      onCleanup(() => subs.forEach((sub) => sub.unsubscribe()));
    });
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
          this.debug.reportApiSuccess('Werkseinstellungen geladen');
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to reset resource snapshot', error);
          this.resourceErrorSignal.set('Werkseinstellungen konnten nicht geladen werden.');
          this.debug.reportApiError('Werkseinstellungen konnten nicht geladen werden', error);
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
          this.debug.reportApiError('Ressourcen konnten nicht gespeichert werden', error);
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
    if (stage === 'base') {
      const templateId = this.base.templateId();
      if (!templateId) {
        return;
      }
      upserts.forEach((activity) => this.base.upsertTemplateActivity(templateId, activity));
      deleteIds.forEach((id) => this.base.deleteTemplateActivity(templateId, (id.split('@')[0] ?? id).toString()));
      return;
    }
    this.operations.applyActivityMutation(stage, upserts, deleteIds);
  }

  private handleBaseRealtimeEvent(event: PlanningRealtimeEvent): void {
    const connectionId = this.realtime.connectionId();
    const userId = this.identity.userId();
    if (event.sourceConnectionId && connectionId && event.sourceConnectionId === connectionId) {
      return;
    }
    if (!event.sourceConnectionId && event.sourceClientId === userId) {
      return;
    }
    if (event.scope === 'activities') {
      const upserts = (event.upserts as unknown as TimelineActivityDto[]) ?? [];
      const deleteIds = event.deleteIds ?? [];
      upserts.forEach((activity) => this.base.applyTemplateActivity(activity));
      deleteIds.forEach((id) => this.base.applyTemplateActivityDeletion(id));
      return;
    }
    if (event.scope === 'timeline' && event.timelineRange) {
      const range = convertIncomingTimelineRange(event.timelineRange);
      this.base.setBaseTimelineRange(range);
    }
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

  stageLoading(stage: PlanningStageId): Signal<boolean> {
    return computed(() => this.stageLoadingSignal()[stage] ?? false);
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

    this.base.resetForVariantChange();
    this.operations.resetForVariantChange();

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
    this.lastViewportSignature.base = null;
    this.lastViewportSignature.operations = null;
    const viewports = this.stageViewportSignal();
    STAGE_IDS.forEach((stage) => {
      if (viewports[stage]) {
        this.scheduleViewportSync(stage);
      }
    });
  }

  setBaseTemplateContext(
    templateId: string | null,
    context?: { periods?: TemplatePeriod[] | null; specialDays?: string[] | null },
  ): void {
    this.base.setBaseTemplateContext(templateId, context);
  }

  setBaseTimelineRange(range: PlanningTimelineRange | null): void {
    this.base.setBaseTimelineRange(range);
  }

  setAutopilotSuppressed(value: boolean): void {
    this.operations.setAutopilotSuppressed(value);
  }

  setStageTimelineRange(stage: PlanningStageId, range: PlanningTimelineRange): void {
    const normalized = normalizeTimelineRange(cloneTimelineRange(range));
    this.stageDataSignal.update((record) => ({
      ...record,
      [stage]: { ...record[stage], timelineRange: normalized },
    }));
    if (stage === 'base') {
      this.base.setBaseTimelineRange(normalized);
    }
  }

  setStageViewport(stage: PlanningStageId, range: PlanningTimelineRange, resourceIds: string[] = []): void {
    const normalizedRange = normalizeTimelineRange(cloneTimelineRange(range));
    const normalizedResources = this.normalizeViewportResourceIds(resourceIds);
    const window = this.buildViewportWindow(normalizedRange);
    const signature = this.buildViewportSignature(window, normalizedResources);
    const current = this.stageViewportSignal()[stage];
    if (current && current.signature === signature && rangesEqual(current.range, normalizedRange)) {
      return;
    }
    this.stageViewportSignal.update((record) => ({
      ...record,
      [stage]: {
        range: normalizedRange,
        window,
        resourceIds: normalizedResources,
        signature,
      },
    }));
    this.scheduleViewportSync(stage);
  }

  reloadBaseTimeline(rangeOverride?: PlanningTimelineRange | null, resourceIds: string[] = []): void {
    this.base.reloadBaseTimeline(rangeOverride, resourceIds);
  }

  upsertTemplateActivity(templateId: string, activity: Activity): void {
    this.base.upsertTemplateActivity(templateId, activity);
  }

  deleteTemplateActivity(templateId: string, activityId: string): void {
    this.base.deleteTemplateActivity(templateId, activityId);
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
    const viewport = this.stageViewportSignal()[stage];
    if (stage === 'base') {
      if (viewport) {
        this.base.reloadBaseTimeline(viewport.window, viewport.resourceIds);
      } else {
        this.base.reloadBaseTimeline();
      }
      return;
    }
    this.operations.refreshStage(stage);
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

    if (stage === 'base') {
      this.stageDataSignal.update((record) => {
        const baseStage = record.base;
        const derived = this.base.attachServiceWorktime(baseStage.activities);
        if (derived === baseStage.activities) {
          return record;
        }
        return {
          ...record,
          base: {
            ...baseStage,
            activities: derived,
          },
        };
      });
    }

    this.operations.syncResources(stage, resourceDiff);
    this.operations.syncActivities(stage, activityDiff);
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
          this.debug.reportApiSuccess('Ressourcen geladen');
        }),
        catchError((error) => {
          console.warn('[PlanningDataService] Failed to load resource snapshot', error);
          this.resourceErrorSignal.set('Ressourcen konnten nicht geladen werden.');
          this.debug.reportApiError('Ressourcen konnten nicht geladen werden', error);
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

  private buildViewportWindow(range: PlanningTimelineRange): PlanningTimelineRange {
    const start = new Date(range.start.getTime() - VIEWPORT_PADDING_HOURS * MS_IN_HOUR);
    const end = new Date(range.end.getTime() + VIEWPORT_PADDING_HOURS * MS_IN_HOUR);
    return normalizeTimelineRange({ start, end });
  }

  private buildViewportSignature(window: PlanningTimelineRange, resourceIds: string[]): string {
    return `${window.start.getTime()}|${window.end.getTime()}|${resourceIds.join(',')}`;
  }

  private normalizeViewportResourceIds(resourceIds: string[]): string[] {
    const cleaned = resourceIds.map((id) => id.trim()).filter(Boolean);
    if (!cleaned.length) {
      return [];
    }
    return Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b));
  }

  private setStageLoading(stage: PlanningStageId, value: boolean): void {
    this.stageLoadingSignal.update((record) => ({
      ...record,
      [stage]: value,
    }));
  }

  private invalidateViewportSignature(stage: PlanningStageId): void {
    this.lastViewportSignature[stage] = null;
  }

  private scheduleViewportSync(stage: PlanningStageId): void {
    const handle = this.viewportSyncHandles[stage];
    if (handle !== null) {
      clearTimeout(handle);
    }
    this.viewportSyncHandles[stage] = setTimeout(() => {
      this.viewportSyncHandles[stage] = null;
      this.syncStageViewport(stage);
    }, VIEWPORT_SYNC_DELAY_MS);
  }

  private syncStageViewport(stage: PlanningStageId): void {
    const viewport = this.stageViewportSignal()[stage];
    if (!viewport) {
      return;
    }
    if (viewport.signature === this.lastViewportSignature[stage]) {
      return;
    }
    if (stage === 'base' && this.base.isLoading()) {
      this.scheduleViewportSync(stage);
      return;
    }
    this.lastViewportSignature[stage] = viewport.signature;
    const templateId = stage === 'base' ? this.base.templateId() : null;
    if (stage !== 'base' || templateId) {
      this.realtime.subscribeViewport(stage, viewport.window, viewport.resourceIds, this.currentApiContext(), {
        templateId,
      });
    }
    if (stage === 'base') {
      this.base.reloadBaseTimeline(viewport.window, viewport.resourceIds);
    } else {
      this.operations.loadStageActivitiesForViewport(stage, viewport);
    }
  }

  private decorateClientRequestId(value?: string): string {
    const base = value && value.length > 0 ? value : `client-sync-${Date.now().toString(36)}`;
    const connectionId = this.realtime.connectionId() ?? this.identity.connectionId();
    return `${this.identity.userId()}|${connectionId}|${base}`;
  }

  private currentApiContext(): PlanningApiContext {
    const variant = this.planningVariantContext();
    return {
      variantId: variant?.id ?? 'default',
      timetableYearLabel: variant?.timetableYearLabel ?? null,
    };
  }
}
