import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { Order, OrderProcessStatus } from '../models/order.model';
import type { OrderItem } from '../models/order-item.model';
import type { OrderFilters } from '../services/orders/order-filters.model';

export interface OrdersSearchRequest {
  filters?: Partial<OrderFilters>;
  page?: number;
  pageSize?: number;
}

export interface OrdersSearchResponse {
  orders: Order[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface OrderItemsSearchRequest {
  filters?: Partial<OrderFilters>;
  page?: number;
  pageSize?: number;
}

export interface OrderItemsSearchResponse {
  items: OrderItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface OrderUpsertPayload {
  order: {
    id?: string;
    name: string;
    customerId?: string;
    customer?: string;
    tags?: string[];
    comment?: string;
    timetableYearLabel?: string;
    processStatus?: OrderProcessStatus;
  };
  items?: OrderItem[];
}

@Injectable({ providedIn: 'root' })
export class OrderApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  searchOrders(payload: OrdersSearchRequest): Observable<OrdersSearchResponse> {
    return this.http.post<OrdersSearchResponse>(
      `${this.baseUrl()}/orders/search`,
      payload,
    );
  }

  searchOrderItems(
    orderId: string,
    payload: OrderItemsSearchRequest,
  ): Observable<OrderItemsSearchResponse> {
    return this.http.post<OrderItemsSearchResponse>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}/items/search`,
      payload,
    );
  }

  getOrder(orderId: string): Observable<Order> {
    return this.http.get<Order>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}`,
    );
  }

  createOrder(payload: OrderUpsertPayload): Observable<Order> {
    return this.http.post<Order>(`${this.baseUrl()}/orders`, payload);
  }

  upsertOrder(orderId: string, payload: OrderUpsertPayload): Observable<Order> {
    return this.http.put<Order>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}`,
      payload,
    );
  }

  deleteOrder(orderId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}`,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
