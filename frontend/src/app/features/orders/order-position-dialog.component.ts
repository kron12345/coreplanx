import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  ImportedRailMlStop,
  ImportedRailMlTrain,
  ImportedTemplateStopComparison,
} from '../../core/services/order.service';
import { ScheduleTemplateService } from '../../core/services/schedule-template.service';
import { TrafficPeriodService } from '../../core/services/traffic-period.service';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { ScheduleTemplate } from '../../core/models/schedule-template.model';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { BusinessService } from '../../core/services/business.service';
import {
  ScheduleTemplateCreateDialogComponent,
  ScheduleTemplateCreateDialogData,
  ScheduleTemplateDialogResult,
} from '../schedule-templates/schedule-template-create-dialog.component';
import {
  PlanAssemblyDialogComponent,
  PlanAssemblyDialogData,
  PlanAssemblyDialogResult,
} from './plan-assembly-dialog/plan-assembly-dialog.component';
import { PlanModificationStopInput } from '../../core/services/train-plan.service';
import { TrainPlanStop } from '../../core/models/train-plan.model';
import {
  PlanGenerationPreview,
  PlanTemplateStats,
} from './order-plan-preview/plan-preview.models';
import { ReferenceCalendarInlineFormComponent } from './reference-calendar-inline-form/reference-calendar-inline-form.component';
import { BusinessTemplateAutomation } from '../../core/models/business-template.model';
import {
  CompositionBaseVehicleForm,
  CompositionChangeEntryForm,
} from './shared/vehicle-composition-form/vehicle-composition-form.component';
import { OrderPositionImportTabComponent } from './order-position-dialog-tabs/order-position-import-tab.component';
import { OrderPositionManualTabComponent } from './order-position-dialog-tabs/order-position-manual-tab.component';
import { OrderPositionPlanTabComponent } from './order-position-dialog-tabs/order-position-plan-tab.component';
import { OrderPositionServiceTabComponent } from './order-position-dialog-tabs/order-position-service-tab.component';
import { OrderPositionCompositionFacade } from './order-position-composition.facade';
import { OrderPositionRailmlService } from './order-position-railml.service';
import { OrderPositionDialogActionsService } from './order-position-dialog-actions.service';
import { OrderPositionSimulationFacade } from './order-position-simulation.facade';
import { OrderPositionTemplateService } from './order-position-template.service';
import {
  ImportFilterValues,
  OrderPositionDialogData,
  OrderPositionMode,
  SimulationMode,
} from './order-position-dialog.models';
import {
  IMPORT_FILTER_DESCRIPTIONS,
  IMPORT_OPTIONS_DESCRIPTIONS,
  MANUAL_FIELD_DESCRIPTIONS,
  MANUAL_GENERAL_DESCRIPTIONS,
  MANUAL_GENERAL_LABELS,
  PLAN_FIELD_DESCRIPTIONS,
  SERVICE_FIELD_DESCRIPTIONS,
  SERVICE_FIELDS_CONFIG,
  SERVICE_GENERAL_DESCRIPTIONS,
  SERVICE_GENERAL_LABELS,
} from './order-position-dialog.constants';
import { createOrderPositionForms } from './order-position-dialog.forms';

