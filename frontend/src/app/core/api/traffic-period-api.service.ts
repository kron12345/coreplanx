import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { TrafficPeriod } from '../models/traffic-period.model';

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

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
