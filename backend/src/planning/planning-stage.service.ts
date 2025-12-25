import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type {
  Activity,
  ActivityFilters,
  ActivityMutationRequest,
  ActivityMutationResponse,
  ActivityValidationIssue,
  ActivityValidationRequest,
  ActivityValidationResponse,
  PlanningVariantId,
  PlanningStageRealtimeEvent,
  PlanningStageSnapshot,
  Resource,
  ResourceMutationRequest,
  ResourceMutationResponse,
  StageId,
  TimelineRange,
  TrainRun,
  TrainSegment,
} from './planning.types';
import { STAGE_IDS, isStageId } from './planning.types';
import { PlanningRepository } from './planning.repository';
import { DutyAutopilotService } from './duty-autopilot.service';

const DEFAULT_VARIANT_ID: PlanningVariantId = 'default';

interface StageState {
  stageId: StageId;
  variantId: PlanningVariantId;
  timetableYearLabel?: string | null;
  resources: Resource[];
  activities: Activity[];
  trainRuns: TrainRun[];
  trainSegments: TrainSegment[];
  timelineRange: TimelineRange;
  version: string | null;
}

interface SourceContext {
  userId?: string;
  connectionId?: string;
}

@Injectable()
export class PlanningStageService implements OnModuleInit {
  private readonly logger = new Logger(PlanningStageService.name);
  private readonly stages = new Map<string, StageState>();
  private validationIssueCounter = 0;
  private readonly stageEventSubjects = new Map<string, Subject<PlanningStageRealtimeEvent>>();
  private readonly heartbeatIntervalMs = 30000;

  private readonly usingDatabase: boolean;

  constructor(
    private readonly repository: PlanningRepository,
    private readonly dutyAutopilot: DutyAutopilotService,
  ) {
    this.usingDatabase = this.repository.isEnabled;
    if (!this.usingDatabase) {
      STAGE_IDS.forEach((stageId) => {
        const stage = this.createEmptyStage(stageId, DEFAULT_VARIANT_ID);
        this.stages.set(this.stageKey(stageId, DEFAULT_VARIANT_ID), stage);
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    await this.initializeStagesFromDatabase(DEFAULT_VARIANT_ID);
  }

  async getStageSnapshot(
    stageId: string,
    variantId: string,
    timetableYearLabel?: string | null,
  ): Promise<PlanningStageSnapshot> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    return {
      stageId: stage.stageId,
      variantId: stage.variantId,
      timetableYearLabel: stage.timetableYearLabel ?? undefined,
      resources: stage.resources.map((resource) => this.cloneResource(resource)),
      activities: stage.activities.map((activity) => this.cloneActivity(activity)),
      trainRuns: stage.trainRuns.map((run) => this.cloneTrainRun(run)),
      trainSegments: stage.trainSegments.map((segment) =>
        this.cloneTrainSegment(segment),
      ),
      timelineRange: { ...stage.timelineRange },
      version: stage.version,
    };
  }

  async listActivities(
    stageId: string,
    variantId: string,
    filters: ActivityFilters = {},
    timetableYearLabel?: string | null,
  ): Promise<Activity[]> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    const filtered = this.applyActivityFilters(stage.activities, filters);
    return filtered.map((activity) => this.cloneActivity(activity));
  }

  async listResources(
    stageId: string,
    variantId: string,
    timetableYearLabel?: string | null,
  ): Promise<Resource[]> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    return stage.resources.map((resource) => this.cloneResource(resource));
  }

  async mutateActivities(
    stageId: string,
    variantId: string,
    request?: ActivityMutationRequest,
    timetableYearLabel?: string | null,
  ): Promise<ActivityMutationResponse> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    const previousTimeline = { ...stage.timelineRange };
    const upserts = request?.upserts ?? [];
    const deleteIds = new Set(request?.deleteIds ?? []);
    const appliedUpserts: string[] = [];
    const deletedIds: string[] = [];
    const changedUpsertIds = new Set<string>();

    if (upserts.length) {
      const existingById = new Map(stage.activities.map((activity) => [activity.id, activity]));
      const conflicts: { id: string; expected: string | null; current: string | null }[] = [];
      upserts.forEach((incoming) => {
        const current = existingById.get(incoming.id);
        if (!current) {
          return;
        }
        const currentVersion = current.rowVersion ?? null;
        const expectedVersion = incoming.rowVersion ?? null;
        if (currentVersion && expectedVersion !== currentVersion) {
          conflicts.push({ id: incoming.id, expected: expectedVersion, current: currentVersion });
        }
      });
      if (conflicts.length) {
        throw new ConflictException({
          message: 'Aktivität wurde zwischenzeitlich geändert. Bitte neu laden.',
          conflictIds: conflicts.map((entry) => entry.id),
          conflicts,
          error: 'Conflict',
          statusCode: 409,
        });
      }
    }

