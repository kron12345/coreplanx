import {
  DEFAULT_SCHEDULE_TEMPLATE_FILTERS,
  DEFAULT_SCHEDULE_TEMPLATE_SORT,
  ScheduleTemplateDto,
  ScheduleTemplateFilters,
  ScheduleTemplateSort,
  ScheduleTemplateStatus,
} from './schedule-templates.types';

export function normalizeFilters(
  input?: Partial<ScheduleTemplateFilters>,
): ScheduleTemplateFilters {
  const merged: ScheduleTemplateFilters = {
    ...DEFAULT_SCHEDULE_TEMPLATE_FILTERS,
    ...(input ?? {}),
  };
  merged.search = (merged.search ?? '').toString();
  merged.tag = merged.tag && merged.tag !== '' ? merged.tag : 'all';
  merged.status = merged.status ?? 'all';
  merged.category = merged.category ?? 'all';
  merged.day = merged.day ?? 'all';
  return merged;
}

export function normalizeSort(input?: ScheduleTemplateSort): ScheduleTemplateSort {
  if (!input) {
    return { ...DEFAULT_SCHEDULE_TEMPLATE_SORT };
  }
  const field = input.field ?? DEFAULT_SCHEDULE_TEMPLATE_SORT.field;
  const direction: ScheduleTemplateSort['direction'] =
    input.direction === 'asc' ? 'asc' : 'desc';
  return { field, direction };
}

export function matchesTemplate(
  template: ScheduleTemplateDto,
  filters: ScheduleTemplateFilters,
): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search) {
    const haystack = `${template.title} ${template.description ?? ''} ${
      template.trainNumber
    } ${template.tags?.join(' ') ?? ''}`.toLowerCase();
    if (!haystack.includes(search)) {
      return false;
    }
  }

  if (filters.status !== 'all' && template.status !== filters.status) {
    return false;
  }

  if (filters.category !== 'all' && template.category !== filters.category) {
    return false;
  }

  if (filters.tag !== 'all') {
    if (!template.tags?.includes(filters.tag)) {
      return false;
    }
  }

  if (filters.day !== 'all') {
    if (!template.recurrence?.days?.includes(filters.day)) {
      return false;
    }
  }

  return true;
}

export function sortTemplates(
  a: ScheduleTemplateDto,
  b: ScheduleTemplateDto,
  sort: ScheduleTemplateSort,
): number {
  const direction = sort.direction === 'asc' ? 1 : -1;
  switch (sort.field) {
    case 'updatedAt':
      return (
        (new Date(a.updatedAt).getTime() -
          new Date(b.updatedAt).getTime()) *
        direction
      );
    case 'title':
      return (
        a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }) *
        direction
      );
    case 'trainNumber':
      return (
        a.trainNumber.localeCompare(b.trainNumber, 'de', {
          sensitivity: 'base',
        }) * direction
      );
    case 'status': {
      const order: Record<ScheduleTemplateStatus, number> = {
        active: 0,
        draft: 1,
        archived: 2,
      };
      return (order[a.status] - order[b.status]) * direction;
    }
  }
}
