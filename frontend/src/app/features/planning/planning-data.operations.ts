import { EMPTY } from 'rxjs';
import { catchError, finalize, take, tap } from 'rxjs/operators';
import type { Activity } from '../../models/activity';
import type { Resource } from '../../models/resource';
import { ActivityApiService } from '../../core/api/activity-api.service';
import type { PlanningApiContext } from '../../core/api/planning-api-context';
import type {
  ActivityBatchMutationResponse,
} from '../../core/api/activity-api.types';
import type { PlanningStageId } from './planning-stage.model';
import type { PlanningStageData, PlanningTimelineRange } from './planning-data.types';
import type { PlanningRealtimeEvent } from './planning-realtime.service';
import { mergeActivityList, mergeResourceList, normalizeActivityParticipants, normalizeTimelineRange, convertIncomingTimelineRange } from './planning-data.utils';
import type { ActivityDiff, ResourceDiff } from './planning-data.utils';
import type { StageViewportMap, StageViewportState } from './planning-viewport.types';
import { PlanningDebugService } from './planning-debug.service';
import { ClientIdentityService } from '../../core/services/client-identity.service';

const STAGE_IDS: PlanningStageId[] = ['base', 'operations'];

export type WritableSignalLike<T> = {
  (): T;
  set(value: T): void;
  update(updater: (value: T) => T): void;
};

export class PlanningOperationsDataController {
  private readonly rowVersionCache = new Map<string, string>();
  private skipAutopilot = true;

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
  private readonly conflictRetryClientIds: Record<PlanningStageId, string | null> = {
    base: null,
    operations: null,
  };
  private readonly conflictRetryAttempts: Record<PlanningStageId, number> = {
    base: 0,
    operations: 0,
  };
  private readonly rowVersionHints: Record<PlanningStageId, Map<string, string>> = {
    base: new Map<string, string>(),
    operations: new Map<string, string>(),
  };
  private readonly deferredRemoteActivityMutations: Record<
    PlanningStageId,
    Map<string, { kind: 'upsert' | 'delete'; activity?: Activity; version?: string | null }>
  > = {
    base: new Map(),
    operations: new Map(),
  };

  constructor(
    private readonly deps: {
      api: ActivityApiService;
      debug: PlanningDebugService;
      identity: ClientIdentityService;
      stageDataSignal: WritableSignalLike<Record<PlanningStageId, PlanningStageData>>;
      stageViewportSignal: WritableSignalLike<StageViewportMap>;
      syncingActivityIdsSignal: WritableSignalLike<Record<PlanningStageId, ReadonlySet<string>>>;
      timelineErrorSignal: WritableSignalLike<Record<PlanningStageId, string | null>>;
      activityErrorSignal: WritableSignalLike<Record<PlanningStageId, string | null>>;
      setStageLoading: (stage: PlanningStageId, value: boolean) => void;
      currentApiContext: () => PlanningApiContext;
      decorateClientRequestId: (value?: string) => string;
    },
  ) {}

  resetForVariantChange(): void {
    this.rowVersionCache.clear();
    this.rowVersionHints.base.clear();
    this.rowVersionHints.operations.clear();
    this.conflictRetryClientIds.base = null;
    this.conflictRetryClientIds.operations = null;
    this.conflictRetryAttempts.base = 0;
    this.conflictRetryAttempts.operations = 0;
    this.deferredRemoteActivityMutations.base.clear();
    this.deferredRemoteActivityMutations.operations.clear();
  }

  setAutopilotSuppressed(value: boolean): void {
    this.skipAutopilot = value;
  }

  applyActivityMutation(stage: PlanningStageId, upserts: Activity[], deleteIds: string[]): void {
    if (!upserts.length && !deleteIds.length) {
      return;
    }
    if (stage === 'base') {
      return;
    }
    this.enqueueActivityMutations(stage, upserts, deleteIds);
  }

  refreshStage(stage: PlanningStageId): void {
    if (stage === 'base') {
      return;
    }
    const viewport = this.deps.stageViewportSignal()[stage];
    if (!viewport) {
      return;
    }
    this.loadStageActivitiesForViewport(stage, viewport);
  }

