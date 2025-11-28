export interface ActivityTemplateSet {
  id: string;
  name: string;
  description?: string | null;
  tableName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateSetPayload {
  id: string;
  name: string;
  description?: string | null;
}

export interface UpdateTemplateSetPayload {
  name?: string;
  description?: string | null;
}
