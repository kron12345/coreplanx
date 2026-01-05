import { Injectable } from '@nestjs/common';
import type { Activity, ActivityParticipant, PlanningStageSnapshot } from './planning.types';
import type { RulesetIR, RulesetTemplate, RulesetTemplateType } from './planning-ruleset.types';

type PlanningCandidateType = Extract<RulesetTemplateType, 'break' | 'travel' | 'duty' | 'duty_split'>;

export interface PlanningCandidate {
  id: string;
  templateId: string;
  type: PlanningCandidateType;
  params: Record<string, unknown>;
}

export interface PlanningCandidateBuildStats {
  breakTemplates: number;
  travelTemplates: number;
  dutyTemplates: number;
  dutySplitTemplates: number;
  candidateCount: number;
}

export interface PlanningCandidateBuildResult {
  rulesetId: string;
  rulesetVersion: string;
  candidates: PlanningCandidate[];
  stats: PlanningCandidateBuildStats;
}

@Injectable()
export class PlanningCandidateBuilder {
  buildCandidates(snapshot: PlanningStageSnapshot, ruleset: RulesetIR): PlanningCandidateBuildResult {
    const breakTemplates = ruleset.templates.filter((entry) => entry.template.type === 'break');
    const travelTemplates = ruleset.templates.filter((entry) => entry.template.type === 'travel');
    const dutyTemplates = ruleset.templates.filter((entry) => entry.template.type === 'duty');
    const dutySplitTemplates = ruleset.templates.filter((entry) => entry.template.type === 'duty_split');
    const gaps = this.collectServiceGaps(snapshot.stageId, snapshot.activities);
    const dutyGroups = this.collectDutyGroups(snapshot);

    const candidates: PlanningCandidate[] = [
      ...this.buildBreakCandidates(breakTemplates, gaps),
      ...this.buildTravelCandidates(travelTemplates, gaps),
      ...this.buildDutyCandidates(dutyTemplates, dutyGroups),
      ...this.buildDutySplitCandidates(dutySplitTemplates, gaps),
    ];

    return {
      rulesetId: ruleset.id,
      rulesetVersion: ruleset.version,
      candidates,
      stats: {
        breakTemplates: breakTemplates.length,
        travelTemplates: travelTemplates.length,
        dutyTemplates: dutyTemplates.length,
        dutySplitTemplates: dutySplitTemplates.length,
        candidateCount: candidates.length,
      },
    };
  }

  private buildBreakCandidates(templates: RulesetTemplate[], gaps: ServiceGap[]): PlanningCandidate[] {
    const candidates: PlanningCandidate[] = [];
    for (const template of templates) {
      const params = this.asParams(template);
      const durationMinutes = this.pickNumber(params, 'durationMinutes', 30);
      const minGapMinutes = this.pickNumber(params, 'minGapMinutes', durationMinutes);
      const maxGapMinutes = this.pickNumber(params, 'maxGapMinutes', Number.POSITIVE_INFINITY);
      const maxCandidates = this.pickNumber(params, 'maxCandidates', Number.POSITIVE_INFINITY);
      let counter = 0;
      for (const gap of gaps) {
        if (!this.supportsPersonnelBreaks(gap.participantKeys)) {
          continue;
        }
        if (gap.gapMinutes < minGapMinutes || gap.gapMinutes > maxGapMinutes) {
          continue;
        }
        const candidateParams = {
          ...params,
          durationMinutes,
          serviceId: gap.serviceId,
          beforeActivityId: gap.before.id,
          afterActivityId: gap.after.id,
          windowStart: gap.windowStart,
          windowEnd: gap.windowEnd,
          gapMinutes: gap.gapMinutes,
          participantKeys: gap.participantKeys,
        };
        candidates.push({
          id: `cand:${template.id}:${gap.serviceId}:${counter}`,
          templateId: template.id,
          type: 'break',
          params: candidateParams,
        });
        counter += 1;
        if (counter >= maxCandidates) {
          break;
        }
      }
    }
    return candidates;
  }

