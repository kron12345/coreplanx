import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_CONFIG } from '../config/api-config';
import { TemplateSetDto, TimelineActivityDto, TimelineQuery, TimelineResponseDto } from './timeline-api.types';

@Injectable({ providedIn: 'root' })
export class TimelineApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listTemplateSets(): Observable<TemplateSetDto[]> {
    return this.http.get<TemplateSetDto[] | { items?: TemplateSetDto[] }>(`${this.baseUrl()}/templates`).pipe(
      map((response) => {
        if (Array.isArray(response)) {
          return response;
        }
        if (response && Array.isArray(response.items)) {
          return response.items;
        }
        return [];
      }),
    );
  }

  getTemplate(templateId: string): Observable<TemplateSetDto> {
    return this.http.get<TemplateSetDto>(`${this.baseUrl()}/templates/${encodeURIComponent(templateId)}`);
  }

  loadTimeline(query: TimelineQuery): Observable<TimelineResponseDto> {
    const params = this.buildParams(query);
    return this.http.get<TimelineResponseDto>(`${this.baseUrl()}/timeline`, {
      params,
    });
  }

  loadTemplateTimeline(templateId: string, query: TimelineQuery): Observable<TimelineResponseDto> {
    const params = this.buildParams(query);
    return this.http.get<TimelineResponseDto>(
      `${this.baseUrl()}/templates/${encodeURIComponent(templateId)}/timeline`,
      { params },
    );
  }

  upsertTemplateActivity(templateId: string, activity: TimelineActivityDto): Observable<TimelineActivityDto> {
    return this.http.put<TimelineActivityDto>(
      `${this.baseUrl()}/templates/${encodeURIComponent(templateId)}/activities/${encodeURIComponent(activity.id)}`,
      activity,
    );
  }

  deleteTemplateActivity(templateId: string, activityId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl()}/templates/${encodeURIComponent(templateId)}/activities/${encodeURIComponent(activityId)}`,
    );
  }

  updateTemplate(template: TemplateSetDto): Observable<TemplateSetDto> {
    return this.http.put<TemplateSetDto>(
      `${this.baseUrl()}/templates/${encodeURIComponent(template.id)}`,
      template,
    );
  }

  private buildParams(query: TimelineQuery): HttpParams {
    let params = new HttpParams().set('from', query.from).set('to', query.to);
    if (query.stage) {
      params = params.set('stage', query.stage);
    }
    if (query.lod) {
      params = params.set('lod', query.lod);
    }
    if (query.resourceIds?.length) {
      params = params.set('resourceIds', query.resourceIds.join(','));
    }
    return params;
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
