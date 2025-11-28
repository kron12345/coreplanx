import { TrainPlanCalendar } from './train-plan.model';

export type TimetablePhase =
  | 'bedarf'
  | 'path_request'
  | 'offer'
  | 'contract'
  | 'operational'
  | 'archived';

export type TimetableSourceType =
  | 'ttt_path_request'
  | 'framework_agreement'
  | 'manual'
  | 'imported';

export type TimetableMilestoneStatus =
  | 'open'
  | 'in_progress'
  | 'completed'
  | 'blocked';

export interface TimetableSourceInfo {
  type: TimetableSourceType;
  pathRequestId?: string;
  frameworkAgreementId?: string;
  externalSystem?: string;
  lastMessage?: string;
  referenceDocumentId?: string;
}

export interface TimetableMilestone {
  id: string;
  label: string;
  status: TimetableMilestoneStatus;
  dueDate?: string;
  completedAt?: string;
  relatedProcess?: 'anmeldung' | 'offer' | 'contract' | 'operation';
  notes?: string;
}

export type TimetableRollingStockSegmentRole =
  | 'leading'
  | 'intermediate'
  | 'trailing'
  | 'powercar';

export interface TimetableRollingStockSegment {
  position: number;
  vehicleTypeId: string;
  count: number;
  role?: TimetableRollingStockSegmentRole;
  vehicleNumbers?: string[];
  remarks?: string;
  setId?: string;
  setLabel?: string;
  destination?: string;
}

export type TimetableRollingStockOperationType =
  | 'split'
  | 'join'
  | 'reconfigure';

export interface TimetableRollingStockOperation {
  stopId: string;
  type: TimetableRollingStockOperationType;
  setIds: string[];
  remarks?: string;
}

export interface TimetableRollingStock {
  compositionId?: string;
  designation?: string;
  tractionMode?: string;
  powerSupplySystems?: string[];
  maxSpeed?: number;
  lengthMeters?: number;
  weightTons?: number;
  brakeType?: string;
  brakePercentage?: number;
  etcsLevel?: string;
  trainProtectionSystems?: string[];
  gaugeProfile?: string;
  tiltingCapability?: 'none' | 'passive' | 'active';
  remarks?: string;
  segments: TimetableRollingStockSegment[];
  operations?: TimetableRollingStockOperation[];
}

export interface TimetableCalendarModification {
  date: string;
  description: string;
  type: 'cancelled' | 'modified_timetable' | 'rolling_stock_change' | 'replacement_service';
  affectedStopIds?: string[];
  notes?: string;
}

export type TimetableCalendarVariantType =
  | 'series'
  | 'special_day'
  | 'block'
  | 'replacement';

export interface TimetableCalendarVariant {
  id: string;
  type: TimetableCalendarVariantType;
  description: string;
  validFrom?: string;
  validTo?: string;
  daysOfWeek?: string[];
  dates?: string[];
  appliesTo?: 'commercial' | 'operational' | 'both';
  reason?: string;
  variantNumber?: string;
}

export interface TimetableAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  notes?: string;
  relatedEntity?:
    | 'calendar'
    | 'rolling_stock'
    | 'milestone'
    | 'responsibility'
    | 'operations'
    | 'other';
}

export interface TimetableResponsibility {
  id: string;
  role: string;
  assignee: string;
  contact?: string;
  scope: 'calendar' | 'rolling_stock' | 'operations' | 'commercial' | 'integration';
  status?: 'open' | 'in_progress' | 'completed';
  dueDate?: string;
  notes?: string;
}

export interface TimetableStopTiming {
  arrivalTime?: string;
  departureTime?: string;
  arrivalOffsetDays?: number;
  departureOffsetDays?: number;
  dwellMinutes?: number;
  remarks?: string;
}

export interface TimetableStop {
  id: string;
  sequence: number;
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  activities: string[];
  platform?: string;
  commercial: TimetableStopTiming;
  operational: TimetableStopTiming;
  notes?: string;
}

export interface Timetable {
  refTrainId: string;
  opn: string;
  title: string;
  trainNumber: string;
  responsibleRu: string;
  calendar: TrainPlanCalendar;
  status: TimetablePhase;
  source: TimetableSourceInfo;
  milestones: TimetableMilestone[];
  stops: TimetableStop[];
  createdAt: string;
  updatedAt: string;
  linkedOrderItemId?: string;
  notes?: string;
  rollingStock?: TimetableRollingStock;
  calendarModifications?: TimetableCalendarModification[];
  calendarVariants?: TimetableCalendarVariant[];
  auditTrail?: TimetableAuditEntry[];
  responsibilities?: TimetableResponsibility[];
}
