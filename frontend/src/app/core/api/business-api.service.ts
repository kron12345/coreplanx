import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { Business, BusinessStatus } from '../models/business.model';

export type BusinessDueDateFilter =
  | 'all'
  | 'overdue'
  | 'today'
  | 'this_week'
  | 'next_week';

export interface BusinessFilters {
  search: string;
  status: BusinessStatus | 'all';
  dueDate: BusinessDueDateFilter;
  assignment: 'all' | string;
  tags: string[];
}

export type BusinessSortField = 'dueDate' | 'createdAt' | 'status' | 'title';

export interface BusinessSort {
  field: BusinessSortField;
  direction: 'asc' | 'desc';
}

export interface BusinessSearchRequest {
  filters?: Partial<BusinessFilters>;
  sort?: BusinessSort;
  page?: number;
  pageSize?: number;
}

export interface BusinessSearchResponse {
  businesses: Business[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateBusinessPayload {
  title: string;
  description: string;
  dueDate?: string | null;
  status?: BusinessStatus;
  assignment: Business['assignment'];
  documents?: Business['documents'];
  linkedOrderItemIds?: string[];
  tags?: string[];
}

export type UpdateBusinessPayload = Partial<CreateBusinessPayload>;

@Injectable({ providedIn: 'root' })
export class BusinessApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  searchBusinesses(payload: BusinessSearchRequest): Observable<BusinessSearchResponse> {
    return this.http.post<BusinessSearchResponse>(
      `${this.baseUrl()}/businesses/search`,
      payload,
    );
  }

  getBusiness(businessId: string): Observable<Business> {
    return this.http.get<Business>(
      `${this.baseUrl()}/businesses/${encodeURIComponent(businessId)}`,
    );
  }

  createBusiness(payload: CreateBusinessPayload): Observable<Business> {
    return this.http.post<Business>(`${this.baseUrl()}/businesses`, payload);
  }

  updateBusiness(
    businessId: string,
    payload: UpdateBusinessPayload,
  ): Observable<Business> {
    return this.http.put<Business>(
      `${this.baseUrl()}/businesses/${encodeURIComponent(businessId)}`,
      payload,
    );
  }

  deleteBusiness(businessId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.baseUrl()}/businesses/${encodeURIComponent(businessId)}`,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
