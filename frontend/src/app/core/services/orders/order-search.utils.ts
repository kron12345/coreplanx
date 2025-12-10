import { Order } from '../../models/order.model';
import { OrderItem } from '../../models/order-item.model';
import { OrderFilters, OrderSearchTokens } from './order-filters.model';

interface SearchDeps {
  getItemTimetableYear: (item: OrderItem) => string | null;
}

export function collectOrderAndItemTags(order: Order): string[] {
  const tags = new Set<string>();
  order.tags?.forEach((tag) => tags.add(tag));
  order.items.forEach((item) => {
    item.tags?.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags);
}

export function buildItemSearchHaystack(
  item: OrderItem,
  getItemTimetableYear: (it: OrderItem) => string | null,
): string {
  const timetable = item.originalTimetable;
  const timetableStops =
    timetable?.stops?.map((stop) => stop.locationName).join(' ') ?? '';
  const timetableVariants =
    timetable?.variants
      ?.map(
        (variant) =>
          `${variant.variantNumber ?? variant.id ?? ''} ${variant.description ?? ''}`,
      )
      .join(' ') ?? '';
  const timetableModifications =
    timetable?.modifications
      ?.map((modification) => `${modification.date} ${modification.description ?? ''}`)
      .join(' ') ?? '';
  const validitySegments =
    item.validity
      ?.map((segment) => `${segment.startDate} ${segment.endDate}`)
      .join(' ') ?? '';
  const timetableYear = getItemTimetableYear(item);

  const fields = [
    item.id,
    item.name,
    item.type,
    item.responsible ?? '',
    item.fromLocation ?? '',
    item.toLocation ?? '',
    item.serviceType ?? '',
    item.tags?.join(' ') ?? '',
    validitySegments ?? '',
    timetableStops,
    timetableVariants,
    timetableModifications,
    timetableYear ?? '',
  ];
  return fields.join(' ').toLowerCase();
}

export function matchesOrder(
  order: Order,
  filters: OrderFilters,
  tokens: OrderSearchTokens,
  deps: SearchDeps,
): boolean {
  const aggregatedTags = collectOrderAndItemTags(order);
  if (filters.tag !== 'all' && !aggregatedTags.includes(filters.tag)) {
    return false;
  }
  if (tokens.tags.length && !hasAllTags(aggregatedTags, tokens.tags)) {
    return false;
  }
  if (filters.timetableYearLabel !== 'all') {
    if (order.timetableYearLabel) {
      if (order.timetableYearLabel !== filters.timetableYearLabel) {
        return false;
      }
    } else {
      const matchesYear = order.items.some(
        (item) => deps.getItemTimetableYear(item) === filters.timetableYearLabel,
      );
      if (!matchesYear) {
        return false;
      }
    }
  }
  if (tokens.responsibles.length) {
    const hasResponsible = order.items.some((item) => {
      if (!item.responsible) {
        return false;
      }
      const lower = item.responsible.toLowerCase();
      return tokens.responsibles.some((term) => lower.includes(term));
    });
    if (!hasResponsible) {
      return false;
    }
  }
  if (tokens.customers.length) {
    const customer = (order.customer ?? '').toLowerCase();
    const matchesCustomer = tokens.customers.some((term) => customer.includes(term));
    if (!matchesCustomer) {
      return false;
    }
  }
  if (tokens.textTerms.length) {
    const haystack = `
        ${order.name}
        ${order.id}
        ${order.customer ?? ''}
        ${order.comment ?? ''}
        ${order.tags?.join(' ') ?? ''}
        ${order.items
          .map((item) => buildItemSearchHaystack(item, deps.getItemTimetableYear))
          .join(' ')}
      `.toLowerCase();
    const hasAll = tokens.textTerms.every((term) => haystack.includes(term));
    if (!hasAll) {
      return false;
    }
  }
  return true;
}

function hasAllTags(source: string[], required: string[]): boolean {
  if (!required.length) {
    return true;
  }
  return required.every((tag) =>
    source.some((existing) => existing.toLowerCase() === tag.toLowerCase()),
  );
}
