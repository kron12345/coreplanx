import { OrderItem } from '../../models/order-item.model';
import { OrderTimelineReference } from './order-filters.model';

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function addHours(date: Date, hours: number): Date {
  const result = new Date(date.getTime());
  result.setHours(result.getHours() + hours);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay();
  const diff = (day + 6) % 7; // Monday start
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date: Date | null): Date | null {
  if (!date) {
    return null;
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function parseDateOnly(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const normalized = value.slice(0, 10);
  if (!normalized) {
    return null;
  }
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function extractItemStartDate(item: OrderItem): Date | null {
  if (!item.start) {
    return null;
  }
  const date = new Date(item.start);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return startOfDay(date);
}

export function extractReferenceSampleDate(item: OrderItem): Date | null {
  const candidate =
    item.validity?.[0]?.startDate ??
    item.start ??
    item.end ??
    item.originalTimetable?.calendar?.validFrom ??
    null;
  return candidate ? new Date(candidate) : null;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameWeek(date: Date, reference: Date): boolean {
  const start = startOfWeek(reference);
  const end = addDays(start, 7);
  return date >= start && date < end;
}

export function resolveReferenceDate(
  item: OrderItem,
  reference: OrderTimelineReference,
  resolveTimetableYearStart: (it: OrderItem) => Date | null,
): Date | null {
  const validityStart = parseDateOnly(item.validity?.[0]?.startDate);
  const timetableStart = parseDateOnly(item.originalTimetable?.calendar?.validFrom);
  const itemStart = extractItemStartDate(item);
  if (reference === 'fpDay') {
    return validityStart ?? itemStart ?? timetableStart;
  }
  if (reference === 'fpYear') {
    return resolveTimetableYearStart(item);
  }
  return itemStart ?? validityStart ?? timetableStart;
}
