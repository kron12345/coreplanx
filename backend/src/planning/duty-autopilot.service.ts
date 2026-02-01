import { Injectable, Logger } from '@nestjs/common';
import type {
  Activity,
  ActivityAttributeValue,
  ActivityAttributes,
  ActivityParticipant,
  HomeDepot,
  OperationalPoint,
  Personnel,
  PersonnelPool,
  PersonnelService,
  PersonnelServicePool,
  PersonnelSite,
  StageId,
  TransferEdge,
  TransferNode,
} from './planning.types';
import { PlanningMasterDataService } from './planning-master-data.service';
import { PlanningRuleService } from './planning-rule.service';
import type { DutyAutopilotConfig } from './planning-rule.service';
import { PlanningActivityCatalogService } from './planning-activity-catalog.service';
import { deriveTimetableYearLabelFromVariantId } from '../shared/variant-scope';
import { PlanningRulesetService } from './planning-ruleset.service';
import type { RulesetIR } from './planning-ruleset.types';

export interface DutyAutopilotResult {
  upserts: Activity[];
  deletedIds: string[];
  touchedIds: string[];
}

type DutyActivityGroup = {
  serviceId: string;
  owner: ActivityParticipant;
  dayKey: string;
  activities: Activity[];
};

type ConflictDetails = Record<string, string[]>;

type ServiceAssignment = {
  serviceId: string | null;
  conflictLevel: number;
  conflictCodes: string[];
  conflictDetails?: ConflictDetails;
};

type AzgDutySnapshot = {
  serviceId: string;
  ownerId: string;
  ownerKind: ActivityParticipant['kind'];
  startMs: number;
  endMs: number;
  dayKey: string;
  dayStartMs: number;
  dutySpanMinutes: number;
  workMinutes: number;
  startActivityId: string | null;
  endActivityId: string | null;
  breakIntervals: Array<{ startMs: number; endMs: number }>;
  breakActivities: Array<{ id: string; startMs: number; endMs: number }>;
  shortBreakIntervals: Array<{ startMs: number; endMs: number }>;
  shortBreakActivities: Array<{ id: string; startMs: number; endMs: number }>;
  workHalfMs: number | null;
  activityIds: string[];
  hasNightWork: boolean;
  primaryActivityId: string | null;
};

type BoundaryCleanupEntry = {
  ownerId: string;
  dayKey: string;
  keptStartId: string | null;
  keptEndId: string | null;
  deletedStartIds: string[];
  deletedEndIds: string[];
};

type ManagedActivityNormalizationEntry = {
  kind: 'boundary' | 'break';
  ownerId: string;
  serviceId: string;
  fromId: string;
  toId: string;
};

type TransferNodeKey =
  | `OP:${string}`
  | `PERSONNEL_SITE:${string}`
  | `REPLACEMENT_STOP:${string}`;

type MasterDataContext = {
  homeDepotsById: Map<string, HomeDepot>;
  personnelById: Map<string, Personnel>;
  personnelServicesById: Map<string, PersonnelService>;
  personnelPoolsById: Map<string, PersonnelPool>;
  personnelServicePoolsById: Map<string, PersonnelServicePool>;
  personnelSitesById: Map<string, PersonnelSite>;
  operationalPointsById: Map<string, OperationalPoint>;
  walkTimeMs: Map<string, number>;
};

type HomeDepotSelection = {
  depotId: string;
  depot: HomeDepot;
  selectedSite: PersonnelSite;
  walkStartMs: number | null;
  walkEndMs: number | null;
};

type PlannedPause = {
  kind: 'break' | 'short-break';
  site: PersonnelSite | null;
  gapId: string;
  fromLocation: string;
  toLocation: string;
  commuteInMs: number;
  commuteOutMs: number;
  breakStartMs: number;
  breakEndMs: number;
};

type DutyOwnerGroup = 'personnel' | 'vehicle';

type ResolvedAutopilotTypeIndex = {
  startTypeIdByOwnerGroup: Record<DutyOwnerGroup, string>;
  endTypeIdByOwnerGroup: Record<DutyOwnerGroup, string>;
  startTypeIds: Set<string>;
  endTypeIds: Set<string>;
  boundaryTypeIds: Set<string>;
  breakTypeIds: string[];
  shortBreakTypeId: string;
  commuteTypeId: string;
};

type ResolvedDutyAutopilotConfig = Omit<
  DutyAutopilotConfig,
  'breakTypeIds' | 'shortBreakTypeId' | 'commuteTypeId'
> & {
  breakTypeIds: string[];
  shortBreakTypeId: string;
  commuteTypeId: string;
  resolvedTypeIds: ResolvedAutopilotTypeIndex;
  resolvedRuleset?: RulesetIR | null;
  resolvedRulesetId?: string;
  resolvedRulesetVersion?: string;
};

@Injectable()
export class DutyAutopilotService {
  private readonly logger = new Logger(DutyAutopilotService.name);

  constructor(
    private readonly rules: PlanningRuleService,
    private readonly masterData: PlanningMasterDataService,
    private readonly activityCatalog: PlanningActivityCatalogService,
    private readonly rulesets: PlanningRulesetService,
  ) {}

  async apply(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
  ): Promise<DutyAutopilotResult> {
    const config = await this.rules.getDutyAutopilotConfig(stageId, variantId);
    if (!config) {
      return { upserts: [], deletedIds: [], touchedIds: [] };
    }
    if (!activities.length) {
      return { upserts: [], deletedIds: [], touchedIds: [] };
    }

    const resolvedConfig = this.resolveAutopilotConfig(config);
    const masterDataContext = this.buildMasterDataContext();

    const byId = new Map<string, Activity>(activities.map((a) => [a.id, a]));

    const upserts = new Map<string, Activity>();
    const deletedIds: string[] = [];
    const touched = new Set<string>();

    const managedIdsInUse = new Set<string>();

    // Clean up stale per-owner metadata upfront so outside-service/moved activities do not keep old service mappings.
    for (const activity of activities) {
      const normalized = this.normalizePayloadMeta(activity);
      if (normalized === activity) {
        continue;
      }
      byId.set(normalized.id, normalized);
      upserts.set(normalized.id, normalized);
      touched.add(normalized.id);
    }

    const groups = this.groupActivities(
      stageId,
      Array.from(byId.values()),
      resolvedConfig,
    );

    for (const group of groups) {
      const hydratedGroup: DutyActivityGroup = {
        ...group,
        activities: group.activities.map(
          (activity) => byId.get(activity.id) ?? activity,
        ),
      };
      const result = this.autoframeDuty(
        stageId,
        hydratedGroup,
        resolvedConfig,
        masterDataContext,
      );
      result.upserts.forEach((activity) => {
        byId.set(activity.id, activity);
        upserts.set(activity.id, activity);
        touched.add(activity.id);
        if (this.isManagedId(activity.id)) {
          managedIdsInUse.add(activity.id);
        }
      });
      result.deletedIds.forEach((id) => {
        deletedIds.push(id);
        touched.add(id);
      });
      result.managedIds.forEach((id) => managedIdsInUse.add(id));
    }

    // Clean up orphaned managed activities (boundaries/breaks without any payload left).
    for (const activity of activities) {
      if (!this.isManagedId(activity.id)) {
        continue;
      }
      if (managedIdsInUse.has(activity.id)) {
        continue;
      }
      deletedIds.push(activity.id);
      touched.add(activity.id);
    }

    const deletedSet = new Set(deletedIds);
    const activeActivities = Array.from(byId.values()).filter(
      (activity) => !deletedSet.has(activity.id),
    );
    const complianceUpserts = this.applyAzgCompliance(
      stageId,
      variantId,
      activeActivities,
      resolvedConfig,
    );
    for (const activity of complianceUpserts) {
      if (deletedSet.has(activity.id)) {
        continue;
      }
      byId.set(activity.id, activity);
      upserts.set(activity.id, activity);
      touched.add(activity.id);
    }

    return {
      upserts: Array.from(upserts.values()),
      deletedIds,
      touchedIds: Array.from(touched),
    };
  }

  async applyWorktimeCompliance(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
  ): Promise<Activity[]> {
    if (!activities.length) {
      return [];
    }
    const config = await this.rules.getDutyAutopilotConfig(stageId, variantId, {
      includeDisabled: true,
    });
    if (!config) {
      return [];
    }
    const resolvedConfig = this.resolveAutopilotConfig(config);
    const byId = new Map<string, Activity>(
      activities.map((activity) => [activity.id, activity]),
    );
    const updated = new Map<string, Activity>();

    const localUpserts = this.applyLocalConflictCompliance(
      stageId,
      activities,
      resolvedConfig,
    );
    for (const activity of localUpserts) {
      byId.set(activity.id, activity);
      updated.set(activity.id, activity);
    }

    const homeDepotUpserts = this.applyHomeDepotCompliance(
      stageId,
      Array.from(byId.values()),
      resolvedConfig,
    );
    for (const activity of homeDepotUpserts) {
      byId.set(activity.id, activity);
      updated.set(activity.id, activity);
    }

    const complianceUpserts = this.applyAzgCompliance(
      stageId,
      variantId,
      Array.from(byId.values()),
      resolvedConfig,
    );
    for (const activity of complianceUpserts) {
      updated.set(activity.id, activity);
    }

    return Array.from(updated.values());
  }

