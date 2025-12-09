import { OrderItem } from '../../models/order-item.model';
import { Order } from '../../models/order.model';
import { TrafficPeriod } from '../../models/traffic-period.model';
import { TimetableCalendarModification, TimetableCalendarVariant, Timetable } from '../../models/timetable.model';
import { TrainPlan } from '../../models/train-plan.model';
import { TrainPlanService } from '../train-plan.service';
import { TimetableService } from '../timetable.service';
import { TrafficPeriodService } from '../traffic-period.service';

type UpdateItemFn = (itemId: string, updater: (item: OrderItem) => OrderItem) => void;
type ApplyPlanDetailsFn = (item: OrderItem, plan: TrainPlan) => OrderItem;
type EnsureTimetableFn = (plan: TrainPlan, item: OrderItem, refOverride?: string) => Timetable | null;
type UpdateItemTimetableFn = (itemId: string, timetable: Timetable) => void;
type BuildVariantsFn = (
  baseItem: OrderItem | undefined,
  period: TrafficPeriod | undefined,
) => TimetableCalendarVariant[];
type BuildModificationsFn = (
  items: OrderItem[],
  period: TrafficPeriod | undefined,
) => TimetableCalendarModification[];
type GenerateTimetableRefIdFn = (plan: TrainPlan) => string;
type GetTrafficPeriodFn = (id: string) => TrafficPeriod | undefined;

interface PlanLinkDeps {
  trainPlanService: TrainPlanService;
  timetableService: TimetableService;
  trafficPeriodService: TrafficPeriodService;
  updateItem: UpdateItemFn;
  applyPlanDetailsToItem: ApplyPlanDetailsFn;
  ensureTimetableForPlan: EnsureTimetableFn;
  updateItemTimetableMetadata: UpdateItemTimetableFn;
  ordersProvider: () => Order[];
  buildCalendarVariants: BuildVariantsFn;
  buildCalendarModifications: BuildModificationsFn;
  generateTimetableRefId: GenerateTimetableRefIdFn;
  getTrafficPeriod: GetTrafficPeriodFn;
}

export class OrderPlanLinkManager {
  constructor(private readonly deps: PlanLinkDeps) {}

  linkTrainPlanToItem(planId: string, itemId: string): void {
    const plan = this.deps.trainPlanService.getById(planId);
    let updatedItem: OrderItem | null = null;
    this.deps.updateItem(itemId, (item) => {
      const base: OrderItem = {
        ...item,
        linkedTrainPlanId: planId,
      };
      const next = plan ? this.deps.applyPlanDetailsToItem(base, plan) : base;
      updatedItem = next;
      return next;
    });

    this.deps.trainPlanService.linkOrderItem(planId, itemId);

    if (plan && updatedItem) {
      const draftItem: OrderItem = updatedItem;
      const refOverride =
        draftItem.timetablePhase === 'bedarf'
          ? draftItem.generatedTimetableRefId
          : undefined;
      const timetable = this.deps.ensureTimetableForPlan(plan, draftItem, refOverride);
      if (timetable) {
        this.deps.updateItemTimetableMetadata(itemId, timetable);
        this.syncTimetableCalendarArtifacts(timetable.refTrainId);
      }
    }
  }

  unlinkTrainPlanFromItem(planId: string, itemId: string): void {
    this.deps.updateItem(itemId, (item) => {
      if (item.linkedTrainPlanId !== planId) {
        return item;
      }
      const next = { ...item };
      delete next.linkedTrainPlanId;
      return next;
    });
    this.deps.trainPlanService.unlinkOrderItem(planId);
  }

  syncTimetableCalendarArtifacts(refTrainId: string | undefined): void {
    if (!refTrainId) {
      return;
    }
    const relatedItems = this.collectItemsForTimetable(refTrainId);
    if (!relatedItems.length) {
      return;
    }
    const baseItem = this.findBaseItem(relatedItems);
    const period = baseItem?.trafficPeriodId
      ? this.deps.getTrafficPeriod(baseItem.trafficPeriodId)
      : undefined;

    const variants = this.deps.buildCalendarVariants(baseItem, period);
    if (variants.length) {
      this.deps.timetableService.updateCalendarVariants(refTrainId, variants);
    }

    const modifications = this.deps.buildCalendarModifications(relatedItems, period);
    this.deps.timetableService.updateCalendarModifications(refTrainId, modifications);
  }

  private collectItemsForTimetable(refTrainId: string): OrderItem[] {
    return this.deps.ordersProvider().flatMap((order) =>
      order.items.filter((item: OrderItem) => item.generatedTimetableRefId === refTrainId),
    );
  }

  private findBaseItem(items: OrderItem[]): OrderItem | undefined {
    return items.find((item) => !item.parentItemId) ?? items[0];
  }
}
