import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type {
  BusinessTemplate,
  CreateBusinessTemplatePayload,
} from '../models/business-template.model';

export interface BusinessTemplateFilters {
  search: string;
  category: BusinessTemplate['category'] | 'all';
  tag: 'all' | string;
}

export interface BusinessTemplateSort {
  field: 'updatedAt' | 'title';
  direction: 'asc' | 'desc';
}

export interface BusinessTemplateSearchRequest {
  filters?: Partial<BusinessTemplateFilters>;
  sort?: BusinessTemplateSort;
  page?: number;
  pageSize?: number;
}

export interface BusinessTemplateSearchResponse {
  templates: BusinessTemplate[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

@Injectable({ providedIn: 'root' })
export class BusinessTemplateApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  searchTemplates(
    payload: BusinessTemplateSearchRequest,
  ): Observable<BusinessTemplateSearchResponse> {
    return this.http.post<BusinessTemplateSearchResponse>(
      `${this.baseUrl()}/business-templates/search`,
      payload,
    );
  }

  getTemplate(templateId: string): Observable<BusinessTemplate> {
    return this.http.get<BusinessTemplate>(
      `${this.baseUrl()}/business-templates/${encodeURIComponent(templateId)}`,
    );
  }

  createTemplate(
    payload: CreateBusinessTemplatePayload,
  ): Observable<BusinessTemplate> {
    return this.http.post<BusinessTemplate>(
      `${this.baseUrl()}/business-templates`,
      payload,
    );
  }

  updateTemplate(
    templateId: string,
    payload: Partial<CreateBusinessTemplatePayload>,
  ): Observable<BusinessTemplate> {
    return this.http.put<BusinessTemplate>(
      `${this.baseUrl()}/business-templates/${encodeURIComponent(templateId)}`,
      payload,
    );
  }

  deleteTemplate(templateId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.baseUrl()}/business-templates/${encodeURIComponent(templateId)}`,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