  private supportsPersonnelBreaks(participantKeys: string[]): boolean {
    if (!participantKeys.length) {
      return false;
    }
    return participantKeys.some((entry) => {
      const kind = entry.split('|')[0];
      return kind === 'personnel' || kind === 'personnel-service';
    });
  }

  private buildTravelCandidates(templates: RulesetTemplate[], gaps: ServiceGap[]): PlanningCandidate[] {
    const candidates: PlanningCandidate[] = [];
    for (const template of templates) {
      const params = this.asParams(template);
      const minGapMinutes = this.pickNumber(params, 'minGapMinutes', 0);
      const maxGapMinutes = this.pickNumber(params, 'maxGapMinutes', Number.POSITIVE_INFINITY);
      const maxCandidates = this.pickNumber(params, 'maxCandidates', Number.POSITIVE_INFINITY);
      let counter = 0;
      for (const gap of gaps) {
        if (gap.gapMinutes < minGapMinutes || gap.gapMinutes > maxGapMinutes) {
          continue;
        }
        if (!gap.fromLocation || !gap.toLocation || gap.fromLocation === gap.toLocation) {
          continue;
        }
        const candidateParams = {
          ...params,
          serviceId: gap.serviceId,
          fromLocation: gap.fromLocation,
          toLocation: gap.toLocation,
          beforeActivityId: gap.before.id,
          afterActivityId: gap.after.id,
          windowStart: gap.windowStart,
          windowEnd: gap.windowEnd,
          gapMinutes: gap.gapMinutes,
          participantKeys: gap.participantKeys,
        };
        candidates.push({
          id: `cand:${template.id}:${gap.serviceId}:${counter}`,
          templateId: template.id,
          type: 'travel',
          params: candidateParams,
        });
        counter += 1;
        if (counter >= maxCandidates) {
          break;
        }
      }
    }
    return candidates;
  }

  private buildDutySplitCandidates(templates: RulesetTemplate[], gaps: ServiceGap[]): PlanningCandidate[] {
    const candidates: PlanningCandidate[] = [];
    for (const template of templates) {
      const params = this.asParams(template);
      const minGapMinutes = this.pickNumber(params, 'minGapMinutes', 60);
      const maxGapMinutes = this.pickNumber(params, 'maxGapMinutes', Number.POSITIVE_INFINITY);
      const maxCandidates = this.pickNumber(params, 'maxCandidates', Number.POSITIVE_INFINITY);
      let counter = 0;
      for (const gap of gaps) {
        if (gap.gapMinutes < minGapMinutes || gap.gapMinutes > maxGapMinutes) {
          continue;
        }
        const candidateParams = {
          ...params,
          serviceId: gap.serviceId,
          splitAfterActivityId: gap.before.id,
          splitBeforeActivityId: gap.after.id,
          splitAt: gap.windowStart,
          windowStart: gap.windowStart,
          windowEnd: gap.windowEnd,
          gapMinutes: gap.gapMinutes,
          participantKeys: gap.participantKeys,
        };
        candidates.push({
          id: `cand:${template.id}:${gap.serviceId}:${counter}`,
          templateId: template.id,
          type: 'duty_split',
          params: candidateParams,
        });
        counter += 1;
        if (counter >= maxCandidates) {
          break;
        }
      }
    }
    return candidates;
  }

