import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { TrafficPeriod } from '../models/traffic-period.model';
import type {
  RailMlTrafficPeriodPayload,
  TrafficPeriodCreatePayload,
  TrafficPeriodVariantPayload,
} from '../services/traffic-period.service';

@Injectable({ providedIn: 'root' })
export class TrafficPeriodApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listPeriods(): Observable<TrafficPeriod[]> {
    return this.http.get<TrafficPeriod[]>(`${this.baseUrl()}/traffic-periods`);
  }

  upsertPeriod(period: TrafficPeriod): Observable<TrafficPeriod> {
    const id = period.id?.trim();
    if (!id) {
      return this.http.post<TrafficPeriod>(`${this.baseUrl()}/traffic-periods`, period);
    }
    return this.http.put<TrafficPeriod>(
      `${this.baseUrl()}/traffic-periods/${encodeURIComponent(id)}`,
      period,
    );
  }

  deletePeriod(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.baseUrl()}/traffic-periods/${encodeURIComponent(id)}`,
    );
  }

  createFromPayload(payload: TrafficPeriodCreatePayload): Observable<TrafficPeriod> {
    return this.http.post<TrafficPeriod>(`${this.baseUrl()}/traffic-periods/compose`, payload);
  }

  updateFromPayload(periodId: string, payload: TrafficPeriodCreatePayload): Observable<TrafficPeriod> {
    return this.http.put<TrafficPeriod>(
      `${this.baseUrl()}/traffic-periods/${encodeURIComponent(periodId)}/compose`,
      payload,
    );
  }

  createSingleDay(payload: {
    name: string;
    date: string;
    type?: TrafficPeriod['type'];
    appliesTo?: TrafficPeriodVariantPayload['appliesTo'];
    variantType?: TrafficPeriodVariantPayload['variantType'];
    tags?: string[];
    description?: string;
    responsible?: string;
  }): Observable<TrafficPeriod> {
    return this.http.post<TrafficPeriod>(`${this.baseUrl()}/traffic-periods/single-day`, payload);
  }

  ensureRailMlPeriod(payload: RailMlTrafficPeriodPayload): Observable<TrafficPeriod> {
    return this.http.post<TrafficPeriod>(`${this.baseUrl()}/traffic-periods/railml`, payload);
  }

  addVariantRule(periodId: string, payload: TrafficPeriodVariantPayload): Observable<TrafficPeriod> {
    return this.http.post<TrafficPeriod>(
      `${this.baseUrl()}/traffic-periods/${encodeURIComponent(periodId)}/variant`,
      payload,
    );
  }

  addExclusionDates(periodId: string, dates: string[]): Observable<TrafficPeriod> {
    return this.http.post<TrafficPeriod>(
      `${this.baseUrl()}/traffic-periods/${encodeURIComponent(periodId)}/exclusions`,
      { dates },
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
