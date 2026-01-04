import type { Activity, ActivityParticipant } from '../../models/activity';
import type { Resource } from '../../models/resource';
import { addDays } from '../../core/utils/time-math';
import type {
  ActivityBatchMutationRequest,
  ResourceBatchMutationRequest,
} from '../../core/api/activity-api.types';
import type { ResourceSnapshotDto } from '../../core/api/planning-resource-api.service';
import type { PlanningStageData, PlanningTimelineRange } from './planning-data.types';

export interface ActivityDiff extends ActivityBatchMutationRequest {
  hasChanges: boolean;
}

export interface ResourceDiff extends ResourceBatchMutationRequest {
  hasChanges: boolean;
}

export function defaultTimeline(): PlanningTimelineRange {
  const start = new Date();
  const end = addDays(start, 7);
  return { start, end };
}

export function createEmptyStageData(): PlanningStageData {
  return {
    resources: [],
    activities: [],
    timelineRange: defaultTimeline(),
    version: null,
  };
}

export function cloneResources(resources: Resource[]): Resource[] {
  return resources.map((resource) => ({
    ...resource,
    attributes: resource.attributes ? { ...resource.attributes } : undefined,
  }));
}

export function cloneActivities(activities: Activity[]): Activity[] {
  return activities.map((activity) => ({
    ...activity,
    participants: activity.participants
      ? activity.participants.map((participant) => ({ ...participant }))
      : undefined,
    requiredQualifications: activity.requiredQualifications ? [...activity.requiredQualifications] : undefined,
    assignedQualifications: activity.assignedQualifications ? [...activity.assignedQualifications] : undefined,
    workRuleTags: activity.workRuleTags ? [...activity.workRuleTags] : undefined,
    attributes: activity.attributes ? { ...activity.attributes } : undefined,
    meta: activity.meta ? { ...activity.meta } : undefined,
  }));
}

export function cloneTimelineRange(range: PlanningTimelineRange): PlanningTimelineRange {
  return {
    start: new Date(range.start),
    end: new Date(range.end),
  };
}

export function cloneResourceSnapshot(snapshot: ResourceSnapshotDto): ResourceSnapshotDto {
  return JSON.parse(JSON.stringify(snapshot)) as ResourceSnapshotDto;
}

export function rangesEqual(a: PlanningTimelineRange, b: PlanningTimelineRange): boolean {
  return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();
}

export function normalizeTimelineRange(range: PlanningTimelineRange): PlanningTimelineRange {
  if (range.end.getTime() <= range.start.getTime()) {
    return {
      start: range.start,
      end: addDays(range.start, 1),
    };
  }
  return range;
}

export function normalizeActivityParticipants(activities: Activity[], resources: Resource[]): Activity[] {
  if (!activities.length) {
    return activities;
  }
  const resourceKindMap = new Map<string, Resource['kind']>();
  resources.forEach((resource) => resourceKindMap.set(resource.id, resource.kind));

  const ensureKind = (resourceId: string, fallbackKind: Resource['kind'] = 'personnel'): Resource['kind'] => {
    return resourceKindMap.get(resourceId) ?? fallbackKind;
  };

  return activities.map((activity) => {
    const participantsMap = new Map<string, ActivityParticipant>();
    const existing = activity.participants ?? [];
    existing.forEach((participant) => {
      if (!participant?.resourceId) {
        return;
      }
      participantsMap.set(participant.resourceId, {
        ...participant,
        kind: participant.kind ?? ensureKind(participant.resourceId),
      });
    });

    const participants = Array.from(participantsMap.values());
    return {
      ...activity,
      participants,
    };
  });
}

export function cloneStageData(stage: PlanningStageData): PlanningStageData {
  return {
    resources: cloneResources(stage.resources),
    activities: cloneActivities(normalizeActivityParticipants(stage.activities, stage.resources)),
    timelineRange: cloneTimelineRange(stage.timelineRange),
    version: stage.version,
  };
}

export function normalizeStage(stage: PlanningStageData): PlanningStageData {
  return {
    ...stage,
    resources: cloneResources(stage.resources),
    activities: cloneActivities(stage.activities),
    timelineRange: normalizeTimelineRange(cloneTimelineRange(stage.timelineRange)),
  };
}

export function diffActivities(previous: Activity[], next: Activity[]): ActivityDiff {
  const previousMap = new Map(previous.map((activity) => [activity.id, activity]));
  const nextMap = new Map(next.map((activity) => [activity.id, activity]));
  const upserts: Activity[] = [];
  const deleteIds: string[] = [];

  next.forEach((activity) => {
    const before = previousMap.get(activity.id);
    if (!before || !activitiesEqual(before, activity)) {
      upserts.push(activity);
    }
  });

  previous.forEach((activity) => {
    if (!nextMap.has(activity.id)) {
      deleteIds.push(activity.id);
    }
  });

  return {
    upserts: upserts.length > 0 ? upserts : undefined,
    deleteIds: deleteIds.length > 0 ? deleteIds : undefined,
    clientRequestId: `activity-sync-${Date.now().toString(36)}`,
    hasChanges: upserts.length > 0 || deleteIds.length > 0,
  };
}

