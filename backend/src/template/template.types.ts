export interface ActivityTemplateSet {
  id: string;
  name: string;
  description?: string | null;
  tableName: string;
  variantId: string;
  timetableYearLabel?: string | null;
  isArchived?: boolean;
  archivedAt?: string | null;
  archivedReason?: string | null;
  publishedFromVariantId?: string | null;
  publishedFromTemplateId?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  periods?: TemplatePeriod[];
  specialDays?: string[];
  attributes?: Record<string, unknown>;
}

export interface CreateTemplateSetPayload {
  id: string;
  name: string;
  description?: string | null;
  periods?: TemplatePeriod[];
  specialDays?: string[];
  attributes?: Record<string, unknown>;
}

export interface UpdateTemplateSetPayload {
  name?: string;
  description?: string | null;
  periods?: TemplatePeriod[];
  specialDays?: string[];
  attributes?: Record<string, unknown>;
}

export interface TemplatePeriod {
  id: string;
  validFrom: string;
  validTo: string | null;
}
