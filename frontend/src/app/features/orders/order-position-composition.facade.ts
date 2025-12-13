import { Injectable } from '@angular/core';
import { FormArray, FormBuilder, Validators } from '@angular/forms';
import type { ScheduleTemplate } from '../../core/models/schedule-template.model';
import type { PlanModificationStopInput } from '../../core/services/train-plan.service';
import {
  CompositionBaseVehicleForm,
  CompositionChangeEntryForm,
} from './shared/vehicle-composition-form/vehicle-composition-form.component';

@Injectable({ providedIn: 'root' })
export class OrderPositionCompositionFacade {
  constructor(private readonly fb: FormBuilder) {}

  createBaseVehicleGroup(
    seed?: { vehicleType?: string; count?: number; note?: string | null },
  ): CompositionBaseVehicleForm {
    return this.fb.group({
      vehicleType: this.fb.nonNullable.control(seed?.vehicleType ?? '', {
        validators: [Validators.required],
      }),
      count: this.fb.nonNullable.control(seed?.count ?? 1, {
        validators: [Validators.required, Validators.min(1)],
      }),
      note: this.fb.nonNullable.control(seed?.note ?? ''),
    });
  }

  createChangeEntryGroup(
    seed?: {
      stopIndex?: number | null;
      action?: 'attach' | 'detach';
      vehicleType?: string;
      count?: number;
      note?: string | null;
    },
  ): CompositionChangeEntryForm {
    return this.fb.group({
      stopIndex: this.fb.control(seed?.stopIndex ?? null),
      action: this.fb.nonNullable.control<'attach' | 'detach'>(seed?.action ?? 'attach'),
      vehicleType: this.fb.nonNullable.control(seed?.vehicleType ?? '', {
        validators: [Validators.required],
      }),
      count: this.fb.nonNullable.control(seed?.count ?? 1, {
        validators: [Validators.required, Validators.min(1)],
      }),
      note: this.fb.nonNullable.control(seed?.note ?? ''),
    });
  }

  hydrateFromTemplate(options: {
    template: ScheduleTemplate | undefined | null;
    baseVehicles: FormArray<CompositionBaseVehicleForm>;
    changeEntries: FormArray<CompositionChangeEntryForm>;
    requiresRollingStock: boolean;
  }): { stopOptions: { value: number; label: string }[] } {
    this.resetForms(options.baseVehicles, options.changeEntries);

    if (options.template?.composition?.base?.length) {
      options.template.composition.base.forEach((vehicle) =>
        options.baseVehicles.push(
          this.createBaseVehicleGroup({
            vehicleType: vehicle.type,
            count: vehicle.count,
            note: vehicle.note ?? vehicle.label ?? null,
          }),
        ),
      );
    }
    options.template?.composition?.changes?.forEach((change) =>
      change.vehicles.forEach((vehicle) =>
        options.changeEntries.push(
          this.createChangeEntryGroup({
            stopIndex: change.stopIndex,
            action: change.action,
            vehicleType: vehicle.type,
            count: vehicle.count,
            note: change.note ?? vehicle.note ?? null,
          }),
        ),
      ),
    );

    if (!options.template?.composition?.base?.length && options.requiresRollingStock) {
      this.ensureSeed(options.baseVehicles);
    }

    return { stopOptions: this.stopOptionsFromTemplate(options.template) };
  }

  ensureSeed(baseVehicles: FormArray<CompositionBaseVehicleForm>) {
    if (!baseVehicles.length) {
      baseVehicles.push(this.createBaseVehicleGroup());
    }
  }

  stopOptionsFromTemplate(
    template: ScheduleTemplate | undefined | null,
  ): { value: number; label: string }[] {
    if (!template) {
      return [];
    }
    return template.stops
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((stop) => ({ value: stop.sequence, label: `#${stop.sequence} · ${stop.locationName}` }));
  }

