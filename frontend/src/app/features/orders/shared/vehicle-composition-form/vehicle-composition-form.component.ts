import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../../core/material.imports.imports';

export type CompositionBaseVehicleForm = FormGroup<{
  vehicleType: FormControl<string>;
  count: FormControl<number>;
  note: FormControl<string>;
}>;

export type CompositionChangeEntryForm = FormGroup<{
  stopIndex: FormControl<number | null>;
  action: FormControl<'attach' | 'detach'>;
  vehicleType: FormControl<string>;
  count: FormControl<number>;
  note: FormControl<string>;
}>;

@Component({
    selector: 'app-vehicle-composition-form',
    imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
    templateUrl: './vehicle-composition-form.component.html',
    styleUrl: './vehicle-composition-form.component.scss'
})
export class VehicleCompositionFormComponent {
  @Input({ required: true }) baseVehicles!: FormArray<CompositionBaseVehicleForm>;
  @Input({ required: true }) changeEntries!: FormArray<CompositionChangeEntryForm>;
  @Input() stopOptions: { value: number; label: string }[] = [];
  @Input() required = false;
  @Input() title = 'Fahrzeuge & Komposition';
  @Input() hint =
    'Definiere Basisfahrzeuge und Kopplungen/Entkopplungen entlang der Fahrt.';
  @Input() showChangeEntries = true;
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

  constructor(private readonly fb: FormBuilder) {}

  addBaseVehicle(seed?: { vehicleType?: string; count?: number; note?: string | null }) {
    this.baseVehicles.push(this.createBaseVehicle(seed));
    this.baseVehicles.markAsDirty();
  }

  removeBaseVehicle(index: number) {
    if (index < 0 || index >= this.baseVehicles.length) {
      return;
    }
    this.baseVehicles.removeAt(index);
    this.baseVehicles.markAsDirty();
  }

  addChangeEntry(
    seed?: {
      stopIndex?: number | null;
      action?: 'attach' | 'detach';
      vehicleType?: string;
      count?: number;
      note?: string | null;
    },
  ) {
    this.changeEntries.push(this.createChangeEntry(seed));
    this.changeEntries.markAsDirty();
  }

  removeChangeEntry(index: number) {
    if (index < 0 || index >= this.changeEntries.length) {
      return;
    }
    this.changeEntries.removeAt(index);
    this.changeEntries.markAsDirty();
  }

  hasBaseVehicles(): boolean {
    return this.baseVehicles.length > 0;
  }

  private createBaseVehicle(
    seed?: { vehicleType?: string; count?: number; note?: string | null },
  ): CompositionBaseVehicleForm {
    if (this.baseVehicleFactory) {
      return this.baseVehicleFactory(seed);
    }
    return this.fb.group({
      vehicleType: this.fb.nonNullable.control(seed?.vehicleType ?? '', {
        validators: [],
      }),
      count: this.fb.nonNullable.control(seed?.count ?? 1, {
        validators: [],
      }),
      note: this.fb.nonNullable.control(seed?.note ?? ''),
    });
  }

  private createChangeEntry(
    seed?: {
      stopIndex?: number | null;
      action?: 'attach' | 'detach';
      vehicleType?: string;
      count?: number;
      note?: string | null;
    },
  ): CompositionChangeEntryForm {
    if (this.changeEntryFactory) {
      return this.changeEntryFactory(seed);
    }
    return this.fb.group({
      stopIndex: this.fb.control(seed?.stopIndex ?? null),
      action: this.fb.nonNullable.control<'attach' | 'detach'>(seed?.action ?? 'attach'),
      vehicleType: this.fb.nonNullable.control(seed?.vehicleType ?? ''),
      count: this.fb.nonNullable.control(seed?.count ?? 1),
      note: this.fb.nonNullable.control(seed?.note ?? ''),
    });
  }
}
