import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  FormArray,
  FormBuilder,
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
import { OrderItem } from '../../../core/models/order-item.model';
import {
  TrainPlan,
  TrainPlanRouteMetadata,
  TrainPlanTechnicalData,
} from '../../../core/models/train-plan.model';
import {
  PlanModificationStopInput,
  TrainPlanService,
} from '../../../core/services/train-plan.service';
import { TrafficPeriodService } from '../../../core/services/traffic-period.service';
import { OrderService } from '../../../core/services/order.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScheduleTemplateService } from '../../../core/services/schedule-template.service';
import { TimetableYearService } from '../../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../../core/models/timetable-year.model';
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
import { VehicleCompositionFormComponent } from '../shared/vehicle-composition-form/vehicle-composition-form.component';
import {
  CompositionBaseVehicleForm,
  CompositionChangeEntryForm,
} from '../shared/vehicle-composition-form/vehicle-composition-form.component';
import {
  buildSegmentsFromDates,
  calendarFromCustomSelection,
  calendarFromPeriod as calendarFromTrafficPeriod,
  deriveDatesFromCalendar,
  deriveInitialCustomYear,
  deriveYearFromLabel,
  expandDatesInRange,
} from './plan-modification-calendar.utils';
import {
  buildStopsFromTemplate,
  combineDateWithTime,
  formatIsoTime,
  mapPlanStop,
  operationReferenceIso,
  resolveStopIdBySequence,
  resolveStopSequenceById,
  stopLabel,
  toTrainPlanStop,
} from './plan-modification-stops.utils';
import type {
  PlanModificationDialogData,
  PlanModificationFormModel,
  ValidityMode,
} from './plan-modification-dialog.types';

