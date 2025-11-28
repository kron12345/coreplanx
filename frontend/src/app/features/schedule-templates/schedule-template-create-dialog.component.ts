import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  CreateScheduleTemplatePayload,
  CreateScheduleTemplateStopPayload,
} from '../../core/services/schedule-template.service';
import { TrainPlanStop } from '../../core/models/train-plan.model';
import { PlanModificationStopInput } from '../../core/services/train-plan.service';
import {
  PlanAssemblyDialogComponent,
  PlanAssemblyDialogData,
  PlanAssemblyDialogResult,
} from '../orders/plan-assembly-dialog/plan-assembly-dialog.component';
import {
  ScheduleTemplate,
  ScheduleTemplateCategory,
  ScheduleTemplateStatus,
} from '../../core/models/schedule-template.model';

export interface ScheduleTemplateCreateDialogData {
  template?: ScheduleTemplate;
}

export type ScheduleTemplateDialogResult =
  | { mode: 'create'; payload: CreateScheduleTemplatePayload }
  | { mode: 'edit'; templateId: string; payload: CreateScheduleTemplatePayload };

type StopFormValue = {
  type: 'origin' | 'intermediate' | 'destination';
  locationName: string;
  locationCode: string;
  countryCode: string | null;
  arrivalEarliest: string | null;
  arrivalLatest: string | null;
  departureEarliest: string | null;
  departureLatest: string | null;
  offsetDays: number | null;
  dwellMinutes: number | null;
  activities: string[];
  platformWish: string | null;
  notes: string | null;
};

type VehicleFormGroup = FormGroup<{
  vehicleType: FormControl<string>;
  count: FormControl<number>;
  note: FormControl<string | null>;
}>;

type ChangeEntryFormGroup = FormGroup<{
  stopIndex: FormControl<number | null>;
  action: FormControl<'attach' | 'detach'>;
  vehicleType: FormControl<string>;
  count: FormControl<number>;
  note: FormControl<string | null>;
}>;

type StopFormGroup = FormGroup<{
  type: FormControl<'origin' | 'intermediate' | 'destination'>;
  locationName: FormControl<string>;
  locationCode: FormControl<string>;
  countryCode: FormControl<string | null>;
  arrivalEarliest: FormControl<string | null>;
  arrivalLatest: FormControl<string | null>;
  departureEarliest: FormControl<string | null>;
  departureLatest: FormControl<string | null>;
  offsetDays: FormControl<number | null>;
  dwellMinutes: FormControl<number | null>;
  activities: FormControl<string[]>;
  platformWish: FormControl<string | null>;
  notes: FormControl<string | null>;
}>;

@Component({
  selector: 'app-schedule-template-create-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './schedule-template-create-dialog.component.html',
  styleUrl: './schedule-template-create-dialog.component.scss',
})
export class ScheduleTemplateCreateDialogComponent {
  private readonly dialogRef = inject<
    MatDialogRef<
      ScheduleTemplateCreateDialogComponent,
      ScheduleTemplateDialogResult | undefined
    >
  >(MatDialogRef);
  private readonly data =
    inject<ScheduleTemplateCreateDialogData>(MAT_DIALOG_DATA, {
      optional: true,
    }) ?? {};
  private readonly fb = inject(FormBuilder);
  private readonly dialog = inject(MatDialog);
  private readonly template = this.data.template ?? null;
  readonly isEditMode = Boolean(this.template);

  readonly categoryOptions: ScheduleTemplateCategory[] = [
    'S-Bahn',
    'RegionalExpress',
    'Fernverkehr',
    'Güterverkehr',
    'Sonderverkehr',
  ];

  readonly statusOptions: ScheduleTemplateStatus[] = [
    'draft',
    'active',
    'archived',
  ];

  readonly form = this.fb.group({
    title: this.fb.nonNullable.control('', Validators.required),
    description: [''],
    trainNumber: this.fb.nonNullable.control('', Validators.required),
    responsibleRu: this.fb.nonNullable.control('', Validators.required),
    status: this.fb.nonNullable.control<ScheduleTemplateStatus>('draft'),
    category: this.fb.nonNullable.control<ScheduleTemplateCategory>('S-Bahn'),
    startDate: this.fb.nonNullable.control(new Date(), Validators.required),
    endDate: new FormControl<Date | null>(null),
    tags: [''],
    stops: this.fb.array<StopFormGroup>([
      this.createStopGroup('origin'),
      this.createStopGroup('destination'),
    ]),
    baseVehicles: this.fb.array<VehicleFormGroup>([]),
    changeEntries: this.fb.array<ChangeEntryFormGroup>([]),
  });

