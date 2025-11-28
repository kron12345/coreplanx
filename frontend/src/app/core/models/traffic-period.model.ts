export type TrafficPeriodType = 'standard' | 'special' | 'construction';

export type TrafficPeriodVariantType =
  | 'series'
  | 'special_day'
  | 'block'
  | 'replacement';

export type TrafficPeriodVariantScope = 'commercial' | 'operational' | 'both';

export interface TrafficPeriodRule {
  id: string;
  name: string;
  description?: string;
  daysBitmap: string; // 7-char string Mo-So
  validityStart: string; // ISO date
  validityEnd?: string; // ISO date
  includesHolidays?: boolean;
  excludesDates?: string[]; // ISO dates
  includesDates?: string[]; // ISO dates
  variantType?: TrafficPeriodVariantType;
  appliesTo?: TrafficPeriodVariantScope;
  variantNumber?: string;
  reason?: string;
  primary?: boolean;
}

export interface TrafficPeriod {
  id: string;
  name: string;
  type: TrafficPeriodType;
  description?: string;
  responsible?: string;
  timetableYearLabel?: string;
  createdAt: string;
  updatedAt: string;
  rules: TrafficPeriodRule[];
  tags?: string[];
}
