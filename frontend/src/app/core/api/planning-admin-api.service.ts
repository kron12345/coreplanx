import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type {
  PlanningAdminClearResponse,
  PlanningAdminClearScope,
  PlanningAdminSummary,
} from './planning-admin-api.types';

@Injectable({ providedIn: 'root' })
export class PlanningAdminApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  getPlanningDataSummary(limit?: number): Observable<PlanningAdminSummary> {
    const params = limit ? { limit: String(limit) } : undefined;
    return this.http.get<PlanningAdminSummary>(`${this.baseUrl()}/planning/admin/summary`, { params });
  }

  clearPlanningData(scope: PlanningAdminClearScope, confirmation: string): Observable<PlanningAdminClearResponse> {
    return this.http.post<PlanningAdminClearResponse>(`${this.baseUrl()}/planning/admin/clear`, {
      confirmation,
      scope,
    });
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
