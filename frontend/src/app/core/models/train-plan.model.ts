import type { TimetableRollingStock } from './timetable.model';

export type TrainPlanStatus =
  | 'not_ordered'
  | 'requested'
  | 'offered'
  | 'confirmed'
  | 'operating'
  | 'canceled'
  | 'modification_request';

export type TrainPlanSourceType = 'rollout' | 'ttt' | 'external';

export interface TrainPlanSource {
  type: TrainPlanSourceType;
  name: string;
  templateId?: string;
  systemId?: string;
}

export interface TrainPlanCalendar {
  validFrom: string; // ISO date
  validTo?: string; // ISO date
  daysBitmap: string;
}

export interface TrainPlanStop {
  id: string;
  sequence: number;
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrivalTime?: string; // PLA
  departureTime?: string; // PLD
  arrivalOffsetDays?: number;
  departureOffsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platform?: string;
  notes?: string;
  holdReason?: string;
  responsibleRu?: string;
  vehicleInfo?: string;
}

export interface TrainPlanTechnicalData {
  trainType: string;
  maxSpeed?: number;
  weightTons?: number;
  lengthMeters?: number;
  traction?: string;
  energyType?: string;
  brakeType?: string;
  etcsLevel?: string;
}

export interface TrainPlanRouteMetadata {
  originBorderPoint?: string;
  destinationBorderPoint?: string;
  borderNotes?: string;
}

export interface TrainPlanCaseReference {
  id: string;
  marketProduct: 'regeltrasse' | 'rahmenvertrag' | 'sondertrasse' | 'anderes';
  customerReference?: string;
  contractNumber?: string;
  description?: string;
}

export interface TrainPlanParticipant {
  role: 'lead' | 'assisting';
  ricsCode: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface TrainPlan {
  id: string;
  title: string;
  trainNumber: string;
  pathRequestId: string;
  pathId?: string;
  caseReference?: TrainPlanCaseReference;
  status: TrainPlanStatus;
  responsibleRu: string;
  participants?: TrainPlanParticipant[];
  calendar: TrainPlanCalendar;
  trafficPeriodId?: string;
  referencePlanId?: string;
  stops: TrainPlanStop[];
  technical: TrainPlanTechnicalData;
  routeMetadata?: TrainPlanRouteMetadata;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  source: TrainPlanSource;
  linkedOrderItemId?: string;
  notes?: string;
  rollingStock?: TimetableRollingStock;
}
