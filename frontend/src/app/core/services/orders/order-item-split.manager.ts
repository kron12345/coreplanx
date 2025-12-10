import { Order } from '../../models/order.model';
import { OrderItem, OrderItemValiditySegment } from '../../models/order-item.model';
import { PlanModificationStopInput, TrainPlanService } from '../train-plan.service';
import { TrafficPeriodService } from '../traffic-period.service';
import { TimetableYearService } from '../timetable-year.service';
import {
  ensureSegmentsWithinValidity,
  expandSegmentsToDates,
  normalizeDateInput,
  prepareCustomSegments,
  resolveEffectiveValidity,
  resolveValiditySegments,
  segmentsWithinRanges,
  segmentsWithinYearBounds,
  splitSegments,
  subtractSegments,
} from './order-validity.utils';
import { ensureItemDefaults, normalizeItemsAfterChange } from './order-normalize.utils';
import { resolveTimetableYearBoundsForItem } from './order-timetable.utils';
import {
  applyUpdatesToItem,
  ensureNoSiblingConflict,
  prepareUpdatePayload,
} from './order-item.utils';
import { extractPlanEnd, extractPlanStart } from './order-plan.utils';
import { TrainPlan } from '../../models/train-plan.model';
import { buildDaysBitmapFromValidity } from './order-validity.utils';
import type { SplitOrderItemPayload, OrderItemUpdateData } from '../order.service';
import { generateItemId } from './order-init.utils';

export interface OrderItemSplitDeps {
  updateOrders: (updater: (orders: Order[]) => Order[]) => void;
  getOrderById: (orderId: string) => Order | undefined;
  trafficPeriodService: TrafficPeriodService;
  timetableYearService: TimetableYearService;
  trainPlanService: TrainPlanService;
  syncTimetableCalendarArtifacts: (refTrainId: string | undefined) => void;
}

export class OrderItemSplitManager {
  constructor(private readonly deps: OrderItemSplitDeps) {}

  splitOrderItem(payload: SplitOrderItemPayload): { created: OrderItem; original: OrderItem } {
    const rangeStart = normalizeDateInput(payload.rangeStart);
    const rangeEnd = normalizeDateInput(payload.rangeEnd);
    if (!rangeStart || !rangeEnd) {
      throw new Error('Ungültiger Datumsbereich.');
    }
    if (rangeStart > rangeEnd) {
      throw new Error('Das Startdatum darf nicht nach dem Enddatum liegen.');
    }

    type SplitResult = { created: OrderItem; original: OrderItem };
    let result: SplitResult | null = null;

    this.deps.updateOrders((orders) =>
      orders.map((order) => {
        if (order.id !== payload.orderId) {
          return order;
        }

        const targetIndex = order.items.findIndex((item) => item.id === payload.itemId);
        if (targetIndex === -1) {
          throw new Error(
            `Auftragsposition ${payload.itemId} wurde im Auftrag ${order.id} nicht gefunden.`,
          );
        }

        const target = ensureItemDefaults(order.items[targetIndex]);
        let validity = resolveEffectiveValidity(
          target,
          this.deps.trafficPeriodService,
          this.deps.timetableYearService,
        );
        const timetableYearBounds = resolveTimetableYearBoundsForItem(
          target,
          this.deps.trafficPeriodService,
          this.deps.timetableYearService,
          (it) => this.getItemTimetableYear(it),
        );

        const customSegments = payload.segments?.length ? prepareCustomSegments(payload.segments) : null;

        if (customSegments) {
          const withinValidity = segmentsWithinRanges(validity, customSegments);
          if (!withinValidity) {
            if (
              timetableYearBounds &&
              segmentsWithinYearBounds(customSegments, timetableYearBounds, this.deps.timetableYearService)
            ) {
              validity = [
                { startDate: timetableYearBounds.startIso, endDate: timetableYearBounds.endIso },
              ];
            } else {
              ensureSegmentsWithinValidity(validity, customSegments);
            }
          }
        }

        const { retained, extracted } = customSegments
          ? { retained: subtractSegments(validity, customSegments), extracted: customSegments }
          : splitSegments(validity, rangeStart, rangeEnd);

        if (!extracted.length) {
          throw new Error('Die ausgewählten Tage überschneiden sich nicht mit der Auftragsposition.');
        }

        ensureNoSiblingConflict(order.items, target, extracted);

        const childId = generateItemId(order.id);
        const preparedUpdates = prepareUpdatePayload(payload.updates);

        let child: OrderItem = applyUpdatesToItem(
          {
            ...target,
            id: childId,
            validity: extracted,
            parentItemId: target.id,
            childItemIds: [],
          },
          preparedUpdates,
        );

        child = this.cleanupChildAfterSplit(child, preparedUpdates);

        if (preparedUpdates.linkedTrainPlanId) {
          const linkedPlan = this.deps.trainPlanService.getById(preparedUpdates.linkedTrainPlanId);
          if (linkedPlan) {
            const planStart = extractPlanStart(linkedPlan);
            const planEnd = extractPlanEnd(linkedPlan);
            if (planStart) {
              child.start = planStart;
            }
            if (planEnd) {
              child.end = planEnd;
            }
          }
        }

        const updatedOriginal: OrderItem = {
          ...target,
          validity: retained,
          childItemIds: [...(target.childItemIds ?? []), childId],
        };

        const nextItems = [...order.items];
        nextItems[targetIndex] = updatedOriginal;
        nextItems.push(child);

        const normalizedItems = normalizeItemsAfterChange(nextItems);

        const normalizedChild = normalizedItems.find((item) => item.id === childId) ?? child;
        const normalizedOriginal =
          normalizedItems.find((item) => item.id === target.id) ?? updatedOriginal;

        result = { created: normalizedChild, original: normalizedOriginal };

        if (target.trafficPeriodId) {
          this.applyCalendarExclusions(target.trafficPeriodId, extracted);
        }

        return { ...order, items: normalizedItems };
      }),
    );

    if (!result) {
      throw new Error(
        `Der Split der Auftragsposition ${payload.itemId} konnte nicht durchgeführt werden.`,
      );
    }

    const { created, original } = result as SplitResult;
    const refId = created.generatedTimetableRefId ?? original.generatedTimetableRefId;
    this.deps.syncTimetableCalendarArtifacts(refId);

    return { created, original };
  }