  loadStageActivitiesForViewport(stage: PlanningStageId, viewport: StageViewportState): void {
    if (stage === 'base') {
      return;
    }
    const context = this.deps.currentApiContext();
    this.deps.setStageLoading(stage, true);
    this.deps.api
      .listActivities(
        stage,
        {
          from: viewport.window.start.toISOString(),
          to: viewport.window.end.toISOString(),
          resourceIds: viewport.resourceIds.length ? viewport.resourceIds : undefined,
        },
        context,
      )
      .pipe(
        take(1),
        tap((activities) => {
          const normalized = normalizeActivityParticipants(activities, this.deps.stageDataSignal()[stage].resources);
          this.storeRowVersions(stage, normalized);
          this.deps.stageDataSignal.update((record) => ({
            ...record,
            [stage]: {
              ...record[stage],
              activities: normalized,
            },
          }));
          this.deps.timelineErrorSignal.update((state) => ({ ...state, [stage]: null }));
          this.deps.debug.reportViewportLoad(stage, viewport.window, normalized.length);
        }),
        catchError((error) => {
          console.warn(`[PlanningDataService] Failed to load activities for stage ${stage}`, error);
          this.deps.timelineErrorSignal.update((state) => ({
            ...state,
            [stage]: 'Timeline konnte nicht geladen werden.',
          }));
          this.deps.debug.reportViewportError(stage, 'Timeline konnte nicht geladen werden', error);
          return EMPTY;
        }),
        finalize(() => this.deps.setStageLoading(stage, false)),
      )
      .subscribe();
  }

