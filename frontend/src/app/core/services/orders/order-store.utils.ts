import { Order } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';
import { TimetableYearService } from '../timetable-year.service';
import { ensureItemDefaults, normalizeItemsAfterChange } from './order-normalize.utils';

interface StoreDeps {
  setOrders: (updater: (orders: Order[]) => Order[]) => void;
  timetableYearService: TimetableYearService;
}

export class OrderStoreHelper {
  constructor(private readonly deps: StoreDeps) {}

  appendItems(orderId: string, items: OrderItem[]) {
    if (!items.length) {
      return;
    }
    let updated = false;
    this.deps.setOrders((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }
        updated = true;
        const prepared = items.map((item) => ensureItemDefaults(item));
        return {
          ...order,
          items: normalizeItemsAfterChange([...order.items, ...prepared]),
        };
      }),
    );

    if (!updated) {
      throw new Error(`Auftrag ${orderId} nicht gefunden`);
    }
  }

  updateItem(itemId: string, updater: (item: OrderItem) => OrderItem): void {
    this.deps.setOrders((orders) =>
      orders.map((order) => {
        let mutated = false;
        const items = order.items.map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          mutated = true;
          return updater(item);
        });
        return mutated ? { ...order, items } : order;
      }),
    );
  }

  ensureOrderTimetableYear(orderId: string, label?: string | null) {
    if (!label) {
      return;
    }
    let mismatch: string | null = null;
    let found = false;
    this.deps.setOrders((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }
        found = true;
        if (order.timetableYearLabel && order.timetableYearLabel !== label) {
          mismatch = order.timetableYearLabel;
          return order;
        }
        if (order.timetableYearLabel === label) {
          return order;
        }
        return { ...order, timetableYearLabel: label };
      }),
    );
    if (mismatch) {
      throw new Error(
        `Auftrag ${orderId} gehört zum Fahrplanjahr ${mismatch}. Bitte einen Auftrag für ${label} anlegen oder das vorhandene Fahrplanjahr wählen.`,
      );
    }
    if (!found) {
      throw new Error(`Auftrag ${orderId} wurde nicht gefunden.`);
    }
  }

  markSimulationMerged(orderId: string, simId: string, targetId: string, status: 'applied' | 'proposed') {
    this.updateItem(simId, (item) => ({
      ...item,
      mergeStatus: status,
      mergeTargetId: targetId,
    }));
  }

  removeCustomerAssignments(customerId: string) {
    if (!customerId) {
      return;
    }
    this.deps.setOrders((orders) =>
      orders.map((order) => {
        if (order.customerId !== customerId) {
          return order;
        }
        const next: Order = {
          ...order,
          customerId: undefined,
          customer: undefined,
        };
        return next;
      }),
    );
  }
}
