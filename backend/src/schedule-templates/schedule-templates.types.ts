export type ScheduleTemplateStatus = 'draft' | 'active' | 'archived';

export type ScheduleTemplateCategory =
  | 'S-Bahn'
  | 'RegionalExpress'
  | 'Fernverkehr'
  | 'Güterverkehr'
  | 'Sonderverkehr';

export type ScheduleTemplateDay =
  | 'Mo'
  | 'Di'
  | 'Mi'
  | 'Do'
  | 'Fr'
  | 'Sa'
  | 'So';

export interface ScheduleTemplateTimingWindow {
  earliest?: string;
  latest?: string;
}

export interface ScheduleTemplateStopDto {
  id: string;
  sequence: number;
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrival?: ScheduleTemplateTimingWindow;
  departure?: ScheduleTemplateTimingWindow;
  offsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platformWish?: string;
  notes?: string;
}

export interface ScheduleTemplateVehicleUnit {
  type: string;
  count: number;
  label?: string;
  note?: string;
}

export interface ScheduleTemplateCompositionChange {
  stopIndex: number;
  action: 'attach' | 'detach';
  vehicles: ScheduleTemplateVehicleUnit[];
  note?: string;
}

export interface ScheduleTemplateComposition {
  base: ScheduleTemplateVehicleUnit[];
  changes: ScheduleTemplateCompositionChange[];
}

export interface ScheduleTemplateRecurrence {
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  days: ScheduleTemplateDay[];
}

export interface ScheduleTemplateDto {
  id: string;
  title: string;
  description?: string;
  trainNumber: string;
  responsibleRu: string;
  status: ScheduleTemplateStatus;
  category: ScheduleTemplateCategory;
  tags?: string[];
  validity: {
    startDate: string;
    endDate?: string;
  };
  createdAt: string;
  updatedAt: string;
  stops: ScheduleTemplateStopDto[];
  recurrence?: ScheduleTemplateRecurrence;
  composition?: ScheduleTemplateComposition;
}

export interface ScheduleTemplateFilters {
  search: string;
  status: ScheduleTemplateStatus | 'all';
  category: ScheduleTemplateCategory | 'all';
  day: ScheduleTemplateDay | 'all';
  tag: 'all' | string;
}

export type ScheduleTemplateSortField =
  | 'updatedAt'
  | 'title'
  | 'trainNumber'
  | 'status';

export interface ScheduleTemplateSort {
  field: ScheduleTemplateSortField;
  direction: 'asc' | 'desc';
}

export interface ScheduleTemplateSearchRequest {
  filters?: Partial<ScheduleTemplateFilters>;
  sort?: ScheduleTemplateSort;
  page?: number;
  pageSize?: number;
}

export interface ScheduleTemplateSearchResponse {
  templates: ScheduleTemplateDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateScheduleTemplateStopPayload {
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrivalEarliest?: string;
  arrivalLatest?: string;
  departureEarliest?: string;
  departureLatest?: string;
  offsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platformWish?: string;
  notes?: string;
}

export interface CreateScheduleTemplatePayload {
  title: string;
  description?: string;
  trainNumber: string;
  responsibleRu: string;
  category: ScheduleTemplateCategory;
  status: ScheduleTemplateStatus;
  startDate: string | Date;
  endDate?: string | Date | null;
  tags?: string[];
  recurrence?: ScheduleTemplateRecurrence;
  stops: CreateScheduleTemplateStopPayload[];
  composition?: ScheduleTemplateComposition;
}

export type UpdateScheduleTemplatePayload = Partial<CreateScheduleTemplatePayload>;

export const DEFAULT_SCHEDULE_TEMPLATE_FILTERS: ScheduleTemplateFilters = {
  search: '',
  status: 'all',
  category: 'all',
  day: 'all',
  tag: 'all',
};

export const DEFAULT_SCHEDULE_TEMPLATE_SORT: ScheduleTemplateSort = {
  field: 'updatedAt',
  direction: 'desc',
};
