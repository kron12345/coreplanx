import { Injectable, Logger } from '@nestjs/common';
import type {
  Activity,
  ActivityAttributeValue,
  ActivityDefinition,
  ActivityParticipant,
  OperationalPoint,
  PersonnelSite,
  Resource,
  ResourceKind,
  TransferEdge,
  TransferNode,
} from './planning.types';
import type { PlanningStageSnapshot } from './planning.types';
import type { RulesetIR } from './planning-ruleset.types';
import type {
  PlanningCandidate,
  PlanningCandidateBuildResult,
} from './planning-candidate-builder.service';
import { PlanningActivityCatalogService } from './planning-activity-catalog.service';
import { DutyAutopilotService } from './duty-autopilot.service';
import { PlanningMasterDataService } from './planning-master-data.service';

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

interface PlanningSolverProblem {
  groups: PlanningSolverGroup[];
}

interface PlanningSolverGroup {
  id: string;
  ownerId: string;
  ownerKind: ResourceKind;
  dayKey: string;
  activities: PlanningSolverGroupActivity[];
  edges: PlanningSolverGroupEdge[];
}

interface PlanningSolverGroupActivity {
  id: string;
  startMs: number;
  endMs: number;
}

interface PlanningSolverGroupEdge {
  fromId: string;
  toId: string;
  gapMinutes: number;
  travelMinutes: number;
  missingTravel?: boolean;
  missingLocation?: boolean;
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
  problem?: PlanningSolverProblem;
  options?: PlanningSolverRequestOptions;
}

interface PlanningSolverDutyGroup {
  groupId: string;
  ownerId?: string | null;
  ownerKind?: ResourceKind | null;
  dayKey?: string | null;
  duties: string[][];
}

interface PlanningSolverRemoteResponse {
  summary?: string;
  selectedIds?: string[];
  selectedCandidates?: PlanningCandidate[];
  dutyGroups?: PlanningSolverDutyGroup[];
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

  constructor(
    private readonly catalog: PlanningActivityCatalogService,
    private readonly masterData: PlanningMasterDataService,
    private readonly dutyAutopilot: DutyAutopilotService,
  ) {}

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
    const dutyGroups = response.dutyGroups ?? [];
    if (dutyGroups.length) {
      const result = await this.buildUpsertsFromDutyGroups(
        dutyGroups,
        ruleset,
        snapshot,
      );
      const summary =
        response.summary ??
        (result.upserts.length
          ? `${result.upserts.length} Vorschlaege aus ${dutyGroups.length} Dienstgruppen.`
          : 'Keine geeigneten Kandidaten gefunden.');
      return {
        summary,
        upserts: result.upserts,
        deletedIds: result.deletedIds,
        candidatesUsed: result.candidatesUsed,
      };
    }
    const selectedCandidates = this.resolveSelectedCandidates(
      response,
      candidateResult,
    );
    const result = await this.buildUpsertsFromCandidates(
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
    const problem = this.buildSolverProblem(snapshot);
    return {
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
      candidates: candidateResult.candidates,
      snapshot: {
        stageId: snapshot.stageId,
        variantId: snapshot.variantId,
        timetableYearLabel: snapshot.timetableYearLabel ?? null,
      },
      ...(problem.groups.length ? { problem } : {}),
      options,
    };
  }

