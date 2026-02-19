export type OrderingProcessProfileId = 'annual_order' | 'occasional_traffic';

export type OrderingActor =
  | 'RAILWAY_UNDERTAKING'
  | 'INFRASTRUCTURE_MANAGER'
  | 'SYSTEM';

export interface OrderingEventTuple {
  actor: OrderingActor;
  messageType?: number | null;
  messageStatus?: number | null;
  typeOfRequest?: number | null;
  typeOfInformation?: number | null;
}

export interface OrderingRequiredAttributeStatus {
  key: string;
  label: string;
  scope: 'case' | 'provided';
  path: string;
  required: boolean;
  missing: boolean;
}

export interface OrderingOperationalContext {
  timetableYearLabel: string;
  validFrom: string;
  validTo: string;
  state: string;
  status: 'active' | 'terminal';
}

export interface OrderingAggregatedPhaseSnapshot {
  profileId: OrderingProcessProfileId;
  currentState: string;
  isTerminal: boolean;
  tttPhase?: string | null;
  ttrPhase?: string | null;
}

export interface OrderingActionAvailability {
  id: string;
  label: string;
  blocked: boolean;
  reasons: string[];
  eventTuple: OrderingEventTuple;
}

export interface TimetableOrderingCaseDto {
  id: string;
  profileId: OrderingProcessProfileId;
  profileLabel: string;
  title: string;
  description?: string | null;
  trainPlanId?: string | null;
  validFrom: string;
  validTo: string;
  pathRequestId?: string | null;
  pathId?: string | null;
  currentState: string;
  isTerminal: boolean;
  requiredAttributes: OrderingRequiredAttributeStatus[];
  providedAttributes: Record<string, unknown>;
  blockingReasons: string[];
  operationalContexts: OrderingOperationalContext[];
  aggregatedPhase: OrderingAggregatedPhaseSnapshot;
  allowedActions: OrderingActionAvailability[];
  createdAt: string;
  updatedAt: string;
}

export interface TimetableOrderingMessageDto {
  id: string;
  caseId: string;
  direction: 'outbound' | 'inbound' | 'internal';
  source: string;
  actor: OrderingActor;
  messageType?: number | null;
  messageStatus?: number | null;
  typeOfRequest?: number | null;
  typeOfInformation?: number | null;
  eventKey: string;
  externalMessageId?: string | null;
  correlationKey?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface TimetableOrderingTransitionDto {
  id: string;
  caseId: string;
  fromState: string;
  toState: string;
  eventKey: string;
  source: string;
  actionId?: string | null;
  rejected: boolean;
  reason?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
}

export interface TimetableOrderingCaseDetailsDto {
  case: TimetableOrderingCaseDto;
  messages: TimetableOrderingMessageDto[];
  transitions: TimetableOrderingTransitionDto[];
}

export interface CreateTimetableOrderingCasePayload {
  profileId: OrderingProcessProfileId;
  title: string;
  description?: string;
  trainPlanId?: string;
  validFrom: string;
  validTo: string;
  pathRequestId?: string;
  pathId?: string;
  providedAttributes?: Record<string, unknown>;
}

export interface ApplyTimetableOrderingActionPayload {
  actionId: string;
  source?: string;
  providedAttributesPatch?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  externalMessageId?: string;
}

export interface ApplyTimetableOrderingEventPayload {
  source?: string;
  event: OrderingEventTuple;
  providedAttributesPatch?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  externalMessageId?: string;
}

export type SimulatorResponseType =
  | 'receipt'
  | 'draft_offer'
  | 'final_offer'
  | 'final_offer_changed'
  | 'booked'
  | 'not_available'
  | 'withdrawn'
  | 'error';

export interface ApplyTimetableOrderingSimulatorPayload {
  response: SimulatorResponseType;
  payload?: Record<string, unknown>;
  externalMessageId?: string;
}

export interface TimetableOrderingProfileSummary {
  id: OrderingProcessProfileId;
  label: string;
  description: string;
  initialState: string;
  terminalStates: string[];
  requiredAttributes: Array<{
    key: string;
    label: string;
    scope: 'case' | 'provided';
    path: string;
  }>;
  actions: Array<{
    id: string;
    label: string;
    fromStates: string[];
  }>;
}

export interface TimetableOrderingSnapshotDto {
  caseId: string;
  profileId: OrderingProcessProfileId;
  currentState: string;
  isTerminal: boolean;
  aggregated: OrderingAggregatedPhaseSnapshot;
  operationalContexts: OrderingOperationalContext[];
  generatedAt: string;
}
