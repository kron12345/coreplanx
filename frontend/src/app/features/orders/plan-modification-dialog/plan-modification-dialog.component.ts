import { CommonModule } from '@angular/common';
import { Component, Inject, computed, inject, signal } from '@angular/core';
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
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import { OrderItem, OrderItemValiditySegment } from '../../../core/models/order-item.model';
import {
  TrainPlan,
  TrainPlanRouteMetadata,
  TrainPlanStop,
  TrainPlanTechnicalData,
} from '../../../core/models/train-plan.model';
import {
  PlanModificationStopInput,
  TrainPlanService,
} from '../../../core/services/train-plan.service';
import { TrafficPeriodService } from '../../../core/services/traffic-period.service';
import { OrderService } from '../../../core/services/order.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TrafficPeriod } from '../../../core/models/traffic-period.model';
import { ScheduleTemplate } from '../../../core/models/schedule-template.model';
import { ScheduleTemplateService } from '../../../core/services/schedule-template.service';
import {
  PlanAssemblyDialogComponent,
  PlanAssemblyDialogData,
  PlanAssemblyDialogResult,
} from '../plan-assembly-dialog/plan-assembly-dialog.component';
import { AnnualCalendarSelectorComponent } from '../../../shared/annual-calendar-selector/annual-calendar-selector.component';
import { VehicleComposition } from '../../../models/master-data';
import { DEMO_MASTER_DATA } from '../../../data/demo-master-data';
import {
  TimetableRollingStock,
  TimetableRollingStockOperation,
  TimetableRollingStockSegment,
} from '../../../core/models/timetable.model';

interface PlanModificationDialogData {
  orderId: string;
  item: OrderItem;
  plan: TrainPlan;
}

type ValidityMode = 'trafficPeriod' | 'custom';

interface PlanModificationFormModel {
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

type BaseVehicleForm = FormGroup<{
  vehicleType: FormControl<string>;
  count: FormControl<number>;
  note: FormControl<string>;
}>;

type ChangeEntryForm = FormGroup<{
  stopIndex: FormControl<number | null>;
  action: FormControl<'attach' | 'detach'>;
  vehicleType: FormControl<string>;
  count: FormControl<number>;
  note: FormControl<string>;
}>;

@Component({
  selector: 'app-plan-modification-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS, AnnualCalendarSelectorComponent],
  templateUrl: './plan-modification-dialog.component.html',
  styleUrl: './plan-modification-dialog.component.scss',
})
export class PlanModificationDialogComponent {
  private readonly dialogRef =
    inject(MatDialogRef<PlanModificationDialogComponent>);
  private readonly fb = inject(FormBuilder);
  private readonly trainPlanService = inject(TrainPlanService);
  private readonly trafficPeriodService = inject(TrafficPeriodService);
  private readonly orderService = inject(OrderService);
  private readonly templateService = inject(ScheduleTemplateService);
  private readonly dialogService = inject(MatDialog);
  private readonly data = inject<PlanModificationDialogData>(MAT_DIALOG_DATA);

  readonly plan = this.data.plan;
  readonly item = this.data.item;
  readonly orderId = this.data.orderId;
  readonly calendarLocked =
    this.item.type === 'Fahrplan' && (this.item.timetablePhase ?? 'bedarf') !== 'bedarf';
  private readonly initialValidityMode: ValidityMode = this.plan.trafficPeriodId
    ? 'trafficPeriod'
    : 'custom';

  readonly periods = computed(() => this.trafficPeriodService.periods());
  readonly templates = computed(() => this.templateService.templates());
  readonly validityMode = signal<ValidityMode>(
    this.calendarLocked ? 'custom' : this.initialValidityMode,
  );
  readonly form: FormGroup<PlanModificationFormModel>;
  readonly errorMessage = signal<string | null>(null);
  readonly assembledStops = signal<PlanModificationStopInput[] | null>(null);
  readonly customSelectedDates = signal<string[]>([]);
  readonly baseVehicles = this.fb.array<BaseVehicleForm>([]);
  readonly changeEntries = this.fb.array<ChangeEntryForm>([]);
  readonly stopOptions = this.plan.stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((stop) => ({ label: `#${stop.sequence} · ${stop.locationName}`, value: stop.sequence }));
  readonly compositionPresets: VehicleComposition[] = DEMO_MASTER_DATA.vehicleCompositions;

