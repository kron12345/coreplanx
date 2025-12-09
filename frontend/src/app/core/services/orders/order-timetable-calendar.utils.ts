import { OrderItem } from '../../models/order-item.model';
import { TrafficPeriod } from '../../models/traffic-period.model';
import {
  TimetableCalendarModification,
  TimetableCalendarVariant,
} from '../../models/timetable.model';
import { resolveValiditySegments } from './order-validity.utils';

export function buildCalendarVariants(
  baseItem: OrderItem | undefined,
  period: TrafficPeriod | undefined,
): TimetableCalendarVariant[] {
  if (period) {
    return buildVariantsFromTrafficPeriod(period);
  }
  if (!baseItem) {
    return [];
  }
  const segments = resolveValiditySegments(baseItem);
  if (!segments.length) {
    return [];
  }
  return segments.map((segment, index) => ({
    id: `${baseItem.id}-segment-${index}`,
    type: 'series',
    description: baseItem.name ?? 'Referenzkalender',
    validFrom: segment.startDate,
    validTo: segment.endDate,
    appliesTo: 'both',
  }));
}

export function buildCalendarModifications(
  items: OrderItem[],
  period: TrafficPeriod | undefined,
): TimetableCalendarModification[] {
  const modifications: TimetableCalendarModification[] = [];

  period?.rules?.forEach((rule) => {
    rule.excludesDates?.forEach((date) => {
      modifications.push({
        date,
        description: `${rule.name ?? period.name} · Ausfall`,
        type: 'cancelled',
        notes: period.description,
      });
    });
  });

  items
    .filter((item) => !!item.parentItemId)
    .forEach((child) => {
      resolveValiditySegments(child).forEach((segment, idx) => {
        const range =
          segment.endDate && segment.endDate !== segment.startDate
            ? `${segment.startDate} – ${segment.endDate}`
            : segment.startDate;
        modifications.push({
          date: segment.startDate,
          description: `${child.name ?? 'Sub-Auftragsposition'} (${range})`,
          type: 'modified_timetable',
          notes: child.deviation ?? `Child ${child.id}-${idx}`,
        });
      });
    });

  return modifications;
}

function buildVariantsFromTrafficPeriod(period: TrafficPeriod): TimetableCalendarVariant[] {
  if (!period.rules?.length) {
    return [];
  }
  return period.rules.map((rule, index) => ({
    id: rule.id ?? `${period.id}-rule-${index}`,
    type: rule.variantType ?? 'series',
    description: rule.name ?? period.name,
    validFrom: rule.validityStart,
    validTo: rule.validityEnd,
    daysOfWeek: daysFromBitmap(rule.daysBitmap),
    dates: rule.includesDates?.length ? [...rule.includesDates] : undefined,
    appliesTo: rule.appliesTo ?? 'both',
    variantNumber: rule.variantNumber ?? `${index}`.padStart(2, '0'),
    reason: rule.reason ?? period.description,
  }));
}

function daysFromBitmap(bitmap?: string): string[] | undefined {
  if (!bitmap || bitmap.length !== 7) {
    return undefined;
  }
  const map = ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'];
  const result: string[] = [];
  bitmap.split('').forEach((bit, index) => {
    if (bit === '1') {
      result.push(map[index]);
    }
  });
  return result.length ? result : undefined;
}