  async cleanupServiceBoundaries(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
  ): Promise<{ deletedIds: string[]; entries: BoundaryCleanupEntry[] }> {
    if (!activities.length) {
      return { deletedIds: [], entries: [] };
    }
    const config = await this.rules.getDutyAutopilotConfig(stageId, variantId, {
      includeDisabled: true,
    });
    if (!config || !config.enforceOneDutyPerDay) {
      return { deletedIds: [], entries: [] };
    }
    const resolvedConfig = this.resolveAutopilotConfig(config);
    const startTypeIds = resolvedConfig.resolvedTypeIds.startTypeIds;
    const endTypeIds = resolvedConfig.resolvedTypeIds.endTypeIds;
    const isStartBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'start' || startTypeIds.has((activity.type ?? '').trim());
    };
    const isEndBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'end' || endTypeIds.has((activity.type ?? '').trim());
    };
    const manualBoundaryKey = this.manualBoundaryKey();

    type BoundaryCandidate = {
      id: string;
      startMs: number;
      endMs: number;
      manual: boolean;
    };

    const perOwnerDay = new Map<
      string,
      Map<string, { starts: BoundaryCandidate[]; ends: BoundaryCandidate[] }>
    >();

    activities.forEach((activity) => {
      if (!isStartBoundary(activity) && !isEndBoundary(activity)) {
        return;
      }
      const startMs = this.parseMs(activity.start);
      if (startMs === null) {
        return;
      }
      const endMs = Math.max(startMs, this.resolveEndMs(activity, startMs));
      const dayKey =
        this.parseDayKeyFromServiceId(
          this.parseServiceIdFromManagedId(activity.id) ??
            activity.serviceId ??
            '',
        ) ?? this.utcDayKey(activity.start);
      const owners = this.resolveDutyOwners(activity);
      if (!owners.length) {
        return;
      }
      const candidate: BoundaryCandidate = {
        id: activity.id,
        startMs,
        endMs,
        manual: this.isManualBoundary(activity, manualBoundaryKey),
      };
      owners.forEach((owner) => {
        const ownerMap = perOwnerDay.get(owner.resourceId) ?? new Map();
        const entry = ownerMap.get(dayKey) ?? { starts: [], ends: [] };
        if (isStartBoundary(activity)) {
          entry.starts.push(candidate);
        }
        if (isEndBoundary(activity)) {
          entry.ends.push(candidate);
        }
        ownerMap.set(dayKey, entry);
        perOwnerDay.set(owner.resourceId, ownerMap);
      });
    });

    const deletedIds = new Set<string>();
    const entries: BoundaryCleanupEntry[] = [];

    const pickStart = (
      candidates: BoundaryCandidate[],
    ): BoundaryCandidate | null => {
      if (!candidates.length) {
        return null;
      }
      return candidates.reduce((best, current) => {
        if (!best) {
          return current;
        }
        if (current.startMs < best.startMs) {
          return current;
        }
        if (current.startMs > best.startMs) {
          return best;
        }
        if (current.manual && !best.manual) {
          return current;
        }
        if (!current.manual && best.manual) {
          return best;
        }
        return current.id.localeCompare(best.id) < 0 ? current : best;
      }, candidates[0]);
    };

    const pickEnd = (
      candidates: BoundaryCandidate[],
    ): BoundaryCandidate | null => {
      if (!candidates.length) {
        return null;
      }
      return candidates.reduce((best, current) => {
        if (!best) {
          return current;
        }
        if (current.endMs > best.endMs) {
          return current;
        }
        if (current.endMs < best.endMs) {
          return best;
        }
        if (current.manual && !best.manual) {
          return current;
        }
        if (!current.manual && best.manual) {
          return best;
        }
        return current.id.localeCompare(best.id) < 0 ? current : best;
      }, candidates[0]);
    };

    perOwnerDay.forEach((days, ownerId) => {
      days.forEach((entry, dayKey) => {
        const keptStart = pickStart(entry.starts);
        const keptEnd = pickEnd(entry.ends);
        const deletedStartIds = entry.starts
          .filter((candidate) => candidate.id !== keptStart?.id)
          .map((candidate) => candidate.id);
        const deletedEndIds = entry.ends
          .filter((candidate) => candidate.id !== keptEnd?.id)
          .map((candidate) => candidate.id);
        const hasDeletions =
          deletedStartIds.length > 0 || deletedEndIds.length > 0;
        if (!hasDeletions) {
          return;
        }
        deletedStartIds.forEach((id) => deletedIds.add(id));
        deletedEndIds.forEach((id) => deletedIds.add(id));
        entries.push({
          ownerId,
          dayKey,
          keptStartId: keptStart?.id ?? null,
          keptEndId: keptEnd?.id ?? null,
          deletedStartIds,
          deletedEndIds,
        });
      });
    });

    return { deletedIds: Array.from(deletedIds.values()), entries };
  }

  async normalizeManagedServiceActivities(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
  ): Promise<{
    upserts: Activity[];
    deletedIds: string[];
    entries: ManagedActivityNormalizationEntry[];
  }> {
    if (!activities.length) {
      return { upserts: [], deletedIds: [], entries: [] };
    }
    const config = await this.rules.getDutyAutopilotConfig(stageId, variantId, {
      includeDisabled: true,
    });
    if (!config) {
      return { upserts: [], deletedIds: [], entries: [] };
    }

    const resolved = this.resolveAutopilotConfig(config);
    const startTypeIds = resolved.resolvedTypeIds.startTypeIds;
    const endTypeIds = resolved.resolvedTypeIds.endTypeIds;
    const breakTypeIds = resolved.breakTypeIds;
    const shortBreakTypeId = resolved.shortBreakTypeId;

    const isBoundary = (activity: Activity): boolean => {
      const role = this.resolveServiceRole(activity);
      const type = (activity.type ?? '').trim();
      return (
        role === 'start' ||
        role === 'end' ||
        startTypeIds.has(type) ||
        endTypeIds.has(type)
      );
    };
    const resolveBoundaryRole = (
      activity: Activity,
    ): 'start' | 'end' | null => {
      const role = this.resolveServiceRole(activity);
      if (role === 'start' || role === 'end') {
        return role;
      }
      const type = (activity.type ?? '').trim();
      if (startTypeIds.has(type)) {
        return 'start';
      }
      if (endTypeIds.has(type)) {
        return 'end';
      }
      return null;
    };
    const isShortBreak = (activity: Activity) =>
      this.isShortBreakActivity(activity, shortBreakTypeId);
    const isBreak = (activity: Activity) =>
      this.isBreakActivity(activity, breakTypeIds);

    const usedIds = new Set<string>(activities.map((activity) => activity.id));
    const upserts = new Map<string, Activity>();
    const deletedIds = new Set<string>();
    const entries: ManagedActivityNormalizationEntry[] = [];

    const sanitizeSuffix = (value: string) =>
      value.replace(/[^a-zA-Z0-9_-]/g, '_');
    const claimId = (baseId: string): string => {
      let candidate = baseId;
      let counter = 1;
      while (usedIds.has(candidate)) {
        candidate = `${baseId}-${counter}`;
        counter += 1;
      }
      usedIds.add(candidate);
      return candidate;
    };

    const resolveServiceId = (activity: Activity, ownerId: string): string => {
      const explicit =
        typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
      const managed = this.parseServiceIdFromManagedId(activity.id) ?? '';
      const candidate = explicit || managed;
      let dayKey = this.utcDayKey(activity.start);
      if (candidate) {
        const candidateOwner = this.parseOwnerIdFromServiceId(candidate);
        const candidateStage = this.parseStageIdFromServiceId(candidate);
        if (
          candidateOwner === ownerId &&
          (!candidateStage || candidateStage === stageId)
        ) {
          const candidateDay = this.parseDayKeyFromServiceId(candidate);
          if (candidateDay) {
            dayKey = candidateDay;
          }
        }
      }
      return this.computeServiceId(stageId, ownerId, dayKey);
    };

    const ensureOwnerParticipant = (
      activity: Activity,
      owner: ActivityParticipant,
    ): ActivityParticipant[] => {
      const participants = activity.participants ?? [];
      const hasOwner = participants.some(
        (participant) =>
          participant.resourceId === owner.resourceId &&
          participant.kind === owner.kind,
      );
      if (hasOwner) {
        return participants;
      }
      return [this.buildOwnerParticipant(owner), ...participants];
    };
    const normalizeManagedAttributes = (
      attributes: ActivityAttributes | null | undefined,
    ): ActivityAttributes | undefined => {
      if (!attributes) {
        return attributes ?? undefined;
      }
      const serviceByOwnerKey = this.serviceByOwnerKey();
      if (
        !Object.prototype.hasOwnProperty.call(attributes, serviceByOwnerKey)
      ) {
        return attributes;
      }
      const next = { ...attributes } as ActivityAttributes;
      delete (next as any)[serviceByOwnerKey];
      return Object.keys(next).length ? next : undefined;
    };

    for (const activity of activities) {
      if (
        !isBoundary(activity) &&
        !isBreak(activity) &&
        !isShortBreak(activity)
      ) {
        continue;
      }

      const owners = this.resolveDutyOwners(activity);
      if (owners.length !== 1) {
        continue;
      }
      const owner = owners[0];
      const serviceId = resolveServiceId(activity, owner.resourceId);

      if (isBoundary(activity)) {
        const role = resolveBoundaryRole(activity);
        if (!role) {
          continue;
        }
        const targetId =
          role === 'start' ? `svcstart:${serviceId}` : `svcend:${serviceId}`;
        if (targetId !== activity.id && usedIds.has(targetId)) {
          deletedIds.add(activity.id);
          continue;
        }
        usedIds.add(targetId);
        const participants = ensureOwnerParticipant(activity, owner);
        const attributes = normalizeManagedAttributes(activity.attributes);
        const next: Activity = {
          ...activity,
          id: targetId,
          serviceId,
          serviceRole: role,
          participants,
          attributes,
        };
        const changed =
          targetId !== activity.id ||
          (activity.serviceId ?? null) !== serviceId ||
          activity.serviceRole !== role ||
          participants !== activity.participants ||
          attributes !== activity.attributes;
        if (changed) {
          upserts.set(next.id, next);
        }
        if (targetId !== activity.id) {
          deletedIds.add(activity.id);
          entries.push({
            kind: 'boundary',
            ownerId: owner.resourceId,
            serviceId,
            fromId: activity.id,
            toId: targetId,
          });
        }
        continue;
      }

      const kind = isShortBreak(activity) ? 'short-break' : 'break';
      const prefix = kind === 'short-break' ? 'svcshortbreak' : 'svcbreak';
      let targetId: string | null = null;
      if (
        this.isManagedId(activity.id) &&
        this.belongsToService(activity.id, serviceId) &&
        activity.id.startsWith(`${prefix}:`)
      ) {
        targetId = activity.id;
        usedIds.add(targetId);
      }
      if (!targetId) {
        const suffix = sanitizeSuffix(activity.id);
        targetId = claimId(`${prefix}:${serviceId}:${suffix || 'auto'}`);
      }
      const participants = ensureOwnerParticipant(activity, owner);
      const attributes = normalizeManagedAttributes(activity.attributes);
      const next: Activity = {
        ...activity,
        id: targetId,
        serviceId,
        participants,
        attributes,
      };
      const changed =
        targetId !== activity.id ||
        (activity.serviceId ?? null) !== serviceId ||
        participants !== activity.participants ||
        attributes !== activity.attributes;
      if (changed) {
        upserts.set(next.id, next);
      }
      if (targetId !== activity.id) {
        deletedIds.add(activity.id);
        entries.push({
          kind: 'break',
          ownerId: owner.resourceId,
          serviceId,
          fromId: activity.id,
          toId: targetId,
        });
      }
    }

    return {
      upserts: Array.from(upserts.values()),
      deletedIds: Array.from(deletedIds.values()),
      entries,
    };
  }

  private resolveAutopilotConfig(
    config: DutyAutopilotConfig,
  ): ResolvedDutyAutopilotConfig {
    const resolvedTypeIds = this.resolveAutopilotTypeIndex(config);
    const resolvedRuleset = this.resolveRulesetSelection(config);
    return {
      ...config,
      breakTypeIds: resolvedTypeIds.breakTypeIds,
      shortBreakTypeId: resolvedTypeIds.shortBreakTypeId,
      commuteTypeId: resolvedTypeIds.commuteTypeId,
      resolvedTypeIds,
      ...resolvedRuleset,
    };
  }

  private resolveRulesetSelection(config: DutyAutopilotConfig): {
    resolvedRuleset?: RulesetIR | null;
    resolvedRulesetId?: string;
    resolvedRulesetVersion?: string;
  } {
    const rawId = (config.rulesetId ?? '').toString().trim();
    const rawVersion = (config.rulesetVersion ?? '').toString().trim();
    if (!rawId && !rawVersion) {
      return {};
    }
    if (!rawId) {
      this.logger.warn(
        'Ruleset version provided without rulesetId. Skipping ruleset selection.',
      );
      return {};
    }
    let version = rawVersion;
    if (!version) {
      try {
        const versions = this.rulesets.listVersions(rawId);
        version = versions[versions.length - 1] ?? '';
      } catch (error) {
        this.logger.warn(
          `Ruleset ${rawId} could not be listed: ${(error as Error).message ?? String(error)}`,
        );
        return { resolvedRulesetId: rawId };
      }
    }
    if (!version) {
      this.logger.warn(
        `Ruleset ${rawId} has no usable version. Skipping ruleset selection.`,
      );
      return { resolvedRulesetId: rawId };
    }
    try {
      const ruleset = this.rulesets.getCompiledRuleset(rawId, version);
      return {
        resolvedRuleset: ruleset,
        resolvedRulesetId: rawId,
        resolvedRulesetVersion: version,
      };
    } catch (error) {
      this.logger.warn(
        `Ruleset ${rawId}/${version} could not be loaded: ${(error as Error).message ?? String(error)}`,
      );
      return {
        resolvedRuleset: null,
        resolvedRulesetId: rawId,
        resolvedRulesetVersion: version,
      };
    }
  }

  private resolveAutopilotTypeIndex(
    config: DutyAutopilotConfig,
  ): ResolvedAutopilotTypeIndex {
    const definitions = this.activityCatalog.listActivityDefinitions();
    if (!definitions.length) {
      throw new Error('Activity-Katalog enthaelt keine Activity-Definitionen.');
    }
    const typeIds = new Set(
      definitions
        .map((definition) => `${definition?.activityType ?? ''}`.trim())
        .filter((id) => id.length > 0),
    );

    const flags = {
      serviceStart: [] as string[],
      serviceEnd: [] as string[],
      break: [] as string[],
      shortBreak: [] as string[],
      commute: [] as string[],
      vehicleOn: [] as string[],
      vehicleOff: [] as string[],
    };

    const toBool = (value: unknown): boolean => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return (
          normalized === 'true' ||
          normalized === 'yes' ||
          normalized === '1' ||
          normalized === 'ja'
        );
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) && value !== 0;
      }
      return false;
    };

    const readAttributeValue = (
      attrs: ActivityAttributeValue[] | undefined,
      key: string,
    ): unknown => {
      const entry = (attrs ?? []).find((attr) => attr.key === key);
      const meta = entry?.meta;
      return meta?.['value'];
    };

    const recordFlag = (
      list: string[],
      id: string,
      attrs: ActivityAttributeValue[] | undefined,
      key: string,
    ) => {
      const value = readAttributeValue(attrs, key);
      if (toBool(value)) {
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
      recordFlag(flags.break, id, attrs, 'is_break');
      recordFlag(flags.shortBreak, id, attrs, 'is_short_break');
      recordFlag(flags.commute, id, attrs, 'is_commute');
      recordFlag(flags.vehicleOn, id, attrs, 'is_vehicle_on');
      recordFlag(flags.vehicleOff, id, attrs, 'is_vehicle_off');
    });

    const pickExisting = (value: string | null | undefined): string | null => {
      const trimmed = `${value ?? ''}`.trim();
      if (!trimmed) {
        return null;
      }
      return typeIds.has(trimmed) ? trimmed : null;
    };

    const pickExistingList = (
      values: string[] | null | undefined,
    ): string[] => {
      const normalized = (values ?? [])
        .map((entry) => `${entry ?? ''}`.trim())
        .filter((entry) => entry.length > 0);
      return normalized.filter((entry) => typeIds.has(entry));
    };

    const vehicleOnIds = new Set(flags.vehicleOn);
    const vehicleOffIds = new Set(flags.vehicleOff);
    const serviceStartCandidates = flags.serviceStart.filter(
      (id) => !vehicleOnIds.has(id),
    );
    const serviceEndCandidates = flags.serviceEnd.filter(
      (id) => !vehicleOffIds.has(id),
    );

    const requireType = (
      value: string | null,
      label: string,
      attributeHint: string,
    ): string => {
      const trimmed = `${value ?? ''}`.trim();
      if (trimmed) {
        return trimmed;
      }
      throw new Error(
        `Activity-Katalog fehlt ${label} (Attribute ${attributeHint} setzen).`,
      );
    };

    const fallbackStart =
      pickExisting(config.serviceStartTypeId) ??
      serviceStartCandidates[0] ??
      flags.serviceStart[0] ??
      null;
    const fallbackEnd =
      pickExisting(config.serviceEndTypeId) ??
      serviceEndCandidates[0] ??
      flags.serviceEnd[0] ??
      null;

    const personnelStart =
      pickExisting(config.personnelStartTypeId) ??
      pickExisting(config.serviceStartTypeId) ??
      serviceStartCandidates[0] ??
      flags.serviceStart[0] ??
      fallbackStart;
    const personnelEnd =
      pickExisting(config.personnelEndTypeId) ??
      pickExisting(config.serviceEndTypeId) ??
      serviceEndCandidates[0] ??
      flags.serviceEnd[0] ??
      fallbackEnd;

    const vehicleStart =
      pickExisting(config.vehicleStartTypeId) ??
      flags.vehicleOn[0] ??
      fallbackStart;
    const vehicleEnd =
      pickExisting(config.vehicleEndTypeId) ??
      flags.vehicleOff[0] ??
      fallbackEnd;

    const shortBreakTypeId =
      pickExisting(config.shortBreakTypeId) ?? flags.shortBreak[0] ?? null;
    const resolvedShortBreakTypeId = requireType(
      shortBreakTypeId,
      'Kurzpause-Definition',
      'is_short_break',
    );

    const breakTypeIdsRaw = pickExistingList(config.breakTypeIds);
    const breakCandidates = flags.break.filter(
      (id) => id !== resolvedShortBreakTypeId,
    );
    const breakTypeIds =
      breakTypeIdsRaw.length > 0
        ? breakTypeIdsRaw
        : breakCandidates.length > 0
          ? breakCandidates
          : [resolvedShortBreakTypeId];

    const commuteTypeId =
      pickExisting(config.commuteTypeId) ?? flags.commute[0] ?? null;
    const resolvedCommuteTypeId = requireType(
      commuteTypeId,
      'Wegzeit-Definition',
      'is_commute',
    );

    const resolvedPersonnelStart = requireType(
      personnelStart,
      'Dienststart-Definition',
      'is_service_start',
    );
    const resolvedPersonnelEnd = requireType(
      personnelEnd,
      'Dienstende-Definition',
      'is_service_end',
    );
    const resolvedVehicleStart = requireType(
      vehicleStart,
      'Fahrzeugstart-Definition',
      'is_vehicle_on oder is_service_start',
    );
    const resolvedVehicleEnd = requireType(
      vehicleEnd,
      'Fahrzeugende-Definition',
      'is_vehicle_off oder is_service_end',
    );

    const startTypeIds = new Set([
      resolvedPersonnelStart,
      resolvedVehicleStart,
    ]);
    const endTypeIds = new Set([resolvedPersonnelEnd, resolvedVehicleEnd]);
    const boundaryTypeIds = new Set([...startTypeIds, ...endTypeIds]);

    return {
      startTypeIdByOwnerGroup: {
        personnel: resolvedPersonnelStart,
        vehicle: resolvedVehicleStart,
      },
      endTypeIdByOwnerGroup: {
        personnel: resolvedPersonnelEnd,
        vehicle: resolvedVehicleEnd,
      },
      startTypeIds,
      endTypeIds,
      boundaryTypeIds,
      breakTypeIds,
      shortBreakTypeId: resolvedShortBreakTypeId,
      commuteTypeId: resolvedCommuteTypeId,
    };
  }

  private resolveOwnerGroup(
    kind: ActivityParticipant['kind'] | null | undefined,
  ): DutyOwnerGroup {
    if (kind === 'vehicle' || kind === 'vehicle-service') {
      return 'vehicle';
    }
    return 'personnel';
  }

  private groupActivities(
    stageId: StageId,
    activities: Activity[],
    config: ResolvedDutyAutopilotConfig,
  ): DutyActivityGroup[] {
    const breakTypeIds = config.breakTypeIds;
    const boundaryTypeIds = config.resolvedTypeIds.boundaryTypeIds;
    const byOwner = new Map<
      string,
      { owner: ActivityParticipant; activities: Activity[] }
    >();

    const isBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return (
        role === 'start' ||
        role === 'end' ||
        boundaryTypeIds.has((activity.type ?? '').trim())
      );
    };

    // First collect candidates per owner (an activity can belong to multiple duty owners).
    for (const activity of activities) {
      const owners = this.resolveDutyOwners(activity);
      if (!owners.length) {
        continue;
      }
      const withinPref = this.resolveWithinPreference(activity);
      const isBreak = this.isBreakActivity(activity, breakTypeIds);
      if (
        withinPref === 'outside' &&
        !isBoundary(activity) &&
        !isBreak &&
        !this.isManagedId(activity.id)
      ) {
        continue;
      }

      for (const owner of owners) {
        const key = owner.resourceId;
        const bucket = byOwner.get(key);
        if (bucket) {
          bucket.activities.push(activity);
        } else {
          byOwner.set(key, { owner, activities: [activity] });
        }
      }
    }

    const groups = new Map<string, DutyActivityGroup>();
    const maxDutySpanMs = Math.max(0, config.maxDutySpanMinutes * 60_000);

    const resolveServiceIdForBoundary = (
      ownerId: string,
      activity: Activity,
    ): string | null => {
      const parsed = this.parseServiceIdFromManagedId(activity.id);
      if (parsed) {
        const parsedOwner = this.parseOwnerIdFromServiceId(parsed);
        const parsedStage = this.parseStageIdFromServiceId(parsed);
        if (parsedOwner && parsedOwner !== ownerId) {
          return null;
        }
        if (parsedStage && parsedStage !== stageId) {
          return null;
        }
        return parsed;
      }
      const explicit =
        typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
      if (explicit.startsWith('svc:')) {
        const explicitOwner = this.parseOwnerIdFromServiceId(explicit);
        const explicitStage = this.parseStageIdFromServiceId(explicit);
        if (explicitOwner && explicitOwner !== ownerId) {
          return null;
        }
        if (explicitStage && explicitStage !== stageId) {
          return null;
        }
        return explicit;
      }
      // Best-effort fallback: assume the boundary belongs to its own UTC-day.
      const dayKey = this.utcDayKey(activity.start);
      return this.computeServiceId(stageId, ownerId, dayKey);
    };

    // Then derive service assignment per owner and build groups.
    byOwner.forEach(({ owner, activities: ownerActivities }) => {
      const ownerId = owner.resourceId;
      const payloadActivities = ownerActivities
        .filter((activity) => !this.isManagedId(activity.id))
        .filter((activity) => !this.isBreakActivity(activity, breakTypeIds))
        .filter((activity) => !isBoundary(activity));

      const intervals = payloadActivities
        .map((activity) => ({
          activity,
          startMs: this.parseMs(activity.start),
        }))
        .filter(
          (entry): entry is { activity: Activity; startMs: number } =>
            entry.startMs !== null,
        )
        .sort((a, b) => a.startMs - b.startMs);

      const assignment = new Map<string, string>();
      let dutyStartMs: number | null = null;
      let dutyDayKey: string | null = null;
      let serviceId: string | null = null;

      const resolveServiceOverride = (activity: Activity): string | null => {
        const attrs = activity.attributes as Record<string, unknown> | undefined;
        const map = attrs?.[this.serviceByOwnerKey()];
        if (map && typeof map === 'object' && !Array.isArray(map)) {
          const entry = (map as Record<string, any>)[ownerId];
          const mapped =
            typeof entry?.serviceId === 'string' ? entry.serviceId.trim() : '';
          if (mapped) {
            return mapped;
          }
        }
        const direct =
          typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
        if (!direct || !direct.startsWith('svc:')) {
          return null;
        }
        const parsedOwner = this.parseOwnerIdFromServiceId(direct);
        if (parsedOwner && parsedOwner !== ownerId) {
          return null;
        }
        const parsedStage = this.parseStageIdFromServiceId(direct);
        if (parsedStage && parsedStage !== stageId) {
          return null;
        }
        return direct;
      };

      for (const entry of intervals) {
        const startMs = entry.startMs;
        const dayKey = this.utcDayKeyFromMs(startMs);
        const override = resolveServiceOverride(entry.activity);
        if (override) {
          assignment.set(entry.activity.id, override);
          continue;
        }
        if (!serviceId || dutyStartMs === null || dutyDayKey === null) {
          dutyStartMs = startMs;
          dutyDayKey = dayKey;
          serviceId = this.computeServiceId(stageId, ownerId, dayKey);
        } else if (dayKey === dutyDayKey) {
          // One duty per (UTC) day by design; do not split within the same duty day.
        } else if (startMs - dutyStartMs <= maxDutySpanMs) {
          // Cross-midnight: keep the duty of its start day as long as the span allows it.
        } else {
          dutyStartMs = startMs;
          dutyDayKey = dayKey;
          serviceId = this.computeServiceId(stageId, ownerId, dayKey);
        }
        assignment.set(entry.activity.id, serviceId);
      }

      for (const activity of ownerActivities) {
        let groupServiceId: string | null = null;
        if (
          isBoundary(activity) ||
          this.isBreakActivity(activity, breakTypeIds) ||
          this.isManagedId(activity.id)
        ) {
          groupServiceId = resolveServiceIdForBoundary(ownerId, activity);
        } else {
          groupServiceId = assignment.get(activity.id) ?? null;
        }
        if (!groupServiceId) {
          continue;
        }

        const dayKey =
          this.parseDayKeyFromServiceId(groupServiceId) ??
          this.utcDayKey(activity.start);
        const existing = groups.get(groupServiceId);
        if (existing) {
          existing.activities.push(activity);
        } else {
          groups.set(groupServiceId, {
            serviceId: groupServiceId,
            owner,
            dayKey,
            activities: [activity],
          });
        }
      }
    });

    return Array.from(groups.values());
  }

  private autoframeDuty(
    stageId: StageId,
    group: DutyActivityGroup,
    config: ResolvedDutyAutopilotConfig,
    context: MasterDataContext,
  ): { upserts: Activity[]; deletedIds: string[]; managedIds: string[] } {
    if (!config) {
      return { upserts: [], deletedIds: [], managedIds: [] };
    }
    const serviceId = group.serviceId;
    const owner = group.owner;
    const ownerId = owner.resourceId;

    const typeIndex = config.resolvedTypeIds;
    const breakTypeIds = config.breakTypeIds;
    const shortBreakTypeId = config.shortBreakTypeId;
    const commuteTypeId = config.commuteTypeId;
    const conflictKey = config.conflictAttributeKey;
    const conflictCodesKey = config.conflictCodesAttributeKey;

    const isShortBreak = (a: Activity) =>
      this.isShortBreakActivity(a, shortBreakTypeId);
    const isRegularBreak = (a: Activity) =>
      this.isBreakActivity(a, breakTypeIds) && !isShortBreak(a);
    const isAnyPause = (a: Activity) => isRegularBreak(a) || isShortBreak(a);
    const isBoundary = (a: Activity) => {
      const role = this.resolveServiceRole(a);
      return (
        role === 'start' ||
        role === 'end' ||
        typeIndex.boundaryTypeIds.has((a.type ?? '').trim())
      );
    };

    const dutyActivities = group.activities;
    const basePayloadActivities = dutyActivities
      .filter((a) => !isBoundary(a))
      .filter((a) => !isAnyPause(a))
      .filter((a) => !this.isManagedId(a.id));

    if (!basePayloadActivities.length) {
      const deleted = group.activities
        .map((a) => a.id)
        .filter(
          (id) => this.isManagedId(id) && this.belongsToService(id, serviceId),
        );
      return { upserts: [], deletedIds: deleted, managedIds: [] };
    }

    const payloadIntervals = this.sortedIntervals(basePayloadActivities);
    const dutyStartMs = payloadIntervals.minStartMs;
    const dutyEndMs = payloadIntervals.maxEndMs;

    const startCandidates = dutyActivities.filter(
      (a) =>
        this.resolveServiceRole(a) === 'start' ||
        typeIndex.startTypeIds.has((a.type ?? '').trim()),
    );
    const endCandidates = dutyActivities.filter(
      (a) =>
        this.resolveServiceRole(a) === 'end' ||
        typeIndex.endTypeIds.has((a.type ?? '').trim()),
    );
    const startId = `svcstart:${serviceId}`;
    const endId = `svcend:${serviceId}`;
    const managedIds: string[] = [startId, endId];

    const boundaryDeletedIds = Array.from(
      new Set([
        ...startCandidates.map((a) => a.id).filter((id) => id !== startId),
        ...endCandidates.map((a) => a.id).filter((id) => id !== endId),
      ]),
    );

    const existingStart =
      startCandidates.find((a) => a.id === startId) ??
      startCandidates[0] ??
      null;
    const existingEnd =
      endCandidates.find((a) => a.id === endId) ?? endCandidates[0] ?? null;

    const manualBoundaryKey = this.manualBoundaryKey();
    const manualStartMs =
      existingStart && this.isManualBoundary(existingStart, manualBoundaryKey)
        ? this.parseMs(existingStart.start)
        : null;
    const manualEndMs =
      existingEnd && this.isManualBoundary(existingEnd, manualBoundaryKey)
        ? this.parseMs(existingEnd.start)
        : null;

    const activityCodes = new Map<string, Set<string>>();
    const activityDetails = new Map<string, ConflictDetails>();
    const addActivityCodes = (
      activityId: string | null | undefined,
      codes: string[],
    ) => {
      if (!activityId || !codes.length) {
        return;
      }
      let set = activityCodes.get(activityId);
      if (!set) {
        set = new Set<string>();
        activityCodes.set(activityId, set);
      }
      codes.forEach((code) => set!.add(code));
    };
    const addActivityDetail = (
      activityId: string | null | undefined,
      code: string,
      detail: string,
    ) => {
      if (!activityId) {
        return;
      }
      const details = activityDetails.get(activityId) ?? {};
      this.appendConflictDetail(details, code, detail);
      activityDetails.set(activityId, details);
    };
    const mergeActivityDetails = (
      activityId: string | null | undefined,
      details: ConflictDetails,
    ) => {
      if (!activityId || !Object.keys(details).length) {
        return;
      }
      const existing = activityDetails.get(activityId) ?? {};
      this.mergeConflictDetails(existing, details);
      activityDetails.set(activityId, existing);
    };
    const homeDepotSelection = this.resolveHomeDepotSelection(
      owner,
      basePayloadActivities,
      context,
    );
    const firstPayload = this.findFirstActivity(basePayloadActivities);
    const lastPayload = this.findLastActivity(basePayloadActivities);
    const payloadStartLocation = firstPayload
      ? this.readStartLocation(firstPayload)
      : null;
    const payloadEndLocation = lastPayload
      ? this.readEndLocation(lastPayload)
      : null;
    const selectionCodes = homeDepotSelection.conflictCodes;
    const startSpecific = new Set([
      'HOME_DEPOT_START_LOCATION_MISSING',
      'WALK_TIME_MISSING_START',
    ]);
    const endSpecific = new Set([
      'HOME_DEPOT_END_LOCATION_MISSING',
      'WALK_TIME_MISSING_END',
    ]);
    const startCodes = selectionCodes.filter((code) =>
      startSpecific.has(code),
    );
    const endCodes = selectionCodes.filter((code) => endSpecific.has(code));
    const generalCodes = selectionCodes.filter(
      (code) => !startSpecific.has(code) && !endSpecific.has(code),
    );
    const selectionDetails = homeDepotSelection.conflictDetails;
    const addSelectionCodes = (
      activityId: string | null,
      codes: string[],
    ) => {
      if (!activityId || !codes.length) {
        return;
      }
      addActivityCodes(activityId, codes);
      const details = this.detailsForCodes(selectionDetails, codes);
      mergeActivityDetails(activityId, details);
    };
    addSelectionCodes(startId, [...generalCodes, ...startCodes]);
    addSelectionCodes(endId, endCodes);
    const depot =
      homeDepotSelection.selection?.depot ?? this.resolveHomeDepot(owner, context);
    if (homeDepotSelection.selection) {
      const allowed = new Set(
        (homeDepotSelection.selection.depot.overnightSiteIds ?? [])
          .map((id) => `${id ?? ''}`.trim())
          .filter((id) => id.length > 0),
      );
      if (allowed.size > 0) {
        for (const activity of group.activities) {
          if (!this.isOvernightActivity(activity)) {
            continue;
          }
          const locationId = `${activity.locationId ?? ''}`.trim();
          if (!locationId) {
            addActivityCodes(activity.id, [
              'HOME_DEPOT_OVERNIGHT_LOCATION_MISSING',
            ]);
            addActivityDetail(
              activity.id,
              'HOME_DEPOT_OVERNIGHT_LOCATION_MISSING',
              `Aktivität: ${activity.id} (locationId fehlt)`,
            );
            continue;
          }
          if (!allowed.has(locationId)) {
            addActivityCodes(activity.id, ['HOME_DEPOT_OVERNIGHT_SITE_FORBIDDEN']);
            addActivityDetail(
              activity.id,
              'HOME_DEPOT_OVERNIGHT_SITE_FORBIDDEN',
              `Aktivität: ${activity.id} (locationId=${locationId})`,
            );
          }
        }
      }
    }

    const recordOutside = (
      label: string,
      location: string | null,
      activityId?: string,
    ) => {
      const targetId = activityId ?? startId;
      addActivityCodes(targetId, ['HOME_DEPOT_NOT_IN_DEPOT']);
      const detail = activityId
        ? `${label}: ${activityId} (${location ?? '—'})`
        : `${label}: ${location ?? '—'}`;
      addActivityDetail(targetId, 'HOME_DEPOT_NOT_IN_DEPOT', detail);
    };
    if (homeDepotSelection.selection) {
      const selection = homeDepotSelection.selection;
      const allowedStartEnd = this.buildAllowedSiteLookup(
        selection.depot.siteIds ?? [],
        context,
      );

      if (allowedStartEnd.siteIds.size > 0) {
        if (
          payloadStartLocation &&
          !this.isLocationInAllowedSiteIds(
            payloadStartLocation,
            allowedStartEnd.siteIds,
            context,
          )
        ) {
          recordOutside('Dienstanfang', payloadStartLocation, startId);
        }
        if (
          payloadEndLocation &&
          !this.isLocationInAllowedSiteIds(
            payloadEndLocation,
            allowedStartEnd.siteIds,
            context,
          )
        ) {
          recordOutside('Dienstende', payloadEndLocation, endId);
        }
      }
    }
    if (depot) {
      const allowedBreaks = this.buildAllowedSiteLookup(
        depot.breakSiteIds ?? [],
        context,
      );
      const allowedShortBreaks = this.buildAllowedSiteLookup(
        depot.shortBreakSiteIds ?? [],
        context,
      );

      if (allowedBreaks.siteIds.size > 0) {
        for (const activity of group.activities) {
          if (!isRegularBreak(activity) || this.isManagedId(activity.id)) {
            continue;
          }
          const location = this.readStartLocation(activity);
          if (
            !this.isLocationInAllowedSiteIds(
              location,
              allowedBreaks.siteIds,
              context,
            )
          ) {
            recordOutside('Pause', location, activity.id);
          }
        }
      }

      if (allowedShortBreaks.siteIds.size > 0) {
        for (const activity of group.activities) {
          if (!isShortBreak(activity) || this.isManagedId(activity.id)) {
            continue;
          }
          const location = this.readStartLocation(activity);
          if (
            !this.isLocationInAllowedSiteIds(
              location,
              allowedShortBreaks.siteIds,
              context,
            )
          ) {
            recordOutside('Kurzpause', location, activity.id);
          }
        }
      }
    }

    const generatedCommutes: Activity[] = [];
    if (homeDepotSelection.selection) {
      const selection = homeDepotSelection.selection;
      const firstStartMs = firstPayload ? this.parseMs(firstPayload.start) : null;
      const lastEndMs = lastPayload
        ? this.parseMs(lastPayload.end ?? lastPayload.start)
        : null;
      const startCandidate = payloadStartLocation;
      const endCandidate = payloadEndLocation;
      const startOpId = startCandidate
        ? this.resolveOperationalPointId(startCandidate, context)
        : null;
      const endOpId = endCandidate
        ? this.resolveOperationalPointId(endCandidate, context)
        : null;

      if (
        firstStartMs !== null &&
        startOpId &&
        selection.walkStartMs !== null
      ) {
        const startCommuteId = `svccommute:${serviceId}:start`;
        managedIds.push(startCommuteId);
        generatedCommutes.push(
          this.buildCommuteActivity({
            id: startCommuteId,
            title: 'Wegezeit',
            type: commuteTypeId,
            startMs: firstStartMs - selection.walkStartMs,
            endMs: firstStartMs,
            from: selection.selectedSite.siteId,
            to: startOpId,
            owner,
            serviceId,
            conflictKey,
            conflictCodesKey,
            depotId: selection.depotId,
            siteId: selection.selectedSite.siteId,
            siteLabel: selection.selectedSite.name,
          }),
        );
      }

      if (lastEndMs !== null && endOpId && selection.walkEndMs !== null) {
        const endCommuteId = `svccommute:${serviceId}:end`;
        managedIds.push(endCommuteId);
        generatedCommutes.push(
          this.buildCommuteActivity({
            id: endCommuteId,
            title: 'Wegezeit',
            type: commuteTypeId,
            startMs: lastEndMs,
            endMs: lastEndMs + selection.walkEndMs,
            from: endOpId,
            to: selection.selectedSite.siteId,
            owner,
            serviceId,
            conflictKey,
            conflictCodesKey,
            depotId: selection.depotId,
            siteId: selection.selectedSite.siteId,
            siteLabel: selection.selectedSite.name,
          }),
        );
      }
    }

    const effectiveDutyStartMs = generatedCommutes.length
      ? Math.min(
          dutyStartMs,
          ...generatedCommutes.map((c) => this.parseMs(c.start) ?? dutyStartMs),
        )
      : dutyStartMs;
    const effectiveDutyEndMs = generatedCommutes.length
      ? Math.max(
          dutyEndMs,
          ...generatedCommutes.map(
            (c) => this.parseMs(c.end ?? c.start) ?? dutyEndMs,
          ),
        )
      : dutyEndMs;

    const boundaryStartMs =
      manualStartMs !== null && manualStartMs < effectiveDutyStartMs
        ? manualStartMs
        : effectiveDutyStartMs;
    const boundaryEndMs =
      manualEndMs !== null && manualEndMs > effectiveDutyEndMs
        ? manualEndMs
        : effectiveDutyEndMs;
    const framedStartMs = boundaryStartMs;
    const framedEndMs = boundaryEndMs;

    const ownerGroup = this.resolveOwnerGroup(owner.kind);
    const startTypeId = typeIndex.startTypeIdByOwnerGroup[ownerGroup];
    const endTypeId = typeIndex.endTypeIdByOwnerGroup[ownerGroup];

    let serviceStart: Activity = this.buildBoundaryActivity({
      id: startId,
      title: existingStart?.title ?? 'Dienstanfang',
      type: startTypeId,
      role: 'start',
      startMs: boundaryStartMs,
      owner,
      serviceId,
      conflictKey,
      conflictCodesKey,
      manualBoundaryKey,
      manual: Boolean(
        existingStart &&
          this.isManualBoundary(existingStart, manualBoundaryKey),
      ),
    });
    let serviceEnd: Activity = this.buildBoundaryActivity({
      id: endId,
      title: existingEnd?.title ?? 'Dienstende',
      type: endTypeId,
      role: 'end',
      startMs: boundaryEndMs,
      owner,
      serviceId,
      conflictKey,
      conflictCodesKey,
      manualBoundaryKey,
      manual: Boolean(
        existingEnd && this.isManualBoundary(existingEnd, manualBoundaryKey),
      ),
    });

    if (homeDepotSelection.selection) {
      const site = homeDepotSelection.selection.selectedSite;
      serviceStart = {
        ...serviceStart,
        locationId: site.siteId,
        locationLabel: site.name,
      };
      serviceEnd = {
        ...serviceEnd,
        locationId: site.siteId,
        locationLabel: site.name,
      };
    }

    const manualStart =
      !!existingStart && this.isManualBoundary(existingStart, manualBoundaryKey);
    const manualEnd =
      !!existingEnd && this.isManualBoundary(existingEnd, manualBoundaryKey);
    const depotLabel =
      homeDepotSelection.selection?.selectedSite?.name ??
      homeDepotSelection.selection?.selectedSite?.siteId ??
      null;
    const pickBoundaryLocation = (
      candidate: string | null,
      existing: Activity | null,
      manual: boolean,
      fallback: string | null,
    ) => {
      const existingFrom = this.normalizeLocationValue(existing?.from);
      const existingTo = this.normalizeLocationValue(existing?.to);
      if (manual && (existingFrom || existingTo)) {
        return existingFrom ?? existingTo;
      }
      return (
        this.normalizeLocationValue(candidate) ??
        existingFrom ??
        existingTo ??
        fallback ??
        null
      );
    };
    const startLocation = pickBoundaryLocation(
      payloadStartLocation,
      existingStart,
      manualStart,
      depotLabel,
    );
    const endLocation = pickBoundaryLocation(
      payloadEndLocation,
      existingEnd,
      manualEnd,
      depotLabel,
    );
    if (startLocation) {
      serviceStart = { ...serviceStart, from: startLocation, to: startLocation };
    }
    if (endLocation) {
      serviceEnd = { ...serviceEnd, from: endLocation, to: endLocation };
    }

    const workEntries = this.buildWorkEntries([
      serviceStart,
      ...basePayloadActivities,
      ...generatedCommutes,
      serviceEnd,
    ]);
    const gaps = this.computeGaps(
      workEntries.map((entry) => ({
        startMs: entry.startMs,
        endMs: entry.endMs,
      })),
    ).filter((gap) => gap.durationMs > 0);

    const breakMinMs = config.minBreakMinutes * 60_000;
    const shortBreakMinMs = Math.max(0, config.minShortBreakMinutes) * 60_000;
    const maxContinuousMs = config.maxContinuousWorkMinutes * 60_000;
    const maxWorkMs = config.maxWorkMinutes * 60_000;
    const supportsBreaks =
      owner.kind === 'personnel' || owner.kind === 'personnel-service';
    const hasBreakSites =
      Array.isArray(depot?.breakSiteIds) && depot.breakSiteIds.length > 0;
    const hasShortBreakSites =
      Array.isArray(depot?.shortBreakSiteIds) &&
      depot.shortBreakSiteIds.length > 0;

    const selectedGapIds = new Set<string>();
    const selectedPauses: PlannedPause[] = [];
    const blockedContinuous: boolean[] = [];
    const gapLocations = new Map<
      string,
      { fromLocation: string | null; toLocation: string | null }
    >();
    const gapActivityIds = new Map<
      string,
      { fromId: string; toId: string }
    >();

    if (supportsBreaks) {
      let segmentWorkMs = 0;
      let cursorMs = workEntries[0]?.startMs ?? dutyStartMs;

      for (let i = 0; i < workEntries.length; i += 1) {
        const current = workEntries[i];
        const segmentStart = Math.max(cursorMs, current.startMs);
        segmentWorkMs += Math.max(0, current.endMs - segmentStart);
        cursorMs = Math.max(cursorMs, current.endMs);

        const next = workEntries[i + 1];
        if (!next) {
          break;
        }
        const gapStartMs = cursorMs;
        const gapEndMs = next.startMs;
        const gapDurationMs = Math.max(0, gapEndMs - gapStartMs);
        const nextDurationMs = Math.max(0, next.endMs - next.startMs);
        const gapId = `${gapStartMs}-${gapEndMs}`;
        const fromLocation = this.readEndLocation(current.activity);
        const toLocation = this.readStartLocation(next.activity);
        gapLocations.set(gapId, { fromLocation, toLocation });
        gapActivityIds.set(gapId, {
          fromId: current.activity.id,
          toId: next.activity.id,
        });

        if (segmentWorkMs + gapDurationMs + nextDurationMs > maxContinuousMs) {
          let planned: PlannedPause | null = null;
          let pauseConflictCodes: string[] = [];
          let pauseConflictDetails: ConflictDetails = {};
          let breakConflictCodes: string[] = [];
          let shortConflictCodes: string[] = [];

          if (depot && (hasBreakSites || hasShortBreakSites)) {
            if (hasBreakSites) {
              const breakAttempt = this.planPause({
                kind: 'break',
                depot,
                gapId,
                gapStartMs,
                gapEndMs,
                fromLocation,
                toLocation,
                minBreakMs: breakMinMs,
                minShortBreakMs: shortBreakMinMs,
                context,
              });
              this.mergeConflictDetails(
                pauseConflictDetails,
                breakAttempt.conflictDetails,
              );
              breakConflictCodes = breakAttempt.conflictCodes;
              if (breakAttempt.pause) {
                planned = breakAttempt.pause;
              }
            }
            if (!planned && hasShortBreakSites) {
              const shortAttempt = this.planPause({
                kind: 'short-break',
                depot,
                gapId,
                gapStartMs,
                gapEndMs,
                fromLocation,
                toLocation,
                minBreakMs: breakMinMs,
                minShortBreakMs: shortBreakMinMs,
                context,
              });
              this.mergeConflictDetails(
                pauseConflictDetails,
                shortAttempt.conflictDetails,
              );
              shortConflictCodes = shortAttempt.conflictCodes;
              planned = shortAttempt.pause;
            }
            if (planned) {
              pauseConflictCodes =
                planned.kind === 'break'
                  ? breakConflictCodes
                  : shortConflictCodes;
            } else {
              pauseConflictCodes = this.normalizeConflictCodes([
                ...breakConflictCodes,
                ...shortConflictCodes,
              ]);
            }
          }

          if (pauseConflictCodes.length) {
            const gapTargets = gapActivityIds.get(gapId);
            if (gapTargets) {
              const filteredDetails = this.detailsForCodes(
                this.normalizeConflictDetails(pauseConflictDetails),
                pauseConflictCodes,
              );
              [gapTargets.fromId, gapTargets.toId].forEach((targetId) => {
                addActivityCodes(targetId, pauseConflictCodes);
                mergeActivityDetails(targetId, filteredDetails);
              });
            }
          }

          if (planned) {
            selectedGapIds.add(gapId);
            selectedPauses.push(planned);
            segmentWorkMs = 0;
            cursorMs = planned.breakEndMs;
          } else if (
            !hasBreakSites &&
            !hasShortBreakSites &&
            gapDurationMs >= breakMinMs
          ) {
            selectedGapIds.add(gapId);
            selectedPauses.push({
              kind: 'break',
              site: null,
              gapId,
              fromLocation: fromLocation ?? '',
              toLocation: toLocation ?? '',
              commuteInMs: 0,
              commuteOutMs: 0,
              breakStartMs: gapStartMs,
              breakEndMs: gapEndMs,
            });
            segmentWorkMs = 0;
            cursorMs = gapEndMs;
          } else {
            blockedContinuous.push(true);
          }
        }
      }
    }

    const dutySpanMs = Math.max(0, framedEndMs - framedStartMs);
    let breakMs = 0;
    let workMs = Math.max(0, dutySpanMs);
    if (supportsBreaks) {
      breakMs = selectedPauses
        .filter((pause) => pause.kind === 'break')
        .reduce(
          (sum, entry) =>
            sum + Math.max(0, entry.breakEndMs - entry.breakStartMs),
          0,
        );
      workMs = Math.max(0, dutySpanMs - breakMs);

      if (workMs > maxWorkMs) {
        const additionalNeedMs = workMs - maxWorkMs;
        let remainingMs = additionalNeedMs;
        const candidates = gaps
          .filter((gap) => !selectedGapIds.has(gap.id))
          .map((gap) => {
            if (!hasBreakSites) {
              return {
                gap,
                planned: null as PlannedPause | null,
                breakDurationMs: gap.durationMs,
              };
            }
            const meta = gapLocations.get(gap.id) ?? {
              fromLocation: null,
              toLocation: null,
            };
            const attempt = this.planPause({
              kind: 'break',
              depot: depot!,
              gapId: gap.id,
              gapStartMs: gap.startMs,
              gapEndMs: gap.endMs,
              fromLocation: meta.fromLocation,
              toLocation: meta.toLocation,
              minBreakMs: breakMinMs,
              minShortBreakMs: shortBreakMinMs,
              context,
            });
            if (attempt.conflictCodes.length) {
              const gapTargets = gapActivityIds.get(gap.id);
              if (gapTargets) {
                const filteredDetails = this.detailsForCodes(
                  this.normalizeConflictDetails(attempt.conflictDetails),
                  attempt.conflictCodes,
                );
                [gapTargets.fromId, gapTargets.toId].forEach((targetId) => {
                  addActivityCodes(targetId, attempt.conflictCodes);
                  mergeActivityDetails(targetId, filteredDetails);
                });
              }
            }
            const planned = attempt.pause;
            const breakDurationMs = planned
              ? Math.max(0, planned.breakEndMs - planned.breakStartMs)
              : 0;
            return { gap, planned, breakDurationMs };
          })
          .filter((entry) => entry.breakDurationMs >= breakMinMs)
          .sort((a, b) => b.breakDurationMs - a.breakDurationMs);

        for (const entry of candidates) {
          if (remainingMs <= 0) {
            break;
          }
          selectedGapIds.add(entry.gap.id);
          if (entry.planned) {
            selectedPauses.push(entry.planned);
            breakMs += entry.breakDurationMs;
          } else {
            selectedPauses.push({
              kind: 'break',
              site: null,
              gapId: entry.gap.id,
              fromLocation: '',
              toLocation: '',
              commuteInMs: 0,
              commuteOutMs: 0,
              breakStartMs: entry.gap.startMs,
              breakEndMs: entry.gap.endMs,
            });
            breakMs += entry.gap.durationMs;
          }
          workMs = Math.max(0, dutySpanMs - breakMs);
          remainingMs = Math.max(0, workMs - maxWorkMs);
        }
      }
    }

    const pausesSorted = selectedPauses.sort(
      (a, b) => a.breakStartMs - b.breakStartMs,
    );
    const breakIntervals = pausesSorted.map((pause) => ({
      startMs: pause.breakStartMs,
      endMs: pause.breakEndMs,
    }));
    const maxContinuousObservedMs = supportsBreaks
      ? this.computeMaxContinuousMs(framedStartMs, framedEndMs, breakIntervals)
      : 0;

    const worktimeConflictCodes: string[] = [];
    if (supportsBreaks) {
      if (dutySpanMs > config.maxDutySpanMinutes * 60_000) {
        worktimeConflictCodes.push('MAX_DUTY_SPAN');
      }
      if (workMs > maxWorkMs) {
        worktimeConflictCodes.push('MAX_WORK');
      }
      if (
        maxContinuousObservedMs > maxContinuousMs ||
        blockedContinuous.length
      ) {
        worktimeConflictCodes.push('MAX_CONTINUOUS');
      }
      if (blockedContinuous.length) {
        worktimeConflictCodes.push('NO_BREAK_WINDOW');
      }
    }
    if (worktimeConflictCodes.length) {
      addActivityCodes(startId, worktimeConflictCodes);
      addActivityCodes(endId, worktimeConflictCodes);
    }

    const pauseCommutes: Activity[] = [];
    const pauseActivities: Activity[] = [];
    pausesSorted.forEach((pause, index) => {
      const ordinal = index + 1;
      const gapStartMs = pause.breakStartMs - pause.commuteInMs;
      const gapEndMs = pause.breakEndMs + pause.commuteOutMs;
      if (pause.site) {
        const commuteInId = `svccommute:${serviceId}:pause-in-${ordinal}`;
        const commuteOutId = `svccommute:${serviceId}:pause-out-${ordinal}`;
        managedIds.push(commuteInId, commuteOutId);
        pauseCommutes.push(
          this.buildCommuteActivity({
            id: commuteInId,
            title: 'Wegezeit',
            type: commuteTypeId,
            startMs: gapStartMs,
            endMs: pause.breakStartMs,
            from: pause.fromLocation,
            to: pause.site.siteId,
            owner,
            serviceId,
            conflictKey,
            conflictCodesKey,
            depotId: homeDepotSelection.selection?.depotId,
            siteId: pause.site.siteId,
            siteLabel: pause.site.name,
          }),
        );
        pauseCommutes.push(
          this.buildCommuteActivity({
            id: commuteOutId,
            title: 'Wegezeit',
            type: commuteTypeId,
            startMs: pause.breakEndMs,
            endMs: gapEndMs,
            from: pause.site.siteId,
            to: pause.toLocation,
            owner,
            serviceId,
            conflictKey,
            conflictCodesKey,
            depotId: homeDepotSelection.selection?.depotId,
            siteId: pause.site.siteId,
            siteLabel: pause.site.name,
          }),
        );
      }

      const breakId =
        pause.kind === 'short-break'
          ? `svcshortbreak:${serviceId}:${ordinal}`
          : `svcbreak:${serviceId}:${ordinal}`;
      managedIds.push(breakId);
      const type =
        pause.kind === 'short-break'
          ? shortBreakTypeId
          : (breakTypeIds[0] ?? shortBreakTypeId);
      const title = pause.kind === 'short-break' ? 'Kurzpause' : 'Pause';
      const breakFrom =
        this.normalizeLocationValue(pause.fromLocation) ??
        this.normalizeLocationValue(pause.site?.name) ??
        this.normalizeLocationValue(pause.site?.siteId) ??
        null;
      const breakTo =
        this.normalizeLocationValue(pause.toLocation) ?? breakFrom ?? null;
      const breakActivity = this.buildBreakActivity({
        id: breakId,
        title,
        type,
        startMs: pause.breakStartMs,
        endMs: pause.breakEndMs,
        from: breakFrom,
        to: breakTo,
        owner,
        serviceId,
        conflictKey,
        conflictCodesKey,
        isShortBreak: pause.kind === 'short-break',
        locationId: pause.site?.siteId,
        locationLabel: pause.site?.name,
        depotId: homeDepotSelection.selection?.depotId,
      });
      pauseActivities.push(breakActivity);
    });

    const localConflictCodes = this.detectLocalConflicts([
      ...basePayloadActivities,
      ...generatedCommutes,
      ...pauseCommutes,
    ]);
    localConflictCodes.forEach((codes, activityId) => {
      addActivityCodes(activityId, Array.from(codes));
    });

    const updatedPayload = basePayloadActivities.map((activity) => {
      const codes = this.normalizeConflictCodes(
        Array.from(activityCodes.get(activity.id) ?? []),
      );
      const details = this.detailsForCodes(
        this.normalizeConflictDetails(activityDetails.get(activity.id) ?? {}),
        codes,
      );
      const level = this.conflictLevelForCodes(codes, config.maxConflictLevel);
      return this.applyDutyAssignment(
        activity,
        ownerId,
        {
          serviceId,
          conflictLevel: level,
          conflictCodes: codes,
          conflictDetails: details,
        },
        conflictKey,
        conflictCodesKey,
      );
    });

    const updatedBoundaries = [
      serviceStart,
      serviceEnd,
    ].map((boundary) => {
      const codes = this.normalizeConflictCodes(
        Array.from(activityCodes.get(boundary.id) ?? []),
      );
      const details = this.detailsForCodes(
        this.normalizeConflictDetails(activityDetails.get(boundary.id) ?? {}),
        codes,
      );
      const level = this.conflictLevelForCodes(
        codes,
        config.maxConflictLevel,
      );
      return this.applyDutyMeta(
        boundary,
        serviceId,
        level,
        codes,
        conflictKey,
        conflictCodesKey,
        details,
      );
    });

    const updatedManaged = [
      ...generatedCommutes,
      ...pauseCommutes,
      ...pauseActivities,
    ].map((managed) => {
      const codes = this.normalizeConflictCodes(
        Array.from(activityCodes.get(managed.id) ?? []),
      );
      const details = this.detailsForCodes(
        this.normalizeConflictDetails(activityDetails.get(managed.id) ?? {}),
        codes,
      );
      const level = this.conflictLevelForCodes(
        codes,
        config.maxConflictLevel,
      );
      return this.applyDutyMeta(
        managed,
        serviceId,
        level,
        codes,
        conflictKey,
        conflictCodesKey,
        details,
      );
    });

    const upserts = [
      ...updatedPayload,
      ...updatedBoundaries,
      ...updatedManaged,
    ];

    const desiredManaged = new Set(managedIds);
    const deletedIds = Array.from(
      new Set([
        ...boundaryDeletedIds,
        ...group.activities
          .map((a) => a.id)
          .filter(
            (id) =>
              this.isManagedId(id) &&
              this.belongsToService(id, serviceId) &&
              !desiredManaged.has(id),
          ),
      ]),
    );

    return { upserts, deletedIds, managedIds };
  }

  private buildBoundaryActivity(options: {
    id: string;
    title: string;
    type: string;
    role: 'start' | 'end';
    startMs: number;
    owner: ActivityParticipant;
    serviceId: string;
    conflictKey: string;
    conflictCodesKey: string;
    manualBoundaryKey: string;
    manual: boolean;
  }): Activity {
    const startIso = new Date(options.startMs).toISOString();
    return {
      id: options.id,
      title: options.title,
      start: startIso,
      end: null,
      type: options.type,
      serviceId: options.serviceId,
      serviceRole: options.role,
      participants: [this.buildOwnerParticipant(options.owner)],
      attributes: {
        [options.conflictKey]: 0,
        [options.conflictCodesKey]: [],
        ...(options.manual ? { [options.manualBoundaryKey]: true } : {}),
      },
    };
  }

  private buildBreakActivity(options: {
    id: string;
    title: string;
    type: string;
    startMs: number;
    endMs: number;
    from?: string | null;
    to?: string | null;
    owner: ActivityParticipant;
    serviceId: string;
    conflictKey: string;
    conflictCodesKey: string;
    isShortBreak?: boolean;
    locationId?: string | null;
    locationLabel?: string | null;
    depotId?: string | null;
  }): Activity {
    const attrs: ActivityAttributes = {
      ...(options.conflictKey ? { [options.conflictKey]: 0 } : {}),
      ...(options.conflictCodesKey ? { [options.conflictCodesKey]: [] } : {}),
      is_break: true,
      ...(options.isShortBreak ? { is_short_break: true } : {}),
      ...(options.depotId ? { home_depot_id: options.depotId } : {}),
    };
    return {
      id: options.id,
      title: options.title,
      start: new Date(options.startMs).toISOString(),
      end: new Date(options.endMs).toISOString(),
      type: options.type,
      serviceId: options.serviceId,
      from: options.from ?? null,
      to: options.to ?? null,
      locationId: options.locationId ?? null,
      locationLabel: options.locationLabel ?? null,
      participants: [this.buildOwnerParticipant(options.owner)],
      attributes: attrs,
    };
  }

  private applyDutyMeta(
    activity: Activity,
    serviceId: string,
    conflictLevel: number,
    conflictCodes: string[],
    conflictKey: string,
    conflictCodesKey: string,
    conflictDetails?: ConflictDetails,
  ): Activity {
    const attrs: ActivityAttributes = { ...(activity.attributes ?? {}) };
    const detailsKey = this.conflictDetailsKey();
    const normalizedCodes = this.normalizeConflictCodes(conflictCodes);
    const normalizedDetails =
      conflictDetails === undefined
        ? null
        : this.normalizeConflictDetails(conflictDetails);
    const levelUnchanged = attrs[conflictKey] === conflictLevel;
    const codesUnchanged = this.sameStringArray(
      attrs[conflictCodesKey],
      normalizedCodes,
    );
    const serviceUnchanged = (activity.serviceId ?? null) === serviceId;
    const detailsUnchanged =
      normalizedDetails === null
        ? true
        : this.sameConflictDetails(attrs[detailsKey], normalizedDetails);
    if (
      levelUnchanged &&
      codesUnchanged &&
      serviceUnchanged &&
      detailsUnchanged
    ) {
      return activity;
    }

    attrs[conflictKey] = conflictLevel;
    attrs[conflictCodesKey] = normalizedCodes;
    if (normalizedDetails !== null) {
      if (Object.keys(normalizedDetails).length) {
        attrs[detailsKey] = normalizedDetails;
      } else {
        delete (attrs as any)[detailsKey];
      }
    }
    return { ...activity, serviceId, attributes: attrs };
  }

  private applyDutyAssignment(
    activity: Activity,
    ownerId: string,
    assignment: ServiceAssignment,
    conflictKey: string,
    conflictCodesKey: string,
  ): Activity {
    const attrs: ActivityAttributes = { ...(activity.attributes ?? {}) };
    const serviceByOwnerKey = this.serviceByOwnerKey();
    const detailsKey = this.conflictDetailsKey();
    const existing = attrs[serviceByOwnerKey];
    const map = this.cloneOwnerAssignmentMap(existing);
    const normalizedCodes = this.normalizeConflictCodes(
      assignment.conflictCodes,
    );
    const normalizedDetails =
      assignment.conflictDetails === undefined
        ? null
        : this.normalizeConflictDetails(assignment.conflictDetails);
    const currentEntry = map[ownerId];
    const retainedDetails =
      normalizedDetails === null
        ? this.normalizeConflictDetails(currentEntry?.conflictDetails ?? {})
        : normalizedDetails;
    const entryUnchanged =
      (currentEntry?.serviceId ?? null) === assignment.serviceId &&
      (currentEntry?.conflictLevel ?? 0) === assignment.conflictLevel &&
      this.sameStringArray(
        currentEntry?.conflictCodes ?? [],
        normalizedCodes,
      ) &&
      this.sameConflictDetails(currentEntry?.conflictDetails, retainedDetails);

    map[ownerId] = {
      serviceId: assignment.serviceId,
      conflictLevel: assignment.conflictLevel,
      conflictCodes: normalizedCodes,
      ...(Object.keys(retainedDetails).length
        ? { conflictDetails: retainedDetails }
        : {}),
    };

    attrs[serviceByOwnerKey] = map;

    // Keep a global union for non-slot aware consumers.
    const entries = Object.values(map);
    const maxLevel = entries.reduce(
      (max, entry) => Math.max(max, entry?.conflictLevel ?? 0),
      0,
    );
    const unionCodes = this.normalizeConflictCodes(
      entries.flatMap((entry) =>
        Array.isArray(entry?.conflictCodes) ? entry.conflictCodes : [],
      ),
    );
    const unionDetails: ConflictDetails = {};
    entries.forEach((entry) => {
      this.mergeConflictDetails(
        unionDetails,
        entry?.conflictDetails ?? undefined,
      );
    });
    const normalizedUnionDetails = this.normalizeConflictDetails(unionDetails);
    attrs[conflictKey] = maxLevel;
    attrs[conflictCodesKey] = unionCodes;
    if (Object.keys(normalizedUnionDetails).length) {
      attrs[detailsKey] = normalizedUnionDetails;
    } else {
      delete (attrs as any)[detailsKey];
    }

    const serviceUnchanged = activity.serviceId === null;
    const globalLevelUnchanged =
      (activity.attributes as any)?.[conflictKey] === maxLevel;
    const globalCodesUnchanged = this.sameStringArray(
      (activity.attributes as any)?.[conflictCodesKey],
      unionCodes,
    );
    const globalDetailsUnchanged = this.sameConflictDetails(
      (activity.attributes as any)?.[detailsKey],
      normalizedUnionDetails,
    );

    if (
      entryUnchanged &&
      serviceUnchanged &&
      globalLevelUnchanged &&
      globalCodesUnchanged &&
      globalDetailsUnchanged
    ) {
      return activity;
    }

    return { ...activity, serviceId: null, attributes: attrs };
  }

  private normalizeConflictCodes(codes: string[]): string[] {
    const normalized = codes
      .map((entry) => `${entry ?? ''}`.trim())
      .filter((entry) => entry.length > 0);
    return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
  }

  private conflictDetailsKey(): string {
    return 'service_conflict_details';
  }

  private appendConflictDetail(
    details: ConflictDetails,
    code: string,
    message: string,
  ): void {
    const key = `${code ?? ''}`.trim();
    const trimmed = `${message ?? ''}`.trim();
    if (!key || !trimmed) {
      return;
    }
    const list = details[key] ?? [];
    list.push(trimmed);
    details[key] = list;
  }

  private mergeConflictDetails(target: ConflictDetails, source: unknown): void {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return;
    }
    Object.entries(source as Record<string, unknown>).forEach(
      ([code, value]) => {
        if (!Array.isArray(value)) {
          return;
        }
        value.forEach((entry) =>
          this.appendConflictDetail(target, code, `${entry ?? ''}`),
        );
      },
    );
  }

  private normalizeConflictDetails(details: unknown): ConflictDetails {
    const result: ConflictDetails = {};
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      return result;
    }
    Object.entries(details as Record<string, unknown>).forEach(
      ([code, value]) => {
        if (!Array.isArray(value)) {
          return;
        }
        const normalizedCode = `${code ?? ''}`.trim();
        if (!normalizedCode) {
          return;
        }
        const entries = value
          .map((entry) => `${entry ?? ''}`.trim())
          .filter((entry) => entry.length > 0);
        if (!entries.length) {
          return;
        }
        const unique = Array.from(new Set(entries)).sort((a, b) =>
          a.localeCompare(b),
        );
        result[normalizedCode] = unique;
      },
    );
    return result;
  }

  private sameConflictDetails(
    current: unknown,
    expected: ConflictDetails,
  ): boolean {
    const expectedKeys = Object.keys(expected).sort((a, b) =>
      a.localeCompare(b),
    );
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return expectedKeys.length === 0;
    }
    const obj = current as Record<string, unknown>;
    const currentKeys = Object.keys(obj)
      .map((key) => `${key ?? ''}`.trim())
      .filter((key) => key.length > 0)
      .sort((a, b) => a.localeCompare(b));
    if (currentKeys.length !== expectedKeys.length) {
      return false;
    }
    for (let i = 0; i < currentKeys.length; i += 1) {
      if (currentKeys[i] !== expectedKeys[i]) {
        return false;
      }
    }
    for (const key of expectedKeys) {
      const expectedValues = expected[key] ?? [];
      const raw = obj[key];
      if (!Array.isArray(raw)) {
        return false;
      }
      if (raw.length !== expectedValues.length) {
        return false;
      }
      for (let i = 0; i < raw.length; i += 1) {
        if (`${raw[i] ?? ''}` !== expectedValues[i]) {
          return false;
        }
      }
    }
    return true;
  }

  private detailsForCodes(
    details: ConflictDetails,
    codes: string[],
  ): ConflictDetails {
    const set = new Set(
      codes.map((code) => `${code ?? ''}`.trim()).filter(Boolean),
    );
    const filtered: ConflictDetails = {};
    Object.entries(details).forEach(([code, entries]) => {
      if (!set.has(code)) {
        return;
      }
      entries.forEach((entry) =>
        this.appendConflictDetail(filtered, code, entry),
      );
    });
    return this.normalizeConflictDetails(filtered);
  }

  private formatWalkLink(
    site: PersonnelSite,
    uniqueOpId: string,
    context: MasterDataContext,
  ): string {
    const normalizedOpId = `${uniqueOpId ?? ''}`.trim().toUpperCase();
    const op = normalizedOpId
      ? (context.operationalPointsById.get(normalizedOpId) ?? null)
      : null;
    const opLabel = op?.name
      ? `${op.name} (${normalizedOpId})`
      : normalizedOpId || '—';
    const siteLabel = `${site.name ?? site.siteId}`.trim() || site.siteId;
    return `Wegzeit fehlt: ${siteLabel} (${site.siteId}) ↔ ${opLabel}`;
  }

  private sameStringArray(value: unknown, expected: string[]): boolean {
    if (!Array.isArray(value)) {
      return expected.length === 0;
    }
    if (value.length !== expected.length) {
      return false;
    }
    for (let i = 0; i < value.length; i += 1) {
      if (`${value[i] ?? ''}` !== expected[i]) {
        return false;
      }
    }
    return true;
  }

  private computeMaxContinuousMs(
    dutyStartMs: number,
    dutyEndMs: number,
    breaks: Array<{ startMs: number; endMs: number }>,
  ): number {
    let max = 0;
    let cursor = dutyStartMs;
    for (const brk of breaks) {
      const seg = Math.max(0, brk.startMs - cursor);
      if (seg > max) {
        max = seg;
      }
      cursor = Math.max(cursor, brk.endMs);
    }
    const last = Math.max(0, dutyEndMs - cursor);
    return Math.max(max, last);
  }

  private computeGaps(
    intervals: Array<{ startMs: number; endMs: number }>,
  ): Array<{
    id: string;
    startMs: number;
    endMs: number;
    durationMs: number;
  }> {
    const gaps: Array<{
      id: string;
      startMs: number;
      endMs: number;
      durationMs: number;
    }> = [];
    for (let i = 0; i < intervals.length - 1; i += 1) {
      const endMs = intervals[i].endMs;
      const nextStartMs = intervals[i + 1].startMs;
      const startMs = endMs;
      const gapEndMs = nextStartMs;
      const durationMs = Math.max(0, gapEndMs - startMs);
      if (durationMs <= 0) {
        continue;
      }
      gaps.push({
        id: `${startMs}-${gapEndMs}`,
        startMs,
        endMs: gapEndMs,
        durationMs,
      });
    }
    return gaps;
  }

  private sortedIntervals(list: Activity[]): {
    intervals: Array<{ startMs: number; endMs: number }>;
    minStartMs: number;
    maxEndMs: number;
  } {
    const intervals = list
      .map((activity) => {
        const startMs = this.parseMs(activity.start);
        if (startMs === null) {
          return null;
        }
        const endMs = this.resolveEndMs(activity, startMs);
        const normalizedEnd = Math.max(startMs, endMs);
        return { startMs, endMs: normalizedEnd };
      })
      .filter(
        (interval): interval is { startMs: number; endMs: number } =>
          interval !== null,
      )
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    const minStartMs = intervals.length ? intervals[0].startMs : 0;
    const maxEndMs = intervals.reduce(
      (max, entry) => Math.max(max, entry.endMs),
      minStartMs,
    );
    return { intervals, minStartMs, maxEndMs };
  }

  private parseMs(iso: unknown): number | null {
    if (iso === null || iso === undefined) {
      return null;
    }
    if (iso instanceof Date) {
      const ms = iso.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof iso === 'string') {
      const value = iso.trim();
      if (!value) {
        return null;
      }
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : null;
    }
    const value = `${iso ?? ''}`.trim();
    if (!value) {
      return null;
    }
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  private resolveEndMs(activity: Activity, startMs: number): number {
    const explicit = this.parseMs(activity.end ?? null);
    if (explicit !== null) {
      return explicit;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['default_duration'];
    const minutes =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseFloat(raw)
          : Number.NaN;
    if (Number.isFinite(minutes) && minutes > 0) {
      return startMs + minutes * 60_000;
    }
    return startMs;
  }

  private conflictLevelForCodes(codes: string[], maxLevel: number): number {
    if (!codes.length) {
      return 0;
    }
    const errorCodes = new Set<string>([
      'MAX_DUTY_SPAN',
      'MAX_WORK',
      'MAX_CONTINUOUS',
      'NO_BREAK_WINDOW',
      'CAPACITY_OVERLAP',
      'HOME_DEPOT_NOT_FOUND',
      'HOME_DEPOT_NO_SITES',
      'HOME_DEPOT_SITE_NOT_FOUND',
      'HOME_DEPOT_START_LOCATION_MISSING',
      'HOME_DEPOT_END_LOCATION_MISSING',
      'HOME_DEPOT_PAUSE_LOCATION_MISSING',
      'HOME_DEPOT_NOT_IN_DEPOT',
      'HOME_DEPOT_OVERNIGHT_LOCATION_MISSING',
      'HOME_DEPOT_OVERNIGHT_SITE_FORBIDDEN',
      'HOME_DEPOT_NO_BREAK_SITES',
      'HOME_DEPOT_NO_SHORT_BREAK_SITES',
      'WALK_TIME_MISSING_START',
      'WALK_TIME_MISSING_END',
      'WALK_TIME_MISSING_BREAK',
      'WALK_TIME_MISSING_SHORT_BREAK',
      'AZG_REST_MIN',
      'AZG_BREAK_REQUIRED',
      'AZG_BREAK_MAX_COUNT',
      'AZG_BREAK_TOO_SHORT',
      'AZG_BREAK_STANDARD_MIN',
      'AZG_WORK_EXCEED_BUFFER',
      'AZG_DUTY_SPAN_EXCEED_BUFFER',
      'AZG_NIGHT_STREAK_MAX',
      'AZG_NIGHT_28D_MAX',
    ]);
    const warnCodes = new Set<string>([
      'LOCATION_SEQUENCE',
      'AZG_WORK_AVG_7D',
      'AZG_WORK_AVG_365D',
      'AZG_DUTY_SPAN_AVG_28D',
      'AZG_REST_AVG_28D',
      'AZG_BREAK_FORBIDDEN_NIGHT',
      'AZG_BREAK_MIDPOINT',
      'AZG_REST_DAYS_YEAR_MIN',
      'AZG_REST_SUNDAYS_YEAR_MIN',
    ]);
    if (codes.some((code) => errorCodes.has(code))) {
      return Math.min(maxLevel, 2);
    }
    if (codes.some((code) => warnCodes.has(code))) {
      return Math.min(maxLevel, 1);
    }
    return 0;
  }

  private withinServiceConflictCodes(
    pref: 'within' | 'outside' | 'both',
    isWithin: boolean,
  ): string[] {
    const codes: string[] = [];
    if (pref === 'within' && !isWithin) {
      codes.push('WITHIN_SERVICE_REQUIRED');
    }
    if (pref === 'outside' && isWithin) {
      codes.push('OUTSIDE_SERVICE_REQUIRED');
    }
    return codes;
  }

  private buildComplianceGrouping(
    stageId: StageId,
    activities: Activity[],
    config: ResolvedDutyAutopilotConfig,
  ): {
    ownerBuckets: Map<
      string,
      { owner: ActivityParticipant; activities: Activity[] }
    >;
    assignmentByOwnerId: Map<string, Map<string, string | null>>;
    groups: DutyActivityGroup[];
  } {
    const boundaryTypeIds = config.resolvedTypeIds.boundaryTypeIds;
    const startTypeIds = config.resolvedTypeIds.startTypeIds;
    const endTypeIds = config.resolvedTypeIds.endTypeIds;

    const isBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return (
        role === 'start' ||
        role === 'end' ||
        boundaryTypeIds.has((activity.type ?? '').trim())
      );
    };
    const isStartBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'start' || startTypeIds.has((activity.type ?? '').trim());
    };
    const isEndBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'end' || endTypeIds.has((activity.type ?? '').trim());
    };

    const ownerBuckets = new Map<
      string,
      { owner: ActivityParticipant; activities: Activity[] }
    >();

    for (const activity of activities) {
      const owners = this.resolveDutyOwners(activity);
      if (!owners.length) {
        continue;
      }
      for (const owner of owners) {
        const ownerId = owner.resourceId;
        const bucket = ownerBuckets.get(ownerId);
        if (bucket) {
          bucket.activities.push(activity);
        } else {
          ownerBuckets.set(ownerId, { owner, activities: [activity] });
        }
      }
    }

    const resolveServiceIdForBoundary = (
      ownerId: string,
      activity: Activity,
    ): string | null => {
      const parsed = this.parseServiceIdFromManagedId(activity.id);
      if (parsed) {
        const parsedOwner = this.parseOwnerIdFromServiceId(parsed);
        const parsedStage = this.parseStageIdFromServiceId(parsed);
        if (parsedOwner && parsedOwner !== ownerId) {
          return null;
        }
        if (parsedStage && parsedStage !== stageId) {
          return null;
        }
        return parsed;
      }
      const explicit =
        typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
      if (explicit.startsWith('svc:')) {
        const explicitOwner = this.parseOwnerIdFromServiceId(explicit);
        const explicitStage = this.parseStageIdFromServiceId(explicit);
        if (explicitOwner && explicitOwner !== ownerId) {
          return null;
        }
        if (explicitStage && explicitStage !== stageId) {
          return null;
        }
        return explicit;
      }
      const dayKey = this.utcDayKey(activity.start);
      return this.computeServiceId(stageId, ownerId, dayKey);
    };

    const assignmentByOwnerId = new Map<string, Map<string, string | null>>();
    const groups = new Map<string, DutyActivityGroup>();

    const fallbackServiceWindowMs = 36 * 3600_000;

    ownerBuckets.forEach(({ owner, activities: ownerActivities }, ownerId) => {
      const starts = ownerActivities
        .filter((activity) => isStartBoundary(activity))
        .map((activity) => {
          const serviceId = resolveServiceIdForBoundary(ownerId, activity);
          if (!serviceId) {
            return null;
          }
          const startMs = this.parseMs(activity.start);
          if (startMs === null) {
            return null;
          }
          return { serviceId, startMs };
        })
        .filter(
          (entry): entry is { serviceId: string; startMs: number } =>
            entry !== null,
        )
        .sort(
          (a, b) =>
            a.startMs - b.startMs || a.serviceId.localeCompare(b.serviceId),
        );

      const ends = ownerActivities
        .filter((activity) => isEndBoundary(activity))
        .map((activity) => {
          const serviceId = resolveServiceIdForBoundary(ownerId, activity);
          if (!serviceId) {
            return null;
          }
          const startMs = this.parseMs(activity.start);
          if (startMs === null) {
            return null;
          }
          const endMs = Math.max(startMs, this.resolveEndMs(activity, startMs));
          return { serviceId, startMs, endMs };
        })
        .filter(
          (
            entry,
          ): entry is { serviceId: string; startMs: number; endMs: number } =>
            entry !== null,
        );

      let windows: Array<{
        serviceId: string;
        startMs: number;
        endMs: number;
      }> = [];
      if (config.enforceOneDutyPerDay) {
        const startsByService = new Map<string, number>();
        starts.forEach((entry) => {
          const existing = startsByService.get(entry.serviceId);
          if (existing === undefined || entry.startMs < existing) {
            startsByService.set(entry.serviceId, entry.startMs);
          }
        });
        const endsByService = new Map<string, number>();
        ends.forEach((entry) => {
          const existing = endsByService.get(entry.serviceId);
          if (existing === undefined || entry.endMs > existing) {
            endsByService.set(entry.serviceId, entry.endMs);
          }
        });
        windows = Array.from(startsByService.entries()).map(
          ([serviceId, startMs]) => {
            const endCandidate = endsByService.get(serviceId);
            const endMs =
              endCandidate !== undefined && endCandidate >= startMs
                ? endCandidate
                : startMs + fallbackServiceWindowMs;
            return { serviceId, startMs, endMs };
          },
        );
      } else {
        windows = starts.map((start) => {
          const endMs =
            ends
              .filter(
                (candidate) =>
                  candidate.serviceId === start.serviceId &&
                  candidate.startMs >= start.startMs,
              )
              .sort((a, b) => a.startMs - b.startMs)[0]?.endMs ??
            start.startMs + fallbackServiceWindowMs;
          return { serviceId: start.serviceId, startMs: start.startMs, endMs };
        });
      }
      windows.sort(
        (a, b) =>
          a.startMs - b.startMs || a.serviceId.localeCompare(b.serviceId),
      );
      if (!windows.length) {
        const dayBuckets = new Map<
          string,
          { minStartMs: number; maxEndMs: number }
        >();
        ownerActivities.forEach((activity) => {
          const startMs = this.parseMs(activity.start);
          if (startMs === null) {
            return;
          }
          const endMs = Math.max(startMs, this.resolveEndMs(activity, startMs));
          const dayKey = this.utcDayKey(activity.start);
          const existing = dayBuckets.get(dayKey);
          if (!existing) {
            dayBuckets.set(dayKey, { minStartMs: startMs, maxEndMs: endMs });
            return;
          }
          existing.minStartMs = Math.min(existing.minStartMs, startMs);
          existing.maxEndMs = Math.max(existing.maxEndMs, endMs);
        });
        windows = Array.from(dayBuckets.entries()).map(
          ([dayKey, range]) => {
            const serviceId = this.computeServiceId(stageId, ownerId, dayKey);
            const endMs =
              range.maxEndMs >= range.minStartMs
                ? range.maxEndMs
                : range.minStartMs + fallbackServiceWindowMs;
            return {
              serviceId,
              startMs: range.minStartMs,
              endMs,
            };
          },
        );
        windows.sort(
          (a, b) =>
            a.startMs - b.startMs || a.serviceId.localeCompare(b.serviceId),
        );
      }

      const findWindowServiceId = (startMs: number): string | null => {
        for (let i = windows.length - 1; i >= 0; i -= 1) {
          const window = windows[i];
          if (startMs >= window.startMs && startMs <= window.endMs) {
            return window.serviceId;
          }
        }
        return null;
      };

      const assignments = new Map<string, string | null>();
      assignmentByOwnerId.set(ownerId, assignments);

      for (const activity of ownerActivities) {
        let serviceId: string | null = null;
        if (this.isManagedId(activity.id) || isBoundary(activity)) {
          serviceId = resolveServiceIdForBoundary(ownerId, activity);
        } else {
          const startMs = this.parseMs(activity.start);
          serviceId = startMs === null ? null : findWindowServiceId(startMs);
        }
        assignments.set(activity.id, serviceId);
        if (!serviceId) {
          continue;
        }
        const dayKey =
          this.parseDayKeyFromServiceId(serviceId) ??
          this.utcDayKey(activity.start);
        const existing = groups.get(serviceId);
        if (existing) {
          existing.activities.push(activity);
        } else {
          groups.set(serviceId, {
            serviceId,
            owner,
            dayKey,
            activities: [activity],
          });
        }
      }
    });

    return {
      ownerBuckets,
      assignmentByOwnerId,
      groups: Array.from(groups.values()),
    };
  }

  private applyLocalConflictCompliance(
    stageId: StageId,
    activities: Activity[],
    config: ResolvedDutyAutopilotConfig,
  ): Activity[] {
    if (!activities.length) {
      return [];
    }

    const conflictKey = config.conflictAttributeKey;
    const conflictCodesKey = config.conflictCodesAttributeKey;
    const breakTypeIds = config.breakTypeIds;
    const shortBreakTypeId = config.shortBreakTypeId;
    const boundaryTypeIds = config.resolvedTypeIds.boundaryTypeIds;

    const managedLocalCodes = new Set([
      'CAPACITY_OVERLAP',
      'LOCATION_SEQUENCE',
      'WITHIN_SERVICE_REQUIRED',
      'OUTSIDE_SERVICE_REQUIRED',
      'SERVICE_START_LOCATION_MISSING',
      'SERVICE_END_LOCATION_MISSING',
      'BREAK_LOCATION_MISSING',
      'SHORT_BREAK_LOCATION_MISSING',
    ]);

    const isBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return (
        role === 'start' ||
        role === 'end' ||
        boundaryTypeIds.has((activity.type ?? '').trim())
      );
    };
    const isBreak = (activity: Activity) =>
      this.isBreakActivity(activity, breakTypeIds);
    const isShortBreak = (activity: Activity) =>
      this.isShortBreakActivity(activity, shortBreakTypeId);
    const isBreakLike = (activity: Activity) =>
      isBreak(activity) || isShortBreak(activity);
    const isManagedForConflicts = (activity: Activity) => {
      if (!this.isManagedId(activity.id)) {
        return false;
      }
      const type = (activity.type ?? '').trim();
      if (!type) {
        return true;
      }
      if (boundaryTypeIds.has(type)) {
        return true;
      }
      if (breakTypeIds.some((id) => id === type) || type === shortBreakTypeId) {
        return true;
      }
      if (type === config.commuteTypeId) {
        return true;
      }
      return false;
    };

    const byId = new Map<string, Activity>(
      activities.map((activity) => [activity.id, activity]),
    );
    const updated = new Map<string, Activity>();

    const grouping = this.buildComplianceGrouping(stageId, activities, config);
    const groups = grouping.groups;
    const isTimelineOwner = (owner: ActivityParticipant) =>
      owner.kind === 'personnel' || owner.kind === 'vehicle';
    const globalLocationConflictsByOwner = new Map<
      string,
      Map<string, Set<string>>
    >();
    grouping.ownerBuckets.forEach(
      ({ owner, activities: ownerActivities }, ownerId) => {
        if (!isTimelineOwner(owner)) {
          return;
        }
        const conflicts = this.detectLocalConflicts(ownerActivities, {
          includeCapacity: false,
          includeLocation: true,
          skipMissingLocations: true,
        });
        if (conflicts.size) {
          globalLocationConflictsByOwner.set(ownerId, conflicts);
        }
      },
    );
    for (const group of groups) {
      const serviceId = group.serviceId;
      const ownerId = group.owner.resourceId;
      const capacityActivities = group.activities.filter((activity) => {
        if (!isManagedForConflicts(activity)) {
          return true;
        }
        return isBoundary(activity) || isBreakLike(activity);
      });

      const capacityConflicts = this.detectLocalConflicts(capacityActivities, {
        includeLocation: false,
      });
      const locationActivities = group.activities;
      const locationConflicts = this.detectLocalConflicts(locationActivities, {
        includeCapacity: false,
        includeLocation: true,
        skipMissingLocations: true,
      });
      const localConflicts = new Map<string, Set<string>>();
      this.mergeConflictMaps(localConflicts, capacityConflicts);
      this.mergeConflictMaps(localConflicts, locationConflicts);
      const globalLocationConflicts = isTimelineOwner(group.owner)
        ? globalLocationConflictsByOwner.get(ownerId)
        : undefined;

      for (const groupActivity of group.activities) {
        const current = byId.get(groupActivity.id) ?? groupActivity;
        const scopeCodes = this.withinServiceConflictCodes(
          this.resolveWithinPreference(current),
          true,
        );
        const localCodes = new Set(localConflicts.get(current.id) ?? []);
        const globalCodes = globalLocationConflicts?.get(current.id);
        if (globalCodes) {
          globalCodes.forEach((code) => localCodes.add(code));
        }
        const desiredLocalCodes = this.normalizeConflictCodes(
          Array.from(localCodes),
        );

        const baseCodes = this.readConflictCodesForActivity(
          current,
          ownerId,
          conflictCodesKey,
        );
        const preserved = baseCodes.filter(
          (code) => !managedLocalCodes.has(code),
        );
        const merged = this.normalizeConflictCodes([
          ...preserved,
          ...desiredLocalCodes,
          ...scopeCodes,
        ]);
        const level = this.conflictLevelForCodes(
          merged,
          config.maxConflictLevel,
        );

        const next =
          isManagedForConflicts(current) || isBoundary(current)
            ? this.applyDutyMeta(
                current,
                serviceId,
                level,
                merged,
                conflictKey,
                conflictCodesKey,
              )
            : this.applyDutyAssignment(
                current,
                ownerId,
                { serviceId, conflictLevel: level, conflictCodes: merged },
                conflictKey,
                conflictCodesKey,
              );

        if (next !== current) {
          byId.set(next.id, next);
          updated.set(next.id, next);
        }
      }
    }

    const unassignedLocalConflictsByOwner = new Map<
      string,
      Map<string, Set<string>>
    >();
    grouping.ownerBuckets.forEach(
      ({ activities: ownerActivities }, ownerId) => {
        const assignments = grouping.assignmentByOwnerId.get(ownerId);
        const unassignedPayload = ownerActivities
          .filter((activity) => !(assignments?.get(activity.id) ?? null))
          .filter((activity) => !isBoundary(activity))
          .filter((activity) => !isBreak(activity))
          .filter((activity) => !isManagedForConflicts(activity));
        if (!unassignedPayload.length) {
          return;
        }
        const byDay = new Map<string, Activity[]>();
        unassignedPayload.forEach((activity) => {
          const dayKey = this.utcDayKey(activity.start);
          const list = byDay.get(dayKey);
          if (list) {
            list.push(activity);
          } else {
            byDay.set(dayKey, [activity]);
          }
        });
        const merged = new Map<string, Set<string>>();
        byDay.forEach((list) => {
          const conflicts = this.detectLocalConflicts(list);
          conflicts.forEach((codes, activityId) => {
            let set = merged.get(activityId);
            if (!set) {
              set = new Set<string>();
              merged.set(activityId, set);
            }
            codes.forEach((code) => set.add(code));
          });
        });
        const ownerEntry = grouping.ownerBuckets.get(ownerId);
        const globalLocationConflicts =
          ownerEntry && isTimelineOwner(ownerEntry.owner)
            ? globalLocationConflictsByOwner.get(ownerId)
            : undefined;
        if (globalLocationConflicts) {
          this.mergeConflictMaps(merged, globalLocationConflicts);
        }
        if (merged.size) {
          unassignedLocalConflictsByOwner.set(ownerId, merged);
        }
      },
    );

    grouping.ownerBuckets.forEach(
      ({ activities: ownerActivities }, ownerId) => {
        const assignments = grouping.assignmentByOwnerId.get(ownerId);
        for (const entry of ownerActivities) {
          const assignedServiceId = assignments?.get(entry.id) ?? null;
          if (assignedServiceId) {
            continue;
          }
          const current = byId.get(entry.id) ?? entry;
          if (isManagedForConflicts(current) || isBoundary(current)) {
            continue;
          }
          const localConflicts = unassignedLocalConflictsByOwner.get(ownerId);
          const desiredLocalCodes = this.normalizeConflictCodes(
            Array.from(localConflicts?.get(current.id) ?? []),
          );
          const scopeCodes = this.withinServiceConflictCodes(
            this.resolveWithinPreference(current),
            false,
          );
          const baseCodes = this.readConflictCodesForActivity(
            current,
            ownerId,
            conflictCodesKey,
          );
          const preserved = baseCodes.filter(
            (code) => !managedLocalCodes.has(code),
          );
          const merged = this.normalizeConflictCodes([
            ...preserved,
            ...desiredLocalCodes,
            ...scopeCodes,
          ]);
          const level = this.conflictLevelForCodes(
            merged,
            config.maxConflictLevel,
          );
          const next = this.applyDutyAssignment(
            current,
            ownerId,
            { serviceId: null, conflictLevel: level, conflictCodes: merged },
            conflictKey,
            conflictCodesKey,
          );
          if (next !== current) {
            byId.set(next.id, next);
            updated.set(next.id, next);
          }
        }
      },
    );

    return Array.from(updated.values());
  }

  private applyHomeDepotCompliance(
    stageId: StageId,
    activities: Activity[],
    config: ResolvedDutyAutopilotConfig,
  ): Activity[] {
    if (!activities.length) {
      return [];
    }

    const grouping = this.buildComplianceGrouping(stageId, activities, config);
    const groups = grouping.groups.filter(
      (group) =>
        group.owner.kind === 'personnel' ||
        group.owner.kind === 'personnel-service',
    );
    if (!groups.length) {
      return [];
    }

    const conflictKey = config.conflictAttributeKey;
    const conflictCodesKey = config.conflictCodesAttributeKey;
    const breakTypeIds = config.breakTypeIds;
    const shortBreakTypeId = config.shortBreakTypeId;
    const boundaryTypeIds = config.resolvedTypeIds.boundaryTypeIds;
    const startTypeIds = config.resolvedTypeIds.startTypeIds;
    const endTypeIds = config.resolvedTypeIds.endTypeIds;

    const isBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return (
        role === 'start' ||
        role === 'end' ||
        boundaryTypeIds.has((activity.type ?? '').trim())
      );
    };
    const isStartBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'start' || startTypeIds.has((activity.type ?? '').trim());
    };
    const isEndBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'end' || endTypeIds.has((activity.type ?? '').trim());
    };
    const isShortBreak = (activity: Activity) =>
      this.isShortBreakActivity(activity, shortBreakTypeId);
    const isRegularBreak = (activity: Activity) =>
      this.isBreakActivity(activity, breakTypeIds) && !isShortBreak(activity);
    const isAnyPause = (activity: Activity) =>
      isRegularBreak(activity) || isShortBreak(activity);
    const isHomeDepotCode = (code: string) =>
      code.startsWith('HOME_DEPOT_') || code.startsWith('WALK_TIME_');

    const context = this.buildMasterDataContext();
    const byId = new Map<string, Activity>(
      activities.map((activity) => [activity.id, activity]),
    );
    const updated = new Map<string, Activity>();

    for (const group of groups) {
      const ownerId = group.owner.resourceId;
      const serviceId = group.serviceId;
      const groupActivities = group.activities.map(
        (activity) => byId.get(activity.id) ?? activity,
      );

      const basePayloadActivities = groupActivities
        .filter((activity) => !isBoundary(activity))
        .filter((activity) => !isAnyPause(activity))
        .filter((activity) => !this.isManagedId(activity.id));

      const startBoundary =
        groupActivities.find(
          (activity) => activity.id === `svcstart:${serviceId}`,
        ) ??
        groupActivities.find((activity) => isStartBoundary(activity)) ??
        null;
      const endBoundary =
        groupActivities.find(
          (activity) => activity.id === `svcend:${serviceId}`,
        ) ??
        groupActivities.find((activity) => isEndBoundary(activity)) ??
        null;

      let selectionActivities = basePayloadActivities;
      if (!selectionActivities.length) {
        selectionActivities = [];
        if (startBoundary) {
          selectionActivities.push(startBoundary);
        }
        if (endBoundary && endBoundary.id !== startBoundary?.id) {
          selectionActivities.push(endBoundary);
        }
      }
      if (!selectionActivities.length) {
        selectionActivities = groupActivities.filter(
          (activity) => !isAnyPause(activity),
        );
      }
      if (!selectionActivities.length) {
        selectionActivities = groupActivities;
      }

      const homeDepotSelection = this.resolveHomeDepotSelection(
        group.owner,
        selectionActivities,
        context,
      );
      const activityCodes = new Map<string, Set<string>>();
      const activityDetails = new Map<string, ConflictDetails>();
      const addActivityCodes = (
        activityId: string | null | undefined,
        codes: string[],
      ) => {
        if (!activityId || !codes.length) {
          return;
        }
        let set = activityCodes.get(activityId);
        if (!set) {
          set = new Set<string>();
          activityCodes.set(activityId, set);
        }
        codes.forEach((code) => set!.add(code));
      };
      const addActivityDetail = (
        activityId: string | null | undefined,
        code: string,
        detail: string,
      ) => {
        if (!activityId) {
          return;
        }
        const details = activityDetails.get(activityId) ?? {};
        this.appendConflictDetail(details, code, detail);
        activityDetails.set(activityId, details);
      };
      const mergeActivityDetails = (
        activityId: string | null | undefined,
        details: ConflictDetails,
      ) => {
        if (!activityId || !Object.keys(details).length) {
          return;
        }
        const existing = activityDetails.get(activityId) ?? {};
        this.mergeConflictDetails(existing, details);
        activityDetails.set(activityId, existing);
      };

      const selectionFirst = this.findFirstActivity(selectionActivities);
      const selectionLast = this.findLastActivity(selectionActivities);
      const selectionCodes = homeDepotSelection.conflictCodes;
      const startSpecific = new Set([
        'HOME_DEPOT_START_LOCATION_MISSING',
        'WALK_TIME_MISSING_START',
      ]);
      const endSpecific = new Set([
        'HOME_DEPOT_END_LOCATION_MISSING',
        'WALK_TIME_MISSING_END',
      ]);
      const startCodes = selectionCodes.filter((code) =>
        startSpecific.has(code),
      );
      const endCodes = selectionCodes.filter((code) => endSpecific.has(code));
      const generalCodes = selectionCodes.filter(
        (code) => !startSpecific.has(code) && !endSpecific.has(code),
      );
      const selectionDetails = homeDepotSelection.conflictDetails;
      const addSelectionCodes = (
        activityId: string | null,
        codes: string[],
      ) => {
        if (!activityId || !codes.length) {
          return;
        }
        addActivityCodes(activityId, codes);
        const details = this.detailsForCodes(selectionDetails, codes);
        mergeActivityDetails(activityId, details);
      };
      const startTargetId =
        startBoundary?.id ??
        selectionFirst?.id ??
        selectionLast?.id ??
        endBoundary?.id ??
        null;
      const endTargetId =
        endBoundary?.id ??
        selectionLast?.id ??
        selectionFirst?.id ??
        startBoundary?.id ??
        null;
      const generalTargetId = startTargetId ?? endTargetId;
      addSelectionCodes(generalTargetId, generalCodes);
      addSelectionCodes(startTargetId, startCodes);
      addSelectionCodes(endTargetId, endCodes);

      const depot =
        homeDepotSelection.selection?.depot ??
        this.resolveHomeDepot(group.owner, context);

      const recordOutside = (
        label: string,
        location: string | null,
        activityId?: string,
      ) => {
        const normalized = `${location ?? ''}`.trim();
        if (!normalized) {
          return;
        }
        const targetId = activityId ?? startTargetId ?? endTargetId ?? null;
        addActivityCodes(targetId, ['HOME_DEPOT_NOT_IN_DEPOT']);
        const detail = activityId
          ? `${label}: ${activityId} (${normalized})`
          : `${label}: ${normalized}`;
        addActivityDetail(targetId, 'HOME_DEPOT_NOT_IN_DEPOT', detail);
      };

      if (homeDepotSelection.selection) {
        const selection = homeDepotSelection.selection;
        const allowedStartEnd = this.buildAllowedSiteLookup(
          selection.depot.siteIds ?? [],
          context,
        );

        if (allowedStartEnd.siteIds.size > 0) {
          const startCandidates = startBoundary
            ? [
                {
                  activity: startBoundary,
                  location: this.readStartLocation(startBoundary),
                },
              ]
            : [];

          const endCandidates = endBoundary
            ? [
                {
                  activity: endBoundary,
                  location: this.readEndLocation(endBoundary),
                },
              ]
            : [];

          for (const candidate of startCandidates) {
            const location = candidate.location;
            if (!location) {
              continue;
            }
            if (
              !this.isLocationInAllowedSiteIds(
                location,
                allowedStartEnd.siteIds,
                context,
              )
            ) {
              recordOutside('Dienstanfang', location, candidate.activity.id);
            }
          }

          for (const candidate of endCandidates) {
            const location = candidate.location;
            if (!location) {
              continue;
            }
            if (
              !this.isLocationInAllowedSiteIds(
                location,
                allowedStartEnd.siteIds,
                context,
              )
            ) {
              recordOutside('Dienstende', location, candidate.activity.id);
            }
          }
        }
      }

      if (depot) {
        const allowedBreaks = this.buildAllowedSiteLookup(
          depot.breakSiteIds ?? [],
          context,
        );
        const allowedShortBreaks = this.buildAllowedSiteLookup(
          depot.shortBreakSiteIds ?? [],
          context,
        );

        if (allowedBreaks.siteIds.size > 0) {
          for (const activity of groupActivities) {
            if (!isRegularBreak(activity)) {
              continue;
            }
            const location = this.readStartLocation(activity);
            if (
              !this.isLocationInAllowedSiteIds(
                location,
                allowedBreaks.siteIds,
                context,
              )
            ) {
              recordOutside('Pause', location, activity.id);
            }
          }
        }

        if (allowedShortBreaks.siteIds.size > 0) {
          for (const activity of groupActivities) {
            if (!isShortBreak(activity)) {
              continue;
            }
            const location = this.readStartLocation(activity);
            if (
              !this.isLocationInAllowedSiteIds(
                location,
                allowedShortBreaks.siteIds,
                context,
              )
            ) {
              recordOutside('Kurzpause', location, activity.id);
            }
          }
        }
      }

      for (const activity of groupActivities) {
        const current = byId.get(activity.id) ?? activity;
        const activityHomeDepotCodes = this.normalizeConflictCodes(
          Array.from(activityCodes.get(current.id) ?? []),
        );
        const baseCodes = this.readConflictCodesForActivity(
          current,
          ownerId,
          conflictCodesKey,
        );
        const preservedCodes = baseCodes.filter(
          (code) => !isHomeDepotCode(code),
        );
        const mergedCodes = this.normalizeConflictCodes([
          ...preservedCodes,
          ...activityHomeDepotCodes,
        ]);

        const baseDetails = this.readConflictDetailsForActivity(
          current,
          ownerId,
        );
        const preservedDetails: ConflictDetails = {};
        Object.entries(baseDetails).forEach(([code, entries]) => {
          if (!isHomeDepotCode(code)) {
            preservedDetails[code] = entries;
          }
        });

        const mergedDetails: ConflictDetails = {};
        this.mergeConflictDetails(mergedDetails, preservedDetails);
        const homeDepotDetails = this.normalizeConflictDetails(
          activityDetails.get(current.id) ?? {},
        );
        this.mergeConflictDetails(mergedDetails, homeDepotDetails);
        const normalizedDetails = this.detailsForCodes(
          this.normalizeConflictDetails(mergedDetails),
          mergedCodes,
        );

        const level = this.conflictLevelForCodes(
          mergedCodes,
          config.maxConflictLevel,
        );
        const next =
          this.isManagedId(current.id) || isBoundary(current)
            ? this.applyDutyMeta(
                current,
                serviceId,
                level,
                mergedCodes,
                conflictKey,
                conflictCodesKey,
                normalizedDetails,
              )
            : this.applyDutyAssignment(
                current,
                ownerId,
                {
                  serviceId,
                  conflictLevel: level,
                  conflictCodes: mergedCodes,
                  conflictDetails: normalizedDetails,
                },
                conflictKey,
                conflictCodesKey,
              );

        if (next !== current) {
          byId.set(next.id, next);
          updated.set(next.id, next);
        }
      }
    }

    return Array.from(updated.values());
  }

  private detectLocalConflicts(
    payloadActivities: Activity[],
    options?: {
      includeCapacity?: boolean;
      includeLocation?: boolean;
      skipMissingLocations?: boolean;
    },
  ): Map<string, Set<string>> {
    const conflicts = new Map<string, Set<string>>();
    const add = (activityId: string, code: string) => {
      let set = conflicts.get(activityId);
      if (!set) {
        set = new Set<string>();
        conflicts.set(activityId, set);
      }
      set.add(code);
    };
    const includeCapacity = options?.includeCapacity !== false;
    const includeLocation = options?.includeLocation !== false;
    const skipMissingLocations = options?.skipMissingLocations !== false;

    const normalized = payloadActivities
      .map((activity) => {
        const startMs = this.parseMs(activity.start);
        if (startMs === null) {
          return null;
        }
        const endMs = this.resolveEndMs(activity, startMs);
        const fromRaw = this.readStartLocation(activity);
        const toRaw = this.readEndLocation(activity);
        return {
          id: activity.id,
          startMs,
          endMs: Math.max(startMs, endMs),
          from: this.normalizeLocation(fromRaw),
          to: this.normalizeLocation(toRaw),
          considerCapacity: this.considerCapacityConflicts(activity),
          considerLocation: this.considerLocationConflicts(activity),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    if (includeCapacity) {
      const capacityCandidates = normalized.filter(
        (entry) => entry.considerCapacity,
      );
      let cluster: typeof capacityCandidates = [];
      let clusterEndMs = Number.NEGATIVE_INFINITY;
      for (const entry of capacityCandidates) {
        if (cluster.length === 0) {
          cluster = [entry];
          clusterEndMs = entry.endMs;
          continue;
        }
        if (entry.startMs < clusterEndMs) {
          cluster.forEach((existing) => add(existing.id, 'CAPACITY_OVERLAP'));
          add(entry.id, 'CAPACITY_OVERLAP');
          cluster.push(entry);
          clusterEndMs = Math.max(clusterEndMs, entry.endMs);
          continue;
        }
        cluster = [entry];
        clusterEndMs = entry.endMs;
      }
    }

    if (includeLocation) {
      const locationCandidates = normalized.filter((entry) => {
        if (!entry.considerLocation) {
          return false;
        }
        if (!skipMissingLocations) {
          return true;
        }
        return !!(entry.from && entry.to);
      });
      for (let i = 0; i < locationCandidates.length - 1; i += 1) {
        const prev = locationCandidates[i];
        const next = locationCandidates[i + 1];
        if (!prev.to || !next.from) {
          continue;
        }
        if (prev.to === next.from) {
          continue;
        }
        add(prev.id, 'LOCATION_SEQUENCE');
        add(next.id, 'LOCATION_SEQUENCE');
      }
    }

    return conflicts;
  }

  private mergeConflictMaps(
    target: Map<string, Set<string>>,
    source: Map<string, Set<string>>,
  ): void {
    source.forEach((codes, activityId) => {
      let set = target.get(activityId);
      if (!set) {
        set = new Set<string>();
        target.set(activityId, set);
      }
      codes.forEach((code) => set.add(code));
    });
  }

  private considerCapacityConflicts(activity: Activity): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['consider_capacity_conflicts'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      return raw.trim().toLowerCase() === 'true';
    }
    return true;
  }

  private considerLocationConflicts(activity: Activity): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['consider_location_conflicts'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      return raw.trim().toLowerCase() === 'true';
    }
    return true;
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
    context: MasterDataContext,
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

  private buildAllowedSiteLookup(
    siteIds: string[] | null | undefined,
    context: MasterDataContext,
  ): { siteIds: Set<string>; opIds: Set<string> } {
    const normalizedSiteIds = new Set(
      (Array.isArray(siteIds) ? siteIds : [])
        .map((id) => `${id ?? ''}`.trim())
        .filter((id) => id.length > 0),
    );
    const opIds = new Set<string>();
    normalizedSiteIds.forEach((siteId) => {
      const site = context.personnelSitesById.get(siteId) ?? null;
      if (!site?.uniqueOpId) {
        return;
      }
      const opId = this.normalizeLocation(site.uniqueOpId);
      if (opId) {
        opIds.add(opId);
      }
    });
    return { siteIds: normalizedSiteIds, opIds };
  }

  private resolvePersonnelSiteId(
    value: string | null | undefined,
    context: MasterDataContext,
  ): string | null {
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      return null;
    }
    if (context.personnelSitesById.has(trimmed)) {
      return trimmed;
    }
    const normalized = this.normalizeLocation(trimmed);
    if (!normalized) {
      return null;
    }
    const idMatches = Array.from(context.personnelSitesById.keys()).filter(
      (siteId) => this.normalizeLocation(siteId) === normalized,
    );
    if (idMatches.length === 1) {
      return idMatches[0];
    }
    const nameMatches = Array.from(context.personnelSitesById.entries()).filter(
      ([, candidate]) => {
        const siteName =
          typeof candidate?.name === 'string' ? candidate.name : '';
        return this.normalizeLocation(siteName) === normalized;
      },
    );
    if (nameMatches.length === 1) {
      return nameMatches[0][0];
    }
    return null;
  }

  private isLocationInAllowedSiteIds(
    location: string | null,
    allowedSiteIds: Set<string>,
    context: MasterDataContext,
  ): boolean {
    const resolved = this.resolvePersonnelSiteId(location, context);
    return !!resolved && allowedSiteIds.has(resolved);
  }

  private resolveDutyOwner(activity: Activity): ActivityParticipant | null {
    return this.resolveDutyOwners(activity)[0] ?? null;
  }

  private resolveDutyOwners(activity: Activity): ActivityParticipant[] {
    const participants = activity.participants ?? [];
    const serviceOwners = participants.filter(
      (p) => p.kind === 'personnel-service' || p.kind === 'vehicle-service',
    );
    if (serviceOwners.length) {
      return serviceOwners;
    }
    const directOwners = participants.filter(
      (p) => p.kind === 'personnel' || p.kind === 'vehicle',
    );
    if (directOwners.length) {
      return directOwners;
    }

    const serviceId =
      this.parseServiceIdFromManagedId(activity.id) ??
      (typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '');
    if (!serviceId) {
      return [];
    }
    const ownerId = this.parseOwnerIdFromServiceId(serviceId);
    if (!ownerId) {
      return [];
    }
    const ownerKind = this.resolveOwnerKindFromSnapshot(ownerId);
    if (!ownerKind) {
      return [];
    }
    return [
      {
        resourceId: ownerId,
        kind: ownerKind,
      },
    ];
  }

  private resolveOwnerKindFromSnapshot(
    ownerId: string,
  ): ActivityParticipant['kind'] | null {
    const snapshot = this.masterData.getResourceSnapshot();
    if (snapshot.personnelServices?.some((svc) => svc.id === ownerId)) {
      return 'personnel-service';
    }
    if (snapshot.vehicleServices?.some((svc) => svc.id === ownerId)) {
      return 'vehicle-service';
    }
    if (snapshot.personnel?.some((person) => person.id === ownerId)) {
      return 'personnel';
    }
    if (snapshot.vehicles?.some((vehicle) => vehicle.id === ownerId)) {
      return 'vehicle';
    }
    return null;
  }

  private resolveServiceRole(
    activity: Activity,
  ): 'start' | 'end' | 'segment' | null {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (val: unknown) =>
      typeof val === 'boolean'
        ? val
        : typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : false;
    const isBreak =
      toBool(attrs?.['is_break']) || toBool(attrs?.['is_short_break']);
    if (isBreak) {
      return null;
    }
    if (activity.serviceRole) {
      return activity.serviceRole as 'start' | 'end' | 'segment';
    }
    if (attrs) {
      if (toBool((attrs as any)['is_service_start'])) {
        return 'start';
      }
      if (toBool((attrs as any)['is_service_end'])) {
        return 'end';
      }
    }
    return null;
  }

  private resolveWithinPreference(
    activity: Activity,
  ): 'within' | 'outside' | 'both' {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const meta = activity.meta;
    const raw =
      attrs && attrs['is_within_service'] !== undefined
        ? attrs['is_within_service']
        : meta?.['is_within_service'];
    if (typeof raw === 'boolean') {
      return raw ? 'within' : 'outside';
    }
    if (typeof raw === 'string') {
      const val = raw.trim().toLowerCase();
      if (val === 'yes' || val === 'true' || val === 'inside' || val === 'in') {
        return 'within';
      }
      if (
        val === 'no' ||
        val === 'false' ||
        val === 'outside' ||
        val === 'out'
      ) {
        return 'outside';
      }
      if (val === 'both') {
        return 'both';
      }
    }
    return 'both';
  }

  private isBreakActivity(activity: Activity, breakTypeIds: string[]): boolean {
    const type = (activity.type ?? '').trim();
    if (type) {
      return breakTypeIds.some((id) => id === type);
    }
    return false;
  }

  private utcDayKey(startIso: string): string {
    const date = new Date(startIso);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private utcDayKeyFromMs(ms: number): string {
    const date = new Date(ms);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private computeServiceId(
    stageId: StageId,
    ownerId: string,
    dayKey: string,
  ): string {
    return `svc:${stageId}:${ownerId}:${dayKey}`;
  }

  private parseDayKeyFromServiceId(serviceId: string): string | null {
    const trimmed = (serviceId ?? '').trim();
    if (!trimmed.startsWith('svc:')) {
      return null;
    }
    const parts = trimmed.split(':');
    if (parts.length < 4) {
      return null;
    }
    const dayKey = parts[parts.length - 1] ?? '';
    return /^\\d{4}-\\d{2}-\\d{2}$/.test(dayKey) ? dayKey : null;
  }

  private parseOwnerIdFromServiceId(serviceId: string): string | null {
    const trimmed = (serviceId ?? '').trim();
    if (!trimmed.startsWith('svc:')) {
      return null;
    }
    const parts = trimmed.split(':');
    if (parts.length < 4) {
      return null;
    }
    const ownerId = parts[2] ?? '';
    return ownerId ? ownerId : null;
  }

  private parseStageIdFromServiceId(serviceId: string): StageId | null {
    const trimmed = (serviceId ?? '').trim();
    if (!trimmed.startsWith('svc:')) {
      return null;
    }
    const parts = trimmed.split(':');
    if (parts.length < 4) {
      return null;
    }
    const candidate = parts[1] ?? '';
    return candidate === 'base' ||
      candidate === 'operations' ||
      candidate === 'dispatch'
      ? (candidate as StageId)
      : null;
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

  private isManagedId(id: string): boolean {
    return (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    );
  }

  private belongsToService(id: string, serviceId: string): boolean {
    return (
      id === `svcstart:${serviceId}` ||
      id === `svcend:${serviceId}` ||
      id.startsWith(`svcbreak:${serviceId}:`) ||
      id.startsWith(`svcshortbreak:${serviceId}:`) ||
      id.startsWith(`svccommute:${serviceId}:`)
    );
  }

  private parseServiceIdFromManagedId(id: string): string | null {
    if (id.startsWith('svcstart:')) {
      return id.slice('svcstart:'.length).trim() || null;
    }
    if (id.startsWith('svcend:')) {
      return id.slice('svcend:'.length).trim() || null;
    }
    if (id.startsWith('svcbreak:')) {
      const rest = id.slice('svcbreak:'.length);
      const idx = rest.lastIndexOf(':');
      const serviceId = idx >= 0 ? rest.slice(0, idx) : rest;
      const trimmed = serviceId.trim();
      return trimmed ? trimmed : null;
    }
    if (id.startsWith('svcshortbreak:')) {
      const rest = id.slice('svcshortbreak:'.length);
      const idx = rest.lastIndexOf(':');
      const serviceId = idx >= 0 ? rest.slice(0, idx) : rest;
      const trimmed = serviceId.trim();
      return trimmed ? trimmed : null;
    }
    if (id.startsWith('svccommute:')) {
      const rest = id.slice('svccommute:'.length);
      const idx = rest.lastIndexOf(':');
      const serviceId = idx >= 0 ? rest.slice(0, idx) : rest;
      const trimmed = serviceId.trim();
      return trimmed ? trimmed : null;
    }
    return null;
  }

  private serviceByOwnerKey(): string {
    return 'service_by_owner';
  }

  private manualBoundaryKey(): string {
    return 'manual_service_boundary';
  }

  private isManualBoundary(activity: Activity, key: string): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.[key];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      return raw.trim().toLowerCase() === 'true';
    }
    return false;
  }

  private cloneOwnerAssignmentMap(value: unknown): Record<string, any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...(value as Record<string, any>) };
    }
    return {};
  }

  private buildMasterDataContext(): MasterDataContext {
    const snapshot = this.masterData.getResourceSnapshot();

    const homeDepotsById = new Map<string, HomeDepot>(
      (snapshot.homeDepots ?? []).map((depot) => [depot.id, depot]),
    );
    const personnelById = new Map<string, Personnel>(
      (snapshot.personnel ?? []).map((p) => [p.id, p]),
    );
    const personnelServicesById = new Map<string, PersonnelService>(
      (snapshot.personnelServices ?? []).map((svc) => [svc.id, svc]),
    );
    const personnelPoolsById = new Map<string, PersonnelPool>(
      (snapshot.personnelPools ?? []).map((pool) => [pool.id, pool]),
    );
    const personnelServicePoolsById = new Map<string, PersonnelServicePool>(
      (snapshot.personnelServicePools ?? []).map((pool) => [pool.id, pool]),
    );

    const personnelSites = this.masterData.listPersonnelSites();
    const personnelSitesById = new Map<string, PersonnelSite>(
      personnelSites.map((site) => [site.siteId, site]),
    );

    const operationalPoints = this.masterData.listOperationalPoints();
    const operationalPointsById = new Map<string, OperationalPoint>(
      operationalPoints.map((point) => [
        `${point.uniqueOpId ?? ''}`.trim().toUpperCase(),
        point,
      ]),
    );

    const transferEdges = this.masterData.listTransferEdges();
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
      homeDepotsById,
      personnelById,
      personnelServicesById,
      personnelPoolsById,
      personnelServicePoolsById,
      personnelSitesById,
      operationalPointsById,
      walkTimeMs,
    };
  }

  private resolveHomeDepotId(
    owner: ActivityParticipant,
    context: MasterDataContext,
  ): string | null {
    if (owner.kind !== 'personnel' && owner.kind !== 'personnel-service') {
      return null;
    }
    const resolveFromPersonnelService = (): string | null => {
      const service = context.personnelServicesById.get(owner.resourceId);
      const poolId = service?.poolId ?? null;
      const pool = poolId
        ? context.personnelServicePoolsById.get(poolId)
        : null;
      return typeof pool?.homeDepotId === 'string' ? pool.homeDepotId : null;
    };
    const resolveFromPersonnel = (): string | null => {
      const personnel = context.personnelById.get(owner.resourceId);
      const poolId = personnel?.poolId ?? null;
      const pool = poolId ? context.personnelPoolsById.get(poolId) : null;
      return typeof pool?.homeDepotId === 'string' ? pool.homeDepotId : null;
    };

    let homeDepotId: string | null = null;
    if (owner.kind === 'personnel-service') {
      homeDepotId = resolveFromPersonnelService();
      if (!homeDepotId) {
        homeDepotId = resolveFromPersonnel();
      }
    } else {
      homeDepotId = resolveFromPersonnel();
      if (!homeDepotId) {
        homeDepotId = resolveFromPersonnelService();
      }
    }

    const trimmedDepotId = `${homeDepotId ?? ''}`.trim();
    return trimmedDepotId.length > 0 ? trimmedDepotId : null;
  }

  private resolveHomeDepot(
    owner: ActivityParticipant,
    context: MasterDataContext,
  ): HomeDepot | null {
    const depotId = this.resolveHomeDepotId(owner, context);
    if (!depotId) {
      return null;
    }
    return context.homeDepotsById.get(depotId) ?? null;
  }

  private resolveHomeDepotSelection(
    owner: ActivityParticipant,
    payloadActivities: Activity[],
    context: MasterDataContext,
  ): {
    selection: HomeDepotSelection | null;
    conflictCodes: string[];
    conflictDetails: ConflictDetails;
  } {
    const conflictCodes: string[] = [];
    const conflictDetails: ConflictDetails = {};

    const depotId = this.resolveHomeDepotId(owner, context);
    if (!depotId) {
      return { selection: null, conflictCodes, conflictDetails };
    }

    const depot = context.homeDepotsById.get(depotId);
    if (!depot) {
      this.appendConflictDetail(
        conflictDetails,
        'HOME_DEPOT_NOT_FOUND',
        `Heimdepot-ID: ${depotId}`,
      );
      return {
        selection: null,
        conflictCodes: ['HOME_DEPOT_NOT_FOUND'],
        conflictDetails,
      };
    }

    const siteIds = Array.from(
      new Set(
        (Array.isArray(depot.siteIds) ? depot.siteIds : [])
          .map((id) => `${id ?? ''}`.trim())
          .filter(Boolean),
      ),
    );
    if (!siteIds.length) {
      return { selection: null, conflictCodes, conflictDetails };
    }

    const candidateSites = siteIds
      .map((siteId) => context.personnelSitesById.get(siteId) ?? null)
      .filter((site): site is PersonnelSite => site !== null);

    if (!candidateSites.length) {
      const missing = siteIds.filter(
        (id) => !context.personnelSitesById.has(id),
      );
      if (missing.length) {
        this.appendConflictDetail(
          conflictDetails,
          'HOME_DEPOT_SITE_NOT_FOUND',
          `Unbekannte Personnel Sites: ${missing.join(', ')}`,
        );
      }
      return {
        selection: null,
        conflictCodes: ['HOME_DEPOT_SITE_NOT_FOUND'],
        conflictDetails,
      };
    }

    const first = this.findFirstActivity(payloadActivities);
    const last = this.findLastActivity(payloadActivities);
    const startCandidate = first ? this.readStartLocation(first) : null;
    const endCandidate = last ? this.readEndLocation(last) : null;

    const startOpId = startCandidate
      ? this.resolveOperationalPointId(startCandidate, context)
      : null;
    const endOpId = endCandidate
      ? this.resolveOperationalPointId(endCandidate, context)
      : null;

    const startOpKey = startOpId ? (`OP:${startOpId}` as const) : null;
    const endOpKey = endOpId ? (`OP:${endOpId}` as const) : null;

    if (!startOpId) {
      conflictCodes.push('HOME_DEPOT_START_LOCATION_MISSING');
      this.appendConflictDetail(
        conflictDetails,
        'HOME_DEPOT_START_LOCATION_MISSING',
        `Erste Leistung: ${first?.id ?? '—'} (Start-Ort=${startCandidate ?? '—'})`,
      );
    }
    if (!endOpId) {
      conflictCodes.push('HOME_DEPOT_END_LOCATION_MISSING');
      this.appendConflictDetail(
        conflictDetails,
        'HOME_DEPOT_END_LOCATION_MISSING',
        `Letzte Leistung: ${last?.id ?? '—'} (End-Ort=${endCandidate ?? '—'})`,
      );
    }

    let best: {
      site: PersonnelSite;
      walkStartMs: number | null;
      walkEndMs: number | null;
      score: number;
    } | null = null;

    const missingPenalty = 1_000_000_000_000;

    for (const site of candidateSites) {
      const siteKey = `PERSONNEL_SITE:${site.siteId}` as const;
      const walkStartMs = startOpKey
        ? this.lookupWalkTimeMs(context, siteKey, startOpKey)
        : null;
      const walkEndMs = endOpKey
        ? this.lookupWalkTimeMs(context, endOpKey, siteKey)
        : null;
      const score =
        (walkStartMs ?? missingPenalty) + (walkEndMs ?? missingPenalty);
      if (!best || score < best.score) {
        best = { site, walkStartMs, walkEndMs, score };
      }
    }

    const selected = best?.site ?? candidateSites[0];
    const selectedSiteKey = `PERSONNEL_SITE:${selected.siteId}` as const;
    const walkStartMs = startOpKey
      ? this.lookupWalkTimeMs(context, selectedSiteKey, startOpKey)
      : null;
    const walkEndMs = endOpKey
      ? this.lookupWalkTimeMs(context, endOpKey, selectedSiteKey)
      : null;

    if (startOpKey && walkStartMs === null) {
      conflictCodes.push('WALK_TIME_MISSING_START');
      this.appendConflictDetail(
        conflictDetails,
        'WALK_TIME_MISSING_START',
        this.formatWalkLink(selected, startOpKey.slice(3), context),
      );
    }
    if (endOpKey && walkEndMs === null) {
      conflictCodes.push('WALK_TIME_MISSING_END');
      this.appendConflictDetail(
        conflictDetails,
        'WALK_TIME_MISSING_END',
        this.formatWalkLink(selected, endOpKey.slice(3), context),
      );
    }

    return {
      selection: {
        depotId,
        depot,
        selectedSite: selected,
        walkStartMs,
        walkEndMs,
      },
      conflictCodes: this.normalizeConflictCodes(conflictCodes),
      conflictDetails: this.normalizeConflictDetails(conflictDetails),
    };
  }

  private transferNodeKey(node: TransferNode): TransferNodeKey | null {
    switch (node.kind) {
      case 'OP': {
        const ref = `${node.uniqueOpId ?? ''}`.trim();
        return ref ? (`OP:${ref.toUpperCase()}` as const) : null;
      }
      case 'PERSONNEL_SITE': {
        const ref = `${(node as any).siteId ?? ''}`.trim();
        return ref ? (`PERSONNEL_SITE:${ref}` as const) : null;
      }
      case 'REPLACEMENT_STOP': {
        const ref = `${(node as any).replacementStopId ?? ''}`.trim();
        return ref ? (`REPLACEMENT_STOP:${ref}` as const) : null;
      }
    }
  }

  private lookupWalkTimeMs(
    context: MasterDataContext,
    from: TransferNodeKey,
    to: TransferNodeKey,
  ): number | null {
    const direct = context.walkTimeMs.get(`${from}|${to}`);
    if (direct !== undefined) {
      return direct;
    }
    const reverse = context.walkTimeMs.get(`${to}|${from}`);
    return reverse !== undefined ? reverse : null;
  }

  private findFirstActivity(activities: Activity[]): Activity | null {
    let best: Activity | null = null;
    let bestStartMs: number | null = null;
    let bestEndMs: number | null = null;

    for (const activity of activities) {
      const startMs = this.parseMs(activity.start);
      if (startMs === null) {
        continue;
      }
      const endMs = this.resolveEndMs(activity, startMs);
      const normalizedEndMs = Math.max(startMs, endMs);
      if (
        best === null ||
        bestStartMs === null ||
        startMs < bestStartMs ||
        (startMs === bestStartMs &&
          bestEndMs !== null &&
          normalizedEndMs < bestEndMs)
      ) {
        best = activity;
        bestStartMs = startMs;
        bestEndMs = normalizedEndMs;
      }
    }

    return best;
  }

  private findLastActivity(activities: Activity[]): Activity | null {
    let best: Activity | null = null;
    let bestEndMs: number | null = null;
    let bestStartMs: number | null = null;

    for (const activity of activities) {
      const startMs = this.parseMs(activity.start);
      if (startMs === null) {
        continue;
      }
      const endMs = this.resolveEndMs(activity, startMs);
      const normalizedEndMs = Math.max(startMs, endMs);
      if (
        best === null ||
        bestEndMs === null ||
        normalizedEndMs > bestEndMs ||
        (normalizedEndMs === bestEndMs &&
          bestStartMs !== null &&
          startMs > bestStartMs)
      ) {
        best = activity;
        bestEndMs = normalizedEndMs;
        bestStartMs = startMs;
      }
    }

    return best;
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

  private normalizeLocationValue(
    value: string | null | undefined,
  ): string | null {
    const normalized = `${value ?? ''}`.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private buildWorkEntries(
    activities: Activity[],
  ): Array<{ activity: Activity; startMs: number; endMs: number }> {
    return activities
      .map((activity) => {
        const startMs = this.parseMs(activity.start);
        if (startMs === null) {
          return null;
        }
        const endMs = this.resolveEndMs(activity, startMs);
        return { activity, startMs, endMs: Math.max(startMs, endMs) };
      })
      .filter(
        (
          entry,
        ): entry is { activity: Activity; startMs: number; endMs: number } =>
          entry !== null,
      )
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  }

  private planPause(options: {
    kind: 'break' | 'short-break';
    depot: HomeDepot;
    gapId: string;
    gapStartMs: number;
    gapEndMs: number;
    fromLocation: string | null;
    toLocation: string | null;
    minBreakMs: number;
    minShortBreakMs: number;
    context: MasterDataContext;
  }): {
    pause: PlannedPause | null;
    conflictCodes: string[];
    conflictDetails: ConflictDetails;
  } {
    const conflictCodes: string[] = [];
    const conflictDetails: ConflictDetails = {};
    const depot = options.depot;
    const allowedSiteIds =
      options.kind === 'short-break'
        ? (depot.shortBreakSiteIds ?? [])
        : (depot.breakSiteIds ?? []);

    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(allowedSiteIds) ? allowedSiteIds : [])
          .map((id) => `${id ?? ''}`.trim())
          .filter(Boolean),
      ),
    );
    if (!normalizedIds.length) {
      conflictCodes.push(
        options.kind === 'short-break'
          ? 'HOME_DEPOT_NO_SHORT_BREAK_SITES'
          : 'HOME_DEPOT_NO_BREAK_SITES',
      );
      return { pause: null, conflictCodes, conflictDetails };
    }

    const fromRaw = `${options.fromLocation ?? ''}`.trim();
    const toRaw = `${options.toLocation ?? ''}`.trim();
    const fromOpId = this.resolveOperationalPointId(fromRaw, options.context);
    const toOpId = this.resolveOperationalPointId(toRaw, options.context);
    const fromKey = fromOpId ? (`OP:${fromOpId}` as const) : null;
    const toKey = toOpId ? (`OP:${toOpId}` as const) : null;
    if (!fromKey || !toKey) {
      conflictCodes.push('HOME_DEPOT_PAUSE_LOCATION_MISSING');
      this.appendConflictDetail(
        conflictDetails,
        'HOME_DEPOT_PAUSE_LOCATION_MISSING',
        `Von: ${fromRaw || '—'} · Nach: ${toRaw || '—'}`,
      );
      return {
        pause: null,
        conflictCodes,
        conflictDetails: this.normalizeConflictDetails(conflictDetails),
      };
    }

    const minPauseMs =
      options.kind === 'short-break'
        ? options.minShortBreakMs
        : options.minBreakMs;
    const gapDurationMs = Math.max(0, options.gapEndMs - options.gapStartMs);
    if (gapDurationMs <= 0) {
      return { pause: null, conflictCodes, conflictDetails };
    }

    let best: {
      site: PersonnelSite;
      commuteInMs: number;
      commuteOutMs: number;
      breakStartMs: number;
      breakEndMs: number;
      score: number;
    } | null = null;

    let sawWalkCandidate = false;
    const missingLinks: string[] = [];

    for (const siteId of normalizedIds) {
      const site = options.context.personnelSitesById.get(siteId) ?? null;
      if (!site) {
        continue;
      }
      const siteKey = `PERSONNEL_SITE:${site.siteId}` as const;
      const commuteInMs = this.lookupWalkTimeMs(
        options.context,
        fromKey,
        siteKey,
      );
      const commuteOutMs = this.lookupWalkTimeMs(
        options.context,
        siteKey,
        toKey,
      );
      if (commuteInMs === null) {
        missingLinks.push(
          this.formatWalkLink(
            site,
            fromOpId ?? fromKey.slice(3),
            options.context,
          ),
        );
      }
      if (commuteOutMs === null) {
        missingLinks.push(
          this.formatWalkLink(site, toOpId ?? toKey.slice(3), options.context),
        );
      }
      if (commuteInMs === null || commuteOutMs === null) {
        continue;
      }
      sawWalkCandidate = true;
      const breakStartMs = options.gapStartMs + commuteInMs;
      const breakEndMs = options.gapEndMs - commuteOutMs;
      const breakDurationMs = Math.max(0, breakEndMs - breakStartMs);
      if (breakDurationMs < minPauseMs) {
        continue;
      }
      const score = commuteInMs + commuteOutMs;
      if (!best || score < best.score) {
        best = {
          site,
          commuteInMs,
          commuteOutMs,
          breakStartMs,
          breakEndMs,
          score,
        };
      }
    }

    if (!best) {
      if (!sawWalkCandidate) {
        const code =
          options.kind === 'short-break'
            ? 'WALK_TIME_MISSING_SHORT_BREAK'
            : 'WALK_TIME_MISSING_BREAK';
        conflictCodes.push(code);
        missingLinks.forEach((detail) =>
          this.appendConflictDetail(conflictDetails, code, detail),
        );
      }
      return {
        pause: null,
        conflictCodes,
        conflictDetails: this.normalizeConflictDetails(conflictDetails),
      };
    }

    return {
      pause: {
        kind: options.kind,
        site: best.site,
        gapId: options.gapId,
        fromLocation: fromOpId ?? fromRaw,
        toLocation: toOpId ?? toRaw,
        commuteInMs: best.commuteInMs,
        commuteOutMs: best.commuteOutMs,
        breakStartMs: best.breakStartMs,
        breakEndMs: best.breakEndMs,
      },
      conflictCodes: [],
      conflictDetails: {},
    };
  }

  private isShortBreakActivity(
    activity: Activity,
    shortBreakTypeId: string,
  ): boolean {
    const type = `${activity.type ?? ''}`.trim();
    if (type) {
      return type === shortBreakTypeId;
    }
    return false;
  }

  private isOvernightActivity(activity: Activity): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['is_overnight'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      return (
        normalized === 'true' ||
        normalized === 'yes' ||
        normalized === '1' ||
        normalized === 'ja'
      );
    }
    return false;
  }

  private buildCommuteActivity(options: {
    id: string;
    title: string;
    type: string;
    startMs: number;
    endMs: number;
    from: string;
    to: string;
    owner: ActivityParticipant;
    serviceId: string;
    conflictKey: string;
    conflictCodesKey: string;
    depotId?: string | null;
    siteId?: string | null;
    siteLabel?: string | null;
  }): Activity {
    const attrs: ActivityAttributes = {
      ...(options.conflictKey ? { [options.conflictKey]: 0 } : {}),
      ...(options.conflictCodesKey ? { [options.conflictCodesKey]: [] } : {}),
      is_commute: true,
      ...(options.depotId ? { home_depot_id: options.depotId } : {}),
      ...(options.siteId ? { home_depot_site_id: options.siteId } : {}),
    };
    return {
      id: options.id,
      title: options.title,
      start: new Date(options.startMs).toISOString(),
      end: new Date(options.endMs).toISOString(),
      type: options.type,
      from: options.from,
      to: options.to,
      serviceId: options.serviceId,
      participants: [this.buildOwnerParticipant(options.owner)],
      attributes: attrs,
    };
  }

  private applyAzgCompliance(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
    config: ResolvedDutyAutopilotConfig,
  ): Activity[] {
    if (!config.azg?.enabled) {
      return [];
    }

    const conflictKey = config.conflictAttributeKey;
    const conflictCodesKey = config.conflictCodesAttributeKey;
    const breakTypeIds = config.breakTypeIds;
    const shortBreakTypeId = config.shortBreakTypeId;
    const isShortBreak = (activity: Activity) =>
      this.isShortBreakActivity(activity, shortBreakTypeId);
    const isRegularBreak = (activity: Activity) =>
      this.isBreakActivity(activity, breakTypeIds) && !isShortBreak(activity);
    const dayMs = 86_400_000;
    const intervalMinutes = (interval: { startMs: number; endMs: number }) =>
      Math.round(Math.max(0, interval.endMs - interval.startMs) / 60_000);
    const resolveWorkHalfMs = (
      segments: Array<{ startMs: number; endMs: number }>,
    ): number | null => {
      if (!segments.length) {
        return null;
      }
      const totalMs = segments.reduce(
        (sum, seg) => sum + Math.max(0, seg.endMs - seg.startMs),
        0,
      );
      if (totalMs <= 0) {
        return null;
      }
      let remaining = totalMs / 2;
      for (const seg of segments) {
        const segMs = Math.max(0, seg.endMs - seg.startMs);
        if (remaining <= segMs) {
          return seg.startMs + remaining;
        }
        remaining -= segMs;
      }
      return segments[segments.length - 1]?.endMs ?? null;
    };

    const byId = new Map<string, Activity>(
      activities.map((activity) => [activity.id, activity]),
    );
    const updated = new Map<string, Activity>();

    const boundaryTypeIds = config.resolvedTypeIds.boundaryTypeIds;
    const startTypeIds = config.resolvedTypeIds.startTypeIds;
    const endTypeIds = config.resolvedTypeIds.endTypeIds;
    const isBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return (
        role === 'start' ||
        role === 'end' ||
        boundaryTypeIds.has((activity.type ?? '').trim())
      );
    };
    const isStartBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'start' || startTypeIds.has((activity.type ?? '').trim());
    };
    const isEndBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return role === 'end' || endTypeIds.has((activity.type ?? '').trim());
    };

    const groups = this.buildComplianceGrouping(
      stageId,
      activities,
      config,
    ).groups.filter(
      (group) =>
        group.owner.kind === 'personnel' ||
        group.owner.kind === 'personnel-service',
    );
    if (!groups.length) {
      return [];
    }

    const dutySnapshots: AzgDutySnapshot[] = [];

    for (const group of groups) {
      const serviceId = group.serviceId;
      const ownerId = group.owner.resourceId;
      const dayKey = group.dayKey;
      const dayStartMs = this.utcDayStartMsFromDayKey(dayKey);
      if (dayStartMs === null) {
        continue;
      }

      const groupActivities = group.activities.map(
        (activity) => byId.get(activity.id) ?? activity,
      );
      const startBoundary =
        groupActivities.find((a) => a.id === `svcstart:${serviceId}`) ??
        groupActivities.find((a) => isStartBoundary(a)) ??
        null;
      const endBoundary =
        groupActivities.find((a) => a.id === `svcend:${serviceId}`) ??
        groupActivities.find((a) => isEndBoundary(a)) ??
        null;

      const fallbackIntervals = this.sortedIntervals(
        groupActivities.filter(
          (activity) => !isRegularBreak(activity) && !isBoundary(activity),
        ),
      );
      const dutyStartMs =
        this.parseMs(startBoundary?.start ?? null) ??
        fallbackIntervals.minStartMs;
      const boundaryEndStartMs = endBoundary
        ? this.parseMs(endBoundary.start ?? null)
        : null;
      const dutyEndMs =
        boundaryEndStartMs !== null && endBoundary
          ? Math.max(
              boundaryEndStartMs,
              this.resolveEndMs(endBoundary, boundaryEndStartMs),
            )
          : fallbackIntervals.maxEndMs;

      if (
        !Number.isFinite(dutyStartMs) ||
        !Number.isFinite(dutyEndMs) ||
        dutyEndMs <= dutyStartMs
      ) {
        continue;
      }

      const startActivityId =
        startBoundary?.id ?? this.findFirstActivity(groupActivities)?.id ?? null;
      const endActivityId =
        endBoundary?.id ?? this.findLastActivity(groupActivities)?.id ?? null;
      const primaryActivityId =
        groupActivities.find(
          (activity) =>
            !isBoundary(activity) &&
            !isRegularBreak(activity) &&
            !isShortBreak(activity),
        )?.id ??
        startActivityId ??
        endActivityId;

      const breakActivities = groupActivities
        .filter((activity) => isRegularBreak(activity))
        .map((activity) => {
          const start = this.parseMs(activity.start);
          const end = this.parseMs(activity.end ?? null);
          if (start === null || end === null) {
            return null;
          }
          const clampedStartMs = Math.max(dutyStartMs, start);
          const clampedEndMs = Math.min(dutyEndMs, Math.max(start, end));
          if (clampedEndMs <= clampedStartMs) {
            return null;
          }
          return { id: activity.id, startMs: clampedStartMs, endMs: clampedEndMs };
        })
        .filter(
          (
            interval,
          ): interval is { id: string; startMs: number; endMs: number } =>
            interval !== null,
        )
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

      const shortBreakActivities = groupActivities
        .filter((activity) => isShortBreak(activity))
        .map((activity) => {
          const start = this.parseMs(activity.start);
          const end = this.parseMs(activity.end ?? null);
          if (start === null || end === null) {
            return null;
          }
          const clampedStartMs = Math.max(dutyStartMs, start);
          const clampedEndMs = Math.min(dutyEndMs, Math.max(start, end));
          if (clampedEndMs <= clampedStartMs) {
            return null;
          }
          return { id: activity.id, startMs: clampedStartMs, endMs: clampedEndMs };
        })
        .filter(
          (
            interval,
          ): interval is { id: string; startMs: number; endMs: number } =>
            interval !== null,
        )
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

      const breaks = breakActivities.map(({ startMs, endMs }) => ({
        startMs,
        endMs,
      }));
      const shortBreaks = shortBreakActivities.map(({ startMs, endMs }) => ({
        startMs,
        endMs,
      }));

      const normalizedBreaks = this.mergeIntervals(breaks);
      const normalizedShortBreaks = this.mergeIntervals(shortBreaks);
      const workSegments = this.subtractIntervals(
        { startMs: dutyStartMs, endMs: dutyEndMs },
        normalizedBreaks,
      );
      const workMinutes = Math.round(
        workSegments.reduce(
          (sum, seg) => sum + Math.max(0, seg.endMs - seg.startMs),
          0,
        ) / 60_000,
      );
      const workHalfMs = resolveWorkHalfMs(workSegments);

      dutySnapshots.push({
        serviceId,
        ownerId,
        ownerKind: group.owner.kind,
        startMs: dutyStartMs,
        endMs: dutyEndMs,
        dayKey,
        dayStartMs,
        dutySpanMinutes: Math.round((dutyEndMs - dutyStartMs) / 60_000),
        workMinutes,
        startActivityId,
        endActivityId,
        breakIntervals: normalizedBreaks,
        breakActivities,
        shortBreakIntervals: normalizedShortBreaks,
        shortBreakActivities,
        workHalfMs,
        activityIds: groupActivities.map((activity) => activity.id),
        hasNightWork: this.intervalsOverlapDailyWindow(workSegments, 0, 4),
        primaryActivityId,
      });
    }

    if (!dutySnapshots.length) {
      return [];
    }

    const byOwner = new Map<string, AzgDutySnapshot[]>();
    for (const duty of dutySnapshots) {
      const bucket = byOwner.get(duty.ownerId);
      if (bucket) {
        bucket.push(duty);
      } else {
        byOwner.set(duty.ownerId, [duty]);
      }
    }

    const azgCodesByActivity = new Map<string, Set<string>>();
    const addActivityCode = (
      activityId: string | null | undefined,
      code: string,
    ) => {
      if (!activityId) {
        return;
      }
      let set = azgCodesByActivity.get(activityId);
      if (!set) {
        set = new Set<string>();
        azgCodesByActivity.set(activityId, set);
      }
      set.add(code);
    };
    const addBoundaryCode = (duty: AzgDutySnapshot, code: string) => {
      addActivityCode(duty.startActivityId, code);
      addActivityCode(duty.endActivityId, code);
      addActivityCode(duty.primaryActivityId, code);
    };
    const addBreakCodes = (
      activities: Array<{ id: string }>,
      code: string,
    ) => {
      activities.forEach((activity) => addActivityCode(activity.id, code));
    };
    const filterDutiesByKinds = (
      duties: AzgDutySnapshot[],
      kinds: ActivityParticipant['kind'][] | null | undefined,
    ): AzgDutySnapshot[] => {
      if (!kinds || kinds.length === 0) {
        return duties;
      }
      return duties.filter((duty) => kinds.includes(duty.ownerKind));
    };
    const buildRestGaps = (sortedByStart: AzgDutySnapshot[]) =>
      sortedByStart
        .map((duty, index) => {
          const next = sortedByStart[index + 1];
          if (!next) {
            return null;
          }
          const minutes = Math.round((next.startMs - duty.endMs) / 60_000);
          return { prev: duty, next, nextStartMs: next.startMs, minutes };
        })
        .filter(
          (
            entry,
          ): entry is {
            prev: AzgDutySnapshot;
            next: AzgDutySnapshot;
            nextStartMs: number;
            minutes: number;
          } => entry !== null,
        );

    const breakMinMinutes = Math.max(0, config.minBreakMinutes);
    const standardBreakMinMinutes = config.azg.breakStandard.enabled
      ? Math.max(
          breakMinMinutes,
          Math.max(0, config.azg.breakStandard.minMinutes),
        )
      : breakMinMinutes;
    const interruptionMinMinutes = config.azg.breakInterruption.enabled
      ? Math.max(
          Math.max(0, config.minShortBreakMinutes),
          Math.max(0, config.azg.breakInterruption.minMinutes),
        )
      : Math.max(0, config.minShortBreakMinutes);
    const interruptionMaxDutyMinutes = Math.max(
      0,
      config.azg.breakInterruption.maxDutyMinutes,
    );
    const interruptionMaxWorkMinutes = Math.max(
      0,
      config.azg.breakInterruption.maxWorkMinutes,
    );
    const midpointToleranceMinutes = Math.max(
      0,
      config.azg.breakMidpoint.toleranceMinutes,
    );
    const maxWorkMinutes = Math.max(0, config.maxWorkMinutes);
    const maxDutySpanMinutes = Math.max(0, config.maxDutySpanMinutes);
    const maxContinuousMinutes = Math.max(0, config.maxContinuousWorkMinutes);

    for (const duty of dutySnapshots) {
      const hasRegularBreak = duty.breakIntervals.length > 0;
      const validRegularBreaks = duty.breakIntervals.filter(
        (brk) => intervalMinutes(brk) >= breakMinMinutes,
      );
      const validStandardBreaks = duty.breakIntervals.filter(
        (brk) => intervalMinutes(brk) >= standardBreakMinMinutes,
      );
      const interruptionAllowed =
        config.azg.breakInterruption.enabled &&
        interruptionMaxDutyMinutes > 0 &&
        duty.dutySpanMinutes <= interruptionMaxDutyMinutes &&
        (interruptionMaxWorkMinutes <= 0 ||
          duty.workMinutes <= interruptionMaxWorkMinutes);
      const standardBreakRequired =
        config.azg.breakStandard.enabled &&
        (interruptionMaxWorkMinutes <= 0 ||
          duty.workMinutes > interruptionMaxWorkMinutes);
      const validInterruptionBreaks = interruptionAllowed
        ? duty.shortBreakIntervals.filter(
            (brk) => intervalMinutes(brk) >= interruptionMinMinutes,
          )
        : [];
      const breakRequired =
        maxContinuousMinutes > 0 && duty.workMinutes > maxContinuousMinutes;

      if (maxDutySpanMinutes > 0 && duty.dutySpanMinutes > maxDutySpanMinutes) {
        addBoundaryCode(duty, 'MAX_DUTY_SPAN');
      }
      if (maxWorkMinutes > 0 && duty.workMinutes > maxWorkMinutes) {
        addBoundaryCode(duty, 'MAX_WORK');
      }
      if (maxContinuousMinutes > 0) {
        const validShortBreaksForContinuous = duty.shortBreakIntervals.filter(
          (brk) => intervalMinutes(brk) >= interruptionMinMinutes,
        );
        const continuousInterruptions = this.mergeIntervals([
          ...validRegularBreaks,
          ...validShortBreaksForContinuous,
        ]);
        const maxContinuousObservedMs = this.computeMaxContinuousMs(
          duty.startMs,
          duty.endMs,
          continuousInterruptions,
        );
        const maxContinuousObservedMinutes = Math.round(
          maxContinuousObservedMs / 60_000,
        );
        if (maxContinuousObservedMinutes > maxContinuousMinutes) {
          addBoundaryCode(duty, 'MAX_CONTINUOUS');
        }
        if (
          !continuousInterruptions.length &&
          duty.workMinutes > maxContinuousMinutes
        ) {
          addBoundaryCode(duty, 'NO_BREAK_WINDOW');
        }
      }
      if (
        config.azg.breakMaxCount.enabled &&
        duty.breakIntervals.length > config.azg.breakMaxCount.maxCount
      ) {
        const extras = duty.breakActivities.slice(
          config.azg.breakMaxCount.maxCount,
        );
        addBreakCodes(extras, 'AZG_BREAK_MAX_COUNT');
      }
      if (
        duty.breakIntervals.some(
          (brk) => intervalMinutes(brk) < breakMinMinutes,
        )
      ) {
        const tooShort = duty.breakActivities.filter(
          (brk) => intervalMinutes(brk) < breakMinMinutes,
        );
        addBreakCodes(tooShort, 'AZG_BREAK_TOO_SHORT');
      }
      if (breakRequired) {
        if (!hasRegularBreak && !interruptionAllowed) {
          addBoundaryCode(duty, 'AZG_BREAK_REQUIRED');
        } else if (
          !hasRegularBreak &&
          interruptionAllowed &&
          validInterruptionBreaks.length === 0
        ) {
          addBoundaryCode(duty, 'AZG_BREAK_REQUIRED');
        } else if (
          standardBreakRequired &&
          hasRegularBreak &&
          validStandardBreaks.length === 0
        ) {
          const tooShort = duty.breakActivities.filter(
            (brk) => intervalMinutes(brk) < standardBreakMinMinutes,
          );
          addBreakCodes(tooShort, 'AZG_BREAK_STANDARD_MIN');
          addBoundaryCode(duty, 'AZG_BREAK_STANDARD_MIN');
        }
        if (config.azg.breakMidpoint.enabled && duty.workHalfMs !== null) {
          const isLongDuty =
            interruptionMaxDutyMinutes > 0 &&
            duty.dutySpanMinutes > interruptionMaxDutyMinutes;
          if (isLongDuty) {
            let midpointBreaks: Array<{ startMs: number; endMs: number }> = [];
            if (hasRegularBreak) {
              midpointBreaks = validRegularBreaks;
            } else if (validInterruptionBreaks.length) {
              midpointBreaks = validInterruptionBreaks;
            }
            if (midpointBreaks.length) {
              const windowStart =
                duty.workHalfMs - midpointToleranceMinutes * 60_000;
              const windowEnd =
                duty.workHalfMs + midpointToleranceMinutes * 60_000;
              const hitsMidpoint = midpointBreaks.some(
                (brk) => brk.endMs > windowStart && brk.startMs < windowEnd,
              );
              if (!hitsMidpoint) {
                addBoundaryCode(duty, 'AZG_BREAK_MIDPOINT');
              }
            }
          }
        }
      }
      if (
        config.azg.breakForbiddenNight.enabled &&
        this.intervalsOverlapDailyWindow(
          duty.breakIntervals,
          config.azg.breakForbiddenNight.startHour,
          config.azg.breakForbiddenNight.endHour,
        )
      ) {
        const forbidden = duty.breakActivities.filter((brk) =>
          this.intervalsOverlapDailyWindow(
            [{ startMs: brk.startMs, endMs: brk.endMs }],
            config.azg.breakForbiddenNight.startHour,
            config.azg.breakForbiddenNight.endHour,
          ),
        );
        addBreakCodes(forbidden, 'AZG_BREAK_FORBIDDEN_NIGHT');
      }

      const bufferMinutes = Math.max(0, config.azg.exceedBufferMinutes);
      if (bufferMinutes > 0) {
        if (duty.workMinutes > config.maxWorkMinutes + bufferMinutes) {
          addBoundaryCode(duty, 'AZG_WORK_EXCEED_BUFFER');
        }
        if (duty.dutySpanMinutes > config.maxDutySpanMinutes + bufferMinutes) {
          addBoundaryCode(duty, 'AZG_DUTY_SPAN_EXCEED_BUFFER');
        }
      }
    }

    for (const duties of byOwner.values()) {
      const sortedByDay = duties
        .slice()
        .sort((a, b) => a.dayStartMs - b.dayStartMs || a.startMs - b.startMs);
      const sortedByStart = duties
        .slice()
        .sort((a, b) => a.startMs - b.startMs);

      if (config.azg.workAvg7d.enabled) {
        const candidates = filterDutiesByKinds(
          sortedByDay,
          config.azg.workAvg7d.resourceKinds,
        );
        if (candidates.length) {
          const window = Math.max(1, config.azg.workAvg7d.windowWorkdays);
          const maxAvg = config.azg.workAvg7d.maxAverageMinutes;
          let streak: AzgDutySnapshot[] = [];
          const flush = () => {
            if (streak.length < window) {
              streak = [];
              return;
            }
            let sum = 0;
            for (let i = 0; i < streak.length; i += 1) {
              sum += streak[i].workMinutes;
              if (i >= window) {
                sum -= streak[i - window].workMinutes;
              }
              if (i + 1 >= window) {
                const avg = sum / window;
                if (avg > maxAvg) {
                  for (let j = i - window + 1; j <= i; j += 1) {
                    addBoundaryCode(streak[j], 'AZG_WORK_AVG_7D');
                  }
                }
              }
            }
            streak = [];
          };

          for (const duty of candidates) {
            const prev = streak[streak.length - 1];
            if (!prev) {
              streak.push(duty);
              continue;
            }
            if (duty.dayStartMs - prev.dayStartMs === dayMs) {
              streak.push(duty);
            } else {
              flush();
              streak.push(duty);
            }
          }
          flush();
        }
      }

      if (config.azg.workAvg365d.enabled) {
        const candidates = filterDutiesByKinds(
          sortedByDay,
          config.azg.workAvg365d.resourceKinds,
        );
        if (candidates.length) {
          const workdayCount = new Set(candidates.map((d) => d.dayStartMs))
            .size;
          const totalWork = candidates.reduce(
            (sum, d) => sum + d.workMinutes,
            0,
          );
          const avg = workdayCount > 0 ? totalWork / workdayCount : 0;
          if (avg > config.azg.workAvg365d.maxAverageMinutes) {
            candidates.forEach((duty) =>
              addBoundaryCode(duty, 'AZG_WORK_AVG_365D'),
            );
          }
        }
      }

      if (config.azg.dutySpanAvg28d.enabled) {
        const candidates = filterDutiesByKinds(
          sortedByDay,
          config.azg.dutySpanAvg28d.resourceKinds,
        );
        if (candidates.length) {
          const windowMs =
            Math.max(1, config.azg.dutySpanAvg28d.windowDays) * dayMs;
          const maxAvg = config.azg.dutySpanAvg28d.maxAverageMinutes;
          let start = 0;
          let sum = 0;
          for (let end = 0; end < candidates.length; end += 1) {
            sum += candidates[end].dutySpanMinutes;
            while (
              candidates[end].dayStartMs - candidates[start].dayStartMs >=
              windowMs
            ) {
              sum -= candidates[start].dutySpanMinutes;
              start += 1;
            }
            const count = end - start + 1;
            if (!count) {
              continue;
            }
            const avg = sum / count;
            if (avg > maxAvg) {
              for (let i = start; i <= end; i += 1) {
                addBoundaryCode(candidates[i], 'AZG_DUTY_SPAN_AVG_28D');
              }
            }
          }
        }
      }

      if (config.azg.restMin.enabled) {
        const candidates = filterDutiesByKinds(
          sortedByStart,
          config.azg.restMin.resourceKinds,
        );
        const restGaps = buildRestGaps(candidates);
        if (restGaps.length) {
          const minMinutes = config.azg.restMin.minMinutes;
          for (const gap of restGaps) {
            if (gap.minutes < minMinutes) {
              addBoundaryCode(gap.prev, 'AZG_REST_MIN');
              addBoundaryCode(gap.next, 'AZG_REST_MIN');
            }
          }
        }
      }

      if (config.azg.restAvg28d.enabled) {
        const candidates = filterDutiesByKinds(
          sortedByStart,
          config.azg.restAvg28d.resourceKinds,
        );
        const restGaps = buildRestGaps(candidates);
        if (restGaps.length) {
          const windowMs =
            Math.max(1, config.azg.restAvg28d.windowDays) * dayMs;
          const minAvg = config.azg.restAvg28d.minAverageMinutes;
          let start = 0;
          let sum = 0;
          for (let end = 0; end < restGaps.length; end += 1) {
            sum += restGaps[end].minutes;
            while (
              restGaps[end].nextStartMs - restGaps[start].nextStartMs >=
              windowMs
            ) {
              sum -= restGaps[start].minutes;
              start += 1;
            }
            const count = end - start + 1;
            if (!count) {
              continue;
            }
            const avg = sum / count;
            if (avg < minAvg) {
              for (let i = start; i <= end; i += 1) {
                addBoundaryCode(restGaps[i].prev, 'AZG_REST_AVG_28D');
                addBoundaryCode(restGaps[i].next, 'AZG_REST_AVG_28D');
              }
            }
          }
        }
      }

      if (config.azg.nightMaxStreak.enabled) {
        const candidates = filterDutiesByKinds(
          sortedByDay,
          config.azg.nightMaxStreak.resourceKinds,
        );
        if (candidates.length) {
          const maxConsecutive = config.azg.nightMaxStreak.maxConsecutive;
          let streak: AzgDutySnapshot[] = [];
          const flush = () => {
            if (streak.length > maxConsecutive) {
              streak.forEach((duty) =>
                addBoundaryCode(duty, 'AZG_NIGHT_STREAK_MAX'),
              );
            }
            streak = [];
          };

          for (const duty of candidates) {
            if (!duty.hasNightWork) {
              flush();
              continue;
            }
            const prev = streak[streak.length - 1];
            if (!prev) {
              streak.push(duty);
              continue;
            }
            if (duty.dayStartMs - prev.dayStartMs === dayMs) {
              streak.push(duty);
            } else {
              flush();
              streak.push(duty);
            }
          }
          flush();
        }
      }

      if (config.azg.nightMax28d.enabled) {
        const candidates = filterDutiesByKinds(
          sortedByDay,
          config.azg.nightMax28d.resourceKinds,
        );
        if (candidates.length) {
          const windowMs =
            Math.max(1, config.azg.nightMax28d.windowDays) * dayMs;
          const maxCount = config.azg.nightMax28d.maxCount;
          let start = 0;
          let nightCount = 0;
          for (let end = 0; end < candidates.length; end += 1) {
            if (candidates[end].hasNightWork) {
              nightCount += 1;
            }
            while (
              candidates[end].dayStartMs - candidates[start].dayStartMs >=
              windowMs
            ) {
              if (candidates[start].hasNightWork) {
                nightCount -= 1;
              }
              start += 1;
            }
            if (nightCount > maxCount) {
              for (let i = start; i <= end; i += 1) {
                if (candidates[i].hasNightWork) {
                  addBoundaryCode(candidates[i], 'AZG_NIGHT_28D_MAX');
                }
              }
            }
          }
        }
      }
    }

    if (config.azg.restDaysYear.enabled) {
      const bounds = this.computeTimetableYearBoundsFromVariantId(variantId);
      if (bounds) {
        const absencesByOwner = this.collectAbsenceIntervals(activities);
        const sundayLikeDates = this.computeSundayLikeDates(
          bounds.startMs,
          bounds.endMs,
          config.azg.restDaysYear.additionalSundayLikeHolidays,
        );

        for (const [ownerId, duties] of byOwner.entries()) {
          const candidates = filterDutiesByKinds(
            duties,
            config.azg.restDaysYear.resourceKinds,
          );
          if (!candidates.length) {
            continue;
          }
          const dayCount = Math.ceil(
            (bounds.endMs - bounds.startMs + 1) / dayMs,
          );
          const workDays = new Array<boolean>(dayCount).fill(false);
          const absenceDays = new Array<boolean>(dayCount).fill(false);

          candidates.forEach((duty) => {
            this.markDaysOverlap(
              workDays,
              bounds.startMs,
              bounds.endMs,
              duty.startMs,
              duty.endMs,
            );
          });

          (absencesByOwner.get(ownerId) ?? []).forEach((interval) => {
            this.markDaysOverlap(
              absenceDays,
              bounds.startMs,
              bounds.endMs,
              interval.startMs,
              interval.endMs,
            );
          });

          let restDays = 0;
          let sundayRestDays = 0;
          for (let i = 0; i < dayCount; i += 1) {
            if (workDays[i] || absenceDays[i]) {
              continue;
            }
            restDays += 1;
            const dayStart = bounds.startMs + i * dayMs;
            const dayKey = this.utcDayKeyFromMs(dayStart);
            const date = new Date(dayStart);
            if (date.getUTCDay() === 0 || sundayLikeDates.has(dayKey)) {
              sundayRestDays += 1;
            }
          }

          if (restDays < config.azg.restDaysYear.minRestDays) {
            candidates.forEach((duty) =>
              addBoundaryCode(duty, 'AZG_REST_DAYS_YEAR_MIN'),
            );
          }
          if (sundayRestDays < config.azg.restDaysYear.minSundayRestDays) {
            candidates.forEach((duty) =>
              addBoundaryCode(duty, 'AZG_REST_SUNDAYS_YEAR_MIN'),
            );
          }
        }
      }
    }

    const baseWorktimeCodes = new Set([
      'MAX_DUTY_SPAN',
      'MAX_WORK',
      'MAX_CONTINUOUS',
      'NO_BREAK_WINDOW',
    ]);

    for (const group of groups) {
      const ownerId = group.owner.resourceId;
      const serviceId = group.serviceId;

      for (const groupActivity of group.activities) {
        const current = byId.get(groupActivity.id) ?? groupActivity;
        const desiredWorktimeCodes = this.normalizeConflictCodes(
          Array.from(azgCodesByActivity.get(current.id) ?? []),
        );
        const baseCodes = this.readConflictCodesForActivity(
          current,
          ownerId,
          conflictCodesKey,
        );
        const filtered = baseCodes.filter(
          (code) => !code.startsWith('AZG_') && !baseWorktimeCodes.has(code),
        );
        const merged = this.normalizeConflictCodes([
          ...filtered,
          ...desiredWorktimeCodes,
        ]);
        const level = this.conflictLevelForCodes(
          merged,
          config.maxConflictLevel,
        );

        const next =
          this.isManagedId(current.id) || isBoundary(current)
            ? this.applyDutyMeta(
                current,
                serviceId,
                level,
                merged,
                conflictKey,
                conflictCodesKey,
              )
            : this.applyDutyAssignment(
                current,
                ownerId,
                { serviceId, conflictLevel: level, conflictCodes: merged },
                conflictKey,
                conflictCodesKey,
              );

        if (next !== current) {
          byId.set(next.id, next);
          updated.set(next.id, next);
        }
      }
    }

    return Array.from(updated.values());
  }

  private readConflictCodesForActivity(
    activity: Activity,
    ownerId: string,
    conflictCodesKey: string,
  ): string[] {
    const attrs = (activity.attributes ?? {}) as Record<string, any>;
    const map = attrs[this.serviceByOwnerKey()];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const entry = (map as Record<string, any>)[ownerId];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const raw = entry.conflictCodes;
        if (Array.isArray(raw)) {
          return raw
            .map((code) => `${code ?? ''}`.trim())
            .filter((code) => code.length > 0);
        }
      }
    }
    const raw = attrs[conflictCodesKey];
    if (Array.isArray(raw)) {
      return raw
        .map((code) => `${code ?? ''}`.trim())
        .filter((code) => code.length > 0);
    }
    return [];
  }

  private readConflictDetailsForActivity(
    activity: Activity,
    ownerId: string,
  ): ConflictDetails {
    const attrs = (activity.attributes ?? {}) as Record<string, any>;
    const map = attrs[this.serviceByOwnerKey()];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const entry = (map as Record<string, any>)[ownerId];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const raw = (entry as Record<string, unknown>).conflictDetails;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          return this.normalizeConflictDetails(raw);
        }
      }
    }
    const raw = attrs[this.conflictDetailsKey()];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return this.normalizeConflictDetails(raw);
    }
    return {};
  }

  private utcDayStartMsFromDayKey(dayKey: string): number | null {
    const trimmed = (dayKey ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return null;
    }
    const ms = Date.parse(`${trimmed}T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  private mergeIntervals(
    intervals: Array<{ startMs: number; endMs: number }>,
  ): Array<{ startMs: number; endMs: number }> {
    if (intervals.length <= 1) {
      return intervals.slice();
    }
    const sorted = intervals
      .slice()
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const merged: Array<{ startMs: number; endMs: number }> = [];
    for (const interval of sorted) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ ...interval });
        continue;
      }
      if (interval.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, interval.endMs);
        continue;
      }
      merged.push({ ...interval });
    }
    return merged;
  }

  private subtractIntervals(
    outer: { startMs: number; endMs: number },
    holes: Array<{ startMs: number; endMs: number }>,
  ): Array<{ startMs: number; endMs: number }> {
    const segments: Array<{ startMs: number; endMs: number }> = [];
    let cursor = outer.startMs;
    for (const hole of holes) {
      const start = Math.max(outer.startMs, hole.startMs);
      const end = Math.min(outer.endMs, hole.endMs);
      if (end <= cursor) {
        cursor = Math.max(cursor, end);
        continue;
      }
      if (start > cursor) {
        segments.push({ startMs: cursor, endMs: start });
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < outer.endMs) {
      segments.push({ startMs: cursor, endMs: outer.endMs });
    }
    return segments.filter((seg) => seg.endMs > seg.startMs);
  }

  private intervalsOverlapDailyWindow(
    intervals: Array<{ startMs: number; endMs: number }>,
    startHour: number,
    endHour: number,
  ): boolean {
    return intervals.some((interval) =>
      this.intervalOverlapsDailyWindow(
        interval.startMs,
        interval.endMs,
        startHour,
        endHour,
      ),
    );
  }

  private intervalOverlapsDailyWindow(
    startMs: number,
    endMs: number,
    startHour: number,
    endHour: number,
  ): boolean {
    const dayMs = 86_400_000;
    const normalizedStartHour = ((startHour % 24) + 24) % 24;
    const normalizedEndHour = ((endHour % 24) + 24) % 24;
    const dayStartBase = this.utcDayStartMs(startMs);
    const lastDayStart = this.utcDayStartMs(endMs);
    for (
      let dayStart = dayStartBase - dayMs;
      dayStart <= lastDayStart;
      dayStart += dayMs
    ) {
      if (normalizedStartHour <= normalizedEndHour) {
        const windowStart = dayStart + normalizedStartHour * 3_600_000;
        const windowEnd = dayStart + normalizedEndHour * 3_600_000;
        if (this.intervalsOverlap(startMs, endMs, windowStart, windowEnd)) {
          return true;
        }
      } else {
        const windowStart1 = dayStart + normalizedStartHour * 3_600_000;
        const windowEnd1 = dayStart + dayMs;
        const windowStart2 = dayStart;
        const windowEnd2 = dayStart + normalizedEndHour * 3_600_000;
        if (
          this.intervalsOverlap(startMs, endMs, windowStart1, windowEnd1) ||
          this.intervalsOverlap(startMs, endMs, windowStart2, windowEnd2)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private intervalsOverlap(
    startA: number,
    endA: number,
    startB: number,
    endB: number,
  ): boolean {
    const start = Math.max(startA, startB);
    const end = Math.min(endA, endB);
    return start < end;
  }

  private utcDayStartMs(ms: number): number {
    const date = new Date(ms);
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    );
  }

  private computeTimetableYearBoundsFromVariantId(
    variantId: string,
  ): { startMs: number; endMs: number } | null {
    const label = deriveTimetableYearLabelFromVariantId(variantId);
    if (!label) {
      return null;
    }
    return this.computeTimetableYearBounds(label);
  }

  private computeTimetableYearBounds(
    label: string,
  ): { startMs: number; endMs: number } | null {
    const trimmed = label.trim();
    const match = /^(\\d{4})(?:[/-](\\d{2}))?$/.exec(trimmed);
    if (!match) {
      return null;
    }
    const startYear = Number.parseInt(match[1], 10);
    if (!Number.isFinite(startYear)) {
      return null;
    }
    const start = this.buildYearStartMs(startYear);
    const end = this.buildYearStartMs(startYear + 1) - 1;
    return { startMs: start, endMs: end };
  }

  private buildYearStartMs(decemberYear: number): number {
    const date = new Date(Date.UTC(decemberYear, 11, 10, 0, 0, 0, 0));
    while (date.getUTCDay() !== 0) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return date.getTime();
  }

  private collectAbsenceIntervals(
    activities: Activity[],
  ): Map<string, Array<{ startMs: number; endMs: number }>> {
    const result = new Map<string, Array<{ startMs: number; endMs: number }>>();
    for (const activity of activities) {
      if (!this.isAbsenceActivity(activity)) {
        continue;
      }
      const startMs = this.parseMs(activity.start);
      const endMs = this.parseMs(activity.end ?? null);
      if (startMs === null || endMs === null) {
        continue;
      }
      const normalizedEndMs = Math.max(startMs, endMs);
      const owners = this.resolveDutyOwners(activity)
        .filter(
          (owner) =>
            owner.kind === 'personnel' || owner.kind === 'personnel-service',
        )
        .map((owner) => owner.resourceId);
      if (!owners.length) {
        continue;
      }
      for (const ownerId of owners) {
        const bucket = result.get(ownerId);
        if (bucket) {
          bucket.push({ startMs, endMs: normalizedEndMs });
        } else {
          result.set(ownerId, [{ startMs, endMs: normalizedEndMs }]);
        }
      }
    }
    result.forEach((intervals, ownerId) => {
      result.set(ownerId, this.mergeIntervals(intervals));
    });
    return result;
  }

  private isAbsenceActivity(activity: Activity): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const meta = activity.meta;
    const raw = attrs?.['is_absence'] ?? meta?.['is_absence'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      return (
        raw.trim().toLowerCase() === 'true' ||
        raw.trim().toLowerCase() === 'yes'
      );
    }
    return false;
  }

  private markDaysOverlap(
    target: boolean[],
    rangeStartMs: number,
    rangeEndMs: number,
    intervalStartMs: number,
    intervalEndMs: number,
  ): void {
    const dayMs = 86_400_000;
    const clampedStart = Math.max(rangeStartMs, intervalStartMs);
    const clampedEnd = Math.min(rangeEndMs, intervalEndMs);
    if (clampedEnd <= clampedStart) {
      return;
    }
    const startIndex = Math.floor(
      (this.utcDayStartMs(clampedStart) - rangeStartMs) / dayMs,
    );
    const effectiveEnd = Math.max(clampedStart, clampedEnd - 1);
    const endIndex = Math.floor(
      (this.utcDayStartMs(effectiveEnd) - rangeStartMs) / dayMs,
    );
    for (
      let i = Math.max(0, startIndex);
      i <= Math.min(target.length - 1, endIndex);
      i += 1
    ) {
      target[i] = true;
    }
  }

  private computeSundayLikeDates(
    rangeStartMs: number,
    rangeEndMs: number,
    extra: string[],
  ): Set<string> {
    const set = new Set<string>();
    const startYear = new Date(rangeStartMs).getUTCFullYear();
    const endYear = new Date(rangeEndMs).getUTCFullYear();
    for (let year = startYear; year <= endYear; year += 1) {
      const newYear = Date.UTC(year, 0, 1, 0, 0, 0, 0);
      const christmas = Date.UTC(year, 11, 25, 0, 0, 0, 0);
      const ascension = this.addDaysMs(
        this.easterSundayUtc(year).getTime(),
        39,
      );
      [newYear, christmas, ascension].forEach((ms) => {
        if (ms >= rangeStartMs && ms <= rangeEndMs) {
          set.add(this.utcDayKeyFromMs(ms));
        }
      });
    }

    extra.forEach((entry) => {
      const trimmed = (entry ?? '').trim();
      if (!trimmed) {
        return;
      }
      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
        const ms = Date.parse(`${trimmed}T00:00:00.000Z`);
        if (Number.isFinite(ms) && ms >= rangeStartMs && ms <= rangeEndMs) {
          set.add(trimmed);
        }
        return;
      }
      const md = /^\\d{2}-\\d{2}$/.exec(trimmed);
      if (md) {
        const [month, day] = trimmed
          .split('-')
          .map((part) => Number.parseInt(part, 10));
        if (!Number.isFinite(month) || !Number.isFinite(day)) {
          return;
        }
        const startYear = new Date(rangeStartMs).getUTCFullYear();
        const endYear = new Date(rangeEndMs).getUTCFullYear();
        for (let year = startYear; year <= endYear; year += 1) {
          const ms = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
          if (ms >= rangeStartMs && ms <= rangeEndMs) {
            set.add(this.utcDayKeyFromMs(ms));
          }
        }
      }
    });

    return set;
  }

  private easterSundayUtc(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }

  private addDaysMs(ms: number, days: number): number {
    return ms + days * 86_400_000;
  }

  private normalizePayloadMeta(activity: Activity): Activity {
    if (this.isManagedId(activity.id)) {
      return activity;
    }
    const role = this.resolveServiceRole(activity);
    if (role === 'start' || role === 'end') {
      return activity;
    }

    const attrs: ActivityAttributes = { ...(activity.attributes ?? {}) };
    const serviceByOwnerKey = this.serviceByOwnerKey();
    const map = attrs[serviceByOwnerKey];
    const withinPref = this.resolveWithinPreference(activity);

    let changed = false;
    const next: Activity = { ...activity };
    if (next.serviceId) {
      next.serviceId = null;
      changed = true;
    }

    const nextAttrs: ActivityAttributes = { ...attrs };
    if (
      !map ||
      typeof map !== 'object' ||
      Array.isArray(map) ||
      withinPref === 'outside'
    ) {
      if (map) {
        delete (nextAttrs as any)[serviceByOwnerKey];
        changed = true;
      }
    } else {
      const owners = new Set(
        this.resolveDutyOwners(activity).map((owner) => owner.resourceId),
      );
      const cleaned: Record<string, any> = {};
      Object.entries(map as Record<string, any>).forEach(
        ([ownerId, assignment]) => {
          if (owners.has(ownerId)) {
            cleaned[ownerId] = assignment;
          } else {
            changed = true;
          }
        },
      );
      if (Object.keys(cleaned).length) {
        // Only mark as changed when the mapping actually differs.
        if (Object.keys(cleaned).length !== Object.keys(map as any).length) {
          changed = true;
        }
        nextAttrs[serviceByOwnerKey] = cleaned;
      } else {
        delete (nextAttrs as any)[serviceByOwnerKey];
        changed = true;
      }
    }

    if (!changed) {
      return activity;
    }
    next.attributes = nextAttrs;
    return next;
  }
}
