import type { Activity } from '../../models/activity';
import type { TemplatePeriod } from '../../core/api/timeline-api.types';
import { readActivityGroupMetaFromAttributes, stripDayScope, writeActivityGroupMetaToAttributes } from './planning-activity-group.utils';

export function reflectBaseActivities(options: {
  activities: Activity[];
  periods: TemplatePeriod[];
  specialDays: ReadonlySet<string>;
  viewStart: Date | null;
  viewEnd: Date | null;
  defaultPeriodEnd: Date | null;
}): Activity[] {
  const { activities, periods, specialDays, viewStart, viewEnd, defaultPeriodEnd } = options;
  if (!periods.length) {
    return activities;
  }
  if (!defaultPeriodEnd) {
    return activities;
  }

  const reflected: Activity[] = [];

  periods.forEach((period) => {
    const periodStart = new Date(period.validFrom);
    const periodEnd = period.validTo ? new Date(period.validTo) : defaultPeriodEnd;
    const windowStart = viewStart && viewStart > periodStart ? viewStart : periodStart;
    const windowEnd = viewEnd && viewEnd < periodEnd ? viewEnd : periodEnd;
    if (windowEnd < windowStart) {
      return;
    }

    activities.forEach((activity) => {
      const startTime = new Date(activity.start);
      const endTime = activity.end ? new Date(activity.end) : null;
      const weekday = startTime.getUTCDay();
      const timeMs =
        startTime.getUTCHours() * 3600_000 +
        startTime.getUTCMinutes() * 60_000 +
        startTime.getUTCSeconds() * 1000 +
        startTime.getUTCMilliseconds();
      const endMs = endTime
        ? endTime.getUTCHours() * 3600_000 +
          endTime.getUTCMinutes() * 60_000 +
          endTime.getUTCSeconds() * 1000 +
          endTime.getUTCMilliseconds()
        : null;

      const first = alignToWeekday(windowStart, weekday);
      if (!first || first > windowEnd) {
        return;
      }

        for (let cursor = first; cursor <= windowEnd; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
          const iso = cursor.toISOString().slice(0, 10);
          if (specialDays.has(iso)) {
            continue;
          }
        const baseDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));
        const newStart = new Date(baseDay);
        newStart.setUTCMilliseconds(newStart.getUTCMilliseconds() + timeMs);
        let newEnd: Date | null = null;
        if (endMs !== null) {
          newEnd = new Date(baseDay);
          newEnd.setUTCMilliseconds(newEnd.getUTCMilliseconds() + endMs);
        }
        const groupMeta = readActivityGroupMetaFromAttributes(activity.attributes ?? undefined);
        const attachedTo = stripDayScope(groupMeta?.attachedToActivityId ?? null);
        const updatedAttributes =
          attachedTo && groupMeta
            ? writeActivityGroupMetaToAttributes(activity.attributes ?? undefined, {
                ...groupMeta,
                attachedToActivityId: `${attachedTo}@${iso}`,
              })
            : activity.attributes;

        reflected.push({
          ...activity,
          id: `${activity.id}@${iso}`,
          start: newStart.toISOString(),
          end: newEnd ? newEnd.toISOString() : null,
          attributes: updatedAttributes,
        });
      }
    });
  });

  return reflected;
}

export function reflectManagedServiceBoundaries(options: {
  activities: Activity[];
  periods: TemplatePeriod[];
  specialDays: ReadonlySet<string>;
  viewStart: Date | null;
  viewEnd: Date | null;
  defaultPeriodEnd: Date | null;
}): { reflected: Activity[]; sourceIds: string[] } {
  const { activities, periods, specialDays, viewStart, viewEnd, defaultPeriodEnd } = options;
  if (!periods.length || !defaultPeriodEnd) {
    return { reflected: [], sourceIds: [] };
  }

  const boundaryEntries = activities
    .filter((activity) => isServiceBoundary(activity))
    .map((activity) => buildBoundaryTemplate(activity))
    .filter((entry): entry is BoundaryTemplate => !!entry);

  if (!boundaryEntries.length) {
    return { reflected: [], sourceIds: [] };
  }

  const templateActivities = boundaryEntries.map((entry) => entry.activity);
  const reflected = reflectBaseActivities({
    activities: templateActivities,
    periods,
    specialDays,
    viewStart,
    viewEnd,
    defaultPeriodEnd,
  });

  const metaByBaseId = new Map(
    boundaryEntries.map((entry) => [entry.activity.id, entry.meta] as const),
  );
  const resolved = reflected.map((activity) => {
    const baseId = activity.id.split('@')[0] ?? activity.id;
    const meta = metaByBaseId.get(baseId);
    if (!meta) {
      return activity;
    }
    const iso = activity.start.slice(0, 10);
    const serviceId = iso
      ? `svc:${meta.stageId}:${meta.ownerId}:${iso}`
      : null;
    return {
      ...activity,
      serviceId: serviceId ?? activity.serviceId,
      serviceRole: activity.serviceRole ?? meta.role,
    };
  });

  return { reflected: resolved, sourceIds: boundaryEntries.map((entry) => entry.sourceId) };
}

