import type { FormControl } from '@angular/forms';
import type { OrderItem } from '../../../core/models/order-item.model';
import type { TrainPlan } from '../../../core/models/train-plan.model';

export interface PlanModificationDialogData {
  orderId: string;
  item: OrderItem;
  plan: TrainPlan;
}

export type ValidityMode = 'trafficPeriod' | 'custom';

export interface PlanModificationFormModel {
  title: FormControl<string>;
  trainNumber: FormControl<string>;
  responsibleRu: FormControl<string>;
  notes: FormControl<string>;
  templateId: FormControl<string>;
  templateStartTime: FormControl<string>;
  validityMode: FormControl<ValidityMode>;
  trafficPeriodId: FormControl<string>;
  validFrom: FormControl<string>;
  validTo: FormControl<string>;
  daysBitmap: FormControl<string>;
  customYear: FormControl<number>;
  technicalMaxSpeed: FormControl<number | null>;
  technicalLength: FormControl<number | null>;
  technicalWeight: FormControl<number | null>;
  technicalTraction: FormControl<string>;
  technicalEtcsLevel: FormControl<string>;
  originBorderPoint: FormControl<string>;
  destinationBorderPoint: FormControl<string>;
  borderNotes: FormControl<string>;
}

