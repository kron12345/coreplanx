import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
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
  PlanningStageViewportSubscriptionRequest,
  PlanningStageViewportSubscriptionResponse,
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
import { PlanningActivityCatalogService } from './planning-activity-catalog.service';
import { DebugStreamService } from '../debug/debug-stream.service';

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

interface StageViewportSubscription {
  userId: string;
  connectionId: string;
  from: string;
  to: string;
  resourceIds?: string[];
  updatedAt: string;
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
  private readonly stageViewportSubscriptions = new Map<string, Map<string, StageViewportSubscription>>();
  private readonly heartbeatIntervalMs = 30000;
  private activityTypeRequirements:
    | Map<string, { requiresVehicle: boolean; isVehicleOn: boolean; isVehicleOff: boolean }>
    | null = null;

  private readonly usingDatabase: boolean;

  constructor(
    private readonly repository: PlanningRepository,
    private readonly dutyAutopilot: DutyAutopilotService,
    private readonly activityCatalog: PlanningActivityCatalogService,
    @Optional()
    @Inject(DebugStreamService)
    private readonly debugStream?: DebugStreamService,
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
    const worktimeByService = this.computeServiceWorktimeByService(stage.activities);
    return {
      stageId: stage.stageId,
      variantId: stage.variantId,
      timetableYearLabel: stage.timetableYearLabel ?? undefined,
      resources: stage.resources.map((resource) => this.cloneResource(resource)),
      activities: stage.activities.map((activity) =>
        this.attachServiceWorktime(this.cloneActivity(activity), worktimeByService),
      ),
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
    const worktimeByService = this.computeServiceWorktimeByService(stage.activities);
    const filtered = this.applyActivityFilters(stage.activities, filters);
    return filtered.map((activity) =>
      this.attachServiceWorktime(this.cloneActivity(activity), worktimeByService),
    );
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
    requestId?: string,
  ): Promise<ActivityMutationResponse> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    const previousTimeline = { ...stage.timelineRange };
    const previousActivities = stage.activities.slice();
    const previousVersion = stage.version;
    const upserts = request?.upserts ?? [];
    const deleteIds = new Set(request?.deleteIds ?? []);
    const appliedUpserts: string[] = [];
    const deletedIds: string[] = [];
    const changedUpsertIds = new Set<string>();
    const requestedUpsertIds = new Set<string>(upserts.map((activity) => activity.id));
    const requestedDeleteIds = new Set<string>();
    const complianceUpdatedIds = new Set<string>();
    const previousById = new Map(previousActivities.map((activity) => [activity.id, activity]));
    const sourceContext = this.extractSourceContext(request?.clientRequestId);

    try {
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
          this.debugStream?.log(
            'warn',
            'planning',
            'Aktivitaeten-Konflikt beim Speichern',
            {
              stageId,
              variantId,
              requestId,
              clientRequestId: request?.clientRequestId ?? null,
              conflictIds: conflicts.map((entry) => entry.id),
              conflictCount: conflicts.length,
            },
            {
              userId: sourceContext.userId,
              connectionId: sourceContext.connectionId,
              stageId,
            },
          );
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
        const sanitized = this.stripComputedActivityMeta(incoming);
        this.upsertActivity(stage, sanitized);
        appliedUpserts.push(sanitized.id);
        changedUpsertIds.add(sanitized.id);
        deleteIds.delete(incoming.id);
      });

      this.assertManagedActivityDeletes(
        stage.stageId,
        stage.variantId,
        Array.from(deleteIds.values()),
        sourceContext,
        requestId,
        request?.clientRequestId ?? null,
      );

      if (deleteIds.size > 0) {
        stage.activities = stage.activities.filter((activity) => {
          if (deleteIds.has(activity.id)) {
            deletedIds.push(activity.id);
            requestedDeleteIds.add(activity.id);
            return false;
          }
          return true;
        });
      }

      const boundaryCleanup = await this.dutyAutopilot.cleanupServiceBoundaries(
        stage.stageId,
        stage.variantId,
        stage.activities,
      );
      if (boundaryCleanup.deletedIds.length) {
        const deleteSet = new Set(boundaryCleanup.deletedIds);
        stage.activities = stage.activities.filter((activity) => !deleteSet.has(activity.id));
        const uniqueDeletes = boundaryCleanup.deletedIds.filter((id) => !deletedIds.includes(id));
        uniqueDeletes.forEach((id) => {
          deletedIds.push(id);
          requestedDeleteIds.add(id);
        });
        this.debugStream?.log(
          'info',
          'planning',
          'Dienstgrenzen bereinigt',
          {
            stageId,
            variantId,
            requestId,
            clientRequestId: request?.clientRequestId ?? null,
            deletedCount: boundaryCleanup.deletedIds.length,
            deletedIds: this.limitIds(boundaryCleanup.deletedIds),
            entries: boundaryCleanup.entries.slice(0, 10),
          },
          {
            userId: sourceContext.userId,
            connectionId: sourceContext.connectionId,
            stageId,
          },
        );
      }

      const managedNormalization = await this.dutyAutopilot.normalizeManagedServiceActivities(
        stage.stageId,
        stage.variantId,
        stage.activities,
      );
      if (managedNormalization.deletedIds.length) {
        const deleteSet = new Set(managedNormalization.deletedIds);
        stage.activities = stage.activities.filter((activity) => !deleteSet.has(activity.id));
        const uniqueDeletes = managedNormalization.deletedIds.filter((id) => !deletedIds.includes(id));
        uniqueDeletes.forEach((id) => {
          deletedIds.push(id);
          requestedDeleteIds.add(id);
        });
      }
      if (managedNormalization.upserts.length) {
        managedNormalization.upserts.forEach((activity) => {
          this.upsertActivity(stage, activity);
          changedUpsertIds.add(activity.id);
        });
        this.debugStream?.log(
          'info',
          'planning',
          'Dienstgrenzen/Pausen normalisiert',
          {
            stageId,
            variantId,
            requestId,
            clientRequestId: request?.clientRequestId ?? null,
            upsertCount: managedNormalization.upserts.length,
            deleteCount: managedNormalization.deletedIds.length,
            entries: managedNormalization.entries.slice(0, 10),
          },
          {
            userId: sourceContext.userId,
            connectionId: sourceContext.connectionId,
            stageId,
          },
        );
      }