@Component({
    selector: 'app-order-position-dialog',
    imports: [
        CommonModule,
        ReactiveFormsModule,
        ...MATERIAL_IMPORTS,
        ReferenceCalendarInlineFormComponent,
        OrderPositionServiceTabComponent,
        OrderPositionPlanTabComponent,
        OrderPositionManualTabComponent,
        OrderPositionImportTabComponent,
    ],
    templateUrl: './order-position-dialog.component.html',
    styleUrl: './order-position-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderPositionDialogComponent {
  private readonly tabModes: ReadonlyArray<OrderPositionMode> = [
    'service',
    'plan',
    'manualPlan',
    'import',
  ];
  private readonly dialogRef = inject(MatDialogRef<OrderPositionDialogComponent>);
  private readonly data = inject<OrderPositionDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly templateService = inject(ScheduleTemplateService);
  private readonly trafficPeriodService = inject(TrafficPeriodService);
  private readonly timetableYearService = inject(TimetableYearService);
  private readonly businessTemplateService = inject(BusinessTemplateService);
  private readonly businessService = inject(BusinessService);
  private readonly railmlService = inject(OrderPositionRailmlService);
  private readonly actionsService = inject(OrderPositionDialogActionsService);
  private readonly compositionFacade = inject(OrderPositionCompositionFacade);
  private readonly simulationFacade = inject(OrderPositionSimulationFacade);
  private readonly templateCalcService = inject(OrderPositionTemplateService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  readonly orderYearLabel =
    this.data.order.timetableYearLabel ?? this.timetableYearService.defaultYearBounds().label;

  private readonly defaultTimetableYear = this.timetableYearService.defaultYearBounds();
  readonly defaultTimetableYearLabel = this.orderYearLabel || this.defaultTimetableYear.label;

  private readonly forms = createOrderPositionForms(this.fb, this.defaultTimetableYearLabel);

  readonly modeControl = this.forms.modeControl;
  readonly serviceForm = this.forms.serviceForm;
  readonly planForm = this.forms.planForm;
  readonly manualPlanForm = this.forms.manualPlanForm;
  readonly importFilters = this.forms.importFilters;
  readonly importOptionsForm = this.forms.importOptionsForm;
  readonly businessForm = this.forms.businessForm;
  private readonly simulationForms = {
    planForm: this.planForm,
    manualPlanForm: this.manualPlanForm,
    importOptionsForm: this.importOptionsForm,
  };

  readonly templates = computed(() => this.templateService.templates());
  readonly taktTemplates = computed(() =>
    this.templates().filter((template) => !!template.recurrence),
  );
  readonly trafficPeriods = computed(() => this.trafficPeriodService.periods());
  readonly businessTemplates = this.businessTemplateService.templates;
  readonly businessOptions = computed(() => this.businessService.businesses());
  readonly businessAutomations = this.businessTemplateService.automationRules;
  readonly mode = signal<OrderPositionMode>(this.modeControl.value);
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
  readonly serviceFieldsConfig = SERVICE_FIELDS_CONFIG;
  readonly serviceGeneralLabels = SERVICE_GENERAL_LABELS;
  readonly serviceGeneralDescriptions = SERVICE_GENERAL_DESCRIPTIONS;
  readonly serviceFieldDescriptions = SERVICE_FIELD_DESCRIPTIONS;
  readonly manualGeneralLabels = MANUAL_GENERAL_LABELS;
  readonly manualGeneralDescriptions = MANUAL_GENERAL_DESCRIPTIONS;
  readonly planFieldDescriptions = PLAN_FIELD_DESCRIPTIONS;
  readonly manualFieldDescriptions = MANUAL_FIELD_DESCRIPTIONS;
  readonly importOptionsDescriptions = IMPORT_OPTIONS_DESCRIPTIONS;
  readonly importFilterDescriptions = IMPORT_FILTER_DESCRIPTIONS;
  readonly compositionBaseVehicles = this.fb.array<CompositionBaseVehicleForm>([]);
  readonly compositionChangeEntries = this.fb.array<CompositionChangeEntryForm>([]);
  planStopOptions: { value: number; label: string }[] = [];
  manualStopOptions: { value: number; label: string }[] = [];
  readonly compositionBaseFactory = (
    seed?: { vehicleType?: string; count?: number; note?: string | null },
  ) => this.compositionFacade.createBaseVehicleGroup(seed);
  readonly compositionChangeFactory = (seed?: {
    stopIndex?: number | null;
    action?: 'attach' | 'detach';
    vehicleType?: string;
    count?: number;
    note?: string | null;
  }) => this.compositionFacade.createChangeEntryGroup(seed);

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
      const deviationMagnitude = this.templateCalcService.trainDeviationMagnitude(train);
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
        this.templateCalcService.trainDeviationMagnitude(b) -
        this.templateCalcService.trainDeviationMagnitude(a);
      return sort === 'desc' ? diff : -diff;
    });
  });
  errorMessage = signal<string | null>(null);

  readonly order = this.data.order;
  get requiresRollingStock(): boolean {
    return this.isTttOrder();
  }

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
    return this.actionsService.resolveCalendarDates(
      this.manualCalendarDatesControl.value,
      this.manualCalendarExclusionsControl.value,
    ).length;
  }

  managedTimetableYears() {
    return this.timetableYearService.managedYearBounds();
  }

  private isTttOrder(): boolean {
    const tags = this.order?.tags ?? [];
    return tags.some((tag) => tag?.toLowerCase() === 'ttt');
  }

  private hydrateCompositionFromTemplate(template: ScheduleTemplate | undefined | null) {
    const { stopOptions } = this.compositionFacade.hydrateFromTemplate({
      template,
      baseVehicles: this.compositionBaseVehicles,
      changeEntries: this.compositionChangeEntries,
      requiresRollingStock: this.requiresRollingStock,
    });
    this.planStopOptions = stopOptions;
  }

  private ensureCompositionSeed(): void {
    this.compositionFacade.ensureSeed(this.compositionBaseVehicles);
  }

  private validateComposition(required: boolean): boolean {
    const error = this.compositionFacade.validateComposition({
      baseVehicles: this.compositionBaseVehicles,
      changeEntries: this.compositionChangeEntries,
      required,
    });
    if (!error) {
      return true;
    }
    this.errorMessage.set(error);
    return false;
  }

  private buildCompositionPayload(): ScheduleTemplate['composition'] | undefined {
    return this.compositionFacade.buildCompositionPayload({
      baseVehicles: this.compositionBaseVehicles,
      changeEntries: this.compositionChangeEntries,
    });
  }

  simulationSelectionLabel(mode: SimulationMode): string | null {
    return this.simulationFacade.simulationSelectionLabel(
      mode,
      this.simulationForms,
      this.order.timetableYearLabel,
      this.defaultTimetableYearLabel,
    );
  }

  openSimulationAssignment(mode: SimulationMode) {
    this.simulationFacade.openSimulationAssignment(
      mode,
      this.simulationForms,
      this.order.timetableYearLabel,
      this.defaultTimetableYearLabel,
    );
  }

  private ensureSimulationSelected(mode: SimulationMode): boolean {
    const error = this.simulationFacade.ensureSimulationSelected(
      mode,
      this.simulationForms,
      this.order.timetableYearLabel,
      this.defaultTimetableYearLabel,
    );
    if (!error) {
      return true;
    }
    this.errorMessage.set(error);
    return false;
  }

  constructor() {
    const templateList = this.templateService.templates();

    const firstTemplate = templateList[0];

    if (firstTemplate) {
      this.planForm.controls.templateId.setValue(firstTemplate.id);
      this.planForm.controls.namePrefix.setValue(firstTemplate.title);
      this.hydrateCompositionFromTemplate(firstTemplate);
    } else if (this.requiresRollingStock) {
      this.ensureCompositionSeed();
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

    this.planForm.controls.templateId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((templateId) => {
        const template = templateId ? this.templateService.getById(templateId) : undefined;
        this.hydrateCompositionFromTemplate(template);
      });
    // lock Fahrplanjahr auf Auftrag
    this.serviceForm.controls.calendarYear.disable({ emitEvent: false });
    this.planForm.controls.calendarYear.disable({ emitEvent: false });
    this.manualPlanForm.controls.calendarYear.disable({ emitEvent: false });
    this.importOptionsForm.controls.calendarYear.disable({ emitEvent: false });

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

    (['plan', 'manual', 'import'] as SimulationMode[]).forEach((mode) => {
      this.simulationFacade.setupSimulationReactions(
        mode,
        this.simulationForms,
        this.order.timetableYearLabel,
        this.defaultTimetableYearLabel,
        this.destroyRef,
      );
      this.simulationFacade.assignProductiveSimulation(
        mode,
        this.simulationForms,
        this.order.timetableYearLabel,
        this.defaultTimetableYearLabel,
      );
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
    const dialogRef = this.dialog.open<
      ScheduleTemplateCreateDialogComponent,
      ScheduleTemplateCreateDialogData,
      ScheduleTemplateDialogResult | undefined
    >(ScheduleTemplateCreateDialogComponent, {
      width: '95vw',
      maxWidth: '1200px',
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }

      let template: ScheduleTemplate | undefined;
      if (result.mode === 'edit') {
        this.templateService.updateTemplateFromPayload(result.templateId, result.payload);
        template = this.templateService.getById(result.templateId);
      } else {
        template = this.templateService.createTemplate(result.payload);
      }
      if (!template) {
        return;
      }

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
        this.manualStopOptions = this.compositionFacade.stopOptionsFromManual(result.stops);
        if (this.requiresRollingStock) {
          this.ensureCompositionSeed();
        }
        this.errorMessage.set(null);
      }
    });
  }

  clearManualTemplate() {
    this.manualTemplate.set(null);
    this.manualStopOptions = [];
  }

  cancel() {
    this.dialogRef.close();
  }

  save() {
    this.errorMessage.set(null);

    const mode = this.mode();

    if (mode === 'service') {
      if (this.serviceForm.invalid) {
        this.serviceForm.markAllAsTouched();
        return;
      }
      const error = this.actionsService.createServiceItems({
        order: this.order,
        serviceForm: this.serviceForm,
        businessForm: this.businessForm,
      });
      if (error) {
        this.errorMessage.set(error);
        return;
      }
      this.dialogRef.close(true);
      return;
    }

    if (mode === 'plan') {
      if (this.planForm.invalid) {
        this.planForm.markAllAsTouched();
        return;
      }
      if (!this.validateComposition(this.requiresRollingStock)) {
        return;
      }

      const businessError = this.actionsService.validateBusinessSelection(this.businessForm);
      if (businessError) {
        this.errorMessage.set(businessError);
        return;
      }
      if (!this.ensureSimulationSelected('plan')) {
        return;
      }
      const composition = this.buildCompositionPayload();
      const error = this.actionsService.createPlanItems({
        order: this.order,
        planForm: this.planForm,
        businessForm: this.businessForm,
        composition,
      });
      if (error) {
        this.errorMessage.set(error);
        return;
      }
      this.dialogRef.close(true);
      return;
    }

    if (mode === 'manualPlan') {
      const stops = this.manualTemplate();
      if (!stops || !stops.length) {
        this.errorMessage.set('Bitte zuerst einen Fahrplan zusammenstellen.');
        return;
      }
      if (this.manualPlanForm.invalid) {
        this.manualPlanForm.markAllAsTouched();
        return;
      }
      if (!this.validateComposition(this.requiresRollingStock)) {
        return;
      }

      const businessError = this.actionsService.validateBusinessSelection(this.businessForm);
      if (businessError) {
        this.errorMessage.set(businessError);
        return;
      }
      if (!this.ensureSimulationSelected('manual')) {
        return;
      }
      const composition = this.buildCompositionPayload();
      const error = this.actionsService.createManualPlanItem({
        order: this.order,
        manualPlanForm: this.manualPlanForm,
        businessForm: this.businessForm,
        stops,
        composition,
      });
      if (error) {
        this.errorMessage.set(error);
        return;
      }
      this.dialogRef.close(true);
      return;
    }

    if (!this.validateComposition(this.requiresRollingStock)) {
      return;
    }
    const businessError = this.actionsService.validateBusinessSelection(this.businessForm);
    if (businessError) {
      this.errorMessage.set(businessError);
      return;
    }
    if (!this.ensureSimulationSelected('import')) {
      return;
    }
    const composition = this.buildCompositionPayload();
    const error = this.actionsService.createImportedPlanItems({
      order: this.order,
      trains: this.importedTrains(),
      selectedTrainIds: this.selectedTrainIds(),
      importOptionsForm: this.importOptionsForm,
      businessForm: this.businessForm,
      composition,
    });
    if (error) {
      this.errorMessage.set(error);
      return;
    }
    this.dialogRef.close(true);
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

  stopHasDeviation(comparison: ImportedTemplateStopComparison): boolean {
    return this.templateCalcService.stopHasDeviation(comparison);
  }

  hasDeviation(value: number | null | undefined): boolean {
    return typeof value === 'number' && Math.abs(value) > 0.01;
  }

  selectedTemplate(): ScheduleTemplate | undefined {
    const templateId = this.planForm.controls.templateId.value;
    if (!templateId) {
      return undefined;
    }
    return this.templates().find((tpl) => tpl.id === templateId);
  }

  planPreview(): PlanGenerationPreview {
    return this.templateCalcService.planPreview(this.selectedTemplate(), this.planForm.getRawValue());
  }

  planTemplateStats(template: ScheduleTemplate | undefined): PlanTemplateStats | null {
    return this.templateCalcService.planTemplateStats(template);
  }

  private applyTemplateMatching(trains: ImportedRailMlTrain[]): ImportedRailMlTrain[] {
    const templates = this.taktTemplates();
    if (!templates.length) {
      return trains;
    }
    return this.templateCalcService.applyTemplateMatching(trains, templates);
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
        const trains = this.applyTemplateMatching(this.railmlService.parseRailMl(text));
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
      {
        namePrefix: '',
        responsible: '',
        trafficPeriodId: '',
        tags: '',
        variantType: 'productive',
        variantLabel: '',
        simulationId: '',
        simulationLabel: '',
        calendarYear: this.defaultTimetableYearLabel,
      },
      { emitEvent: false },
    );
    this.simulationFacade.assignProductiveSimulation(
      'import',
      this.simulationForms,
      this.order.timetableYearLabel,
      this.defaultTimetableYearLabel,
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
}
