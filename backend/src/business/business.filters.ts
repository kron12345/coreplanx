import {
  BusinessDto,
  BusinessFilters,
  BusinessSort,
  BusinessStatus,
  DEFAULT_BUSINESS_FILTERS,
  DEFAULT_BUSINESS_SORT,
} from './business.types';

export interface BusinessSearchTokens {
  textTerms: string[];
  tags: string[];
  assignment?: string;
  status?: BusinessStatus;
}

export function normalizeFilters(
  input?: Partial<BusinessFilters>,
): BusinessFilters {
  const merged: BusinessFilters = {
    ...DEFAULT_BUSINESS_FILTERS,
    ...(input ?? {}),
  };

  merged.search = (merged.search ?? '').toString();
  merged.assignment =
    merged.assignment && merged.assignment !== ''
      ? merged.assignment
      : 'all';
  merged.tags = Array.isArray(merged.tags)
    ? merged.tags.filter((tag) => tag && tag.trim())
    : [];
  return merged;
}

export function normalizeSort(input?: BusinessSort): BusinessSort {
  if (!input) {
    return { ...DEFAULT_BUSINESS_SORT };
  }
  const field: BusinessSort['field'] = input.field ?? 'dueDate';
  const direction: BusinessSort['direction'] =
    input.direction === 'desc' ? 'desc' : 'asc';
  return { field, direction };
}

export function parseSearchTokens(search: string): BusinessSearchTokens {
  const tokens: BusinessSearchTokens = {
    textTerms: [],
    tags: [],
  };
  if (!search.trim()) {
    return tokens;
  }
  const segments = tokenizeSearch(search);

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

    if (lower.startsWith('status:')) {
      const value = stripQuotes(lower.slice(7).trim());
      const status = findStatusByToken(value);
      if (status) {
        tokens.status = status;
      }
      return;
    }

    if (
      lower.startsWith('assign:') ||
      lower.startsWith('zustandig:') ||
      lower.startsWith('zustaendig:') ||
      lower.startsWith('owner:')
    ) {
      const separatorIndex = segment.indexOf(':');
      const value = stripQuotes(
        segment.slice(separatorIndex + 1).trim(),
      ).toLowerCase();
      if (value) {
        tokens.assignment = value;
      }
      return;
    }

    tokens.textTerms.push(stripQuotes(segment).toLowerCase());
  });

  if (
    !tokens.textTerms.length &&
    !tokens.tags.length &&
    !tokens.assignment &&
    !tokens.status
  ) {
    tokens.textTerms.push(search.trim().toLowerCase());
  }

  return tokens;
}

export function matchesBusiness(
  business: BusinessDto,
  filters: BusinessFilters,
  now: Date,
  searchTokens: BusinessSearchTokens,
): boolean {
  if (filters.status !== 'all' && business.status !== filters.status) {
    return false;
  }

  if (filters.assignment !== 'all') {
    if (business.assignment.name !== filters.assignment) {
      return false;
    }
  }

  if (filters.tags.length) {
    if (!hasAllTags(business.tags ?? [], filters.tags)) {
      return false;
    }
  }

  if (searchTokens.assignment) {
    if (business.assignment.name.toLowerCase() !== searchTokens.assignment) {
      return false;
    }
  }

  if (searchTokens.status) {
    if (business.status !== searchTokens.status) {
      return false;
    }
  }

  if (searchTokens.tags.length) {
    if (!hasAllTags(business.tags ?? [], searchTokens.tags)) {
      return false;
    }
  }

  if (filters.dueDate !== 'all') {
    const due = business.dueDate ? new Date(business.dueDate) : undefined;
    if (!due) {
      return false;
    }
    switch (filters.dueDate) {
      case 'overdue':
        if (!isBeforeDay(due, now)) {
          return false;
        }
        break;
      case 'today':
        if (!isSameDay(due, now)) {
          return false;
        }
        break;
      case 'this_week':
        if (!isWithinWeek(due, now, 0)) {
          return false;
        }
        break;
      case 'next_week':
        if (!isWithinWeek(due, now, 1)) {
          return false;
        }
        break;
    }
  }

  if (searchTokens.textTerms.length) {
    const haystack =
      `${business.title} ${business.description} ${business.assignment.name} ${
        business.tags?.join(' ') ?? ''
      } ${business.status}`.toLowerCase();
    const hasAllTerms = searchTokens.textTerms.every((term) =>
      haystack.includes(term),
    );
    if (!hasAllTerms) {
      return false;
    }
  }

  return true;
}

export function sortBusinesses(
  a: BusinessDto,
  b: BusinessDto,
  sort: BusinessSort,
): number {
  const direction = sort.direction === 'asc' ? 1 : -1;
  switch (sort.field) {
    case 'dueDate': {
      const dueA = a.dueDate ? new Date(a.dueDate).getTime() : undefined;
      const dueB = b.dueDate ? new Date(b.dueDate).getTime() : undefined;
      if (dueA === dueB) {
        return compareStrings(a.title, b.title) * direction;
      }
      if (dueA === undefined) {
        return 1;
      }
      if (dueB === undefined) {
        return -1;
      }
      return (dueA - dueB) * direction;
    }
    case 'createdAt': {
      return (
        (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
        direction
      );
    }
    case 'status': {
      const order: Record<BusinessStatus, number> = {
        neu: 0,
        in_arbeit: 1,
        pausiert: 2,
        erledigt: 3,
      };
      return (order[a.status] - order[b.status]) * direction;
    }
    case 'title':
    default:
      return compareStrings(a.title, b.title) * direction;
  }
}

function tokenizeSearch(search: string): string[] {
  const tokens: string[] = [];
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
        tokens.push(current.trim());
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.trim().length) {
    tokens.push(current.trim());
  }
  return tokens;
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}

function findStatusByToken(token: string): BusinessStatus | undefined {
  switch (token) {
    case 'neu':
      return 'neu';
    case 'in_arbeit':
    case 'inarbeit':
    case 'arbeit':
      return 'in_arbeit';
    case 'pausiert':
      return 'pausiert';
    case 'erledigt':
    case 'done':
      return 'erledigt';
    default:
      return undefined;
  }
}

function hasAllTags(source: string[], required: string[]): boolean {
  if (!required.length) {
    return true;
  }
  return required.every((tag) =>
    source.some((existing) => existing.toLowerCase() === tag.toLowerCase()),
  );
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, 'de', { sensitivity: 'base' });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isBeforeDay(a: Date, b: Date): boolean {
  const aDate = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bDate = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return aDate.getTime() < bDate.getTime();
}

function isWithinWeek(date: Date, reference: Date, offsetWeeks: number) {
  const start = getStartOfWeek(reference, offsetWeeks);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return date >= start && date < end;
}

function getStartOfWeek(reference: Date, offsetWeeks: number) {
  const start = new Date(reference);
  const day = start.getDay() || 7;
  if (day !== 1) {
    start.setHours(-24 * (day - 1));
  } else {
    start.setHours(0, 0, 0, 0);
  }
  if (offsetWeeks) {
    start.setDate(start.getDate() + offsetWeeks * 7);
  }
  start.setHours(0, 0, 0, 0);
  return start;
}
