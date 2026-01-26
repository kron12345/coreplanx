import { Order } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';
import { TrainPlan } from '../../models/train-plan.model';
import { TrainPlanService } from '../train-plan.service';
import { OrderPlanHubHelper } from './order-plan-hub.helper';
import { OrderTimetableFactory } from './order-timetable.factory';
import { applyPlanDetailsToItem } from './order-plan.utils';

type UpdateOrdersFn = (updater: (orders: Order[]) => Order[]) => void;
type GetOrderByIdFn = (orderId: string) => Order | undefined;
type ResolveHubSectionFn = (item: OrderItem) => ReturnType<OrderPlanHubHelper['publishPlanToHub']> extends void
  ? Parameters<OrderPlanHubHelper['publishPlanToHub']>[2]
  : never;

export interface PlanModificationDeps {
  updateOrders: UpdateOrdersFn;
  getOrderById: GetOrderByIdFn;
  trainPlanService: TrainPlanService;
  timetableFactory: OrderTimetableFactory;
  planHub: OrderPlanHubHelper;
  resolveHubSectionForItem: ResolveHubSectionFn;
  deriveCalendarForChild: (child: OrderItem, plan: TrainPlan) => TrainPlan['calendar'];
}

export class OrderPlanModificationManager {
  constructor(private readonly deps: PlanModificationDeps) {}

  applyPlanModification(payload: { orderId: string; itemId: string; plan: TrainPlan }): void {
    const { orderId, itemId, plan } = payload;

    this.deps.updateOrders((orders) =>
      orders.map((order) => {
        if (order.id !== orderId) {
          return order;
        }

        const items = order.items.map((item) => {
          if (item.id !== itemId) {
            return item;
          }

          const base: OrderItem = {
            ...item,
            linkedTrainPlanId: plan.id,
          } satisfies OrderItem;

          return this.applyPlanDetailsToItem(base, plan);
        });

        return { ...order, items } satisfies Order;
      }),
    );

    this.deps.trainPlanService.linkOrderItem(plan.id, itemId);
    const updatedOrder = this.deps.getOrderById(orderId);
    const updatedItem = updatedOrder?.items.find((entry) => entry.id === itemId) ?? null;
    if (updatedItem) {
      const section = this.deps.resolveHubSectionForItem(updatedItem);
      this.deps.planHub.publishPlanToHub(plan, updatedItem, section);
    }
  }

  async createPlanVersionFromSplit(parent: OrderItem, child: OrderItem): Promise<void> {
    const basePlanId = parent.linkedTrainPlanId ?? child.linkedTrainPlanId;
    if (!basePlanId) {
      return;
    }
    const basePlan = this.deps.trainPlanService.getById(basePlanId);
    if (!basePlan) {
      return;
    }
    const calendar = this.deps.deriveCalendarForChild(child, basePlan);
    const stops = basePlan.stops.map((stop, index) => ({
      sequence: stop.sequence ?? index + 1,
      type: stop.type,
      locationCode: stop.locationCode ?? `LOC-${index + 1}`,
      locationName: stop.locationName ?? stop.locationCode ?? `LOC-${index + 1}`,
      countryCode: stop.countryCode,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities?.length ? [...stop.activities] : ['0001'],
      platform: stop.platform,
      notes: stop.notes,
    }));

    const plan = await this.deps.trainPlanService.createPlanModification({
      originalPlanId: basePlan.id,
      title: child.name ?? basePlan.title,
      trainNumber: basePlan.trainNumber,
      responsibleRu: child.responsible ?? basePlan.responsibleRu,
      notes: basePlan.notes,
      trafficPeriodId: basePlan.trafficPeriodId ?? undefined,
      calendar,
      stops,
      rollingStock: basePlan.rollingStock,
    });

    this.deps.trainPlanService.linkOrderItem(plan.id, child.id);
    this.deps.timetableFactory.ensureTimetableForPlan(plan, child);
  }

  private applyPlanDetailsToItem(item: OrderItem, plan: TrainPlan): OrderItem {
    return applyPlanDetailsToItem(item, plan);
  }

}
