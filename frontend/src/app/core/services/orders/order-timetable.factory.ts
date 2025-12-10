import { OrderItem, OrderItemTimetableSnapshot } from '../../models/order-item.model';
import { Timetable } from '../../models/timetable.model';
import { TrainPlan } from '../../models/train-plan.model';
import { TimetableHubSectionKey } from '../timetable-hub.service';
import { TimetableService } from '../timetable.service';
import { TrainPlanService } from '../train-plan.service';
import { extractPlanStart, toTimetableStops } from './order-plan.utils';

type PublishPlanToHubFn = (plan: TrainPlan, item: OrderItem, section: TimetableHubSectionKey) => void;
type UpdateItemFn = (itemId: string, updater: (item: OrderItem) => OrderItem) => void;

export interface OrderTimetableDeps {
  timetableService: TimetableService;
  trainPlanService: TrainPlanService;
  publishPlanToHub: PublishPlanToHubFn;
  resolveHubSectionForItem: (item: OrderItem) => TimetableHubSectionKey;
  updateItem: UpdateItemFn;
}

export class OrderTimetableFactory {
  constructor(private readonly deps: OrderTimetableDeps) {}

  ensureTimetableForPlan(
    plan: TrainPlan,
    item: OrderItem,
    refTrainIdOverride?: string,
  ): Timetable | null {
    const refTrainId = refTrainIdOverride ?? this.generateTimetableRefId(plan);
    const existing = this.deps.timetableService.getByRefTrainId(refTrainId);
    if (existing) {
      const stops = toTimetableStops(plan.stops);
      let updated = existing;
      if (stops.length >= 2) {
        updated = this.deps.timetableService.replaceStops(refTrainId, stops);
      }
      const calendar = plan.calendar
        ? { ...plan.calendar }
        : {
            validFrom: extractPlanStart(plan)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
            daysBitmap: '1111111',
          };
      updated = this.deps.timetableService.updateCalendar(refTrainId, calendar);
      const section = this.deps.resolveHubSectionForItem(item);
      this.deps.publishPlanToHub(plan, item, section);
      return updated;
    }
    const stops = toTimetableStops(plan.stops);
    if (stops.length < 2) {
      return null;
    }
    const calendar = plan.calendar
      ? { ...plan.calendar }
      : {
          validFrom: extractPlanStart(plan)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
          daysBitmap: '1111111',
        };
    const payload = {
      refTrainId,
      opn: this.generateOpn(plan),
      title: plan.title,
      trainNumber: plan.trainNumber,
      responsibleRu: plan.responsibleRu,
      calendar,
      status: 'bedarf',
      source: {
        type: 'manual',
        pathRequestId: plan.pathRequestId,
        externalSystem: 'OrderManager',
      },
      stops,
      linkedOrderItemId: item.id,
      notes: `Automatisch erstellt aus Auftragsposition ${item.id}`,
      rollingStock: plan.rollingStock,
    } as const;

    try {
      const created = this.deps.timetableService.createTimetable(payload);
      const section = this.deps.resolveHubSectionForItem(item);
      this.deps.publishPlanToHub(plan, item, section);
      return created;
    } catch (error) {
      console.error('Timetable creation failed', error);
      return null;
    }
  }

  withTimetableMetadata(item: OrderItem, timetable: Timetable | null): OrderItem {
    if (!timetable) {
      return item;
    }
    return {
      ...item,
      generatedTimetableRefId: timetable.refTrainId,
      timetablePhase: timetable.status,
      originalTimetable: this.buildSnapshotFromTimetable(timetable),
    };
  }

  updateItemTimetableMetadata(itemId: string, timetable: Timetable): void {
    this.deps.updateItem(itemId, (item) => ({
      ...item,
      generatedTimetableRefId: timetable.refTrainId,
      timetablePhase: timetable.status,
      originalTimetable: this.buildSnapshotFromTimetable(timetable),
    }));
  }

  generateTimetableRefId(plan: TrainPlan): string {
    const sanitized = plan.id.replace(/^TP-?/i, '');
    return `TT-${sanitized}`;
  }

  private generateOpn(plan: TrainPlan): string {
    if (plan.pathRequestId) {
      return plan.pathRequestId.replace(/^PR/i, 'OPN');
    }
    return `OPN-${plan.trainNumber}`;
  }

  private buildSnapshotFromTimetable(timetable: Timetable): OrderItemTimetableSnapshot {
    return {
      refTrainId: timetable.refTrainId,
      title: timetable.title,
      trainNumber: timetable.trainNumber,
      calendar: {
        validFrom: timetable.calendar.validFrom,
        validTo: timetable.calendar.validTo,
        daysBitmap: timetable.calendar.daysBitmap,
      },
      stops: timetable.stops.map((stop) => ({
        sequence: stop.sequence,
        locationName: stop.locationName,
        arrivalTime: stop.commercial.arrivalTime,
        departureTime: stop.commercial.departureTime,
      })),
      variants: timetable.calendarVariants?.map((variant) => ({
        id: variant.id,
        description: variant.description,
        type: variant.type,
        validFrom: variant.validFrom,
        validTo: variant.validTo,
        daysOfWeek: variant.daysOfWeek,
        dates: variant.dates,
        appliesTo: variant.appliesTo,
        variantNumber: variant.variantNumber ?? variant.id,
        reason: variant.reason,
      })),
      modifications: timetable.calendarModifications?.map((mod) => ({
        date: mod.date,
        description: mod.description,
        type: mod.type,
        notes: mod.notes,
      })),
    };
  }
}
