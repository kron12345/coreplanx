import { Injectable } from '@nestjs/common';
import type { Activity, ActivityAttributes, ActivityParticipant, StageId } from './planning.types';
import { PlanningRuleService } from './planning-rule.service';

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
    const groups = this.groupActivities(stageId, activities, config.breakTypeIds);

    const upserts: Activity[] = [];
    const deletedIds: string[] = [];
    const touched = new Set<string>();

    const managedIdsInUse = new Set<string>();

    for (const group of groups) {
      const result = this.autoframeDuty(stageId, group, config);
      result.upserts.forEach((activity) => {
        byId.set(activity.id, activity);
        upserts.push(activity);
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

    return { upserts, deletedIds, touchedIds: Array.from(touched) };
  }

  private groupActivities(stageId: StageId, activities: Activity[], breakTypeIds: string[]): DutyActivityGroup[] {
    const groups = new Map<string, DutyActivityGroup>();

    for (const activity of activities) {
      const owner = this.resolveDutyOwner(activity);
      if (!owner) {
        continue;
      }
      const withinPref = this.resolveWithinPreference(activity);
      const isBreak = this.isBreakActivity(activity, breakTypeIds);
      const role = this.resolveServiceRole(activity);
      const isBoundary =
        role === 'start' ||
        role === 'end' ||
        activity.type === 'service-start' ||
        activity.type === 'service-end';
      if (withinPref === 'outside' && !isBoundary && !isBreak && !this.isManagedId(activity.id)) {
        continue;
      }

      const dayKey = this.utcDayKey(activity.start);
      const derivedServiceId = this.computeServiceId(stageId, owner.resourceId, dayKey);
      const parsedServiceId = this.parseServiceIdFromManagedId(activity.id);
      const explicitServiceId = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
      // serviceId is backend-owned and derived from (stageId, owner, UTC-day). Accept an explicit svc: only when it matches
      // the derived id; this prevents stale serviceId values from surviving drag&drop between duty rows.
      const serviceId =
        parsedServiceId ||
        (explicitServiceId.startsWith('svc:') && explicitServiceId === derivedServiceId
          ? explicitServiceId
          : derivedServiceId);
      const key = `${serviceId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.activities.push(activity);
      } else {
        groups.set(key, { serviceId, owner, dayKey, activities: [activity] });
      }
    }

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

    const serviceStart: Activity = this.buildBoundaryActivity({
      id: startId,
      title: startCandidates.find((a) => a.id === startId)?.title ?? startCandidates[0]?.title ?? 'Dienstanfang',
      type: config.serviceStartTypeId,
      role: 'start',
      startMs: dutyStartMs,
      owner,
      serviceId,
      conflictKey,
      conflictCodesKey,
    });
    const serviceEnd: Activity = this.buildBoundaryActivity({
      id: endId,
      title: endCandidates.find((a) => a.id === endId)?.title ?? endCandidates[0]?.title ?? 'Dienstende',
      type: config.serviceEndTypeId,
      role: 'end',
      startMs: dutyEndMs,
      owner,
      serviceId,
      conflictKey,
      conflictCodesKey,
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

    const dutySpanMs = Math.max(0, dutyEndMs - dutyStartMs);
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
    const maxContinuousObservedMs = this.computeMaxContinuousMs(dutyStartMs, dutyEndMs, breaksSorted);

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
    const markerCodes = Array.from(new Set([...worktimeConflictCodes, ...localUnion]));
    const markerConflictLevel = this.conflictLevelForCodes(markerCodes, config.maxConflictLevel);

    const updatedPayload = payloadActivities.map((activity) => {
      const codes = Array.from(
        new Set([
          ...worktimeConflictCodes,
          ...(localConflictCodes.get(activity.id) ? Array.from(localConflictCodes.get(activity.id)!) : []),
        ]),
      );
      const level = this.conflictLevelForCodes(codes, config.maxConflictLevel);
      return this.applyDutyMeta(activity, serviceId, level, codes, conflictKey, conflictCodesKey);
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
    attrs[conflictKey] = conflictLevel;
    attrs[conflictCodesKey] = conflictCodes;
    return {
      ...activity,
      serviceId,
      attributes: attrs,
    };
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
    ]);
    const warnCodes = new Set<string>(['LOCATION_SEQUENCE']);
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

  private computeServiceId(stageId: StageId, ownerId: string, dayKey: string): string {
    return `svc:${stageId}:${ownerId}:${dayKey}`;
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
}
