import { Injectable } from '@nestjs/common';
import type { Activity, ActivityAttributes, ActivityParticipant, StageId } from './planning.types';
import { PlanningRuleService } from './planning-rule.service';
import { deriveTimetableYearLabelFromVariantId } from '../shared/variant-scope';

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

type ServiceAssignment = {
  serviceId: string;
  conflictLevel: number;
  conflictCodes: string[];
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
  breakIntervals: Array<{ startMs: number; endMs: number }>;
  activityIds: string[];
  hasNightWork: boolean;
};

@Injectable()
export class DutyAutopilotService {
  constructor(private readonly rules: PlanningRuleService) {}

  async apply(stageId: StageId, variantId: string, activities: Activity[]): Promise<DutyAutopilotResult> {
    const config = await this.rules.getDutyAutopilotConfig(stageId, variantId);
    if (!config) {
      return { upserts: [], deletedIds: [], touchedIds: [] };
    }
    if (!activities.length) {
      return { upserts: [], deletedIds: [], touchedIds: [] };
    }

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

    const groups = this.groupActivities(stageId, Array.from(byId.values()), config);

    for (const group of groups) {
      const hydratedGroup: DutyActivityGroup = {
        ...group,
        activities: group.activities.map((activity) => byId.get(activity.id) ?? activity),
      };
      const result = this.autoframeDuty(stageId, hydratedGroup, config);
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
    const activeActivities = Array.from(byId.values()).filter((activity) => !deletedSet.has(activity.id));
    const complianceUpserts = this.applyAzgCompliance(stageId, variantId, activeActivities, config);
    for (const activity of complianceUpserts) {
      if (deletedSet.has(activity.id)) {
        continue;
      }
      byId.set(activity.id, activity);
      upserts.set(activity.id, activity);
      touched.add(activity.id);
    }

    return { upserts: Array.from(upserts.values()), deletedIds, touchedIds: Array.from(touched) };
  }

  private groupActivities(
    stageId: StageId,
    activities: Activity[],
    config: NonNullable<Awaited<ReturnType<PlanningRuleService['getDutyAutopilotConfig']>>>,
  ): DutyActivityGroup[] {
    const breakTypeIds = config.breakTypeIds;
    const byOwner = new Map<string, { owner: ActivityParticipant; activities: Activity[] }>();

    const isBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return (
        role === 'start' ||
        role === 'end' ||
        activity.type === config.serviceStartTypeId ||
        activity.type === config.serviceEndTypeId
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
      if (withinPref === 'outside' && !isBoundary(activity) && !isBreak && !this.isManagedId(activity.id)) {
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

    const resolveServiceIdForBoundary = (ownerId: string, activity: Activity): string | null => {
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
      const explicit = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
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
        .map((activity) => ({ activity, startMs: this.parseMs(activity.start) }))
        .filter((entry): entry is { activity: Activity; startMs: number } => entry.startMs !== null)
        .sort((a, b) => a.startMs - b.startMs);

      const assignment = new Map<string, string>();
      let dutyStartMs: number | null = null;
      let dutyDayKey: string | null = null;
      let serviceId: string | null = null;

      for (const entry of intervals) {
        const startMs = entry.startMs;
        const dayKey = this.utcDayKeyFromMs(startMs);
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
        if (isBoundary(activity) || this.isBreakActivity(activity, breakTypeIds) || this.isManagedId(activity.id)) {
          groupServiceId = resolveServiceIdForBoundary(ownerId, activity);
        } else {
          groupServiceId = assignment.get(activity.id) ?? null;
        }
        if (!groupServiceId) {
          continue;
        }

        const dayKey = this.parseDayKeyFromServiceId(groupServiceId) ?? this.utcDayKey(activity.start);
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
    config: Awaited<ReturnType<PlanningRuleService['getDutyAutopilotConfig']>>,
  ): { upserts: Activity[]; deletedIds: string[]; managedIds: string[] } {
    if (!config) {
      return { upserts: [], deletedIds: [], managedIds: [] };
    }
    const serviceId = group.serviceId;
    const owner = group.owner;
    const ownerId = owner.resourceId;

    const breakTypeIds = config.breakTypeIds;
    const conflictKey = config.conflictAttributeKey;
    const conflictCodesKey = config.conflictCodesAttributeKey;

    const isBreak = (a: Activity) => this.isBreakActivity(a, breakTypeIds);
    const isBoundary = (a: Activity) => {
      const role = this.resolveServiceRole(a);
      return (
        role === 'start' ||
        role === 'end' ||
        a.type === config.serviceStartTypeId ||
        a.type === config.serviceEndTypeId
      );
    };

    const dutyActivities = group.activities.filter((a) => !isBreak(a));
    const payloadActivities = dutyActivities.filter((a) => !isBoundary(a));

    if (!payloadActivities.length) {
      const deleted = group.activities
        .map((a) => a.id)
        .filter((id) => this.isManagedId(id) && this.belongsToService(id, serviceId));
      return { upserts: [], deletedIds: deleted, managedIds: [] };
    }

    const payloadIntervals = this.sortedIntervals(payloadActivities);
    const dutyStartMs = payloadIntervals.minStartMs;
    const dutyEndMs = payloadIntervals.maxEndMs;

    const startCandidates = dutyActivities.filter(
      (a) => this.resolveServiceRole(a) === 'start' || a.type === config.serviceStartTypeId,
    );
    const endCandidates = dutyActivities.filter(
      (a) => this.resolveServiceRole(a) === 'end' || a.type === config.serviceEndTypeId,
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

    const existingStart = startCandidates.find((a) => a.id === startId) ?? startCandidates[0] ?? null;
    const existingEnd = endCandidates.find((a) => a.id === endId) ?? endCandidates[0] ?? null;

    const manualBoundaryKey = this.manualBoundaryKey();
    const manualStartMs =
      existingStart && this.isManualBoundary(existingStart, manualBoundaryKey)
        ? this.parseMs(existingStart.start)
        : null;
    const manualEndMs =
      existingEnd && this.isManualBoundary(existingEnd, manualBoundaryKey) ? this.parseMs(existingEnd.start) : null;

    const boundaryStartMs = manualStartMs !== null && manualStartMs < dutyStartMs ? manualStartMs : dutyStartMs;
    const boundaryEndMs = manualEndMs !== null && manualEndMs > dutyEndMs ? manualEndMs : dutyEndMs;
    const framedStartMs = boundaryStartMs;
    const framedEndMs = boundaryEndMs;

    const serviceStart: Activity = this.buildBoundaryActivity({
      id: startId,
      title: existingStart?.title ?? 'Dienstanfang',
      type: config.serviceStartTypeId,
      role: 'start',
      startMs: boundaryStartMs,
      owner,
      serviceId,
      conflictKey,
      conflictCodesKey,
      manualBoundaryKey,
      manual: Boolean(existingStart && this.isManualBoundary(existingStart, manualBoundaryKey)),
    });
    const serviceEnd: Activity = this.buildBoundaryActivity({
      id: endId,
      title: existingEnd?.title ?? 'Dienstende',
      type: config.serviceEndTypeId,
      role: 'end',
      startMs: boundaryEndMs,
      owner,
      serviceId,
      conflictKey,
      conflictCodesKey,
      manualBoundaryKey,
      manual: Boolean(existingEnd && this.isManualBoundary(existingEnd, manualBoundaryKey)),
    });

    const workActivities = this.sortedIntervals([serviceStart, ...payloadActivities, serviceEnd]).intervals;
    const gaps = this.computeGaps(workActivities).filter((gap) => gap.durationMs > 0);

    const breakMinMs = config.minBreakMinutes * 60_000;
    const maxContinuousMs = config.maxContinuousWorkMinutes * 60_000;
    const maxWorkMs = config.maxWorkMinutes * 60_000;

    const selectedGapIds = new Set<string>();
    const selectedBreaks: Array<{ startMs: number; endMs: number }> = [];
    const blockedContinuous: boolean[] = [];

    let segmentWorkMs = 0;
    let cursorMs = workActivities[0]?.startMs ?? dutyStartMs;

    for (let i = 0; i < workActivities.length; i += 1) {
      const current = workActivities[i];
      segmentWorkMs += Math.max(0, current.endMs - cursorMs);
      cursorMs = current.endMs;

      const next = workActivities[i + 1];
      if (!next) {
        break;
      }
      const gapStartMs = cursorMs;
      const gapEndMs = next.startMs;
      const gapDurationMs = Math.max(0, gapEndMs - gapStartMs);
      const nextDurationMs = Math.max(0, next.endMs - next.startMs);

      if (segmentWorkMs + gapDurationMs + nextDurationMs > maxContinuousMs) {
        const gapId = `${gapStartMs}-${gapEndMs}`;
        if (gapDurationMs >= breakMinMs) {
          selectedGapIds.add(gapId);
          selectedBreaks.push({ startMs: gapStartMs, endMs: gapEndMs });
          segmentWorkMs = 0;
          cursorMs = gapEndMs;
        } else {
          blockedContinuous.push(true);
        }
      }
    }

    const dutySpanMs = Math.max(0, framedEndMs - framedStartMs);
    let breakMs = selectedBreaks.reduce((sum, entry) => sum + Math.max(0, entry.endMs - entry.startMs), 0);
    let workMs = Math.max(0, dutySpanMs - breakMs);

    if (workMs > maxWorkMs) {
      const additionalNeedMs = workMs - maxWorkMs;
      let remainingMs = additionalNeedMs;
      const candidates = gaps
        .filter((gap) => gap.durationMs >= breakMinMs)
        .filter((gap) => !selectedGapIds.has(gap.id))
        .sort((a, b) => b.durationMs - a.durationMs);

      for (const gap of candidates) {
        if (remainingMs <= 0) {
          break;
        }
        selectedGapIds.add(gap.id);
        selectedBreaks.push({ startMs: gap.startMs, endMs: gap.endMs });
        breakMs += gap.durationMs;
        workMs = Math.max(0, dutySpanMs - breakMs);
        remainingMs = Math.max(0, workMs - maxWorkMs);
      }
    }

    const breaksSorted = selectedBreaks.sort((a, b) => a.startMs - b.startMs);
    const maxContinuousObservedMs = this.computeMaxContinuousMs(framedStartMs, framedEndMs, breaksSorted);

    const worktimeConflictCodes: string[] = [];
    if (dutySpanMs > config.maxDutySpanMinutes * 60_000) {
      worktimeConflictCodes.push('MAX_DUTY_SPAN');
    }
    if (workMs > maxWorkMs) {
      worktimeConflictCodes.push('MAX_WORK');
    }
    if (maxContinuousObservedMs > maxContinuousMs || blockedContinuous.length) {
      worktimeConflictCodes.push('MAX_CONTINUOUS');
    }
    if (blockedContinuous.length) {
      worktimeConflictCodes.push('NO_BREAK_WINDOW');
    }

    const localConflictCodes = this.detectLocalConflicts(payloadActivities);
    const localUnion = Array.from(
      new Set(
        Array.from(localConflictCodes.values()).flatMap((codes) => Array.from(codes)),
      ),
    );
    const existingAzgCodes = this.normalizeConflictCodes(
      group.activities
        .flatMap((activity) => this.readConflictCodesForActivity(activity, ownerId, conflictCodesKey))
        .filter((code) => code.startsWith('AZG_')),
    );
    const markerCodes = this.normalizeConflictCodes([...worktimeConflictCodes, ...localUnion, ...existingAzgCodes]);
    const markerConflictLevel = this.conflictLevelForCodes(markerCodes, config.maxConflictLevel);

    const updatedPayload = payloadActivities.map((activity) => {
      const codes = this.normalizeConflictCodes([
        ...worktimeConflictCodes,
        ...(localConflictCodes.get(activity.id) ? Array.from(localConflictCodes.get(activity.id)!) : []),
        ...existingAzgCodes,
      ]);
      const level = this.conflictLevelForCodes(codes, config.maxConflictLevel);
      return this.applyDutyAssignment(activity, ownerId, { serviceId, conflictLevel: level, conflictCodes: codes }, conflictKey, conflictCodesKey);
    });

    const breakTypeId = breakTypeIds[0] ?? 'break';
    const generatedBreaks: Activity[] = breaksSorted.map((entry, index) => {
      const id = `svcbreak:${serviceId}:${index + 1}`;
      managedIds.push(id);
      return this.buildBreakActivity({
        id,
        title: 'Pause',
        type: breakTypeId,
        startMs: entry.startMs,
        endMs: entry.endMs,
        owner,
        serviceId,
        conflictKey,
        conflictCodesKey,
      });
    });

    const updatedBoundaries = [
      this.applyDutyMeta(
        serviceStart,
        serviceId,
        markerConflictLevel,
        markerCodes,
        conflictKey,
        conflictCodesKey,
      ),
      this.applyDutyMeta(
        serviceEnd,
        serviceId,
        markerConflictLevel,
        markerCodes,
        conflictKey,
        conflictCodesKey,
      ),
    ];

    const updatedBreaks = generatedBreaks.map((b) =>
      this.applyDutyMeta(
        b,
        serviceId,
        markerConflictLevel,
        markerCodes,
        conflictKey,
        conflictCodesKey,
      ),
    );

    const upserts = [...updatedPayload, ...updatedBoundaries, ...updatedBreaks];

    const desiredManaged = new Set(managedIds);
    const deletedIds = Array.from(
      new Set([
        ...boundaryDeletedIds,
        ...group.activities
          .map((a) => a.id)
          .filter((id) => this.isManagedId(id) && this.belongsToService(id, serviceId) && !desiredManaged.has(id)),
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
    owner: ActivityParticipant;
    serviceId: string;
    conflictKey: string;
    conflictCodesKey: string;
  }): Activity {
    return {
      id: options.id,
      title: options.title,
      start: new Date(options.startMs).toISOString(),
      end: new Date(options.endMs).toISOString(),
      type: options.type,
      serviceId: options.serviceId,
      participants: [this.buildOwnerParticipant(options.owner)],
      attributes: {
        ...(options.conflictKey ? { [options.conflictKey]: 0 } : {}),
        ...(options.conflictCodesKey ? { [options.conflictCodesKey]: [] } : {}),
        is_break: true,
      },
    };
  }

  private applyDutyMeta(
    activity: Activity,
    serviceId: string,
    conflictLevel: number,
    conflictCodes: string[],
    conflictKey: string,
    conflictCodesKey: string,
  ): Activity {
    const attrs: ActivityAttributes = { ...(activity.attributes ?? {}) };
    const normalizedCodes = this.normalizeConflictCodes(conflictCodes);
    const levelUnchanged = attrs[conflictKey] === conflictLevel;
    const codesUnchanged = this.sameStringArray(attrs[conflictCodesKey], normalizedCodes);
    const serviceUnchanged = (activity.serviceId ?? null) === serviceId;
    if (levelUnchanged && codesUnchanged && serviceUnchanged) {
      return activity;
    }

    attrs[conflictKey] = conflictLevel;
    attrs[conflictCodesKey] = normalizedCodes;
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
    const existing = attrs[serviceByOwnerKey];
    const map = this.cloneOwnerAssignmentMap(existing);
    const normalizedCodes = this.normalizeConflictCodes(assignment.conflictCodes);
    const currentEntry = map[ownerId];
    const entryUnchanged =
      (currentEntry?.serviceId ?? null) === assignment.serviceId &&
      (currentEntry?.conflictLevel ?? 0) === assignment.conflictLevel &&
      this.sameStringArray(currentEntry?.conflictCodes ?? [], normalizedCodes);

    map[ownerId] = {
      serviceId: assignment.serviceId,
      conflictLevel: assignment.conflictLevel,
      conflictCodes: normalizedCodes,
    };

    attrs[serviceByOwnerKey] = map;

    // Keep a global union for non-slot aware consumers.
    const entries = Object.values(map);
    const maxLevel = entries.reduce((max, entry) => Math.max(max, entry?.conflictLevel ?? 0), 0);
    const unionCodes = this.normalizeConflictCodes(
      entries.flatMap((entry) => (Array.isArray(entry?.conflictCodes) ? entry.conflictCodes : [])),
    );
    attrs[conflictKey] = maxLevel;
    attrs[conflictCodesKey] = unionCodes;

    const serviceUnchanged = activity.serviceId === null;
    const globalLevelUnchanged = (activity.attributes as any)?.[conflictKey] === maxLevel;
    const globalCodesUnchanged = this.sameStringArray((activity.attributes as any)?.[conflictCodesKey], unionCodes);

    if (entryUnchanged && serviceUnchanged && globalLevelUnchanged && globalCodesUnchanged) {
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

  private computeGaps(intervals: Array<{ startMs: number; endMs: number }>): Array<{
    id: string;
    startMs: number;
    endMs: number;
    durationMs: number;
  }> {
    const gaps: Array<{ id: string; startMs: number; endMs: number; durationMs: number }> = [];
    for (let i = 0; i < intervals.length - 1; i += 1) {
      const endMs = intervals[i].endMs;
      const nextStartMs = intervals[i + 1].startMs;
      const startMs = endMs;
      const gapEndMs = nextStartMs;
      const durationMs = Math.max(0, gapEndMs - startMs);
      if (durationMs <= 0) {
        continue;
      }
      gaps.push({ id: `${startMs}-${gapEndMs}`, startMs, endMs: gapEndMs, durationMs });
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
        const endMs = this.parseMs(activity.end ?? activity.start) ?? startMs;
        const normalizedEnd = Math.max(startMs ?? 0, endMs ?? 0);
        return { startMs: startMs ?? 0, endMs: normalizedEnd };
      })
      .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs))
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    const minStartMs = intervals.length ? intervals[0].startMs : 0;
    const maxEndMs = intervals.reduce((max, entry) => Math.max(max, entry.endMs), minStartMs);
    return { intervals, minStartMs, maxEndMs };
  }

  private parseMs(iso: string | null | undefined): number | null {
    const value = iso?.trim();
    if (!value) {
      return null;
    }
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
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
      'AZG_REST_MIN',
      'AZG_BREAK_MAX_COUNT',
      'AZG_BREAK_TOO_SHORT',
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

  private detectLocalConflicts(payloadActivities: Activity[]): Map<string, Set<string>> {
    const conflicts = new Map<string, Set<string>>();
    const add = (activityId: string, code: string) => {
      let set = conflicts.get(activityId);
      if (!set) {
        set = new Set<string>();
        conflicts.set(activityId, set);
      }
      set.add(code);
    };

    const normalized = payloadActivities
      .map((activity) => {
        const startMs = this.parseMs(activity.start);
        const endMs = this.parseMs(activity.end ?? activity.start);
        if (startMs === null || endMs === null) {
          return null;
        }
        return {
          id: activity.id,
          startMs,
          endMs: Math.max(startMs, endMs),
          from: this.normalizeLocation(activity.from),
          to: this.normalizeLocation(activity.to),
          considerCapacity: this.considerCapacityConflicts(activity),
          considerLocation: this.considerLocationConflicts(activity),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    const capacityCandidates = normalized.filter((entry) => entry.considerCapacity);
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

    for (let i = 0; i < normalized.length - 1; i += 1) {
      const prev = normalized[i];
      const next = normalized[i + 1];
      if (!prev.considerLocation || !next.considerLocation) {
        continue;
      }
      if (prev.to && next.from && prev.to !== next.from) {
        add(prev.id, 'LOCATION_SEQUENCE');
        add(next.id, 'LOCATION_SEQUENCE');
      }
    }

    return conflicts;
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

  private resolveDutyOwner(activity: Activity): ActivityParticipant | null {
    const participants = activity.participants ?? [];
    const owner =
      participants.find((p) => p.kind === 'personnel-service' || p.kind === 'vehicle-service') ??
      participants.find((p) => p.kind === 'personnel' || p.kind === 'vehicle') ??
      null;
    return owner ?? null;
  }

  private resolveDutyOwners(activity: Activity): ActivityParticipant[] {
    const participants = activity.participants ?? [];
    const preferred = participants.filter((p) => p.kind === 'personnel-service' || p.kind === 'vehicle-service');
    if (preferred.length) {
      return preferred;
    }
    const fallback = participants.filter((p) => p.kind === 'personnel' || p.kind === 'vehicle');
    if (fallback.length) {
      return fallback;
    }
    return [];
  }

  private resolveServiceRole(activity: Activity): 'start' | 'end' | 'segment' | null {
    if (activity.serviceRole) {
      return activity.serviceRole as 'start' | 'end' | 'segment';
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (val: unknown) =>
      typeof val === 'boolean'
        ? val
        : typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : false;
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

  private resolveWithinPreference(activity: Activity): 'within' | 'outside' | 'both' {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const meta = activity.meta as Record<string, unknown> | undefined;
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
      if (val === 'no' || val === 'false' || val === 'outside' || val === 'out') {
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
    if (type && breakTypeIds.some((id) => id === type)) {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const val = attrs?.['is_break'];
    if (typeof val === 'boolean') {
      return val;
    }
    if (typeof val === 'string') {
      return val.toLowerCase() === 'true';
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

  private computeServiceId(stageId: StageId, ownerId: string, dayKey: string): string {
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
    return candidate === 'base' || candidate === 'operations' || candidate === 'dispatch' ? (candidate as StageId) : null;
  }

  private buildOwnerParticipant(owner: ActivityParticipant): ActivityParticipant {
    return {
      resourceId: owner.resourceId,
      kind: owner.kind,
      role: owner.role ?? (owner.kind === 'vehicle' || owner.kind === 'vehicle-service' ? 'primary-vehicle' : 'primary-personnel'),
    };
  }

  private isManagedId(id: string): boolean {
    return id.startsWith('svcstart:') || id.startsWith('svcend:') || id.startsWith('svcbreak:');
  }

  private belongsToService(id: string, serviceId: string): boolean {
    return (
      id === `svcstart:${serviceId}` ||
      id === `svcend:${serviceId}` ||
      id.startsWith(`svcbreak:${serviceId}:`)
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

  private applyAzgCompliance(
    stageId: StageId,
    variantId: string,
    activities: Activity[],
    config: NonNullable<Awaited<ReturnType<PlanningRuleService['getDutyAutopilotConfig']>>>,
  ): Activity[] {
    if (!config.azg?.enabled) {
      return [];
    }

    const conflictKey = config.conflictAttributeKey;
    const conflictCodesKey = config.conflictCodesAttributeKey;
    const breakTypeIds = config.breakTypeIds;
    const dayMs = 86_400_000;

    const byId = new Map<string, Activity>(activities.map((activity) => [activity.id, activity]));
    const updated = new Map<string, Activity>();

    const isBoundary = (activity: Activity) => {
      const role = this.resolveServiceRole(activity);
      return (
        role === 'start' ||
        role === 'end' ||
        activity.type === config.serviceStartTypeId ||
        activity.type === config.serviceEndTypeId
      );
    };

    const groups = this.groupActivities(stageId, activities, config).filter((group) =>
      group.owner.kind === 'personnel' || group.owner.kind === 'personnel-service',
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

      const groupActivities = group.activities.map((activity) => byId.get(activity.id) ?? activity);
      const startBoundary = groupActivities.find((a) => a.id === `svcstart:${serviceId}`) ?? groupActivities.find((a) => this.resolveServiceRole(a) === 'start') ?? null;
      const endBoundary = groupActivities.find((a) => a.id === `svcend:${serviceId}`) ?? groupActivities.find((a) => this.resolveServiceRole(a) === 'end') ?? null;

      const fallbackIntervals = this.sortedIntervals(
        groupActivities.filter((activity) => !this.isBreakActivity(activity, breakTypeIds) && !isBoundary(activity)),
      );
      const dutyStartMs = this.parseMs(startBoundary?.start ?? null) ?? fallbackIntervals.minStartMs;
      const dutyEndMs = this.parseMs(endBoundary?.start ?? null) ?? fallbackIntervals.maxEndMs;

      if (!Number.isFinite(dutyStartMs) || !Number.isFinite(dutyEndMs) || dutyEndMs <= dutyStartMs) {
        continue;
      }

      const breaks = groupActivities
        .filter((activity) => this.isBreakActivity(activity, breakTypeIds))
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
          return { startMs: clampedStartMs, endMs: clampedEndMs };
        })
        .filter((interval): interval is { startMs: number; endMs: number } => interval !== null)
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

      const normalizedBreaks = this.mergeIntervals(breaks);
      const workSegments = this.subtractIntervals({ startMs: dutyStartMs, endMs: dutyEndMs }, normalizedBreaks);
      const workMinutes = Math.round(
        workSegments.reduce((sum, seg) => sum + Math.max(0, seg.endMs - seg.startMs), 0) / 60_000,
      );

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
        breakIntervals: normalizedBreaks,
        activityIds: groupActivities.map((activity) => activity.id),
        hasNightWork: this.intervalsOverlapDailyWindow(workSegments, 0, 4),
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

    const serviceCodes = new Map<string, Set<string>>();
    const addCode = (serviceId: string, code: string) => {
      let set = serviceCodes.get(serviceId);
      if (!set) {
        set = new Set<string>();
        serviceCodes.set(serviceId, set);
      }
      set.add(code);
    };
    const addDutyCode = (duty: AzgDutySnapshot, code: string) => addCode(duty.serviceId, code);

    const breakMinMinutes = Math.max(0, config.minBreakMinutes);

    for (const duty of dutySnapshots) {
      if (config.azg.breakMaxCount.enabled && duty.breakIntervals.length > config.azg.breakMaxCount.maxCount) {
        addDutyCode(duty, 'AZG_BREAK_MAX_COUNT');
      }
      if (duty.breakIntervals.some((brk) => (brk.endMs - brk.startMs) / 60_000 < breakMinMinutes)) {
        addDutyCode(duty, 'AZG_BREAK_TOO_SHORT');
      }
      if (
        config.azg.breakForbiddenNight.enabled &&
        this.intervalsOverlapDailyWindow(duty.breakIntervals, config.azg.breakForbiddenNight.startHour, config.azg.breakForbiddenNight.endHour)
      ) {
        addDutyCode(duty, 'AZG_BREAK_FORBIDDEN_NIGHT');
      }

      const bufferMinutes = Math.max(0, config.azg.exceedBufferMinutes);
      if (bufferMinutes > 0) {
        if (duty.workMinutes > config.maxWorkMinutes + bufferMinutes) {
          addDutyCode(duty, 'AZG_WORK_EXCEED_BUFFER');
        }
        if (duty.dutySpanMinutes > config.maxDutySpanMinutes + bufferMinutes) {
          addDutyCode(duty, 'AZG_DUTY_SPAN_EXCEED_BUFFER');
        }
      }
    }

    for (const duties of byOwner.values()) {
      const sortedByDay = duties
        .slice()
        .sort((a, b) => a.dayStartMs - b.dayStartMs || a.startMs - b.startMs);
      const sortedByStart = duties.slice().sort((a, b) => a.startMs - b.startMs);

      if (config.azg.workAvg7d.enabled) {
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
                  addDutyCode(streak[j], 'AZG_WORK_AVG_7D');
                }
              }
            }
          }
          streak = [];
        };

        for (const duty of sortedByDay) {
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

      if (config.azg.workAvg365d.enabled) {
        const workdayCount = new Set(sortedByDay.map((d) => d.dayStartMs)).size;
        const totalWork = sortedByDay.reduce((sum, d) => sum + d.workMinutes, 0);
        const avg = workdayCount > 0 ? totalWork / workdayCount : 0;
        if (avg > config.azg.workAvg365d.maxAverageMinutes) {
          sortedByDay.forEach((duty) => addDutyCode(duty, 'AZG_WORK_AVG_365D'));
        }
      }

      if (config.azg.dutySpanAvg28d.enabled) {
        const windowMs = Math.max(1, config.azg.dutySpanAvg28d.windowDays) * dayMs;
        const maxAvg = config.azg.dutySpanAvg28d.maxAverageMinutes;
        let start = 0;
        let sum = 0;
        for (let end = 0; end < sortedByDay.length; end += 1) {
          sum += sortedByDay[end].dutySpanMinutes;
          while (sortedByDay[end].dayStartMs - sortedByDay[start].dayStartMs >= windowMs) {
            sum -= sortedByDay[start].dutySpanMinutes;
            start += 1;
          }
          const count = end - start + 1;
          if (!count) {
            continue;
          }
          const avg = sum / count;
          if (avg > maxAvg) {
            for (let i = start; i <= end; i += 1) {
              addDutyCode(sortedByDay[i], 'AZG_DUTY_SPAN_AVG_28D');
            }
          }
        }
      }

      const restGaps = sortedByStart
        .map((duty, index) => {
          const next = sortedByStart[index + 1];
          if (!next) {
            return null;
          }
          const minutes = Math.round((next.startMs - duty.endMs) / 60_000);
          return { prev: duty, next, nextStartMs: next.startMs, minutes };
        })
        .filter((entry): entry is { prev: AzgDutySnapshot; next: AzgDutySnapshot; nextStartMs: number; minutes: number } => entry !== null);

      if (config.azg.restMin.enabled) {
        const minMinutes = config.azg.restMin.minMinutes;
        for (const gap of restGaps) {
          if (gap.minutes < minMinutes) {
            addDutyCode(gap.prev, 'AZG_REST_MIN');
            addDutyCode(gap.next, 'AZG_REST_MIN');
          }
        }
      }

      if (config.azg.restAvg28d.enabled && restGaps.length) {
        const windowMs = Math.max(1, config.azg.restAvg28d.windowDays) * dayMs;
        const minAvg = config.azg.restAvg28d.minAverageMinutes;
        let start = 0;
        let sum = 0;
        for (let end = 0; end < restGaps.length; end += 1) {
          sum += restGaps[end].minutes;
          while (restGaps[end].nextStartMs - restGaps[start].nextStartMs >= windowMs) {
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
              addDutyCode(restGaps[i].prev, 'AZG_REST_AVG_28D');
              addDutyCode(restGaps[i].next, 'AZG_REST_AVG_28D');
            }
          }
        }
      }

      if (config.azg.nightMaxStreak.enabled) {
        const maxConsecutive = config.azg.nightMaxStreak.maxConsecutive;
        let streak: AzgDutySnapshot[] = [];
        const flush = () => {
          if (streak.length > maxConsecutive) {
            streak.forEach((duty) => addDutyCode(duty, 'AZG_NIGHT_STREAK_MAX'));
          }
          streak = [];
        };

        for (const duty of sortedByDay) {
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

      if (config.azg.nightMax28d.enabled) {
        const windowMs = Math.max(1, config.azg.nightMax28d.windowDays) * dayMs;
        const maxCount = config.azg.nightMax28d.maxCount;
        let start = 0;
        let nightCount = 0;
        for (let end = 0; end < sortedByDay.length; end += 1) {
          if (sortedByDay[end].hasNightWork) {
            nightCount += 1;
          }
          while (sortedByDay[end].dayStartMs - sortedByDay[start].dayStartMs >= windowMs) {
            if (sortedByDay[start].hasNightWork) {
              nightCount -= 1;
            }
            start += 1;
          }
          if (nightCount > maxCount) {
            for (let i = start; i <= end; i += 1) {
              if (sortedByDay[i].hasNightWork) {
                addDutyCode(sortedByDay[i], 'AZG_NIGHT_28D_MAX');
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
        const sundayLikeDates = this.computeSundayLikeDates(bounds.startMs, bounds.endMs, config.azg.restDaysYear.additionalSundayLikeHolidays);

        for (const [ownerId, duties] of byOwner.entries()) {
          const dayCount = Math.ceil((bounds.endMs - bounds.startMs + 1) / dayMs);
          const workDays = new Array<boolean>(dayCount).fill(false);
          const absenceDays = new Array<boolean>(dayCount).fill(false);

          duties.forEach((duty) => {
            this.markDaysOverlap(workDays, bounds.startMs, bounds.endMs, duty.startMs, duty.endMs);
          });

          (absencesByOwner.get(ownerId) ?? []).forEach((interval) => {
            this.markDaysOverlap(absenceDays, bounds.startMs, bounds.endMs, interval.startMs, interval.endMs);
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
            duties.forEach((duty) => addDutyCode(duty, 'AZG_REST_DAYS_YEAR_MIN'));
          }
          if (sundayRestDays < config.azg.restDaysYear.minSundayRestDays) {
            duties.forEach((duty) => addDutyCode(duty, 'AZG_REST_SUNDAYS_YEAR_MIN'));
          }
        }
      }
    }

    for (const group of groups) {
      const ownerId = group.owner.resourceId;
      const serviceId = group.serviceId;
      const desiredAzgCodes = this.normalizeConflictCodes(Array.from(serviceCodes.get(serviceId) ?? []));

      for (const groupActivity of group.activities) {
        const current = byId.get(groupActivity.id) ?? groupActivity;
        const baseCodes = this.readConflictCodesForActivity(current, ownerId, conflictCodesKey);
        const filtered = baseCodes.filter((code) => !code.startsWith('AZG_'));
        const merged = this.normalizeConflictCodes([...filtered, ...desiredAzgCodes]);
        const level = this.conflictLevelForCodes(merged, config.maxConflictLevel);

        const next =
          this.isManagedId(current.id) || isBoundary(current)
            ? this.applyDutyMeta(current, serviceId, level, merged, conflictKey, conflictCodesKey)
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
        const raw = (entry as any).conflictCodes;
        if (Array.isArray(raw)) {
          return raw.map((code) => `${code ?? ''}`.trim()).filter((code) => code.length > 0);
        }
      }
    }
    const raw = attrs[conflictCodesKey];
    if (Array.isArray(raw)) {
      return raw.map((code) => `${code ?? ''}`.trim()).filter((code) => code.length > 0);
    }
    return [];
  }

  private utcDayStartMsFromDayKey(dayKey: string): number | null {
    const trimmed = (dayKey ?? '').trim();
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(trimmed)) {
      return null;
    }
    const ms = Date.parse(`${trimmed}T00:00:00.000Z`);
    return Number.isFinite(ms) ? ms : null;
  }

  private mergeIntervals(intervals: Array<{ startMs: number; endMs: number }>): Array<{ startMs: number; endMs: number }> {
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
    return intervals.some((interval) => this.intervalOverlapsDailyWindow(interval.startMs, interval.endMs, startHour, endHour));
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
    for (let dayStart = dayStartBase - dayMs; dayStart <= lastDayStart; dayStart += dayMs) {
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

  private intervalsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
    const start = Math.max(startA, startB);
    const end = Math.min(endA, endB);
    return start < end;
  }

  private utcDayStartMs(ms: number): number {
    const date = new Date(ms);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
  }

  private computeTimetableYearBoundsFromVariantId(variantId: string): { startMs: number; endMs: number } | null {
    const label = deriveTimetableYearLabelFromVariantId(variantId);
    if (!label) {
      return null;
    }
    return this.computeTimetableYearBounds(label);
  }

  private computeTimetableYearBounds(label: string): { startMs: number; endMs: number } | null {
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

  private collectAbsenceIntervals(activities: Activity[]): Map<string, Array<{ startMs: number; endMs: number }>> {
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
        .filter((owner) => owner.kind === 'personnel' || owner.kind === 'personnel-service')
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
    const meta = activity.meta as Record<string, unknown> | undefined;
    const raw = attrs?.['is_absence'] ?? meta?.['is_absence'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      return raw.trim().toLowerCase() === 'true' || raw.trim().toLowerCase() === 'yes';
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
    const startIndex = Math.floor((this.utcDayStartMs(clampedStart) - rangeStartMs) / dayMs);
    const effectiveEnd = Math.max(clampedStart, clampedEnd - 1);
    const endIndex = Math.floor((this.utcDayStartMs(effectiveEnd) - rangeStartMs) / dayMs);
    for (let i = Math.max(0, startIndex); i <= Math.min(target.length - 1, endIndex); i += 1) {
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
      const ascension = this.addDaysMs(this.easterSundayUtc(year).getTime(), 39);
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
        const [month, day] = trimmed.split('-').map((part) => Number.parseInt(part, 10));
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
    if (role === 'start' || role === 'end' || activity.type === 'service-start' || activity.type === 'service-end') {
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
    if (!map || typeof map !== 'object' || Array.isArray(map) || withinPref === 'outside') {
      if (map) {
        delete (nextAttrs as any)[serviceByOwnerKey];
        changed = true;
      }
    } else {
      const owners = new Set(this.resolveDutyOwners(activity).map((owner) => owner.resourceId));
      const cleaned: Record<string, any> = {};
      Object.entries(map as Record<string, any>).forEach(([ownerId, assignment]) => {
        if (owners.has(ownerId)) {
          cleaned[ownerId] = assignment;
        } else {
          changed = true;
        }
      });
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
