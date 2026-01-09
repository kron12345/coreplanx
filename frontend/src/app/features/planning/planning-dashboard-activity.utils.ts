import type { ActivityCatalogOption } from './planning-dashboard.types';
import { Activity, ActivityParticipantRole } from '../../models/activity';
import { ActivityLinkRole } from './activity-link-role-dialog.component';
import { Resource } from '../../models/resource';
import { ActivityParticipant } from '../../models/activity';

export function defaultTemplatePeriod(bounds: { startIso: string; endIso: string }) {
  return [
    {
      id: 'default-year',
      validFrom: bounds.startIso,
      validTo: bounds.endIso,
    },
  ];
}

export function buildAttributesFromCatalog(option: ActivityCatalogOption | null): Record<string, unknown> | undefined {
  if (!option) {
    return undefined;
  }
  const attrs: Record<string, unknown> = { activityKey: option.id };
  if (option.templateId) {
    attrs['templateId'] = option.templateId;
  }
  option.attributes.forEach((attr) => {
    const key = (attr?.key ?? '').trim();
    if (!key) {
      return;
    }
    const val = attr.meta?.['value'];
    if (val !== undefined) {
      attrs[key] = val;
    }
  });
  return attrs;
}

export function resolveServiceRole(option: ActivityCatalogOption | null) {
  if (!option) {
    return null;
  }
  const flag = (key: string) => {
    const attr = option.attributes.find((entry) => entry.key === key);
    const val = attr?.meta?.['value'];
    if (typeof val === 'boolean') {
      return val;
    }
    if (typeof val === 'string') {
      return val.toLowerCase() === 'true';
    }
    return false;
  };
  if (flag('is_service_start')) {
    return 'start';
  }
  if (flag('is_service_end')) {
    return 'end';
  }
  return null;
}


export function isActivityOwnedBy(activity: Activity, resourceId: string): boolean {
  const participants = activity.participants ?? [];
  const owner =
    participants.find((entry) => entry.role === 'primary-vehicle' || entry.role === 'primary-personnel') ??
    participants[0] ??
    null;
  return owner?.resourceId === resourceId;
}

export function serviceIdForOwner(activity: Activity, ownerId: string | null | undefined): string | null {
  const trimmedOwner = (ownerId ?? '').trim();
  if (!trimmedOwner) {
    return activity.serviceId ?? null;
  }
  const attrs = activity.attributes as Record<string, unknown> | undefined;
  const rawMap = attrs?.['service_by_owner'];
  if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
    const entry = (rawMap as Record<string, any>)[trimmedOwner];
    const rawServiceId = entry?.serviceId;
    if (typeof rawServiceId === 'string' && rawServiceId.trim().length) {
      return rawServiceId.trim();
    }
  }
  return activity.serviceId ?? null;
}

export function findNeighborActivities(
  activity: Activity,
  activities: Activity[],
  ownerId: string | null,
): { previous: Activity | null; next: Activity | null } {
  const serviceId = serviceIdForOwner(activity, ownerId);
  const role = activity.serviceRole ?? null;
  const attrs = activity.attributes as Record<string, unknown> | undefined;
  const toBool = (value: unknown) =>
    typeof value === 'boolean' ? value : typeof value === 'string' ? value.toLowerCase() === 'true' : false;
  const isServiceBoundary =
    role === 'start' ||
    role === 'end' ||
    toBool(attrs?.['is_service_start']) ||
    toBool(attrs?.['is_service_end']);
  const requireServiceMatch = !!serviceId && !isServiceBoundary;
  if (!ownerId) {
    return { previous: null, next: null };
  }
  const targetStartMs = new Date(activity.start).getTime();
  const targetEndMs = activity.end ? new Date(activity.end).getTime() : targetStartMs;
  if (!Number.isFinite(targetStartMs) || !Number.isFinite(targetEndMs)) {
    return { previous: null, next: null };
  }

  let previous: Activity | null = null;
  let next: Activity | null = null;
  let previousEndMs = Number.NEGATIVE_INFINITY;
  let nextStartMs = Number.POSITIVE_INFINITY;

  activities.forEach((entry) => {
    if (entry.id === activity.id) {
      return;
    }
    if (!isActivityOwnedBy(entry, ownerId)) {
      return;
    }
    if (requireServiceMatch && serviceIdForOwner(entry, ownerId) !== serviceId) {
      return;
    }
    const startMs = new Date(entry.start).getTime();
    const endMs = entry.end ? new Date(entry.end).getTime() : startMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return;
    }
    if (endMs <= targetStartMs && endMs > previousEndMs) {
      previous = entry;
      previousEndMs = endMs;
    }
    if (startMs >= targetEndMs && startMs < nextStartMs) {
      next = entry;
      nextStartMs = startMs;
    }
  });

  return { previous, next };
}

export function mapLinkRoleToParticipantRole(role: ActivityLinkRole): ActivityParticipantRole {
  if (role === 'teacher' || role === 'student') {
    return role;
  }
  return 'secondary-personnel';
}

export function computeAssignmentCandidatesFor(resource: Resource, resources: Resource[]): Resource[] {
  if (resource.kind === 'personnel-service') {
    return resources.filter((entry) => entry.kind === 'personnel');
  }
  if (resource.kind === 'vehicle-service') {
    return resources.filter((entry) => entry.kind === 'vehicle');
  }
  return [];
}

export function applyParticipantRoleUpdates(
  activity: Activity,
  updates: Array<{ resourceId: string | null | undefined; role: ActivityParticipantRole | null | undefined }>,
): Activity {
  if (!updates.length) {
    return activity;
  }
  const roleMap = new Map(
    updates
      .filter((entry) => !!entry.role && !!entry.resourceId)
      .map((entry) => [entry.resourceId, entry.role as ActivityParticipantRole]),
  );
  if (roleMap.size === 0) {
    return activity;
  }
  let changed = false;
  const participants = (activity.participants ?? []).map((participant) => {
    const nextRole = roleMap.get(participant.resourceId);
    if (!nextRole || participant.role === nextRole) {
      return participant;
    }
    changed = true;
    return {
      ...participant,
      role: nextRole,
    } as ActivityParticipant;
  });
  return changed ? { ...activity, participants } : activity;
}

export function buildActivityTitle(label?: string | null): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length ? trimmed : 'Aktivität';
}

export function definitionAppliesToResource(option: ActivityCatalogOption, resource: Resource): boolean {
  const relevant = option.relevantFor ?? [];
  return relevant.length ? relevant.includes(resource.kind) : true;
}

export function resolveActivityTypeForResource(
  resource: Resource,
  requestedId: string | null | undefined,
  options: ActivityCatalogOption[],
): ActivityCatalogOption | null {
  if (requestedId) {
    const requested = options.find(
      (option) => option.activityTypeId === requestedId && definitionAppliesToResource(option, resource),
    );
    if (requested) {
      return requested;
    }
  }
  return options.find((option) => definitionAppliesToResource(option, resource)) ?? null;
}

export function resolveServiceCategory(
  resource: Resource,
): 'personnel-service' | 'vehicle-service' | undefined {
  if (resource.kind === 'personnel' || resource.kind === 'personnel-service') {
    return 'personnel-service';
  }
  if (resource.kind === 'vehicle' || resource.kind === 'vehicle-service') {
    return 'vehicle-service';
  }
  return undefined;
}