  get stops(): FormArray<StopFormGroup> {
    return this.form.controls.stops;
  }

  get baseVehicles(): FormArray<VehicleFormGroup> {
    return this.form.controls.baseVehicles as FormArray<VehicleFormGroup>;
  }

  get changeEntries(): FormArray<ChangeEntryFormGroup> {
    return this.form.controls.changeEntries as FormArray<ChangeEntryFormGroup>;
  }

  get stopOptions() {
    return this.stops.controls.map((stop, index) => ({
      index: index + 1,
      label: stop.controls.locationName.value || `Halt ${index + 1}`,
    }));
  }

  openPlanAssembly() {
    const stops = this.toTrainPlanStops();
    this.dialog
      .open<PlanAssemblyDialogComponent, PlanAssemblyDialogData, PlanAssemblyDialogResult | undefined>(
        PlanAssemblyDialogComponent,
        {
          width: '1320px',
          maxWidth: '95vw',
          maxHeight: 'calc(100vh - 48px)',
          panelClass: 'plan-assembly-dialog-panel',
          data: { stops },
        },
      )
      .afterClosed()
      .subscribe((result) => {
        if (result?.stops?.length) {
          this.applyAssemblyStops(result.stops);
        }
      });
  }

  stopCount(): number {
    return this.stops.length;
  }

  startStopLabel(): string {
    return this.stopLabelAt(0);
  }

  endStopLabel(): string {
    return this.stopLabelAt(this.stops.length - 1);
  }

  stopPreview(): { sequence: number; name: string; time?: string; type: string }[] {
    return this.stops.controls.map((stop, index) => {
      const time = this.firstNonEmpty([
        stop.controls.departureEarliest.value,
        stop.controls.departureLatest.value,
        stop.controls.arrivalEarliest.value,
        stop.controls.arrivalLatest.value,
      ]);
      return {
        sequence: index + 1,
        name: stop.controls.locationName.value || '–',
        type: stop.controls.type.value,
        time: time || undefined,
      };
    });
  }

  private stopLabelAt(index: number): string {
    const preview = this.stopPreview();
    const item = preview[index];
    if (!item) {
      return '–';
    }
    return item.time ? `${item.name} (${item.time})` : item.name;
  }

  private toTrainPlanStops(): TrainPlanStop[] {
    const baseDate = this.form.controls.startDate.value ?? new Date();
    return this.stops.controls.map((group, index) => {
      const raw = group.getRawValue() as StopFormValue;
      const offset = raw.offsetDays ?? 0;
      return {
        id: `TPL-${index}`,
        sequence: index + 1,
        type: raw.type,
        locationName: raw.locationName || '',
        locationCode: raw.locationCode || '',
        countryCode: raw.countryCode ?? undefined,
        arrivalTime: this.combineWithBase(baseDate, raw.arrivalEarliest ?? raw.arrivalLatest, offset),
        departureTime: this.combineWithBase(baseDate, raw.departureEarliest ?? raw.departureLatest, offset),
        arrivalOffsetDays: raw.offsetDays ?? undefined,
        departureOffsetDays: raw.offsetDays ?? undefined,
        dwellMinutes: raw.dwellMinutes ?? undefined,
        activities: raw.activities?.length ? raw.activities : ['0001'],
        platform: raw.platformWish ?? undefined,
        notes: raw.notes ?? undefined,
      } satisfies TrainPlanStop;
    });
  }

  private applyAssemblyStops(stops: PlanModificationStopInput[]): void {
    if (!stops.length) {
      return;
    }
    this.stops.clear();
    stops.forEach((stop) => {
      this.stops.push(this.createStopGroupFromAssembly(stop));
    });
    this.form.markAsDirty();
  }

