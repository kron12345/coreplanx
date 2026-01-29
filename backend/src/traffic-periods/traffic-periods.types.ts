export type TrafficPeriodType = 'standard' | 'special' | 'construction';

export type TrafficPeriodVariantType =
  | 'series'
  | 'special_day'
  | 'block'
  | 'replacement';

export type TrafficPeriodVariantScope = 'commercial' | 'operational' | 'both';

export interface TrafficPeriodRuleDto {
  id: string;
  name: string;
  description?: string;
  daysBitmap: string;
  validityStart: string;
  validityEnd?: string;
  includesHolidays?: boolean;
  excludesDates?: string[];
  includesDates?: string[];
  variantType?: TrafficPeriodVariantType;
  appliesTo?: TrafficPeriodVariantScope;
  variantNumber?: string;
  reason?: string;
  primary?: boolean;
}

export interface TrafficPeriodDto {
  id: string;
  name: string;
  type: TrafficPeriodType;
  description?: string;
  responsible?: string;
  timetableYearLabel?: string;
  createdAt: string;
  updatedAt: string;
  rules: TrafficPeriodRuleDto[];
  tags?: string[];
}

export interface TrafficPeriodRulePayload {
  id?: string;
  name: string;
  year: number;
  selectedDates: string[];
  excludedDates?: string[];
  variantType?: TrafficPeriodVariantType;
  variantNumber?: string;
  appliesTo?: TrafficPeriodVariantScope;
  reason?: string;
  primary?: boolean;
}

export interface TrafficPeriodCreatePayload {
  name: string;
  type: TrafficPeriodType;
  description?: string;
  responsible?: string;
  tags?: string[];
  year: number;
  rules: TrafficPeriodRulePayload[];
  timetableYearLabel?: string;
}

export interface TrafficPeriodVariantPayload {
  name?: string;
  dates: string[];
  variantType?: TrafficPeriodVariantType;
  appliesTo?: TrafficPeriodVariantScope;
  reason?: string;
}

export interface TrafficPeriodExclusionPayload {
  dates: string[];
}

export interface RailMlTrafficPeriodPayload {
  sourceId: string;
  name: string;
  description?: string;
  daysBitmap: string;
  validityStart: string;
  validityEnd: string;
  type?: TrafficPeriodType;
  scope?: TrafficPeriodVariantScope;
  reason?: string;
}

export interface SingleDayTrafficPeriodPayload {
  name: string;
  date: string;
  type?: TrafficPeriodType;
  appliesTo?: TrafficPeriodVariantScope;
  variantType?: TrafficPeriodVariantType;
  tags?: string[];
  description?: string;
  responsible?: string;
}
