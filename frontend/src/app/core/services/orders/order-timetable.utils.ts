import { OrderItem } from '../../models/order-item.model';
import { TrainPlan } from '../../models/train-plan.model';
import { TimetableYearBounds } from '../../models/timetable-year.model';
import { TrafficPeriodService } from '../traffic-period.service';
import { TimetableYearService } from '../timetable-year.service';
import { extractPlanEnd, extractPlanStart } from './order-plan.utils';

export function deriveOrderTimetableYear(
  items: OrderItem[],
  getItemTimetableYear: (item: OrderItem) => string | null,
): string | undefined {
  let label: string | undefined;
  for (const item of items) {
    const current = getItemTimetableYear(item) ?? undefined;
    if (!current) {
      continue;
    }
    if (!label) {
      label = current;
      continue;
    }
    if (label !== current) {
      return undefined;
    }
  }
  return label;
}

export function getTrafficPeriodTimetableYear(
  periodId: string,
  trafficPeriodService: TrafficPeriodService,
  timetableYearService: TimetableYearService,
): string | null {
  if (!periodId) {
    return null;
  }
  const period = trafficPeriodService.getById(periodId);
  if (!period) {
    return null;
  }
  if (period.timetableYearLabel) {
    return period.timetableYearLabel;
  }
  const sample =
    period.rules?.find((rule) => rule.includesDates?.length)?.includesDates?.[0] ??
    period.rules?.[0]?.validityStart;
  if (!sample) {
    return null;
  }
  try {
    return timetableYearService.getYearBounds(sample).label;
  } catch {
    return null;
  }
}

export function timetableYearFromPlan(
  plan: TrainPlan,
  timetableYearService: TimetableYearService,
): string | null {
  const sample =
    plan.calendar?.validFrom ??
    plan.calendar?.validTo ??
    extractPlanStart(plan) ??
    extractPlanEnd(plan);
  if (!sample) {
    return null;
  }
  try {
    return timetableYearService.getYearBounds(sample).label;
  } catch {
    return null;
  }
}

export function resolveTimetableYearBoundsForItem(
  item: OrderItem,
  trafficPeriodService: TrafficPeriodService,
  timetableYearService: TimetableYearService,
  getItemTimetableYear: (it: OrderItem) => string | null,
): TimetableYearBounds | null {
  const label = getItemTimetableYear(item);
  if (label) {
    try {
      return timetableYearService.getYearByLabel(label);
    } catch {
      // ignore and try fallbacks
    }
  }

  if (item.trafficPeriodId) {
    const period = trafficPeriodService.getById(item.trafficPeriodId);
    if (period?.timetableYearLabel) {
      try {
        return timetableYearService.getYearByLabel(period.timetableYearLabel);
      } catch {
        // ignore and try sample dates
      }
    }
    const sample =
      period?.rules?.find((rule) => rule.includesDates?.length)?.includesDates?.[0] ??
      period?.rules?.[0]?.validityStart;
    if (sample) {
      try {
        return timetableYearService.getYearBounds(sample);
      } catch {
        // ignore
      }
    }
  }

  const sampleDate =
    item.validity?.[0]?.startDate ??
    item.start ??
    item.end ??
    item.originalTimetable?.calendar?.validFrom ??
    undefined;
  if (sampleDate) {
    try {
      return timetableYearService.getYearBounds(sampleDate);
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveTimetableYearStart(
  item: OrderItem,
  timetableYearService: TimetableYearService,
  getItemTimetableYear: (it: OrderItem) => string | null,
  extractReferenceSampleDate: (it: OrderItem) => Date | null,
): Date | null {
  const label = getItemTimetableYear(item);
  try {
    if (label) {
      return timetableYearService.getYearByLabel(label).start;
    }
    const sample = extractReferenceSampleDate(item);
    return sample ? timetableYearService.getYearBounds(sample).start : null;
  } catch {
    return null;
  }
}
