import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import type { PlanModificationStopInput } from '../../../core/services/train-plan.service';
import {
  OrderItemGeneralFieldsComponent,
  type OrderItemGeneralLabels,
} from '../shared/order-item-general-fields/order-item-general-fields.component';
import {
  VehicleCompositionFormComponent,
  type CompositionBaseVehicleForm,
  type CompositionChangeEntryForm,
} from '../shared/vehicle-composition-form/vehicle-composition-form.component';

@Component({
  selector: 'app-order-position-manual-tab',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ...MATERIAL_IMPORTS,
    OrderItemGeneralFieldsComponent,
    VehicleCompositionFormComponent,
  ],
  templateUrl: './order-position-manual-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderPositionManualTabComponent {
  @Input() manualTemplate: PlanModificationStopInput[] | null = null;
  @Input({ required: true }) form!: FormGroup;
  @Input({ required: true }) generalLabels!: OrderItemGeneralLabels;
  @Input({ required: true }) generalDescriptions!: Partial<Record<string, string>>;
  @Input({ required: true }) fieldDescriptions!: Record<string, string>;
  @Input({ required: true }) requiresRollingStock!: boolean;
  @Input({ required: true }) stopOptions!: { value: number; label: string }[];
  @Input({ required: true }) baseVehicles!: FormArray<CompositionBaseVehicleForm>;
  @Input({ required: true }) changeEntries!: FormArray<CompositionChangeEntryForm>;
  @Input() baseVehicleFactory?: (
    seed?: { vehicleType?: string; count?: number; note?: string | null },
  ) => CompositionBaseVehicleForm;
  @Input() changeEntryFactory?: (
    seed?: {
      stopIndex?: number | null;
      action?: 'attach' | 'detach';
      vehicleType?: string;
      count?: number;
      note?: string | null;
    },
  ) => CompositionChangeEntryForm;
  @Input() simulationSelectionLabel: string | null = null;

  @Output() assemblePlanRequested = new EventEmitter<void>();
  @Output() clearTemplateRequested = new EventEmitter<void>();
  @Output() simulationAssignmentRequested = new EventEmitter<void>();
}

