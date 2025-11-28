import { CommonModule } from '@angular/common';
import { Component, Inject, inject } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  TimetableHubRouteMetadata,
  TimetableHubSectionKey,
  TimetableHubTechnicalSummary,
} from '../../core/services/timetable-hub.service';

export interface TimetableTestTrainDialogData {
  yearOptions: string[];
  sectionTabs: { key: TimetableHubSectionKey; label: string }[];
  defaultYearLabel: string;
  initialTrainNumber?: string;
  initialTitle?: string;
}

export interface TimetableTestTrainDialogResult {
  trainNumber: string;
  title: string;
  timetableYearLabel: string;
  section: TimetableHubSectionKey;
  calendarStart: string;
  calendarEnd: string;
  stops: DialogStopValue[];
  technical?: TimetableHubTechnicalSummary;
  routeMetadata?: TimetableHubRouteMetadata;
}

export interface DialogStopValue {
  locationName: string;
  type: 'origin' | 'intermediate' | 'destination';
  arrivalTime?: string;
  departureTime?: string;
}

type StopFormGroup = FormGroup<{
  locationName: FormControl<string>;
  type: FormControl<'origin' | 'intermediate' | 'destination'>;
  arrivalTime: FormControl<string>;
  departureTime: FormControl<string>;
}>;

type TestTrainFormModel = {
  trainNumber: FormControl<string>;
  title: FormControl<string>;
  timetableYearLabel: FormControl<string>;
  section: FormControl<TimetableHubSectionKey>;
  calendarStart: FormControl<string>;
  calendarEnd: FormControl<string>;
  technicalMaxSpeed: FormControl<number | null>;
  technicalLength: FormControl<number | null>;
  technicalWeight: FormControl<number | null>;
  technicalTraction: FormControl<string>;
  technicalEtcsLevel: FormControl<string>;
  originBorderPoint: FormControl<string>;
  destinationBorderPoint: FormControl<string>;
  borderNotes: FormControl<string>;
  stops: FormArray<StopFormGroup>;
};

