export interface ActivityCatalogEntry {
  id: string;
  label: string;
  description?: string | null;
  appliesTo: string[];
  relevantFor: string[];
  category: string;
  timeMode: string;
  fields: string[];
  defaultDurationMinutes: number;
  attributes?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export type UpsertActivityCatalogEntriesPayload = ActivityCatalogEntry[];
