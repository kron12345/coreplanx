import { Activity } from '../../models/activity';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { buildAttributesFromCatalog, resolveServiceRole } from './planning-dashboard-activity.utils';

type CatalogMap = Map<string, ActivityCatalogOption>;

function resolveCatalogOption(
  activity: Activity,
  maps: { byId: () => CatalogMap; byType: () => CatalogMap },
): ActivityCatalogOption | null {
  const attrs = (activity.attributes ?? {}) as Record<string, unknown>;
  const activityKey = typeof attrs['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
  if (activityKey) {
    return maps.byId().get(activityKey) ?? null;
  }
  const typeId = (activity.type ?? '').trim();
  return typeId ? maps.byType().get(typeId) ?? null : null;
}

export function applyActivityTypeConstraints(
  activity: Activity,
  maps: { byId: () => CatalogMap; byType: () => CatalogMap },
): Activity {
  const definition = resolveCatalogOption(activity, maps);
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
  maps: { byId: () => CatalogMap; byType: () => CatalogMap },
): Activity {
  const attrs = (activity.attributes ?? {}) as Record<string, unknown>;
  const existingKey = typeof attrs['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
  const option = resolveCatalogOption(activity, maps);
  const candidateKey = existingKey ?? option?.id ?? activity.type ?? null;
  if (!option || !candidateKey) {
    return activity;
  }
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
  deps: { catalogMap: () => CatalogMap; catalogTypeMap: () => CatalogMap },
): Activity[] {
  if (!list.length) {
    return list;
  }
  let mutated = false;
  const normalized = list.map((activity) => {
    let next = applyActivityTypeConstraints(activity, {
      byId: deps.catalogMap,
      byType: deps.catalogTypeMap,
    });
    next = ensureActivityCatalogAttributes(next, {
      byId: deps.catalogMap,
      byType: deps.catalogTypeMap,
    });
    if (next !== activity) {
      mutated = true;
    }
    return next;
  });
  return mutated ? normalized : list;
}