  constructor() {
    const initialTrafficPeriod = this.plan.trafficPeriodId ?? '';
    const initialValidFrom = this.plan.calendar.validFrom;
    const initialValidTo = this.plan.calendar.validTo ?? this.plan.calendar.validFrom;
    const initialDaysBitmap =
      this.plan.calendar.daysBitmap && this.plan.calendar.daysBitmap.length === 7
        ? this.plan.calendar.daysBitmap
        : '1111111';

    const initialYear = this.calendarLocked
      ? this.deriveYearFromLabel(this.item.timetableYearLabel) ??
        this.deriveInitialCustomYear(initialValidFrom)
      : this.deriveInitialCustomYear(initialValidFrom);

    this.form = this.fb.group({
      title: this.fb.nonNullable.control(this.plan.title, {
        validators: [Validators.required, Validators.maxLength(120)],
      }),
      trainNumber: this.fb.nonNullable.control(this.plan.trainNumber, {
        validators: [Validators.required, Validators.maxLength(40)],
      }),
      responsibleRu: this.fb.nonNullable.control(this.plan.responsibleRu, {
        validators: [Validators.required, Validators.maxLength(80)],
      }),
      notes: this.fb.nonNullable.control(this.plan.notes ?? ''),
      templateId: this.fb.nonNullable.control(''),
      templateStartTime: this.fb.nonNullable.control('04:00', {
        validators: [Validators.pattern(/^([01]?\d|2[0-3]):[0-5]\d$/)],
      }),
      validityMode: this.fb.nonNullable.control<ValidityMode>(
        this.calendarLocked ? 'custom' : this.initialValidityMode,
      ),
      trafficPeriodId: this.fb.nonNullable.control(
        this.calendarLocked ? '' : initialTrafficPeriod,
      ),
      validFrom: this.fb.nonNullable.control(initialValidFrom, {
        validators: [Validators.required],
      }),
      validTo: this.fb.nonNullable.control(initialValidTo),
      daysBitmap: this.fb.nonNullable.control(initialDaysBitmap, {
        validators: [Validators.required, Validators.pattern(/^[01]{7}$/)],
      }),
      customYear: this.fb.nonNullable.control(initialYear, {
        validators: [Validators.required, Validators.min(1900), Validators.max(2100)],
      }),
      technicalMaxSpeed: this.fb.control<number | null>(this.plan.technical.maxSpeed ?? null, {
        validators: [Validators.min(0), Validators.max(400)],
      }),
      technicalLength: this.fb.control<number | null>(this.plan.technical.lengthMeters ?? null, {
        validators: [Validators.min(0), Validators.max(500)],
      }),
      technicalWeight: this.fb.control<number | null>(this.plan.technical.weightTons ?? null, {
        validators: [Validators.min(0), Validators.max(4000)],
      }),
      technicalTraction: this.fb.nonNullable.control(this.plan.technical.traction ?? '', {
        validators: [Validators.maxLength(60)],
      }),
      technicalEtcsLevel: this.fb.nonNullable.control(this.plan.technical.etcsLevel ?? '', {
        validators: [Validators.maxLength(40)],
      }),
      originBorderPoint: this.fb.nonNullable.control(
        this.plan.routeMetadata?.originBorderPoint ?? '',
        { validators: [Validators.maxLength(80)] },
      ),
      destinationBorderPoint: this.fb.nonNullable.control(
        this.plan.routeMetadata?.destinationBorderPoint ?? '',
        { validators: [Validators.maxLength(80)] },
      ),
      borderNotes: this.fb.nonNullable.control(this.plan.routeMetadata?.borderNotes ?? '', {
        validators: [Validators.maxLength(200)],
      }),
    });

    this.form.controls.validityMode.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((mode) => this.onValidityModeChange(mode));

    this.form.controls.trafficPeriodId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((periodId) => {
        if (this.validityMode() === 'trafficPeriod' && periodId) {
          this.applyTrafficPeriod(periodId);
        }
      });

    this.form.controls.customYear.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((year) => {
        if (!year) {
          this.customSelectedDates.set([]);
          this.updateCustomCalendarFields([]);
          return;
        }
        const filtered = this.customSelectedDates().filter((date) =>
          date.startsWith(String(year)),
        );
        this.customSelectedDates.set(filtered);
        this.updateCustomCalendarFields(filtered);
      });

    this.initializeCustomCalendarState(initialYear);
    this.onValidityModeChange(this.validityMode());
    if (this.calendarLocked) {
      this.form.controls.validityMode.disable({ emitEvent: false });
      this.form.controls.trafficPeriodId.disable({ emitEvent: false });
      if (initialYear) {
        this.form.controls.customYear.setValue(initialYear, { emitEvent: false });
        this.form.controls.customYear.disable({ emitEvent: false });
      }
    }
    this.hydrateCompositionFromRollingStock();
  }

  trackByPeriodId(_: number, period: { id: string }): string {
    return period.id;
  }

  customYearValue(): number {
    if (this.calendarLocked) {
      const lockedYear = this.deriveYearFromLabel(this.item.timetableYearLabel);
      if (lockedYear) {
        return lockedYear;
      }
    }
    return (
      this.form.controls.customYear.value ??
      this.deriveInitialCustomYear(this.plan.calendar.validFrom)
    );
  }

