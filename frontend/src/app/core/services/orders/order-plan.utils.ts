import { TrainPlan, TrainPlanStop } from '../../models/train-plan.model';
import { TimetableStopInput } from '../timetable.service';
import { OrderItem } from '../../models/order-item.model';

export interface TimetableYearLookup {
  getYearByLabel(label: string): { label: string };
}

export function extractPlanStart(plan: { stops: TrainPlan['stops'] }): string | undefined {
  const sorted = [...plan.stops].sort((a, b) => a.sequence - b.sequence);
  for (const stop of sorted) {
    if (stop.departureTime) {
      return stop.departureTime;
    }
    if (stop.arrivalTime) {
      return stop.arrivalTime;
    }
  }
  return undefined;
}

export function extractPlanEnd(plan: { stops: TrainPlan['stops'] }): string | undefined {
  const sorted = [...plan.stops].sort((a, b) => b.sequence - a.sequence);
  for (const stop of sorted) {
    if (stop.arrivalTime) {
      return stop.arrivalTime;
    }
    if (stop.departureTime) {
      return stop.departureTime;
    }
  }
  return undefined;
}

export function toTimetableStops(stops: TrainPlanStop[]): TimetableStopInput[] {
  return stops.map((stop) => ({
    sequence: stop.sequence,
    type: stop.type,
    locationCode: stop.locationCode ?? `LOC-${stop.sequence}`,
    locationName: stop.locationName ?? stop.locationCode ?? 'Unbekannter Halt',
    countryCode: stop.countryCode,
    arrivalTime: formatIsoToTime(stop.arrivalTime),
    departureTime: formatIsoToTime(stop.departureTime),
    arrivalOffsetDays: stop.arrivalOffsetDays,
    departureOffsetDays: stop.departureOffsetDays,
    dwellMinutes: stop.dwellMinutes,
    activities: stop.activities?.length ? stop.activities : ['0001'],
    platform: stop.platform,
    notes: stop.notes,
  }));
}

export function formatIsoToTime(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function normalizeCalendarDates(dates: string[]): string[] {
  if (!dates?.length) {
    return [];
  }
  return Array.from(
    new Set(
      dates
        .map((date) => date?.slice(0, 10))
        .filter(
          (date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date),
        ),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export function normalizeTimetableYearLabel(
  label?: string | null,
  lookup?: TimetableYearLookup,
): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!lookup) {
    return trimmed;
  }
  try {
    return lookup.getYearByLabel(trimmed).label;
  } catch {
    return undefined;
  }
}

export function combineDateTime(date: string, time: string): string {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(time);
  const [year, month, day] = date.split('-').map(Number);
  const hours = match ? Number.parseInt(match[1], 10) : 0;
  const minutes = match ? Number.parseInt(match[2], 10) : 0;
  const result = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return result.toISOString();
}

export function applyPlanDetailsToItem(item: OrderItem, plan: TrainPlan): OrderItem {
  const start = extractPlanStart(plan);
  const end = extractPlanEnd(plan);
  const firstStop = plan.stops[0];
  const lastStop = plan.stops[plan.stops.length - 1];

  const updated: OrderItem = {
    ...item,
    responsible: plan.responsibleRu,
    fromLocation: firstStop?.locationName ?? item.fromLocation,
    toLocation: lastStop?.locationName ?? item.toLocation,
    simulationId: plan.simulationId ?? item.simulationId,
    simulationLabel: plan.simulationLabel ?? item.simulationLabel,
  };

  if (start) {
    updated.start = start;
  }
  if (end) {
    updated.end = end;
  }

  if (plan.trafficPeriodId) {
    updated.trafficPeriodId = plan.trafficPeriodId;
    updated.validity = undefined;
  } else if (plan.calendar?.validFrom) {
    updated.trafficPeriodId = undefined;
    const endDate = plan.calendar.validTo ?? plan.calendar.validFrom;
    updated.validity = [
      {
        startDate: plan.calendar.validFrom,
        endDate,
      },
    ];
  } else {
    updated.trafficPeriodId = undefined;
    updated.validity = undefined;
  }

  return updated;
}
