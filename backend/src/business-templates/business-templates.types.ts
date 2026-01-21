export type BusinessAssignmentType = 'group' | 'person';

export interface BusinessAssignment {
  type: BusinessAssignmentType;
  name: string;
}

export type BusinessTemplateCategory =
  | 'Frist'
  | 'Bestellung'
  | 'Kommunikation'
  | 'Custom';

export type BusinessTemplateDueAnchor =
  | 'order_creation'
  | 'production_start'
  | 'go_live';

export interface BusinessTemplateDueRule {
  anchor: BusinessTemplateDueAnchor;
  offsetDays: number;
  label: string;
}

export interface BusinessTemplateStep {
  id: string;
  title: string;
  description: string;
  dueRule: BusinessTemplateDueRule;
  checklist?: string[];
}

export interface BusinessTemplateDto {
  id: string;
  title: string;
  description: string;
  instructions?: string;
  tags: string[];
  category: BusinessTemplateCategory;
  recommendedAssignment: BusinessAssignment;
  dueRule: BusinessTemplateDueRule;
  defaultLeadTimeDays: number;
  automationHint?: string;
  steps?: BusinessTemplateStep[];
  parameterHints?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BusinessTemplateFilters {
  search: string;
  category: BusinessTemplateCategory | 'all';
  tag: 'all' | string;
}

export type BusinessTemplateSortField = 'updatedAt' | 'title';

export interface BusinessTemplateSort {
  field: BusinessTemplateSortField;
  direction: 'asc' | 'desc';
}

export interface BusinessTemplateSearchRequest {
  filters?: Partial<BusinessTemplateFilters>;
  sort?: BusinessTemplateSort;
  page?: number;
  pageSize?: number;
}

export interface BusinessTemplateSearchResponse {
  templates: BusinessTemplateDto[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateBusinessTemplatePayload {
  title: string;
  description: string;
  instructions?: string;
  assignment: BusinessAssignment;
  tags?: string[];
  dueRule: BusinessTemplateDueRule;
  defaultLeadTimeDays: number;
  category?: BusinessTemplateCategory;
  automationHint?: string;
  steps?: BusinessTemplateStep[];
  parameterHints?: string[];
}

export type UpdateBusinessTemplatePayload = Partial<CreateBusinessTemplatePayload>;

export const DEFAULT_BUSINESS_TEMPLATE_FILTERS: BusinessTemplateFilters = {
  search: '',
  category: 'all',
  tag: 'all',
};

export const DEFAULT_BUSINESS_TEMPLATE_SORT: BusinessTemplateSort = {
  field: 'updatedAt',
  direction: 'desc',
};
