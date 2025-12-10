import { ActivityCategory } from '../../core/services/activity-type.service';
import { Activity, ActivityParticipantRole } from '../../models/activity';
import { ActivityLinkRole } from './activity-link-role-dialog.component';
import { Resource } from '../../models/resource';
import { ActivityParticipant } from '../../models/activity';
import { ActivityCatalogOption } from './planning-dashboard.types';

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
  const colorKeys = ['color', 'bar_color', 'display_color', 'main_color'];
  const hasColor = colorKeys.some((key) => typeof attrs[key] === 'string' && (attrs[key] as string).trim().length > 0);
  if (!hasColor) {
    const fallback = defaultColorForType(option.activityTypeId, option.typeDefinition.category);
    if (fallback) {
      attrs['color'] = fallback;
    }
  }
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

export function defaultColorForType(typeId: string | null, category?: ActivityCategory | null): string | null {
  const type = typeId?.toLowerCase() ?? '';
  if (type.includes('break') || type.includes('pause')) {
    return '#ffb74d';
  }
  if (type.includes('travel') || type.includes('fahrt')) {
    return '#26a69a';
  }
  if (type.includes('transfer')) {
    return '#26c6da';
  }
  if (type.includes('service-start')) {
    return '#43a047';
  }
  if (type.includes('service-end')) {
    return '#c62828';
  }
  if (category === 'movement') {
    return '#26c6da';
  }
  if (category === 'rest') {
    return '#8d6e63';
  }
  if (category === 'other') {
    return '#7b1fa2';
  }
  return '#1976d2';
}

export function isActivityOwnedBy(activity: Activity, resourceId: string): boolean {
  const participants = activity.participants ?? [];
  const owner =
    participants.find((entry) => entry.role === 'primary-vehicle' || entry.role === 'primary-personnel') ??
    participants[0] ??
    null;
  return owner?.resourceId === resourceId;
}

export function findNeighborActivities(
  activity: Activity,
  activities: Activity[],
  ownerId: string | null,
): { previous: Activity | null; next: Activity | null } {
  const serviceId = activity.serviceId ?? null;
  const role = activity.serviceRole ?? null;
  const type = activity.type ?? '';
  const isServiceBoundary = role === 'start' || role === 'end' || type === 'service-start' || type === 'service-end';
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
    if (requireServiceMatch && entry.serviceId !== serviceId) {
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