  onCustomDatesChange(dates: string[]) {
    const year = this.calendarLocked ? this.customYearValue() : this.customYearValue();
    const filtered = dates.filter((date) => date.startsWith(String(year)));
    this.customSelectedDates.set(filtered);
    this.updateCustomCalendarFields(filtered);
  }

  get baseVehicleForms(): BaseVehicleForm[] {
    return this.baseVehicles.controls;
  }

  get changeEntryForms(): ChangeEntryForm[] {
    return this.changeEntries.controls;
  }

  addBaseVehicle(seed?: { vehicleType?: string; count?: number; note?: string }) {
    this.baseVehicles.push(this.createBaseVehicleGroup(seed));
  }

  removeBaseVehicle(index: number) {
    if (index < 0 || index >= this.baseVehicles.length) {
      return;
    }
    this.baseVehicles.removeAt(index);
  }

  applyCompositionPreset(presetId: string | null) {
    if (!presetId) {
      return;
    }
    const preset = this.compositionPresets.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }
    this.baseVehicles.clear();
    preset.entries.forEach((entry) => {
      this.baseVehicles.push(
        this.createBaseVehicleGroup({
          vehicleType: entry.typeId,
          count: entry.quantity,
          note: preset.remark ?? '',
        }),
      );
    });
    this.baseVehicles.markAsDirty();
  }

  addChangeEntry(seed?: {
    stopIndex?: number | null;
    action?: 'attach' | 'detach';
    vehicleType?: string;
    count?: number;
    note?: string;
  }) {
    this.changeEntries.push(this.createChangeEntryGroup(seed));
  }

  removeChangeEntry(index: number) {
    if (index < 0 || index >= this.changeEntries.length) {
      return;
    }
    this.changeEntries.removeAt(index);
  }

  calendarPeriodLabel(): string {
    if (!this.plan.trafficPeriodId) {
      return 'Kein Referenzkalender';
    }
    return (
      this.trafficPeriodService.getById(this.plan.trafficPeriodId)?.name ??
      this.plan.trafficPeriodId
    );
  }

  calendarRangeLabel(): string {
    const start = this.plan.calendar.validFrom ?? '—';
    const end = this.plan.calendar.validTo;
    if (!end || end === start) {
      return start;
    }
    return `${start} – ${end}`;
  }

  stopPreviewEntries(): PlanModificationStopInput[] {
    return this.previewStops();
  }

  stopPreviewTimeLabel(stop: PlanModificationStopInput): string {
    const departure = this.formatIsoTime(stop.departureTime);
    const arrival = this.formatIsoTime(stop.arrivalTime);
    if (arrival && departure && arrival !== departure) {
      return `${arrival} / ${departure}`;
    }
    return departure ?? arrival ?? '–';
  }

  applyTemplate() {
    this.errorMessage.set(null);
    const templateId = this.form.controls.templateId.value.trim();
    if (!templateId) {
      this.errorMessage.set('Bitte eine Fahrplanvorlage auswählen.');
      return;
    }
    const template = this.templateService.getById(templateId);
    if (!template) {
      this.errorMessage.set('Ausgewählte Fahrplanvorlage wurde nicht gefunden.');
      return;
    }
    const startTime = this.form.controls.templateStartTime.value.trim();
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      this.errorMessage.set('Bitte eine gültige Startzeit im Format HH:MM angeben.');
      return;
    }

    const referenceIso = this.operationReferenceIso();
    const departure = this.combineDateWithTime(referenceIso, startTime);
    if (Number.isNaN(departure.getTime())) {
      this.errorMessage.set('Startzeit konnte nicht verarbeitet werden.');
      return;
    }

    const stops = this.buildStopsFromTemplate(template, departure);
    if (!stops.length) {
      this.errorMessage.set('Die Fahrplanvorlage enthält keine Halte.');
      return;
    }

