import type { BusinessStatus } from '../../core/models/business.model';
import type { BusinessDueDateFilter } from '../../core/services/business.service';
import type { SortOption } from './business-list.types';

export const BUSINESS_PAGE_SIZE = 20;

export const BUSINESS_STATUS_OPTIONS: Array<{
  value: BusinessStatus | 'all';
  label: string;
}> = [
  { value: 'all', label: 'Alle' },
  { value: 'neu', label: 'Neu' },
  { value: 'in_arbeit', label: 'In Arbeit' },
  { value: 'pausiert', label: 'Pausiert' },
  { value: 'erledigt', label: 'Erledigt' },
];

export const BUSINESS_DUE_DATE_PRESET_OPTIONS: Array<{
  value: BusinessDueDateFilter;
  label: string;
  icon: string;
}> = [
  { value: 'all', label: 'Alle', icon: 'all_inclusive' },
  { value: 'today', label: 'Heute', icon: 'event' },
  { value: 'this_week', label: 'Diese Woche', icon: 'calendar_view_week' },
  { value: 'next_week', label: 'Nächste Woche', icon: 'calendar_month' },
  { value: 'overdue', label: 'Überfällig', icon: 'schedule' },
];

export const BUSINESS_SORT_OPTIONS: SortOption[] = [
  { value: 'dueDate:asc', label: 'Fälligkeit · aufsteigend' },
  { value: 'dueDate:desc', label: 'Fälligkeit · absteigend' },
  { value: 'status:asc', label: 'Status' },
  { value: 'createdAt:desc', label: 'Erstellt · neueste zuerst' },
  { value: 'title:asc', label: 'Titel A–Z' },
];

export const BUSINESS_STATUS_LABEL_LOOKUP: Record<BusinessStatus | 'all', string> =
  BUSINESS_STATUS_OPTIONS.reduce(
    (acc, option) => {
      acc[option.value] = option.label;
      return acc;
    },
    {} as Record<BusinessStatus | 'all', string>,
  );

export const BUSINESS_DUE_DATE_LABEL_LOOKUP: Record<BusinessDueDateFilter, string> =
  BUSINESS_DUE_DATE_PRESET_OPTIONS.reduce(
    (acc, option) => {
      acc[option.value] = option.label;
      return acc;
    },
    {} as Record<BusinessDueDateFilter, string>,
  );

export const BUSINESS_STATUS_LABELS: Record<BusinessStatus, string> = {
  neu: BUSINESS_STATUS_LABEL_LOOKUP.neu,
  pausiert: BUSINESS_STATUS_LABEL_LOOKUP.pausiert,
  in_arbeit: BUSINESS_STATUS_LABEL_LOOKUP.in_arbeit,
  erledigt: BUSINESS_STATUS_LABEL_LOOKUP.erledigt,
};

