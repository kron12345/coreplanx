import { ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { Activity } from '../../models/activity';
import { findNeighborActivities } from './planning-dashboard-activity.utils';

export type ActivityLocationMode = 'fix' | 'previous' | 'next';

export interface ActivityLocationFieldDefaults {
  mode: ActivityLocationMode;
  hidden: boolean;
}

function readBool(raw: unknown): boolean {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1';
  }
  return false;
}

function readMode(raw: unknown): ActivityLocationMode {
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (normalized === 'previous' || normalized === 'next' || normalized === 'fix') {
    return normalized as ActivityLocationMode;
  }
  return 'fix';
}

export function locationFieldDefaults(
  definition: ActivityTypeDefinition | null,
  field: 'from' | 'to',
): ActivityLocationFieldDefaults {
  const attrs = definition?.attributes ?? null;
  const hiddenKey = field === 'from' ? 'from_hidden' : 'to_hidden';
  const modeKey = field === 'from' ? 'from_location_mode' : 'to_location_mode';
  const hidden = readBool(attrs?.[hiddenKey]);
  const mode = readMode(attrs?.[modeKey]);
  return { hidden, mode };
}

export function isLocationFieldHidden(
  definition: ActivityTypeDefinition | null,
  field: 'from' | 'to',
): boolean {
  return locationFieldDefaults(definition, field).hidden;
}

function normalizeValue(raw: unknown): string {
  return (raw ?? '').toString().trim();
}

function readPreviousEndLocation(activity: Activity | null): string | null {
  if (!activity) {
    return null;
  }
  return (
    normalizeValue(activity.locationId) ||
    normalizeValue(activity.to) ||
    normalizeValue(activity.from) ||
    null
  );
}

function readNextStartLocation(activity: Activity | null): string | null {
  if (!activity) {
    return null;
  }
  return (
    normalizeValue(activity.locationId) ||
    normalizeValue(activity.from) ||
    normalizeValue(activity.to) ||
    null
  );
}

export function applyLocationDefaults(options: {
  activity: Activity;
  definition: ActivityTypeDefinition | null;
  activities: Activity[];
  ownerId: string | null;
}): Activity {
  const { activity, definition, activities, ownerId } = options;
  if (!definition || !ownerId) {
    return activity;
  }

  const hasFrom = definition.fields.includes('from');
  const hasTo = definition.fields.includes('to');
  if (!hasFrom && !hasTo) {
    return activity;
  }

  const fromDefaults = locationFieldDefaults(definition, 'from');
  const toDefaults = locationFieldDefaults(definition, 'to');
  const fromCurrent = normalizeValue(activity.from);
  const toCurrent = normalizeValue(activity.to);

  const shouldRecomputeFrom = hasFrom && (fromDefaults.hidden || !fromCurrent);
  const shouldRecomputeTo = hasTo && (toDefaults.hidden || !toCurrent);
  if (!shouldRecomputeFrom && !shouldRecomputeTo) {
    return activity;
  }

  const { previous, next } = findNeighborActivities(activity, activities, ownerId);
  const previousEnd = readPreviousEndLocation(previous);
  const nextStart = readNextStartLocation(next);

  let nextFrom = fromCurrent;
  let nextTo = toCurrent;

  if (shouldRecomputeFrom) {
    if (fromDefaults.mode === 'previous') {
      nextFrom = previousEnd ?? '';
    } else if (fromDefaults.mode === 'next' && toDefaults.hidden) {
      nextFrom = nextStart ?? '';
    }
  }

  if (shouldRecomputeTo) {
    if (toDefaults.mode === 'next') {
      nextTo = nextStart ?? '';
    } else if (toDefaults.mode === 'previous' && fromDefaults.hidden) {
      nextTo = previousEnd ?? '';
    }
  }

  if (shouldRecomputeFrom && fromDefaults.mode === 'next' && !toDefaults.hidden) {
    nextFrom = nextTo;
  }

  if (shouldRecomputeTo && toDefaults.mode === 'previous' && !fromDefaults.hidden) {
    nextTo = nextFrom;
  }

  nextFrom = nextFrom.trim();
  nextTo = nextTo.trim();

  const nextActivity: Activity = {
    ...activity,
    ...(hasFrom ? { from: nextFrom } : {}),
    ...(hasTo ? { to: nextTo } : {}),
  };

  const changed = (activity.from ?? '') !== (nextActivity.from ?? '') || (activity.to ?? '') !== (nextActivity.to ?? '');
  return changed ? nextActivity : activity;
}

