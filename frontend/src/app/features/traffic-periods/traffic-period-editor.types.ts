import { FormArray, FormControl, FormGroup } from '@angular/forms';
import {
  TrafficPeriod,
  TrafficPeriodType,
  TrafficPeriodVariantScope,
  TrafficPeriodVariantType,
} from '../../core/models/traffic-period.model';
import { TrafficPeriodCreatePayload } from '../../core/services/traffic-period.service';

export interface TrafficPeriodEditorData {
  defaultYear: number;
  period?: TrafficPeriod;
}

export interface TrafficPeriodEditorResult {
  periodId?: string;
  payload: TrafficPeriodCreatePayload;
}

export interface TrafficPeriodRuleForm {
  id: FormControl<string | null>;
  name: FormControl<string>;
  year: FormControl<number>;
  variantType: FormControl<TrafficPeriodVariantType>;
  appliesTo: FormControl<TrafficPeriodVariantScope>;
  variantNumber: FormControl<string>;
  reason: FormControl<string>;
  primary: FormControl<boolean>;
  selectedDates: FormControl<string[]>;
  excludedDates: FormControl<string[]>;
}

export interface TrafficPeriodForm {
  name: FormControl<string>;
  type: FormControl<TrafficPeriodType>;
  description: FormControl<string>;
  responsible: FormControl<string>;
  tags: FormControl<string>;
  defaultYear: FormControl<number>;
  rules: FormArray<FormGroup<TrafficPeriodRuleForm>>;
}

export type CalendarModeGetter = (index: number) => 'include' | 'exclude';
export type RuleReadyChecker = (index: number) => boolean;
