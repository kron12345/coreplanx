import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';

export interface PlanningVariantDto {
  id: string;
  timetableYearLabel: string;
  kind: 'productive' | 'simulation';
  label: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class TimetableYearApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listYears(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl()}/timetable-years`);
  }

  listVariants(timetableYearLabel?: string): Observable<PlanningVariantDto[]> {
    let params = new HttpParams();
    const trimmed = timetableYearLabel?.trim();
    if (trimmed) {
      params = params.set('timetableYearLabel', trimmed);
    }
    return this.http.get<PlanningVariantDto[]>(`${this.baseUrl()}/timetable-years/variants`, { params });
  }

  createYear(label: string): Observable<{ label: string; variantId: string }> {
    return this.http.post<{ label: string; variantId: string }>(`${this.baseUrl()}/timetable-years`, { label });
  }

  deleteYear(label: string): Observable<void> {
    const params = new HttpParams().set('label', label);
    return this.http.delete<void>(`${this.baseUrl()}/timetable-years`, { params });
  }

  createVariant(payload: { timetableYearLabel: string; label: string; description?: string | null }): Observable<PlanningVariantDto> {
    return this.http.post<PlanningVariantDto>(`${this.baseUrl()}/timetable-years/variants`, payload);
  }

  updateVariant(
    variantId: string,
    payload: { label?: string; description?: string | null },
  ): Observable<PlanningVariantDto> {
    return this.http.put<PlanningVariantDto>(
      `${this.baseUrl()}/timetable-years/variants/${encodeURIComponent(variantId)}`,
      payload,
    );
  }

  deleteVariant(variantId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl()}/timetable-years/variants/${encodeURIComponent(variantId)}`,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
