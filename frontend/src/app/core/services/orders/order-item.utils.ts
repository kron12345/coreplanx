import { OrderItem, OrderItemValiditySegment } from '../../models/order-item.model';
import { OrderItemUpdateData } from './order-item.types';
import { resolveValiditySegments } from './order-validity.utils';

export function normalizeTags(tags?: string[]): string[] | undefined {
  if (!tags?.length) {
    return undefined;
  }
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

export function prepareUpdatePayload(
  updates: Partial<OrderItemUpdateData> | undefined,
): Partial<OrderItemUpdateData> {
  if (!updates) {
    return {};
  }
  const clone: Partial<OrderItemUpdateData> = { ...updates };
  if (updates.linkedBusinessIds) {
    clone.linkedBusinessIds = [...updates.linkedBusinessIds];
  }
  if ('tags' in updates) {
    clone.tags = updates.tags ? [...updates.tags] : [];
  }
  return clone;
}

export function applyUpdatesToItem(
  item: OrderItem,
  updates: Partial<OrderItemUpdateData>,
): OrderItem {
  if (!updates || Object.keys(updates).length === 0) {
    return item;
  }
  const next: OrderItem = { ...item, ...updates };
  if (updates.linkedBusinessIds) {
    next.linkedBusinessIds = [...updates.linkedBusinessIds];
  }
  if ('tags' in updates) {
    next.tags = updates.tags ? [...updates.tags] : [];
  }
  return next;
}

export function ensureNoSiblingConflict(
  items: OrderItem[],
  parent: OrderItem,
  extracted: OrderItemValiditySegment[],
): void {
  const siblings = items.filter((item) => item.parentItemId === parent.id);
  if (!siblings.length) {
    return;
  }
  siblings.forEach((sibling) => {
    const segments = resolveValiditySegments(sibling);
    extracted.forEach((candidate) => {
      segments.forEach((segment) => {
        if (segmentsOverlap(candidate, segment)) {
          throw new Error(
            `Für den Zeitraum ${segment.startDate} – ${segment.endDate} existiert bereits eine Modifikation. Bitte einen anderen Tag wählen.`,
          );
        }
      });
    });
  });
}

function segmentsOverlap(
  a: OrderItemValiditySegment,
  b: OrderItemValiditySegment,
): boolean {
  return !(a.endDate < b.startDate || a.startDate > b.endDate);
}