  subscribeStageViewport(stage: PlanningStageId, viewport: StageViewportState): void {
    if (stage === 'base') {
      return;
    }
    const userId = this.deps.identity.userId();
    const connectionId = this.deps.identity.connectionId();
    if (!userId || !connectionId) {
      this.deps.debug.log('warn', 'viewport', 'Viewport-Subscription abgebrochen (Identitaet fehlt).', {
        stageId: stage,
      });
      return;
    }
    this.deps.api
      .updateViewportSubscription(
        stage,
        {
          from: viewport.window.start.toISOString(),
          to: viewport.window.end.toISOString(),
          resourceIds: viewport.resourceIds.length ? viewport.resourceIds : undefined,
          userId,
          connectionId,
        },
        this.deps.currentApiContext(),
      )
      .pipe(
        take(1),
        tap(() => this.deps.debug.reportViewportSubscription(stage, viewport.window, viewport.resourceIds.length)),
        catchError((error) => {
          console.warn(`[PlanningDataService] Failed to update viewport subscription for ${stage}`, error);
          this.deps.debug.reportViewportError(stage, 'Viewport konnte nicht abonniert werden', error);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  handleRealtimeEvent(event: PlanningRealtimeEvent): void {
    if (!event) {
      return;
    }
    const connectionId = this.deps.identity.connectionId();
    const userId = this.deps.identity.userId();
    if (event.sourceConnectionId && event.sourceConnectionId === connectionId) {
      return;
    }
    if (!event.sourceConnectionId && event.sourceClientId === userId) {
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

  syncResources(stage: PlanningStageId, diff: ResourceDiff): void {
    if (!diff.hasChanges) {
      return;
    }
    if (stage === 'base') {
      return;
    }
    this.deps.api
      .batchMutateResources(
        stage,
        {
          upserts: diff.upserts,
          deleteIds: diff.deleteIds,
          clientRequestId: diff.clientRequestId,
        },
        this.deps.currentApiContext(),
      )
      .pipe(
        take(1),
        tap(() => this.deps.debug.reportApiSuccess()),
        catchError((error) => {
          console.error(`[PlanningDataService] Failed to sync resources for ${stage}`, error);
          this.deps.debug.reportApiError('Ressourcen konnten nicht gespeichert werden', error, { stageId: stage });
          this.refreshStage(stage);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  syncActivities(stage: PlanningStageId, diff: ActivityDiff): void {
    if (!diff.hasChanges) {
      return;
    }
    if (stage === 'base') {
      return;
    }
    const stageData = this.deps.stageDataSignal()[stage];
    if (diff.upserts && stageData) {
      diff.upserts = normalizeActivityParticipants(diff.upserts, stageData.resources);
    }
    this.enqueueActivityMutations(stage, diff.upserts ?? [], diff.deleteIds ?? []);
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
    this.deps.stageDataSignal.update((record) => {
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
    const currentStage = this.deps.stageDataSignal()[stageId];
    const currentVersion = currentStage?.version ?? null;
    if (version && currentVersion && version < currentVersion) {
      return;
    }

    const blocked = this.blockedActivityIds(stageId);
    const applyUpserts: Activity[] = [];
    const applyDeletes: string[] = [];
    const deferred = this.deferredRemoteActivityMutations[stageId];

    upserts.forEach((activity) => {
      if (activity.rowVersion) {
        this.rowVersionCache.set(this.rowVersionKey(stageId, activity.id), activity.rowVersion);
      }
      if (blocked.has(activity.id)) {
        const hinted = this.rowVersionHints[stageId].get(activity.id);
        if (hinted) {
          activity = { ...activity, rowVersion: this.maxVersion(activity.rowVersion ?? null, hinted) };
        }
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

    const filtered = this.filterViewportMutations(stageId, applyUpserts, applyDeletes);
    if (!filtered.upserts.length && !filtered.deleteIds.length) {
      // Don't bump stage.version while a local mutation is pending; we'll apply the deferred data once the activity is idle again.
      return;
    }
    this.deps.stageDataSignal.update((record) => {
      const stage = record[stageId];
      if (!stage) {
        return record;
      }
      if (version && stage.version && version < stage.version) {
        return record;
      }
      const normalizedUpserts = normalizeActivityParticipants(filtered.upserts, stage.resources);
      const currentById = new Map(stage.activities.map((activity) => [activity.id, activity.rowVersion ?? null]));
      const filteredUpserts = normalizedUpserts.filter((activity) => {
        const currentVersion = currentById.get(activity.id);
        const incomingVersion = activity.rowVersion ?? null;
        if (!currentVersion || !incomingVersion) {
          return true;
        }
        return incomingVersion >= currentVersion;
      });
      const merged = mergeActivityList(stage.activities, filteredUpserts, filtered.deleteIds);
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
    this.deps.stageDataSignal.update((record) => {
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

  private filterViewportMutations(
    stageId: PlanningStageId,
    upserts: Activity[],
    deleteIds: string[],
  ): { upserts: Activity[]; deleteIds: string[] } {
    const viewport = this.deps.stageViewportSignal()[stageId];
    if (!viewport) {
      return { upserts: [], deleteIds: [] };
    }
    if (!upserts.length && !deleteIds.length) {
      return { upserts, deleteIds };
    }
    const stage = this.deps.stageDataSignal()[stageId];
    const loadedIds = new Set((stage?.activities ?? []).map((activity) => activity.id));
    const deleteSet = new Set(deleteIds);
    const resourceSet = viewport.resourceIds.length ? new Set(viewport.resourceIds) : null;
    const filteredUpserts = upserts.filter((activity) => {
      if (loadedIds.has(activity.id)) {
        return true;
      }
      const matches = this.activityMatchesViewport(activity, viewport.window, resourceSet);
      if (!matches) {
        deleteSet.add(activity.id);
      }
      return matches;
    });
    return {
      upserts: filteredUpserts,
      deleteIds: Array.from(deleteSet),
    };
  }

  private activityMatchesViewport(
    activity: Activity,
    window: PlanningTimelineRange,
    resourceSet: Set<string> | null,
  ): boolean {
    if (!this.activityOverlapsWindow(activity, window)) {
      return false;
    }
    if (!resourceSet || resourceSet.size === 0) {
      return true;
    }
    const participants = activity.participants ?? [];
    if (participants.some((participant) => resourceSet.has(participant.resourceId))) {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const map = attrs?.['service_by_owner'];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      return Object.keys(map as Record<string, unknown>).some((key) => resourceSet.has(key));
    }
    return false;
  }

  private activityOverlapsWindow(activity: Activity, window: PlanningTimelineRange): boolean {
    const startMs = Date.parse(activity.start);
    const endMs = Date.parse(activity.end ?? activity.start ?? '');
    if (!Number.isFinite(startMs)) {
      return false;
    }
    const resolvedEnd = Number.isFinite(endMs) ? endMs : startMs;
    const windowStart = window.start.getTime();
    const windowEnd = window.end.getTime();
    if (resolvedEnd <= windowStart) {
      return false;
    }
    if (startMs >= windowEnd) {
      return false;
    }
    return true;
  }

  private rowVersionKey(stage: PlanningStageId, id: string): string {
    return `${stage}:${id}`;
  }

  private storeRowVersions(stage: PlanningStageId, activities: Activity[]): void {
    activities.forEach((activity) => {
      if (!activity.rowVersion) {
        return;
      }
      this.rowVersionCache.set(this.rowVersionKey(stage, activity.id), activity.rowVersion);
    });
  }

  private mergeRowVersions(stage: PlanningStageId, activities: Activity[]): Activity[] {
    if (!activities.length) {
      return activities;
    }
    const currentById = new Map(
      (this.deps.stageDataSignal()[stage]?.activities ?? []).map((activity) => [activity.id, activity.rowVersion ?? null]),
    );
    let mutated = false;
    const merged = activities.map((activity) => {
      const current = currentById.get(activity.id) ?? null;
      const cached = this.rowVersionCache.get(this.rowVersionKey(stage, activity.id)) ?? null;
      const mergedVersion = this.maxVersion(this.maxVersion(activity.rowVersion ?? null, current), cached);
      if (mergedVersion && mergedVersion !== (activity.rowVersion ?? null)) {
        mutated = true;
        return { ...activity, rowVersion: mergedVersion };
      }
      return activity;
    });
    return mutated ? merged : activities;
  }

  private mergeComputedActivityFields(local: Activity, incoming: Activity): Activity {
    let next = local;
    const incomingMeta = incoming.meta ?? null;
    if (incomingMeta && Object.keys(incomingMeta).length > 0) {
      const mergedMeta = { ...(local.meta ?? {}), ...incomingMeta };
      next = { ...next, meta: mergedMeta };
    }

    const incomingAttrs = incoming.attributes as Record<string, unknown> | undefined;
    if (incomingAttrs) {
      const computedKeys = [
        'service_by_owner',
        'service_conflict_level',
        'service_conflict_codes',
        'service_conflict_details',
      ];
      const mergedAttrs: Record<string, unknown> = { ...(local.attributes ?? {}) };
      let changed = false;
      computedKeys.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(incomingAttrs, key)) {
          return;
        }
        const value = incomingAttrs[key];
        if (mergedAttrs[key] !== value) {
          mergedAttrs[key] = value;
          changed = true;
        }
      });
      if (changed) {
        next = { ...next, attributes: mergedAttrs };
      }
    }

    return next;
  }

  private enqueueActivityMutations(stage: PlanningStageId, upserts: Activity[], deleteIds: string[]): void {
    const pending = this.pendingActivityMutations[stage];
    deleteIds.forEach((id) => {
      pending.upserts.delete(id);
      pending.deleteIds.add(id);
    });
    upserts.forEach((activity) => {
      const hinted = this.rowVersionHints[stage].get(activity.id) ?? null;
      const mergedVersion = this.maxVersion(activity.rowVersion ?? null, hinted);
      const withVersion =
        mergedVersion && mergedVersion !== (activity.rowVersion ?? null)
          ? { ...activity, rowVersion: mergedVersion }
          : activity;
      pending.deleteIds.delete(activity.id);
      pending.upserts.set(activity.id, withVersion);
    });
    this.updateSyncingActivityIds(stage);
    this.flushActivityMutations(stage);
  }

  private flushActivityMutations(stage: PlanningStageId): void {
    if (stage === 'base') {
      return;
    }
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

    const stageData = this.deps.stageDataSignal()[stage];
    const currentRowVersions = new Map(
      (stageData?.activities ?? []).map((activity) => [activity.id, activity.rowVersion ?? null]),
    );
    const hintedVersions = this.rowVersionHints[stage];
    const stageVersion = stageData?.version ?? null;
    const effectiveUpserts = upserts.map((activity) => {
      const current = currentRowVersions.get(activity.id);
      const cached = this.rowVersionCache.get(this.rowVersionKey(stage, activity.id)) ?? null;
      const hinted = hintedVersions.get(activity.id) ?? null;
      const merged = this.maxVersion(
        this.maxVersion(this.maxVersion(this.maxVersion(activity.rowVersion ?? null, current), cached), hinted),
        stageVersion,
      );
      if (merged && merged !== (activity.rowVersion ?? null)) {
        return { ...activity, rowVersion: merged };
      }
      return activity;
    });

    this.inFlightActivityMutations.add(stage);
    this.deps.activityErrorSignal.update((state) => ({ ...state, [stage]: null }));
    const inFlight = this.inFlightActivityMutationIds[stage];
    inFlight.upsertIds = new Set(effectiveUpserts.map((activity) => activity.id));
    inFlight.deleteIds = new Set(deleteIds);
    inFlight.clientRequestId = this.deps.decorateClientRequestId(`activity-sync-${Date.now().toString(36)}`);
    this.updateSyncingActivityIds(stage);
    this.deps.api
      .batchMutateActivities(
        stage,
        {
          upserts: effectiveUpserts,
          deleteIds,
          skipAutopilot: this.skipAutopilot,
          clientRequestId: inFlight.clientRequestId,
        },
        this.deps.currentApiContext(),
      )
      .pipe(
        take(1),
        tap(() => {
          this.deps.activityErrorSignal.update((state) => ({ ...state, [stage]: null }));
        }),
        tap((response) => {
          this.applyMutationResponse(stage, response);
          this.deps.debug.reportApiSuccess();
          this.conflictRetryClientIds[stage] = null;
          this.conflictRetryAttempts[stage] = 0;
        }),
        catchError((error) => {
          console.error(`[PlanningDataService] Failed to sync activities for ${stage}`, error);
          if (this.tryScheduleConflictRetry(stage, error, effectiveUpserts, deleteIds, inFlight.clientRequestId)) {
            return EMPTY;
          }
          this.deps.activityErrorSignal.update((state) => ({ ...state, [stage]: this.describeActivitySyncError(error) }));
          this.deps.debug.reportApiError('Aktivitaeten konnten nicht gespeichert werden', error, { stageId: stage });
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

  private applyMutationResponse(stage: PlanningStageId, response: ActivityBatchMutationResponse): void {
    const pending = this.pendingActivityMutations[stage];
    const pendingUpsertIds = pending.upserts;
    const pendingDeleteIds = pending.deleteIds;

    const rowVersionOnly = new Map<string, string>();
    const computedUpserts = new Map<string, Activity>();

    const applyUpserts: Activity[] = [];
    (response.upserts ?? []).forEach((activity) => {
      if (activity.rowVersion) {
        this.rowVersionCache.set(this.rowVersionKey(stage, activity.id), activity.rowVersion);
      }
      if (pendingDeleteIds.has(activity.id)) {
        return;
      }
      if (pendingUpsertIds.has(activity.id)) {
        const pendingActivity = pendingUpsertIds.get(activity.id) ?? activity;
        let mergedPending = this.mergeComputedActivityFields(pendingActivity, activity);
        if (activity.rowVersion) {
          rowVersionOnly.set(activity.id, activity.rowVersion);
          const mergedVersion = this.maxVersion(pendingActivity.rowVersion ?? null, activity.rowVersion) ?? activity.rowVersion;
          mergedPending =
            mergedVersion && mergedVersion !== (mergedPending.rowVersion ?? null)
              ? { ...mergedPending, rowVersion: mergedVersion }
              : mergedPending;
        }
        if (mergedPending !== pendingActivity) {
          pendingUpsertIds.set(activity.id, mergedPending);
        }
        computedUpserts.set(activity.id, mergedPending);
        return;
      }
      applyUpserts.push(activity);
    });

    const applyDeletes = (response.deletedIds ?? []).filter((id) => !pendingUpsertIds.has(id));
    const filtered = this.filterViewportMutations(stage, [...computedUpserts.values(), ...applyUpserts], applyDeletes);

    this.deps.stageDataSignal.update((record) => {
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
          const mergedVersion =
            this.maxVersion(activity.rowVersion ?? null, incoming) ?? activity.rowVersion ?? incoming;
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

      const normalizedUpserts = filtered.upserts.length
        ? normalizeActivityParticipants(filtered.upserts, stageData.resources)
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

      const merged = mergeActivityList(activities, filteredUpserts, filtered.deleteIds);
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

    const filtered = this.filterViewportMutations(stage, upserts, deleteIds);
    if (!filtered.upserts.length && !filtered.deleteIds.length) {
      return;
    }

    this.deps.stageDataSignal.update((record) => {
      const stageData = record[stage];
      if (!stageData) {
        return record;
      }
      const normalizedUpserts = filtered.upserts.length
        ? normalizeActivityParticipants(filtered.upserts, stageData.resources)
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
      const merged = mergeActivityList(stageData.activities, filteredUpserts, filtered.deleteIds);
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

  private tryScheduleConflictRetry(
    stage: PlanningStageId,
    error: unknown,
    upserts: Activity[],
    deleteIds: string[],
    clientRequestId: string | null,
  ): boolean {
    const conflicts = this.readConflictEntries(error);
    if (!conflicts.length) {
      return false;
    }
    const hasCurrentVersions = conflicts.every((entry) => !!entry.current);
    if (!hasCurrentVersions) {
      return false;
    }
    const attempts = this.conflictRetryAttempts[stage] ?? 0;
    if (attempts >= 3) {
      return false;
    }

    const hintMap = this.rowVersionHints[stage];
    conflicts.forEach((entry) => {
      if (entry.current) {
        hintMap.set(entry.id, entry.current);
      }
    });
    const rowVersions = new Map(conflicts.map((entry) => [entry.id, entry.current as string | null]));
    const patchedUpserts = upserts.map((activity) => {
      const hinted = rowVersions.get(activity.id) ?? null;
      const mergedVersion = this.maxVersion(activity.rowVersion ?? null, hinted);
      return mergedVersion && mergedVersion !== (activity.rowVersion ?? null)
        ? { ...activity, rowVersion: mergedVersion }
        : activity;
    });

    this.applyRowVersionHints(stage, conflicts);
    this.conflictRetryAttempts[stage] = attempts + 1;
    this.conflictRetryClientIds[stage] = clientRequestId ?? 'retry';
    const reason = conflicts.every((entry) => !entry.expected) ? 'missing-version' : 'stale-version';
    this.deps.debug.log('warn', 'api', 'Konflikt erkannt, rowVersion aktualisiert. Retry geplant.', {
      stageId: stage,
      context: { conflictCount: conflicts.length, conflictReason: reason, attempt: attempts + 1 },
    });
    // Pull fresh rowVersions in parallel to the retry so cache and stage data are current.
    this.refreshStage(stage);
    this.enqueueActivityMutations(stage, patchedUpserts, deleteIds);
    return true;
  }

  private readConflictEntries(
    error: unknown,
  ): Array<{ id: string; expected?: string | null; current?: string | null }> {
    const anyError = error as { status?: number; error?: unknown };
    const payload = (anyError?.error ?? {}) as {
      statusCode?: number;
      conflictIds?: string[];
      conflicts?: Array<{ id?: string; expected?: string | null; current?: string | null }>;
    };
    const status = typeof anyError?.status === 'number' ? anyError.status : payload.statusCode;
    if (status !== 409) {
      return [];
    }
    const conflicts = Array.isArray(payload.conflicts) ? payload.conflicts : [];
    return conflicts
      .map((entry) => ({
        id: (entry?.id ?? '').toString(),
        expected: entry?.expected ?? null,
        current: entry?.current ?? null,
      }))
      .filter((entry) => entry.id.length > 0);
  }

  private applyRowVersionHints(
    stage: PlanningStageId,
    conflicts: Array<{ id: string; expected?: string | null; current?: string | null }>,
  ): void {
    const rowVersions = new Map<string, string>();
    conflicts.forEach((entry) => {
      if (entry.current) {
        rowVersions.set(entry.id, entry.current);
        this.rowVersionCache.set(this.rowVersionKey(stage, entry.id), entry.current);
      }
    });
    if (!rowVersions.size) {
      return;
    }
    this.deps.stageDataSignal.update((record) => {
      const stageData = record[stage];
      let mutated = false;
      const nextActivities = stageData.activities.map((activity) => {
        const incoming = rowVersions.get(activity.id);
        if (!incoming) {
          return activity;
        }
        const mergedVersion = this.maxVersion(activity.rowVersion ?? null, incoming) ?? incoming;
        if ((activity.rowVersion ?? null) === mergedVersion) {
          return activity;
        }
        mutated = true;
        return { ...activity, rowVersion: mergedVersion };
      });
      if (!mutated) {
        return record;
      }
      return {
        ...record,
        [stage]: {
          ...stageData,
          activities: nextActivities,
        },
      };
    });
    const hintMap = this.rowVersionHints[stage];
    rowVersions.forEach((version, id) => {
      const existing = hintMap.get(id) ?? null;
      const next = this.maxVersion(existing, version) ?? version;
      hintMap.set(id, next);
    });
  }

  private updateSyncingActivityIds(stage: PlanningStageId): void {
    const pending = this.pendingActivityMutations[stage];
    const inFlight = this.inFlightActivityMutationIds[stage];
    const ids = new Set<string>();
    pending.upserts.forEach((_value, id) => ids.add(id));
    pending.deleteIds.forEach((id) => ids.add(id));
    inFlight.upsertIds.forEach((id) => ids.add(id));
    inFlight.deleteIds.forEach((id) => ids.add(id));
    this.deps.syncingActivityIdsSignal.update((record) => ({
      ...record,
      [stage]: ids,
    }));
  }
}
