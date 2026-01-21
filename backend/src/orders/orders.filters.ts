import {
  DEFAULT_ORDER_FILTERS,
  OrderFilters,
  OrderItemDto,
  OrderSearchTokens,
  OrderTimelineReference,
  OrderTtrPhase,
} from './orders.types';

export interface OrderItemFilterContext {
  item: OrderItemDto;
  linkedTrainNumber?: string | null;
  trafficPeriodYearLabel?: string | null;
  businessStatuses: string[];
}

export function normalizeFilters(
  input?: Partial<OrderFilters>,
): OrderFilters {
  const merged: OrderFilters = {
    ...DEFAULT_ORDER_FILTERS,
    ...(input ?? {}),
  };

  merged.search = (merged.search ?? '').toString();
  merged.tag = merged.tag && merged.tag !== '' ? merged.tag : 'all';
  merged.trainNumber = (merged.trainNumber ?? '').toString();
  merged.timetableYearLabel =
    merged.timetableYearLabel && merged.timetableYearLabel !== ''
      ? merged.timetableYearLabel
      : 'all';
  merged.variantType =
    merged.variantType === 'productive' || merged.variantType === 'simulation'
      ? merged.variantType
      : 'all';
  merged.timelineReference =
    merged.timelineReference === 'fpYear' ||
    merged.timelineReference === 'operationalDay'
      ? merged.timelineReference
      : 'fpDay';
  merged.ttrPhase = merged.ttrPhase ?? 'all';
  merged.linkedBusinessId =
    merged.linkedBusinessId && merged.linkedBusinessId.trim()
      ? merged.linkedBusinessId.trim()
      : null;
  merged.fpRangeStart = merged.fpRangeStart?.trim() || null;
  merged.fpRangeEnd = merged.fpRangeEnd?.trim() || null;
  return merged;
}

export function parseSearchTokens(search: string): OrderSearchTokens {
  const tokens: OrderSearchTokens = {
    textTerms: [],
    tags: [],
    responsibles: [],
    customers: [],
  };
  const trimmed = search.trim();
  if (!trimmed.length) {
    return tokens;
  }
  const segments = tokenizeSearch(trimmed);
  segments.forEach((segment) => {
    const lower = segment.toLowerCase();
    if (lower.startsWith('tag:')) {
      const value = stripQuotes(segment.slice(4).trim());
      if (value) {
        tokens.tags.push(value);
      }
      return;
    }
    if (segment.startsWith('#')) {
      const value = stripQuotes(segment.slice(1).trim());
      if (value) {
        tokens.tags.push(value);
      }
      return;
    }
    if (
      lower.startsWith('resp:') ||
      lower.startsWith('responsible:') ||
      segment.startsWith('@')
    ) {
      const suffix = segment.startsWith('@')
        ? segment.slice(1)
        : segment.slice(segment.indexOf(':') + 1);
      const value = stripQuotes(suffix.trim()).toLowerCase();
      if (value) {
        tokens.responsibles.push(value);
      }
      return;
    }
    if (lower.startsWith('cust:') || lower.startsWith('kunde:')) {
      const value = stripQuotes(
        segment.slice(segment.indexOf(':') + 1).trim(),
      ).toLowerCase();
      if (value) {
        tokens.customers.push(value);
      }
      return;
    }
    tokens.textTerms.push(stripQuotes(segment).toLowerCase());
  });

  if (
    !tokens.textTerms.length &&
    !tokens.tags.length &&
    !tokens.responsibles.length &&
    !tokens.customers.length
  ) {
    tokens.textTerms.push(trimmed.toLowerCase());
  }

  return tokens;
}

