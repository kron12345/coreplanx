import type { ActivityFieldKey } from '../../core/models/activity-definition';
import type { ActivityCatalogOption } from './planning-dashboard.types';

export function findCatalogOptionByTypeId(
  options: () => ActivityCatalogOption[],
  id: string | null | undefined,
): ActivityCatalogOption | null {
  if (!id) {
    return null;
  }
  return options().find((option) => option.activityTypeId === id) ?? null;
}

export function definitionHasField(
  definition: ActivityCatalogOption | null,
  field: ActivityFieldKey,
): boolean {
  if (field === 'start' || field === 'end') {
    return true;
  }
  if (!definition) {
    return false;
  }
  return definition.fields?.includes(field) ?? false;
}

export function shouldShowEndField(definition: ActivityCatalogOption | null): boolean {
  if (!definition) {
    return true;
  }
  return definition.timeMode !== 'point';
}