    this.assembledStops.set(stops);
  }

  cancel() {
    this.dialogRef.close();
  }

  submit() {
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const mode: ValidityMode = this.calendarLocked ? 'custom' : value.validityMode;
    if (mode === 'trafficPeriod') {
      if (!value.trafficPeriodId) {
        this.errorMessage.set('Bitte einen Referenzkalender auswählen.');
        return;
      }
    } else {
      if (!this.customSelectedDates().length) {
        this.errorMessage.set('Bitte mindestens einen Verkehrstag auswählen.');
        return;
      }
    }
    if (!this.validateCompositionForms()) {
      return;
    }

    try {
      const calendar =
        mode === 'trafficPeriod'
          ? this.calendarFromPeriod(value.trafficPeriodId!)
          : this.calendarFromCustomSelection(this.customSelectedDates());
      const rollingStock = this.buildRollingStockPayload();
      const technical = this.buildTechnicalPayload(value);
      const routeMetadata = this.buildRouteMetadataPayload(value);

      const newPlan = this.trainPlanService.createPlanModification({
        originalPlanId: this.plan.id,
        title: value.title.trim(),
        trainNumber: value.trainNumber.trim(),
        responsibleRu: value.responsibleRu.trim(),
        notes: value.notes.trim() ? value.notes.trim() : undefined,
        trafficPeriodId:
          mode === 'trafficPeriod' ? value.trafficPeriodId || undefined : undefined,
        calendar,
        stops: this.assembledStops() ?? undefined,
        rollingStock,
        technical,
        routeMetadata,
      });

      if (this.calendarLocked) {
        this.handleLockedPlanModification(newPlan, this.customSelectedDates());
      } else {
        this.orderService.applyPlanModification({
          orderId: this.orderId,
          itemId: this.item.id,
          plan: newPlan,
        });
      }

      this.dialogRef.close({
        updatedPlanId: newPlan.id,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Der Fahrplan konnte nicht aktualisiert werden.';
      this.errorMessage.set(message);
    }
  }

  private onValidityModeChange(mode: ValidityMode) {
    const effectiveMode = this.calendarLocked ? 'custom' : mode;
    this.validityMode.set(effectiveMode);

    if (effectiveMode === 'trafficPeriod') {
      this.form.controls.trafficPeriodId.addValidators(Validators.required);
      this.form.controls.customYear.disable({ emitEvent: false });
      this.form.controls.validFrom.disable({ emitEvent: false });
      this.form.controls.validTo.disable({ emitEvent: false });
      this.form.controls.daysBitmap.disable({ emitEvent: false });
      if (this.form.controls.trafficPeriodId.value) {
        this.applyTrafficPeriod(this.form.controls.trafficPeriodId.value);
      }
    } else {
      this.form.controls.trafficPeriodId.removeValidators(Validators.required);
      this.form.controls.customYear.enable({ emitEvent: false });
      this.form.controls.validFrom.disable({ emitEvent: false });
      this.form.controls.validTo.disable({ emitEvent: false });
      this.form.controls.daysBitmap.disable({ emitEvent: false });
      const currentDates = this.customSelectedDates();
      if (!currentDates.length) {
        const year =
          this.form.controls.customYear.value ??
          this.deriveInitialCustomYear(this.plan.calendar.validFrom);
        this.initializeCustomCalendarState(year);
      } else {
        this.updateCustomCalendarFields(currentDates);
      }
    }
    this.form.controls.trafficPeriodId.updateValueAndValidity({
      emitEvent: false,
    });

    if (this.calendarLocked) {
      const lockedYear = this.deriveYearFromLabel(this.item.timetableYearLabel);
      if (lockedYear) {
        this.form.controls.customYear.setValue(lockedYear, { emitEvent: false });
        const presetDates = this.customSelectedDates().filter((date) =>
          date.startsWith(String(lockedYear)),
        );
        this.customSelectedDates.set(presetDates);
        this.updateCustomCalendarFields(presetDates);
      }
    }
  }

  private deriveYearFromLabel(label: string | null | undefined): number | null {
    if (!label) {
      return null;
    }
    const match = /^(\d{4})/.exec(label);
    if (match) {
      const year = Number.parseInt(match[1], 10);
      return Number.isNaN(year) ? null : year;
    }
    return null;
  }

  private applyTrafficPeriod(periodId: string) {
    const period = this.trafficPeriodService.getById(periodId);
    if (!period) {
      return;
    }
    const calendar = this.calendarFromPeriod(periodId);
    this.form.patchValue(
      {
        validFrom: calendar.validFrom,
        validTo: calendar.validTo ?? calendar.validFrom,
        daysBitmap: calendar.daysBitmap,
      },
      { emitEvent: false },
    );
  }

  private operationReferenceIso(): string {
    const firstDeparture = this.plan.stops.find((stop) => stop.departureTime)?.departureTime;
    if (firstDeparture) {
      return firstDeparture;
    }
    const firstArrival = this.plan.stops.find((stop) => stop.arrivalTime)?.arrivalTime;
    if (firstArrival) {
      return firstArrival;
    }
    return `${this.plan.calendar.validFrom}T00:00:00.000Z`;
  }

  private combineDateWithTime(referenceIso: string, time: string): Date {
    const reference = new Date(referenceIso);
    const [hours, minutes] = time.split(':').map((value) => Number.parseInt(value, 10));
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return new Date(NaN);
    }
    if (Number.isNaN(reference.getTime())) {
      return new Date(`${this.plan.calendar.validFrom}T${time}:00.000Z`);
    }
    const result = new Date(reference);
    result.setUTCHours(hours, minutes, 0, 0);
    return result;
  }

  private buildStopsFromTemplate(
    template: ScheduleTemplate,
    departure: Date,
  ): PlanModificationStopInput[] {
    const baseMinutes = this.extractReferenceMinutes(template.stops) ?? 0;
    return template.stops.map((stop) => {
      const arrivalMinutes = this.extractTime(stop.arrival?.earliest ?? stop.arrival?.latest);
      const departureMinutes = this.extractTime(
        stop.departure?.earliest ?? stop.departure?.latest,
      );

      const offsetMinutes = (stop.offsetDays ?? 0) * 1440;
      const arrivalTime =
        arrivalMinutes !== undefined
          ? this.addMinutesToDate(departure, arrivalMinutes - baseMinutes + offsetMinutes)
          : undefined;
      const departureTime =
        departureMinutes !== undefined
          ? this.addMinutesToDate(departure, departureMinutes - baseMinutes + offsetMinutes)
          : undefined;

      return {
        sequence: stop.sequence,
        type: stop.type,
        locationCode: stop.locationCode,
        locationName: stop.locationName,
        countryCode: stop.countryCode,
        arrivalTime: arrivalTime ? arrivalTime.toISOString() : undefined,
        departureTime: departureTime ? departureTime.toISOString() : undefined,
        arrivalOffsetDays: arrivalTime ? this.offsetDays(departure, arrivalTime) : undefined,
        departureOffsetDays: departureTime
          ? this.offsetDays(departure, departureTime)
          : undefined,
        dwellMinutes: stop.dwellMinutes,
        activities:
          stop.activities && stop.activities.length ? [...stop.activities] : ['0001'],
        platform: stop.platformWish,
        notes: stop.notes,
      } satisfies PlanModificationStopInput;
    });
  }

  private extractReferenceMinutes(stops: ScheduleTemplate['stops']): number | undefined {
    for (const stop of stops) {
      const candidate =
        stop.departure?.earliest ??
        stop.departure?.latest ??
        stop.arrival?.earliest ??
        stop.arrival?.latest;
      const minutes = this.extractTime(candidate);
      if (minutes !== undefined) {
        return minutes + (stop.offsetDays ?? 0) * 1440;
      }
    }
    return undefined;
  }

  private extractTime(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    return this.parseTimeToMinutes(value);
  }

  private parseTimeToMinutes(time: string): number | undefined {
    const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(time);
    if (!match) {
      return undefined;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    return hours * 60 + minutes;
  }

  private addMinutesToDate(base: Date, deltaMinutes: number): Date {
    const result = new Date(base.getTime());
    result.setMinutes(result.getMinutes() + deltaMinutes);
    return result;
  }

  private offsetDays(base: Date, target: Date): number | undefined {
    const diff = target.getTime() - base.getTime();
    const days = Math.round(diff / 86400000);
    return days === 0 ? undefined : days;
  }

  private initializeCustomCalendarState(targetYear: number) {
    const calendarDates = this.deriveDatesFromCalendar(this.plan.calendar);
    const filtered = calendarDates.filter((date) => date.startsWith(String(targetYear)));
    this.customSelectedDates.set(filtered);
    this.updateCustomCalendarFields(filtered);
  }

  private updateCustomCalendarFields(dates: string[]) {
    if (!dates.length) {
      this.form.patchValue(
        {
          validFrom: '',
          validTo: '',
          daysBitmap: '0000000',
        },
        { emitEvent: false },
      );
      return;
    }
    const calendar = this.calendarFromCustomSelection(dates);
    this.form.patchValue(
      {
        validFrom: calendar.validFrom,
        validTo: calendar.validTo ?? calendar.validFrom,
        daysBitmap: calendar.daysBitmap,
      },
      { emitEvent: false },
    );
  }

  private calendarFromCustomSelection(dates: string[]): {
    validFrom: string;
    validTo?: string;
    daysBitmap: string;
  } {
    const sorted = [...dates].sort();
    const validFrom = sorted[0];
    const validTo = sorted[sorted.length - 1];
    return {
      validFrom,
      validTo: validTo !== validFrom ? validTo : undefined,
      daysBitmap: this.bitmapFromDates(sorted),
    };
  }

  private deriveInitialCustomYear(validFrom: string | undefined): number {
    if (validFrom && /^\d{4}-/.test(validFrom)) {
      const parsed = Number.parseInt(validFrom.slice(0, 4), 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return new Date().getFullYear();
  }

  private deriveDatesFromCalendar(calendar: TrainPlan['calendar']): string[] {
    const { validFrom } = calendar;
    if (!validFrom) {
      return [];
    }
    const start = new Date(validFrom);
    if (Number.isNaN(start.getTime())) {
      return [];
    }
    const end = calendar.validTo ? new Date(calendar.validTo) : new Date(validFrom);
    if (Number.isNaN(end.getTime())) {
      return [];
    }
    const bitmap =
      calendar.daysBitmap && /^[01]{7}$/.test(calendar.daysBitmap)
        ? calendar.daysBitmap
        : '1111111';
    const result: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const weekday = (cursor.getDay() + 6) % 7;
      if (bitmap[weekday] === '1') {
        result.push(this.formatDate(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  private bitmapFromDates(dates: string[]): string {
    const bits = ['0', '0', '0', '0', '0', '0', '0'];
    dates.forEach((date) => {
      const parsed = new Date(date);
      if (!Number.isNaN(parsed.getTime())) {
        const weekday = (parsed.getDay() + 6) % 7;
        bits[weekday] = '1';
      }
    });
    return bits.join('');
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private calendarFromPeriod(
    periodId: string,
  ): { validFrom: string; validTo?: string; daysBitmap: string } {
    const period = this.trafficPeriodService.getById(periodId);
    if (!period) {
      throw new Error('Referenzkalender nicht gefunden.');
    }
    let earliest: string | undefined;
    let latest: string | undefined;
    let combinedBitmap = '0000000';

    period.rules.forEach((rule: TrafficPeriod['rules'][number]) => {
      const start = rule.validityStart;
      const end = rule.validityEnd ?? rule.validityStart;
      if (!earliest || start < earliest) {
        earliest = start;
      }
      if (!latest || end > latest) {
        latest = end;
      }
      if (rule.daysBitmap?.length === 7) {
        combinedBitmap = this.mergeBitmap(combinedBitmap, rule.daysBitmap);
      }
    });

    return {
      validFrom: earliest ?? new Date().toISOString().slice(0, 10),
      validTo: latest,
      daysBitmap: combinedBitmap.includes('1') ? combinedBitmap : '1111111',
    };
  }

  private mergeBitmap(a: string, b: string): string {
    const result: string[] = [];
    for (let i = 0; i < 7; i++) {
      const bitA = a[i] === '1';
      const bitB = b[i] === '1';
      result.push(bitA || bitB ? '1' : '0');
    }
    return result.join('');
  }

  openAssemblyDialog() {
    const baseStops = this.previewStops().map((stop) => this.toTrainPlanStop(stop));

    this.dialogService
      .open<
        PlanAssemblyDialogComponent,
        PlanAssemblyDialogData,
        PlanAssemblyDialogResult | undefined
      >(PlanAssemblyDialogComponent, {
        width: '1320px',
        maxWidth: '95vw',
        maxHeight: 'calc(100vh - 48px)',
        panelClass: 'plan-assembly-dialog-panel',
        data: {
          stops: baseStops,
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (result?.stops) {
          this.assembledStops.set(result.stops);
        }
      });
  }

  hasCustomStops(): boolean {
    return this.assembledStops() !== null;
  }

  private toTrainPlanStop(stop: PlanModificationStopInput): TrainPlanStop {
    return {
      id: `${this.plan.id}-TMP-${String(stop.sequence).padStart(3, '0')}`,
      sequence: stop.sequence,
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities,
      platform: stop.platform,
      notes: stop.notes,
    };
  }

  stopCount(): number {
    return this.previewStops().length;
  }

  startStopLabel(): string {
    const stops = this.previewStops();
    if (!stops.length) {
      return '–';
    }
    return this.stopLabel(stops[0], true);
  }

  endStopLabel(): string {
    const stops = this.previewStops();
    if (!stops.length) {
      return '–';
    }
    return this.stopLabel(stops[stops.length - 1], false);
  }

  private stopLabel(stop: PlanModificationStopInput, preferDeparture: boolean): string {
    const primary = preferDeparture ? stop.departureTime : stop.arrivalTime;
    const fallback = preferDeparture ? stop.arrivalTime : stop.departureTime;
    const time = primary || fallback || '–';
    return `${stop.locationName} (${time})`;
  }

  private formatIsoTime(value: string | undefined): string | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString().slice(11, 16);
  }

  private hydrateCompositionFromRollingStock() {
    const segments = [...(this.plan.rollingStock?.segments ?? [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    if (!segments.length) {
      this.addBaseVehicle();
    } else {
      segments.forEach((segment) =>
        this.addBaseVehicle({
          vehicleType: segment.vehicleTypeId,
          count: segment.count,
          note: segment.remarks,
        }),
      );
    }
    const operations = this.plan.rollingStock?.operations ?? [];
    operations.forEach((operation) => {
      const action: 'attach' | 'detach' =
        operation.type === 'split' ? 'detach' : 'attach';
      const stopIndex = this.resolveStopSequence(operation.stopId);
      this.addChangeEntry({
        action,
        stopIndex: stopIndex ?? null,
        vehicleType: operation.remarks ?? '',
        count: 1,
        note: operation.remarks ?? '',
      });
    });
  }

  private createBaseVehicleGroup(seed?: {
    vehicleType?: string;
    count?: number;
    note?: string;
  }): BaseVehicleForm {
    return this.fb.group({
      vehicleType: this.fb.nonNullable.control(seed?.vehicleType ?? '', {
        validators: [Validators.maxLength(80)],
      }),
      count: this.fb.nonNullable.control(seed?.count ?? 1, {
        validators: [Validators.min(1)],
      }),
      note: this.fb.nonNullable.control(seed?.note ?? '', {
        validators: [Validators.maxLength(160)],
      }),
    });
  }

  private createChangeEntryGroup(seed?: {
    stopIndex?: number | null;
    action?: 'attach' | 'detach';
    vehicleType?: string;
    count?: number;
    note?: string;
  }): ChangeEntryForm {
    return this.fb.group({
      stopIndex: this.fb.control(seed?.stopIndex ?? null),
      action: this.fb.nonNullable.control(seed?.action ?? 'attach'),
      vehicleType: this.fb.nonNullable.control(seed?.vehicleType ?? '', {
        validators: [Validators.maxLength(80)],
      }),
      count: this.fb.nonNullable.control(seed?.count ?? 1, {
        validators: [Validators.min(1)],
      }),
      note: this.fb.nonNullable.control(seed?.note ?? '', {
        validators: [Validators.maxLength(200)],
      }),
    });
  }

  private validateCompositionForms(): boolean {
    const baseInvalid = this.baseVehicles.controls.some((group) => {
      const type = group.controls.vehicleType.value.trim();
      const count = group.controls.count.value ?? 0;
      if (!type && (!count || count <= 0)) {
        return false;
      }
      return !type || count <= 0;
    });
    if (baseInvalid) {
      this.baseVehicles.controls.forEach((group) => group.markAllAsTouched());
      this.errorMessage.set('Bitte Typ und Anzahl für jedes Fahrzeug angeben.');
      return false;
    }

    const changeInvalid = this.changeEntries.controls.some((group) => {
      const stopIndex = group.controls.stopIndex.value;
      const type = group.controls.vehicleType.value.trim();
      const count = group.controls.count.value ?? 0;
      const isEmpty =
        (stopIndex === null || stopIndex === undefined) && !type && count <= 1;
      if (isEmpty) {
        return false;
      }
      return stopIndex === null || stopIndex === undefined || !type || count <= 0;
    });
    if (changeInvalid) {
      this.changeEntries.controls.forEach((group) => group.markAllAsTouched());
      this.errorMessage.set('Bitte Halt, Aktion und Fahrzeuge für Kopplungen angeben.');
      return false;
    }
    return true;
  }

  private buildRollingStockPayload(): TimetableRollingStock | undefined {
    const baseVehicles = this.baseVehicles.controls
      .map((group) => ({
        type: group.controls.vehicleType.value.trim(),
        count: group.controls.count.value ?? 0,
        note: group.controls.note.value.trim(),
      }))
      .filter((entry) => entry.type && entry.count > 0);

    type ChangeEntryPayload = {
      stopId: string;
      action: 'attach' | 'detach';
      vehicleType: string;
      count: number;
      note: string | undefined;
    };

    const changeEntries = this.changeEntries.controls
      .map<ChangeEntryPayload | null>((group) => {
        const stopIndex = group.controls.stopIndex.value ?? undefined;
        const type = group.controls.vehicleType.value.trim();
        const count = group.controls.count.value ?? 0;
        if (!stopIndex || !type || count <= 0) {
          return null;
        }
        return {
          stopId: this.resolveStopId(stopIndex),
          action: group.controls.action.value,
          vehicleType: type,
          count,
          note: group.controls.note.value.trim() || undefined,
        };
      })
      .filter((entry): entry is ChangeEntryPayload => entry !== null);

    if (!baseVehicles.length && !changeEntries.length) {
      return undefined;
    }

    const segments: TimetableRollingStockSegment[] = baseVehicles.map((vehicle, index) => ({
      position: index + 1,
      vehicleTypeId: vehicle.type,
      count: vehicle.count,
      remarks: vehicle.note || undefined,
    }));

    const operations: TimetableRollingStockOperation[] = changeEntries.map((entry, index) => ({
      stopId: entry.stopId,
      type: entry.action === 'attach' ? 'join' : 'split',
      setIds: [`SET-${index + 1}`],
      remarks: entry.note ?? `${entry.count}× ${entry.vehicleType}`,
    }));

    return {
      segments,
      operations: operations.length ? operations : undefined,
    };
  }

  private buildTechnicalPayload(
    value: ReturnType<FormGroup<PlanModificationFormModel>['getRawValue']>,
  ): TrainPlanTechnicalData {
    return {
      trainType: this.plan.technical.trainType,
      maxSpeed: value.technicalMaxSpeed ?? undefined,
      lengthMeters: value.technicalLength ?? undefined,
      weightTons: value.technicalWeight ?? undefined,
      traction: value.technicalTraction?.trim() || this.plan.technical.traction,
      energyType: this.plan.technical.energyType,
      brakeType: this.plan.technical.brakeType,
      etcsLevel: value.technicalEtcsLevel?.trim() || this.plan.technical.etcsLevel,
    };
  }

  private buildRouteMetadataPayload(
    value: ReturnType<FormGroup<PlanModificationFormModel>['getRawValue']>,
  ): TrainPlanRouteMetadata | undefined {
    const origin = value.originBorderPoint?.trim() || '';
    const destination = value.destinationBorderPoint?.trim() || '';
    const notes = value.borderNotes?.trim() || '';
    if (!origin && !destination && !notes && !this.plan.routeMetadata) {
      return undefined;
    }
    return {
      originBorderPoint: origin || undefined,
      destinationBorderPoint: destination || undefined,
      borderNotes: notes || undefined,
    };
  }

  private resolveStopId(sequence: number | undefined): string {
    if (!sequence) {
      return this.plan.stops[0]?.id ?? `${this.plan.id}-STOP-001`;
    }
    const match = this.plan.stops.find((stop) => stop.sequence === sequence);
    return match?.id ?? this.plan.stops[0]?.id ?? `${this.plan.id}-STOP-001`;
  }

  private resolveStopSequence(stopId: string | undefined): number | undefined {
    if (!stopId) {
      return undefined;
    }
    return this.plan.stops.find((stop) => stop.id === stopId)?.sequence;
  }

  private previewStops(): PlanModificationStopInput[] {
    if (this.assembledStops()) {
      return this.assembledStops() as PlanModificationStopInput[];
    }
    return this.plan.stops.map((stop) => this.mapPlanStop(stop));
  }

  private mapPlanStop(stop: TrainPlanStop): PlanModificationStopInput {
    return {
      sequence: stop.sequence,
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode,
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: [...stop.activities],
      platform: stop.platform,
      notes: stop.notes,
    };
  }

  private handleLockedPlanModification(plan: TrainPlan, dates: string[]) {
    const normalizedDates = Array.from(new Set(dates)).sort();
    const segments = this.buildSegmentsFromDates(normalizedDates);
    if (!segments.length) {
      throw new Error('Bitte mindestens einen Verkehrstag auswählen.');
    }
    const result = this.orderService.splitOrderItem({
      orderId: this.orderId,
      itemId: this.item.id,
      rangeStart: segments[0].startDate,
      rangeEnd: segments[segments.length - 1].endDate,
      segments,
    });
    this.registerSubCalendarVariant(plan, normalizedDates);
    this.orderService.applyPlanModification({
      orderId: this.orderId,
      itemId: result.created.id,
      plan: {
        ...plan,
        trafficPeriodId: this.item.trafficPeriodId ?? plan.trafficPeriodId,
      },
    });
  }

  private registerSubCalendarVariant(plan: TrainPlan, dates: string[]): void {
    if (!this.item.trafficPeriodId || !dates.length) {
      return;
    }
    const periodId = this.item.trafficPeriodId;
    this.trafficPeriodService.addVariantRule(periodId, {
      name: `${plan.title} · Unterkalender`,
      dates,
      variantType: 'special_day',
      appliesTo: 'both',
      reason: `Variante für ${plan.trainNumber}`,
    });
    this.trafficPeriodService.addExclusionDates(periodId, dates);
  }

  private buildSegmentsFromDates(dates: string[]): OrderItemValiditySegment[] {
    if (!dates.length) {
      return [];
    }
    const normalized = Array.from(new Set(dates.filter((date) => !!date))).sort();
    const segments: OrderItemValiditySegment[] = [];
    let start = normalized[0];
    let prev = start;
    for (let i = 1; i < normalized.length; i += 1) {
      const current = normalized[i];
      if (this.areConsecutiveDates(prev, current)) {
        prev = current;
        continue;
      }
      segments.push({ startDate: start, endDate: prev });
      start = current;
      prev = current;
    }
    segments.push({ startDate: start, endDate: prev });
    return segments;
  }

  private areConsecutiveDates(a: string, b: string): boolean {
    const first = new Date(`${a}T00:00:00Z`);
    const second = new Date(`${b}T00:00:00Z`);
    if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime())) {
      return false;
    }
    const diff = second.getTime() - first.getTime();
    return diff === 24 * 60 * 60 * 1000;
  }
}
