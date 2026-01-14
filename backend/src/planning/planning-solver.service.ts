import { Injectable, Logger } from '@nestjs/common';
import type {
  Activity,
  ActivityAttributeValue,
  ActivityDefinition,
  ActivityParticipant,
  ResourceKind,
} from './planning.types';
import type { PlanningStageSnapshot } from './planning.types';
import type { RulesetIR } from './planning-ruleset.types';
import type {
  PlanningCandidate,
  PlanningCandidateBuildResult,
} from './planning-candidate-builder.service';
import { PlanningActivityCatalogService } from './planning-activity-catalog.service';

export interface PlanningSolverResult {
  summary: string;
  upserts: Activity[];
  deletedIds: string[];
  candidatesUsed: PlanningCandidate[];
}

interface PlanningSolverRequestOptions {
  max_per_service_type?: number;
  max_per_service?: number;
  weight_key?: string;
  time_limit_seconds?: number;
  random_seed?: number;
}

interface PlanningSolverRequestPayload {
  rulesetId: string;
  rulesetVersion: string;
  candidates: PlanningCandidate[];
  snapshot: {
    stageId: string;
    variantId: string;
    timetableYearLabel?: string | null;
  };
  options?: PlanningSolverRequestOptions;
}

interface PlanningSolverRemoteResponse {
  summary?: string;
  selectedIds?: string[];
  selectedCandidates?: PlanningCandidate[];
  score?: number;
  status?: string;
}

@Injectable()
export class PlanningSolverService {
  private readonly logger = new Logger(PlanningSolverService.name);
  private readonly solverUrl = normalizeUrl(
    process.env.PLANNING_SOLVER_URL ?? 'http://localhost:8099',
  );
  private readonly solverTimeoutMs = toNumber(
    process.env.PLANNING_SOLVER_TIMEOUT_MS,
    15_000,
  );
  private readonly solverTimeLimitSeconds = toOptionalNumber(
    process.env.PLANNING_SOLVER_TIME_LIMIT_SECONDS,
  );

  constructor(private readonly catalog: PlanningActivityCatalogService) {}

  async solve(
    snapshot: PlanningStageSnapshot,
    ruleset: RulesetIR,
    candidateResult: PlanningCandidateBuildResult,
  ): Promise<PlanningSolverResult> {
    if (!this.shouldUseRemote()) {
      throw new Error(
        'Remote Solver ist erforderlich (OR-Tools). Bitte `PLANNING_SOLVER_URL` setzen und `tools/solver_service` starten.',
      );
    }

    const request = this.buildRequest(snapshot, ruleset, candidateResult);
    const response = await this.requestSolver(request);
    const selectedCandidates = this.resolveSelectedCandidates(
      response,
      candidateResult,
    );
    const result = this.buildUpsertsFromCandidates(
      selectedCandidates,
      ruleset,
      snapshot,
    );

    const summary =
      response.summary ??
      (result.upserts.length
        ? `${result.upserts.length} Vorschlaege aus ${selectedCandidates.length} Kandidaten.`
        : 'Keine geeigneten Kandidaten gefunden.');

    return {
      summary,
      upserts: result.upserts,
      deletedIds: result.deletedIds,
      candidatesUsed: selectedCandidates,
    };
  }

  private shouldUseRemote(): boolean {
    if (!this.solverUrl) {
      return false;
    }
    return true;
  }

  private buildRequest(
    snapshot: PlanningStageSnapshot,
    ruleset: RulesetIR,
    candidateResult: PlanningCandidateBuildResult,
  ): PlanningSolverRequestPayload {
    const options: PlanningSolverRequestOptions = {
      max_per_service_type: 1,
      weight_key: 'gapMinutes',
    };
    if (this.solverTimeLimitSeconds !== null) {
      options.time_limit_seconds = this.solverTimeLimitSeconds;
    }
    return {
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
      candidates: candidateResult.candidates,
      snapshot: {
        stageId: snapshot.stageId,
        variantId: snapshot.variantId,
        timetableYearLabel: snapshot.timetableYearLabel ?? null,
      },
      options,
    };
  }