  private buildSolverProblem(
    snapshot: PlanningStageSnapshot,
  ): PlanningSolverProblem {
    const context = this.buildSolverContext();
    const resourceKindById = this.buildResourceKindIndex(snapshot.resources);
    const groups = new Map<string, SolverGroupDraft>();

    for (const activity of snapshot.activities) {
      if (this.isManagedId(activity.id)) {
        continue;
      }
      if (this.isBreakActivity(activity) || this.isServiceBoundary(activity)) {
        continue;
      }
      const startMs = this.toMs(activity.start);
      if (startMs === null) {
        continue;
      }
      const endMs = this.resolveActivityEndMs(activity, startMs);
      const owners = this.resolveSolverOwners(activity, resourceKindById);
      if (!owners.length) {
        continue;
      }
      const dayKey = this.utcDayKeyFromMs(startMs);
      for (const owner of owners) {
        const ownerId = `${owner.resourceId ?? ''}`.trim();
        if (!ownerId) {
          continue;
        }
        const groupId = this.computeServiceId(
          snapshot.stageId,
          ownerId,
          dayKey,
        );
        let draft = groups.get(groupId);
        if (!draft) {
          draft = {
            group: {
              id: groupId,
              ownerId,
              ownerKind: owner.kind,
              dayKey,
              activities: [],
              edges: [],
            },
            entries: [],
            activityIds: new Set<string>(),
          };
          groups.set(groupId, draft);
        }
        if (draft.activityIds.has(activity.id)) {
          continue;
        }
        draft.activityIds.add(activity.id);
        draft.entries.push({ activity, startMs, endMs });
      }
    }

    for (const draft of groups.values()) {
      const entries = draft.entries.sort(
        (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
      );
      draft.group.activities = entries.map((entry) => ({
        id: entry.activity.id,
        startMs: entry.startMs,
        endMs: entry.endMs,
      }));
      draft.group.edges = this.buildSolverEdges(entries, context);
    }

    return { groups: Array.from(groups.values()).map((entry) => entry.group) };
  }

  private buildSolverEdges(
    entries: SolverActivityEntry[],
    context: SolverMasterDataContext,
  ): PlanningSolverGroupEdge[] {
    const meta = entries.map((entry) => {
      const startLocation = this.readStartLocation(entry.activity);
      const endLocation = this.readEndLocation(entry.activity);
      const startOpId = startLocation
        ? this.resolveOperationalPointId(startLocation, context)
        : null;
      const endOpId = endLocation
        ? this.resolveOperationalPointId(endLocation, context)
        : null;
      return {
        ...entry,
        startLocation,
        endLocation,
        startOpId,
        endOpId,
      };
    });

    const edges: PlanningSolverGroupEdge[] = [];
    for (let i = 0; i < meta.length; i += 1) {
      const from = meta[i];
      for (let j = i + 1; j < meta.length; j += 1) {
        const to = meta[j];
        const gapMs = to.startMs - from.endMs;
        if (gapMs < 0) {
          continue;
        }
        const travel = this.resolveTravelMs(from, to, context);
        if (travel.ms > gapMs) {
          continue;
        }
        edges.push({
          fromId: from.activity.id,
          toId: to.activity.id,
          gapMinutes: Math.max(0, Math.floor(gapMs / 60000)),
          travelMinutes: Math.max(0, Math.ceil(travel.ms / 60000)),
          ...(travel.missingTravel ? { missingTravel: true } : {}),
          ...(travel.missingLocation ? { missingLocation: true } : {}),
        });
      }
    }
    return edges;
  }

  private resolveTravelMs(
    from: SolverActivityMeta,
    to: SolverActivityMeta,
    context: SolverMasterDataContext,
  ): { ms: number; missingTravel: boolean; missingLocation: boolean } {
    const fromOpId = from.endOpId;
    const toOpId = to.startOpId;
    if (!fromOpId || !toOpId) {
      return { ms: 0, missingTravel: true, missingLocation: true };
    }
    if (fromOpId === toOpId) {
      return { ms: 0, missingTravel: false, missingLocation: false };
    }
    const walkMs = this.lookupWalkTimeMs(
      context,
      `OP:${fromOpId}`,
      `OP:${toOpId}`,
    );
    if (walkMs === null) {
      return { ms: 0, missingTravel: true, missingLocation: false };
    }
    return { ms: walkMs, missingTravel: false, missingLocation: false };
  }

  private buildSolverContext(): SolverMasterDataContext {
    const personnelSites = this.masterData.listPersonnelSites();
    const operationalPoints = this.masterData.listOperationalPoints();
    const transferEdges = this.masterData.listTransferEdges();

    const personnelSitesById = new Map<string, PersonnelSite>(
      personnelSites.map((site) => [site.siteId, site]),
    );
    const operationalPointsById = new Map<string, OperationalPoint>(
      operationalPoints.map((point) => [
        `${point.uniqueOpId ?? ''}`.trim().toUpperCase(),
        point,
      ]),
    );

    const walkTimeMs = new Map<string, number>();
    for (const edge of transferEdges) {
      if (edge.mode !== 'WALK') {
        continue;
      }
      const durationSec = edge.avgDurationSec ?? null;
      if (
        durationSec === null ||
        !Number.isFinite(durationSec) ||
        durationSec <= 0
      ) {
        continue;
      }
      const fromKey = this.transferNodeKey(edge.from);
      const toKey = this.transferNodeKey(edge.to);
      if (!fromKey || !toKey) {
        continue;
      }
      const ms = Math.round(durationSec * 1000);
      walkTimeMs.set(`${fromKey}|${toKey}`, ms);
      if (edge.bidirectional) {
        walkTimeMs.set(`${toKey}|${fromKey}`, ms);
      }
    }

    return {
      personnelSitesById,
      operationalPointsById,
      walkTimeMs,
    };
  }

  private buildResourceKindIndex(resources: Resource[]): Map<string, ResourceKind> {
    const map = new Map<string, ResourceKind>();
    resources.forEach((resource) => {
      const id = `${resource.id ?? ''}`.trim();
      if (!id) {
        return;
      }
      map.set(id, resource.kind);
    });
    return map;
  }

  private resolveSolverOwners(
    activity: Activity,
    resourceKindById: Map<string, ResourceKind>,
  ): ActivityParticipant[] {
    const participants = activity.participants ?? [];
    const preferred = participants.filter(
      (p) => p.kind === 'personnel-service' || p.kind === 'vehicle-service',
    );
    if (preferred.length) {
      return preferred;
    }
    const direct = participants.filter(
      (p) => p.kind === 'personnel' || p.kind === 'vehicle',
    );
    if (direct.length) {
      return direct;
    }

    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const map = attrs?.['service_by_owner'];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const fallbackOwners = Object.keys(map)
        .map((ownerId) => ownerId.trim())
        .filter((ownerId) => ownerId.length > 0)
        .map((ownerId) => {
          const kind = resourceKindById.get(ownerId);
          return kind ? { resourceId: ownerId, kind } : null;
        })
        .filter((entry): entry is ActivityParticipant => entry !== null);
      if (fallbackOwners.length) {
        return fallbackOwners;
      }
    }

    const serviceId = this.resolveServiceId(activity);
    if (!serviceId) {
      return [];
    }
    const ownerId = this.parseOwnerIdFromServiceId(serviceId);
    if (!ownerId) {
      return [];
    }
    const ownerKind = resourceKindById.get(ownerId);
    if (!ownerKind) {
      return [];
    }
    return [{ resourceId: ownerId, kind: ownerKind }];
  }

