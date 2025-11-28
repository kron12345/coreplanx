import { Logger } from '@nestjs/common';
import type {
  ActivityDto,
  ActivityVersionData,
  TimelineServiceDto,
  ClientContext,
  ResourceAssignmentDto,
} from './timeline.types';

export interface TimelineActivityRow {
  id: string;
  type: string;
  stage: 'base' | 'operations';
  start_time: string;
  end_time: string | null;
  is_open_ended: boolean;
  attributes: {
    versions?: {
      version: number;
      validFrom: string;
      validTo: string | null;
      data: ActivityVersionData;
    }[];
  };
}

const RESOURCE_KIND_VALUES: ResourceAssignmentDto['resourceType'][] = [
  'personnel',
  'vehicle',
  'personnel-service',
  'vehicle-service',
];

function normalizeResourceType(
  value?: string | ResourceAssignmentDto['resourceType'] | null,
): ResourceAssignmentDto['resourceType'] {
  if (!value) {
    return 'personnel';
  }
  const canonical = value.toString().trim().toLowerCase().replace(/_/g, '-');
  if (
    RESOURCE_KIND_VALUES.includes(
      canonical as ResourceAssignmentDto['resourceType'],
    )
  ) {
    return canonical as ResourceAssignmentDto['resourceType'];
  }
  return 'personnel';
}

export function pickCurrentVersion(
  versions: TimelineActivityRow['attributes']['versions'],
): { version: number; data: ActivityVersionData } | null {
  if (!versions?.length) {
    return null;
  }
  const current = versions.find((entry) => entry.validTo === null);
  if (current) {
    return { version: current.version, data: current.data };
  }
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const latest = sorted[0];
  return latest ? { version: latest.version, data: latest.data } : null;
}

export function mapActivityRow(
  row: TimelineActivityRow,
  logger?: Logger,
): ActivityDto | null {
  const currentVersion = pickCurrentVersion(row.attributes?.versions ?? []);
  if (!currentVersion) {
    logger?.warn(`Activity ${row.id} without current version – skipping.`);
    return null;
  }
  const normalizedAssignments =
    currentVersion.data.resourceAssignments?.map((assignment) => ({
      ...assignment,
      resourceType: normalizeResourceType(assignment.resourceType ?? null),
    })) ?? [];
  const attributes =
    currentVersion.data.attributes === undefined
      ? undefined
      : currentVersion.data.attributes;
  return {
    id: row.id,
    stage: row.stage,
    type: row.type,
    start: row.start_time,
    end: row.is_open_ended ? null : row.end_time ?? null,
    isOpenEnded: row.is_open_ended || !row.end_time,
    status: currentVersion.data.status ?? undefined,
    label: currentVersion.data.label ?? undefined,
    serviceId: currentVersion.data.serviceId ?? undefined,
    serviceRole: currentVersion.data.serviceRole ?? undefined,
    from: currentVersion.data.from ?? undefined,
    to: currentVersion.data.to ?? undefined,
    remark: currentVersion.data.remark ?? undefined,
    resourceAssignments: normalizedAssignments,
    attributes,
    version: currentVersion.version,
  };
}

export function servicesForActivity(activity: ActivityDto): TimelineServiceDto[] {
  const assignments = activity.resourceAssignments ?? [];
  if (!activity.serviceId || !assignments.length) {
    return [];
  }
  return assignments.map((assignment) => ({
    id: activity.serviceId as string,
    type: activity.type === 'ABSENCE' ? 'ABSENCE' : 'SERVICE',
    stage: activity.stage,
    resourceId: assignment.resourceId,
    start: activity.start,
    end: activity.end ?? null,
    isOpenEnded: activity.isOpenEnded,
    status: activity.status,
    label: activity.label ?? activity.serviceId ?? undefined,
    attributes: { activityCount: 1 },
  }));
}

export function aggregateServices(
  activities: ActivityDto[],
): TimelineServiceDto[] {
  const byServiceResource = new Map<string, TimelineServiceDto>();
  activities.forEach((activity) => {
    servicesForActivity(activity).forEach((service) => {
      const key = `${service.stage}:${service.id}:${service.resourceId}`;
      const startMs = Date.parse(service.start);
      const endMs =
        service.isOpenEnded || !service.end ? undefined : Date.parse(service.end);
      const existing = byServiceResource.get(key);
      if (!existing) {
        byServiceResource.set(key, { ...service });
        return;
      }
      const count = Number(existing.attributes?.activityCount ?? 1) + 1;
      const existingStartMs = Date.parse(existing.start);
      const existingEndMs =
        existing.isOpenEnded || !existing.end
          ? undefined
          : Date.parse(existing.end);
      const newStartMs = Math.min(existingStartMs, startMs);
      const newEndMs =
        existingEndMs === undefined || endMs === undefined
          ? undefined
          : Math.max(existingEndMs, endMs);
      existing.start = new Date(newStartMs).toISOString();
      existing.end =
        newEndMs === undefined ? null : new Date(newEndMs).toISOString();
      existing.isOpenEnded =
        existing.isOpenEnded || service.isOpenEnded || newEndMs === undefined;
      existing.attributes = { ...(existing.attributes ?? {}), activityCount: count };
      byServiceResource.set(key, existing);
    });
  });
  return Array.from(byServiceResource.values());
}

export function overlapsRange(
  start: string,
  end: string | null | undefined,
  ctx: ClientContext,
  isOpenEnded = false,
): boolean {
  const aStart = Date.parse(start);
  const aEnd = isOpenEnded || !end ? undefined : Date.parse(end ?? '');
  const bStart = Date.parse(ctx.subscribedFrom);
  const bEnd = Date.parse(ctx.subscribedTo);
  if (Number.isNaN(aStart) || Number.isNaN(bStart) || Number.isNaN(bEnd)) {
    return false;
  }
  if (aEnd === undefined) {
    return aStart < bEnd;
  }
  return aStart < bEnd && aEnd > bStart;
}