export function tokenizeSearch(search: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < search.length; i += 1) {
    const char = search[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (/\s/.test(char) && !inQuotes) {
      if (current.trim().length) {
        segments.push(current.trim());
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.trim().length) {
    segments.push(current.trim());
  }
  return segments;
}

export function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}

export function matchesOrder(
  order: { name: string; id: string; customer?: string; comment?: string; tags?: string[]; timetableYearLabel?: string | null },
  itemContexts: OrderItemFilterContext[],
  filters: OrderFilters,
  tokens: OrderSearchTokens,
  getItemTimetableYear: (item: OrderItemFilterContext) => string | null,
): boolean {
  const aggregatedTags = collectOrderAndItemTags(order, itemContexts);
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
      const matchesYear = itemContexts.some(
        (ctx) => getItemTimetableYear(ctx) === filters.timetableYearLabel,
      );
      if (!matchesYear) {
        return false;
      }
    }
  }
  if (tokens.responsibles.length) {
    const hasResponsible = itemContexts.some((ctx) => {
      const value = ctx.item.responsible?.toLowerCase();
      if (!value) {
        return false;
      }
      return tokens.responsibles.some((term) => value.includes(term));
    });
    if (!hasResponsible) {
      return false;
    }
  }
  if (tokens.customers.length) {
    const customer = (order.customer ?? '').toLowerCase();
    const matchesCustomer = tokens.customers.some((term) =>
      customer.includes(term),
    );
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
        ${itemContexts
          .map((ctx) => buildItemSearchHaystack(ctx, getItemTimetableYear))
          .join(' ')}
      `.toLowerCase();
    const hasAll = tokens.textTerms.every((term) => haystack.includes(term));
    if (!hasAll) {
      return false;
    }
  }
  return true;
}

export function matchesItem(
  ctx: OrderItemFilterContext,
  filters: OrderFilters,
  getItemTimetableYear: (item: OrderItemFilterContext) => string | null,
): boolean {
  const item = ctx.item;

  if (filters.linkedBusinessId) {
    const businessIds = item.linkedBusinessIds ?? [];
    if (!businessIds.includes(filters.linkedBusinessId)) {
      return false;
    }
  }

  if (filters.trainStatus !== 'all' || filters.trainNumber.trim()) {
    if (item.type !== 'Fahrplan') {
      return false;
    }
    if (filters.trainStatus !== 'all') {
      if (!item.timetablePhase || item.timetablePhase !== filters.trainStatus) {
        return false;
      }
    }
    if (filters.trainNumber.trim()) {
      const search = filters.trainNumber.trim().toLowerCase();
      const trainNumber =
        ctx.linkedTrainNumber ?? item.name ?? '';
      if (!trainNumber.toLowerCase().includes(search)) {
        return false;
      }
    }
  }

  if (filters.timetableYearLabel !== 'all') {
    const itemYear = getItemTimetableYear(ctx);
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
      referenceDateCache = resolveReferenceDate(item, filters.timelineReference, getItemTimetableYear, ctx);
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
    const phase = computeTtrPhase(
      item,
      filters.timelineReference,
      resolveReferenceDateCached(),
      getItemTimetableYear,
      ctx,
    );
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

export function matchesBusinessStatus(
  ctx: OrderItemFilterContext,
  status: string,
): boolean {
  if (status === 'all') {
    return true;
  }
  if (!ctx.businessStatuses.length) {
    return false;
  }
  return ctx.businessStatuses.some((entry) => entry === status);
}

export function computeTtrPhase(
  item: OrderItemDto,
  reference: OrderTimelineReference,
  referenceDateOverride: Date | null | undefined,
  getItemTimetableYear: (ctx: OrderItemFilterContext) => string | null,
  ctx: OrderItemFilterContext,
): OrderTtrPhase {
  const referenceDate =
    referenceDateOverride ?? resolveReferenceDate(item, reference, getItemTimetableYear, ctx);
  if (!referenceDate) {
    return 'unknown';
  }
  const today = startOfDay(new Date());
  const diffDays = Math.floor((referenceDate.getTime() - today.getTime()) / DAY_IN_MS);
  if (Number.isNaN(diffDays)) {
    return 'unknown';
  }
  if (diffDays >= 210) {
    return 'annual_request';
  }
  if (diffDays >= 120) {
    return 'final_offer';
  }
  if (diffDays >= 21) {
    return 'rolling_planning';
  }
  if (diffDays >= 7) {
    return 'short_term';
  }
  if (diffDays >= 0) {
    return 'ad_hoc';
  }
  return 'operational_delivery';
}

function collectOrderAndItemTags(
  order: { tags?: string[] },
  itemContexts: OrderItemFilterContext[],
): string[] {
  const tags = new Set<string>();
  order.tags?.forEach((tag) => tags.add(tag));
  itemContexts.forEach((ctx) => {
    ctx.item.tags?.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags);
}

function buildItemSearchHaystack(
  ctx: OrderItemFilterContext,
  getItemTimetableYear: (item: OrderItemFilterContext) => string | null,
): string {
  const item = ctx.item;
  const timetable = item.originalTimetable as any;
  const timetableStops =
    timetable?.stops?.map((stop: any) => stop.locationName).join(' ') ?? '';
  const timetableVariants =
    timetable?.variants
      ?.map(
        (variant: any) =>
          `${variant.variantNumber ?? variant.id ?? ''} ${variant.description ?? ''}`,
      )
      .join(' ') ?? '';
  const timetableModifications =
    timetable?.modifications
      ?.map((modification: any) => `${modification.date} ${modification.description ?? ''}`)
      .join(' ') ?? '';
  const validitySegments =
    Array.isArray(item.validity)
      ? item.validity
          .map((segment: any) => `${segment.startDate ?? ''} ${segment.endDate ?? ''}`)
          .join(' ')
      : '';
  const timetableYear = getItemTimetableYear(ctx);

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

function hasAllTags(source: string[], required: string[]): boolean {
  if (!required.length) {
    return true;
  }
  return required.every((tag) =>
    source.some((existing) => existing.toLowerCase() === tag.toLowerCase()),
  );
}

export function matchesTimeRange(
  item: OrderItemDto,
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

export function resolveReferenceDate(
  item: OrderItemDto,
  reference: OrderTimelineReference,
  getItemTimetableYear: (ctx: OrderItemFilterContext) => string | null,
  ctx: OrderItemFilterContext,
): Date | null {
  const validityStart = parseDateOnly(extractValidityStart(item));
  const timetableStart = parseDateOnly(extractTimetableStart(item));
  const itemStart = extractItemStartDate(item);
  if (reference === 'fpDay') {
    return validityStart ?? itemStart ?? timetableStart;
  }
  if (reference === 'fpYear') {
    return resolveTimetableYearStart(item, getItemTimetableYear, ctx);
  }
  return itemStart ?? validityStart ?? timetableStart;
}

function resolveTimetableYearStart(
  item: OrderItemDto,
  getItemTimetableYear: (ctx: OrderItemFilterContext) => string | null,
  ctx: OrderItemFilterContext,
): Date | null {
  const label = getItemTimetableYear(ctx);
  try {
    if (label) {
      return computeYearBounds(label).start;
    }
    const sample = extractReferenceSampleDate(item);
    if (!sample) {
      return null;
    }
    const derivedLabel = deriveTimetableYearLabelFromDate(sample);
    return computeYearBounds(derivedLabel).start;
  } catch {
    return null;
  }
}

function extractValidityStart(item: OrderItemDto): string | null {
  if (!Array.isArray(item.validity)) {
    return null;
  }
  const first = item.validity[0] as any;
  return first?.startDate ?? null;
}

function extractTimetableStart(item: OrderItemDto): string | null {
  const timetable = item.originalTimetable as any;
  return timetable?.calendar?.validFrom ?? null;
}

function extractItemStartDate(item: OrderItemDto): Date | null {
  if (!item.start) {
    return null;
  }
  const date = new Date(item.start);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return startOfDay(date);
}

function extractReferenceSampleDate(item: OrderItemDto): Date | null {
  const candidate =
    extractValidityStart(item) ??
    item.start ??
    item.end ??
    extractTimetableStart(item) ??
    null;
  return candidate ? new Date(candidate) : null;
}

function parseDateOnly(value?: string | null): Date | null {
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

function deriveTimetableYearLabelFromDate(date: Date): string {
  const year = date.getUTCFullYear();
  const startThis = buildYearStart(year);
  if (date >= startThis) {
    return formatYearLabel(year);
  }
  return formatYearLabel(year - 1);
}

function formatYearLabel(startYear: number): string {
  const next = (startYear + 1) % 100;
  return `${startYear}/${String(next).padStart(2, '0')}`;
}

function computeYearBounds(label: string): { start: Date; end: Date } {
  const trimmed = label.trim();
  const match = /^(\d{4})(?:[/-](\d{2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid timetable year "${label}".`);
  }
  const startYear = Number.parseInt(match[1], 10);
  if (!Number.isFinite(startYear)) {
    throw new Error(`Invalid timetable year "${label}".`);
  }
  const start = buildYearStart(startYear);
  const end = new Date(buildYearStart(startYear + 1).getTime() - 1);
  return { start, end };
}

function buildYearStart(decemberYear: number): Date {
  const date = new Date(Date.UTC(decemberYear, 11, 10, 0, 0, 0, 0));
  while (date.getUTCDay() !== 0) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

export function addHours(date: Date, hours: number): Date {
  const result = new Date(date.getTime());
  result.setHours(result.getHours() + hours);
  return result;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay();
  const diff = (day + 6) % 7;
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setHours(0, 0, 0, 0);
  return result;
}

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameWeek(date: Date, reference: Date): boolean {
  const start = startOfWeek(reference);
  const end = addHours(start, 7 * 24);
  return date >= start && date < end;
}