  private createStopGroupFromAssembly(stop: PlanModificationStopInput): StopFormGroup {
    const group = this.createStopGroup(stop.type);
    const arrivalTime = this.isoToTime(stop.arrivalTime);
    const departureTime = this.isoToTime(stop.departureTime);
    const offset = stop.arrivalOffsetDays ?? stop.departureOffsetDays ?? null;

    group.patchValue({
      locationName: stop.locationName,
      locationCode: stop.locationCode,
      countryCode: stop.countryCode ?? 'CH',
      arrivalEarliest: arrivalTime,
      arrivalLatest: arrivalTime,
      departureEarliest: departureTime,
      departureLatest: departureTime,
      offsetDays: offset,
      dwellMinutes: stop.dwellMinutes ?? null,
      activities: stop.activities?.length ? [...stop.activities] : ['0001'],
      platformWish: stop.platform ?? null,
      notes: stop.notes ?? null,
    });

    return group;
  }

  private combineWithBase(
    baseDate: Date,
    time: string | null | undefined,
    offsetDays: number | null | undefined,
  ): string | undefined {
    if (!time) {
      return undefined;
    }
    const [hours, minutes] = time.split(':').map((value) => Number.parseInt(value, 10));
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return undefined;
    }
    const date = new Date(
      Date.UTC(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate(),
        hours,
        minutes,
        0,
        0,
      ),
    );
    if (offsetDays) {
      date.setUTCDate(date.getUTCDate() + offsetDays);
    }
    return date.toISOString();
  }

  private isoToTime(value: string | undefined): string | null {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString().slice(11, 16);
  }

  private firstNonEmpty(values: Array<string | null>): string | null {
    for (const value of values) {
      if (value && value.trim().length) {
        return value;
      }
    }
    return null;
  }

  cancel() {
    this.dialogRef.close();
  }

  addBaseVehicle() {
    this.baseVehicles.push(
      this.fb.group({
        vehicleType: this.fb.nonNullable.control('', Validators.required),
        count: this.fb.nonNullable.control(1, [Validators.required, Validators.min(1)]),
        note: this.fb.control<string | null>(null),
      }),
    );
  }

  removeBaseVehicle(index: number) {
    this.baseVehicles.removeAt(index);
  }

  addChangeEntry() {
    this.changeEntries.push(
      this.fb.group({
        stopIndex: this.fb.control<number | null>(null, Validators.required),
        action: this.fb.nonNullable.control<'attach' | 'detach'>('attach'),
        vehicleType: this.fb.nonNullable.control('', Validators.required),
        count: this.fb.nonNullable.control(1, [Validators.required, Validators.min(1)]),
        note: this.fb.control<string | null>(null),
      }),
    );
  }

  removeChangeEntry(index: number) {
    this.changeEntries.removeAt(index);
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.stops.controls.forEach((group) => group.markAllAsTouched());
      return;
    }

    const value = this.form.getRawValue();
    const baseVehicles = this.baseVehicles.controls
      .map((group) => ({
        type: group.value.vehicleType?.trim() ?? '',
        count: Number(group.value.count) || 0,
        note: group.value.note?.trim() || undefined,
      }))
      .filter((entry) => entry.type && entry.count > 0);

    const changeEntries = this.changeEntries.controls
      .map((group) => ({
        stopIndex: group.value.stopIndex ?? 0,
        action: group.value.action ?? 'attach',
        vehicles: [
          {
            type: group.value.vehicleType?.trim() ?? '',
            count: Number(group.value.count) || 0,
            note: group.value.note?.trim() || undefined,
          },
        ],
        note: group.value.note?.trim() || undefined,
      }))
      .filter(
        (entry) =>
          entry.stopIndex > 0 &&
          entry.vehicles.every((vehicle) => vehicle.type && vehicle.count > 0),
      );

    const composition =
      baseVehicles.length || changeEntries.length
        ? {
            base: baseVehicles,
            changes: changeEntries,
          }
        : undefined;

    const payload: CreateScheduleTemplatePayload = {
      title: value.title,
      description: value.description ?? undefined,
      trainNumber: value.trainNumber,
      responsibleRu: value.responsibleRu,
      status: value.status,
      category: value.category,
      startDate: value.startDate,
      endDate: value.endDate ?? undefined,
      tags: this.parseTags(value.tags),
      recurrence: undefined,
      stops: this.stops.controls.map((stop, index) =>
        this.mapStopValue(stop.getRawValue() as StopFormValue, index),
      ),
      composition,
    };

    const result: ScheduleTemplateDialogResult = this.template
      ? { mode: 'edit', templateId: this.template.id, payload }
      : { mode: 'create', payload };
    this.dialogRef.close(result);
  }

  private parseTags(value: string | null | undefined): string[] | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    return tags.length ? Array.from(new Set(tags)) : undefined;
  }

  private mapStopValue(
    stop: StopFormValue,
    index: number,
  ): CreateScheduleTemplateStopPayload {
    return {
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode || undefined,
      arrivalEarliest: stop.arrivalEarliest || undefined,
      arrivalLatest: stop.arrivalLatest || undefined,
      departureEarliest: stop.departureEarliest || undefined,
      departureLatest: stop.departureLatest || undefined,
      offsetDays: stop.offsetDays ?? undefined,
      dwellMinutes: stop.dwellMinutes ?? undefined,
      activities:
        stop.activities?.length && stop.activities[0]
          ? stop.activities
          : ['0001'],
      platformWish: stop.platformWish || undefined,
      notes: stop.notes || undefined,
    };
  }

  private createStopGroup(
    type: 'origin' | 'intermediate' | 'destination',
  ): StopFormGroup {
    return this.fb.group({
      type: this.fb.nonNullable.control(type),
      locationName: this.fb.nonNullable.control('', Validators.required),
      locationCode: this.fb.nonNullable.control('', Validators.required),
      countryCode: new FormControl<string | null>('CH'),
      arrivalEarliest: new FormControl<string | null>(null),
      arrivalLatest: new FormControl<string | null>(null),
      departureEarliest: new FormControl<string | null>(null),
      departureLatest: new FormControl<string | null>(null),
      offsetDays: new FormControl<number | null>(null),
      dwellMinutes: new FormControl<number | null>(null),
      activities: this.fb.nonNullable.control<string[]>(['0001']),
      platformWish: new FormControl<string | null>(null),
      notes: new FormControl<string | null>(null),
    });
  }

  private hydrateFormFromTemplate(template: ScheduleTemplate) {
    this.form.patchValue({
      title: template.title,
      description: template.description ?? '',
      trainNumber: template.trainNumber,
      responsibleRu: template.responsibleRu,
      status: template.status,
      category: template.category,
      startDate: new Date(template.validity.startDate),
      endDate: template.validity.endDate ? new Date(template.validity.endDate) : null,
      tags: template.tags?.join(', ') ?? '',
    });

    this.stops.clear();
    template.stops
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .forEach((stop) => {
        const group = this.createStopGroup(stop.type);
        group.patchValue({
          type: stop.type,
          locationName: stop.locationName,
          locationCode: stop.locationCode,
          countryCode: stop.countryCode ?? null,
          arrivalEarliest: stop.arrival?.earliest ?? null,
          arrivalLatest: stop.arrival?.latest ?? null,
          departureEarliest: stop.departure?.earliest ?? null,
          departureLatest: stop.departure?.latest ?? null,
          offsetDays: stop.offsetDays ?? null,
          dwellMinutes: stop.dwellMinutes ?? null,
          activities: stop.activities?.length ? stop.activities : ['0001'],
          platformWish: stop.platformWish ?? null,
          notes: stop.notes ?? null,
        });
        this.stops.push(group);
      });

    this.baseVehicles.clear();
    template.composition?.base?.forEach((vehicle) => {
      this.baseVehicles.push(
        this.fb.group({
          vehicleType: this.fb.nonNullable.control(vehicle.type, Validators.required),
          count: this.fb.nonNullable.control(vehicle.count, [
            Validators.required,
            Validators.min(1),
          ]),
          note: this.fb.control(vehicle.note ?? null),
        }),
      );
    });

    this.changeEntries.clear();
    template.composition?.changes?.forEach((change) =>
      change.vehicles.forEach((vehicle) => {
        this.changeEntries.push(
          this.fb.group({
            stopIndex: this.fb.control(change.stopIndex, Validators.required),
            action: this.fb.nonNullable.control(change.action),
            vehicleType: this.fb.nonNullable.control(vehicle.type, Validators.required),
            count: this.fb.nonNullable.control(vehicle.count, [
              Validators.required,
              Validators.min(1),
            ]),
            note: this.fb.control(change.note ?? vehicle.note ?? null),
          }),
        );
      }),
    );
  }

  constructor() {
    if (this.template) {
      this.hydrateFormFromTemplate(this.template);
    } else {
      this.addBaseVehicle();
    }
  }
}
