import type { OrderItemValiditySegment } from '../../../core/models/order-item.model';
import type { TrafficPeriod } from '../../../core/models/traffic-period.model';
import type { TrainPlanCalendar } from '../../../core/models/train-plan.model';

export function deriveYearFromLabel(label: string | null | undefined): number | null {
  if (!label) {
    return null;
  }
  const match = /^(\d{4})/.exec(label);
  if (match) {
    const year = Number.parseInt(match[1], 10);
    return Number.isNaN(year) ? null : year;
  }
  return null;
}

export function deriveInitialCustomYear(validFrom: string | undefined): number {
  if (validFrom && /^\d{4}-/.test(validFrom)) {
    const parsed = Number.parseInt(validFrom.slice(0, 4), 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return new Date().getFullYear();
}

export function calendarFromCustomSelection(dates: string[]): TrainPlanCalendar {
  const sorted = [...dates].sort();
  const validFrom = sorted[0] ?? '';
  const validTo = sorted[sorted.length - 1] ?? validFrom;
  return {
    validFrom,
    validTo: validTo && validTo !== validFrom ? validTo : undefined,
    daysBitmap: bitmapFromDates(sorted),
  };
}

export function deriveDatesFromCalendar(calendar: TrainPlanCalendar): string[] {
  const { validFrom } = calendar;
  if (!validFrom) {
    return [];
  }
  const start = new Date(validFrom);
  if (Number.isNaN(start.getTime())) {
    return [];
  }
  const end = calendar.validTo ? new Date(calendar.validTo) : new Date(validFrom);
  if (Number.isNaN(end.getTime())) {
    return [];
  }
  const bitmap =
    calendar.daysBitmap && /^[01]{7}$/.test(calendar.daysBitmap) ? calendar.daysBitmap : '1111111';

  const result: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const weekday = (cursor.getDay() + 6) % 7;
    if (bitmap[weekday] === '1') {
      result.push(formatDate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export function expandDatesInRange(startIso: string, endIso: string): string[] {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const MAX_DAYS = 1460;
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length <= MAX_DAYS) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function bitmapFromDates(dates: string[]): string {
  const bits = ['0', '0', '0', '0', '0', '0', '0'];
  dates.forEach((date) => {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      const weekday = (parsed.getDay() + 6) % 7;
      bits[weekday] = '1';
    }
  });
  return bits.join('');
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mergeBitmap(a: string, b: string): string {
  const result: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const bitA = a[i] === '1';
    const bitB = b[i] === '1';
    result.push(bitA || bitB ? '1' : '0');
  }
  return result.join('');
}

export function calendarFromPeriod(period: TrafficPeriod): TrainPlanCalendar {
  let earliest: string | undefined;
  let latest: string | undefined;
  let combinedBitmap = '0000000';

  period.rules.forEach((rule) => {
    const start = rule.validityStart;
    const end = rule.validityEnd ?? rule.validityStart;
    if (!earliest || start < earliest) {
      earliest = start;
    }
    if (!latest || end > latest) {
      latest = end;
    }
    if (rule.daysBitmap?.length === 7) {
      combinedBitmap = mergeBitmap(combinedBitmap, rule.daysBitmap);
    }
  });

  return {
    validFrom: earliest ?? new Date().toISOString().slice(0, 10),
    validTo: latest,
    daysBitmap: combinedBitmap.includes('1') ? combinedBitmap : '1111111',
  };
}

export function buildSegmentsFromDates(dates: string[]): OrderItemValiditySegment[] {
  if (!dates.length) {
    return [];
  }
  const normalized = Array.from(new Set(dates.filter((date) => !!date))).sort();
  const segments: OrderItemValiditySegment[] = [];
  let start = normalized[0];
  let prev = start;
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    if (areConsecutiveDates(prev, current)) {
      prev = current;
      continue;
    }
    segments.push({ startDate: start, endDate: prev });
    start = current;
    prev = current;
  }
  segments.push({ startDate: start, endDate: prev });
  return segments;
}

export function areConsecutiveDates(a: string, b: string): boolean {
  const first = new Date(`${a}T00:00:00Z`);
  const second = new Date(`${b}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime())) {
    return false;
  }
  const diff = second.getTime() - first.getTime();
  return diff === 24 * 60 * 60 * 1000;
}

