import { Activity } from '../../models/activity';
import { ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { buildAttributesFromCatalog, defaultColorForType, resolveServiceRole } from './planning-dashboard-activity.utils';

type TypeMap = Map<string, ActivityTypeDefinition>;
type CatalogMap = Map<string, ActivityCatalogOption>;

export function applyActivityTypeConstraints(activity: Activity, typeMap: () => TypeMap): Activity {
  const definition = typeMap().get(activity.type ?? '');
  if (!definition) {
    return activity;
  }
  if (definition.timeMode === 'point' && activity.end) {
    if (activity.end === null) {
      return activity;
    }
    return { ...activity, end: null };
  }
  return activity;
}

export function ensureActivityCatalogAttributes(
  activity: Activity,
  catalogMap: () => CatalogMap,
): Activity {
  const attrs = (activity.attributes ?? {}) as Record<string, unknown>;
  const existingKey = typeof attrs['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
  const candidateKey = existingKey ?? activity.type ?? null;
  if (!candidateKey) {
    return activity;
  }
  const option = catalogMap().get(candidateKey) ?? null;
  let changed = false;
  let nextAttrs: Record<string, unknown> = { ...attrs };
  if (!existingKey) {
    nextAttrs['activityKey'] = candidateKey;
    changed = true;
  }
  if (option?.templateId && !nextAttrs['templateId']) {
    nextAttrs['templateId'] = option.templateId;
    changed = true;
  }
  if (option?.attributes?.length) {
    option.attributes.forEach((attr) => {
      const key = (attr?.key ?? '').trim();
      if (!key || key in nextAttrs) {
        return;
      }
      nextAttrs[key] = attr.meta?.['value'] ?? '';
      changed = true;
    });
  }
  if (!nextAttrs['color']) {
    const color =
      (option?.attributes.find((attr) => attr.key === 'color')?.meta?.['value'] as string | undefined) ??
      defaultColorForType(activity.type ?? option?.activityTypeId ?? null, option?.typeDefinition.category);
    if (color) {
      nextAttrs['color'] = color;
      changed = true;
    }
  }
  const role = resolveServiceRole(option);
  if (role && activity.serviceRole !== role) {
    changed = true;
  }
  if (!changed) {
    return activity;
  }
  return { ...activity, attributes: nextAttrs, serviceRole: role ?? activity.serviceRole };
}

export function normalizeActivityList(
  list: Activity[],
  deps: { typeMap: () => TypeMap; catalogMap: () => CatalogMap },
): Activity[] {
  if (!list.length) {
    return list;
  }
  let mutated = false;
  const normalized = list.map((activity) => {
    let next = applyActivityTypeConstraints(activity, deps.typeMap);
    next = ensureActivityCatalogAttributes(next, deps.catalogMap);
    if (next !== activity) {
      mutated = true;
    }
    return next;
  });
  return mutated ? normalized : list;
}