  private buildDutyCandidates(
    templates: RulesetTemplate[],
    groups: DutyGroup[],
  ): PlanningCandidate[] {
    const candidates: PlanningCandidate[] = [];
    for (const template of templates) {
      const params = this.asParams(template);
      const ownerGroupFilter = this.pickString(params, 'ownerGroup');
      const minActivities = this.pickNumber(params, 'minActivities', 1);
      const maxActivities = this.pickNumber(params, 'maxActivities', Number.POSITIVE_INFINITY);

      for (const group of groups) {
        if (ownerGroupFilter && ownerGroupFilter !== group.ownerGroup) {
          continue;
        }
        if (group.activityIds.length < minActivities || group.activityIds.length > maxActivities) {
          continue;
        }
        const candidateParams = {
          ...params,
          ownerId: group.ownerId,
          ownerKind: group.ownerKind,
          ownerRole: group.ownerRole,
          ownerGroup: group.ownerGroup,
          serviceId: group.serviceId,
          dayKey: group.dayKey,
          activityIds: group.activityIds,
          dutyStart: group.dutyStart,
          dutyEnd: group.dutyEnd,
          dutySpanMinutes: group.dutySpanMinutes,
          durationMinutes: group.dutySpanMinutes,
        };
        candidates.push({
          id: `cand:${template.id}:${group.serviceId}`,
          templateId: template.id,
          type: 'duty',
          params: candidateParams,
        });
      }
    }
    return candidates;
  }

  private collectServiceGaps(stageId: string, activities: Activity[]): ServiceGap[] {
    const byService = new Map<string, ServiceActivity[]>();
    for (const activity of activities) {
      if (this.isBreakActivity(activity)) {
        continue;
      }
      const assignments = this.collectServiceAssignments(activity, stageId);
      if (!assignments.length) {
        continue;
      }
      for (const assignment of assignments) {
        const list = byService.get(assignment.serviceId);
        const entry = { activity, participantKeys: assignment.participantKeys };
        if (list) {
          list.push(entry);
        } else {
          byService.set(assignment.serviceId, [entry]);
        }
      }
    }

    const gaps: ServiceGap[] = [];
    for (const [serviceId, items] of byService.entries()) {
      const sorted = items
        .map((activity) => ({
          activity: activity.activity,
          participantKeys: activity.participantKeys,
          startMs: this.toMs(activity.activity.start),
          endMs: this.toMs(activity.activity.end ?? null),
        }))
        .filter(
          (
            entry,
          ): entry is {
            activity: Activity;
            participantKeys: string[];
            startMs: number;
            endMs: number | null;
          } =>
            entry.startMs !== null,
        )
        .sort((a, b) => {
          if (a.startMs === b.startMs) {
            return (a.endMs ?? a.startMs) - (b.endMs ?? b.startMs);
          }
          return a.startMs - b.startMs;
        });

      for (let index = 0; index < sorted.length - 1; index += 1) {
        const current = sorted[index];
        const next = sorted[index + 1];
        if (current.endMs === null || next.startMs === null) {
          continue;
        }
        const gapMinutes = Math.floor((next.startMs - current.endMs) / 60000);
        if (gapMinutes <= 0) {
          continue;
        }
        const before = current.activity;
        const after = next.activity;
        gaps.push({
          serviceId,
          before,
          after,
          windowStart: before.end ?? before.start,
          windowEnd: after.start,
          gapMinutes,
          fromLocation: this.pickLocation(before, 'to'),
          toLocation: this.pickLocation(after, 'from'),
          participantKeys: this.mergeParticipantKeys(current.participantKeys, next.participantKeys),
        });
      }
    }
    return gaps;
  }

  private collectServiceAssignments(
    activity: Activity,
    stageId: string,
  ): Array<{ serviceId: string; participantKeys: string[] }> {
    const participants = activity.participants ?? [];
    const owners = this.resolveDutyOwners(activity);
    if (!owners.length) {
      return [];
    }
    const startMs = this.toMs(activity.start);
    if (startMs === null) {
      return [];
    }
    const dayKey = this.utcDayKeyFromMs(startMs);
    const assignments = new Map<string, Set<string>>();
    owners.forEach((owner) => {
      const serviceId = this.resolveServiceIdForOwner(activity, stageId, owner, dayKey);
      if (!serviceId) {
        return;
      }
      const ownerParticipants = participants.filter((participant) => participant.resourceId === owner.resourceId);
      const usedParticipants = ownerParticipants.length ? ownerParticipants : [owner];
      this.addParticipantKeys(assignments, serviceId, usedParticipants);
    });

    return Array.from(assignments.entries()).map(([serviceId, keys]) => ({
      serviceId,
      participantKeys: Array.from(keys),
    }));
  }