    upserts.forEach((incoming) => {
      this.upsertActivity(stage, incoming);
      appliedUpserts.push(incoming.id);
      changedUpsertIds.add(incoming.id);
      deleteIds.delete(incoming.id);
    });

    if (deleteIds.size > 0) {
      stage.activities = stage.activities.filter((activity) => {
        if (deleteIds.has(activity.id)) {
          deletedIds.push(activity.id);
          return false;
        }
        return true;
      });
    }

    const autopilot = await this.dutyAutopilot.apply(stage.stageId, stage.variantId, stage.activities);
    if (autopilot.upserts.length) {
      autopilot.upserts.forEach((activity) => {
        this.upsertActivity(stage, activity);
        changedUpsertIds.add(activity.id);
      });
    }
    if (autopilot.deletedIds.length) {
      const toDelete = new Set(autopilot.deletedIds);
      stage.activities = stage.activities.filter((activity) => {
        if (toDelete.has(activity.id)) {
          deletedIds.push(activity.id);
          return false;
        }
        return true;
      });
    }

    stage.version = this.nextVersion();
    if (changedUpsertIds.size) {
      const rowVersion = stage.version;
      stage.activities = stage.activities.map((activity) =>
        changedUpsertIds.has(activity.id) ? { ...activity, rowVersion } : activity,
      );
    }
    stage.timelineRange = this.computeTimelineRange(stage.activities, stage.timelineRange);
    const timelineChanged =
      previousTimeline.start !== stage.timelineRange.start ||
      previousTimeline.end !== stage.timelineRange.end;

    const activitySnapshots = changedUpsertIds.size
      ? this.collectActivitySnapshots(stage, Array.from(changedUpsertIds))
      : [];

    const sourceContext = this.extractSourceContext(request?.clientRequestId);
    if (changedUpsertIds.size || deletedIds.length) {
      this.emitStageEvent(stage, {
        scope: 'activities',
        clientRequestId: request?.clientRequestId ?? undefined,
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        upserts: activitySnapshots.length ? activitySnapshots : undefined,
        deleteIds: deletedIds.length ? [...deletedIds] : undefined,
      });
    }
    if (timelineChanged) {
      this.emitTimelineEvent(stage, sourceContext, request?.clientRequestId);
    }

    if (this.usingDatabase) {
      await this.repository.applyActivityMutations(
        stage.stageId,
        stage.variantId,
        activitySnapshots,
        deletedIds,
      );
      await this.repository.updateStageMetadata(
        stage.stageId,
        stage.variantId,
        stage.timelineRange,
        stage.version,
      );
    }