  private cleanupChildAfterSplit(child: OrderItem, updates: Partial<OrderItemUpdateData>): OrderItem {
    const next: OrderItem = { ...child };
    if (!updates.linkedTemplateId) {
      delete next.linkedTemplateId;
    }
    delete next.linkedBusinessIds;
    if (next.type === 'Fahrplan' && !updates.trafficPeriodId) {
      delete next.trafficPeriodId;
    }
    return next;
  }

  deriveCalendarForChild(child: OrderItem, plan: TrainPlan) {
    const calendar = plan.calendar;
    const segments = resolveValiditySegments(child);
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1] ?? firstSegment;
    const fallbackStart =
      child.start?.slice(0, 10) ??
      calendar.validFrom ??
      child.end?.slice(0, 10) ??
      new Date().toISOString().slice(0, 10);
    const fallbackEnd = child.end?.slice(0, 10) ?? calendar.validTo ?? fallbackStart;

    const validFrom = firstSegment?.startDate ?? fallbackStart;
    const validTo = lastSegment?.endDate ?? fallbackEnd;
    const daysBitmap =
      calendar.daysBitmap ?? buildDaysBitmapFromValidity(segments, validFrom, validTo);

    return {
      validFrom,
      validTo,
      daysBitmap,
    };
  }

  private applyCalendarExclusions(trafficPeriodId: string, segments: OrderItemValiditySegment[]) {
    const dates = expandSegmentsToDates(segments);
    if (!dates.length) {
      return;
    }
    this.deps.trafficPeriodService.addExclusionDates(trafficPeriodId, dates);
  }

  private getItemTimetableYear(item: OrderItem): string | null {
    if (item.timetableYearLabel) {
      return item.timetableYearLabel;
    }
    if (item.trafficPeriodId) {
      const period = this.deps.trafficPeriodService.getById(item.trafficPeriodId);
      if (period?.timetableYearLabel) {
        return period.timetableYearLabel;
      }
      const sampleDate =
        period?.rules?.find((rule) => rule.includesDates?.length)?.includesDates?.[0] ??
        period?.rules?.[0]?.validityStart;
      if (sampleDate) {
        try {
          return this.deps.timetableYearService.getYearBounds(sampleDate).label;
        } catch {
          return null;
        }
      }
    }
    const sampleDate = item.validity?.[0]?.startDate ?? item.start ?? item.end ?? null;
    if (!sampleDate) {
      return null;
    }
    try {
      return this.deps.timetableYearService.getYearBounds(sampleDate).label;
    } catch {
      return null;
    }
  }
}