  private addParticipantKeys(
    assignments: Map<string, Set<string>>,
    serviceId: string,
    participants: ActivityParticipant[],
  ): void {
    if (!serviceId) {
      return;
    }
    const trimmed = serviceId.trim();
    if (!trimmed) {
      return;
    }
    let target = assignments.get(trimmed);
    if (!target) {
      target = new Set();
      assignments.set(trimmed, target);
    }
    this.normalizeParticipants(participants).forEach((key) => {
      target?.add(key);
    });
  }

  private mergeParticipantKeys(...entries: string[][]): string[] {
    const merged = new Set<string>();
    entries.forEach((list) => {
      list.forEach((entry) => {
        const trimmed = entry.trim();
        if (trimmed) {
          merged.add(trimmed);
        }
      });
    });
    return Array.from(merged.values()).sort((a, b) => a.localeCompare(b));
  }

  private collectDutyGroups(snapshot: PlanningStageSnapshot): DutyGroup[] {
    const groups = new Map<string, DutyGroupDraft>();
    for (const activity of snapshot.activities) {
      if (this.isServiceBoundary(activity)) {
        continue;
      }
      const startMs = this.toMs(activity.start);
      if (startMs === null) {
        continue;
      }
      const endMs = this.toMs(activity.end ?? activity.start) ?? startMs;
      const owners = this.resolveDutyOwners(activity);
      if (!owners.length) {
        continue;
      }
      const dayKey = this.utcDayKeyFromMs(startMs);
      for (const owner of owners) {
        const ownerGroup = this.resolveOwnerGroup(owner.kind);
        const serviceId = this.resolveServiceIdForOwner(activity, snapshot.stageId, owner, dayKey);
        const key = serviceId ? `${owner.resourceId}|${owner.kind}|${serviceId}` : `${owner.resourceId}|${owner.kind}|${dayKey}`;
        const existing = groups.get(key);
        if (!existing) {
          groups.set(key, {
            ownerId: owner.resourceId,
            ownerKind: owner.kind,
            ownerRole: owner.role ?? null,
            ownerGroup,
            dayKey,
            serviceId,
            dutyStartMs: startMs,
            dutyEndMs: endMs,
            activityIds: [activity.id],
          });
          continue;
        }
        existing.dutyStartMs = Math.min(existing.dutyStartMs, startMs);
        existing.dutyEndMs = Math.max(existing.dutyEndMs, endMs);
        if (!existing.activityIds.includes(activity.id)) {
          existing.activityIds.push(activity.id);
        }
        if (!existing.ownerRole && owner.role) {
          existing.ownerRole = owner.role;
        }
      }
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      dutyStart: new Date(group.dutyStartMs).toISOString(),
      dutyEnd: new Date(group.dutyEndMs).toISOString(),
      dutySpanMinutes: Math.max(0, Math.round((group.dutyEndMs - group.dutyStartMs) / 60000)),
    }));
  }

  private normalizeParticipants(participants: ActivityParticipant[]): string[] {
    return (participants ?? [])
      .map((entry) => `${entry.kind}|${entry.resourceId}|${entry.role ?? ''}`)
      .sort((a, b) => a.localeCompare(b));
  }

  private pickLocation(activity: Activity, mode: 'from' | 'to'): string | null {
    const trimmed = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');
    const direct = trimmed(mode === 'from' ? activity.from : activity.to);
    if (direct) {
      return direct;
    }
    const fallback = trimmed(activity.locationId);
    if (fallback) {
      return fallback;
    }
    const other = trimmed(mode === 'from' ? activity.to : activity.from);
    return other || null;
  }

  private toMs(value?: string | null): number | null {
    if (!value) {
      return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private utcDayKeyFromMs(ms: number): string {
    const date = new Date(ms);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private computeServiceId(stageId: string, ownerId: string, dayKey: string): string {
    return `svc:${stageId}:${ownerId}:${dayKey}`;
  }

  private asParams(template: RulesetTemplate): Record<string, unknown> {
    const params = template.template.params;
    return params && typeof params === 'object' ? { ...params } : {};
  }

  private pickNumber(params: Record<string, unknown>, key: string, fallback: number): number {
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

  private pickString(params: Record<string, unknown>, key: string): string {
    const raw = params[key];
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private resolveDutyOwners(activity: Activity): ActivityParticipant[] {
    const participants = activity.participants ?? [];
    const preferred = participants.filter((p) => p.kind === 'personnel-service' || p.kind === 'vehicle-service');
    if (preferred.length) {
      return preferred;
    }
    const fallback = participants.filter((p) => p.kind === 'personnel' || p.kind === 'vehicle');
    return fallback.length ? fallback : [];
  }

  private resolveOwnerGroup(kind: ActivityParticipant['kind']): 'personnel' | 'vehicle' {
    if (kind === 'vehicle' || kind === 'vehicle-service') {
      return 'vehicle';
    }
    return 'personnel';
  }

  private resolveServiceIdForOwner(
    activity: Activity,
    stageId: string,
    owner: ActivityParticipant,
    dayKey: string,
  ): string {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const map = attrs?.['service_by_owner'];
    if (map && typeof map === 'object' && !Array.isArray(map)) {
      const entry = (map as Record<string, { serviceId?: string | null } | null>)[owner.resourceId];
      const mapped = typeof entry?.serviceId === 'string' ? entry.serviceId.trim() : '';
      if (mapped) {
        return mapped;
      }
    }
    const direct = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
    if (direct && this.serviceIdMatchesOwner(direct, stageId, owner.resourceId)) {
      return direct;
    }
    return this.computeServiceId(stageId, owner.resourceId, dayKey);
  }

  private serviceIdMatchesOwner(serviceId: string, stageId: string, ownerId: string): boolean {
    return serviceId.startsWith(`svc:${stageId}:${ownerId}:`);
  }

  private isServiceBoundary(activity: Activity): boolean {
    const role = activity.serviceRole ?? null;
    if (role === 'start' || role === 'end') {
      return true;
    }
    const type = (activity.type ?? '').trim();
    if (type === 'service-start' || type === 'service-end' || type === 'vehicle-on' || type === 'vehicle-off') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    if (!attrs) {
      return false;
    }
    return this.toBool(attrs['is_service_start']) || this.toBool(attrs['is_service_end']);
  }

  private isBreakActivity(activity: Activity): boolean {
    const type = (activity.type ?? '').toString().trim();
    if (type === 'break' || type === 'short-break') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    if (!attrs) {
      return false;
    }
    if (this.toBool(attrs['is_break']) || this.toBool(attrs['is_short_break'])) {
      return true;
    }
    const id = activity.id ?? '';
    return id.startsWith('svcbreak:') || id.startsWith('svcshortbreak:');
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
}

type ServiceGap = {
  serviceId: string;
  before: Activity;
  after: Activity;
  windowStart: string;
  windowEnd: string;
  gapMinutes: number;
  fromLocation: string | null;
  toLocation: string | null;
  participantKeys: string[];
};

type ServiceActivity = {
  activity: Activity;
  participantKeys: string[];
};

type DutyGroupDraft = {
  ownerId: string;
  ownerKind: ActivityParticipant['kind'];
  ownerRole: string | null;
  ownerGroup: 'personnel' | 'vehicle';
  dayKey: string;
  serviceId: string;
  dutyStartMs: number;
  dutyEndMs: number;
  activityIds: string[];
};

type DutyGroup = DutyGroupDraft & {
  dutyStart: string;
  dutyEnd: string;
  dutySpanMinutes: number;
};
