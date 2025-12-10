import { Order, OrderProcessStatus } from '../../models/order.model';
import { OrderItem, InternalProcessingStatus } from '../../models/order-item.model';
import { TimetablePhase } from '../../models/timetable.model';
import { TimetableService } from '../timetable.service';
import { TrainPlanService } from '../train-plan.service';
import { OrderPlanHubHelper } from './order-plan-hub.helper';

export interface OrderStatusDeps {
  updateOrders: (updater: (orders: Order[]) => Order[]) => void;
  updateItem: (itemId: string, updater: (item: OrderItem) => OrderItem) => void;
  getOrderById: (orderId: string) => Order | undefined;
  ordersProvider: () => Order[];
  timetableService: TimetableService;
  trainPlanService: TrainPlanService;
  planHub: OrderPlanHubHelper;
  resolveHubSectionForItem: (item: OrderItem) => Parameters<OrderPlanHubHelper['publishPlanToHub']>[2];
}

export class OrderStatusManager {
  constructor(private readonly deps: OrderStatusDeps) {}

  setItemTimetablePhase(itemId: string, phase: TimetablePhase): void {
    this.deps.updateItem(itemId, (item) => ({ ...item, timetablePhase: phase }));
    const updated = this.findItem(itemId);
    if (updated?.linkedTrainPlanId) {
      const plan = this.deps.trainPlanService.getById(updated.linkedTrainPlanId);
      if (plan) {
        const section = this.deps.resolveHubSectionForItem(updated);
        this.deps.planHub.publishPlanToHub(plan, updated, section);
      }
    }
  }

  setItemInternalStatus(itemId: string, status: InternalProcessingStatus | null): void {
    this.deps.updateItem(itemId, (item) => {
      if (!status) {
        const next = { ...item };
        delete next.internalStatus;
        return next;
      }
      return { ...item, internalStatus: status };
    });
  }

  setOrderProcessStatus(orderId: string, status: OrderProcessStatus): void {
    this.deps.updateOrders((orders) =>
      orders.map((order) => (order.id === orderId ? { ...order, processStatus: status } : order)),
    );
  }

  getItemsMissingBookedStatus(orderId: string): OrderItem[] {
    const order = this.deps.getOrderById(orderId);
    if (!order) {
      return [];
    }
    return order.items.filter((item) => item.type === 'Fahrplan' && item.timetablePhase !== 'contract');
  }

  submitOrderItems(orderId: string, itemIds: string[]): void {
    if (!itemIds.length) {
      return;
    }
    const targetIds = new Set(itemIds);
    const toPublish: { planId: string; item: OrderItem }[] = [];
    this.deps.updateOrders((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }
        const items = order.items.map((item) => {
          if (!targetIds.has(item.id)) {
            return item;
          }
          if (item.variantType === 'simulation') {
            return item;
          }
          if (item.generatedTimetableRefId) {
            this.deps.timetableService.updateStatus(item.generatedTimetableRefId, 'path_request');
          }
          const updated: OrderItem = {
            ...item,
            timetablePhase: 'path_request' as TimetablePhase,
          };
          if (updated.linkedTrainPlanId) {
            toPublish.push({ planId: updated.linkedTrainPlanId, item: updated });
          }
          return updated;
        });
        return { ...order, items };
      }),
    );
    toPublish.forEach(({ planId, item }) => {
      const plan = this.deps.trainPlanService.getById(planId);
      if (plan) {
        const section = this.deps.resolveHubSectionForItem(item);
        this.deps.planHub.publishPlanToHub(plan, item, section);
      }
    });
  }

  private findItem(itemId: string): OrderItem | undefined {
    for (const order of this.deps.ordersProvider()) {
      const match = order.items.find((it) => it.id === itemId);
      if (match) {
        return match;
      }
    }
    return undefined;
  }
}