    return {
      appliedUpserts,
      deletedIds,
      upserts: activitySnapshots.length ? activitySnapshots : undefined,
      version: stage.version,
      clientRequestId: request?.clientRequestId,
    };
  }

  async validateActivities(
    stageId: string,
    variantId: string,
    request?: ActivityValidationRequest,
    timetableYearLabel?: string | null,
  ): Promise<ActivityValidationResponse> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    const filters: ActivityFilters = {
      from: request?.windowStart,
      to: request?.windowEnd,
      resourceIds: request?.resourceIds,
    };

    let selected = this.applyActivityFilters(stage.activities, filters);
    if (request?.activityIds?.length) {
      const ids = new Set(request.activityIds);
      selected = selected.filter((activity) => ids.has(activity.id));
    }

    const issues = this.detectOverlapIssues(selected);

    return {
      generatedAt: this.nextVersion(),
      issues,
    };
  }

  streamStageEvents(
    stageId: string,
    variantId: string,
    userId?: string,
    connectionId?: string,
    timetableYearLabel?: string | null,
  ): Observable<PlanningStageRealtimeEvent> {
    return new Observable<PlanningStageRealtimeEvent>((subscriber) => {
      let subscription: { unsubscribe: () => void } | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      this.getStage(stageId, variantId, timetableYearLabel)
        .then((stage) => {
          const subject = this.getStageEventSubject(stage.stageId, stage.variantId);
          subscription = subject.subscribe({
            next: (event) => subscriber.next(event),
            error: (error) => subscriber.error(error),
            complete: () => subscriber.complete(),
          });
          subscriber.next(this.createTimelineEvent(stage, { userId, connectionId }));
          heartbeat = setInterval(() => {
            const key = this.stageKey(stage.stageId, stage.variantId);
            const currentStage = this.stages.get(key);
            if (!currentStage) {
              return;
            }
            subscriber.next(this.createTimelineEvent(currentStage, { userId, connectionId }));
          }, this.heartbeatIntervalMs);
        })
        .catch((error) => subscriber.error(error));

      return () => {
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        subscription?.unsubscribe();
      };
    });
  }

  async mutateResources(
    stageId: string,
    variantId: string,
    request?: ResourceMutationRequest,
    timetableYearLabel?: string | null,
  ): Promise<ResourceMutationResponse> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    const previousTimeline = { ...stage.timelineRange };
    const upserts = request?.upserts ?? [];
    const deleteIds = new Set(request?.deleteIds ?? []);
    const appliedUpserts: string[] = [];
    const deletedIds: string[] = [];

    upserts.forEach((incoming) => {
      this.upsertResource(stage, incoming);
      appliedUpserts.push(incoming.id);
      deleteIds.delete(incoming.id);
    });

    if (deleteIds.size > 0) {
      stage.resources = stage.resources.filter((resource) => {
        if (deleteIds.has(resource.id)) {
          deletedIds.push(resource.id);
          return false;
        }
        return true;
      });
    }

    const deletedSet = deletedIds.length ? new Set(deletedIds) : undefined;
    let activitiesChanged = false;
    const orphanedActivityIds: string[] = [];
    if (deletedSet) {
      const originalLength = stage.activities.length;
      // Drop Aktivitäten ohne gültige Ressource, damit der Snapshot konsistent bleibt.
      stage.activities = stage.activities.filter((activity) => {
        const participants = activity.participants ?? [];
        if (
          participants.length > 0 &&
          participants.every((participant) => deletedSet.has(participant.resourceId))
        ) {
          orphanedActivityIds.push(activity.id);
          return false;
        }
        return true;
      });
      activitiesChanged = stage.activities.length !== originalLength;
    }

    stage.version = this.nextVersion();
    let timelineChanged = false;
    if (activitiesChanged) {
      stage.timelineRange = this.computeTimelineRange(stage.activities, stage.timelineRange);
      timelineChanged =
        previousTimeline.start !== stage.timelineRange.start ||
        previousTimeline.end !== stage.timelineRange.end;
    }

    const resourceSnapshots = appliedUpserts.length
      ? this.collectResourceSnapshots(stage, appliedUpserts)
      : [];

    const sourceContext = this.extractSourceContext(request?.clientRequestId);
    if (appliedUpserts.length || deletedIds.length) {
      this.emitStageEvent(stage, {
        scope: 'resources',
        clientRequestId: request?.clientRequestId ?? undefined,
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        upserts: resourceSnapshots.length ? resourceSnapshots : undefined,
        deleteIds: deletedIds.length ? [...deletedIds] : undefined,
      });
    }
    if (orphanedActivityIds.length) {
      this.emitStageEvent(stage, {
        scope: 'activities',
        clientRequestId: request?.clientRequestId ?? undefined,
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        deleteIds: [...orphanedActivityIds],
      });
    }
    if (timelineChanged) {
      this.emitTimelineEvent(stage, sourceContext, request?.clientRequestId);
    }

    if (this.usingDatabase) {
      await this.repository.applyResourceMutations(stage.stageId, stage.variantId, resourceSnapshots, deletedIds);
      if (orphanedActivityIds.length) {
        await this.repository.deleteActivities(stage.stageId, stage.variantId, orphanedActivityIds);
      }
      await this.repository.updateStageMetadata(stage.stageId, stage.variantId, stage.timelineRange, stage.version);
    }

    return {
      appliedUpserts,
      deletedIds,
      version: stage.version,
      clientRequestId: request?.clientRequestId,
    };
  }

  private stageKey(stageId: StageId, variantId: PlanningVariantId): string {
    return `${stageId}::${variantId}`;
  }

  private normalizeVariantId(value?: string | null): PlanningVariantId {
    const trimmed = value?.trim();
    return trimmed ? trimmed : DEFAULT_VARIANT_ID;
  }

  private async initializeStagesFromDatabase(variantId: PlanningVariantId): Promise<void> {
    for (const stageId of STAGE_IDS) {
      await this.loadStageFromDatabase(stageId, variantId);
    }
  }

  private async loadStageFromDatabase(
    stageId: StageId,
    variantId: PlanningVariantId,
    timetableYearLabel?: string | null,
  ): Promise<void> {
    const key = this.stageKey(stageId, variantId);
    try {
      const data = await this.repository.loadStageData(stageId, variantId);
      if (!data) {
        const emptyStage = this.createEmptyStage(stageId, variantId, timetableYearLabel);
        this.stages.set(key, emptyStage);
        await this.repository.updateStageMetadata(
          stageId,
          variantId,
          emptyStage.timelineRange,
          emptyStage.version,
          timetableYearLabel ?? null,
        );
        return;
      }

      const timelineRange = this.computeTimelineRange(
        data.activities,
        data.timelineRange ?? this.defaultTimelineRange(),
      );
      const version = data.version ?? this.nextVersion();
      const stage: StageState = {
        stageId,
        variantId,
        timetableYearLabel: data.timetableYearLabel ?? timetableYearLabel ?? null,
        resources: data.resources.map((resource) => this.cloneResource(resource)),
        activities: data.activities.map((activity) => this.cloneActivity(activity)),
        trainRuns: data.trainRuns.map((run) => this.cloneTrainRun(run)),
        trainSegments: data.trainSegments.map((segment) => this.cloneTrainSegment(segment)),
        timelineRange,
        version,
      };
      this.stages.set(key, stage);

      if (
        !data.timelineRange ||
        data.timelineRange.start !== timelineRange.start ||
        data.timelineRange.end !== timelineRange.end ||
        data.version !== version
      ) {
        await this.repository.updateStageMetadata(
          stageId,
          variantId,
          timelineRange,
          version,
          stage.timetableYearLabel ?? null,
        );
      }
    } catch (error) {
      this.logger.error(
        `Stage ${stageId} (${variantId}) konnte nicht aus der Datenbank geladen werden – verwende eine leere Stage.`,
        (error as Error).stack ?? String(error),
      );
      this.stages.set(key, this.createEmptyStage(stageId, variantId, timetableYearLabel));
    }
  }

  private createEmptyStage(
    stageId: StageId,
    variantId: PlanningVariantId,
    timetableYearLabel?: string | null,
  ): StageState {
    return {
      stageId,
      variantId,
      timetableYearLabel: timetableYearLabel ?? null,
      resources: [],
      activities: [],
      trainRuns: [],
      trainSegments: [],
      timelineRange: this.defaultTimelineRange(),
      version: this.nextVersion(),
    };
  }

  private cloneResource(resource: Resource): Resource {
    return {
      ...resource,
      attributes: resource.attributes ? { ...resource.attributes } : undefined,
    };
  }

  private cloneActivity(activity: Activity): Activity {
    return {
      ...activity,
      requiredQualifications: activity.requiredQualifications
        ? [...activity.requiredQualifications]
        : undefined,
      assignedQualifications: activity.assignedQualifications
        ? [...activity.assignedQualifications]
        : undefined,
      workRuleTags: activity.workRuleTags ? [...activity.workRuleTags] : undefined,
      participants: activity.participants
        ? activity.participants.map((participant) => ({ ...participant }))
        : undefined,
      attributes: activity.attributes ? { ...activity.attributes } : undefined,
      meta: activity.meta ? { ...activity.meta } : undefined,
    };
  }

  private cloneTrainRun(run: TrainRun): TrainRun {
    return {
      ...run,
      attributes: run.attributes ? { ...run.attributes } : undefined,
    };
  }

  private cloneTrainSegment(segment: TrainSegment): TrainSegment {
    return {
      ...segment,
      attributes: segment.attributes ? { ...segment.attributes } : undefined,
    };
  }

  private getStageEventSubject(stageId: StageId, variantId: PlanningVariantId): Subject<PlanningStageRealtimeEvent> {
    const key = this.stageKey(stageId, variantId);
    const existing = this.stageEventSubjects.get(key);
    if (existing) {
      return existing;
    }
    const subject = new Subject<PlanningStageRealtimeEvent>();
    this.stageEventSubjects.set(key, subject);
    return subject;
  }

  private buildStageEvent(
    stage: StageState,
    event: Omit<PlanningStageRealtimeEvent, 'stageId' | 'variantId'>,
  ): PlanningStageRealtimeEvent {
    return {
      stageId: stage.stageId,
      variantId: stage.variantId,
      ...event,
    };
  }

  private emitStageEvent(
    stage: StageState,
    event: Omit<PlanningStageRealtimeEvent, 'stageId' | 'variantId'>,
  ): void {
    const subject = this.getStageEventSubject(stage.stageId, stage.variantId);
    subject.next(this.buildStageEvent(stage, event));
  }

  private emitTimelineEvent(
    stage: StageState,
    sourceContext?: SourceContext,
    clientRequestId?: string,
  ): void {
    this.emitStageEvent(stage, {
      scope: 'timeline',
      clientRequestId: clientRequestId ?? undefined,
      version: stage.version,
      sourceClientId: sourceContext?.userId,
      sourceConnectionId: sourceContext?.connectionId,
      timelineRange: { ...stage.timelineRange },
    });
  }

  private createTimelineEvent(
    stage: StageState,
    sourceContext?: SourceContext,
  ): PlanningStageRealtimeEvent {
    return this.buildStageEvent(stage, {
      scope: 'timeline',
      version: stage.version,
      sourceClientId: sourceContext?.userId,
      sourceConnectionId: sourceContext?.connectionId,
      timelineRange: { ...stage.timelineRange },
    });
  }

  private collectResourceSnapshots(stage: StageState, ids: string[]): Resource[] {
    return ids
      .map((id) => stage.resources.find((resource) => resource.id === id))
      .filter((resource): resource is Resource => Boolean(resource))
      .map((resource) => this.cloneResource(resource));
  }

  private collectActivitySnapshots(stage: StageState, ids: string[]): Activity[] {
    return ids
      .map((id) => stage.activities.find((activity) => activity.id === id))
      .filter((activity): activity is Activity => Boolean(activity))
      .map((activity) => this.cloneActivity(activity));
  }

  private extractSourceContext(clientRequestId?: string): SourceContext {
    if (!clientRequestId) {
      return {};
    }
    const segments = clientRequestId.split('|');
    const [userId, connectionId] = segments;
    return {
      userId: userId || undefined,
      connectionId: connectionId || undefined,
    };
  }

  private async getStage(
    stageIdValue: string,
    variantIdValue: string,
    timetableYearLabel?: string | null,
  ): Promise<StageState> {
    if (!isStageId(stageIdValue)) {
      throw new NotFoundException(`Stage ${stageIdValue} ist unbekannt.`);
    }
    const stageId = stageIdValue as StageId;
    const variantId = this.normalizeVariantId(variantIdValue);
    const key = this.stageKey(stageId, variantId);
    const existing = this.stages.get(key);
    if (existing) {
      return existing;
    }
    if (this.usingDatabase) {
      await this.loadStageFromDatabase(stageId, variantId, timetableYearLabel);
      const loaded = this.stages.get(key);
      if (loaded) {
        return loaded;
      }
      throw new NotFoundException(`Stage ${stageId} (${variantId}) ist nicht initialisiert.`);
    }
    const stage = this.createEmptyStage(stageId, variantId, timetableYearLabel);
    this.stages.set(key, stage);
    return stage;
  }

  private applyActivityFilters(
    activities: Activity[],
    filters: ActivityFilters = {},
  ): Activity[] {
    const fromMs = this.parseIso(filters.from);
    const toMs = this.parseIso(filters.to);
    const resourceFilter = filters.resourceIds?.length
      ? new Set(filters.resourceIds)
      : undefined;

    const filtered = activities.filter((activity) => {
      if (resourceFilter) {
        const participants = activity.participants ?? [];
        const matchesResource = participants.some((participant) =>
          resourceFilter.has(participant.resourceId),
        );
        if (!matchesResource) {
          return false;
        }
      }

      const startMs = this.parseIso(activity.start);
      const endMs = this.parseIso(activity.end ?? activity.start ?? '');

      if (fromMs !== undefined && endMs !== undefined && endMs <= fromMs) {
        return false;
      }

      if (toMs !== undefined && startMs !== undefined && startMs >= toMs) {
        return false;
      }

      return true;
    });

    // Ensure duties remain renderable even when the caller only loads a viewport slice.
    // When a payload activity intersects the window, we include its service boundaries/breaks as well.
    const hasWindow = !!filters.from || !!filters.to;
    if (!hasWindow || filtered.length === 0) {
      return filtered;
    }

    const serviceIds = new Set<string>();
    const addServiceId = (value: unknown) => {
      const id = typeof value === 'string' ? value.trim() : '';
      if (id.startsWith('svc:')) {
        serviceIds.add(id);
      }
    };
    filtered.forEach((activity) => {
      addServiceId(activity.serviceId);
      const attrs = activity.attributes as Record<string, unknown> | undefined;
      const map = attrs?.['service_by_owner'];
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        Object.entries(map as Record<string, any>).forEach(([ownerId, entry]) => {
          if (resourceFilter && !resourceFilter.has(ownerId)) {
            return;
          }
          addServiceId((entry as any)?.serviceId);
        });
      }
    });
    if (serviceIds.size === 0) {
      return filtered;
    }

    const expanded = new Map<string, Activity>();
    filtered.forEach((activity) => expanded.set(activity.id, activity));
    const isManagedServiceId = (id: string) =>
      id.startsWith('svcstart:') || id.startsWith('svcend:') || id.startsWith('svcbreak:');
    activities.forEach((activity) => {
      if (!isManagedServiceId(activity.id)) {
        return;
      }
      if (!activity.serviceId) {
        return;
      }
      if (!serviceIds.has(activity.serviceId)) {
        return;
      }
      expanded.set(activity.id, activity);
    });

    return Array.from(expanded.values());
  }

  private upsertActivity(stage: StageState, incoming: Activity): void {
    const clone = this.cloneActivity(incoming);
    const index = stage.activities.findIndex((activity) => activity.id === incoming.id);
    if (index >= 0) {
      stage.activities[index] = clone;
    } else {
      stage.activities.push(clone);
    }
  }

  private upsertResource(stage: StageState, incoming: Resource): void {
    const clone = this.cloneResource(incoming);
    const index = stage.resources.findIndex((resource) => resource.id === incoming.id);
    if (index >= 0) {
      stage.resources[index] = clone;
    } else {
      stage.resources.push(clone);
    }
  }

  private detectOverlapIssues(activities: Activity[]): ActivityValidationIssue[] {
    const byResource = new Map<string, Activity[]>();
    activities.forEach((activity) => {
      const participants = activity.participants ?? [];
      participants.forEach((participant) => {
        const collection = byResource.get(participant.resourceId) ?? [];
        collection.push(activity);
        byResource.set(participant.resourceId, collection);
      });
    });

    const issues: ActivityValidationIssue[] = [];
    byResource.forEach((list, resourceId) => {
      const sorted = [...list].sort(
        (a, b) => (this.parseIso(a.start) ?? 0) - (this.parseIso(b.start) ?? 0),
      );
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (this.activitiesOverlap(previous, current)) {
          this.validationIssueCounter += 1;
          issues.push({
            id: `working-time-${resourceId}-${this.validationIssueCounter}`,
            rule: 'working-time',
            severity: 'warning',
            message: `Aktivitäten ${previous.id} und ${current.id} überschneiden sich auf Ressource ${resourceId}.`,
            activityIds: [previous.id, current.id],
            meta: { resourceId },
          });
        }
      }
    });
    return issues;
  }

  private activitiesOverlap(a: Activity, b: Activity): boolean {
    const aStart = this.parseIso(a.start) ?? 0;
    const aEnd = this.parseIso(a.end ?? a.start ?? '') ?? aStart;
    const bStart = this.parseIso(b.start) ?? 0;
    const bEnd = this.parseIso(b.end ?? b.start ?? '') ?? bStart;

    return aStart < bEnd && bStart < aEnd;
  }

  private computeTimelineRange(activities: Activity[], fallback: TimelineRange): TimelineRange {
    if (!activities.length) {
      return { ...fallback };
    }
    const starts: number[] = [];
    const ends: number[] = [];
    activities.forEach((activity) => {
      const startMs = this.parseIso(activity.start);
      if (startMs !== undefined) {
        starts.push(startMs);
      }
      const endMs = this.parseIso(activity.end ?? activity.start ?? '');
      if (endMs !== undefined) {
        ends.push(endMs);
      }
    });
    if (!starts.length || !ends.length) {
      return { ...fallback };
    }
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    return {
      start: new Date(min).toISOString(),
      end: new Date(max).toISOString(),
    };
  }

  private defaultTimelineRange(): TimelineRange {
    return {
      start: '2025-03-01T06:00:00.000Z',
      end: '2025-03-01T18:00:00.000Z',
    };
  }

  private parseIso(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
  }

  private nextVersion(): string {
    return new Date().toISOString();
  }
}
