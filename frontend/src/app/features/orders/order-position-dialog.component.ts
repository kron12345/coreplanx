import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  CreatePlanOrderItemsPayload,
  CreateServiceOrderItemPayload,
  ImportedRailMlStop,
  ImportedRailMlTemplateMatch,
  ImportedRailMlTrain,
  ImportedTemplateStopComparison,
  OrderService,
} from '../../core/services/order.service';
import { Order } from '../../core/models/order.model';
import { ScheduleTemplateService } from '../../core/services/schedule-template.service';
import {
  TrafficPeriodService,
  TrafficPeriodRulePayload,
} from '../../core/services/traffic-period.service';
import { TrafficPeriodVariantType } from '../../core/models/traffic-period.model';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { ScheduleTemplate, ScheduleTemplateStop } from '../../core/models/schedule-template.model';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { BusinessService } from '../../core/services/business.service';
import { ScheduleTemplateCreateDialogComponent } from '../schedule-templates/schedule-template-create-dialog.component';
import {
  OrderItemGeneralFieldsComponent,
  OrderItemGeneralLabels,
} from '../orders/shared/order-item-general-fields/order-item-general-fields.component';
import { OrderItemServiceFieldsComponent } from '../orders/shared/order-item-service-fields/order-item-service-fields.component';
import {
  PlanAssemblyDialogComponent,
  PlanAssemblyDialogData,
  PlanAssemblyDialogResult,
} from './plan-assembly-dialog/plan-assembly-dialog.component';
import { PlanModificationStopInput } from '../../core/services/train-plan.service';
import { TrainPlanStop } from '../../core/models/train-plan.model';
import { OrderPlanPreviewComponent } from './order-plan-preview/order-plan-preview.component';
import {
  PlanGenerationPreview,
  PlanTemplateStats,
} from './order-plan-preview/plan-preview.models';
import { OrderImportFiltersComponent } from './order-import-filters/order-import-filters.component';
import { ReferenceCalendarInlineFormComponent } from './reference-calendar-inline-form/reference-calendar-inline-form.component';
import { OrderItem } from '../../core/models/order-item.model';
import { BusinessTemplateAutomation } from '../../core/models/business-template.model';

interface OrderPositionDialogData {
  order: Order;
}

function nonEmptyDates(control: AbstractControl<string[] | null>): ValidationErrors | null {
  const value = control.value;
  if (Array.isArray(value) && value.length > 0) {
    return null;
  }
  return { required: true };
}

@Component({
  selector: 'app-order-position-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ...MATERIAL_IMPORTS,
    OrderItemGeneralFieldsComponent,
    OrderItemServiceFieldsComponent,
    OrderPlanPreviewComponent,
    OrderImportFiltersComponent,
    ReferenceCalendarInlineFormComponent,
  ],
  templateUrl: './order-position-dialog.component.html',
  styleUrl: './order-position-dialog.component.scss',
})
export class OrderPositionDialogComponent {
  private readonly tabModes: ReadonlyArray<'service' | 'plan' | 'manualPlan' | 'import'> = [
    'service',
    'plan',
    'manualPlan',
    'import',
  ];
  private readonly dialogRef = inject(MatDialogRef<OrderPositionDialogComponent>);
  private readonly data = inject<OrderPositionDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly orderService = inject(OrderService);
  private readonly templateService = inject(ScheduleTemplateService);
  private readonly trafficPeriodService = inject(TrafficPeriodService);
  private readonly timetableYearService = inject(TimetableYearService);
  private readonly businessTemplateService = inject(BusinessTemplateService);
  private readonly businessService = inject(BusinessService);
  private readonly dialog = inject(MatDialog);

  readonly modeControl = new FormControl<'service' | 'plan' | 'manualPlan' | 'import'>(
    'service',
    { nonNullable: true },
  );
  private readonly defaultTimetableYear = this.timetableYearService.defaultYearBounds();
  readonly defaultTimetableYearLabel = this.defaultTimetableYear.label;

  readonly serviceForm = this.fb.group({
    serviceType: ['', Validators.required],
    fromLocation: ['', Validators.required],
    toLocation: ['', Validators.required],
    start: ['', Validators.required],
    end: ['', Validators.required],
    calendarYear: this.fb.nonNullable.control(this.defaultTimetableYearLabel, {
      validators: [Validators.required],
    }),
    calendarDates: this.fb.nonNullable.control<string[]>([], {
      validators: [nonEmptyDates],
    }),
    calendarExclusions: this.fb.nonNullable.control<string[]>([]),
    deviation: [''],
    name: [''],
    tags: [''],
  });

  readonly planForm = this.fb.group({
    templateId: ['', Validators.required],
    startTime: ['04:00', Validators.required],
    endTime: ['23:00', Validators.required],
    intervalMinutes: [30, [Validators.required, Validators.min(1)]],
    namePrefix: [''],
    responsible: [''],
    otn: [''],
    otnInterval: [1, [Validators.min(1)]],
    calendarYear: this.fb.nonNullable.control(this.defaultTimetableYearLabel, {
      validators: [Validators.required],
    }),
    calendarDates: this.fb.nonNullable.control<string[]>([], {
      validators: [nonEmptyDates],
    }),
    calendarExclusions: this.fb.nonNullable.control<string[]>([]),
    tags: [''],
  });

  readonly manualPlanForm = this.fb.group({
    trainNumber: ['', Validators.required],
    name: [''],
    responsible: [''],
    tags: [''],
    calendarYear: this.fb.nonNullable.control(this.defaultTimetableYearLabel, {
      validators: [Validators.required],
    }),
    calendarDates: this.fb.nonNullable.control<string[]>([], {
      validators: [nonEmptyDates],
    }),
    calendarExclusions: this.fb.nonNullable.control<string[]>([]),
  });

  readonly importFilters = this.fb.group({
    search: [''],
    start: [''],
    end: [''],
    templateId: [''],
    irregularOnly: [false],
    minDeviation: [0],
    deviationSort: ['none'],
  });
  readonly importOptionsForm = this.fb.group({
    trafficPeriodId: [''],
    namePrefix: [''],
    responsible: [''],
    tags: [''],
  });

  readonly businessForm = this.fb.group({
    mode: this.fb.nonNullable.control<'none' | 'existing' | 'template'>('none'),
    existingBusinessId: [''],
    templateId: [''],
    customTitle: ['', [Validators.maxLength(120)]],
    note: ['', [Validators.maxLength(400)]],
    targetDate: [''],
    enableAutomations: this.fb.nonNullable.control(true),
    automationRuleIds: this.fb.nonNullable.control<string[]>([]),
  });

  readonly templates = computed(() => this.templateService.templates());
  readonly taktTemplates = computed(() =>
    this.templates().filter((template) => !!template.recurrence),
  );
  readonly trafficPeriods = computed(() => this.trafficPeriodService.periods());
  readonly businessTemplates = this.businessTemplateService.templates;
  readonly businessOptions = computed(() => this.businessService.businesses());
  readonly businessAutomations = this.businessTemplateService.automationRules;
  readonly mode = signal<'service' | 'plan' | 'manualPlan' | 'import'>(
    this.modeControl.value,
  );
  readonly manualTemplate = signal<PlanModificationStopInput[] | null>(null);
  readonly importError = signal<string | null>(null);
  readonly importedTrains = signal<ImportedRailMlTrain[]>([]);
  readonly selectedTrainIds = signal<Set<string>>(new Set());
  readonly expandedTrainIds = signal<Set<string>>(new Set());
  private readonly importFilterValues = signal<ImportFilterValues>({
    search: '',
    start: '',
    end: '',
    templateId: '',
    irregularOnly: false,
    minDeviation: 0,
    deviationSort: 'none',
  });
  readonly serviceFieldsConfig = {
    startControl: 'start',
    endControl: 'end',
    serviceTypeControl: 'serviceType',
    fromControl: 'fromLocation',
    toControl: 'toLocation',
  } as const;
  readonly serviceGeneralLabels: OrderItemGeneralLabels = {
    name: 'Positionsname (optional)',
    responsible: 'Verantwortlich (optional)',
    deviation: 'Bemerkung',
    tags: 'Tags (optional)',
  };
  readonly serviceGeneralDescriptions = {
    name: 'Optionaler Anzeigename. Ohne Eingabe wird der Leistungstyp als Name verwendet.',
    responsible: 'Wer führt die Leistung aus oder ist Ansprechpartner?',
    deviation: 'Kurze Notiz zu Besonderheiten, z. B. +3 min.',
    tags: 'Kommagetrennte Stichwörter, um Positionen zu gruppieren (z. B. rolling, premium).',
  } as const;
  readonly serviceFieldDescriptions = {
    start: 'Startuhrzeit der Leistung (HH:MM). Das Datum ergibt sich aus dem Referenzkalender.',
    end: 'Enduhrzeit. Liegt sie vor der Startzeit, wird automatisch der Folgetag verwendet.',
    serviceType: 'Art der Leistung, z. B. Werkstatt, Reinigung, Begleitung.',
    from: 'Ausgangsort oder Bereich, an dem die Leistung startet.',
    to: 'Zielort oder Bereich, an dem die Leistung endet.',
    trafficPeriod: 'Referenzkalender, in dem die Leistung gelten soll.',
  } as const;
  readonly manualGeneralLabels: OrderItemGeneralLabels = {
    name: 'Positionsname',
    responsible: 'Verantwortlich',
    deviation: 'Bemerkung',
    tags: 'Tags (optional)',
  };
  readonly manualGeneralDescriptions = {
    name: 'Titel der Fahrplanposition, z. B. Sonderzug 4711.',
    responsible: 'Verantwortliche Person oder Stelle für den Fahrplan.',
    deviation: 'Hinweise oder Abweichungen für den manuellen Fahrplan.',
    tags: 'Kommagetrennte Stichwörter für Filter & Automationen.',
  } as const;
  readonly planFieldDescriptions = {
    templateId: 'Vorlage mit Strecke und Zeiten, die für die Serie genutzt wird.',
    startTime: 'Erste Abfahrt am Tag der Serie (HH:MM).',
    endTime: 'Letzte Abfahrt am Tag der Serie (HH:MM).',
    intervalMinutes: 'Abstand zwischen den Zügen in Minuten.',
    namePrefix: 'Optionales Präfix für generierte Positionsnamen.',
    responsible: 'Verantwortlicher für die erzeugten Fahrpläne.',
    otn: 'Optionaler Startwert für die Zugnummer (OTN).',
    otnInterval: 'Differenz zwischen den OTN der nacheinander erzeugten Züge.',
    tags: 'Kommagetrennte Schlagwörter, die allen erzeugten Fahrplanpositionen hinzugefügt werden.',
  } as const;
  readonly manualFieldDescriptions = {
    trainNumber: 'Offizielle Zugnummer (OTN), unter der der Zug geführt wird.',
  } as const;
  readonly importOptionsDescriptions = {
    trafficPeriodId: 'Optional: überschreibt den aus der RailML-Datei erzeugten Referenzkalender.',
    namePrefix: 'Optionaler Zusatz für erzeugte Positionsnamen.',
    responsible: 'Verantwortliche Person für importierte Fahrpläne.',
    tags: 'Kommagetrennte Schlagwörter, die allen importierten Positionen hinzugefügt werden.',
  } as const;
  readonly importFilterDescriptions = {
    search: 'Suche nach Zugname oder ID innerhalb der importierten Datei.',
    start: 'Filtere nach Startort im RailML-Datensatz.',
    end: 'Filtere nach Zielort im RailML-Datensatz.',
    templateId: 'Beziehe den Vergleich nur auf eine bestimmte Vorlage mit Takt.',
    irregularOnly: 'Zeige nur Züge, die den erwarteten Takt der Vorlage verletzen.',
    minDeviation: 'Blendt Züge aus, deren größte Abweichung unter diesem Wert (Minuten) liegt.',
    deviationSort: 'Sortiert die Ergebnisliste nach der größten Abweichung.',
  } as const;

