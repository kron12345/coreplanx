import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
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
  TimetablePhase,
  TimetableSourceInfo,
  TimetableSourceType,
} from '../../core/models/timetable.model';
import {
  TimetableService,
  TimetableStopInput,
  CreateTimetablePayload,
} from '../../core/services/timetable.service';
import { TrainPlanStop } from '../../core/models/train-plan.model';
import {
  PlanAssemblyDialogComponent,
  PlanAssemblyDialogData,
  PlanAssemblyDialogResult,
} from '../orders/plan-assembly-dialog/plan-assembly-dialog.component';
import { PlanModificationStopInput } from '../../core/services/train-plan.service';

export interface TimetableCreateDialogData {
  prefill?: Partial<CreateTimetablePayload>;
}

@Component({
  selector: 'app-timetable-create-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-create-dialog.component.html',
  styleUrl: './timetable-create-dialog.component.scss',
})
export class TimetableCreateDialogComponent {
  private readonly dialogRef = inject<
    MatDialogRef<TimetableCreateDialogComponent, CreateTimetablePayload | undefined>
  >(MatDialogRef);
  private readonly data =
    inject<TimetableCreateDialogData | null>(MAT_DIALOG_DATA, {
      optional: true,
    }) ?? {};
  private readonly fb = inject(FormBuilder);
  private readonly timetableService = inject(TimetableService);
  private readonly dialog = inject(MatDialog);

  readonly phaseOptions: { value: TimetablePhase; label: string }[] = [
    { value: 'bedarf', label: 'Draft' },
    { value: 'path_request', label: 'Path Request' },
    { value: 'offer', label: 'Offered' },
    { value: 'contract', label: 'Booked' },
    { value: 'operational', label: 'Used' },
    { value: 'archived', label: 'Cancelled' },
  ];

  readonly sourceOptions: { value: TimetableSourceType; label: string }[] = [
    { value: 'ttt_path_request', label: 'TTT Path Request' },
    { value: 'framework_agreement', label: 'Rahmenvertragskapazität' },
    { value: 'manual', label: 'Manuelle Planung' },
    { value: 'imported', label: 'Importierte Daten' },
  ];

  readonly form = this.fb.group({
    title: this.fb.nonNullable.control(
      this.data.prefill?.title ?? '',
      Validators.required,
    ),
    refTrainId: this.fb.nonNullable.control(
      this.data.prefill?.refTrainId ?? '',
      Validators.required,
    ),
    opn: this.fb.nonNullable.control(
      this.data.prefill?.opn ?? '',
      Validators.required,
    ),
    trainNumber: this.fb.nonNullable.control(
      this.data.prefill?.trainNumber ?? '',
      Validators.required,
    ),
    responsibleRu: this.fb.nonNullable.control(
      this.data.prefill?.responsibleRu ?? '',
      Validators.required,
    ),
    status: this.fb.nonNullable.control<TimetablePhase>(
      this.data.prefill?.status ?? 'bedarf',
    ),
    sourceType: this.fb.nonNullable.control<TimetableSourceType>(
      this.data.prefill?.source?.type ?? 'ttt_path_request',
    ),
    pathRequestId: new FormControl<string | null>(
      this.data.prefill?.source?.pathRequestId ?? null,
    ),
    frameworkAgreementId: new FormControl<string | null>(
      this.data.prefill?.source?.frameworkAgreementId ?? null,
    ),
    externalSystem: new FormControl<string | null>(
      this.data.prefill?.source?.externalSystem ?? null,
    ),
    lastMessage: new FormControl<string | null>(
      this.data.prefill?.source?.lastMessage ?? null,
    ),
    validFrom: this.fb.nonNullable.control<Date | null>(
      this.data.prefill?.calendar?.validFrom
        ? new Date(this.data.prefill.calendar.validFrom)
        : new Date(),
      Validators.required,
    ),
    validTo: new FormControl<Date | null>(
      this.data.prefill?.calendar?.validTo
        ? new Date(this.data.prefill.calendar.validTo)
        : null,
    ),
    daysBitmap: this.fb.nonNullable.control(
      this.data.prefill?.calendar?.daysBitmap ?? '1111111',
      [Validators.required, Validators.pattern(/^[01]{7}$/)],
    ),
    linkedOrderItemId: new FormControl<string | null>(
      this.data.prefill?.linkedOrderItemId ?? null,
    ),
    notes: new FormControl<string | null>(this.data.prefill?.notes ?? null),
  });

  private readonly stops = signal<TimetableStopInput[]>(
    this.data.prefill?.stops?.length
      ? this.data.prefill.stops
      : [
          {
            sequence: 1,
            type: 'origin',
            locationCode: '',
            locationName: '',
            activities: ['0001'],
          },
          {
            sequence: 2,
            type: 'destination',
            locationCode: '',
            locationName: '',
            activities: ['0001'],
          },
        ],
  );

