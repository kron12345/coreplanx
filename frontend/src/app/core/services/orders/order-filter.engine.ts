import { Order } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';
import { OrderTimelineReference, OrderFilters, OrderTtrPhase } from './order-filters.model';
import { TrainPlanService } from '../train-plan.service';
import { TimetableService } from '../timetable.service';
import { matchesItem } from './order-match.utils';
import { DAY_IN_MS, startOfDay } from './order-timeline.utils';

interface FilterDeps {
  timetableService: TimetableService;
  trainPlanService: TrainPlanService;
  getItemTimetableYear: (item: OrderItem) => string | null;
  resolveReferenceDate: (item: OrderItem, reference: OrderTimelineReference) => Date | null;
  findItemById: (id: string) => OrderItem | undefined;
}

export class OrderFilterEngine {
  constructor(private readonly deps: FilterDeps) {}

  computeTtrPhase(
    item: OrderItem,
    reference: OrderTimelineReference,
    referenceDateOverride?: Date | null,
  ): OrderTtrPhase {
    const referenceDate = referenceDateOverride ?? this.deps.resolveReferenceDate(item, reference);
    if (!referenceDate) {
      return 'unknown';
    }
    const today = startOfDay(new Date());
    const diffDays = Math.floor((referenceDate.getTime() - today.getTime()) / DAY_IN_MS);
    if (Number.isNaN(diffDays)) {
      return 'unknown';
    }
    if (diffDays >= 210) {
      return 'annual_request';
    }
    if (diffDays >= 120) {
      return 'final_offer';
    }
    if (diffDays >= 21) {
      return 'rolling_planning';
    }
    if (diffDays >= 7) {
      return 'short_term';
    }
    if (diffDays >= 0) {
      return 'ad_hoc';
    }
    return 'operational_delivery';
  }

  filterItemsForOrder(order: Order, filters: OrderFilters): OrderItem[] {
    return order.items.filter((item) =>
      matchesItem(item, filters, {
        timetableService: this.deps.timetableService,
        trainPlanService: this.deps.trainPlanService,
        getItemTimetableYear: (it) => this.deps.getItemTimetableYear(it),
        resolveReferenceDate: (it, reference) => this.deps.resolveReferenceDate(it, reference),
        computeTtrPhase: (it, reference, override) =>
          this.computeTtrPhase(it, reference, override),
      }),
    );
  }

  getItemReferenceDate(
    itemOrId: OrderItem | string,
    reference: OrderTimelineReference,
  ): Date | null {
    const item = typeof itemOrId === 'string' ? this.deps.findItemById(itemOrId) : itemOrId;
    if (!item) {
      return null;
    }
    return this.deps.resolveReferenceDate(item, reference);
  }

  buildTtrPhaseIndex(orders: Order[], reference: OrderTimelineReference): Map<string, OrderTtrPhase> {
    const map = new Map<string, OrderTtrPhase>();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        map.set(item.id, this.computeTtrPhase(item, reference));
      });
    });
    return map;
  }
}
