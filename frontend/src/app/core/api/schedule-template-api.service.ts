import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type {
  CreateScheduleTemplatePayload,
  ScheduleTemplateFilters,
  ScheduleTemplateSort,
} from '../services/schedule-template.service';
import type { ScheduleTemplate } from '../models/schedule-template.model';

export interface ScheduleTemplateSearchRequest {
  filters?: Partial<ScheduleTemplateFilters>;
  sort?: ScheduleTemplateSort;
  page?: number;
  pageSize?: number;
}

export interface ScheduleTemplateSearchResponse {
  templates: ScheduleTemplate[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

@Injectable({ providedIn: 'root' })
export class ScheduleTemplateApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  searchTemplates(
    payload: ScheduleTemplateSearchRequest,
  ): Observable<ScheduleTemplateSearchResponse> {
    return this.http.post<ScheduleTemplateSearchResponse>(
      `${this.baseUrl()}/schedule-templates/search`,
      payload,
    );
  }

  getTemplate(templateId: string): Observable<ScheduleTemplate> {
    return this.http.get<ScheduleTemplate>(
      `${this.baseUrl()}/schedule-templates/${encodeURIComponent(templateId)}`,
    );
  }

  createTemplate(payload: CreateScheduleTemplatePayload): Observable<ScheduleTemplate> {
    return this.http.post<ScheduleTemplate>(
      `${this.baseUrl()}/schedule-templates`,
      payload,
    );
  }

  updateTemplate(
    templateId: string,
    payload: Partial<CreateScheduleTemplatePayload>,
  ): Observable<ScheduleTemplate> {
    return this.http.put<ScheduleTemplate>(
      `${this.baseUrl()}/schedule-templates/${encodeURIComponent(templateId)}`,
      payload,
    );
  }

  deleteTemplate(templateId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.baseUrl()}/schedule-templates/${encodeURIComponent(templateId)}`,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
