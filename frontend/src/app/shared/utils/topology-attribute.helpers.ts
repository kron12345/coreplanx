import { CustomAttributeDefinition } from '../../core/services/custom-attribute.service';
import { TopologyAttribute } from '../planning-types';

export function isTemporalAttribute(
  definitions: CustomAttributeDefinition[],
  key: string,
): boolean {
  return !!definitions.find((definition) => definition.key === key)?.temporal;
}

export function mergeAttributeEntry(
  definitions: CustomAttributeDefinition[],
  attributes: TopologyAttribute[] | undefined,
  entry: TopologyAttribute,
): TopologyAttribute[] {
  const temporal = isTemporalAttribute(definitions, entry.key);
  if (temporal) {
    return [...(attributes ?? []), entry];
  }
  const filtered = (attributes ?? []).filter((attr) => attr.key !== entry.key);
  return [...filtered, entry];
}
