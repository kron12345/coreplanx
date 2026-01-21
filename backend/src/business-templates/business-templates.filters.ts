import {
  BusinessTemplateDto,
  BusinessTemplateFilters,
  BusinessTemplateSort,
  DEFAULT_BUSINESS_TEMPLATE_FILTERS,
  DEFAULT_BUSINESS_TEMPLATE_SORT,
} from './business-templates.types';

export function normalizeFilters(
  input?: Partial<BusinessTemplateFilters>,
): BusinessTemplateFilters {
  const merged: BusinessTemplateFilters = {
    ...DEFAULT_BUSINESS_TEMPLATE_FILTERS,
    ...(input ?? {}),
  };
  merged.search = (merged.search ?? '').toString();
  merged.tag = merged.tag && merged.tag !== '' ? merged.tag : 'all';
  merged.category = merged.category ?? 'all';
  return merged;
}

export function normalizeSort(input?: BusinessTemplateSort): BusinessTemplateSort {
  if (!input) {
    return { ...DEFAULT_BUSINESS_TEMPLATE_SORT };
  }
  const field = input.field ?? DEFAULT_BUSINESS_TEMPLATE_SORT.field;
  const direction: BusinessTemplateSort['direction'] =
    input.direction === 'asc' ? 'asc' : 'desc';
  return { field, direction };
}

export function matchesTemplate(
  template: BusinessTemplateDto,
  filters: BusinessTemplateFilters,
): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search) {
    const haystack = `${template.title} ${template.description} ${
      template.instructions ?? ''
    } ${template.tags.join(' ')}`.toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }

  if (filters.category !== 'all' && template.category !== filters.category) {
    return false;
  }

  if (filters.tag !== 'all') {
    if (!template.tags.includes(filters.tag)) {
      return false;
    }
  }

  return true;
}

export function sortTemplates(
  a: BusinessTemplateDto,
  b: BusinessTemplateDto,
  sort: BusinessTemplateSort,
): number {
  const direction = sort.direction === 'asc' ? 1 : -1;
  switch (sort.field) {
    case 'updatedAt':
      return (
        (parseDate(a.updatedAt) - parseDate(b.updatedAt)) * direction
      );
    case 'title':
      return (
        a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }) *
        direction
      );
  }
}

function parseDate(value?: string): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
