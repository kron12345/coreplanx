import { ActivityFieldKey, ActivityTypeDefinition } from '../../core/services/activity-type.service';

export function findActivityTypeById(
  definitions: () => ActivityTypeDefinition[],
  id: string | null | undefined,
): ActivityTypeDefinition | null {
  if (!id) {
    return null;
  }
  return definitions().find((definition) => definition.id === id) ?? null;
}

export function definitionHasField(
  definition: ActivityTypeDefinition | null,
  field: ActivityFieldKey,
): boolean {
  if (field === 'start' || field === 'end') {
    return true;
  }
  if (!definition) {
    return false;
  }
  return definition.fields.includes(field);
}

export function shouldShowEndField(definition: ActivityTypeDefinition | null): boolean {
  if (!definition) {
    return true;
  }
  return definition.timeMode !== 'point';
}