@Component({
  selector: 'app-timetable-test-train-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-test-train-dialog.component.html',
  styleUrl: './timetable-test-train-dialog.component.scss',
})
export class TimetableTestTrainDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<TimetableTestTrainDialogComponent>);
  private readonly fb = inject(FormBuilder);
  readonly data = inject<TimetableTestTrainDialogData>(MAT_DIALOG_DATA);

  readonly sectionOptions = this.data.sectionTabs;
  readonly yearOptions = this.data.yearOptions;
  private readonly defaultDate = new Date().toISOString().slice(0, 10);

  readonly form = this.fb.group<TestTrainFormModel>({
    trainNumber: this.fb.nonNullable.control(this.data.initialTrainNumber ?? '', {
      validators: [Validators.required, Validators.maxLength(40)],
    }),
    title: this.fb.nonNullable.control(this.data.initialTitle ?? '', {
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    timetableYearLabel: this.fb.nonNullable.control(this.data.defaultYearLabel, {
      validators: [Validators.required],
    }),
    section: this.fb.nonNullable.control<TimetableHubSectionKey>('commercial', {
      validators: [Validators.required],
    }),
    calendarStart: this.fb.nonNullable.control(this.defaultDate, {
      validators: [Validators.required],
    }),
    calendarEnd: this.fb.nonNullable.control(this.defaultDate, {
      validators: [Validators.required],
    }),
    technicalMaxSpeed: this.fb.control<number | null>(null, {
      validators: [Validators.min(0), Validators.max(400)],
    }),
    technicalLength: this.fb.control<number | null>(null, {
      validators: [Validators.min(0), Validators.max(500)],
    }),
    technicalWeight: this.fb.control<number | null>(null, {
      validators: [Validators.min(0), Validators.max(4000)],
    }),
    technicalTraction: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(60)],
    }),
    technicalEtcsLevel: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(40)],
    }),
    originBorderPoint: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(80)],
    }),
    destinationBorderPoint: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(80)],
    }),
    borderNotes: this.fb.nonNullable.control('', {
      validators: [Validators.maxLength(200)],
    }),
    stops: this.fb.array<StopFormGroup>([]),
  });

  private readonly timePattern = /^([01]?\d|2[0-3]):([0-5]\d)$/;

  constructor() {
    this.addStop('origin');
    this.addStop('destination');
    this.enforceEdgeStops();
  }

  get stops(): FormArray<StopFormGroup> {
    return this.form.controls.stops;
  }

  addStop(type: 'origin' | 'intermediate' | 'destination' = 'intermediate') {
    const group = this.createStopGroup(type);
    if (type === 'origin') {
      this.stops.insert(0, group);
    } else if (type === 'destination') {
      this.stops.push(group);
    } else {
      const insertIndex = Math.max(this.stops.length - 1, 1);
      this.stops.insert(insertIndex, group);
    }
    this.enforceEdgeStops();
  }

  removeStop(index: number) {
    if (index <= 0 || index >= this.stops.length - 1) {
      return;
    }
    this.stops.removeAt(index);
    this.enforceEdgeStops();
  }

  submit() {
    if (this.form.invalid || !this.stops.length || this.stops.length < 2) {
      this.form.markAllAsTouched();
      this.stops.controls.forEach((group) => group.markAllAsTouched());
      return;
    }

    const value = this.form.getRawValue();
    const stops: DialogStopValue[] = value.stops.map((stop, index) => ({
      locationName: stop.locationName.trim() || `Halt ${index + 1}`,
      type: stop.type,
      arrivalTime: stop.arrivalTime?.trim() || undefined,
      departureTime: stop.departureTime?.trim() || undefined,
    }));

    const technical = this.buildTechnicalSummary(value);
    const routeMetadata = this.buildRouteMetadata(value);

    const result: TimetableTestTrainDialogResult = {
      trainNumber: value.trainNumber.trim(),
      title: value.title.trim(),
      timetableYearLabel: value.timetableYearLabel,
      section: value.section,
      calendarStart: value.calendarStart,
      calendarEnd: value.calendarEnd,
      stops,
      technical,
      routeMetadata,
    };

    this.dialogRef.close(result);
  }

  cancel() {
    this.dialogRef.close();
  }

  stopLabel(index: number, group: StopFormGroup): string {
    const type = group.controls.type.value;
    if (index === 0) {
      return 'Start (Abfahrt)';
    }
    if (index === this.stops.length - 1) {
      return 'Ziel (Ankunft)';
    }
    if (type === 'destination') {
      return 'Zielhalt';
    }
    if (type === 'origin') {
      return 'Start';
    }
    return 'Unterwegsstation';
  }

  isEdgeStop(index: number): boolean {
    return index === 0 || index === this.stops.length - 1;
  }

  private createStopGroup(type: 'origin' | 'intermediate' | 'destination'): StopFormGroup {
    return this.fb.group({
      locationName: this.fb.nonNullable.control('', {
        validators: [Validators.required, Validators.maxLength(80)],
      }),
      type: this.fb.nonNullable.control(type),
      arrivalTime: this.fb.nonNullable.control('', {
        validators: [this.optionalTimeValidator()],
      }),
      departureTime: this.fb.nonNullable.control('', {
        validators: [this.optionalTimeValidator()],
      }),
    });
  }

  private enforceEdgeStops() {
    if (!this.stops.length) {
      return;
    }
    this.stops.controls.forEach((group, index) => {
      const typeControl = group.controls.type;
      if (index === 0) {
        typeControl.setValue('origin', { emitEvent: false });
        typeControl.disable({ emitEvent: false });
      } else if (index === this.stops.length - 1) {
        typeControl.setValue('destination', { emitEvent: false });
        typeControl.disable({ emitEvent: false });
      } else {
        typeControl.enable({ emitEvent: false });
      }
    });
  }

  private optionalTimeValidator(): ValidatorFn {
    return (control) => {
      const raw = control.value as string | null | undefined;
      const value = raw?.trim();
      if (!value) {
        return null;
      }
      return this.timePattern.test(value) ? null : { time: true };
    };
  }

  private buildTechnicalSummary(
    value: ReturnType<typeof this.form.getRawValue>,
  ): TimetableHubTechnicalSummary | undefined {
    const summary: TimetableHubTechnicalSummary = {
      maxSpeed: value.technicalMaxSpeed ?? undefined,
      lengthMeters: value.technicalLength ?? undefined,
      weightTons: value.technicalWeight ?? undefined,
      traction: value.technicalTraction?.trim() || undefined,
      etcsLevel: value.technicalEtcsLevel?.trim() || undefined,
    };
    const hasValue = Object.values(summary).some((entry) => {
      if (typeof entry === 'number') {
        return !Number.isNaN(entry);
      }
      return Boolean(entry && entry.trim().length);
    });
    return hasValue ? summary : undefined;
  }

  private buildRouteMetadata(
    value: ReturnType<typeof this.form.getRawValue>,
  ): TimetableHubRouteMetadata | undefined {
    const metadata: TimetableHubRouteMetadata = {
      originBorderPoint: value.originBorderPoint?.trim() || undefined,
      destinationBorderPoint: value.destinationBorderPoint?.trim() || undefined,
      borderNotes: value.borderNotes?.trim() || undefined,
    };
    if (!metadata.originBorderPoint && !metadata.destinationBorderPoint && !metadata.borderNotes) {
      return undefined;
    }
    return metadata;
  }
}
