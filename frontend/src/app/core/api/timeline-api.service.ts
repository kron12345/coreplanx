import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { API_CONFIG } from '../config/api-config';
import { PlanningApiContext } from './planning-api-context';
import { TemplateSetDto, TimelineActivityDto, TimelineQuery, TimelineResponseDto } from './timeline-api.types';

@Injectable({ providedIn: 'root' })
export class TimelineApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listTemplateSets(context?: PlanningApiContext): Observable<TemplateSetDto[]> {
    const params = this.buildContextParams(context);
    return this.http.get<TemplateSetDto[] | { items?: TemplateSetDto[] }>(`${this.baseUrl()}/templates`, { params }).pipe(
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

  getTemplate(templateId: string, context?: PlanningApiContext): Observable<TemplateSetDto> {
    const params = this.buildContextParams(context);
    return this.http.get<TemplateSetDto>(`${this.baseUrl()}/templates/${encodeURIComponent(templateId)}`, { params });
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

  upsertTemplateActivity(
    templateId: string,
    activity: TimelineActivityDto,
    context?: PlanningApiContext,
  ): Observable<TimelineActivityDto> {
    const params = this.buildContextParams(context);
    return this.http.put<TimelineActivityDto>(
      `${this.baseUrl()}/templates/${encodeURIComponent(templateId)}/activities/${encodeURIComponent(activity.id)}`,
      activity,
      { params },
    );
  }

  deleteTemplateActivity(templateId: string, activityId: string, context?: PlanningApiContext): Observable<void> {
    const params = this.buildContextParams(context);
    return this.http.delete<void>(
      `${this.baseUrl()}/templates/${encodeURIComponent(templateId)}/activities/${encodeURIComponent(activityId)}`,
      { params },
    );
  }

  updateTemplate(template: TemplateSetDto, context?: PlanningApiContext): Observable<TemplateSetDto> {
    const params = this.buildContextParams(context);
    return this.http.put<TemplateSetDto>(
      `${this.baseUrl()}/templates/${encodeURIComponent(template.id)}`,
      template,
      { params },
    );
  }

  createTemplate(template: TemplateSetDto, context?: PlanningApiContext): Observable<TemplateSetDto> {
    const params = this.buildContextParams(context);
    return this.http.post<TemplateSetDto>(`${this.baseUrl()}/templates`, template, { params });
  }

  publishTemplateSet(
    templateId: string,
    targetVariantId: string,
    context?: PlanningApiContext,
  ): Observable<TemplateSetDto> {
    let params = this.buildContextParams(context);
    const target = targetVariantId?.trim();
    if (target) {
      params = params.set('targetVariantId', target);
    }
    return this.http.post<TemplateSetDto>(
      `${this.baseUrl()}/templates/${encodeURIComponent(templateId)}/publish`,
      {},
      { params },
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
    if (query.variantId) {
      params = params.set('variantId', query.variantId);
    }
    if (query.timetableYearLabel) {
      params = params.set('timetableYearLabel', query.timetableYearLabel);
    }
    return params;
  }

  private buildContextParams(context?: PlanningApiContext): HttpParams {
    let params = new HttpParams();
    const variantId = context?.variantId?.trim();
    if (variantId) {
      params = params.set('variantId', variantId);
    }
    const year = context?.timetableYearLabel?.trim();
    if (year) {
      params = params.set('timetableYearLabel', year);
    }
    return params;
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
