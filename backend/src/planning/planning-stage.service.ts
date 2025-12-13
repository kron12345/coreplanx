import {
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

interface StageState {
  stageId: StageId;
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
  private readonly stages = new Map<StageId, StageState>();
  private validationIssueCounter = 0;
  private readonly stageEventSubjects = new Map<
    StageId,
    Subject<PlanningStageRealtimeEvent>
  >();
  private readonly heartbeatIntervalMs = 30000;

  private readonly usingDatabase: boolean;

  constructor(private readonly repository: PlanningRepository) {
    this.usingDatabase = this.repository.isEnabled;
    if (!this.usingDatabase) {
      STAGE_IDS.forEach((stageId) => {
        this.stages.set(stageId, this.createEmptyStage(stageId));
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    await this.initializeStagesFromDatabase();
  }

  getStageSnapshot(stageId: string): PlanningStageSnapshot {
    const stage = this.getStage(stageId);
    return {
      stageId: stage.stageId,
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

  listActivities(stageId: string, filters: ActivityFilters = {}): Activity[] {
    const stage = this.getStage(stageId);
    const filtered = this.applyActivityFilters(stage.activities, filters);
    return filtered.map((activity) => this.cloneActivity(activity));
  }

  listResources(stageId: string): Resource[] {
    const stage = this.getStage(stageId);
    return stage.resources.map((resource) => this.cloneResource(resource));
  }

  async mutateActivities(
    stageId: string,
    request?: ActivityMutationRequest,
  ): Promise<ActivityMutationResponse> {
    const stage = this.getStage(stageId);
    const previousTimeline = { ...stage.timelineRange };
    const upserts = request?.upserts ?? [];
    const deleteIds = new Set(request?.deleteIds ?? []);
    const appliedUpserts: string[] = [];
    const deletedIds: string[] = [];

    upserts.forEach((incoming) => {
      this.upsertActivity(stage, incoming);
      appliedUpserts.push(incoming.id);
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

    stage.version = this.nextVersion();
    stage.timelineRange = this.computeTimelineRange(stage.activities, stage.timelineRange);
    const timelineChanged =
      previousTimeline.start !== stage.timelineRange.start ||
      previousTimeline.end !== stage.timelineRange.end;

    const activitySnapshots = appliedUpserts.length
      ? this.collectActivitySnapshots(stage, appliedUpserts)
      : [];

    const sourceContext = this.extractSourceContext(request?.clientRequestId);
    if (appliedUpserts.length || deletedIds.length) {
      this.emitStageEvent(stage.stageId, {
        stageId: stage.stageId,
        scope: 'activities',
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        upserts: activitySnapshots.length ? activitySnapshots : undefined,
        deleteIds: deletedIds.length ? [...deletedIds] : undefined,
      });
    }
    if (timelineChanged) {
      this.emitTimelineEvent(stage, sourceContext);
    }

    if (this.usingDatabase) {
      await this.repository.applyActivityMutations(
        stage.stageId,
        activitySnapshots,
        deletedIds,
      );
      await this.repository.updateStageMetadata(
        stage.stageId,
        stage.timelineRange,
        stage.version,
      );
    }

    return {
      appliedUpserts,
      deletedIds,
      version: stage.version,
    };
  }

  validateActivities(
    stageId: string,
    request?: ActivityValidationRequest,
  ): ActivityValidationResponse {
    const stage = this.getStage(stageId);
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
    _userId?: string,
    _connectionId?: string,
  ): Observable<PlanningStageRealtimeEvent> {
    const stage = this.getStage(stageId);
    const subject = this.getStageEventSubject(stage.stageId);
    return new Observable<PlanningStageRealtimeEvent>((subscriber) => {
      const subscription = subject.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      subscriber.next(this.createTimelineEvent(stage));
      const heartbeat = setInterval(() => {
        const currentStage = this.getStage(stage.stageId);
        subscriber.next(this.createTimelineEvent(currentStage));
      }, this.heartbeatIntervalMs);
      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }

  async mutateResources(
    stageId: string,
    request?: ResourceMutationRequest,
  ): Promise<ResourceMutationResponse> {
    const stage = this.getStage(stageId);
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
      this.emitStageEvent(stage.stageId, {
        stageId: stage.stageId,
        scope: 'resources',
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        upserts: resourceSnapshots.length ? resourceSnapshots : undefined,
        deleteIds: deletedIds.length ? [...deletedIds] : undefined,
      });
    }
    if (orphanedActivityIds.length) {
      this.emitStageEvent(stage.stageId, {
        stageId: stage.stageId,
        scope: 'activities',
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        deleteIds: [...orphanedActivityIds],
      });
    }
    if (timelineChanged) {
      this.emitTimelineEvent(stage, sourceContext);
    }

    if (this.usingDatabase) {
      await this.repository.applyResourceMutations(stage.stageId, resourceSnapshots, deletedIds);
      if (orphanedActivityIds.length) {
        await this.repository.deleteActivities(stage.stageId, orphanedActivityIds);
      }
      await this.repository.updateStageMetadata(stage.stageId, stage.timelineRange, stage.version);
    }

    return {
      appliedUpserts,
      deletedIds,
      version: stage.version,
    };
  }

  private async initializeStagesFromDatabase(): Promise<void> {
    for (const stageId of STAGE_IDS) {
      await this.loadStageFromDatabase(stageId);
    }
  }

  private async loadStageFromDatabase(stageId: StageId): Promise<void> {
    try {
      const data = await this.repository.loadStageData(stageId);
      if (!data) {
        const emptyStage = this.createEmptyStage(stageId);
        this.stages.set(stageId, emptyStage);
        await this.repository.updateStageMetadata(
          stageId,
          emptyStage.timelineRange,
          emptyStage.version,
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
        resources: data.resources.map((resource) => this.cloneResource(resource)),
        activities: data.activities.map((activity) => this.cloneActivity(activity)),
        trainRuns: data.trainRuns.map((run) => this.cloneTrainRun(run)),
        trainSegments: data.trainSegments.map((segment) => this.cloneTrainSegment(segment)),
        timelineRange,
        version,
      };
      this.stages.set(stageId, stage);

      if (
        !data.timelineRange ||
        data.timelineRange.start !== timelineRange.start ||
        data.timelineRange.end !== timelineRange.end ||
        data.version !== version
      ) {
        await this.repository.updateStageMetadata(stageId, timelineRange, version);
      }
    } catch (error) {
      this.logger.error(
        `Stage ${stageId} konnte nicht aus der Datenbank geladen werden – verwende eine leere Stage.`,
        (error as Error).stack ?? String(error),
      );
      this.stages.set(stageId, this.createEmptyStage(stageId));
    }
  }

  private createEmptyStage(stageId: StageId): StageState {
    return {
      stageId,
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

  private getStageEventSubject(stageId: StageId): Subject<PlanningStageRealtimeEvent> {
    const existing = this.stageEventSubjects.get(stageId);
    if (existing) {
      return existing;
    }
    const subject = new Subject<PlanningStageRealtimeEvent>();
    this.stageEventSubjects.set(stageId, subject);
    return subject;
  }

  private emitStageEvent(stageId: StageId, event: PlanningStageRealtimeEvent): void {
    const subject = this.getStageEventSubject(stageId);
    subject.next(event);
  }

  private emitTimelineEvent(stage: StageState, sourceContext?: SourceContext): void {
    this.emitStageEvent(stage.stageId, this.createTimelineEvent(stage, sourceContext));
  }

  private createTimelineEvent(
    stage: StageState,
    sourceContext?: SourceContext,
  ): PlanningStageRealtimeEvent {
    return {
      stageId: stage.stageId,
      scope: 'timeline',
      version: stage.version,
      sourceClientId: sourceContext?.userId,
      sourceConnectionId: sourceContext?.connectionId,
      timelineRange: { ...stage.timelineRange },
    };
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

  private getStage(stageIdValue: string): StageState {
    if (!isStageId(stageIdValue)) {
      throw new NotFoundException(`Stage ${stageIdValue} ist unbekannt.`);
    }
    const stage = this.stages.get(stageIdValue);
    if (!stage) {
      throw new NotFoundException(`Stage ${stageIdValue} ist nicht initialisiert.`);
    }
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

    return activities.filter((activity) => {
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

