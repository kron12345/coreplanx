import { Order } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';

export function findProductiveBase(order: Order, simulation: OrderItem): OrderItem | null {
  const groupId = simulation.variantGroupId ?? simulation.variantOfItemId ?? null;
  const candidates = order.items.filter((it) => (it.variantType ?? 'productive') === 'productive');
  if (groupId) {
    const match = candidates.find(
      (it) => it.variantGroupId === groupId || it.id === simulation.variantOfItemId,
    );
    if (match) {
      return match;
    }
  }
  return null;
}

export function mergeItemFields(target: OrderItem, source: OrderItem): OrderItem {
  const merged: OrderItem = {
    ...target,
    name: source.name ?? target.name,
    responsible: source.responsible ?? target.responsible,
    deviation: source.deviation ?? target.deviation,
    fromLocation: source.fromLocation ?? target.fromLocation,
    toLocation: source.toLocation ?? target.toLocation,
    tags: source.tags ? [...source.tags] : target.tags,
    timetableYearLabel: target.timetableYearLabel ?? source.timetableYearLabel,
    variantType: 'productive',
    variantLabel: target.variantLabel ?? 'Produktiv',
    simulationId: undefined,
    simulationLabel: undefined,
  };
  if (source.trafficPeriodId) {
    merged.trafficPeriodId = source.trafficPeriodId;
  }
  if (source.validity) {
    merged.validity = source.validity;
  }
  return merged;
}