@Component({
    selector: 'app-plan-modification-dialog',
    imports: [
        CommonModule,
        ReactiveFormsModule,
        ...MATERIAL_IMPORTS,
        AnnualCalendarSelectorComponent,
        VehicleCompositionFormComponent,
    ],
    templateUrl: './plan-modification-dialog.component.html',
    styleUrl: './plan-modification-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlanModificationDialogComponent {
  private readonly dialogRef =
    inject(MatDialogRef<PlanModificationDialogComponent>);
  private readonly fb = inject(FormBuilder);
  private readonly trainPlanService = inject(TrainPlanService);
  private readonly trafficPeriodService = inject(TrafficPeriodService);
  private readonly timetableYearService = inject(TimetableYearService);
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
  readonly baseVehicles = this.fb.array<CompositionBaseVehicleForm>([]);
  readonly changeEntries = this.fb.array<CompositionChangeEntryForm>([]);
  readonly stopOptions = this.plan.stops
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((stop) => ({ label: `#${stop.sequence} · ${stop.locationName}`, value: stop.sequence }));
  readonly compositionPresets: VehicleComposition[] = DEMO_MASTER_DATA.vehicleCompositions;
  readonly requiresRollingStock = this.isTttOrder();
  readonly baseVehicleFactory = (seed?: {
    vehicleType?: string;
    count?: number;
    note?: string | null;
  }) =>
    this.createBaseVehicleGroup(seed);
  readonly changeEntryFactory = (seed?: {
    stopIndex?: number | null;
    action?: 'attach' | 'detach';
    vehicleType?: string;
    count?: number;
    note?: string | null;
  }) => this.createChangeEntryGroup(seed);
  private readonly timetableYearBounds: TimetableYearBounds | null;
  readonly allowedCalendarDates: string[] | null;

  constructor() {
    this.timetableYearBounds = this.resolveTimetableYearBounds();
    this.allowedCalendarDates = this.timetableYearBounds
      ? expandDatesInRange(this.timetableYearBounds.startIso, this.timetableYearBounds.endIso)
      : null;
    const initialTrafficPeriod = this.plan.trafficPeriodId ?? '';
    const initialValidFrom = this.plan.calendar.validFrom;
    const initialValidTo = this.plan.calendar.validTo ?? this.plan.calendar.validFrom;
    const initialDaysBitmap =
      this.plan.calendar.daysBitmap && this.plan.calendar.daysBitmap.length === 7
        ? this.plan.calendar.daysBitmap
        : '1111111';

    const initialYear = this.calendarLocked
      ? this.timetableYearBounds?.startYear ??
        deriveYearFromLabel(this.item.timetableYearLabel) ??
        deriveInitialCustomYear(initialValidFrom)
      : deriveInitialCustomYear(initialValidFrom);

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
        const filtered = this.filterDatesToTimetableYear(
          this.customSelectedDates(),
          year,
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
      const lockedYear =
        this.timetableYearBounds?.startYear ??
        deriveYearFromLabel(this.item.timetableYearLabel);
      if (lockedYear) {
        return lockedYear;
      }
    }
    return (
      this.form.controls.customYear.value ??
      deriveInitialCustomYear(this.plan.calendar.validFrom)
    );
  }

  onCustomDatesChange(dates: string[]) {
    const year = this.customYearValue();
    const filtered = this.filterDatesToTimetableYear(dates, year);
    this.customSelectedDates.set(filtered);
    this.updateCustomCalendarFields(filtered);
  }

  get baseVehicleForms(): CompositionBaseVehicleForm[] {
    return this.baseVehicles.controls;
  }

  get changeEntryForms(): CompositionChangeEntryForm[] {
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
    const departure = formatIsoTime(stop.departureTime);
    const arrival = formatIsoTime(stop.arrivalTime);
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

    const referenceIso = operationReferenceIso(this.plan);
    const departure = combineDateWithTime({
      referenceIso,
      time: startTime,
      fallbackValidFromIso: this.plan.calendar.validFrom,
    });
    if (Number.isNaN(departure.getTime())) {
      this.errorMessage.set('Startzeit konnte nicht verarbeitet werden.');
      return;
    }

    const stops = buildStopsFromTemplate(template, departure);
    if (!stops.length) {
      this.errorMessage.set('Die Fahrplanvorlage enthält keine Halte.');
      return;
    }

    this.assembledStops.set(stops);
  }

  cancel() {
    this.dialogRef.close();
  }

  async submit() {
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
          : calendarFromCustomSelection(this.customSelectedDates());
      const rollingStock = this.buildRollingStockPayload();
      const technical = this.buildTechnicalPayload(value);
      const routeMetadata = this.buildRouteMetadataPayload(value);

      const newPlan = await this.trainPlanService.createPlanModification({
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
        await this.handleLockedPlanModification(newPlan, this.customSelectedDates());
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
          deriveInitialCustomYear(this.plan.calendar.validFrom);
        this.initializeCustomCalendarState(year);
      } else {
        this.updateCustomCalendarFields(currentDates);
      }
    }
    this.form.controls.trafficPeriodId.updateValueAndValidity({
      emitEvent: false,
    });

    if (this.calendarLocked) {
      const lockedYear =
        this.timetableYearBounds?.startYear ??
        deriveYearFromLabel(this.item.timetableYearLabel);
      if (lockedYear) {
        this.form.controls.customYear.setValue(lockedYear, { emitEvent: false });
        const presetDates = this.filterDatesToTimetableYear(
          this.customSelectedDates(),
          lockedYear,
        );
        this.customSelectedDates.set(presetDates);
        this.updateCustomCalendarFields(presetDates);
      }
    }
  }

  private resolveTimetableYearBounds(): TimetableYearBounds | null {
    const label = this.item.timetableYearLabel;
    if (label) {
      try {
        return this.timetableYearService.getYearByLabel(label);
      } catch {
        // ignore and try fallbacks
      }
    }

    if (this.item.trafficPeriodId) {
      const period = this.trafficPeriodService.getById(this.item.trafficPeriodId);
      if (period?.timetableYearLabel) {
        try {
          return this.timetableYearService.getYearByLabel(period.timetableYearLabel);
        } catch {
          // ignore and try sample dates
        }
      }
      const sample =
        period?.rules?.find((rule) => rule.includesDates?.length)?.includesDates?.[0] ??
        period?.rules?.[0]?.validityStart;
      if (sample) {
        try {
          return this.timetableYearService.getYearBounds(sample);
        } catch {
          // ignore
        }
      }
    }

    const sampleDate =
      this.plan.calendar.validFrom ??
      this.plan.calendar.validTo ??
      this.item.start ??
      undefined;
    if (sampleDate) {
      try {
        return this.timetableYearService.getYearBounds(sampleDate);
      } catch {
        return null;
      }
    }
    return null;
  }

  private isTttOrder(): boolean {
    const order = this.orderService.getOrderById(this.orderId);
    const tags = [...(order?.tags ?? []), ...(this.item.tags ?? [])];
    return tags.some((tag) => tag?.toLowerCase() === 'ttt');
  }

  calendarRange():
    | {
        startIso: string;
        endIso: string;
        label?: string;
      }
    | null {
    if (!this.timetableYearBounds) {
      return null;
    }
    return {
      startIso: this.timetableYearBounds.startIso,
      endIso: this.timetableYearBounds.endIso,
      label: this.timetableYearBounds.label,
    };
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

  private initializeCustomCalendarState(targetYear: number) {
    const calendarDates = deriveDatesFromCalendar(this.plan.calendar);
    const filtered = this.filterDatesToTimetableYear(calendarDates, targetYear);
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
    const calendar = calendarFromCustomSelection(dates);
    this.form.patchValue(
      {
        validFrom: calendar.validFrom,
        validTo: calendar.validTo ?? calendar.validFrom,
        daysBitmap: calendar.daysBitmap,
      },
      { emitEvent: false },
    );
  }

  private filterDatesToTimetableYear(
    dates: string[],
    fallbackYear?: number,
  ): string[] {
    if (this.timetableYearBounds) {
      const bounds = this.timetableYearBounds;
      return dates.filter((date) =>
        this.timetableYearService.isDateWithinYear(date, bounds),
      );
    }
    if (fallbackYear) {
      const prefix = String(fallbackYear);
      return dates.filter((date) => date.startsWith(prefix));
    }
    return dates;
  }

  private calendarFromPeriod(periodId: string): TrainPlan['calendar'] {
    const period = this.trafficPeriodService.getById(periodId);
    if (!period) {
      throw new Error('Referenzkalender nicht gefunden.');
    }
    return calendarFromTrafficPeriod(period);
  }

  openAssemblyDialog() {
    const baseStops = this.previewStops().map((stop) => toTrainPlanStop(this.plan.id, stop));

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

  stopCount(): number {
    return this.previewStops().length;
  }

  startStopLabel(): string {
    const stops = this.previewStops();
    if (!stops.length) {
      return '–';
    }
    return stopLabel(stops[0], true);
  }

  endStopLabel(): string {
    const stops = this.previewStops();
    if (!stops.length) {
      return '–';
    }
    return stopLabel(stops[stops.length - 1], false);
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
      const stopIndex = resolveStopSequenceById(this.plan.stops, operation.stopId);
      this.addChangeEntry({
        action,
        stopIndex: stopIndex ?? null,
        vehicleType: operation.remarks ?? '',
        count: 1,
        note: operation.remarks ?? '',
      });
    });
  }

  createBaseVehicleGroup(seed?: {
    vehicleType?: string;
    count?: number;
    note?: string | null;
  }): CompositionBaseVehicleForm {
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

  createChangeEntryGroup(seed?: {
    stopIndex?: number | null;
    action?: 'attach' | 'detach';
    vehicleType?: string;
    count?: number;
    note?: string | null;
  }): CompositionChangeEntryForm {
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
    const baseEntries = this.baseVehicles.controls.map((group) => ({
      type: group.controls.vehicleType.value.trim(),
      count: group.controls.count.value ?? 0,
    }));
    const hasBase = baseEntries.some((entry) => entry.type && entry.count > 0);
    const baseInvalid = baseEntries.some((entry) => {
      if (!entry.type && entry.count <= 0) {
        return false;
      }
      return !entry.type || entry.count <= 0;
    });
    if (baseInvalid || (this.requiresRollingStock && !hasBase)) {
      this.baseVehicles.controls.forEach((group) => group.markAllAsTouched());
      this.errorMessage.set(
        this.requiresRollingStock
          ? 'Bitte mindestens ein Fahrzeug mit Typ und Anzahl erfassen.'
          : 'Bitte Typ und Anzahl für jedes Fahrzeug angeben.',
      );
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
          stopId: resolveStopIdBySequence({ planId: this.plan.id, stops: this.plan.stops, sequence: stopIndex }),
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

  private previewStops(): PlanModificationStopInput[] {
    if (this.assembledStops()) {
      return this.assembledStops() as PlanModificationStopInput[];
    }
    return this.plan.stops.map((stop) => mapPlanStop(stop));
  }

  private async handleLockedPlanModification(plan: TrainPlan, dates: string[]) {
    const normalizedDates = Array.from(new Set(dates)).sort();
    const segments = buildSegmentsFromDates(normalizedDates);
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
    await this.registerSubCalendarVariant(plan, normalizedDates);
    this.orderService.applyPlanModification({
      orderId: this.orderId,
      itemId: result.created.id,
      plan: {
        ...plan,
        trafficPeriodId: this.item.trafficPeriodId ?? plan.trafficPeriodId,
      },
    });
  }

  private async registerSubCalendarVariant(plan: TrainPlan, dates: string[]): Promise<void> {
    if (!this.item.trafficPeriodId || !dates.length) {
      return;
    }
    const periodId = this.item.trafficPeriodId;
    await this.trafficPeriodService.addVariantRule(periodId, {
      name: `${plan.title} · Unterkalender`,
      dates,
      variantType: 'special_day',
      appliesTo: 'both',
      reason: `Variante für ${plan.trainNumber}`,
    });
    await this.trafficPeriodService.addExclusionDates(periodId, dates);
  }
}
