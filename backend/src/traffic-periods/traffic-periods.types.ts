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