function alignToWeekday(date: Date, weekday: number): Date | null {
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const result = new Date(date);
  const diff = (weekday - result.getUTCDay() + 7) % 7;
  result.setUTCDate(result.getUTCDate() + diff);
  return result;
}

type BoundaryTemplateMeta = { stageId: string; ownerId: string; role: 'start' | 'end' };
type BoundaryTemplate = { sourceId: string; activity: Activity; meta: BoundaryTemplateMeta };

function isServiceBoundary(activity: Activity): boolean {
  const role = activity.serviceRole ?? null;
  const type = (activity.type ?? '').toString().trim();
  const id = (activity.id ?? '').toString();
  if (role === 'start' || role === 'end') {
    return true;
  }
  if (type === 'service-start' || type === 'service-end') {
    return true;
  }
  return id.startsWith('svcstart:') || id.startsWith('svcend:');
}

function buildBoundaryTemplate(activity: Activity): BoundaryTemplate | null {
  const serviceId = extractServiceId(activity);
  const parts = serviceId ? parseServiceId(serviceId) : null;
  const ownerId = parts?.ownerId ?? resolveServiceOwner(activity);
  if (!ownerId) {
    return null;
  }
  const stageId = parts?.stageId ?? 'base';
  const role = normalizeServiceRole(activity);
  if (!role) {
    return null;
  }
  const baseId = `${role === 'start' ? 'svcstart' : 'svcend'}:svc:${stageId}:${ownerId}`;
  const template: Activity = {
    ...activity,
    id: baseId,
    serviceId: null,
    serviceRole: role,
  };
  return { sourceId: activity.id, activity: template, meta: { stageId, ownerId, role } };
}

function extractServiceId(activity: Activity): string | null {
  const direct = typeof activity.serviceId === 'string' ? activity.serviceId.trim() : '';
  if (direct.startsWith('svc:')) {
    return direct;
  }
  const id = (activity.id ?? '').toString();
  if (id.startsWith('svcstart:')) {
    return id.slice('svcstart:'.length).trim() || null;
  }
  if (id.startsWith('svcend:')) {
    return id.slice('svcend:'.length).trim() || null;
  }
  return null;
}

function parseServiceId(serviceId: string): { stageId: string; ownerId: string; dayKey: string } | null {
  const trimmed = serviceId.trim();
  if (!trimmed.startsWith('svc:')) {
    return null;
  }
  const parts = trimmed.split(':');
  if (parts.length < 4) {
    return null;
  }
  const stageId = parts[1] ?? '';
  const ownerId = parts[2] ?? '';
  const dayKey = parts[parts.length - 1] ?? '';
  if (!stageId || !ownerId || !dayKey) {
    return null;
  }
  return { stageId, ownerId, dayKey };
}

function resolveServiceOwner(activity: Activity): string | null {
  const participants = activity.participants ?? [];
  const owner =
    participants.find(
      (participant) =>
        participant.resourceId &&
        (participant.kind === 'personnel-service' || participant.kind === 'vehicle-service'),
    ) ?? null;
  return owner?.resourceId ?? null;
}

function normalizeServiceRole(activity: Activity): 'start' | 'end' | null {
  const role = activity.serviceRole ?? null;
  if (role === 'start' || role === 'end') {
    return role;
  }
  const type = (activity.type ?? '').toString().trim();
  if (type === 'service-start') {
    return 'start';
  }
  if (type === 'service-end') {
    return 'end';
  }
  return null;
}