  stopOptionsFromManual(stops: PlanModificationStopInput[] | null): { value: number; label: string }[] {
    if (!stops?.length) {
      return [];
    }
    return stops
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((stop) => ({ value: stop.sequence, label: `#${stop.sequence} · ${stop.locationName}` }));
  }

  validateComposition(options: {
    baseVehicles: FormArray<CompositionBaseVehicleForm>;
    changeEntries: FormArray<CompositionChangeEntryForm>;
    required: boolean;
  }): string | null {
    const { base, changes } = this.parseForms(options.baseVehicles, options.changeEntries);

    const hasBase = base.some((entry) => entry.type && entry.count > 0);
    const baseInvalid = base.some((entry) => {
      if (!entry.type && entry.count <= 0) {
        return false;
      }
      return !entry.type || entry.count <= 0;
    });
    if (baseInvalid || (options.required && !hasBase)) {
      options.baseVehicles.controls.forEach((group) => group.markAllAsTouched());
      return options.required
        ? 'Bitte mindestens ein Fahrzeug mit Typ und Anzahl erfassen.'
        : 'Bitte Typ und Anzahl für jedes Fahrzeug angeben.';
    }

    const changeInvalid = options.changeEntries.controls.some((group) => {
      const stopIndex = group.controls.stopIndex.value;
      const type = group.controls.vehicleType.value.trim();
      const count = group.controls.count.value ?? 0;
      const isEmpty =
        (stopIndex === null || stopIndex === undefined) && !type && (!count || count <= 1);
      if (isEmpty) {
        return false;
      }
      return stopIndex === null || stopIndex === undefined || !type || count <= 0;
    });
    if (changeInvalid) {
      options.changeEntries.controls.forEach((group) => group.markAllAsTouched());
      return 'Bitte Halt, Aktion und Fahrzeuge für Kopplungen angeben.';
    }
    return null;
  }

  buildCompositionPayload(options: {
    baseVehicles: FormArray<CompositionBaseVehicleForm>;
    changeEntries: FormArray<CompositionChangeEntryForm>;
  }): ScheduleTemplate['composition'] | undefined {
    const { base, changes } = this.parseForms(options.baseVehicles, options.changeEntries);
    const normalizedBase = base.filter((entry) => entry.type && entry.count > 0);
    const normalizedChanges = changes.filter(
      (entry) => entry.stopIndex > 0 && entry.vehicles.every((vehicle) => vehicle.type && vehicle.count > 0),
    );
    if (!normalizedBase.length && !normalizedChanges.length) {
      return undefined;
    }
    return {
      base: normalizedBase,
      changes: normalizedChanges,
    };
  }

  private resetForms(
    baseVehicles: FormArray<CompositionBaseVehicleForm>,
    changeEntries: FormArray<CompositionChangeEntryForm>,
  ): void {
    baseVehicles.clear();
    changeEntries.clear();
  }

  private parseForms(
    baseVehicles: FormArray<CompositionBaseVehicleForm>,
    changeEntries: FormArray<CompositionChangeEntryForm>,
  ): {
    base: NonNullable<ScheduleTemplate['composition']>['base'];
    changes: NonNullable<ScheduleTemplate['composition']>['changes'];
  } {
    const base =
      baseVehicles.controls.map((group) => ({
        type: group.controls.vehicleType.value.trim(),
        count: group.controls.count.value ?? 0,
        note: group.controls.note.value?.trim() || undefined,
      })) ?? [];

    const changes =
      changeEntries.controls.map((group) => ({
        stopIndex: group.controls.stopIndex.value ?? 0,
        action: group.controls.action.value,
        vehicles: [
          {
            type: group.controls.vehicleType.value.trim(),
            count: group.controls.count.value ?? 0,
            note: group.controls.note.value?.trim() || undefined,
          },
        ],
        note: group.controls.note.value?.trim() || undefined,
      })) ?? [];

    return { base, changes };
  }
}
