import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import type { ScheduleTemplate } from '../../../core/models/schedule-template.model';
import {
  VehicleCompositionFormComponent,
  type CompositionBaseVehicleForm,
  type CompositionChangeEntryForm,
} from '../shared/vehicle-composition-form/vehicle-composition-form.component';

@Component({
  selector: 'app-order-position-plan-tab',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ...MATERIAL_IMPORTS,
    VehicleCompositionFormComponent,
  ],
  templateUrl: './order-position-plan-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderPositionPlanTabComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() templates: ScheduleTemplate[] = [];
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

  @Output() createTemplateRequested = new EventEmitter<void>();
  @Output() simulationAssignmentRequested = new EventEmitter<void>();
}

