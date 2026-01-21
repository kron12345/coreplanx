import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { Customer, CustomerContact } from '../models/customer.model';

export interface CustomerSearchRequest {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CustomerSearchResponse {
  customers: Customer[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CreateCustomerPayload {
  name: string;
  customerNumber: string;
  projectNumber?: string;
  address?: string;
  notes?: string;
  contacts?: CustomerContact[];
}

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;

@Injectable({ providedIn: 'root' })
export class CustomerApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  searchCustomers(payload: CustomerSearchRequest): Observable<CustomerSearchResponse> {
    return this.http.post<CustomerSearchResponse>(
      `${this.baseUrl()}/customers/search`,
      payload,
    );
  }

  getCustomer(customerId: string): Observable<Customer> {
    return this.http.get<Customer>(
      `${this.baseUrl()}/customers/${encodeURIComponent(customerId)}`,
    );
  }

  createCustomer(payload: CreateCustomerPayload): Observable<Customer> {
    return this.http.post<Customer>(`${this.baseUrl()}/customers`, payload);
  }

  deleteCustomer(customerId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.baseUrl()}/customers/${encodeURIComponent(customerId)}`,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
