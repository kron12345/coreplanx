export type OrderTimelineReference = 'fpDay' | 'operationalDay' | 'fpYear';

export type OrderTtrPhase =
  | 'annual_request'
  | 'final_offer'
  | 'rolling_planning'
  | 'short_term'
  | 'ad_hoc'
  | 'operational_delivery'
  | 'unknown';

export interface OrderFilters {
  search: string;
  tag: string | 'all';
  timeRange: 'all' | 'next4h' | 'next12h' | 'today' | 'thisWeek';
  trainStatus: string | 'all';
  businessStatus: string | 'all';
  internalStatus: string | 'all';
  trainNumber: string;
  timetableYearLabel: string | 'all';
  variantType: 'all' | 'productive' | 'simulation';
  linkedBusinessId: string | null;
  fpRangeStart: string | null;
  fpRangeEnd: string | null;
  timelineReference: OrderTimelineReference;
  ttrPhase: OrderTtrPhase | 'all';
}

export interface OrderSearchTokens {
  textTerms: string[];
  tags: string[];
  responsibles: string[];
  customers: string[];
}

export interface OrdersSearchRequest {
  filters?: Partial<OrderFilters>;
  page?: number;
  pageSize?: number;
}

export interface OrdersSearchResponse {
  orders: OrderDto[];
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
  items: OrderItemDto[];
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
    processStatus?: string;
  };
  items?: OrderItemUpsertPayload[];
}

export type OrderItemUpsertPayload = Omit<OrderItemDto, 'createdAt' | 'updatedAt'>;

export interface OrderDto {
  id: string;
  name: string;
  customerId?: string;
  customer?: string;
  tags?: string[];
  items: OrderItemDto[];
  comment?: string;
  timetableYearLabel?: string;
  processStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrderItemDto {
  id: string;
  name: string;
  type: string;
  tags?: string[];
  start?: string;
  end?: string;
  responsible?: string;
  deviation?: string;
  linkedBusinessIds?: string[];
  linkedTemplateId?: string;
  linkedTrainPlanId?: string;
  trafficPeriodId?: string;
  timetableYearLabel?: string;
  serviceType?: string;
  fromLocation?: string;
  toLocation?: string;
  validity?: unknown;
  parentItemId?: string;
  childItemIds?: string[];
  versionPath?: number[];
  generatedTimetableRefId?: string;
  timetablePhase?: string;
  variantType?: string;
  variantOfItemId?: string;
  variantGroupId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
  mergeStatus?: string;
  mergeTargetId?: string;
  originalTimetable?: unknown;
  internalStatus?: string;
  createdAt?: string;
  updatedAt?: string;
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

export const DEFAULT_ORDER_FILTERS: OrderFilters = {
  search: '',
  tag: 'all',
  timeRange: 'all',
  trainStatus: 'all',
  businessStatus: 'all',
  internalStatus: 'all',
  trainNumber: '',
  timetableYearLabel: 'all',
  variantType: 'all',
  linkedBusinessId: null,
  fpRangeStart: null,
  fpRangeEnd: null,
  timelineReference: 'fpDay',
  ttrPhase: 'all',
};