  readonly filteredTrains = computed(() => {
    const filters = this.importFilterValues();
    const trains = this.importedTrains();
    const search = filters.search.trim().toLowerCase();
    const startFilter = filters.start.trim().toLowerCase();
    const endFilter = filters.end.trim().toLowerCase();
    const templateFilter = filters.templateId.trim();
    const irregularOnly = filters.irregularOnly;
    const minDeviation = Math.max(0, Number(filters.minDeviation) || 0);
    return trains.filter((train) => {
      const matchesSearch =
        !search ||
        train.name.toLowerCase().includes(search) ||
        train.id.toLowerCase().includes(search);
      const matchesStart =
        !startFilter || train.start?.toLowerCase().includes(startFilter);
      const matchesEnd =
        !endFilter || train.end?.toLowerCase().includes(endFilter);
      const matchesTemplate =
        !templateFilter || train.templateMatch?.templateId === templateFilter;
      const matchesRegularity = !irregularOnly
        ? true
        : train.templateMatch?.status === 'warning';
      const deviationMagnitude = this.trainDeviationMagnitude(train);
      const matchesDeviation = deviationMagnitude >= minDeviation;
      return (
        matchesSearch &&
        matchesStart &&
        matchesEnd &&
        matchesTemplate &&
        matchesRegularity &&
        matchesDeviation
      );
    }).sort((a, b) => {
      const sort = filters.deviationSort;
      if (!sort || sort === 'none') {
        return 0;
      }
      const diff =
        this.trainDeviationMagnitude(b) - this.trainDeviationMagnitude(a);
      return sort === 'desc' ? diff : -diff;
    });
  });
  errorMessage = signal<string | null>(null);

  readonly order = this.data.order;

  get serviceCalendarYearControl(): FormControl<string> {
    return this.serviceForm.controls['calendarYear'] as FormControl<string>;
  }

  get serviceCalendarDatesControl(): FormControl<string[]> {
    return this.serviceForm.controls['calendarDates'] as FormControl<string[]>;
  }

  get serviceCalendarExclusionsControl(): FormControl<string[]> {
    return this.serviceForm.controls['calendarExclusions'] as FormControl<string[]>;
  }

  get planCalendarYearControl(): FormControl<string> {
    return this.planForm.controls['calendarYear'] as FormControl<string>;
  }

  get planCalendarDatesControl(): FormControl<string[]> {
    return this.planForm.controls['calendarDates'] as FormControl<string[]>;
  }

  get planCalendarExclusionsControl(): FormControl<string[]> {
    return this.planForm.controls['calendarExclusions'] as FormControl<string[]>;
  }

  get manualCalendarYearControl(): FormControl<string> {
    return this.manualPlanForm.controls['calendarYear'] as FormControl<string>;
  }

  get manualCalendarDatesControl(): FormControl<string[]> {
    return this.manualPlanForm.controls['calendarDates'] as FormControl<string[]>;
  }

  get manualCalendarExclusionsControl(): FormControl<string[]> {
    return this.manualPlanForm.controls['calendarExclusions'] as FormControl<string[]>;
  }

  manualEffectiveCount(): number {
    return this.resolveCalendarDates(
      this.manualCalendarDatesControl.value,
      this.manualCalendarExclusionsControl.value,
    ).length;
  }