  private async requestSolver(
    payload: PlanningSolverRequestPayload,
  ): Promise<PlanningSolverRemoteResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.solverTimeoutMs);
    try {
      const response = await fetch(`${this.solverUrl}/solve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Solver-HTTP ${response.status} ${response.statusText}: ${text}`,
        );
      }
      return (await response.json()) as PlanningSolverRemoteResponse;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw new Error(
          `Solver-Request Timeout nach ${this.solverTimeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveSelectedCandidates(
    response: PlanningSolverRemoteResponse,
    candidateResult: PlanningCandidateBuildResult,
  ): PlanningCandidate[] {
    if (response.selectedCandidates?.length) {
      const byId = new Map(
        candidateResult.candidates.map((entry) => [entry.id, entry]),
      );
      return response.selectedCandidates
        .map((entry) => byId.get(entry.id))
        .filter((entry): entry is PlanningCandidate => !!entry);
    }
    if (response.selectedIds?.length) {
      const byId = new Map(
        candidateResult.candidates.map((entry) => [entry.id, entry]),
      );
      return response.selectedIds
        .map((id) => byId.get(id))
        .filter((entry): entry is PlanningCandidate => !!entry);
    }
    return [];
  }

  private solveLocally(
    snapshot: PlanningStageSnapshot,
    ruleset: RulesetIR,
    candidateResult: PlanningCandidateBuildResult,
  ): PlanningSolverResult {
    const selectedCandidates = [
      ...candidateResult.candidates.filter((c) => c.type === 'duty'),
      ...this.selectBestByService(
        candidateResult.candidates.filter((c) => c.type === 'break'),
      ),
      ...this.selectBestByService(
        candidateResult.candidates.filter((c) => c.type === 'travel'),
      ),
    ];

    const result = this.buildUpsertsFromCandidates(
      selectedCandidates,
      ruleset,
      snapshot,
    );

    const summary =
      result.upserts.length > 0
        ? `${result.upserts.length} Vorschlaege aus ${selectedCandidates.length} Kandidaten.`
        : 'Keine geeigneten Kandidaten gefunden.';

    return {
      summary,
      upserts: result.upserts,
      deletedIds: result.deletedIds,
      candidatesUsed: selectedCandidates,
    };
  }

  private selectBestByService(
    candidates: PlanningCandidate[],
  ): PlanningCandidate[] {
    const byService = new Map<string, PlanningCandidate>();
    for (const candidate of candidates) {
      const serviceId = this.readString(candidate.params, 'serviceId');
      const key = serviceId || '_';
      const gap = this.readNumber(candidate.params, 'gapMinutes', 0);
      const current = byService.get(key);
      if (!current) {
        byService.set(key, candidate);
        continue;
      }
      const currentGap = this.readNumber(current.params, 'gapMinutes', 0);
      if (gap > currentGap) {
        byService.set(key, candidate);
      }
    }
    return Array.from(byService.values());
  }

  private buildUpsertsFromCandidates(
    candidates: PlanningCandidate[],
    ruleset: RulesetIR,
    snapshot: PlanningStageSnapshot,
  ): { upserts: Activity[]; deletedIds: string[] } {
    const activityById = new Map(
      snapshot.activities.map((activity) => [activity.id, activity]),
    );
    const activityUpdates = new Map<string, Activity>();
    const boundaryUpserts: Activity[] = [];
    const dutyCandidates = candidates.filter(
      (candidate) => candidate.type === 'duty',
    );
    const deletedIds = new Set<string>();

    if (dutyCandidates.length) {
      const boundaryTypeIndex = this.resolveBoundaryTypeIndex();
      for (const candidate of dutyCandidates) {
        const dutyResult = this.buildDutyUpserts(
          candidate,
          ruleset,
          snapshot,
          activityById,
          boundaryTypeIndex,
          activityUpdates,
        );
        boundaryUpserts.push(...dutyResult.boundaries);
      }
    }

    const generated: Activity[] = [];
    candidates.forEach((candidate) => {
      if (candidate.type === 'break') {
        const result = this.buildBreakMutation(candidate, ruleset, snapshot);
        if (result.upsert) {
          generated.push(result.upsert);
        }
        result.deleteIds.forEach((id) => deletedIds.add(id));
        return;
      }
      if (candidate.type === 'travel') {
        const activity = this.buildActivityFromCandidate(
          candidate,
          ruleset,
          snapshot,
        );
        if (activity) {
          generated.push(activity);
        }
      }
    });

    return {
      upserts: [
        ...generated,
        ...boundaryUpserts,
        ...Array.from(activityUpdates.values()),
      ],
      deletedIds: Array.from(deletedIds),
    };
  }

  private buildActivityFromCandidate(
    candidate: PlanningCandidate,
    ruleset: RulesetIR,
    snapshot: PlanningStageSnapshot,
  ): Activity | null {
    if (candidate.type !== 'break' && candidate.type !== 'travel') {
      return null;
    }
    const startIso = this.readString(candidate.params, 'windowStart');
    const endIso = this.readString(candidate.params, 'windowEnd');
    if (!startIso || !endIso) {
      return null;
    }
    const startMs = this.toMs(startIso);
    const endMs = this.toMs(endIso);
    if (startMs === null || endMs === null || endMs <= startMs) {
      return null;
    }

    const durationMinutes = this.readNumber(
      candidate.params,
      'durationMinutes',
      30,
    );
    const maxEnd =
      candidate.type === 'break'
        ? Math.min(endMs, startMs + durationMinutes * 60_000)
        : endMs;
    const resolvedEndMs = Math.max(startMs, maxEnd);
    const activityType = this.resolveActivityType(candidate);
    const title =
      candidate.type === 'break'
        ? 'Pause (Optimierung)'
        : 'Wegzeit (Optimierung)';
    const serviceId = this.readString(candidate.params, 'serviceId');
    const fromLocation = this.readString(candidate.params, 'fromLocation');
    const toLocation = this.readString(candidate.params, 'toLocation');
    const participants = this.resolveParticipants(
      candidate.params,
      snapshot.activities,
      serviceId,
    );

    return {
      id: this.buildActivityId(candidate),
      title,
      start: new Date(startMs).toISOString(),
      end: new Date(resolvedEndMs).toISOString(),
      type: activityType,
      serviceId: serviceId || null,
      from: fromLocation || null,
      to: toLocation || null,
      participants: participants.length ? participants : undefined,
      meta: {
        optimizer: true,
        candidateId: candidate.id,
        templateId: candidate.templateId,
        rulesetId: ruleset.id,
        rulesetVersion: ruleset.version,
        snapshotStage: snapshot.stageId,
      },
    };
  }

  private buildBreakMutation(
    candidate: PlanningCandidate,
    ruleset: RulesetIR,
    snapshot: PlanningStageSnapshot,
  ): { upsert: Activity | null; deleteIds: string[] } {
    const startIso = this.readString(candidate.params, 'windowStart');
    const endIso = this.readString(candidate.params, 'windowEnd');
    if (!startIso || !endIso) {
      return { upsert: null, deleteIds: [] };
    }
    const startMs = this.toMs(startIso);
    const endMs = this.toMs(endIso);
    if (startMs === null || endMs === null || endMs <= startMs) {
      return { upsert: null, deleteIds: [] };
    }

    const durationMinutes = this.readNumber(
      candidate.params,
      'durationMinutes',
      30,
    );
    const maxEnd = Math.min(endMs, startMs + durationMinutes * 60_000);
    const resolvedEndMs = Math.max(startMs, maxEnd);
    const activityType = this.resolveActivityType(candidate);
    const title = 'Pause (Optimierung)';
    const serviceId = this.readString(candidate.params, 'serviceId');
    const participants = this.resolveParticipants(
      candidate.params,
      snapshot.activities,
      serviceId,
    );

    const existing = serviceId
      ? this.collectExistingBreaks(
          snapshot.activities,
          serviceId,
          startMs,
          endMs,
        )
      : [];
    if (existing.length) {
      const primary = existing[0];
      const deleteIds = existing.slice(1).map((entry) => entry.id);
      const updated: Activity = {
        ...primary,
        title: primary.title?.trim().length ? primary.title : title,
        start: new Date(startMs).toISOString(),
        end: new Date(resolvedEndMs).toISOString(),
        type: activityType,
        serviceId: serviceId || primary.serviceId || null,
        participants: participants.length ? participants : primary.participants,
        meta: {
          ...(primary.meta ?? {}),
          optimizer: true,
          candidateId: candidate.id,
          templateId: candidate.templateId,
          rulesetId: ruleset.id,
          rulesetVersion: ruleset.version,
          snapshotStage: snapshot.stageId,
        },
      };
      return { upsert: updated, deleteIds };
    }

    const created: Activity = {
      id: this.buildActivityId(candidate),
      title,
      start: new Date(startMs).toISOString(),
      end: new Date(resolvedEndMs).toISOString(),
      type: activityType,
      serviceId: serviceId || null,
      participants: participants.length ? participants : undefined,
      meta: {
        optimizer: true,
        candidateId: candidate.id,
        templateId: candidate.templateId,
        rulesetId: ruleset.id,
        rulesetVersion: ruleset.version,
        snapshotStage: snapshot.stageId,
      },
    };
    return { upsert: created, deleteIds: [] };
  }

  private collectExistingBreaks(
    activities: Activity[],
    serviceId: string,
    windowStartMs: number,
    windowEndMs: number,
  ): Activity[] {
    return activities
      .filter((activity) => this.activityMatchesService(activity, serviceId))
      .filter((activity) => this.isBreakActivity(activity))
      .filter((activity) =>
        this.activityOverlapsWindow(activity, windowStartMs, windowEndMs),
      )
      .sort((a, b) => {
        const aMs = this.toMs(a.start) ?? 0;
        const bMs = this.toMs(b.start) ?? 0;
        if (aMs === bMs) {
          return a.id.localeCompare(b.id);
        }
        return aMs - bMs;
      });
  }

  private activityOverlapsWindow(
    activity: Activity,
    windowStartMs: number,
    windowEndMs: number,
  ): boolean {
    const startMs = this.toMs(activity.start);
    if (startMs === null) {
      return false;
    }
    const endMs = this.toMs(activity.end ?? activity.start) ?? startMs;
    return endMs >= windowStartMs && startMs <= windowEndMs;
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

  private resolveActivityType(candidate: PlanningCandidate): string {
    const type =
      this.readString(candidate.params, 'activityTypeId') ||
      this.readString(candidate.params, 'typeId') ||
      this.readString(candidate.params, 'activityType');
    if (type) {
      return type;
    }
    return candidate.type === 'break' ? 'break' : 'travel';
  }

  private buildActivityId(candidate: PlanningCandidate): string {
    const raw = `opt-${candidate.id}`;
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '-');
    return safe.length > 96 ? safe.slice(0, 96) : safe;
  }

  private parseParticipants(raw: unknown): ActivityParticipant[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const parsed = raw
      .map((entry) => (typeof entry === 'string' ? entry : ''))
      .map((entry) => entry.split('|'))
      .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
      .map((parts) => ({
        kind: parts[0],
        resourceId: parts[1],
        role: parts[2] ? parts[2] : null,
      }));
    return parsed as ActivityParticipant[];
  }

  private resolveParticipants(
    params: Record<string, unknown>,
    activities: Activity[],
    serviceId: string,
  ): ActivityParticipant[] {
    const parsed = this.parseParticipants(params['participantKeys']);
    if (parsed.length) {
      return parsed;
    }
    if (!serviceId) {
      return [];
    }
    return this.inferParticipantsForService(activities, serviceId);
  }

  private inferParticipantsForService(
    activities: Activity[],
    serviceId: string,
  ): ActivityParticipant[] {
    const participants: ActivityParticipant[] = [];
    const seen = new Set<string>();

    const addParticipant = (participant: ActivityParticipant) => {
      if (!participant?.resourceId) {
        return;
      }
      const key = `${participant.kind ?? ''}|${participant.resourceId}|${participant.role ?? ''}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      participants.push(participant);
    };

    for (const activity of activities) {
      if (!this.activityMatchesService(activity, serviceId)) {
        continue;
      }
      const owners = this.resolveDutyOwners(activity);
      if (owners.length) {
        owners.forEach((owner) => addParticipant(owner));
      } else {
        (activity.participants ?? []).forEach((participant) =>
          addParticipant(participant),
        );
      }
    }

    return participants;
  }

  private activityMatchesService(
    activity: Activity,
    serviceId: string,
  ): boolean {
    const direct =
      typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
    if (direct && direct === serviceId) {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const map = attrs?.['service_by_owner'];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      return Object.values(map as Record<string, any>).some((entry) => {
        const candidate =
          typeof entry?.serviceId === 'string' ? entry.serviceId.trim() : '';
        return candidate === serviceId;
      });
    }
    return false;
  }

  private readString(params: Record<string, unknown>, key: string): string {
    const raw = params[key];
    if (typeof raw === 'string') {
      return raw.trim();
    }
    return '';
  }

  private readStringArray(
    params: Record<string, unknown>,
    key: string,
  ): string[] {
    const raw = params[key];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  private readNumber(
    params: Record<string, unknown>,
    key: string,
    fallback: number,
  ): number {
    const raw = params[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string') {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
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

  private toMs(value: string): number | null {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private buildDutyUpserts(
    candidate: PlanningCandidate,
    ruleset: RulesetIR,
    snapshot: PlanningStageSnapshot,
    activityById: Map<string, Activity>,
    boundaryTypes: ServiceBoundaryTypeIndex,
    activityUpdates: Map<string, Activity>,
  ): { boundaries: Activity[] } {
    if (candidate.type !== 'duty') {
      return { boundaries: [] };
    }
    const serviceId = this.readString(candidate.params, 'serviceId');
    const ownerId = this.readString(candidate.params, 'ownerId');
    const ownerKind = this.readResourceKind(candidate.params['ownerKind']);
    if (!serviceId || !ownerId || !ownerKind) {
      return { boundaries: [] };
    }

    const activityIds = this.readStringArray(candidate.params, 'activityIds');
    const activityEntries = activityIds
      .map((id) => activityUpdates.get(id) ?? activityById.get(id))
      .filter((entry): entry is Activity => !!entry);
    if (!activityEntries.length) {
      return { boundaries: [] };
    }

    const ownerRole = this.readString(candidate.params, 'ownerRole') || null;
    const owner: ActivityParticipant = {
      resourceId: ownerId,
      kind: ownerKind,
      role: ownerRole,
    };
    const ownerGroup = this.resolveOwnerGroup(owner.kind);
    const startTypeId =
      ownerGroup === 'vehicle'
        ? boundaryTypes.vehicleStart
        : boundaryTypes.personnelStart;
    const endTypeId =
      ownerGroup === 'vehicle'
        ? boundaryTypes.vehicleEnd
        : boundaryTypes.personnelEnd;

    const startMs = this.resolveDutyStartMs(candidate, activityEntries);
    const endMs = this.resolveDutyEndMs(candidate, activityEntries, startMs);
    if (startMs === null || endMs === null) {
      return { boundaries: [] };
    }
    const safeEndMs = Math.max(endMs, startMs);

    for (const activity of activityEntries) {
      const updated = this.applyServiceAssignment(activity, owner, serviceId);
      if (updated) {
        activityUpdates.set(updated.id, updated);
      }
    }

    const boundaries: Activity[] = [];
    const startId = `svcstart:${serviceId}`;
    const endId = `svcend:${serviceId}`;
    const existingStart =
      activityById.get(startId) ?? activityUpdates.get(startId) ?? null;
    const existingEnd =
      activityById.get(endId) ?? activityUpdates.get(endId) ?? null;

    boundaries.push(
      this.buildBoundaryActivity({
        id: startId,
        title: existingStart?.title ?? 'Dienstanfang',
        type: startTypeId,
        role: 'start',
        startMs,
        owner,
        serviceId,
        ruleset,
        snapshot,
        candidateId: candidate.id,
      }),
    );
    boundaries.push(
      this.buildBoundaryActivity({
        id: endId,
        title: existingEnd?.title ?? 'Dienstende',
        type: endTypeId,
        role: 'end',
        startMs: safeEndMs,
        owner,
        serviceId,
        ruleset,
        snapshot,
        candidateId: candidate.id,
      }),
    );

    return { boundaries };
  }

  private resolveDutyStartMs(
    candidate: PlanningCandidate,
    activities: Activity[],
  ): number | null {
    const startIso = this.readString(candidate.params, 'dutyStart');
    const explicit = startIso ? this.toMs(startIso) : null;
    if (explicit !== null) {
      return explicit;
    }
    let min = Number.POSITIVE_INFINITY;
    for (const activity of activities) {
      const start = this.toMs(activity.start);
      if (start !== null) {
        min = Math.min(min, start);
      }
    }
    return Number.isFinite(min) ? min : null;
  }

  private resolveDutyEndMs(
    candidate: PlanningCandidate,
    activities: Activity[],
    fallbackStart: number | null,
  ): number | null {
    const endIso = this.readString(candidate.params, 'dutyEnd');
    const explicit = endIso ? this.toMs(endIso) : null;
    if (explicit !== null) {
      return explicit;
    }
    let max = Number.NEGATIVE_INFINITY;
    for (const activity of activities) {
      const end = this.toMs(activity.end ?? activity.start);
      if (end !== null) {
        max = Math.max(max, end);
      }
    }
    if (Number.isFinite(max)) {
      return max;
    }
    return fallbackStart;
  }

  private applyServiceAssignment(
    activity: Activity,
    owner: ActivityParticipant,
    serviceId: string,
  ): Activity | null {
    const owners = this.resolveDutyOwners(activity);
    const hasMultipleOwners = owners.length > 1;
    const nextAttrs: Record<string, unknown> = {
      ...(activity.attributes ?? {}),
    };
    const serviceByOwner = this.ensureServiceByOwner(nextAttrs);
    const currentEntry = serviceByOwner[owner.resourceId];
    const currentServiceId =
      typeof currentEntry?.serviceId === 'string'
        ? currentEntry.serviceId
        : null;
    let changed = false;

    if (currentServiceId !== serviceId) {
      serviceByOwner[owner.resourceId] = { ...(currentEntry ?? {}), serviceId };
      changed = true;
    }

    const next: Activity = { ...activity };
    if (!hasMultipleOwners && activity.serviceId !== serviceId) {
      next.serviceId = serviceId;
      changed = true;
    }

    if (!changed) {
      return null;
    }
    next.attributes = nextAttrs;
    return next;
  }

  private ensureServiceByOwner(
    attrs: Record<string, unknown>,
  ): Record<string, any> {
    const raw = attrs['service_by_owner'];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, any>;
    }
    const next: Record<string, any> = {};
    attrs['service_by_owner'] = next;
    return next;
  }

  private resolveDutyOwners(activity: Activity): ActivityParticipant[] {
    const participants = activity.participants ?? [];
    const preferred = participants.filter(
      (p) => p.kind === 'personnel-service' || p.kind === 'vehicle-service',
    );
    return preferred;
  }

  private resolveOwnerGroup(
    kind: ActivityParticipant['kind'],
  ): 'personnel' | 'vehicle' {
    if (kind === 'vehicle' || kind === 'vehicle-service') {
      return 'vehicle';
    }
    return 'personnel';
  }

  private buildBoundaryActivity(options: {
    id: string;
    title: string;
    type: string;
    role: 'start' | 'end';
    startMs: number;
    owner: ActivityParticipant;
    serviceId: string;
    ruleset: RulesetIR;
    snapshot: PlanningStageSnapshot;
    candidateId: string;
  }): Activity {
    return {
      id: options.id,
      title: options.title,
      start: new Date(options.startMs).toISOString(),
      end: null,
      type: options.type,
      serviceId: options.serviceId,
      serviceRole: options.role,
      participants: [this.buildOwnerParticipant(options.owner)],
      meta: {
        optimizer: true,
        candidateId: options.candidateId,
        rulesetId: options.ruleset.id,
        rulesetVersion: options.ruleset.version,
        snapshotStage: options.snapshot.stageId,
      },
    };
  }

  private buildOwnerParticipant(
    owner: ActivityParticipant,
  ): ActivityParticipant {
    return {
      resourceId: owner.resourceId,
      kind: owner.kind,
      role:
        owner.role ??
        (owner.kind === 'vehicle' || owner.kind === 'vehicle-service'
          ? 'primary-vehicle'
          : 'primary-personnel'),
    };
  }

  private resolveBoundaryTypeIndex(): ServiceBoundaryTypeIndex {
    const definitions = this.catalog.listActivityDefinitions();
    return this.pickBoundaryTypes(definitions);
  }

  private pickBoundaryTypes(
    definitions: ActivityDefinition[],
  ): ServiceBoundaryTypeIndex {
    const flags = {
      serviceStart: [] as string[],
      serviceEnd: [] as string[],
      vehicleOn: [] as string[],
      vehicleOff: [] as string[],
    };
    const toBool = (value: unknown) =>
      typeof value === 'boolean'
        ? value
        : typeof value === 'string'
          ? value.toLowerCase() === 'true'
          : false;
    const readAttributeValue = (
      attributes: ActivityAttributeValue[] | undefined,
      key: string,
    ): unknown => {
      const entry = (attributes ?? []).find((attr) => attr.key === key);
      const meta = entry?.meta;
      return meta?.['value'];
    };
    const recordFlag = (
      list: string[],
      id: string,
      attributes: ActivityAttributeValue[] | undefined,
      key: string,
    ) => {
      if (toBool(readAttributeValue(attributes, key))) {
        list.push(id);
      }
    };
    definitions.forEach((definition) => {
      const id = `${definition?.activityType ?? ''}`.trim();
      if (!id) {
        return;
      }
      const attrs = definition.attributes ?? [];
      recordFlag(flags.serviceStart, id, attrs, 'is_service_start');
      recordFlag(flags.serviceEnd, id, attrs, 'is_service_end');
      recordFlag(flags.vehicleOn, id, attrs, 'is_vehicle_on');
      recordFlag(flags.vehicleOff, id, attrs, 'is_vehicle_off');
    });

    const vehicleOnSet = new Set(flags.vehicleOn);
    const vehicleOffSet = new Set(flags.vehicleOff);
    const serviceStartCandidates = flags.serviceStart.filter(
      (id) => !vehicleOnSet.has(id),
    );
    const serviceEndCandidates = flags.serviceEnd.filter(
      (id) => !vehicleOffSet.has(id),
    );

    const pickRequired = (
      label: string,
      ...candidates: Array<string | undefined>
    ) => {
      const match = candidates.find(
        (entry) => typeof entry === 'string' && entry.trim().length > 0,
      );
      if (!match) {
        throw new Error(`Activity-Katalog fehlt ${label}.`);
      }
      return match;
    };

    return {
      personnelStart: pickRequired(
        'Dienststart-Definition (Attribut is_service_start)',
        serviceStartCandidates[0],
        flags.serviceStart[0],
      ),
      personnelEnd: pickRequired(
        'Dienstende-Definition (Attribut is_service_end)',
        serviceEndCandidates[0],
        flags.serviceEnd[0],
      ),
      vehicleStart: pickRequired(
        'Fahrzeugstart-Definition (Attribut is_vehicle_on oder is_service_start)',
        flags.vehicleOn[0],
        serviceStartCandidates[0],
        flags.serviceStart[0],
      ),
      vehicleEnd: pickRequired(
        'Fahrzeugende-Definition (Attribut is_vehicle_off oder is_service_end)',
        flags.vehicleOff[0],
        serviceEndCandidates[0],
        flags.serviceEnd[0],
      ),
    };
  }

  private readResourceKind(value: unknown): ResourceKind | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (
      trimmed === 'personnel' ||
      trimmed === 'vehicle' ||
      trimmed === 'personnel-service' ||
      trimmed === 'vehicle-service'
    ) {
      return trimmed;
    }
    return null;
  }
}

type ServiceBoundaryTypeIndex = {
  personnelStart: string;
  personnelEnd: string;
  vehicleStart: string;
  vehicleEnd: string;
};

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
