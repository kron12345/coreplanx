import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type {
  OrderManagementAdminClearResponse,
  OrderManagementAdminSeedResponse,
  OrderManagementAdminSummary,
  OrderManagementSeedMode,
} from './order-management-admin-api.types';

@Injectable({ providedIn: 'root' })
export class OrderManagementAdminApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  getSummary(): Observable<OrderManagementAdminSummary> {
    return this.http.get<OrderManagementAdminSummary>(
      `${this.baseUrl()}/order-management/admin/summary`,
    );
  }

  clearData(confirmation: string): Observable<OrderManagementAdminClearResponse> {
    return this.http.post<OrderManagementAdminClearResponse>(
      `${this.baseUrl()}/order-management/admin/clear`,
      { confirmation },
    );
  }

  seedData(
    confirmation: string,
    mode: OrderManagementSeedMode,
  ): Observable<OrderManagementAdminSeedResponse> {
    return this.http.post<OrderManagementAdminSeedResponse>(
      `${this.baseUrl()}/order-management/admin/seed`,
      { confirmation, mode },
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