  private resolveActivityEndMs(activity: Activity, startMs: number): number {
    const endMs = this.toMs(activity.end ?? activity.start);
    if (endMs === null) {
      return startMs;
    }
    return Math.max(startMs, endMs);
  }

  private resolveServiceId(activity: Activity): string | null {
    const direct =
      typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
    if (direct) {
      return direct;
    }
    return this.parseServiceIdFromManagedId(activity.id);
  }

  private utcDayKeyFromMs(ms: number): string {
    const date = new Date(ms);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private computeServiceId(
    stageId: string,
    ownerId: string,
    dayKey: string,
  ): string {
    return `svc:${stageId}:${ownerId}:${dayKey}`;
  }

  private buildIndexedServiceId(
    stageId: string,
    ownerId: string,
    dayKey: string,
    index: number,
  ): string {
    const suffix = `${index}`;
    return `svc:${stageId}:${ownerId}:${suffix}:${dayKey}`;
  }

  private parseDayKeyFromServiceId(serviceId: string): string | null {
    const trimmed = (serviceId ?? '').trim();
    if (!trimmed.startsWith('svc:')) {
      return null;
    }
    const parts = trimmed.split(':');
    const dayKey = parts[parts.length - 1] ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : null;
  }

  private parseOwnerIdFromServiceId(serviceId: string): string | null {
    const trimmed = (serviceId ?? '').trim();
    if (!trimmed.startsWith('svc:')) {
      return null;
    }
    const parts = trimmed.split(':');
    const ownerId = parts[2] ?? '';
    return ownerId ? ownerId : null;
  }

  private normalizeLocation(value: string | null | undefined): string | null {
    const normalized = (value ?? '').trim();
    if (!normalized) {
      return null;
    }
    return normalized.toUpperCase();
  }

  private resolveOperationalPointId(
    value: string | null | undefined,
    context: SolverMasterDataContext,
  ): string | null {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      return null;
    }

    const normalized = this.normalizeLocation(trimmed);
    if (!normalized) {
      return null;
    }
    if (context.operationalPointsById.has(normalized)) {
      return normalized;
    }
    const site = context.personnelSitesById.get(trimmed) ?? null;
    if (site?.uniqueOpId) {
      const opId = this.normalizeLocation(site.uniqueOpId);
      if (opId) {
        return opId;
      }
    }
    const siteMatches = Array.from(context.personnelSitesById.entries()).filter(
      ([, candidate]) => {
        const siteName =
          typeof candidate?.name === 'string' ? candidate.name : '';
        return this.normalizeLocation(siteName) === normalized;
      },
    );
    if (siteMatches.length === 1) {
      const opId = this.normalizeLocation(siteMatches[0][1]?.uniqueOpId);
      if (opId) {
        return opId;
      }
    }
    const matches = Array.from(context.operationalPointsById.entries()).filter(
      ([, op]) => {
        const opName = typeof op?.name === 'string' ? op.name : '';
        return this.normalizeLocation(opName) === normalized;
      },
    );
    if (matches.length === 1) {
      return matches[0][0];
    }
    return null;
  }

