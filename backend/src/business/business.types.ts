export type BusinessStatus = 'neu' | 'pausiert' | 'in_arbeit' | 'erledigt';

export type BusinessDueDateFilter =
  | 'all'
  | 'overdue'
  | 'today'
  | 'this_week'
  | 'next_week';

export interface BusinessFilters {
  search: string;
  status: BusinessStatus | 'all';
  dueDate: BusinessDueDateFilter;
  assignment: 'all' | string;
  tags: string[];
}

export type BusinessSortField = 'dueDate' | 'createdAt' | 'status' | 'title';

export interface BusinessSort {
  field: BusinessSortField;
  direction: 'asc' | 'desc';
}

export interface BusinessSearchRequest {
  filters?: Partial<BusinessFilters>;
  sort?: BusinessSort;
  page?: number;
  pageSize?: number;
}

export interface BusinessSearchResponse {
  businesses: BusinessDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateBusinessPayload {
  title: string;
  description: string;
  dueDate?: string | null;
  status?: BusinessStatus;
  assignment: {
    type: 'group' | 'person';
    name: string;
  };
  documents?: unknown;
  linkedOrderItemIds?: string[];
  tags?: string[];
}

export type UpdateBusinessPayload = Partial<CreateBusinessPayload>;

export interface BusinessDto {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  dueDate?: string;
  status: BusinessStatus;
  assignment: {
    type: 'group' | 'person';
    name: string;
  };
  documents?: unknown;
  linkedOrderItemIds?: string[];
  tags?: string[];
}

export const DEFAULT_BUSINESS_FILTERS: BusinessFilters = {
  search: '',
  status: 'all',
  dueDate: 'all',
  assignment: 'all',
  tags: [],
};

export const DEFAULT_BUSINESS_SORT: BusinessSort = {
  field: 'dueDate',
  direction: 'asc',
};