  readonly stopPreview = computed(() =>
    this.stops().map((stop) => ({
      sequence: stop.sequence,
      name: stop.locationName || stop.locationCode || 'Unbekannter Halt',
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      type: stop.type,
    })),
  );

  readonly errorMessage = signal<string | null>(null);

  submit() {
    if (this.form.invalid) {
      this.errorMessage.set('Bitte alle Pflichtfelder prüfen.');
      this.form.markAllAsTouched();
      return;
    }
    const currentStops = this.normalizeStops(this.stops());
    if (currentStops.length < 2) {
      this.errorMessage.set(
        'Der Fahrplan benötigt mindestens einen Start- und Zielhalt.',
      );
      return;
    }

    const calendar = this.toCalendar();
    if (!calendar) {
      this.errorMessage.set('Bitte gültige Daten für den Kalender wählen.');
      return;
    }

    const source = this.toSourceInfo();
    const payload: CreateTimetablePayload = {
      refTrainId: this.form.controls.refTrainId.value.trim(),
      opn: this.form.controls.opn.value.trim(),
      title: this.form.controls.title.value.trim(),
      trainNumber: this.form.controls.trainNumber.value.trim(),
      responsibleRu: this.form.controls.responsibleRu.value.trim(),
      calendar,
      status: this.form.controls.status.value,
      source,
      stops: currentStops,
      notes: this.form.controls.notes.value?.trim() || undefined,
      linkedOrderItemId:
        this.form.controls.linkedOrderItemId.value?.trim() || undefined,
    };

    try {
      this.timetableService.createTimetable(payload);
      this.dialogRef.close(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Fahrplan konnte nicht erstellt werden.';
      this.errorMessage.set(message);
    }
  }

  cancel() {
    this.dialogRef.close();
  }

  openPlanAssembly() {
    const stops = this.toTrainPlanStops(this.normalizeStops(this.stops()));
    this.dialog
      .open<
        PlanAssemblyDialogComponent,
        PlanAssemblyDialogData,
        PlanAssemblyDialogResult | undefined
      >(PlanAssemblyDialogComponent, {
        width: '1320px',
        maxWidth: '95vw',
        maxHeight: 'calc(100vh - 48px)',
        panelClass: 'plan-assembly-dialog-panel',
        data: { stops },
      })
      .afterClosed()
      .subscribe((result) => {
        if (result?.stops?.length) {
          this.applyAssemblyStops(result.stops);
        }
      });
  }

  stopCount(): number {
    return this.stops().length;
  }

  private normalizeStops(stops: TimetableStopInput[]): TimetableStopInput[] {
    return stops.map((stop, index) => ({
      ...stop,
      sequence: index + 1,
      activities: stop.activities?.length ? stop.activities : ['0001'],
    }));
  }

  private applyAssemblyStops(stops: PlanModificationStopInput[]) {
    const normalized = stops.map((stop, index) => ({
      sequence: index + 1,
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities?.length ? stop.activities : ['0001'],
      platform: stop.platform,
      notes: stop.notes,
    }));
    this.stops.set(normalized);
  }

  private toTrainPlanStops(stops: TimetableStopInput[]): TrainPlanStop[] {
    return stops.map((stop, index) => ({
      id: `TMP-${index + 1}`,
      sequence: index + 1,
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities?.length ? stop.activities : ['0001'],
      platform: stop.platform,
      notes: stop.notes,
    }));
  }

  private toCalendar():
    | {
        validFrom: string;
        validTo?: string;
        daysBitmap: string;
      }
    | undefined {
    const validFrom = this.form.controls.validFrom.value;
    if (!validFrom) {
      return undefined;
    }
    const validTo = this.form.controls.validTo.value;
    const daysBitmap = this.form.controls.daysBitmap.value.trim();
    return {
      validFrom: this.formatDate(validFrom),
      validTo: validTo ? this.formatDate(validTo) : undefined,
      daysBitmap,
    };
  }

  private toSourceInfo(): TimetableSourceInfo {
    const sourceType = this.form.controls.sourceType.value;
    const info: TimetableSourceInfo = { type: sourceType };
    const pathRequestId = this.form.controls.pathRequestId.value?.trim();
    const frameworkId =
      this.form.controls.frameworkAgreementId.value?.trim();
    const externalSystem =
      this.form.controls.externalSystem.value?.trim();
    const lastMessage = this.form.controls.lastMessage.value?.trim();

    if (pathRequestId) {
      info.pathRequestId = pathRequestId;
    }
    if (frameworkId) {
      info.frameworkAgreementId = frameworkId;
    }
    if (externalSystem) {
      info.externalSystem = externalSystem;
    }
    if (lastMessage) {
      info.lastMessage = lastMessage;
    }
    return info;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