  private transferNodeKey(node: TransferNode): string | null {
    switch (node.kind) {
      case 'OP': {
        const ref = `${node.uniqueOpId ?? ''}`.trim();
        return ref ? `OP:${ref.toUpperCase()}` : null;
      }
      case 'PERSONNEL_SITE': {
        const ref = `${(node as any).siteId ?? ''}`.trim();
        return ref ? `PERSONNEL_SITE:${ref}` : null;
      }
      case 'REPLACEMENT_STOP': {
        const ref = `${(node as any).replacementStopId ?? ''}`.trim();
        return ref ? `REPLACEMENT_STOP:${ref}` : null;
      }
    }
  }

  private lookupWalkTimeMs(
    context: SolverMasterDataContext,
    from: string,
    to: string,
  ): number | null {
    const direct = context.walkTimeMs.get(`${from}|${to}`);
    if (direct !== undefined) {
      return direct;
    }
    const reverse = context.walkTimeMs.get(`${to}|${from}`);
    return reverse !== undefined ? reverse : null;
  }

  private readStartLocation(activity: Activity): string | null {
    const locId = `${activity.locationId ?? ''}`.trim();
    if (locId) {
      return locId;
    }
    const from = `${activity.from ?? ''}`.trim();
    if (from) {
      return from;
    }
    const label = `${activity.locationLabel ?? ''}`.trim();
    if (label) {
      return label;
    }
    const to = `${activity.to ?? ''}`.trim();
    return to || null;
  }

  private readEndLocation(activity: Activity): string | null {
    const locId = `${activity.locationId ?? ''}`.trim();
    if (locId) {
      return locId;
    }
    const to = `${activity.to ?? ''}`.trim();
    if (to) {
      return to;
    }
    const label = `${activity.locationLabel ?? ''}`.trim();
    if (label) {
      return label;
    }
    const from = `${activity.from ?? ''}`.trim();
    return from || null;
  }

  private isServiceBoundary(activity: Activity): boolean {
    const role = activity.serviceRole ?? null;
    if (role === 'start' || role === 'end') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    if (!attrs) {
      return false;
    }
    return (
      this.toBool(attrs['is_service_start']) ||
      this.toBool(attrs['is_service_end'])
    );
  }