export function diffResources(previous: Resource[], next: Resource[]): ResourceDiff {
  const previousMap = new Map(previous.map((resource) => [resource.id, resource]));
  const nextMap = new Map(next.map((resource) => [resource.id, resource]));
  const upserts: Resource[] = [];
  const deleteIds: string[] = [];

  next.forEach((resource) => {
    const before = previousMap.get(resource.id);
    if (!before || !resourcesEqual(before, resource)) {
      upserts.push(resource);
    }
  });

  previous.forEach((resource) => {
    if (!nextMap.has(resource.id)) {
      deleteIds.push(resource.id);
    }
  });

  return {
    upserts: upserts.length > 0 ? upserts : undefined,
    deleteIds: deleteIds.length > 0 ? deleteIds : undefined,
    clientRequestId: `resource-sync-${Date.now().toString(36)}`,
    hasChanges: upserts.length > 0 || deleteIds.length > 0,
  };
}

export function resourceListsEqual(a: Resource[], b: Resource[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (!resourcesEqual(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

export function mergeResourceList(existing: Resource[], upserts: Resource[], deleteIds: string[]): Resource[] {
  if (upserts.length === 0 && deleteIds.length === 0) {
    return existing;
  }
  const map = new Map(existing.map((resource) => [resource.id, resource]));
  let mutated = false;

  deleteIds.forEach((id) => {
    if (map.delete(id)) {
      mutated = true;
    }
  });

  const clonedUpserts = cloneResources(upserts);
  clonedUpserts.forEach((resource) => {
    const before = map.get(resource.id);
    if (!before || !resourcesEqual(before, resource)) {
      map.set(resource.id, resource);
      mutated = true;
    }
  });

  return mutated ? Array.from(map.values()) : existing;
}

export function mergeActivityList(existing: Activity[], upserts: Activity[], deleteIds: string[]): Activity[] {
  if (upserts.length === 0 && deleteIds.length === 0) {
    return existing;
  }
  const map = new Map(existing.map((activity) => [activity.id, activity]));
  let mutated = false;

  deleteIds.forEach((id) => {
    if (map.delete(id)) {
      mutated = true;
    }
  });

  const clonedUpserts = cloneActivities(upserts).map((activity) => {
    const before = map.get(activity.id);
    if (before?.rowVersion && (activity.rowVersion === null || activity.rowVersion === undefined)) {
      return { ...activity, rowVersion: before.rowVersion };
    }
    return activity;
  });
  clonedUpserts.forEach((activity) => {
    const before = map.get(activity.id);
    if (!before || !activitiesEqual(before, activity)) {
      map.set(activity.id, activity);
      mutated = true;
    }
  });

  return mutated ? Array.from(map.values()) : existing;
}

export function convertIncomingTimelineRange(
  range: PlanningTimelineRange | { start: string | Date; end: string | Date },
): PlanningTimelineRange {
  const start = range.start instanceof Date ? range.start : new Date(range.start);
  const end = range.end instanceof Date ? range.end : new Date(range.end);
  return { start, end };
}

function resourcesEqual(a: Resource, b: Resource): boolean {
  const normalizedA = normalizeResourceForComparison(a);
  const normalizedB = normalizeResourceForComparison(b);
  return JSON.stringify(normalizedA) === JSON.stringify(normalizedB);
}

function normalizeResourceForComparison(resource: Resource): Record<string, unknown> {
  return {
    id: resource.id,
    name: resource.name,
    kind: resource.kind,
    dailyServiceCapacity: resource.dailyServiceCapacity ?? null,
    attributes: sortObject(resource.attributes ?? null),
  };
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObject(entry));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const sorted: Record<string, unknown> = {};
    entries.forEach(([key, val]) => {
      sorted[key] = sortObject(val);
    });
    return sorted;
  }
  return value;
}

function activitiesEqual(a: Activity, b: Activity): boolean {
  const normalizedA = normalizeActivityForComparison(a);
  const normalizedB = normalizeActivityForComparison(b);
  return JSON.stringify(normalizedA) === JSON.stringify(normalizedB);
}

function normalizeActivityForComparison(activity: Activity): Record<string, unknown> {
  return {
    ...activity,
    requiredQualifications: activity.requiredQualifications ? [...activity.requiredQualifications].sort() : undefined,
    assignedQualifications: activity.assignedQualifications ? [...activity.assignedQualifications].sort() : undefined,
    workRuleTags: activity.workRuleTags ? [...activity.workRuleTags].sort() : undefined,
    participants: activity.participants
      ? [...activity.participants].sort((a, b) => a.resourceId.localeCompare(b.resourceId))
      : undefined,
    attributes: sortObject(activity.attributes ?? null),
    meta: sortObject(activity.meta ?? null),
  };
}
