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

export interface OrderFmSummaryEntryDto {
  label: string;
  count: number;
}

export interface OrderPhaseSnapshotDto {
  orderId: string;
  linkedPlanCount: number;
  matchedCaseCount: number;
  activeCaseCount: number;
  terminalCaseCount: number;
  missingOrderItemLinks: number;
  unresolvedPlanIds: string[];
  stateSummaries: OrderFmSummaryEntryDto[];
  tttSummaries: OrderFmSummaryEntryDto[];
  ttrSummaries: OrderFmSummaryEntryDto[];
  generatedAt: string;
}

export interface OrderOperationalContextDto {
  caseId: string;
  caseTitle: string;
  caseCurrentState: string;
  profileId: string;
  profileLabel: string;
  trainPlanId?: string;
  timetableYearLabel: string;
  validFrom: string;
  validTo: string;
  contextState: string;
  contextStatus: 'active' | 'terminal';
  tttPhase?: string | null;
  ttrPhase?: string | null;
}

export interface OrderTraceabilityMessageDto {
  id: string;
  direction: 'outbound' | 'inbound' | 'internal';
  source: string;
  actor: string;
  eventKey: string;
  externalMessageId?: string | null;
  correlationKey?: string | null;
  createdAt: string;
}

export interface OrderTraceabilityTransitionDto {
  id: string;
  fromState: string;
  toState: string;
  eventKey: string;
  source: string;
  actionId?: string | null;
  rejected: boolean;
  reason?: string | null;
  createdAt: string;
}

export interface OrderTraceabilityEntryDto {
  caseId: string;
  caseTitle: string;
  profileId: string;
  profileLabel: string;
  trainPlanId?: string;
  validFrom: string;
  validTo: string;
  currentState: string;
  isTerminal: boolean;
  pathRequestId?: string | null;
  pathId?: string | null;
  contextCount: number;
  messageCount: number;
  transitionCount: number;
  lastMessage?: OrderTraceabilityMessageDto | null;
  lastTransition?: OrderTraceabilityTransitionDto | null;
  detailStatus: 'ok' | 'degraded';
  detailError?: string | null;
}

export interface OrderTraceabilityDto {
  orderId: string;
  linkedPlanCount: number;
  matchedCaseCount: number;
  unresolvedPlanIds: string[];
  degradedCaseCount: number;
  entries: OrderTraceabilityEntryDto[];
  generatedAt: string;
}

export interface OrderTraceabilityCaseDetailsDto {
  orderId: string;
  caseId: string;
  caseTitle: string;
  profileId: string;
  profileLabel: string;
  trainPlanId?: string;
  validFrom: string;
  validTo: string;
  currentState: string;
  isTerminal: boolean;
  pathRequestId?: string | null;
  pathId?: string | null;
  operationalContexts: OrderOperationalContextDto[];
  detailStatus: 'ok' | 'degraded';
  detailError?: string | null;
  messages: OrderTraceabilityMessageDto[];
  transitions: OrderTraceabilityTransitionDto[];
  generatedAt: string;
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

  getOrderPhaseSnapshot(orderId: string): Observable<OrderPhaseSnapshotDto> {
    return this.http.get<OrderPhaseSnapshotDto>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}/phase-snapshot`,
    );
  }

  getOrderOperationalContexts(
    orderId: string,
  ): Observable<OrderOperationalContextDto[]> {
    return this.http.get<OrderOperationalContextDto[]>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}/operational-contexts`,
    );
  }

  getOrderTraceability(orderId: string): Observable<OrderTraceabilityDto> {
    return this.http.get<OrderTraceabilityDto>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}/traceability`,
    );
  }

  getOrderTraceabilityCaseDetails(
    orderId: string,
    caseId: string,
  ): Observable<OrderTraceabilityCaseDetailsDto> {
    return this.http.get<OrderTraceabilityCaseDetailsDto>(
      `${this.baseUrl()}/orders/${encodeURIComponent(orderId)}/traceability/${encodeURIComponent(caseId)}`,
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
