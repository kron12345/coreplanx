import { OrderItem } from '../../models/order-item.model';
import { OrderFilters, OrderTimelineReference, OrderTtrPhase } from './order-filters.model';
import { TrainPlanService } from '../train-plan.service';
import { TimetableService } from '../timetable.service';
import { addHours, isSameDay, isSameWeek } from './order-timeline.utils';

interface MatchDeps {
  timetableService: TimetableService;
  trainPlanService: TrainPlanService;
  getItemTimetableYear: (item: OrderItem) => string | null;
  resolveReferenceDate: (item: OrderItem, reference: OrderTimelineReference) => Date | null;
  computeTtrPhase: (
    item: OrderItem,
    reference: OrderTimelineReference,
    referenceDateOverride?: Date | null,
  ) => OrderTtrPhase;
}

export function matchesTimeRange(
  item: OrderItem,
  range: OrderFilters['timeRange'],
): boolean {
  if (range === 'all') {
    return true;
  }
  if (!item.start) {
    return false;
  }
  const start = new Date(item.start);
  if (Number.isNaN(start.getTime())) {
    return false;
  }
  const now = new Date();
  switch (range) {
    case 'next4h':
      return start >= now && start <= addHours(now, 4);
    case 'next12h':
      return start >= now && start <= addHours(now, 12);
    case 'today':
      return isSameDay(start, now);
    case 'thisWeek':
      return isSameWeek(start, now);
    default:
      return true;
  }
}

export function matchesItem(
  item: OrderItem,
  filters: OrderFilters,
  deps: MatchDeps,
): boolean {
  if (filters.linkedBusinessId) {
    const businessIds = item.linkedBusinessIds ?? [];
    if (!businessIds.includes(filters.linkedBusinessId)) {
      return false;
    }
  }

  if (filters.trainStatus !== 'all' || filters.trainNumber.trim()) {
    if (item.type !== 'Fahrplan') {
      if (filters.trainStatus !== 'all' || filters.trainNumber.trim() !== '') {
        return false;
      }
    } else {
      const timetable = item.generatedTimetableRefId
        ? deps.timetableService.getByRefTrainId(item.generatedTimetableRefId)
        : undefined;
      const plan = item.linkedTrainPlanId
        ? deps.trainPlanService.getById(item.linkedTrainPlanId)
        : undefined;

      if (filters.trainStatus !== 'all') {
        const currentPhase = timetable?.status ?? item.timetablePhase;
        if (!currentPhase || currentPhase !== filters.trainStatus) {
          return false;
        }
      }
      if (filters.trainNumber.trim()) {
        const search = filters.trainNumber.trim().toLowerCase();
        const trainNumber = timetable?.trainNumber ?? plan?.trainNumber ?? item.name;
        if (!trainNumber.toLowerCase().includes(search)) {
          return false;
        }
      }
    }
  }

  if (filters.timetableYearLabel !== 'all') {
    const itemYear = deps.getItemTimetableYear(item);
    if (itemYear !== filters.timetableYearLabel) {
      return false;
    }
  }

  if (filters.variantType !== 'all') {
    const variant = item.variantType ?? 'productive';
    if (variant !== filters.variantType) {
      return false;
    }
  }

  let referenceDateCache: Date | null | undefined;
  const resolveReferenceDateCached = () => {
    if (referenceDateCache === undefined) {
      referenceDateCache = deps.resolveReferenceDate(item, filters.timelineReference);
    }
    return referenceDateCache;
  };

  if (filters.fpRangeStart || filters.fpRangeEnd) {
    const referenceDate = resolveReferenceDateCached();
    if (!referenceDate) {
      return false;
    }
    if (filters.fpRangeStart) {
      const boundaryStart = new Date(`${filters.fpRangeStart}T00:00:00`);
      if (boundaryStart && referenceDate < boundaryStart) {
        return false;
      }
    }
    if (filters.fpRangeEnd) {
      const boundaryEnd = new Date(`${filters.fpRangeEnd}T23:59:59.999Z`);
      if (boundaryEnd && referenceDate > boundaryEnd) {
        return false;
      }
    }
  }

  if (filters.ttrPhase !== 'all') {
    const phase = deps.computeTtrPhase(item, filters.timelineReference, resolveReferenceDateCached());
    if (phase !== filters.ttrPhase) {
      return false;
    }
  }

  if (filters.timeRange !== 'all') {
    if (!matchesTimeRange(item, filters.timeRange)) {
      return false;
    }
  }

  if (filters.internalStatus !== 'all') {
    if (item.internalStatus !== filters.internalStatus) {
      return false;
    }
  }

  return true;
}
