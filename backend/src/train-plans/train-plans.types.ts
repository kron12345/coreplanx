import type { ScheduleTemplateComposition } from '../schedule-templates/schedule-templates.types';

export type TrainPlanStatus =
  | 'not_ordered'
  | 'requested'
  | 'offered'
  | 'confirmed'
  | 'operating'
  | 'canceled'
  | 'modification_request';

export type TrainPlanSourceType = 'rollout' | 'ttt' | 'external';

export interface TrainPlanSourceDto {
  type: TrainPlanSourceType;
  name: string;
  templateId?: string;
  systemId?: string;
}

export interface TrainPlanCalendarDto {
  validFrom: string;
  validTo?: string;
  daysBitmap: string;
}

export interface TrainPlanStopDto {
  id: string;
  sequence: number;
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrivalTime?: string;
  departureTime?: string;
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

export interface TrainPlanTechnicalDto {
  trainType: string;
  maxSpeed?: number;
  weightTons?: number;
  lengthMeters?: number;
  traction?: string;
  energyType?: string;
  brakeType?: string;
  etcsLevel?: string;
}

export interface TrainPlanRouteMetadataDto {
  originBorderPoint?: string;
  destinationBorderPoint?: string;
  borderNotes?: string;
  timetableDrafts?: TimetableDraftBundleDto;
}

export interface TimetableDraftBundleDto {
  schemaVersion: number;
  routeDraft?: Record<string, unknown> | null;
  timetableDraft?: Record<string, unknown> | null;
  patternDefinition?: Record<string, unknown> | null;
  updatedAtIso?: string;
}

export interface TrainPlanParticipantDto {
  role: 'lead' | 'assisting';
  ricsCode: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface TrainPlanDto {
  id: string;
  title: string;
  trainNumber: string;
  pathRequestId: string;
  pathId?: string;
  caseReference?: unknown;
  status: TrainPlanStatus;
  responsibleRu: string;
  participants?: TrainPlanParticipantDto[];
  calendar: TrainPlanCalendarDto;
  trafficPeriodId?: string;
  referencePlanId?: string;
  stops: TrainPlanStopDto[];
  technical: TrainPlanTechnicalDto;
  routeMetadata?: TrainPlanRouteMetadataDto;
  createdAt: string;
  updatedAt: string;
  source: TrainPlanSourceDto;
  linkedOrderItemId?: string;
  notes?: string;
  rollingStock?: unknown;
  planVariantType?: 'productive' | 'simulation';
  variantOfPlanId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface CreatePlansFromTemplatePayload {
  templateId: string;
  startTime: string;
  intervalMinutes: number;
  departuresPerDay: number;
  trafficPeriodId?: string;
  calendarDates?: string[];
  responsibleRu?: string;
  trainNumberStart?: number;
  trainNumberInterval?: number;
  composition?: ScheduleTemplateComposition;
  planVariantType?: 'productive' | 'simulation';
  variantOfPlanId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface CreateManualPlanPayload {
  title: string;
  trainNumber: string;
  responsibleRu: string;
  departure: string;
  stops: Array<{
    id?: string;
    sequence?: number;
    type: 'origin' | 'intermediate' | 'destination';
    locationCode: string;
    locationName: string;
    countryCode?: string;
    arrivalEarliest?: string;
    arrivalLatest?: string;
    departureEarliest?: string;
    departureLatest?: string;
    offsetDays?: number;
    dwellMinutes?: number;
    activities?: string[];
    platformWish?: string;
    notes?: string;
  }>;
  sourceName?: string;
  notes?: string;
  templateId?: string;
  trafficPeriodId?: string;
  validFrom?: string;
  validTo?: string;
  daysBitmap?: string;
  composition?: ScheduleTemplateComposition;
  planVariantType?: 'productive' | 'simulation';
  variantOfPlanId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface PlanModificationStopInput {
  sequence: number;
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrivalTime?: string;
  departureTime?: string;
  arrivalOffsetDays?: number;
  departureOffsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platform?: string;
  notes?: string;
}

export interface CreatePlanModificationPayload {
  originalPlanId: string;
  title: string;
  trainNumber: string;
  responsibleRu: string;
  calendar: {
    validFrom: string;
    validTo?: string;
    daysBitmap: string;
  };
  trafficPeriodId?: string;
  notes?: string;
  stops?: PlanModificationStopInput[];
  rollingStock?: unknown;
  technical?: TrainPlanTechnicalDto;
  routeMetadata?: TrainPlanRouteMetadataDto;
  planVariantType?: 'productive' | 'simulation';
  variantOfPlanId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface CreatePlanVariantPayload {
  originalPlanId: string;
  type: 'productive' | 'simulation';
  label?: string;
}