  constructor() {
    const templateList = this.templateService.templates();

    const firstTemplate = templateList[0];

    if (firstTemplate) {
      this.planForm.controls.templateId.setValue(firstTemplate.id);
      this.planForm.controls.namePrefix.setValue(firstTemplate.title);
    }

    this.importFilterValues.set({
      search: '',
      start: '',
      end: '',
      templateId: '',
      irregularOnly: false,
      minDeviation: 0,
      deviationSort: 'none',
    });

    this.modeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.mode.set(value);
      this.errorMessage.set(null);
      if (value !== 'import') {
        this.importError.set(null);
      }
    });

    this.importFilters.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.importFilterValues.set({
          search: value?.search ?? '',
          start: value?.start ?? '',
          end: value?.end ?? '',
          templateId: value?.templateId ?? '',
          irregularOnly: !!value?.irregularOnly,
          minDeviation: Number(value?.minDeviation) || 0,
          deviationSort: (value?.deviationSort as 'none' | 'asc' | 'desc') ?? 'none',
        });
      });

    this.businessForm.controls.mode.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((mode) => {
        const existingControl = this.businessForm.controls.existingBusinessId;
        const templateControl = this.businessForm.controls.templateId;

        if (mode === 'existing') {
          existingControl.addValidators(Validators.required);
        } else {
          existingControl.removeValidators(Validators.required);
          existingControl.setValue('', { emitEvent: false });
        }
        existingControl.updateValueAndValidity({ emitEvent: false });

        if (mode === 'template') {
          templateControl.addValidators(Validators.required);
        } else {
          templateControl.removeValidators(Validators.required);
          templateControl.setValue('', { emitEvent: false });
          this.businessForm.patchValue(
            {
              customTitle: '',
              note: '',
              targetDate: '',
              automationRuleIds: [],
              enableAutomations: true,
            },
            { emitEvent: false },
          );
        }
        templateControl.updateValueAndValidity({ emitEvent: false });
        this.errorMessage.set(null);
      });

    this.businessForm.controls.templateId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.businessForm.controls.automationRuleIds.setValue([], { emitEvent: false });
        this.errorMessage.set(null);
      });
  }

  onImportFiltersReset() {
    this.importFilters.reset({
      search: '',
      start: '',
      end: '',
      templateId: '',
      irregularOnly: false,
      minDeviation: 0,
      deviationSort: 'none',
    });
    this.importFilterValues.set({
      search: '',
      start: '',
      end: '',
      templateId: '',
      irregularOnly: false,
      minDeviation: 0,
      deviationSort: 'none',
    });
  }

  modeIndex(): number {
    const idx = this.tabModes.indexOf(this.modeControl.value);
    return idx === -1 ? 0 : idx;
  }

  onModeTabChange(index: number) {
    const nextMode = this.tabModes[index] ?? 'service';
    if (this.modeControl.value !== nextMode) {
      this.modeControl.setValue(nextMode);
    }
  }

  openTemplateCreateDialog() {
    const dialogRef = this.dialog.open(ScheduleTemplateCreateDialogComponent, {
      width: '95vw',
      maxWidth: '1200px',
    });

    dialogRef.afterClosed().subscribe((payload) => {
      if (!payload) {
        return;
      }

      const template = this.templateService.createTemplate(payload);

      this.planForm.controls.templateId.setValue(template.id);
      if (!this.planForm.controls.namePrefix.value) {
        this.planForm.controls.namePrefix.setValue(template.title);
      }
      if (!this.planForm.controls.responsible.value) {
        this.planForm.controls.responsible.setValue(template.responsibleRu);
      }
      this.errorMessage.set(null);
      const currentTrains = this.importedTrains();
      if (currentTrains.length) {
        this.importedTrains.set(this.applyTemplateMatching(currentTrains));
      }
    });
  }

  openManualPlanAssembly() {
    const dialogRef = this.dialog.open<
      PlanAssemblyDialogComponent,
      PlanAssemblyDialogData,
      PlanAssemblyDialogResult | undefined
    >(PlanAssemblyDialogComponent, {
      width: '1320px',
      maxWidth: '95vw',
      maxHeight: 'calc(100vh - 48px)',
      panelClass: 'plan-assembly-dialog-panel',
      data: {
        stops: this.manualAssemblyInputStops(),
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.stops?.length) {
        this.manualTemplate.set(result.stops);
        this.errorMessage.set(null);
      }
    });
  }

  clearManualTemplate() {
    this.manualTemplate.set(null);
  }

  cancel() {
    this.dialogRef.close();
  }

  save() {
    this.errorMessage.set(null);

    if (this.mode() === 'service') {
      if (this.serviceForm.invalid) {
        this.serviceForm.markAllAsTouched();
        return;
      }
      this.createServiceItem();
    } else if (this.mode() === 'plan') {
      if (this.planForm.invalid) {
        this.planForm.markAllAsTouched();
        return;
      }
      this.createPlanItems();
    } else if (this.mode() === 'manualPlan') {
      const stops = this.manualTemplate();
      if (!stops || !stops.length) {
        this.errorMessage.set('Bitte zuerst einen Fahrplan zusammenstellen.');
        return;
      }
      if (this.manualPlanForm.invalid) {
        this.manualPlanForm.markAllAsTouched();
        return;
      }
      this.createManualPlanItem();
    } else {
      this.createImportedPlanItems();
    }
  }

  private createServiceItem() {
    const value = this.serviceForm.getRawValue();
    const serviceType = value.serviceType?.trim();
    if (!serviceType) {
      this.errorMessage.set('Bitte einen Leistungstyp angeben.');
      return;
    }

    const startMinutes = this.parseTimeToMinutes(value.start);
    const endMinutes = this.parseTimeToMinutes(value.end);
    if (startMinutes === null || endMinutes === null) {
      this.errorMessage.set('Bitte Zeiten im Format HH:MM angeben.');
      return;
    }

    const selectedDates = this.resolveCalendarDates(
      value.calendarDates,
      value.calendarExclusions,
    );
    if (!selectedDates.length) {
      this.errorMessage.set('Bitte mindestens einen Kalendertag auswählen.');
      this.serviceForm.controls.calendarDates.markAsTouched();
      return;
    }
    try {
      this.timetableYearService.ensureDatesWithinSameYear(selectedDates);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ungültiges Fahrplanjahr.';
      this.errorMessage.set(message);
      return;
    }

    const endOffsetDays = endMinutes < startMinutes ? 1 : 0;

    const fromLocation = value.fromLocation?.trim();
    const toLocation = value.toLocation?.trim();
    if (!fromLocation || !toLocation) {
      this.errorMessage.set('Bitte Herkunft und Ziel angeben.');
      return;
    }

    if (!this.ensureBusinessSelectionValid()) {
      return;
    }

    const itemTags = this.parseTagsInput(value.tags);
    const createdItems: OrderItem[] = [];
    try {
      for (const date of selectedDates) {
        const start = this.buildIsoFromMinutes(date, startMinutes);
        const end = this.buildIsoFromMinutes(date, endMinutes, endOffsetDays);
        if (!start || !end) {
          throw new Error('Start/Ende konnten nicht berechnet werden.');
        }
        const trafficPeriodId = this.trafficPeriodService.createSingleDayPeriod({
          name: `${serviceType} ${date}`,
          date,
          variantType: 'special_day',
          tags: this.buildArchiveGroupTags(
            `${this.order.id}:service:${this.slugify(serviceType)}`,
            serviceType,
            'service',
          ),
        });
        if (!trafficPeriodId) {
          throw new Error('Referenzkalender konnte nicht erstellt werden.');
        }
        const payload: CreateServiceOrderItemPayload = {
          orderId: this.order.id,
          serviceType,
          fromLocation,
          toLocation,
          start,
          end,
          trafficPeriodId,
          deviation: value.deviation?.trim() || undefined,
          name: value.name?.trim() || undefined,
          timetableYearLabel: value.calendarYear ?? undefined,
          tags: itemTags,
        };
        const item = this.orderService.addServiceOrderItem(payload);
        createdItems.push(item);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      this.errorMessage.set(message);
      return;
    }

    if (!this.applyBusinessLink(createdItems)) {
      return;
    }

    this.dialogRef.close(true);
  }

  private createManualPlanItem() {
    const stops = this.manualTemplate();
    if (!stops?.length) {
      this.errorMessage.set('Bitte zuerst einen Fahrplan zusammenstellen.');
      return;
    }

    const value = this.manualPlanForm.getRawValue();
    const selectedDates = this.resolveCalendarDates(
      value.calendarDates,
      value.calendarExclusions,
    );
    if (!selectedDates.length) {
      this.errorMessage.set('Bitte mindestens einen Kalendertag auswählen.');
      this.manualPlanForm.controls.calendarDates.markAsTouched();
      return;
    }

    const trainNumber = value.trainNumber?.trim();
    if (!trainNumber) {
      this.errorMessage.set('Bitte eine Zugnummer angeben.');
      return;
    }

    if (!this.ensureBusinessSelectionValid()) {
      return;
    }

    try {
      const sortedDates = [...selectedDates].sort();
      const departure = new Date(`${sortedDates[0]}T00:00:00`);
      if (Number.isNaN(departure.getTime())) {
        throw new Error('Bitte ein gültiges Datum wählen.');
      }
      const responsible = value.responsible?.trim() || undefined;
      const planName = value.name?.trim() || undefined;
      const yearInfo = this.timetableYearService.ensureDatesWithinSameYear(sortedDates);
      const groupId = `${this.order.id}:manual:${this.slugify(trainNumber)}`;
      const periodTags = this.buildArchiveGroupTags(
        groupId,
        planName ?? this.order.name ?? 'Manueller Fahrplan',
        'manual',
      );
      const itemTags = this.parseTagsInput(value.tags);
      const trafficPeriodId = this.createManualTrafficPeriod({
        baseName: planName ?? 'Manueller Fahrplan',
        dates: sortedDates,
        responsible,
        tags: periodTags,
        timetableYearLabel: yearInfo.label,
      });
      if (!trafficPeriodId) {
        throw new Error('Referenzkalender konnte nicht erstellt werden.');
      }
      const payload = {
        orderId: this.order.id,
        departure: departure.toISOString(),
        stops,
        trainNumber,
        name: planName,
        responsible,
        trafficPeriodId,
        validFrom: sortedDates[0],
        validTo: sortedDates[sortedDates.length - 1],
        daysBitmap: this.buildDaysBitmapFromDates(sortedDates),
        timetableYearLabel: yearInfo.label,
        tags: itemTags,
      };
      const item = this.orderService.addManualPlanOrderItem(payload);
      if (!this.applyBusinessLink([item])) {
        return;
      }
      this.dialogRef.close(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      this.errorMessage.set(message);
    }
  }
  private createImportedPlanItems() {
    const trains = this.importedTrains();
    const selected = this.selectedTrainIds();
    if (!trains.length || !selected.size) {
      this.errorMessage.set('Bitte mindestens einen Zug auswählen.');
      return;
    }

    const items = trains.filter((train) => selected.has(train.id));
    if (!items.length) {
      this.errorMessage.set('Bitte mindestens einen Zug auswählen.');
      return;
    }

    if (!this.ensureBusinessSelectionValid()) {
      return;
    }

    const options = this.importOptionsForm.getRawValue();
    const namePrefix = options.namePrefix?.trim();
    const responsible = options.responsible?.trim() || undefined;
    const overridePeriodId = options.trafficPeriodId?.trim() || undefined;
    const itemTags = this.parseTagsInput(options.tags);

    try {
      const periodAssignments =
        overridePeriodId || !items.length ? null : this.ensureCalendarsForImportedTrains(items);
      const missingPeriods: string[] = [];
      const payloads: Array<{ train: ImportedRailMlTrain; trafficPeriodId: string }> = [];

      items.forEach((train) => {
        const groupKey = train.groupId ?? train.id;
        const effectivePeriodId =
          overridePeriodId ??
          periodAssignments?.get(groupKey) ??
          train.trafficPeriodId;
        if (!effectivePeriodId) {
          missingPeriods.push(train.name ?? train.id);
          return;
        }
        payloads.push({ train, trafficPeriodId: effectivePeriodId });
      });

      if (missingPeriods.length) {
        this.errorMessage.set(
          `Für folgende Züge konnte kein Referenzkalender bestimmt werden: ${missingPeriods
            .slice(0, 5)
            .join(', ')}${missingPeriods.length > 5 ? ' …' : ''}`,
        );
        return;
      }

      const orderedPayloads: Array<{ train: ImportedRailMlTrain; trafficPeriodId: string }> = [];
      payloads.forEach((entry) => {
        if (!entry.train.variantOf) {
          orderedPayloads.push(entry);
        }
      });
      payloads.forEach((entry) => {
        if (entry.train.variantOf) {
          orderedPayloads.push(entry);
        }
      });

      const createdItemIds = new Map<string, string>();
      const groupRootIds = new Map<string, string>();

      const createdItems: OrderItem[] = [];
      orderedPayloads.forEach(({ train, trafficPeriodId }) => {
        let parentItemId: string | undefined;
        if (train.variantOf) {
          parentItemId =
            createdItemIds.get(train.variantOf) ??
            (train.groupId ? groupRootIds.get(train.groupId) : undefined);
        }
        const item = this.orderService.addImportedPlanOrderItem({
          orderId: this.order.id,
          train,
          trafficPeriodId,
          responsible,
          namePrefix,
          parentItemId,
          timetableYearLabel: train.timetableYearLabel,
          tags: itemTags,
        });
        createdItemIds.set(train.id, item.id);
        if (!train.variantOf) {
          groupRootIds.set(train.groupId ?? train.id, item.id);
        }
        createdItems.push(item);
      });

      if (!this.applyBusinessLink(createdItems)) {
        return;
      }

      this.dialogRef.close(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      this.errorMessage.set(message);
    }
  }

  private createPlanItems() {
    const value = this.planForm.getRawValue();
    const selectedDates = this.resolveCalendarDates(
      value.calendarDates,
      value.calendarExclusions,
    );
    if (!selectedDates.length) {
      this.errorMessage.set('Bitte mindestens einen Kalendertag auswählen.');
      this.planForm.controls.calendarDates.markAsTouched();
      return;
    }
    const startMinutes = this.parseTimeToMinutes(value.startTime);
    const endMinutes = this.parseTimeToMinutes(value.endTime);
    const interval = value.intervalMinutes ?? 0;

    if (startMinutes === null || endMinutes === null) {
      this.errorMessage.set('Bitte gültige Start- und Endzeiten im Format HH:MM angeben.');
      return;
    }

    if (startMinutes < 4 * 60 || endMinutes > 23 * 60) {
      this.errorMessage.set('Bitte Zeiten zwischen 04:00 und 23:00 Uhr wählen.');
      return;
    }

    if (endMinutes <= startMinutes) {
      this.errorMessage.set('Die Endzeit muss nach der Startzeit liegen.');
      return;
    }

    if (!interval || interval < 1) {
      this.errorMessage.set('Bitte einen gültigen Takt angeben.');
      return;
    }

    let count = 0;
    for (let current = startMinutes; current <= endMinutes; current += interval) {
      count += 1;
    }

    if (count <= 0) {
      this.errorMessage.set('Es konnte kein Zug im angegebenen Zeitraum erzeugt werden.');
      return;
    }

    const otnValue = value.otn?.toString().trim();
    let trainNumberStart: number | undefined;
    let trainNumberInterval: number | undefined;
    if (otnValue) {
      const parsedBase = Number.parseInt(otnValue, 10);
      if (Number.isNaN(parsedBase)) {
        this.errorMessage.set('Bitte eine gültige Zugnummer (OTN) angeben.');
        return;
      }
      trainNumberStart = parsedBase;
      const intervalRaw = Number(value.otnInterval ?? 1);
      if (!Number.isFinite(intervalRaw) || intervalRaw < 1) {
        this.errorMessage.set('Bitte ein gültiges OTN-Intervall ≥ 1 angeben.');
        return;
      }
      trainNumberInterval = Math.floor(intervalRaw);
    }

    if (!this.ensureBusinessSelectionValid()) {
      return;
    }

    const planPayload: CreatePlanOrderItemsPayload = {
      orderId: this.order.id,
      templateId: value.templateId!,
      startTime: value.startTime!,
      intervalMinutes: value.intervalMinutes!,
      departuresPerDay: count,
      calendarDates: selectedDates,
      namePrefix: value.namePrefix?.trim() || undefined,
      responsible: value.responsible?.trim() || undefined,
      responsibleRu: value.responsible?.trim() || undefined,
      timetableYearLabel: value.calendarYear ?? undefined,
      tags: this.parseTagsInput(value.tags),
    };

    if (trainNumberStart !== undefined) {
      planPayload.trainNumberStart = trainNumberStart;
      planPayload.trainNumberInterval = trainNumberInterval;
    }

    try {
      const items = this.orderService.addPlanOrderItems(planPayload);
      if (!items.length) {
        this.errorMessage.set('Es konnten keine Auftragspositionen erzeugt werden.');
        return;
      }
      if (!this.applyBusinessLink(items)) {
        return;
      }
      this.dialogRef.close(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      this.errorMessage.set(message);
    }
  }

  private manualAssemblyInputStops(): TrainPlanStop[] {
    const stops = this.manualTemplate();
    if (stops?.length) {
      return this.manualStopsToPlanStops(stops);
    }
    return this.defaultManualStops();
  }

  private manualStopsToPlanStops(stops: PlanModificationStopInput[]): TrainPlanStop[] {
    return stops.map((stop, index) => ({
      id: `MANUAL-ST-${String(index + 1).padStart(3, '0')}`,
      sequence: index + 1,
      type: stop.type,
      locationName: stop.locationName || `Ort ${index + 1}`,
      locationCode: stop.locationCode || `LOC-${index + 1}`,
      countryCode: stop.countryCode,
      arrivalTime: stop.arrivalTime || undefined,
      departureTime: stop.departureTime || undefined,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities:
        stop.activities && stop.activities.length ? [...stop.activities] : ['0001'],
      platform: stop.platform,
      notes: stop.notes,
    }));
  }

  private resolveCalendarDates(
    include: readonly string[] | null | undefined,
    exclusions?: readonly string[] | null | undefined,
  ): string[] {
    const includeSet = new Set(
      (include ?? []).map((date) => date?.trim()).filter((date): date is string => !!date),
    );
    if (!includeSet.size) {
      return [];
    }
    if (!exclusions?.length) {
      return Array.from(includeSet).sort();
    }
    const exclusionSet = new Set(
      exclusions.map((date) => date?.trim()).filter((date): date is string => !!date),
    );
    return Array.from(includeSet)
      .filter((date) => !exclusionSet.has(date))
      .sort();
  }

  private parseTagsInput(value: string | null | undefined): string[] | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length);
    return tags.length ? Array.from(new Set(tags)) : undefined;
  }

  private createManualTrafficPeriod(options: {
    baseName: string;
    dates: string[];
    responsible?: string;
    tags: string[];
    timetableYearLabel?: string;
  }): string {
    if (!options.dates.length) {
      return '';
    }
    const baseName = options.baseName?.trim() || 'Manueller Fahrplan';
    const sortedDates = [...new Set(options.dates)].sort();
    const yearInfo = options.timetableYearLabel
      ? this.timetableYearService.getYearByLabel(options.timetableYearLabel)
      : this.timetableYearService.ensureDatesWithinSameYear(sortedDates);
    const grouped = this.groupDatesByYear(sortedDates);
    const groupedEntries = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
    if (groupedEntries.length > 1) {
      throw new Error('Die Fahrtage erstrecken sich über mehrere Fahrplanjahre. Bitte separate Auftragspositionen anlegen.');
    }
    const firstYear = groupedEntries[0]?.[0] ?? yearInfo.startYear;
    const rules: TrafficPeriodRulePayload[] = groupedEntries.map(([year, dates], index) => ({
      name: `${baseName} ${year}`,
      year,
      selectedDates: dates,
      variantType: 'special_day',
      variantNumber: String(index + 1).padStart(2, '0'),
      appliesTo: 'both',
      primary: index === 0,
    }));
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];
    const rangeLabel = firstDate === lastDate ? firstDate : `${firstDate} - ${lastDate}`;
    const periodName = `${baseName} ${rangeLabel}`;
    return this.trafficPeriodService.createPeriod({
      name: periodName,
      type: 'special',
      responsible: options.responsible,
      year: firstYear,
      rules,
      timetableYearLabel: yearInfo.label,
      tags: options.tags.length ? options.tags : undefined,
    });
  }

  private groupDatesByYear(dates: string[]): Map<number, string[]> {
    const groups = new Map<number, string[]>();
    dates.forEach((date) => {
      const normalized = date?.trim();
      if (!normalized) {
        return;
      }
      const year = Number.parseInt(normalized.slice(0, 4), 10);
      const safeYear = Number.isNaN(year)
        ? this.defaultTimetableYear.startYear
        : year;
      const list = groups.get(safeYear) ?? [];
      list.push(normalized);
      groups.set(safeYear, list);
    });
    groups.forEach((list, year) => {
      const deduped = Array.from(new Set(list)).sort();
      groups.set(year, deduped);
    });
    return groups;
  }

  private buildDaysBitmapFromDates(dates: string[]): string {
    if (!dates.length) {
      return '1111111';
    }
    const bitmap = Array(7).fill('0');
    let hasValidDate = false;
    dates.forEach((date) => {
      const parsed = new Date(`${date}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        return;
      }
      hasValidDate = true;
      const weekday = parsed.getDay();
      const index = weekday === 0 ? 6 : weekday - 1;
      bitmap[index] = '1';
    });
    return hasValidDate ? bitmap.join('') : '1111111';
  }

  trafficPeriodName(periodId: string | null | undefined): string | null {
    if (!periodId) {
      return null;
    }
    return this.trafficPeriodService.getById(periodId)?.name ?? null;
  }

  trackByTrainId(_index: number, train: ImportedRailMlTrain): string {
    return train.id;
  }

  stopTimeLabel(stop: ImportedRailMlStop, type: 'arrival' | 'departure'): string {
    const earliest =
      type === 'arrival' ? stop.arrivalEarliest : stop.departureEarliest;
    const latest =
      type === 'arrival' ? stop.arrivalLatest : stop.departureLatest;
    if (earliest && latest && earliest !== latest) {
      return `${earliest} · ${latest}`;
    }
    return earliest ?? latest ?? '—';
  }

  private trainDeviationMagnitude(train: ImportedRailMlTrain): number {
    const match = train.templateMatch;
    if (!match) {
      return 0;
    }
    const candidates = [
      match.deviationMinutes,
      match.arrivalDeviationMinutes,
      match.travelTimeDeviationMinutes,
      match.maxStopDeviationMinutes,
    ]
      .filter((value): value is number => typeof value === 'number')
      .map((value) => Math.abs(value));
    return candidates.length ? Math.max(...candidates) : 0;
  }

  hasDeviation(value: number | null | undefined): boolean {
    return typeof value === 'number' && Math.abs(value) > 0.01;
  }

  stopHasDeviation(comparison: ImportedTemplateStopComparison): boolean {
    return (
      this.hasDeviation(comparison.arrivalDeviationMinutes) ||
      this.hasDeviation(comparison.departureDeviationMinutes)
    );
  }

  selectedTemplate(): ScheduleTemplate | undefined {
    const templateId = this.planForm.controls.templateId.value;
    if (!templateId) {
      return undefined;
    }
    return this.templates().find((tpl) => tpl.id === templateId);
  }

  planPreview(): PlanGenerationPreview {
    const template = this.selectedTemplate();
    const value = this.planForm.getRawValue();
    const startMinutes = this.parseTimeToMinutes(value.startTime);
    const endMinutes = this.parseTimeToMinutes(value.endTime);
    const interval = Number(value.intervalMinutes) || 0;
    const warnings: string[] = [];

    if (!template) {
      warnings.push('Bitte eine Vorlage auswählen, um die Serie vorzubereiten.');
    }
    if (startMinutes === null || endMinutes === null) {
      warnings.push('Gültige Start- und Endzeiten angeben.');
    }
    if (interval <= 0) {
      warnings.push('Der Takt muss größer als 0 sein.');
    }

    let totalDepartures = 0;
    let sampleDepartures: string[] = [];
    const ready =
      warnings.length === 0 &&
      startMinutes !== null &&
      endMinutes !== null &&
      interval > 0 &&
      endMinutes > startMinutes &&
      !!template;

    if (!ready && startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      warnings.push('Die letzte Abfahrt muss nach der ersten Abfahrt liegen.');
    }

    if (ready && startMinutes !== null && endMinutes !== null) {
      for (let current = startMinutes; current <= endMinutes; current += interval) {
        totalDepartures += 1;
        if (sampleDepartures.length < 4) {
          sampleDepartures.push(this.minutesToTime(current) ?? '--:--');
        }
      }
    } else {
      sampleDepartures = [];
    }

    const otnValue = value.otn ? Number(value.otn) : null;
    const otnInterval = Number(value.otnInterval) || 1;
    const otnRange =
      ready && otnValue !== null && totalDepartures > 0
        ? `${otnValue} – ${otnValue + (totalDepartures - 1) * otnInterval}`
        : undefined;

    const durationMinutes =
      ready && startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : 0;
    const durationLabel =
      ready && durationMinutes > 0 ? this.formatDuration(durationMinutes) : undefined;

    return {
      ready,
      warnings,
      totalDepartures,
      durationMinutes,
      durationLabel,
      firstDeparture: value.startTime || undefined,
      lastDeparture: value.endTime || undefined,
      sampleDepartures,
      otnRange,
    };
  }

  planTemplateStats(template: ScheduleTemplate | undefined): PlanTemplateStats | null {
    if (!template) {
      return null;
    }
    const stops = template.stops;
    if (!stops.length) {
      return null;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const travelMinutes = this.estimateTemplateTravelMinutes(template);
    return {
      origin: first.locationName ?? first.locationCode,
      destination: last.locationName ?? last.locationCode,
      stopCount: stops.length,
      travelMinutes: travelMinutes ?? undefined,
      travelLabel: travelMinutes ? this.formatDuration(travelMinutes) : undefined,
      stopNames: stops.map((stop) => stop.locationName ?? stop.locationCode),
    };
  }

  private applyTemplateMatching(trains: ImportedRailMlTrain[]): ImportedRailMlTrain[] {
    const templates = this.taktTemplates();
    if (!templates.length) {
      return trains;
    }
    return trains.map((train) => ({
      ...train,
      templateMatch: this.findTemplateMatch(train, templates),
    }));
  }

  private findTemplateMatch(
    train: ImportedRailMlTrain,
    templates: ScheduleTemplate[],
  ): ImportedRailMlTemplateMatch | undefined {
    if (!train.stops.length || !train.departureTime) {
      return undefined;
    }
    const departureMinutes = this.parseTimeToMinutes(train.departureTime);
    if (departureMinutes === null) {
      return undefined;
    }
    const trainStartKey = this.normalizeStopKey(
      train.stops[0].locationCode,
      train.stops[0].locationName,
    );
    const trainEndKey = this.normalizeStopKey(
      train.stops[train.stops.length - 1].locationCode,
      train.stops[train.stops.length - 1].locationName,
    );
    if (!trainStartKey || !trainEndKey) {
      return undefined;
    }

    let best: ImportedRailMlTemplateMatch | null = null;

    templates.forEach((template) => {
      const recurrence = template.recurrence;
      if (!recurrence?.intervalMinutes || !template.stops.length) {
        return;
      }
      const templateStartKey = this.normalizeStopKey(
        template.stops[0].locationCode,
        template.stops[0].locationName,
      );
      const templateEndKey = this.normalizeStopKey(
        template.stops[template.stops.length - 1].locationCode,
        template.stops[template.stops.length - 1].locationName,
      );
      if (!templateStartKey || !templateEndKey) {
        return;
      }
      if (trainStartKey !== templateStartKey || trainEndKey !== templateEndKey) {
        return;
      }
      const startMinutes = this.parseTimeToMinutes(recurrence.startTime);
      const endMinutes = this.parseTimeToMinutes(recurrence.endTime);
      if (startMinutes === null || endMinutes === null) {
        return;
      }
      const expected = this.closestRecurrenceDeparture(
        departureMinutes,
        startMinutes,
        endMinutes,
        recurrence.intervalMinutes,
      );
      const deviation = departureMinutes - expected;
      const templateBaseDeparture = this.templateStopTime(
        template.stops[0],
        'departure',
      );
      const templateBaseMinutes = this.parseTimeToMinutes(templateBaseDeparture ?? null);
      const offsetMinutes =
        templateBaseMinutes !== null ? expected - templateBaseMinutes : 0;
      const tolerance = Math.max(2, Math.round(recurrence.intervalMinutes * 0.25));
      const status: 'ok' | 'warning' =
        Math.abs(deviation) <= tolerance ? 'ok' : 'warning';
      const comparisons = this.buildStopComparisons(
        train.stops,
        template.stops,
        offsetMinutes,
      );
      const sharedStops = comparisons.filter((comp) => comp.matched).length;
      const stopDelta = Math.abs(train.stops.length - template.stops.length);
      const baseScore = 10 + sharedStops - stopDelta * 0.5;
      const maxStopDeviation = this.maxStopDeviation(comparisons);
      const timePenalty =
        Math.abs(deviation) / Math.max(1, tolerance) +
        (maxStopDeviation ? Math.abs(maxStopDeviation) / 10 : 0);
      const matchScore = baseScore - timePenalty;
      const arrivalDeviation = this.compareTerminalArrival(
        train,
        template,
        offsetMinutes,
      );
      const travelDeviation = this.compareTravelTime(train, template);
      if (!best || matchScore > best.matchScore) {
        best = {
          templateId: template.id,
          templateTitle: template.title,
          templateTrainNumber: template.trainNumber,
          intervalMinutes: recurrence.intervalMinutes,
          expectedDeparture: this.minutesToTime(expected),
          deviationMinutes: deviation,
          deviationLabel: this.formatDeviationLabel(deviation),
          toleranceMinutes: tolerance,
          status,
          matchScore,
          arrivalDeviationMinutes: arrivalDeviation ?? undefined,
          arrivalDeviationLabel:
            arrivalDeviation !== null && arrivalDeviation !== undefined
              ? this.formatDeviationLabel(arrivalDeviation)
              : undefined,
          travelTimeDeviationMinutes: travelDeviation ?? undefined,
          travelTimeDeviationLabel:
            travelDeviation !== null && travelDeviation !== undefined
              ? this.formatDeviationLabel(travelDeviation)
              : undefined,
          maxStopDeviationMinutes: maxStopDeviation ?? undefined,
          maxStopDeviationLabel:
            maxStopDeviation !== null && maxStopDeviation !== undefined
              ? this.formatDeviationLabel(maxStopDeviation)
              : undefined,
          stopComparisons: comparisons,
        };
      }
    });

    return best ?? undefined;
  }

  private normalizeStopKey(code?: string | null, name?: string | null): string {
    return (code ?? name ?? '').trim().toLowerCase();
  }

  private buildStopComparisons(
    trainStops: ImportedRailMlStop[],
    templateStops: ScheduleTemplateStop[],
    offsetMinutes: number,
  ): ImportedTemplateStopComparison[] {
    const actualByKey = new Map<string, ImportedRailMlStop>();
    trainStops.forEach((stop) => {
      const key = this.normalizeStopKey(stop.locationCode, stop.locationName);
      if (key && !actualByKey.has(key)) {
        actualByKey.set(key, stop);
      }
    });

    return templateStops.map((templateStop) => {
      const key = this.normalizeStopKey(templateStop.locationCode, templateStop.locationName);
      const actual = key ? actualByKey.get(key) : undefined;
      const templateArrival = this.templateStopTime(templateStop, 'arrival');
      const templateDeparture = this.templateStopTime(templateStop, 'departure');
      const actualArrival = actual ? this.importedStopTime(actual, 'arrival') : undefined;
      const actualDeparture = actual ? this.importedStopTime(actual, 'departure') : undefined;
      const arrivalDeviation = this.differenceBetweenTimes(
        actualArrival,
        templateArrival,
        offsetMinutes,
      );
      const departureDeviation = this.differenceBetweenTimes(
        actualDeparture,
        templateDeparture,
        offsetMinutes,
      );

      return {
        locationCode: templateStop.locationCode,
        locationName: templateStop.locationName ?? templateStop.locationCode,
        type: templateStop.type,
        templateArrival,
        templateDeparture,
        alignedTemplateArrival: this.shiftTimeLabel(templateArrival, offsetMinutes),
        alignedTemplateDeparture: this.shiftTimeLabel(templateDeparture, offsetMinutes),
        actualArrival,
        actualDeparture,
        arrivalDeviationMinutes: arrivalDeviation ?? undefined,
        arrivalDeviationLabel:
          arrivalDeviation !== null && arrivalDeviation !== undefined
            ? this.formatDeviationLabel(arrivalDeviation)
            : undefined,
        departureDeviationMinutes: departureDeviation ?? undefined,
        departureDeviationLabel:
          departureDeviation !== null && departureDeviation !== undefined
            ? this.formatDeviationLabel(departureDeviation)
            : undefined,
        matched: !!actual,
      };
    });
  }

  private maxStopDeviation(comparisons: ImportedTemplateStopComparison[]): number | null {
    let max: number | null = null;
    comparisons.forEach((comparison) => {
      const arrival = comparison.arrivalDeviationMinutes ?? null;
      const departure = comparison.departureDeviationMinutes ?? null;
      [arrival, departure].forEach((value) => {
        if (value === null || value === undefined) {
          return;
        }
        const abs = Math.abs(value);
        if (max === null || abs > Math.abs(max)) {
          max = value;
        }
      });
    });
    return max;
  }

  private compareTerminalArrival(
    train: ImportedRailMlTrain,
    template: ScheduleTemplate,
    offsetMinutes: number,
  ): number | null {
    const actualArrival =
      this.importedStopTime(train.stops[train.stops.length - 1], 'arrival') ?? train.arrivalTime;
    const templateArrival = this.templateStopTime(
      template.stops[template.stops.length - 1],
      'arrival',
    );
    return this.differenceBetweenTimes(actualArrival, templateArrival, offsetMinutes);
  }

  private compareTravelTime(
    train: ImportedRailMlTrain,
    template: ScheduleTemplate,
  ): number | null {
    const actualDeparture =
      this.importedStopTime(train.stops[0], 'departure') ?? train.departureTime;
    const actualArrival =
      this.importedStopTime(train.stops[train.stops.length - 1], 'arrival') ?? train.arrivalTime;
    const templateDeparture = this.templateStopTime(template.stops[0], 'departure');
    const templateArrival = this.templateStopTime(
      template.stops[template.stops.length - 1],
      'arrival',
    );

    const actualTime = this.durationBetweenTimes(actualDeparture, actualArrival);
    const templateTime = this.durationBetweenTimes(templateDeparture, templateArrival);
    if (actualTime === null || templateTime === null) {
      return null;
    }
    return actualTime - templateTime;
  }

  private closestRecurrenceDeparture(
    departure: number,
    startMinutes: number,
    endMinutes: number,
    interval: number,
  ): number {
    if (interval <= 0) {
      return departure;
    }
    if (departure <= startMinutes) {
      return startMinutes;
    }
    if (departure >= endMinutes) {
      return endMinutes;
    }
    const steps = Math.round((departure - startMinutes) / interval);
    const candidate = startMinutes + steps * interval;
    return Math.max(startMinutes, Math.min(endMinutes, candidate));
  }

  private minutesToTime(value: number | null | undefined): string | undefined {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return undefined;
    }
    const totalMinutes = Math.round(value);
    const minutesInDay = 24 * 60;
    const normalized =
      ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
    const hours = Math.floor(normalized / 60);
    const mins = normalized % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  private formatDeviationLabel(deviation: number): string {
    const prefix = deviation > 0 ? '+' : '';
    return `${prefix}${deviation} min`;
  }

  private templateStopTime(
    stop: ScheduleTemplateStop,
    type: 'arrival' | 'departure',
  ): string | undefined {
    const window = type === 'arrival' ? stop.arrival : stop.departure;
    return window?.earliest ?? window?.latest ?? undefined;
  }

  private importedStopTime(
    stop: ImportedRailMlStop,
    type: 'arrival' | 'departure',
  ): string | undefined {
    if (type === 'arrival') {
      return stop.arrivalEarliest ?? stop.arrivalLatest ?? undefined;
    }
    return stop.departureEarliest ?? stop.departureLatest ?? undefined;
  }

  private differenceBetweenTimes(
    actual: string | undefined | null,
    template: string | undefined | null,
    offsetMinutes = 0,
  ): number | null {
    const actualMinutes = this.parseTimeToMinutes(actual ?? null);
    const templateMinutes = this.parseTimeToMinutes(template ?? null);
    if (actualMinutes === null || templateMinutes === null) {
      return null;
    }
    return actualMinutes - (templateMinutes + offsetMinutes);
  }

  private durationBetweenTimes(
    start: string | undefined | null,
    end: string | undefined | null,
  ): number | null {
    const startMinutes = this.parseTimeToMinutes(start ?? null);
    const endMinutes = this.parseTimeToMinutes(end ?? null);
    if (startMinutes === null || endMinutes === null) {
      return null;
    }
    return endMinutes - startMinutes;
  }

  private shiftTimeLabel(time: string | undefined, offsetMinutes: number): string | undefined {
    if (!time) {
      return undefined;
    }
    const templateMinutes = this.parseTimeToMinutes(time);
    if (templateMinutes === null) {
      return time;
    }
    return this.minutesToTime(templateMinutes + offsetMinutes);
  }

  private estimateTemplateTravelMinutes(template: ScheduleTemplate): number | null {
    if (!template.stops.length) {
      return null;
    }
    const first = template.stops[0];
    const last = template.stops[template.stops.length - 1];
    const departure =
      this.parseTimeToMinutes(first.departure?.earliest ?? first.departure?.latest ?? null) ??
      this.parseTimeToMinutes(first.arrival?.earliest ?? first.arrival?.latest ?? null);
    const arrival =
      this.parseTimeToMinutes(last.arrival?.earliest ?? last.arrival?.latest ?? null) ??
      this.parseTimeToMinutes(last.departure?.earliest ?? last.departure?.latest ?? null);
    if (departure === null || arrival === null) {
      return null;
    }
    const diff = arrival - departure;
    return diff >= 0 ? diff : diff + 24 * 60;
  }

  private formatDuration(minutes: number): string {
    const abs = Math.abs(Math.round(minutes));
    const hours = Math.floor(abs / 60);
    const mins = abs % 60;
    if (hours && mins) {
      return `${hours} h ${mins} min`;
    }
    if (hours) {
      return `${hours} h`;
    }
    return `${mins} min`;
  }

  private defaultManualStops(): TrainPlanStop[] {
    return [
      {
        id: 'MANUAL-ST-001',
        sequence: 1,
        type: 'origin',
        locationName: 'Start',
        locationCode: 'START',
        countryCode: 'CH',
        activities: ['0001'],
      },
      {
        id: 'MANUAL-ST-002',
        sequence: 2,
        type: 'destination',
        locationName: 'Ziel',
        locationCode: 'ZIEL',
        countryCode: 'CH',
        activities: ['0001'],
      },
    ];
  }

  onRailMlFileSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const trains = this.applyTemplateMatching(this.parseRailMl(text));
        if (!trains.length) {
          throw new Error('Im RailML konnten keine Züge gefunden werden.');
        }
        this.importedTrains.set(trains);
        this.selectedTrainIds.set(new Set(trains.map((train) => train.id)));
        this.importError.set(null);
        this.errorMessage.set(null);
        this.importFilters.reset({
          search: '',
          start: '',
          end: '',
          templateId: '',
          irregularOnly: false,
          minDeviation: 0,
          deviationSort: 'none',
        });
        this.importFilterValues.set({
          search: '',
          start: '',
          end: '',
          templateId: '',
          irregularOnly: false,
          minDeviation: 0,
          deviationSort: 'none',
        });
        if (input) {
          input.value = '';
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'RailML-Datei konnte nicht verarbeitet werden.';
        this.importError.set(message);
        this.importedTrains.set([]);
        this.selectedTrainIds.set(new Set());
      }
    };
    reader.onerror = () => {
      this.importError.set('RailML-Datei konnte nicht gelesen werden.');
      this.importedTrains.set([]);
      this.selectedTrainIds.set(new Set());
    };
    reader.readAsText(file, 'utf-8');
  }

  clearImportedData() {
    this.importedTrains.set([]);
    this.selectedTrainIds.set(new Set());
    this.importError.set(null);
    this.importFilters.reset({
      search: '',
      start: '',
      end: '',
      templateId: '',
      irregularOnly: false,
      minDeviation: 0,
      deviationSort: 'none',
    });
    this.importFilterValues.set({
      search: '',
      start: '',
      end: '',
      templateId: '',
      irregularOnly: false,
      minDeviation: 0,
      deviationSort: 'none',
    });
    this.importOptionsForm.patchValue(
      { namePrefix: '', responsible: '', trafficPeriodId: '' },
      { emitEvent: false },
    );
  }

  isTrainSelected(id: string): boolean {
    return this.selectedTrainIds().has(id);
  }

  toggleTrainSelection(id: string, selected: boolean) {
    this.selectedTrainIds.update((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  isTrainExpanded(id: string): boolean {
    return this.expandedTrainIds().has(id);
  }

  toggleTrainExpansion(id: string, event?: Event) {
    event?.stopPropagation();
    event?.preventDefault();
    this.expandedTrainIds.update((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  selectAllFiltered(selectAll: boolean) {
    const ids = this.filteredTrains().map((train) => train.id);
    this.selectedTrainIds.update((current) => {
      const next = new Set(current);
      ids.forEach((id) => {
        if (selectAll) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
  }

  private parseTimeToMinutes(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
    if (!match) {
      return null;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    return hours * 60 + minutes;
  }

  private buildIsoFromMinutes(
    baseDate: string,
    minutes: number,
    dayOffset = 0,
  ): string | null {
    const base = new Date(`${baseDate}T00:00:00`);
    if (Number.isNaN(base.getTime())) {
      return null;
    }
    base.setDate(base.getDate() + dayOffset);
    base.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return base.toISOString();
  }

  private toIso(value: string | null): string | null {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private normalizeCalendarDates(dates: string[]): string[] {
    return Array.from(
      new Set(
        dates
          .map((date) => date?.slice(0, 10))
          .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ),
    ).sort();
  }

  private resolveOperatingDates(
    operatingPeriod: RailMlOperatingPeriod | undefined,
    timetablePeriod: RailMlTimetablePeriod | undefined,
    fallbackDate?: string,
  ): string[] {
    const start =
      operatingPeriod?.startDate ?? timetablePeriod?.startDate ?? fallbackDate;
    const end =
      operatingPeriod?.endDate ?? timetablePeriod?.endDate ?? start;
    if (!start || !end) {
      return [];
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return [];
    }
    const yearInfo = this.timetableYearService.getYearBounds(startDate);
    const clampedStart =
      startDate < yearInfo.start ? new Date(yearInfo.start) : startDate;
    const clampedEnd = endDate > yearInfo.end ? new Date(yearInfo.end) : endDate;
    if (clampedEnd.getTime() < clampedStart.getTime()) {
      return [];
    }
    const bitmap = this.sanitizeDaysBitmap(operatingPeriod?.operatingCode);
    return this.expandDateRange(
      clampedStart.toISOString().slice(0, 10),
      clampedEnd.toISOString().slice(0, 10),
      bitmap,
    );
  }

  private expandDateRange(startIso: string, endIso: string, daysBitmap: string): string[] {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }
    const normalized = this.sanitizeDaysBitmap(daysBitmap);
    const result: string[] = [];
    const guardLimit = 3660;
    for (
      let cursor = new Date(start);
      cursor <= end && result.length <= guardLimit;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const weekday = cursor.getDay();
      const index = weekday === 0 ? 6 : weekday - 1;
      if (normalized[index] === '1') {
        result.push(cursor.toISOString().slice(0, 10));
      }
    }
    return result;
  }

  private parseRailMl(xml: string): ImportedRailMlTrain[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Ungültiges RailML-Dokument.');
    }

    const operatingPeriods = this.extractRailMlOperatingPeriods(doc);
    const timetablePeriods = this.extractRailMlTimetablePeriods(doc);
    const trainNodes = Array.from(
      doc.querySelectorAll('train, railml\\:train, ns1\\:train'),
    );
    const trains: ImportedRailMlTrain[] = [];

    trainNodes.forEach((node, index) => {
      const mapped = this.mapRailMlTrainParts(
        doc,
        node,
        index,
        operatingPeriods,
        timetablePeriods,
      );
      mapped.forEach((train) => trains.push(train));
    });

    return trains;
  }

  private mapRailMlTrainParts(
    doc: Document,
    node: Element,
    index: number,
    operatingPeriods: Map<string, RailMlOperatingPeriod>,
    timetablePeriods: Map<string, RailMlTimetablePeriod>,
  ): ImportedRailMlTrain[] {
    const trainId =
      node.getAttribute('id') ??
      node.getAttribute('trainID') ??
      `train-${index + 1}`;
    const trainName =
      node.getAttribute('name') ?? node.getAttribute('trainName') ?? trainId;
    const trainNumber = node.getAttribute('trainNumber') ?? trainId;
    const category =
      node.getAttribute('categoryRef') ?? node.getAttribute('category') ?? undefined;
    const timetablePeriodRef = node.getAttribute('timetablePeriodRef') ?? undefined;
    const partNodes = Array.from(
      node.querySelectorAll('trainPart, railml\\:trainPart, ns1\\:trainPart'),
    );
    const targetParts = partNodes.length ? partNodes : [node];

    const trains: ImportedRailMlTrain[] = [];

    targetParts.forEach((partNode, partIndex) => {
      const ocpNodes = Array.from(
        partNode.querySelectorAll('ocpTT, railml\\:ocpTT, ns1\\:ocpTT'),
      );
      if (!ocpNodes.length) {
        return;
      }
      const stops = ocpNodes.map((stop, idx) =>
        this.mapRailMlStop(doc, stop, idx),
      ) as ImportedRailMlStop[];
      if (!stops.length) {
        return;
      }
      stops[0].type = 'origin';
      stops[stops.length - 1].type = 'destination';
      for (let i = 1; i < stops.length - 1; i++) {
        stops[i].type = 'intermediate';
      }

      const operatingPeriodRef =
        partNode.getAttribute('operatingPeriodRef') ??
        node.getAttribute('operatingPeriodRef') ??
        undefined;
      const operatingPeriod = operatingPeriodRef
        ? operatingPeriods.get(operatingPeriodRef)
        : undefined;
      const timetablePeriod = timetablePeriodRef
        ? timetablePeriods.get(timetablePeriodRef)
        : undefined;
      const startDate =
        partNode.getAttribute('startDate') ??
        operatingPeriod?.startDate ??
        timetablePeriod?.startDate ??
        node.getAttribute('startDate') ??
        new Date().toISOString().slice(0, 10);

      const firstDeparture =
        stops.find((stop) => stop.departureEarliest || stop.departureLatest)
          ?.departureEarliest ??
        stops[0].departureEarliest ??
        stops[0].departureLatest ??
        '00:00';
      const lastArrival =
        [...stops]
          .reverse()
          .find((stop) => stop.arrivalLatest || stop.arrivalEarliest)?.arrivalLatest ??
        stops[stops.length - 1].arrivalLatest ??
        stops[stops.length - 1].arrivalEarliest ??
        firstDeparture;

      const departureIso = this.combineDateTime(startDate, firstDeparture);
      const arrivalIso = this.combineDateTime(startDate, lastArrival);

      const variantLabel = partIndex === 0 ? undefined : this.resolveVariantLabel(
        partNode,
        operatingPeriod,
      );

      const calendarDatesRaw = this.resolveOperatingDates(
        operatingPeriod,
        timetablePeriod,
        startDate,
      );
      const fallbackDate = departureIso.slice(0, 10);
      const calendarDates = this.normalizeCalendarDates(
        calendarDatesRaw.length ? calendarDatesRaw : [fallbackDate],
      );
      const calendarVariantType: TrafficPeriodVariantType =
        partIndex === 0 ? 'series' : 'special_day';
      const calendarLabel =
        variantLabel ??
        operatingPeriod?.description ??
        timetablePeriod?.id ??
        (partIndex === 0 ? 'Hauptlage' : `Variante ${partIndex + 1}`);

      const displayName =
        partIndex === 0 || !variantLabel
          ? trainName
          : `${trainName} (${variantLabel})`;
      const variantId =
        partIndex === 0
          ? trainId
          : partNode.getAttribute('id') ?? `${trainId}-variant-${partIndex + 1}`;

      trains.push({
        id: variantId,
        groupId: trainId,
        variantOf: partIndex === 0 ? undefined : trainId,
        variantLabel,
        operatingPeriodRef,
        timetablePeriodRef,
        trainPartId: partNode === node ? undefined : partNode.getAttribute('id') ?? undefined,
        name: displayName,
        number: trainNumber,
        category,
        start: stops[0].locationName ?? stops[0].locationCode,
        end:
          stops[stops.length - 1].locationName ??
          stops[stops.length - 1].locationCode,
        departureIso,
        arrivalIso,
        departureTime: firstDeparture,
        arrivalTime: lastArrival,
        stops,
        calendarDates,
        calendarLabel,
        calendarVariantType,
      });
    });

    return trains;
  }

  private mapRailMlStop(
    doc: Document,
    node: Element,
    index: number,
  ): ImportedRailMlStop {
    const ocpRef = node.getAttribute('ocpRef');
    const locationName = this.resolveLocationName(doc, ocpRef);
    const locationCode =
      ocpRef ??
      node.getAttribute('operationControlPointRef') ??
      `ocp-${index + 1}`;
    const resolvedName = locationName ?? locationCode;

    const arrivalNode =
      node.querySelector('arrival') ??
      node.querySelector('railml\\:arrival') ??
      node.querySelector('ns1\\:arrival');
    const departureNode =
      node.querySelector('departure') ??
      node.querySelector('railml\\:departure') ??
      node.querySelector('ns1\\:departure');
    const timesNode =
      node.querySelector('times') ??
      node.querySelector('railml\\:times') ??
      node.querySelector('ns1\\:times');

    const arrivalEarliest =
      this.sanitizeTime(timesNode?.getAttribute('arrival')) ??
      this.sanitizeTime(arrivalNode?.getAttribute('time')) ??
      this.sanitizeTime(node.getAttribute('arrival'));
    const arrivalLatest =
      this.sanitizeTime(timesNode?.getAttribute('arrivalLatest')) ??
      this.sanitizeTime(arrivalNode?.getAttribute('timeLatest')) ??
      this.sanitizeTime(arrivalNode?.getAttribute('time'));
    const departureEarliest =
      this.sanitizeTime(timesNode?.getAttribute('departure')) ??
      this.sanitizeTime(departureNode?.getAttribute('time')) ??
      this.sanitizeTime(node.getAttribute('departure'));
    const departureLatest =
      this.sanitizeTime(timesNode?.getAttribute('departureLatest')) ??
      this.sanitizeTime(departureNode?.getAttribute('timeLatest')) ??
      this.sanitizeTime(departureNode?.getAttribute('time'));

    const activitiesAttr =
      node.getAttribute('activities') ??
      arrivalNode?.getAttribute('activities') ??
      departureNode?.getAttribute('activities') ??
      '';
    const activities = activitiesAttr
      ? activitiesAttr.split(' ').filter(Boolean)
      : ['0001'];

    return {
      type: 'intermediate',
      locationCode,
      locationName: resolvedName,
      countryCode: undefined,
      arrivalEarliest,
      arrivalLatest,
      departureEarliest,
      departureLatest,
      offsetDays: undefined,
      dwellMinutes: undefined,
      activities,
      platformWish: undefined,
      notes: undefined,
    };
  }

  private resolveVariantLabel(
    partNode: Element,
    operatingPeriod: RailMlOperatingPeriod | undefined,
  ): string | undefined {
    return (
      partNode.getAttribute('name') ??
      partNode.getAttribute('description') ??
      operatingPeriod?.description ??
      partNode.getAttribute('operatingPeriodRef') ??
      undefined
    );
  }

  private extractRailMlOperatingPeriods(doc: Document): Map<string, RailMlOperatingPeriod> {
    const nodes = Array.from(
      doc.querySelectorAll('operatingPeriod, railml\\:operatingPeriod, ns1\\:operatingPeriod'),
    );
    const periods = new Map<string, RailMlOperatingPeriod>();
    nodes.forEach((node) => {
      const id = node.getAttribute('id');
      if (!id) {
        return;
      }
      const description = node.getAttribute('description') ?? undefined;
      const dayNodes = Array.from(
        node.querySelectorAll('operatingDay, railml\\:operatingDay, ns1\\:operatingDay'),
      );
      const firstCode = dayNodes.find((day) => day.getAttribute('operatingCode'));
      const operatingCode = firstCode?.getAttribute('operatingCode') ?? '1111111';
      const startDates = dayNodes
        .map((day) => day.getAttribute('startDate'))
        .filter((date): date is string => !!date)
        .sort();
      const endDates = dayNodes
        .map((day) => day.getAttribute('endDate'))
        .filter((date): date is string => !!date)
        .sort();
      const startDate = startDates[0];
      const endDate = endDates.length ? endDates[endDates.length - 1] : undefined;
      periods.set(id, {
        id,
        description,
        operatingCode,
        startDate,
        endDate,
      });
    });
    return periods;
  }

  private extractRailMlTimetablePeriods(doc: Document): Map<string, RailMlTimetablePeriod> {
    const nodes = Array.from(
      doc.querySelectorAll('timetablePeriod, railml\\:timetablePeriod, ns1\\:timetablePeriod'),
    );
    const periods = new Map<string, RailMlTimetablePeriod>();
    nodes.forEach((node) => {
      const id = node.getAttribute('id');
      if (!id) {
        return;
      }
      periods.set(id, {
        id,
        startDate: node.getAttribute('startDate') ?? undefined,
        endDate: node.getAttribute('endDate') ?? undefined,
      });
    });
    return periods;
  }

  private sanitizeDaysBitmap(code: string | null | undefined): string {
    if (!code) {
      return '1111111';
    }
    const cleaned = code
      .split('')
      .map((char) => (char === '1' ? '1' : '0'))
      .join('');
    if (/^[01]{7}$/.test(cleaned)) {
      return cleaned;
    }
    const compact = code.replace(/[^01]/g, '');
    if (/^[01]{7}$/.test(compact)) {
      return compact;
    }
    return '1111111';
  }

  private resolveLocationName(doc: Document, ocpRef: string | null): string | undefined {
    if (!ocpRef) {
      return undefined;
    }
    const selector = `[id="${ocpRef}"]`;
    const ocp =
      doc.querySelector(`operationControlPoint${selector}`) ??
      doc.querySelector(`ocp${selector}`) ??
      doc.querySelector(`railml\\:operationControlPoint${selector}`) ??
      doc.querySelector(`railml\\:ocp${selector}`) ??
      doc.querySelector(`ns1\\:operationControlPoint${selector}`) ??
      doc.querySelector(`ns1\\:ocp${selector}`) ??
      Array.from(doc.querySelectorAll(selector)).find((element) => {
        const localName = element.localName?.toLowerCase();
        return localName === 'ocp' || localName === 'operationcontrolpoint';
      });
    if (!ocp) {
      return undefined;
    }
    const nameAttr = ocp.getAttribute('name') ?? ocp.getAttribute('label');
    if (nameAttr) {
      return nameAttr;
    }
    const nameNode = ocp.querySelector('name') ?? ocp.querySelector('railml\\:name');
    return nameNode?.textContent?.trim() || undefined;
  }

  private combineDateTime(date: string, time: string | undefined): string {
    const baseTime = time && time.length >= 5 ? time.slice(0, 5) : '00:00';
    const iso = `${date}T${baseTime}`;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  private sanitizeTime(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const match = value.match(/(\d{1,2}:\d{2})/);
    return match ? match[1] : undefined;
  }

  private ensureCalendarsForImportedTrains(
    trains: ImportedRailMlTrain[],
  ): Map<string, string> {
    const periodMap = new Map<string, string>();
    if (!trains.length) {
      return periodMap;
    }
    const groups = new Map<string, ImportedRailMlTrain[]>();
    trains.forEach((train) => {
      const key = train.groupId ?? train.id;
      const list = groups.get(key) ?? [];
      list.push(train);
      groups.set(key, list);
    });

    groups.forEach((groupTrains, groupId) => {
      const normalizedGroup = this.prepareGroupedCalendars(groupTrains);
      const rules = this.buildGroupTrafficPeriodRules(normalizedGroup);
      if (!rules.length) {
        return;
      }
      const baseTrain =
        normalizedGroup.find((train) => !train.variantOf) ?? normalizedGroup[0];
      const yearBounds = baseTrain?.timetableYearLabel
        ? this.timetableYearService.getYearByLabel(baseTrain.timetableYearLabel)
        : this.timetableYearService.ensureDatesWithinSameYear(
            rules.flatMap((rule) => rule.selectedDates),
          );
      const periodName = `${baseTrain?.name ?? groupId} Referenzkalender`;
      const tags = this.buildArchiveGroupTags(
        `import:${groupId}`,
        baseTrain?.name ?? groupId,
        'import',
      );
      const periodId = this.trafficPeriodService.createPeriod({
        name: periodName,
        type: 'standard',
        year: yearBounds.startYear,
        timetableYearLabel: yearBounds.label,
        rules,
        tags,
      });
      periodMap.set(groupId, periodId);
      normalizedGroup.forEach((train) => {
        train.trafficPeriodId = periodId;
        train.trafficPeriodName = periodName;
        train.trafficPeriodSourceId = groupId;
      });
    });

    return periodMap;
  }

  private buildGroupTrafficPeriodRules(
    trains: ImportedRailMlTrain[],
  ): TrafficPeriodRulePayload[] {
    if (!trains.length) {
      return [];
    }
    const sorted = [...trains].sort((a, b) => {
      if (!a.variantOf && b.variantOf) {
        return -1;
      }
      if (a.variantOf && !b.variantOf) {
        return 1;
      }
      return (a.name ?? a.id).localeCompare(b.name ?? b.id);
    });

    let variantCounter = 1;
    const rules: TrafficPeriodRulePayload[] = [];

    sorted.forEach((train) => {
      const variantType =
        train.calendarVariantType ?? (train.variantOf ? 'special_day' : 'series');
      const dates =
        (train.calendarDates && train.calendarDates.length
          ? train.calendarDates
          : this.fallbackDatesFromTrain(train)) ?? [];
      if (!dates.length) {
        return;
      }
      const yearInfo = this.timetableYearService.ensureDatesWithinSameYear(dates);
      train.timetableYearLabel = train.timetableYearLabel ?? yearInfo.label;
      const label =
        train.calendarLabel ??
        train.variantLabel ??
        train.name ??
        (train.variantOf ? `Variante ${variantCounter}` : 'Hauptlage');
      const variantNumber =
        variantType === 'series' ? '00' : String(variantCounter++).padStart(2, '0');
      rules.push({
        name: label,
        year: yearInfo.startYear,
        selectedDates: dates,
        variantType,
        appliesTo: 'both',
        variantNumber,
        primary: !train.variantOf,
      });
    });

    return rules;
  }

  private fallbackDatesFromTrain(train: ImportedRailMlTrain): string[] {
    if (train.departureIso) {
      return [train.departureIso.slice(0, 10)];
    }
    return [];
  }

  private prepareGroupedCalendars(trains: ImportedRailMlTrain[]): ImportedRailMlTrain[] {
    if (!trains.length) {
      return trains;
    }
    let referenceYear: string | null = null;
    trains.forEach((train) => {
      if (!train.calendarDates?.length) {
        return;
      }
      const yearInfo = this.timetableYearService.ensureDatesWithinSameYear(train.calendarDates);
      train.timetableYearLabel = yearInfo.label;
      if (referenceYear && referenceYear !== yearInfo.label) {
        throw new Error(
          `Die Variante "${train.name}" gehört zum Fahrplanjahr ${yearInfo.label}, erwartet wurde ${referenceYear}. Bitte RailML pro Jahr importieren.`,
        );
      }
      referenceYear = referenceYear ?? yearInfo.label;
    });

    const baseTrain = trains.find((train) => !train.variantOf) ?? trains[0];
    const baseDates = this.normalizeCalendarDates(baseTrain.calendarDates ?? []);
    if (baseDates.length) {
      const baseYear = this.timetableYearService.ensureDatesWithinSameYear(baseDates);
      referenceYear = referenceYear ?? baseYear.label;
      if (referenceYear !== baseYear.label) {
        throw new Error(
          `Die Hauptlage "${baseTrain.name}" gehört zum Fahrplanjahr ${baseYear.label}, erwartet wurde ${referenceYear}.`,
        );
      }
      baseTrain.timetableYearLabel = baseYear.label;
    } else if (referenceYear) {
      baseTrain.timetableYearLabel = referenceYear;
    }

    const variantDates = new Set(
      trains
        .filter((train) => !!train.variantOf)
        .flatMap((train) => this.normalizeCalendarDates(train.calendarDates ?? [])),
    );
    if (variantDates.size && baseDates.length) {
      baseTrain.calendarDates = baseDates.filter((date) => !variantDates.has(date));
    } else if (!baseTrain.calendarDates?.length && baseDates.length) {
      baseTrain.calendarDates = baseDates;
    }
    baseTrain.calendarVariantType = 'series';
    return trains;
  }

  businessAutomationsForSelection(): BusinessTemplateAutomation[] {
    const templateId = this.businessForm.controls.templateId.value;
    if (!templateId) {
      return [];
    }
    return this.businessAutomations()
      .filter((rule) => rule.templateId === templateId)
      .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
  }

  onAutomationToggle(ruleId: string, checked: boolean) {
    const control = this.businessForm.controls.automationRuleIds;
    const current = new Set(control.value ?? []);
    if (checked) {
      current.add(ruleId);
    } else {
      current.delete(ruleId);
    }
    control.setValue(Array.from(current), { emitEvent: false });
  }

  private ensureBusinessSelectionValid(): boolean {
    const mode = this.businessForm.controls.mode.value;
    if (mode === 'existing' && !this.businessForm.controls.existingBusinessId.value) {
      this.errorMessage.set('Bitte ein bestehendes Geschäft auswählen oder Modus anpassen.');
      this.businessForm.controls.existingBusinessId.markAsTouched();
      return false;
    }
    if (mode === 'template' && !this.businessForm.controls.templateId.value) {
      this.errorMessage.set('Bitte eine Geschäftsvorlage auswählen.');
      this.businessForm.controls.templateId.markAsTouched();
      return false;
    }
    return true;
  }

  private applyBusinessLink(items: OrderItem[]): boolean {
    if (!items.length) {
      return true;
    }
    const mode = this.businessForm.controls.mode.value;
    if (mode === 'none') {
      return true;
    }
    if (mode === 'existing') {
      const businessId = this.businessForm.controls.existingBusinessId.value?.trim();
      if (!businessId) {
        return true;
      }
      items.forEach((item) => this.orderService.linkBusinessToItem(businessId, item.id));
      this.errorMessage.set(null);
      return true;
    }
    const templateId = this.businessForm.controls.templateId.value?.trim();
    if (!templateId) {
      return true;
    }
    try {
      const targetDateRaw = this.businessForm.controls.targetDate.value?.trim();
      const targetDate = targetDateRaw ? new Date(`${targetDateRaw}T00:00:00`) : undefined;
      if (targetDate && Number.isNaN(targetDate.getTime())) {
        throw new Error('Das Zieldatum für das Geschäft ist ungültig.');
      }
      const business = this.businessTemplateService.instantiateTemplate(templateId, {
        targetDate,
        note: this.businessForm.controls.note.value?.trim() || undefined,
        customTitle: this.businessForm.controls.customTitle.value?.trim() || undefined,
        linkedOrderItemIds: items.map((item) => item.id),
      });
      if (this.businessForm.controls.enableAutomations.value) {
        const automationIds = this.businessForm.controls.automationRuleIds.value ?? [];
        this.businessTemplateService.triggerAutomationsForTemplate(templateId, business.id, {
          automationIds: automationIds.length ? automationIds : undefined,
          linkedOrderItemIds: items.map((item) => item.id),
        });
      }
      this.errorMessage.set(null);
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Geschäftsvorlage konnte nicht instanziiert werden.';
      this.errorMessage.set(message);
      return false;
    }
  }

  private buildArchiveGroupTags(groupId: string, label?: string, origin?: string): string[] {
    const tags = [`archive-group:${groupId}`];
    if (label?.trim()) {
      tags.push(`archive-label:${label.trim()}`);
    }
    if (origin) {
      tags.push(`archive-origin:${origin}`);
    }
    return tags;
  }

  private slugify(value: string): string {
    const normalized = value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return normalized || 'gruppe';
  }
}

interface ImportFilterValues {
  search: string;
  start: string;
  end: string;
  templateId: string;
  irregularOnly: boolean;
  minDeviation: number;
  deviationSort: 'none' | 'asc' | 'desc';
}

interface RailMlOperatingPeriod {
  id: string;
  description?: string;
  operatingCode: string;
  startDate?: string;
  endDate?: string;
}

interface RailMlTimetablePeriod {
  id: string;
  startDate?: string;
  endDate?: string;
}
