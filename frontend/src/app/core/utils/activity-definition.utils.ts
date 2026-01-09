import type { ActivityCategory, ActivityFieldKey, ActivityTimeMode } from '../models/activity-definition';
import type { ActivityAttributeValue } from '../services/activity-catalog.service';
import type { ResourceKind } from '../../models/resource';

const FIELD_PREFIX = 'field:';

export function readAttributeValue(
  attributes: ActivityAttributeValue[] | null | undefined,
  key: string,
): string | null {
  const entry = attributes?.find((attr) => attr.key === key);
  const raw = entry?.meta?.['value'];
  if (raw === undefined || raw === null) {
    return null;
  }
  const normalized = raw.toString().trim();
  return normalized.length ? normalized : null;
}

export function readAttributeBoolean(
  attributes: ActivityAttributeValue[] | null | undefined,
  key: string,
): boolean {
  const raw = readAttributeValue(attributes, key);
  if (!raw) {
    return false;
  }
  const normalized = raw.toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'ja';
}

export function readAttributeNumber(
  attributes: ActivityAttributeValue[] | null | undefined,
  key: string,
): number | null {
  const raw = readAttributeValue(attributes, key);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : null;
}

export function readAttributeList(
  attributes: ActivityAttributeValue[] | null | undefined,
  key: string,
): string[] {
  const raw = readAttributeValue(attributes, key);
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function readDefinitionFields(
  attributes: ActivityAttributeValue[] | null | undefined,
): ActivityFieldKey[] {
  if (!attributes || !attributes.length) {
    return [];
  }
  const allowed: ActivityFieldKey[] = ['start', 'end', 'from', 'to', 'remark'];
  const allowedSet = new Set<ActivityFieldKey>(allowed);
  const fields = attributes
    .map((attr) => attr.key)
    .filter((key) => key.startsWith(FIELD_PREFIX))
    .map((key) => key.slice(FIELD_PREFIX.length).trim())
    .filter((key): key is ActivityFieldKey => allowedSet.has(key as ActivityFieldKey));
  return Array.from(new Set(fields));
}

export function readDefinitionCategory(
  attributes: ActivityAttributeValue[] | null | undefined,
): ActivityCategory | null {
  const raw = readAttributeValue(attributes, 'category');
  switch (raw) {
    case 'rest':
    case 'movement':
    case 'service':
    case 'other':
      return raw;
    default:
      return null;
  }
}

export function readDefinitionTimeMode(
  attributes: ActivityAttributeValue[] | null | undefined,
): ActivityTimeMode | null {
  const raw = readAttributeValue(attributes, 'time_mode');
  switch (raw) {
    case 'duration':
    case 'range':
    case 'point':
      return raw;
    default:
      return null;
  }
}

export function readDefinitionRelevantFor(
  attributes: ActivityAttributeValue[] | null | undefined,
): ResourceKind[] | null {
  const list = readAttributeList(attributes, 'relevant_for');
  if (!list.length) {
    return null;
  }
  const allowed: ResourceKind[] = ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'];
  const allowedSet = new Set<ResourceKind>(allowed);
  const filtered = list.filter((entry): entry is ResourceKind => allowedSet.has(entry as ResourceKind));
  return filtered.length ? Array.from(new Set(filtered)) : null;
}

export function readDefinitionDefaultDuration(
  attributes: ActivityAttributeValue[] | null | undefined,
): number | null {
  return readAttributeNumber(attributes, 'default_duration');
}

export function isSystemDefinition(
  attributes: ActivityAttributeValue[] | null | undefined,
): boolean {
  if (readAttributeBoolean(attributes, 'is_system')) {
    return true;
  }
  const flags = [
    'is_service_start',
    'is_service_end',
    'is_break',
    'is_short_break',
    'is_vehicle_on',
    'is_vehicle_off',
    'is_commute',
  ];
  return flags.some((key) => readAttributeBoolean(attributes, key));
}
