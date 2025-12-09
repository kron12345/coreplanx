import { OrderItem } from '../../models/order-item.model';
import { deriveDefaultValidity, normalizeSegments } from './order-validity.utils';

export function ensureItemDefaults(item: OrderItem): OrderItem {
  const validity =
    item.validity && item.validity.length
      ? normalizeSegments(item.validity)
      : deriveDefaultValidity(item);
  const originalTimetable = item.originalTimetable
    ? {
        ...item.originalTimetable,
        calendar: { ...item.originalTimetable.calendar },
        stops: [...(item.originalTimetable.stops ?? [])].map((stop) => ({
          ...stop,
        })),
      }
    : undefined;

  return {
    ...item,
    tags: item.tags ? [...item.tags] : undefined,
    validity,
    childItemIds: [...(item.childItemIds ?? [])],
    versionPath: item.versionPath ? [...item.versionPath] : undefined,
    linkedBusinessIds: item.linkedBusinessIds
      ? [...item.linkedBusinessIds]
      : undefined,
    linkedTemplateId: item.linkedTemplateId,
    linkedTrainPlanId: item.linkedTrainPlanId,
    generatedTimetableRefId: item.generatedTimetableRefId,
    timetablePhase: item.timetablePhase,
    originalTimetable,
  };
}

export function normalizeItemsAfterChange(items: OrderItem[]): OrderItem[] {
  const itemMap = new Map<string, OrderItem>();
  items.forEach((item) => {
    const defaults = ensureItemDefaults(item);
    itemMap.set(defaults.id, defaults);
  });

  // Reset child references to avoid duplicates.
  itemMap.forEach((item) => {
    item.childItemIds = [];
  });
  itemMap.forEach((item) => {
    if (!item.parentItemId) {
      return;
    }
    const parent = itemMap.get(item.parentItemId);
    if (!parent) {
      return;
    }
    parent.childItemIds = parent.childItemIds ?? [];
    if (!parent.childItemIds.includes(item.id)) {
      parent.childItemIds.push(item.id);
    }
  });

  const roots = Array.from(itemMap.values()).filter((item) => !item.parentItemId);
  const children = Array.from(itemMap.values()).filter((item) => item.parentItemId);

  const sortedInput = [...items].map((item) => item.id);
  const result: OrderItem[] = [];
  const visited = new Set<string>();

  const appendWithChildren = (item: OrderItem, path: number[]) => {
    if (visited.has(item.id)) {
      return;
    }
    visited.add(item.id);
    item.versionPath = [...path];
    result.push(item);
    const childrenIds = [...(item.childItemIds ?? [])].sort((a, b) => {
      const indexA = sortedInput.indexOf(a);
      const indexB = sortedInput.indexOf(b);
      const safeA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
      const safeB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
      return safeA - safeB;
    });
    let childCounter = 1;
    childrenIds.forEach((childId) => {
      const child = itemMap.get(childId);
      if (!child) {
        return;
      }
      const existingChildNumber =
        child.versionPath && child.versionPath.length === path.length + 1
          ? child.versionPath[path.length]
          : undefined;
      let nextIndex: number;
      if (typeof existingChildNumber === 'number') {
        nextIndex = existingChildNumber;
        childCounter = Math.max(childCounter, existingChildNumber + 1);
      } else {
        nextIndex = childCounter;
        childCounter += 1;
      }
      appendWithChildren(child, [...path, nextIndex]);
    });
  };

  roots
    .sort((a, b) => sortedInput.indexOf(a.id) - sortedInput.indexOf(b.id))
    .forEach((root, index) => appendWithChildren(root, [index + 1]));

  children
    .filter((child) => !visited.has(child.id))
    .forEach((orphan) => appendWithChildren(orphan, [1]));

  return result;
}
