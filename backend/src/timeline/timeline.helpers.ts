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
  start_time: string | Date;
  end_time: string | Date | null;
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

  const normalizeIso = (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? value.toISOString() : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const ms = Date.parse(trimmed);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : trimmed;
    }
    const asString = `${value ?? ''}`.trim();
    if (!asString) {
      return null;
    }
    const ms = Date.parse(asString);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : asString;
  };

  const startIso = normalizeIso(row.start_time);
  if (!startIso) {
    logger?.warn(`Activity ${row.id} without valid start_time – skipping.`);
    return null;
  }
  const endIso = normalizeIso(row.end_time);

  const normalizedAssignments =
    currentVersion.data.resourceAssignments?.map((assignment) => ({
      ...assignment,
      resourceType: normalizeResourceType(assignment.resourceType ?? null),
    })) ?? [];
  const attributes =
    currentVersion.data.attributes === undefined
      ? undefined
      : currentVersion.data.attributes;
  const serviceRole =
    currentVersion.data.serviceRole ??
    deriveServiceRoleFromAttributes(
      (currentVersion.data.attributes ?? undefined) as
        | Record<string, unknown>
        | undefined,
    );
  const serviceId =
    currentVersion.data.serviceId ??
    deriveServiceIdFallback(
      serviceRole,
      (currentVersion.data.attributes ?? undefined) as
        | Record<string, unknown>
        | undefined,
      row.id,
    );
  return {
    id: row.id,
    stage: row.stage,
    type: row.type,
    start: startIso,
    end: row.is_open_ended ? null : (endIso ?? null),
    isOpenEnded: row.is_open_ended || !endIso,
    status: currentVersion.data.status ?? undefined,
    label: currentVersion.data.label ?? undefined,
    serviceId: serviceId ?? undefined,
    serviceRole: serviceRole ?? undefined,
    from: currentVersion.data.from ?? undefined,
    to: currentVersion.data.to ?? undefined,
    remark: currentVersion.data.remark ?? undefined,
    resourceAssignments: normalizedAssignments,
    attributes,
    version: currentVersion.version,
  };
}

function deriveServiceRoleFromAttributes(
  attrs: Record<string, unknown> | undefined,
): 'start' | 'end' | 'segment' | undefined {
  if (!attrs) {
    return undefined;
  }
  const toBool = (val: unknown) =>
    typeof val === 'boolean'
      ? val
      : typeof val === 'string'
        ? val.toLowerCase() === 'true'
        : false;
  if (toBool((attrs as any)['is_service_start'])) {
    return 'start';
  }
  if (toBool((attrs as any)['is_service_end'])) {
    return 'end';
  }
  return undefined;
}

function deriveServiceIdFallback(
  role: 'start' | 'end' | 'segment' | undefined,
  attrs: Record<string, unknown> | undefined,
  activityId: string,
): string | undefined {
  if (!role) {
    return undefined;
  }
  const candidate =
    (attrs as any)?.['service_id'] &&
    typeof (attrs as any)['service_id'] === 'string'
      ? ((attrs as any)['service_id'] as string)
      : undefined;
  return candidate ?? activityId;
}

export function servicesForActivity(
  activity: ActivityDto,
): TimelineServiceDto[] {
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
        service.isOpenEnded || !service.end
          ? undefined
          : Date.parse(service.end);
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
      existing.attributes = {
        ...(existing.attributes ?? {}),
        activityCount: count,
      };
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
