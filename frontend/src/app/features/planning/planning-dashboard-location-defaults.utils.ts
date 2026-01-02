import { ActivityTypeDefinition } from '../../core/services/activity-type.service';
import type { ActivityAttributeValue } from '../../core/services/activity-catalog.service';
import { Activity } from '../../models/activity';
import { findNeighborActivities } from './planning-dashboard-activity.utils';

export type ActivityLocationMode = 'fix' | 'previous' | 'next';

export interface ActivityLocationFieldDefaults {
  mode: ActivityLocationMode;
  hidden: boolean;
}

export interface ActivityLocationDefinition {
  type: ActivityTypeDefinition | null;
  attributes?: ActivityAttributeValue[] | null;
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

function readAttributeValue(
  attributes: ActivityAttributeValue[] | null | undefined,
  key: string,
): unknown {
  const entry = attributes?.find((attr) => attr.key === key);
  const meta = entry?.meta ?? null;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  if ('value' in meta) {
    return (meta as Record<string, unknown>)['value'];
  }
  return undefined;
}

function readTypeAttributeValue(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!attributes || typeof attributes !== 'object') {
    return undefined;
  }
  return attributes[key];
}

export function locationFieldDefaults(
  definition: ActivityLocationDefinition | null,
  field: 'from' | 'to',
): ActivityLocationFieldDefaults {
  const attrs = definition?.attributes ?? null;
  const typeAttrs = definition?.type?.attributes ?? null;
  const hiddenKey = field === 'from' ? 'from_hidden' : 'to_hidden';
  const modeKey = field === 'from' ? 'from_location_mode' : 'to_location_mode';
  const hiddenRaw =
    readAttributeValue(attrs, hiddenKey) ?? readTypeAttributeValue(typeAttrs, hiddenKey);
  const modeRaw =
    readAttributeValue(attrs, modeKey) ?? readTypeAttributeValue(typeAttrs, modeKey);
  const hidden = readBool(hiddenRaw);
  const mode = readMode(modeRaw);
  return { hidden, mode };
}

export function isLocationFieldHidden(
  definition: ActivityLocationDefinition | null,
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
  definition: ActivityLocationDefinition | null;
  activities: Activity[];
  ownerId: string | null;
}): Activity {
  const { activity, definition, activities, ownerId } = options;
  if (!definition?.type || !ownerId) {
    return activity;
  }

  const hasFrom = definition.type.fields.includes('from');
  const hasTo = definition.type.fields.includes('to');
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