  private addCleanupServiceIds(
    serviceIds: Set<string>,
    scopes: Set<string>,
    snapshot: PlanningStageSnapshot,
  ): void {
    if (!scopes.size) {
      return;
    }
    const stagePrefix = `svc:${snapshot.stageId}:`;
    for (const activity of snapshot.activities) {
      const serviceId = this.resolveServiceId(activity);
      if (!serviceId || !serviceId.startsWith(stagePrefix)) {
        continue;
      }
      const ownerId = this.parseOwnerIdFromServiceId(serviceId);
      const dayKey = this.parseDayKeyFromServiceId(serviceId);
      if (!ownerId || !dayKey) {
        continue;
      }
      if (scopes.has(`${ownerId}|${dayKey}`)) {
        serviceIds.add(serviceId);
      }
    }
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

  private async solveLocally(
    snapshot: PlanningStageSnapshot,
    ruleset: RulesetIR,
    candidateResult: PlanningCandidateBuildResult,
  ): Promise<PlanningSolverResult> {
    const selectedCandidates = [
      ...candidateResult.candidates.filter((c) => c.type === 'duty'),
      ...this.selectBestByService(
        candidateResult.candidates.filter((c) => c.type === 'break'),
      ),
      ...this.selectBestByService(
        candidateResult.candidates.filter((c) => c.type === 'travel'),
      ),
    ];

    const result = await this.buildUpsertsFromCandidates(
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

  private async buildUpsertsFromDutyGroups(
    dutyGroups: PlanningSolverDutyGroup[],
    _ruleset: RulesetIR,
    snapshot: PlanningStageSnapshot,
  ): Promise<{
    upserts: Activity[];
    deletedIds: string[];
    candidatesUsed: PlanningCandidate[];
  }> {
    const activityById = new Map(
      snapshot.activities.map((activity) => [activity.id, activity]),
    );
    const assignmentsByActivityId = new Map<string, Record<string, string>>();
    const relevantActivityIds = new Set<string>();
    const serviceIdsForCleanup = new Set<string>();
    const candidatesUsed: PlanningCandidate[] = [];
    const cleanupScopes = new Set<string>();

    for (const group of dutyGroups) {
      const rawOwnerId = `${group.ownerId ?? ''}`.trim();
      const ownerId =
        rawOwnerId || this.parseOwnerIdFromServiceId(group.groupId);
      const ownerKind = group.ownerKind ?? null;
      if (!ownerId || !ownerKind) {
        continue;
      }
      const baseDayKey =
        group.dayKey ?? this.parseDayKeyFromServiceId(group.groupId);
      const baseServiceId =
        group.groupId ||
        (baseDayKey
          ? this.computeServiceId(snapshot.stageId, ownerId, baseDayKey)
          : '');
      if (!baseServiceId) {
        continue;
      }
      serviceIdsForCleanup.add(baseServiceId);
      const duties = Array.isArray(group.duties) ? group.duties : [];
      const useIndexed = duties.length > 1;

      duties.forEach((activityIds, index) => {
        const dutyIndex = index + 1;
        const dutyActivities = activityIds
          .map((id) => activityById.get(id))
          .filter((entry): entry is Activity => !!entry);
        if (!dutyActivities.length) {
          return;
        }
        const dutyDayKey =
          baseDayKey ?? this.resolveDayKeyFromActivities(dutyActivities);
        if (!dutyDayKey) {
          return;
        }
        const serviceId = useIndexed
          ? this.buildIndexedServiceId(
              snapshot.stageId,
              ownerId,
              dutyDayKey,
              dutyIndex,
            )
          : baseServiceId;
        if (!serviceId) {
          return;
        }
        cleanupScopes.add(`${ownerId}|${dutyDayKey}`);
        serviceIdsForCleanup.add(serviceId);

        activityIds.forEach((activityId) => {
          relevantActivityIds.add(activityId);
          const map = assignmentsByActivityId.get(activityId) ?? {};
          map[ownerId] = serviceId;
          assignmentsByActivityId.set(activityId, map);
        });

        const stats = this.computeDutyStats(dutyActivities);
        candidatesUsed.push({
          id: `cand:ortools:${baseServiceId}:${dutyIndex}`,
          templateId: 'ortools-duty',
          type: 'duty',
          params: {
            ownerId,
            ownerKind,
            serviceId,
            dayKey: dutyDayKey,
            activityIds,
            dutyStart: stats.dutyStart,
            dutyEnd: stats.dutyEnd,
            dutySpanMinutes: stats.dutySpanMinutes,
            workMinutes: stats.workMinutes,
            durationMinutes: stats.dutySpanMinutes,
          },
        });
      });
    }

    if (!relevantActivityIds.size) {
      return { upserts: [], deletedIds: [], candidatesUsed };
    }

    this.addCleanupServiceIds(
      serviceIdsForCleanup,
      cleanupScopes,
      snapshot,
    );

    const relevant: Activity[] = [];
    const seen = new Set<string>();
    snapshot.activities.forEach((activity) => {
      if (
        relevantActivityIds.has(activity.id) ||
        this.isManagedActivityForServices(activity, serviceIdsForCleanup)
      ) {
        if (!seen.has(activity.id)) {
          const assignments = assignmentsByActivityId.get(activity.id);
          relevant.push(
            assignments
              ? this.applyServiceAssignments(activity, assignments)
              : activity,
          );
          seen.add(activity.id);
        }
      }
    });

    if (!relevant.length) {
      return { upserts: [], deletedIds: [], candidatesUsed };
    }

    const result = await this.dutyAutopilot.apply(
      snapshot.stageId,
      snapshot.variantId,
      relevant,
    );
    return {
      upserts: result.upserts,
      deletedIds: result.deletedIds,
      candidatesUsed,
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

  private async buildUpsertsFromCandidates(
    candidates: PlanningCandidate[],
    ruleset: RulesetIR,
    snapshot: PlanningStageSnapshot,
  ): Promise<{ upserts: Activity[]; deletedIds: string[] }> {
    const activityById = new Map(
      snapshot.activities.map((activity) => [activity.id, activity]),
    );
    const upsertsById = new Map<string, Activity>();
    const dutyCandidates = candidates.filter(
      (candidate) => candidate.type === 'duty',
    );
    const deletedIds = new Set<string>();
    const handledServiceIds = new Set<string>();

    if (dutyCandidates.length) {
      const autopilotResult = await this.applyAutopilotForDuties(
        dutyCandidates,
        snapshot,
      );
      if (autopilotResult.upserts.length || autopilotResult.deletedIds.length) {
        autopilotResult.upserts.forEach((activity) =>
          upsertsById.set(activity.id, activity),
        );
        autopilotResult.deletedIds.forEach((id) => deletedIds.add(id));
        autopilotResult.serviceIds.forEach((id) => handledServiceIds.add(id));
      } else {
        const activityUpdates = new Map<string, Activity>();
        const boundaryUpserts: Activity[] = [];
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
          const serviceId = this.readString(candidate.params, 'serviceId');
          if (serviceId) {
            handledServiceIds.add(serviceId);
          }
        }
        boundaryUpserts.forEach((activity) =>
          upsertsById.set(activity.id, activity),
        );
        activityUpdates.forEach((activity) =>
          upsertsById.set(activity.id, activity),
        );
      }
    }

    candidates.forEach((candidate) => {
      if (candidate.type === 'break') {
        const serviceId = this.readString(candidate.params, 'serviceId');
        if (serviceId && handledServiceIds.has(serviceId)) {
          return;
        }
        const result = this.buildBreakMutation(candidate, ruleset, snapshot);
        if (result.upsert) {
          upsertsById.set(result.upsert.id, result.upsert);
        }
        result.deleteIds.forEach((id) => deletedIds.add(id));
        return;
      }
      if (candidate.type === 'travel') {
        const serviceId = this.readString(candidate.params, 'serviceId');
        if (serviceId && handledServiceIds.has(serviceId)) {
          return;
        }
        const activity = this.buildActivityFromCandidate(
          candidate,
          ruleset,
          snapshot,
        );
        if (activity) {
          upsertsById.set(activity.id, activity);
        }
      }
    });

    return {
      upserts: Array.from(upsertsById.values()),
      deletedIds: Array.from(deletedIds),
    };
  }

  private async applyAutopilotForDuties(
    dutyCandidates: PlanningCandidate[],
    snapshot: PlanningStageSnapshot,
  ): Promise<{
    upserts: Activity[];
    deletedIds: string[];
    serviceIds: Set<string>;
  }> {
    const serviceIds = new Set<string>();
    const activityIds = new Set<string>();
    dutyCandidates.forEach((candidate) => {
      const serviceId = this.readString(candidate.params, 'serviceId');
      if (serviceId) {
        serviceIds.add(serviceId);
      }
      this.readStringArray(candidate.params, 'activityIds').forEach((id) => {
        activityIds.add(id);
      });
    });

    if (!serviceIds.size || !activityIds.size) {
      return { upserts: [], deletedIds: [], serviceIds };
    }

    const relevant: Activity[] = [];
    const seen = new Set<string>();
    snapshot.activities.forEach((activity) => {
      if (
        activityIds.has(activity.id) ||
        this.isManagedActivityForServices(activity, serviceIds)
      ) {
        if (!seen.has(activity.id)) {
          relevant.push(activity);
          seen.add(activity.id);
        }
      }
    });

    if (!relevant.length) {
      return { upserts: [], deletedIds: [], serviceIds };
    }

    const result = await this.dutyAutopilot.apply(
      snapshot.stageId,
      snapshot.variantId,
      relevant,
    );
    return {
      upserts: result.upserts,
      deletedIds: result.deletedIds,
      serviceIds,
    };
  }

  private isManagedActivityForServices(
    activity: Activity,
    serviceIds: Set<string>,
  ): boolean {
    if (!this.isManagedId(activity.id)) {
      return false;
    }
    const parsed = this.parseServiceIdFromManagedId(activity.id);
    if (parsed && serviceIds.has(parsed)) {
      return true;
    }
    const direct =
      typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
    return direct ? serviceIds.has(direct) : false;
  }

  private isManagedId(id: string): boolean {
    return (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    );
  }

  private parseServiceIdFromManagedId(id: string): string | null {
    if (id.startsWith('svcstart:')) {
      return id.slice('svcstart:'.length) || null;
    }
    if (id.startsWith('svcend:')) {
      return id.slice('svcend:'.length) || null;
    }
    const prefixList = ['svcbreak:', 'svcshortbreak:', 'svccommute:'];
    for (const prefix of prefixList) {
      if (!id.startsWith(prefix)) {
        continue;
      }
      const rest = id.slice(prefix.length);
      if (!rest) {
        return null;
      }
      const idx = rest.indexOf(':');
      if (idx === -1) {
        return rest;
      }
      const serviceId = rest.slice(0, idx);
      return serviceId || null;
    }
    return null;
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

  private applyServiceAssignments(
    activity: Activity,
    assignments: Record<string, string>,
  ): Activity {
    const nextAttrs: Record<string, unknown> = {
      ...(activity.attributes ?? {}),
    };
    const serviceByOwner = this.ensureServiceByOwner(nextAttrs);
    let changed = false;
    Object.entries(assignments).forEach(([ownerId, serviceId]) => {
      const entry = serviceByOwner[ownerId];
      const current =
        typeof entry?.serviceId === 'string' ? entry.serviceId : null;
      if (current !== serviceId) {
        serviceByOwner[ownerId] = { ...(entry ?? {}), serviceId };
        changed = true;
      }
    });
    if (!changed) {
      return activity;
    }
    return { ...activity, attributes: nextAttrs };
  }

  private computeDutyStats(activities: Activity[]): {
    dutyStart: string | null;
    dutyEnd: string | null;
    dutySpanMinutes: number;
    workMinutes: number;
  } {
    let minStart: number | null = null;
    let maxEnd: number | null = null;
    let workMinutes = 0;
    for (const activity of activities) {
      const startMs = this.toMs(activity.start);
      if (startMs === null) {
        continue;
      }
      const endMs = this.resolveActivityEndMs(activity, startMs);
      if (minStart === null || startMs < minStart) {
        minStart = startMs;
      }
      if (maxEnd === null || endMs > maxEnd) {
        maxEnd = endMs;
      }
      workMinutes += Math.max(0, Math.round((endMs - startMs) / 60000));
    }
    if (minStart === null || maxEnd === null) {
      return {
        dutyStart: null,
        dutyEnd: null,
        dutySpanMinutes: 0,
        workMinutes: 0,
      };
    }
    return {
      dutyStart: new Date(minStart).toISOString(),
      dutyEnd: new Date(maxEnd).toISOString(),
      dutySpanMinutes: Math.max(0, Math.round((maxEnd - minStart) / 60000)),
      workMinutes,
    };
  }

  private resolveDayKeyFromActivities(activities: Activity[]): string | null {
    let minStart: number | null = null;
    for (const activity of activities) {
      const startMs = this.toMs(activity.start);
      if (startMs === null) {
        continue;
      }
      if (minStart === null || startMs < minStart) {
        minStart = startMs;
      }
    }
    if (minStart === null) {
      return null;
    }
    return this.utcDayKeyFromMs(minStart);
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

type SolverGroupDraft = {
  group: PlanningSolverGroup;
  entries: SolverActivityEntry[];
  activityIds: Set<string>;
};

type SolverActivityEntry = {
  activity: Activity;
  startMs: number;
  endMs: number;
};

type SolverActivityMeta = SolverActivityEntry & {
  startLocation: string | null;
  endLocation: string | null;
  startOpId: string | null;
  endOpId: string | null;
};

type SolverMasterDataContext = {
  personnelSitesById: Map<string, PersonnelSite>;
  operationalPointsById: Map<string, OperationalPoint>;
  walkTimeMs: Map<string, number>;
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
