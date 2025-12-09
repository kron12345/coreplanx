import { OrderItem, OrderItemValiditySegment } from '../../models/order-item.model';
import { TimetableYearBounds } from '../../models/timetable-year.model';
import { TrafficPeriodService } from '../traffic-period.service';
import { TimetableYearService } from '../timetable-year.service';

export function deriveDefaultValidity(item: OrderItem): OrderItemValiditySegment[] {
  if (!item.start && !item.end) {
    return [];
  }
  const startDate = item.start ? item.start.slice(0, 10) : item.end?.slice(0, 10);
  const endDate = item.end ? item.end.slice(0, 10) : startDate;
  if (!startDate || !endDate) {
    return [];
  }
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return [];
  }
  const normalizedStart = startDate <= endDate ? startDate : endDate;
  const normalizedEnd = endDate >= startDate ? endDate : startDate;
  return [{ startDate: normalizedStart, endDate: normalizedEnd }];
}

export function normalizeSegments(
  segments: OrderItemValiditySegment[],
): OrderItemValiditySegment[] {
  if (!segments.length) {
    return [];
  }
  const sorted = [...segments].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const merged: OrderItemValiditySegment[] = [];
  let current = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const dayAfterCurrentEnd = addDaysToDateString(current.endDate, 1);
    if (dayAfterCurrentEnd >= next.startDate) {
      const maxEnd = current.endDate > next.endDate ? current.endDate : next.endDate;
      current = { startDate: current.startDate, endDate: maxEnd };
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

export function splitSegments(
  segments: OrderItemValiditySegment[],
  rangeStart: string,
  rangeEnd: string,
): { retained: OrderItemValiditySegment[]; extracted: OrderItemValiditySegment[] } {
  const retained: OrderItemValiditySegment[] = [];
  const extracted: OrderItemValiditySegment[] = [];

  segments.forEach((segment) => {
    const segStart = segment.startDate;
    const segEnd = segment.endDate;

    if (rangeEnd < segStart || rangeStart > segEnd) {
      retained.push(segment);
      return;
    }

    const overlapStart = rangeStart > segStart ? rangeStart : segStart;
    const overlapEnd = rangeEnd < segEnd ? rangeEnd : segEnd;

    if (overlapStart > overlapEnd) {
      retained.push(segment);
      return;
    }

    extracted.push({ startDate: overlapStart, endDate: overlapEnd });

    if (segStart < overlapStart) {
      retained.push({
        startDate: segStart,
        endDate: addDaysToDateString(overlapStart, -1),
      });
    }

    if (overlapEnd < segEnd) {
      retained.push({
        startDate: addDaysToDateString(overlapEnd, 1),
        endDate: segEnd,
      });
    }
  });

  return {
    retained: normalizeSegments(retained),
    extracted: normalizeSegments(extracted),
  };
}

export function resolveValiditySegments(item: OrderItem | undefined): OrderItemValiditySegment[] {
  if (!item) {
    return [];
  }
  if (item.validity?.length) {
    return item.validity;
  }
  return deriveDefaultValidity(item);
}

export function resolveEffectiveValidity(
  item: OrderItem,
  trafficPeriodService: TrafficPeriodService,
  timetableYearService: TimetableYearService,
): OrderItemValiditySegment[] {
  if (item.validity?.length) {
    return normalizeSegments(item.validity);
  }

  if (item.trafficPeriodId) {
    const period = trafficPeriodService.getById(item.trafficPeriodId);
    if (period?.rules?.length) {
      let minStart: string | null = null;
      let maxEnd: string | null = null;
      period.rules.forEach((rule) => {
        const start =
          rule.validityStart ??
          rule.includesDates?.[0] ??
          rule.excludesDates?.[0] ??
          null;
        const end =
          rule.validityEnd ??
          rule.includesDates?.[rule.includesDates.length - 1] ??
          rule.excludesDates?.[rule.excludesDates.length - 1] ??
          start;
        if (start) {
          minStart = minStart ? (start < minStart ? start : minStart) : start;
        }
        if (end) {
          maxEnd = maxEnd ? (end > maxEnd ? end : maxEnd) : end;
        }
      });
      if (minStart && maxEnd) {
        return normalizeSegments([{ startDate: minStart, endDate: maxEnd }]);
      }
    }
    if (period?.timetableYearLabel) {
      try {
        const bounds = timetableYearService.getYearByLabel(period.timetableYearLabel);
        return [{ startDate: bounds.startIso, endDate: bounds.endIso }];
      } catch {
        // ignore and fall through
      }
    }
  }

  if (item.timetableYearLabel) {
    try {
      const bounds = timetableYearService.getYearByLabel(item.timetableYearLabel);
      return [{ startDate: bounds.startIso, endDate: bounds.endIso }];
    } catch {
      // ignore and fall through
    }
  }

  const derived = deriveDefaultValidity(item);
  return derived.length ? derived : [];
}

export function prepareCustomSegments(
  segments: OrderItemValiditySegment[],
): OrderItemValiditySegment[] {
  const normalized = segments
    .map((segment) => {
      const startDate = requireDateInput(segment.startDate);
      const endDate = requireDateInput(segment.endDate);
      const [start, end] =
        startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
      return { startDate: start, endDate: end };
    })
    .filter((segment) => segment.startDate && segment.endDate);
  return normalizeSegments(normalized);
}

export function ensureSegmentsWithinValidity(
  validity: OrderItemValiditySegment[],
  segments: OrderItemValiditySegment[],
): void {
  segments.forEach((segment) => {
    const fits = validity.some(
      (range) => segment.startDate >= range.startDate && segment.endDate <= range.endDate,
    );
    if (!fits) {
      throw new Error(
        `Der Zeitraum ${segment.startDate} – ${segment.endDate} liegt nicht innerhalb der Gültigkeit der Auftragsposition.`,
      );
    }
  });
}

export function segmentsWithinRanges(
  validity: OrderItemValiditySegment[],
  segments: OrderItemValiditySegment[],
): boolean {
  return segments.every((segment) =>
    validity.some(
      (range) => segment.startDate >= range.startDate && segment.endDate <= range.endDate,
    ),
  );
}

export function segmentsWithinYearBounds(
  segments: OrderItemValiditySegment[],
  bounds: TimetableYearBounds,
  timetableYearService: TimetableYearService,
): boolean {
  return segments.every(
    (segment) =>
      timetableYearService.isDateWithinYear(segment.startDate, bounds) &&
      timetableYearService.isDateWithinYear(segment.endDate, bounds),
  );
}

export function subtractSegments(
  validity: OrderItemValiditySegment[],
  removals: OrderItemValiditySegment[],
): OrderItemValiditySegment[] {
  let retained = validity;
  removals.forEach((segment) => {
    const result = splitSegments(retained, segment.startDate, segment.endDate);
    retained = result.retained;
  });
  return retained;
}

export function requireDateInput(value: string): string {
  const normalized = normalizeDateInput(value);
  if (!normalized) {
    throw new Error('Ungültiges Datum.');
  }
  return normalized;
}

export function expandSegmentsToDates(segments: OrderItemValiditySegment[]): string[] {
  const result: string[] = [];
  segments.forEach((segment) => {
    const start = toUtcDate(segment.startDate);
    const end = toUtcDate(segment.endDate);
    if (!start || !end) {
      return;
    }
    const cursor = new Date(start.getTime());
    while (cursor <= end) {
      result.push(fromUtcDate(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  });
  return Array.from(new Set(result)).sort();
}

export function buildDaysBitmapFromValidity(
  segments: OrderItemValiditySegment[],
  fallbackStart: string,
  fallbackEnd: string,
): string {
  if (!segments.length) {
    return deriveBitmapFromRange(fallbackStart, fallbackEnd);
  }
  const activeWeekdays = new Set<number>();
  segments.forEach((segment) => {
    const cursor = toUtcDate(segment.startDate);
    const end = toUtcDate(segment.endDate);
    if (!cursor || !end) {
      return;
    }
    while (cursor <= end) {
      const weekday = cursor.getUTCDay();
      activeWeekdays.add(weekday === 0 ? 6 : weekday - 1);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  });
  if (!activeWeekdays.size) {
    return deriveBitmapFromRange(fallbackStart, fallbackEnd);
  }
  return Array.from({ length: 7 })
    .map((_, index) => (activeWeekdays.has(index) ? '1' : '0'))
    .join('');
}

export function deriveBitmapFromRange(startIso: string, endIso: string): string {
  const start = toUtcDate(startIso);
  const end = toUtcDate(endIso);
  if (!start || !end) {
    return '1111111';
  }
  const activeWeekdays = new Set<number>();
  const cursor = new Date(start.getTime());
  while (cursor <= end && activeWeekdays.size < 7) {
    const weekday = cursor.getUTCDay();
    activeWeekdays.add(weekday === 0 ? 6 : weekday - 1);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Array.from({ length: 7 })
    .map((_, index) => (activeWeekdays.has(index) ? '1' : '0'))
    .join('');
}

export function normalizeDateInput(value: string): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!isValidDate(trimmed)) {
    return null;
  }
  return trimmed;
}

export function addDaysToDateString(date: string, days: number): string {
  const utc = toUtcDate(date);
  if (!utc) {
    return date;
  }
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtcDate(utc);
}

export function toUtcDate(value: string): Date | null {
  if (!isValidDate(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function fromUtcDate(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
  ].join('-');
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