      const complianceUpserts = await this.dutyAutopilot.applyWorktimeCompliance(
        stage.stageId,
        stage.variantId,
        stage.activities,
      );
      if (complianceUpserts.length) {
        const updatedById = new Map(complianceUpserts.map((activity) => [activity.id, activity]));
        stage.activities = stage.activities.map((activity) => {
          const updated = updatedById.get(activity.id);
          if (!updated) {
            return activity;
          }
          complianceUpdatedIds.add(activity.id);
          return updated;
        });
      }

      const changedActivities = requestedUpsertIds.size
        ? stage.activities.filter((activity) => requestedUpsertIds.has(activity.id))
        : [];
      this.assertServiceActivityOwners(
        stage.stageId,
        stage.variantId,
        changedActivities,
        stage.resources,
        sourceContext,
        requestId,
        request?.clientRequestId ?? null,
      );
      await this.assertParticipantRequirements(
        stage.stageId,
        stage.variantId,
        changedActivities,
        previousById,
        stage.resources,
      );

      const boundaryScopeIds = new Set<string>([...requestedUpsertIds, ...requestedDeleteIds]);
      if (boundaryScopeIds.size > 0) {
        const nextById = new Map(stage.activities.map((activity) => [activity.id, activity]));
        const affectedBoundaryGroupKeys = this.collectVehicleServiceBoundaryGroupKeys(
          previousById,
          nextById,
          boundaryScopeIds,
        );
        if (affectedBoundaryGroupKeys.size > 0) {
          await this.assertVehicleServiceBoundaries(
            stage.stageId,
            stage.variantId,
            stage.activities,
            affectedBoundaryGroupKeys,
          );
        }
      }
    } catch (error) {
      stage.activities = previousActivities;
      stage.version = previousVersion;
      stage.timelineRange = previousTimeline;
      throw error;
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

    const activityById = new Map(stage.activities.map((activity) => [activity.id, activity]));
    const impactedServiceIds = this.collectImpactedServiceIds(
      activityById,
      changedUpsertIds,
      deletedIds,
      previousById,
    );
    const storedUpsertIds = new Set<string>([...changedUpsertIds, ...complianceUpdatedIds]);
    const responseUpsertIds = new Set<string>([...changedUpsertIds, ...complianceUpdatedIds]);
    const dbSnapshots = storedUpsertIds.size
      ? this.collectActivitySnapshots(stage, Array.from(storedUpsertIds))
      : [];
    const responseSnapshots =
      responseUpsertIds.size || impactedServiceIds.size
        ? this.collectActivitySnapshots(stage, Array.from(responseUpsertIds), {
            extraServiceIds: impactedServiceIds,
            includeWorktime: true,
          })
        : [];

    if (changedUpsertIds.size || deletedIds.length || complianceUpdatedIds.size) {
      this.emitStageEvent(stage, {
        scope: 'activities',
        clientRequestId: request?.clientRequestId ?? undefined,
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        upserts: responseSnapshots.length ? responseSnapshots : undefined,
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
        dbSnapshots,
        deletedIds,
      );
      await this.repository.updateStageMetadata(
        stage.stageId,
        stage.variantId,
        stage.timelineRange,
        stage.version,
      );
    }

    if (changedUpsertIds.size || deletedIds.length) {
      this.debugStream?.log(
        'info',
        'planning',
        'Aktivitaeten gespeichert',
        {
          stageId,
          variantId,
          requestId,
          clientRequestId: request?.clientRequestId ?? null,
          upsertCount: appliedUpserts.length,
          deleteCount: deletedIds.length,
          upsertIds: this.limitIds(appliedUpserts),
          deleteIds: this.limitIds(deletedIds),
          autopilotUpserts: 0,
          autopilotDeletes: 0,
        },
        {
          userId: sourceContext.userId,
          connectionId: sourceContext.connectionId,
          stageId,
        },
      );
    }

    return {
      appliedUpserts,
      deletedIds,
      upserts: responseSnapshots.length ? responseSnapshots : undefined,
      version: stage.version,
      clientRequestId: request?.clientRequestId,
    };
  }

  private utcDayKey(iso: string): string | null {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) {
      return null;
    }
    return new Date(ms).toISOString().slice(0, 10);
  }

  private resolveServiceIdForOwner(activity: Activity, ownerId: string): string | null {
    const explicit = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
    if (explicit.startsWith('svc:')) {
      return explicit;
    }
    const attrs = (activity.attributes ?? {}) as Record<string, any>;
    const map = attrs['service_by_owner'];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const entry = (map as Record<string, any>)[ownerId];
      const candidate = typeof entry?.serviceId === 'string' ? entry.serviceId.trim() : '';
      if (candidate.startsWith('svc:')) {
        return candidate;
      }
    }
    return null;
  }

  private computeServiceWorktimeByService(activities: Activity[]): Map<string, number> {
    const windows = new Map<string, { startMs: number | null; endMs: number | null }>();
    activities.forEach((activity) => {
      const serviceIds = this.collectServiceIds(activity);
      if (!serviceIds.length) {
        return;
      }
      const startMs = this.parseTimestamp(activity.start);
      if (startMs === null) {
        return;
      }
      if (this.isServiceStartActivity(activity)) {
        serviceIds.forEach((serviceId) => {
          const entry = windows.get(serviceId) ?? { startMs: null, endMs: null };
          entry.startMs = entry.startMs === null ? startMs : Math.min(entry.startMs, startMs);
          windows.set(serviceId, entry);
        });
      }
      if (this.isServiceEndActivity(activity)) {
        const endMs = startMs;
        serviceIds.forEach((serviceId) => {
          const entry = windows.get(serviceId) ?? { startMs: null, endMs: null };
          entry.endMs = entry.endMs === null ? endMs : Math.max(entry.endMs, endMs);
          windows.set(serviceId, entry);
        });
      }
    });

    const breakMsMap = new Map<string, number>();
    activities.forEach((activity) => {
      if (!this.isBreakActivity(activity)) {
        return;
      }
      const startMs = this.parseTimestamp(activity.start);
      const endMs = this.parseTimestamp(activity.end ?? null);
      if (startMs === null || endMs === null || endMs <= startMs) {
        return;
      }
      const serviceIds = this.collectServiceIds(activity);
      if (!serviceIds.length) {
        return;
      }
      serviceIds.forEach((serviceId) => {
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

  private attachServiceWorktime(activity: Activity, worktimeByService: Map<string, number>): Activity {
    if (!this.isServiceStartActivity(activity)) {
      return activity;
    }
    const serviceId = this.resolvePrimaryServiceId(activity);
    if (!serviceId) {
      return activity;
    }
    const worktime = worktimeByService.get(serviceId);
    if (worktime === undefined) {
      return activity;
    }
    return {
      ...activity,
      meta: {
        ...(activity.meta ?? {}),
        service_worktime_ms: worktime,
      },
    };
  }

  private stripComputedActivityMeta(activity: Activity): Activity {
    const meta = activity.meta as Record<string, unknown> | undefined;
    if (!meta || !Object.prototype.hasOwnProperty.call(meta, 'service_worktime_ms')) {
      return activity;
    }
    const nextMeta = { ...meta };
    delete nextMeta['service_worktime_ms'];
    return {
      ...activity,
      meta: Object.keys(nextMeta).length ? nextMeta : undefined,
    };
  }

  private collectServiceIds(activity: Activity | null | undefined): string[] {
    if (!activity) {
      return [];
    }
    const ids = new Set<string>();
    const direct = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
    if (direct) {
      ids.add(direct);
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const map = attrs?.['service_by_owner'];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      Object.values(map as Record<string, any>).forEach((entry) => {
        const candidate = typeof entry?.serviceId === 'string' ? entry.serviceId.trim() : '';
        if (candidate) {
          ids.add(candidate);
        }
      });
    }
    if (!direct && ids.size === 0) {
      const parsed = this.parseServiceIdFromManagedActivityId(activity.id);
      if (parsed) {
        ids.add(parsed);
      }
    }
    return Array.from(ids);
  }

  private resolvePrimaryServiceId(activity: Activity | null | undefined): string | null {
    if (!activity) {
      return null;
    }
    const direct = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
    if (direct) {
      return direct;
    }
    const parsed = this.parseServiceIdFromManagedActivityId(activity.id);
    if (parsed) {
      return parsed;
    }
    const ids = this.collectServiceIds(activity);
    return ids.length ? ids[0] : null;
  }

  private parseServiceIdFromManagedActivityId(id: string | null | undefined): string | null {
    const value = (id ?? '').trim();
    if (!value) {
      return null;
    }
    if (value.startsWith('svcstart:')) {
      const serviceId = value.slice('svcstart:'.length).trim();
      return serviceId.length ? serviceId : null;
    }
    if (value.startsWith('svcend:')) {
      const serviceId = value.slice('svcend:'.length).trim();
      return serviceId.length ? serviceId : null;
    }
    if (value.startsWith('svcbreak:')) {
      const rest = value.slice('svcbreak:'.length);
      const idx = rest.lastIndexOf(':');
      const serviceId = idx >= 0 ? rest.slice(0, idx) : rest;
      const trimmed = serviceId.trim();
      return trimmed.length ? trimmed : null;
    }
    if (value.startsWith('svcshortbreak:')) {
      const rest = value.slice('svcshortbreak:'.length);
      const idx = rest.lastIndexOf(':');
      const serviceId = idx >= 0 ? rest.slice(0, idx) : rest;
      const trimmed = serviceId.trim();
      return trimmed.length ? trimmed : null;
    }
    if (value.startsWith('svccommute:')) {
      const rest = value.slice('svccommute:'.length);
      const idx = rest.lastIndexOf(':');
      const serviceId = idx >= 0 ? rest.slice(0, idx) : rest;
      const trimmed = serviceId.trim();
      return trimmed.length ? trimmed : null;
    }
    return null;
  }

  private isServiceStartActivity(activity: Activity): boolean {
    if (activity.serviceRole === 'start' || activity.type === 'service-start') {
      return true;
    }
    if ((activity.id ?? '').toString().startsWith('svcstart:')) {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    return this.parseBoolean(attrs?.['is_service_start']);
  }

  private isServiceEndActivity(activity: Activity): boolean {
    if (activity.serviceRole === 'end' || activity.type === 'service-end') {
      return true;
    }
    if ((activity.id ?? '').toString().startsWith('svcend:')) {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    return this.parseBoolean(attrs?.['is_service_end']);
  }

  private isBreakActivity(activity: Activity): boolean {
    if (!activity.end) {
      return false;
    }
    const type = (activity.type ?? '').toString().trim().toLowerCase();
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const isBreak = this.parseBoolean(attrs?.['is_break']) || type === 'break';
    const isShort = this.parseBoolean(attrs?.['is_short_break']) || type === 'short-break';
    return isBreak && !isShort;
  }

  private isShortBreakActivity(activity: Activity): boolean {
    if (!activity.end) {
      return false;
    }
    const type = (activity.type ?? '').toString().trim().toLowerCase();
    if (type === 'short-break') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['is_short_break'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'ja';
    }
    return false;
  }

  private parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === 'yes' || normalized === '1';
    }
    return false;
  }

  private assertManagedActivityDeletes(
    stageId: StageId,
    variantId: string,
    deleteIds: string[],
    sourceContext: SourceContext,
    requestId?: string,
    clientRequestId?: string | null,
  ): void {
    if (!deleteIds.length) {
      return;
    }
    const managedDeletes = deleteIds.filter((id) => this.isManagedServiceActivityId(id));
    if (!managedDeletes.length) {
      return;
    }
    const violations = managedDeletes.map((id) => ({
      activityId: id,
      code: 'MANAGED_DELETE_FORBIDDEN',
      message: 'Systemvorgaben dürfen nicht gelöscht werden.',
    }));
    this.debugStream?.log(
      'warn',
      'planning',
      'Systemvorgaben dürfen nicht gelöscht werden',
      {
        stageId,
        variantId,
        requestId,
        clientRequestId: clientRequestId ?? null,
        deleteIds: this.limitIds(managedDeletes),
      },
      {
        userId: sourceContext.userId,
        connectionId: sourceContext.connectionId,
        stageId,
      },
    );
    throw new BadRequestException({
      message: 'Systemvorgaben können nicht gelöscht werden.',
      stageId,
      variantId,
      violations,
      error: 'ValidationError',
      statusCode: 400,
    });
  }

  private assertServiceActivityOwners(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
    resources?: Resource[],
    sourceContext?: SourceContext,
    requestId?: string,
    clientRequestId?: string | null,
  ): void {
    if (stageId === 'base') {
      return;
    }
    if (!activities.length) {
      return;
    }
    type ActivityParticipantEntry = NonNullable<Activity['participants']>[number];
    const resourceKindMap = resources ? new Map(resources.map((resource) => [resource.id, resource.kind])) : undefined;
    const resolveKind = (participant: ActivityParticipantEntry | undefined | null): string | null => {
      if (!participant) {
        return null;
      }
      if (participant.kind) {
        return participant.kind;
      }
      if (!participant.resourceId) {
        return null;
      }
      return resourceKindMap?.get(participant.resourceId) ?? null;
    };

    const violations: Array<{
      activityId: string;
      type: string | null;
      code: 'MISSING_SERVICE_OWNER' | 'MULTIPLE_SERVICE_OWNERS';
      message: string;
    }> = [];

    for (const activity of activities) {
      const id = (activity.id ?? '').toString();
      if (!id) {
        continue;
      }
      const isBoundary = this.isServiceStartActivity(activity) || this.isServiceEndActivity(activity);
      const isPause = this.isBreakActivity(activity) || this.isShortBreakActivity(activity);
      if (!isBoundary && !isPause) {
        continue;
      }
      const typeId = (activity.type ?? '').toString().trim() || null;
      const participants = activity.participants ?? [];
      const owners = participants.filter((participant) => {
        const kind = resolveKind(participant);
        return kind === 'personnel-service' || kind === 'vehicle-service';
      });
      if (owners.length === 0) {
        violations.push({
          activityId: id,
          type: typeId,
          code: 'MISSING_SERVICE_OWNER',
          message: 'Dienstgrenzen und Pausen benötigen einen Personaldienst oder Fahrzeugdienst.',
        });
        continue;
      }
      if (owners.length > 1) {
        violations.push({
          activityId: id,
          type: typeId,
          code: 'MULTIPLE_SERVICE_OWNERS',
          message: 'Dienstgrenzen und Pausen dürfen nur einem Dienst zugeordnet sein.',
        });
      }
    }

    if (!violations.length) {
      return;
    }

    this.debugStream?.log(
      'warn',
      'planning',
      'Dienstgrenzen/Pausen ungültig',
      {
        stageId,
        variantId,
        requestId,
        clientRequestId: clientRequestId ?? null,
        violations: violations.slice(0, 10),
      },
      {
        userId: sourceContext?.userId,
        connectionId: sourceContext?.connectionId,
        stageId,
      },
    );

    throw new BadRequestException({
      message: 'Dienstgrenzen/Pausen benötigen genau einen Dienst.',
      stageId,
      variantId,
      violations,
      error: 'ValidationError',
      statusCode: 400,
    });
  }

  private parseTimestamp(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  private computeVehicleServiceBoundaryGroupKey(activity: Activity, ownerId: string): string {
    const serviceId = this.resolveServiceIdForOwner(activity, ownerId);
    const dayKey = serviceId ? (serviceId.split(':').pop() ?? null) : this.utcDayKey(activity.start);
    return `${ownerId}|${serviceId ?? dayKey ?? 'unknown'}`;
  }

  private collectVehicleServiceBoundaryGroupKeys(
    previousById: Map<string, Activity>,
    nextById: Map<string, Activity>,
    activityIds: Iterable<string>,
  ): Set<string> {
    const keys = new Set<string>();
    const addKeysFor = (activity: Activity | undefined) => {
      if (!activity) {
        return;
      }
      const owners = (activity.participants ?? [])
        .filter((p) => (p as any)?.resourceId && (p as any)?.kind === 'vehicle-service')
        .map((p) => (p as any).resourceId as string);
      owners.forEach((ownerId) => keys.add(this.computeVehicleServiceBoundaryGroupKey(activity, ownerId)));
    };

    for (const id of activityIds) {
      addKeysFor(previousById.get(id));
      addKeysFor(nextById.get(id));
    }

    return keys;
  }

  private async assertParticipantRequirements(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
    previousById?: Map<string, Activity>,
    resources?: Resource[],
  ): Promise<void> {
    if (stageId === 'base') {
      // Base stage is a template timeline; resource bindings are optional here.
      return;
    }
    if (!activities.length) {
      return;
    }
    type ActivityParticipantEntry = NonNullable<Activity['participants']>[number];
    const requirements = await this.loadActivityTypeRequirements();
    const resourceKindMap = resources ? new Map(resources.map((resource) => [resource.id, resource.kind])) : undefined;
    const resolveKind = (participant: ActivityParticipantEntry | undefined | null): string | null => {
      if (!participant) {
        return null;
      }
      if (participant.kind) {
        return participant.kind;
      }
      if (!participant.resourceId) {
        return null;
      }
      return resourceKindMap?.get(participant.resourceId) ?? null;
    };

    const violations: Array<{
      activityId: string;
      type: string | null;
      code: 'MISSING_PERSONNEL' | 'MISSING_VEHICLE';
      message: string;
    }> = [];

    for (const activity of activities) {
      const id = (activity.id ?? '').toString();
      if (!id || this.isManagedServiceActivityId(id)) {
        continue;
      }
      const previous = previousById?.get(id);
      if (previous && !this.participantListsChanged(previous.participants, activity.participants, resourceKindMap)) {
        continue;
      }
      const typeId = (activity.type ?? '').toString().trim() || null;
      const participants = activity.participants ?? [];
      const hasVehicle = participants.some((participant) => {
        const kind = resolveKind(participant);
        return kind === 'vehicle-service' || kind === 'vehicle';
      });

      const requiresVehicle = typeId ? requirements.get(typeId)?.requiresVehicle ?? false : false;
      if (requiresVehicle && !hasVehicle) {
        violations.push({
          activityId: id,
          type: typeId,
          code: 'MISSING_VEHICLE',
          message: 'Diese Leistung benötigt mindestens einen Fahrzeugdienst.',
        });
      }
    }

    if (!violations.length) {
      return;
    }

    throw new BadRequestException({
      message: 'Leistung verletzt Pflicht-Verknüpfungen (Personal/Fahrzeug).',
      stageId,
      variantId,
      violations,
      error: 'ValidationError',
      statusCode: 400,
    });
  }

  private participantListsChanged(
    previous: Activity['participants'] | null | undefined,
    next: Activity['participants'] | null | undefined,
    resourceKindMap?: Map<string, Resource['kind']>,
  ): boolean {
    type ActivityParticipantEntry = NonNullable<Activity['participants']>[number];
    const resolveKind = (participant: ActivityParticipantEntry | undefined | null): string => {
      if (!participant) {
        return '';
      }
      if (participant.kind) {
        return participant.kind;
      }
      if (!participant.resourceId) {
        return '';
      }
      return resourceKindMap?.get(participant.resourceId) ?? '';
    };
    const normalize = (list: Activity['participants'] | null | undefined): string[] => {
      if (!list || list.length === 0) {
        return [];
      }
      return list
        .filter((entry): entry is NonNullable<typeof entry> => !!entry && !!entry.resourceId)
        .map((entry) => `${resolveKind(entry)}|${entry.resourceId ?? ''}|${entry.role ?? ''}`)
        .sort((a, b) => a.localeCompare(b));
    };
    const a = normalize(previous);
    const b = normalize(next);
    if (a.length !== b.length) {
      return true;
    }
    return a.some((entry, index) => entry !== b[index]);
  }

  private isManagedServiceActivityId(id: string): boolean {
    return (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    );
  }

  private async loadActivityTypeRequirements(): Promise<
    Map<string, { requiresVehicle: boolean; isVehicleOn: boolean; isVehicleOff: boolean }>
  > {
    if (this.activityTypeRequirements) {
      return this.activityTypeRequirements;
    }
    try {
      const entries = this.activityCatalog.listActivityTypes();
      const toBool = (value: unknown) => {
        if (typeof value === 'boolean') {
          return value;
        }
        if (typeof value === 'string') {
          const normalized = value.trim().toLowerCase();
          return normalized === 'true' || normalized === 'yes' || normalized === '1';
        }
        if (typeof value === 'number') {
          return Number.isFinite(value) && value !== 0;
        }
        return false;
      };
      const map = new Map<string, { requiresVehicle: boolean; isVehicleOn: boolean; isVehicleOff: boolean }>();
      for (const entry of entries) {
        const id = (entry?.id ?? '').toString().trim();
        if (!id) {
          continue;
        }
        const attrs = entry.attributes as Record<string, unknown> | undefined;
        map.set(id, {
          requiresVehicle: toBool(attrs?.['requires_vehicle']),
          isVehicleOn: toBool(attrs?.['is_vehicle_on']),
          isVehicleOff: toBool(attrs?.['is_vehicle_off']),
        });
      }
      this.activityTypeRequirements = map;
      return map;
    } catch (error) {
      this.logger.warn(`Activity catalog requirements could not be loaded: ${(error as Error).message ?? String(error)}`);
      this.activityTypeRequirements = new Map();
      return this.activityTypeRequirements;
    }
  }

  private async assertVehicleServiceBoundaries(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
    scopeGroupKeys?: Set<string>,
  ): Promise<void> {
    if (stageId === 'base') {
      // Vehicle duty boundary validation is only enforced for planning stages.
      return;
    }
    if (!activities.length) {
      return;
    }
    if (scopeGroupKeys && scopeGroupKeys.size === 0) {
      return;
    }
    const requirements = await this.loadActivityTypeRequirements();

    const violations: Array<{
      ownerId: string;
      serviceId: string | null;
      dayKey: string | null;
      code:
        | 'MISSING_VEHICLE_ON'
        | 'MISSING_VEHICLE_OFF'
        | 'VEHICLE_ON_NOT_FIRST'
        | 'VEHICLE_OFF_NOT_LAST'
        | 'VEHICLE_ON_AFTER_OFF';
      message: string;
    }> = [];

    const groups = new Map<string, { ownerId: string; serviceId: string | null; dayKey: string | null; items: Activity[] }>();

    for (const activity of activities) {
      const id = (activity.id ?? '').toString();
      if (!id || this.isManagedServiceActivityId(id)) {
        continue;
      }
      const typeId = (activity.type ?? '').toString().trim() || null;
      if (!typeId) {
        continue;
      }
      const req = requirements.get(typeId);
      const relevant = !!(req?.requiresVehicle || req?.isVehicleOn || req?.isVehicleOff);
      if (!relevant) {
        continue;
      }

      const owners = (activity.participants ?? [])
        .filter((p) => (p as any)?.resourceId && (p as any)?.kind === 'vehicle-service')
        .map((p) => (p as any).resourceId as string);

      if (!owners.length) {
        continue;
      }

      owners.forEach((ownerId) => {
        const serviceId = this.resolveServiceIdForOwner(activity, ownerId);
        const dayKey = serviceId ? (serviceId.split(':').pop() ?? null) : this.utcDayKey(activity.start);
        const groupKey = `${ownerId}|${serviceId ?? dayKey ?? 'unknown'}`;
        if (scopeGroupKeys && !scopeGroupKeys.has(groupKey)) {
          return;
        }
        const existing = groups.get(groupKey);
        if (existing) {
          existing.items.push(activity);
        } else {
          groups.set(groupKey, { ownerId, serviceId, dayKey, items: [activity] });
        }
      });
    }

    const parseStartMs = (activity: Activity): number | null => {
      const ms = Date.parse(activity.start);
      return Number.isFinite(ms) ? ms : null;
    };

    groups.forEach((group) => {
      const items = group.items
        .map((activity) => ({ activity, startMs: parseStartMs(activity) }))
        .filter((entry): entry is { activity: Activity; startMs: number } => entry.startMs !== null)
        .sort((a, b) => a.startMs - b.startMs || a.activity.id.localeCompare(b.activity.id));
      if (!items.length) {
        return;
      }

      const isOn = (activity: Activity) =>
        !!requirements.get((activity.type ?? '').toString().trim() || '')?.isVehicleOn;
      const isOff = (activity: Activity) =>
        !!requirements.get((activity.type ?? '').toString().trim() || '')?.isVehicleOff;

      const onItems = items.filter((entry) => isOn(entry.activity));
      const offItems = items.filter((entry) => isOff(entry.activity));

      const earliest = items[0];
      const latest = items[items.length - 1];

      if (onItems.length && !isOn(earliest.activity)) {
        violations.push({
          ownerId: group.ownerId,
          serviceId: group.serviceId,
          dayKey: group.dayKey,
          code: 'VEHICLE_ON_NOT_FIRST',
          message: 'Einschalten muss die erste Fahrzeugleistung im Fahrzeugdienst sein.',
        });
        return;
      }
      if (offItems.length && !isOff(latest.activity)) {
        violations.push({
          ownerId: group.ownerId,
          serviceId: group.serviceId,
          dayKey: group.dayKey,
          code: 'VEHICLE_OFF_NOT_LAST',
          message: 'Ausschalten muss die letzte Fahrzeugleistung im Fahrzeugdienst sein.',
        });
        return;
      }

      if (onItems.length && offItems.length) {
        const firstOnStartMs = onItems[0].startMs;
        const lastOffStartMs = offItems[offItems.length - 1].startMs;
        if (firstOnStartMs > lastOffStartMs) {
          violations.push({
            ownerId: group.ownerId,
            serviceId: group.serviceId,
            dayKey: group.dayKey,
            code: 'VEHICLE_ON_AFTER_OFF',
            message: 'Einschalten muss vor Ausschalten liegen.',
          });
        }
      }
    });

    if (!violations.length) {
      return;
    }

    throw new BadRequestException({
      message: 'Fahrzeugdienst-Grenzen verletzt (Einschalten/Ausschalten).',
      stageId,
      variantId,
      violations,
      error: 'ValidationError',
      statusCode: 400,
    });
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

    const issues = [
      ...this.detectOverlapIssues(selected),
      ...(await this.detectWorktimeIssues(stage, selected)),
    ];

    return {
      generatedAt: this.nextVersion(),
      issues,
    };
  }

  async updateViewportSubscription(
    stageId: string,
    variantId: string,
    request?: PlanningStageViewportSubscriptionRequest,
    timetableYearLabel?: string | null,
  ): Promise<PlanningStageViewportSubscriptionResponse> {
    const stage = await this.getStage(stageId, variantId, timetableYearLabel);
    const userId = request?.userId?.trim() ?? '';
    const connectionId = request?.connectionId?.trim() ?? '';
    const from = request?.from?.trim() ?? '';
    const to = request?.to?.trim() ?? '';
    if (!userId || !connectionId) {
      throw new BadRequestException('Viewport subscription requires userId and connectionId.');
    }
    if (!from || !to) {
      throw new BadRequestException('Viewport subscription requires from and to timestamps.');
    }
    const fromMs = this.parseIso(from);
    const toMs = this.parseIso(to);
    if (fromMs === undefined || toMs === undefined || toMs <= fromMs) {
      throw new BadRequestException('Viewport subscription range is invalid.');
    }
    const resourceIds = request?.resourceIds
      ?.map((entry) => entry.trim())
      .filter(Boolean);
    const normalizedResourceIds =
      resourceIds && resourceIds.length ? Array.from(new Set(resourceIds)) : undefined;
    const key = this.stageKey(stage.stageId, stage.variantId);
    const subscriptionKey = this.viewportSubscriptionKey(userId, connectionId);
    const registry = this.stageViewportSubscriptions.get(key) ?? new Map<string, StageViewportSubscription>();
    registry.set(subscriptionKey, {
      userId,
      connectionId,
      from,
      to,
      resourceIds: normalizedResourceIds,
      updatedAt: new Date().toISOString(),
    });
    this.stageViewportSubscriptions.set(key, registry);
    return { ok: true };
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
      const subscriptionKey =
        userId && connectionId ? this.viewportSubscriptionKey(userId, connectionId) : null;

      this.getStage(stageId, variantId, timetableYearLabel)
        .then((stage) => {
          const subject = this.getStageEventSubject(stage.stageId, stage.variantId);
          subscription = subject.subscribe({
            next: (event) => {
              const filtered = this.filterRealtimeEvent(stage, event, subscriptionKey);
              if (filtered) {
                subscriber.next(filtered);
              }
            },
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
        if (subscriptionKey) {
          this.removeViewportSubscription(stageId, variantId, subscriptionKey);
        }
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

  applyAdminClear(options: {
    clearResources?: boolean;
    clearActivities?: boolean;
    clearTrainRuns?: boolean;
    clearTrainSegments?: boolean;
    resetTimeline?: boolean;
  }): void {
    const clearResources = Boolean(options.clearResources);
    const clearActivities = Boolean(options.clearActivities);
    const clearTrainRuns = Boolean(options.clearTrainRuns);
    const clearTrainSegments = Boolean(options.clearTrainSegments);
    const resetTimeline = Boolean(options.resetTimeline);

    if (!clearResources && !clearActivities && !clearTrainRuns && !clearTrainSegments && !resetTimeline) {
      return;
    }

    for (const stage of this.stages.values()) {
      const deletedResourceIds = clearResources ? stage.resources.map((resource) => resource.id) : [];
      const deletedActivityIds = clearActivities ? stage.activities.map((activity) => activity.id) : [];

      if (clearResources) {
        stage.resources = [];
      }
      if (clearActivities) {
        stage.activities = [];
      }
      if (clearTrainRuns) {
        stage.trainRuns = [];
      }
      if (clearTrainSegments) {
        stage.trainSegments = [];
      }
      if (resetTimeline) {
        stage.timelineRange = this.defaultTimelineRange();
      }

      stage.version = this.nextVersion();

      if (deletedResourceIds.length) {
        this.emitStageEvent(stage, {
          scope: 'resources',
          version: stage.version,
          deleteIds: deletedResourceIds,
        });
      }
      if (deletedActivityIds.length) {
        this.emitStageEvent(stage, {
          scope: 'activities',
          version: stage.version,
          deleteIds: deletedActivityIds,
        });
      }
      if (resetTimeline) {
        this.emitStageEvent(stage, {
          scope: 'timeline',
          version: stage.version,
          timelineRange: { ...stage.timelineRange },
        });
      }
    }
  }

  private stageKey(stageId: StageId, variantId: PlanningVariantId): string {
    return `${stageId}::${variantId}`;
  }

  private viewportSubscriptionKey(userId: string, connectionId: string): string {
    return `${userId}::${connectionId}`;
  }

  private getViewportSubscription(
    stageId: StageId,
    variantId: PlanningVariantId,
    subscriptionKey: string,
  ): StageViewportSubscription | null {
    const key = this.stageKey(stageId, variantId);
    const registry = this.stageViewportSubscriptions.get(key);
    return registry?.get(subscriptionKey) ?? null;
  }

  private removeViewportSubscription(
    stageIdValue: string,
    variantIdValue: string,
    subscriptionKey: string,
  ): void {
    if (!isStageId(stageIdValue)) {
      return;
    }
    const stageId = stageIdValue as StageId;
    const variantId = this.normalizeVariantId(variantIdValue);
    const key = this.stageKey(stageId, variantId);
    const registry = this.stageViewportSubscriptions.get(key);
    if (!registry) {
      return;
    }
    registry.delete(subscriptionKey);
    if (registry.size === 0) {
      this.stageViewportSubscriptions.delete(key);
    }
  }

  private filterRealtimeEvent(
    stage: StageState,
    event: PlanningStageRealtimeEvent,
    subscriptionKey: string | null,
  ): PlanningStageRealtimeEvent | null {
    if (event.scope !== 'activities' || !subscriptionKey) {
      return event;
    }
    const subscription = this.getViewportSubscription(stage.stageId, stage.variantId, subscriptionKey);
    if (!subscription) {
      return event;
    }
    const visibleIds = this.collectVisibleActivityIds(stage, subscription);
    const incomingUpserts = (event.upserts ?? []) as Activity[];
    const deleteIds = new Set(event.deleteIds ?? []);
    const filteredUpserts: Activity[] = [];

    incomingUpserts.forEach((activity) => {
      if (visibleIds.has(activity.id)) {
        filteredUpserts.push(activity);
      } else {
        deleteIds.add(activity.id);
      }
    });

    const filteredDeleteIds = Array.from(deleteIds);
    if (filteredUpserts.length === 0 && filteredDeleteIds.length === 0) {
      return null;
    }

    return {
      ...event,
      upserts: filteredUpserts.length ? filteredUpserts : undefined,
      deleteIds: filteredDeleteIds.length ? filteredDeleteIds : undefined,
    };
  }

  private collectVisibleActivityIds(
    stage: StageState,
    subscription: StageViewportSubscription,
  ): Set<string> {
    const filtered = this.applyActivityFilters(stage.activities, {
      from: subscription.from,
      to: subscription.to,
      resourceIds: subscription.resourceIds,
    });
    return new Set(filtered.map((activity) => activity.id));
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

  private collectActivitySnapshots(
    stage: StageState,
    ids: string[],
    options: { extraServiceIds?: Set<string>; includeWorktime?: boolean } = {},
  ): Activity[] {
    const targetIds = new Set(ids);
    const extraServiceIds = options.extraServiceIds ?? new Set<string>();
    if (extraServiceIds.size) {
      stage.activities.forEach((activity) => {
        if (!this.isServiceStartActivity(activity)) {
          return;
        }
        const serviceId = this.resolvePrimaryServiceId(activity);
        if (serviceId && extraServiceIds.has(serviceId)) {
          targetIds.add(activity.id);
        }
      });
    }
    if (targetIds.size === 0) {
      return [];
    }
    const worktimeByService = options.includeWorktime
      ? this.computeServiceWorktimeByService(stage.activities)
      : null;
    return Array.from(targetIds)
      .map((id) => stage.activities.find((activity) => activity.id === id))
      .filter((activity): activity is Activity => Boolean(activity))
      .map((activity) => {
        const clone = this.cloneActivity(activity);
        if (!worktimeByService) {
          return clone;
        }
        return this.attachServiceWorktime(clone, worktimeByService);
      });
  }

  private collectImpactedServiceIds(
    activityById: Map<string, Activity>,
    changedUpsertIds: Set<string>,
    deletedIds: string[],
    previousById: Map<string, Activity>,
  ): Set<string> {
    const impacted = new Set<string>();
    const addFromActivity = (activity: Activity | undefined | null) => {
      if (!activity) {
        return;
      }
      this.collectServiceIds(activity).forEach((serviceId) => impacted.add(serviceId));
    };
    changedUpsertIds.forEach((id) => {
      addFromActivity(activityById.get(id));
      addFromActivity(previousById.get(id));
    });
    deletedIds.forEach((id) => addFromActivity(previousById.get(id)));
    return impacted;
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

  private limitIds(ids: string[], limit = 20): string[] | undefined {
    if (!ids.length) {
      return undefined;
    }
    if (ids.length <= limit) {
      return ids;
    }
    return ids.slice(0, limit);
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
      const managedId = this.parseServiceIdFromManagedActivityId(activity.id);
      if (managedId) {
        serviceIds.add(managedId);
      }
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
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:');
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
            id: `capacity-conflict-${resourceId}-${this.validationIssueCounter}`,
            rule: 'capacity-conflict',
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

  private async detectWorktimeIssues(stage: StageState, selected: Activity[]): Promise<ActivityValidationIssue[]> {
    if (!selected.length) {
      return [];
    }

    const updates = await this.dutyAutopilot.applyWorktimeCompliance(
      stage.stageId,
      stage.variantId,
      stage.activities,
    );
    const updatedById = new Map(updates.map((activity) => [activity.id, activity]));

    const relevantServiceIds = new Set<string>();
    const selectedIdsByService = new Map<string, Set<string>>();
    selected.forEach((activity) => {
      const effective = updatedById.get(activity.id) ?? activity;
      const serviceIds = this.collectServiceIds(effective);
      serviceIds.forEach((serviceId) => {
        relevantServiceIds.add(serviceId);
        const ids = selectedIdsByService.get(serviceId) ?? new Set<string>();
        ids.add(activity.id);
        selectedIdsByService.set(serviceId, ids);
      });
    });
    if (!relevantServiceIds.size) {
      return [];
    }

    const baseWorktimeCodes = new Set(['MAX_DUTY_SPAN', 'MAX_WORK', 'MAX_CONTINUOUS', 'NO_BREAK_WINDOW']);
    const isWorktimeCode = (code: string) => code.startsWith('AZG_') || baseWorktimeCodes.has(code);

    const serviceCodes = new Map<string, Set<string>>();
    const serviceMaxLevel = new Map<string, number>();

    const readLevel = (activity: Activity): number => {
      const attrs = activity.attributes as Record<string, unknown> | undefined;
      const raw = attrs?.['service_conflict_level'];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
      }
      if (typeof raw === 'string') {
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const readCodes = (activity: Activity): string[] => {
      const attrs = activity.attributes as Record<string, unknown> | undefined;
      const raw = attrs?.['service_conflict_codes'];
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw.map((entry) => `${entry ?? ''}`.trim()).filter((entry) => entry.length > 0);
    };

    const updateServiceLevel = (serviceId: string, level: number) => {
      const current = serviceMaxLevel.get(serviceId) ?? 0;
      if (level > current) {
        serviceMaxLevel.set(serviceId, level);
      }
    };

    for (const activity of stage.activities) {
      const effective = updatedById.get(activity.id) ?? activity;
      const serviceIds = this.collectServiceIds(effective).filter((serviceId) => relevantServiceIds.has(serviceId));
      if (!serviceIds.length) {
        continue;
      }

      const codes = readCodes(effective).filter(isWorktimeCode);
      const level = codes.length ? readLevel(effective) : 0;

      for (const serviceId of serviceIds) {
        if (!codes.length) {
          continue;
        }
        updateServiceLevel(serviceId, level);
        let set = serviceCodes.get(serviceId);
        if (!set) {
          set = new Set<string>();
          serviceCodes.set(serviceId, set);
        }
        codes.forEach((code) => set?.add(code));
      }
    }

    if (!serviceCodes.size) {
      return [];
    }

    const severityForLevel = (level: number): ActivityValidationIssue['severity'] => {
      if (level >= 2) {
        return 'error';
      }
      if (level >= 1) {
        return 'warning';
      }
      return 'info';
    };

    const issues: ActivityValidationIssue[] = [];
    for (const [serviceId, codesSet] of serviceCodes.entries()) {
      const activityIds = Array.from(selectedIdsByService.get(serviceId) ?? new Set<string>());
      if (!activityIds.length) {
        continue;
      }
      const maxLevel = serviceMaxLevel.get(serviceId) ?? 0;
      const severity = severityForLevel(maxLevel);
      const sortedCodes = Array.from(codesSet.values()).sort((a, b) => a.localeCompare(b));
      for (const code of sortedCodes) {
        issues.push({
          id: `working-time-${serviceId}-${code}`,
          rule: 'working-time',
          severity,
          message: `${this.describeWorktimeConflictCode(code)} (Dienst ${serviceId}).`,
          activityIds,
          meta: { serviceId, code },
        });
      }
    }

    return issues;
  }

  private describeWorktimeConflictCode(code: string): string {
    const labels: Record<string, string> = {
      MAX_DUTY_SPAN: 'Maximale Dienstspanne überschritten.',
      MAX_WORK: 'Maximale Arbeitszeit im Dienst überschritten.',
      MAX_CONTINUOUS: 'Maximale zusammenhängende Arbeitszeit überschritten.',
      NO_BREAK_WINDOW: 'Keine gültige Pause (Mindestdauer) möglich.',
      AZG_WORK_AVG_7D: 'Durchschnittliche Arbeitszeit (7 Arbeitstage) überschritten.',
      AZG_WORK_AVG_365D: 'Durchschnittliche Arbeitszeit (Jahr) überschritten.',
      AZG_DUTY_SPAN_AVG_28D: 'Durchschnittliche Dienstschicht (28 Tage) überschritten.',
      AZG_REST_MIN: 'Mindestruheschicht unterschritten.',
      AZG_REST_AVG_28D: 'Durchschnittliche Ruheschicht (28 Tage) unterschritten.',
      AZG_BREAK_REQUIRED: 'Pause oder Arbeitsunterbrechung fehlt.',
      AZG_BREAK_MAX_COUNT: 'Zu viele Pausen in einer Dienstschicht.',
      AZG_BREAK_TOO_SHORT: 'Pause ist zu kurz (Mindestdauer).',
      AZG_BREAK_STANDARD_MIN: 'Standardpause unterschritten.',
      AZG_BREAK_FORBIDDEN_NIGHT: 'Pause zwischen 23–5 Uhr nicht zulässig.',
      AZG_BREAK_MIDPOINT: 'Pause nicht ungefähr in der Hälfte der Arbeitszeit.',
      AZG_NIGHT_STREAK_MAX: 'Zu viele Nachtdienste hintereinander.',
      AZG_NIGHT_28D_MAX: 'Zu viele Nachtdienste innerhalb von 28 Tagen.',
      AZG_REST_DAYS_YEAR_MIN: 'Zu wenige Ruhetage im Fahrplanjahr.',
      AZG_REST_SUNDAYS_YEAR_MIN: 'Zu wenige Ruhesonntage im Fahrplanjahr.',
      AZG_WORK_EXCEED_BUFFER: 'Höchstarbeitszeit deutlich überschritten.',
      AZG_DUTY_SPAN_EXCEED_BUFFER: 'Dienstspanne deutlich überschritten.',
    };
    return labels[code] ?? `Arbeitszeitregel verletzt (${code})`;
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
