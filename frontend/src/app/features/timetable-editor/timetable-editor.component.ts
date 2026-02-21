import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { AssistantUiContextService } from '../../core/services/assistant-ui-context.service';
import { TrainPlanService } from '../../core/services/train-plan.service';
import type { TrainPlan } from '../../core/models/train-plan.model';
import type {
  PatternDefinition,
  RouteDraft,
  RouteStop,
  TimetableDraft,
  TimetableDraftBundle,
} from '../../core/models/timetable-draft.model';
import type {
  TimetableFormationVehicle,
  TimetableFormationServiceType,
  TimetableOrderingContext,
} from '../../core/models/timetable-ordering-context.model';
import {
  DEFAULT_DWELL_SECONDS,
  DEFAULT_SPEED_KPH,
  addSecondsToIso,
  buildTimingPointsFromRoute,
  buildSegments,
  createDraftId,
  nowIso,
  parseIsoToUtcMs,
  formatUtcMsToIso,
} from './timetable-editor.utils';
import { TimetableRouteBuilderComponent } from './timetable-route-builder.component';
import { TimetableTimingEditorComponent } from './timetable-timing-editor.component';
import {
  buildFormationVehicleOptionsFromVehicleTypes,
  FREE_PROCESSING_REASON_OPTIONS,
  ORDERING_HELP_TEXT,
  REASON_OF_REFERENCE_OPTIONS,
  SERVICE_TYPE_OPTIONS,
  serviceTypeForVehicleType,
  TRAIN_TYPE_OPTIONS,
  type TimetableFormationVehicleOption,
  trafficTypeOptionsForTrainType,
} from './timetable-ordering-options';
import type { TimetableOrderingOption } from './timetable-ordering-options';
import { AnnualCalendarSelectorComponent } from '../../shared/annual-calendar-selector/annual-calendar-selector.component';
import { MasterDataCollectionsStoreService } from '../master-data/master-data-collections.store';
import type { VehicleComposition, VehicleType } from '../../models/master-data';

type EditorStep = 'ordering' | 'route' | 'timing';
type OrderingFieldKey =
  | 'reasonOfReference'
  | 'trainType'
  | 'trafficTypeCode'
  | 'trafficTypeNetwork'
  | 'serviceType'
  | 'tractionOrPwg'
  | 'debtorCode'
  | 'distributionList'
  | 'freeProcessingReason';

type RequiredOrderingFieldKey =
  | 'otnOrNameInput'
  | 'reasonOfReference'
  | 'validityDate'
  | 'trainType'
  | 'trafficTypeCode'
  | 'serviceType'
  | 'debtorCode'
  | 'distributionList'
  | 'freeProcessingReason';

type ValidityRange = {
  startIso: string;
  endIso: string;
  label: string;
};

type FormationTemplateOption = TimetableOrderingOption & {
  summary: string;
};

type OrderingProgressGroupKey = 'masterData' | 'formation' | 'billing';

type OrderingProgressGroup = {
  key: OrderingProgressGroupKey;
  label: string;
  fields: readonly RequiredOrderingFieldKey[];
};

type OrderingProgressGroupState = OrderingProgressGroup & {
  filled: number;
  total: number;
  complete: boolean;
};

const ORDERING_REQUIRED_FIELDS: readonly RequiredOrderingFieldKey[] = [
  'otnOrNameInput',
  'reasonOfReference',
  'validityDate',
  'trainType',
  'trafficTypeCode',
  'serviceType',
  'debtorCode',
  'distributionList',
  'freeProcessingReason',
];

const ORDERING_PROGRESS_GROUPS: readonly OrderingProgressGroup[] = [
  {
    key: 'masterData',
    label: 'Stammdaten',
    fields: [
      'otnOrNameInput',
      'reasonOfReference',
      'validityDate',
      'trainType',
      'trafficTypeCode',
    ],
  },
  {
    key: 'formation',
    label: 'Formation',
    fields: ['serviceType'],
  },
  {
    key: 'billing',
    label: 'Abrechnung',
    fields: ['debtorCode', 'distributionList', 'freeProcessingReason'],
  },
];

@Component({
  selector: 'app-timetable-editor',
  standalone: true,
  imports: [
    CommonModule,
    CdkDropList,
    CdkDrag,
    ...MATERIAL_IMPORTS,
    TimetableRouteBuilderComponent,
    TimetableTimingEditorComponent,
    AnnualCalendarSelectorComponent,
  ],
  templateUrl: './timetable-editor.component.html',
  styleUrl: './timetable-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimetableEditorComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly trainPlans = inject(TrainPlanService);
  private readonly assistantUiContext = inject(AssistantUiContextService);
  private readonly masterCollections = inject(MasterDataCollectionsStoreService);

  readonly planId = signal<string | null>(null);
  readonly plan = signal<TrainPlan | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly returnUrl = signal<string>('/');
  readonly orderId = signal<string | null>(null);
  readonly itemId = signal<string | null>(null);

  readonly routeDraft = signal<RouteDraft | null>(null);
  readonly timetableDraft = signal<TimetableDraft | null>(null);
  readonly patternDefinition = signal<PatternDefinition | null>(null);
  readonly orderingContext = signal<TimetableOrderingContext | null>(null);
  readonly activeStep = signal<EditorStep>('ordering');
  readonly saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly lastSavedIso = signal<string | null>(null);
  readonly validityCalendarOpen = signal(false);
  readonly selectedFormationVehicleTypeId = signal('');
  readonly selectedFormationTemplateId = signal('');
  readonly formationReorderMessage = signal<string | null>(null);

  readonly reasonOfReferenceOptions = REASON_OF_REFERENCE_OPTIONS;
  readonly trainTypeOptions = TRAIN_TYPE_OPTIONS;
  readonly serviceTypeOptions = SERVICE_TYPE_OPTIONS;
  readonly freeProcessingReasonOptions = FREE_PROCESSING_REASON_OPTIONS;

  private readonly queryValidityStart = signal<string | null>(null);
  private readonly queryValidityEnd = signal<string | null>(null);

  private autoSaveEnabled = signal(false);
  private lastDraftSignature: string | null = null;
  private saveTimer: number | null = null;
  private reorderFeedbackTimer: number | null = null;
  private saveInFlight = false;
  private pendingBundle: TimetableDraftBundle | null = null;
  private timetableEdited = false;

  readonly hasPlan = computed(() => !!this.plan());

  readonly validityRange = computed<ValidityRange>(() =>
    this.resolveValidityRange(
      this.plan(),
      this.queryValidityStart(),
      this.queryValidityEnd(),
    ),
  );

  readonly validityAllowedDates = computed(() =>
    this.buildAllowedDatesForRange(this.validityRange()),
  );

  readonly validitySelectedDates = computed(() => {
    const context = this.orderingContext();
    if (!context) {
      return [];
    }
    const dates = this.normalizeDateList(context.validityDates);
    if (dates.length) {
      return dates;
    }
    const selected = context.validityDate?.trim();
    return selected ? [selected] : [];
  });

  readonly trafficTypeCodeOptions = computed<TimetableOrderingOption[]>(() => {
    const baseOptions = trafficTypeOptionsForTrainType(
      this.orderingContext()?.trainType,
    );
    const current = this.orderingFieldValue('trafficTypeCode').trim();
    if (!current) {
      return baseOptions;
    }
    if (baseOptions.some((option) => option.value === current)) {
      return baseOptions;
    }
    return [{ value: current, label: `${current} · Bestehender Wert` }, ...baseOptions];
  });

  readonly vehicleTypes = computed<VehicleType[]>(() =>
    this.masterCollections.vehicleTypes(),
  );

  readonly vehicleCompositions = computed<VehicleComposition[]>(() =>
    this.masterCollections.vehicleCompositions(),
  );

  readonly vehicleTypeById = computed(() =>
    new Map(this.vehicleTypes().map((type) => [type.id, type] as const)),
  );

  readonly formationVehicleOptions = computed<TimetableFormationVehicleOption[]>(() =>
    buildFormationVehicleOptionsFromVehicleTypes(
      this.vehicleTypes(),
      this.orderingContext()?.serviceType,
    ),
  );

  readonly selectedFormationVehicleOption =
    computed<TimetableFormationVehicleOption | null>(() => {
      const id = this.selectedFormationVehicleTypeId().trim();
      if (!id) {
        return null;
      }
      return (
        this.formationVehicleOptions().find((option) => option.value === id) ?? null
      );
    });

  readonly formationTemplateOptions = computed<FormationTemplateOption[]>(() =>
    this.vehicleCompositions()
      .map((template) => ({
        value: template.id,
        label: template.name || template.id,
        summary: this.buildFormationTemplateSummary(template),
      }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, 'de', { sensitivity: 'base' }),
      ),
  );

  readonly formationEntries = computed<TimetableFormationVehicle[]>(
    () => this.orderingContext()?.vehicleFormation ?? [],
  );

  readonly formationSummary = computed(() => {
    const entries = this.formationEntries();
    let totalLength = 0;
    let totalWeight = 0;
    let maxSpeedKph: number | null = null;
    entries.forEach((entry) => {
      if (entry.lengthMeters !== undefined) {
        totalLength += entry.lengthMeters;
      }
      if (entry.weightTons !== undefined) {
        totalWeight += entry.weightTons;
      }
      if (entry.maxSpeedKph !== undefined) {
        maxSpeedKph =
          maxSpeedKph === null
            ? entry.maxSpeedKph
            : Math.min(maxSpeedKph, entry.maxSpeedKph);
      }
    });
    return {
      units: entries.length,
      totalLengthMeters: totalLength > 0 ? totalLength : null,
      totalWeightTons: totalWeight > 0 ? totalWeight : null,
      maxSpeedKph,
    };
  });

  readonly canAddSelectedFormationVehicle = computed(
    () => this.selectedFormationVehicleOption() !== null,
  );

  readonly canApplyFormationTemplate = computed(() => {
    const selectedId = this.selectedFormationTemplateId().trim();
    if (!selectedId) {
      return false;
    }
    return this.vehicleCompositions().some((template) => template.id === selectedId);
  });

  readonly canAddPwgEntry = computed(() => {
    const context = this.orderingContext();
    return (
      context?.serviceType === 'pwg' &&
      context.pwgLengthMeters !== undefined &&
      context.pwgWeightTons !== undefined &&
      context.pwgMaxSpeedKph !== undefined
    );
  });

  readonly hasTrafficTypeValues = computed(() => {
    const context = this.orderingContext();
    return !!context?.trafficTypeCode?.trim() || !!context?.trafficTypeNetwork?.trim();
  });

  readonly hasPwgMetricValues = computed(() => {
    const context = this.orderingContext();
    return (
      context?.pwgLengthMeters !== undefined ||
      context?.pwgWeightTons !== undefined ||
      context?.pwgMaxSpeedKph !== undefined
    );
  });

  readonly hasFormationEntries = computed(
    () => this.formationEntries().length > 0,
  );

  readonly orderingProgress = computed(() => {
    const context = this.orderingContext();
    const groups: OrderingProgressGroupState[] = ORDERING_PROGRESS_GROUPS.map((group) => {
      const filled = group.fields.reduce(
        (count, field) =>
          count + (this.hasRequiredFieldValue(context, field) ? 1 : 0),
        0,
      );
      const total = group.fields.length;
      return {
        ...group,
        filled,
        total,
        complete: total > 0 && filled === total,
      };
    });
    const total = groups.reduce((sum, group) => sum + group.total, 0);
    const filled = groups.reduce((sum, group) => sum + group.filled, 0);
    return {
      groups,
      total,
      filled,
      complete: total > 0 && filled === total,
    };
  });

  readonly canProceedToRoute = computed(() =>
    this.isOrderingContextComplete(this.orderingContext()),
  );

  readonly canProceedToTiming = computed(() => {
    if (!this.canProceedToRoute()) {
      return false;
    }
    const draft = this.routeDraft();
    if (!draft) {
      return false;
    }
    const hasOrigin = draft.stops.some((stop) => stop.kind === 'origin');
    const hasDestination = draft.stops.some((stop) => stop.kind === 'destination');
    return hasOrigin && hasDestination;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const planId = params.get('planId');
      if (planId !== this.planId()) {
        this.planId.set(planId);
        void this.loadPlan(planId);
      }
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.returnUrl.set(params.get('returnUrl') ?? '/');
      this.orderId.set(params.get('orderId'));
      this.itemId.set(params.get('itemId'));
      this.queryValidityStart.set(params.get('validityStart'));
      this.queryValidityEnd.set(params.get('validityEnd'));
      this.normalizeOrderingContextToCurrentRange();
    });

    effect(() => {
      if (!this.autoSaveEnabled()) {
        return;
      }
      const signature = this.buildDraftSignature();
      if (!signature || signature === this.lastDraftSignature) {
        return;
      }
      this.lastDraftSignature = signature;
      const bundle = this.buildDraftBundle();
      if (bundle) {
        this.queueAutoSave(bundle);
      }
    });
  }

  async loadPlan(planId: string | null) {
    if (!planId) {
      this.error.set('Kein Fahrplan ausgewählt.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    let plan = this.trainPlans.getById(planId);
    if (!plan) {
      await this.trainPlans.refresh();
      plan = this.trainPlans.getById(planId);
    }
    if (!plan) {
      this.error.set('Fahrplan nicht gefunden.');
      this.loading.set(false);
      return;
    }
    this.plan.set(plan);
    this.initializeDrafts(plan);
    this.loading.set(false);
    this.assistantUiContext.setBreadcrumbs(['Auftragsmanager', 'Fahrplan-Editor']);
    this.assistantUiContext.setDocKey('timetable-editor');
    this.assistantUiContext.setDocSubtopic('Fahrplan-Editor');
  }

  onRouteDraftChange(next: RouteDraft) {
    this.routeDraft.set(next);
    let timetableDraft = this.timetableDraft();
    if (!timetableDraft) {
      return;
    }
    if (timetableDraft && next.previewStartTimeIso) {
      timetableDraft = this.shiftTimetableStart(timetableDraft, next.previewStartTimeIso);
    }
    if (!this.timetableEdited) {
      const startTimeIso = next.previewStartTimeIso ?? timetableDraft.startTimeIso;
      timetableDraft = {
        ...timetableDraft,
        startTimeIso,
        points: buildTimingPointsFromRoute(next, startTimeIso),
      };
      this.timetableDraft.set(timetableDraft);
      return;
    }
    const synced = this.syncTimetableDraft(next, timetableDraft);
    if (synced) {
      this.timetableDraft.set(synced);
    }
  }

  onTimetableDraftChange(next: TimetableDraft) {
    this.timetableEdited = true;
    this.timetableDraft.set(next);
  }

  onPatternChange(next: PatternDefinition | null) {
    this.patternDefinition.set(next);
  }

  orderingHelp(key: keyof typeof ORDERING_HELP_TEXT): string {
    return ORDERING_HELP_TEXT[key] ?? '';
  }

  orderingFieldValue(key: OrderingFieldKey): string {
    const value = this.orderingContext()?.[key];
    return typeof value === 'string' ? value : '';
  }

  otnOrNameValue(): string {
    return this.orderingContext()?.otnOrNameInput ?? '';
  }

  validityDisplayValue(): string {
    const selected = this.validitySelectedDates();
    if (!selected.length) {
      return '';
    }
    if (selected.length === 1) {
      return selected[0];
    }
    return `${selected.length} Tage (${selected[0]} – ${selected[selected.length - 1]})`;
  }

  updateOtnOrName(rawValue: string): void {
    const trimmed = rawValue.trim();
    const next = {
      ...(this.orderingContext() ?? {}),
      otnOrNameInput: trimmed || undefined,
    };
    const derived = this.deriveOtnAndName(trimmed);
    this.setOrderingContext({
      ...next,
      operationalTrainNumber: derived.operationalTrainNumber,
      trainName: derived.trainName,
    });
  }

  updateOrderingField(key: OrderingFieldKey, rawValue: string): void {
    const trimmed = rawValue.trim();
    this.setOrderingContext({
      ...(this.orderingContext() ?? {}),
      [key]: trimmed || undefined,
    });
  }

  updateServiceType(rawValue: string): void {
    this.selectedFormationVehicleTypeId.set('');
    const trimmed = rawValue.trim();
    const normalized = this.normalizeServiceType(trimmed);
    this.setOrderingContext({
      ...(this.orderingContext() ?? {}),
      serviceType: normalized,
    });
  }

  selectFormationVehicleType(value: string): void {
    this.selectedFormationVehicleTypeId.set(value?.trim() || '');
  }

  selectFormationTemplate(value: string): void {
    this.selectedFormationTemplateId.set(value?.trim() || '');
  }

  updatePwgField(
    key: 'pwgLengthMeters' | 'pwgWeightTons' | 'pwgMaxSpeedKph',
    rawValue: string,
  ): void {
    const next = this.parsePositiveNumber(rawValue);
    this.setOrderingContext({
      ...(this.orderingContext() ?? {}),
      [key]: next,
    });
  }

  isRequiredFieldMissing(field: RequiredOrderingFieldKey): boolean {
    return !this.hasRequiredFieldValue(this.orderingContext(), field);
  }

  clearTrafficTypeFields(): void {
    if (!this.hasTrafficTypeValues()) {
      return;
    }
    this.setOrderingContext({
      ...(this.orderingContext() ?? {}),
      trafficTypeCode: undefined,
      trafficTypeNetwork: undefined,
    });
  }

  clearPwgMetrics(): void {
    if (!this.hasPwgMetricValues()) {
      return;
    }
    this.setOrderingContext({
      ...(this.orderingContext() ?? {}),
      pwgLengthMeters: undefined,
      pwgWeightTons: undefined,
      pwgMaxSpeedKph: undefined,
    });
  }

  clearFormationEntries(): void {
    if (!this.hasFormationEntries()) {
      return;
    }
    this.setOrderingContext({
      ...(this.orderingContext() ?? {}),
      vehicleFormation: undefined,
    });
    this.showFormationReorderFeedback('Formation wurde geleert.');
  }

  addSelectedFormationVehicle(): void {
    const option = this.selectedFormationVehicleOption();
    if (!option) {
      return;
    }
    const current = this.orderingContext() ?? {};
    const nextFormation: TimetableFormationVehicle[] = [
      ...(current.vehicleFormation ?? []),
      {
        entryId: createDraftId('vehicle'),
        serviceType: option.serviceType,
        code: option.code,
        label: this.vehicleTypeLabel(option.value),
        source: 'catalog',
        lengthMeters: option.lengthMeters,
        weightTons: option.weightTons,
        maxSpeedKph: option.maxSpeedKph,
      },
    ];
    this.setOrderingContext({
      ...current,
      vehicleFormation: nextFormation,
      serviceType: current.serviceType ?? option.serviceType,
    });
  }

  addPwgEntry(): void {
    const context = this.orderingContext();
    if (
      !context ||
      context.serviceType !== 'pwg' ||
      context.pwgLengthMeters === undefined ||
      context.pwgWeightTons === undefined ||
      context.pwgMaxSpeedKph === undefined
    ) {
      return;
    }
    const nextFormation: TimetableFormationVehicle[] = [
      ...(context.vehicleFormation ?? []),
      {
        entryId: createDraftId('pwg'),
        serviceType: 'pwg',
        code: 'PWG',
        label: 'PWG (pauschal)',
        source: 'manual',
        lengthMeters: context.pwgLengthMeters,
        weightTons: context.pwgWeightTons,
        maxSpeedKph: context.pwgMaxSpeedKph,
      },
    ];
    this.setOrderingContext({
      ...context,
      vehicleFormation: nextFormation,
    });
  }

  applyFormationTemplate(): void {
    const templateId = this.selectedFormationTemplateId().trim();
    if (!templateId) {
      return;
    }
    const template = this.vehicleCompositions().find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }
    const typeMap = this.vehicleTypeById();
    const additions: TimetableFormationVehicle[] = [];
    template.entries.forEach((entry) => {
      const quantity = Number(entry.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return;
      }
      const vehicleType = typeMap.get(entry.typeId);
      if (!vehicleType) {
        return;
      }
      const mappedServiceType = serviceTypeForVehicleType(vehicleType);
      if (!mappedServiceType) {
        return;
      }
      const count = Math.floor(quantity);
      for (let index = 0; index < count; index += 1) {
        additions.push({
          entryId: createDraftId('vehicle'),
          serviceType: mappedServiceType,
          code: vehicleType.trainTypeCode?.trim() || vehicleType.id,
          label: vehicleType.label || vehicleType.id,
          source: 'catalog',
          lengthMeters: this.normalizePositiveNumber(vehicleType.lengthMeters),
          weightTons: this.normalizePositiveNumber(vehicleType.weightTons),
          maxSpeedKph: this.normalizePositiveNumber(vehicleType.maxSpeed),
        });
      }
    });
    if (!additions.length) {
      return;
    }
    const current = this.orderingContext() ?? {};
    this.setOrderingContext({
      ...current,
      vehicleFormation: additions,
      serviceType: additions[0].serviceType,
    });
    this.selectedFormationVehicleTypeId.set('');
  }

  removeFormationEntry(entryId: string): void {
    const current = this.orderingContext();
    if (!current?.vehicleFormation?.length) {
      return;
    }
    const nextFormation = current.vehicleFormation.filter((entry) => entry.entryId !== entryId);
    this.setOrderingContext({
      ...current,
      vehicleFormation: nextFormation,
    });
  }

  reorderFormationEntries(event: CdkDragDrop<TimetableFormationVehicle[]>): void {
    const current = this.orderingContext();
    if (!current?.vehicleFormation?.length) {
      return;
    }
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    const nextFormation = [...current.vehicleFormation];
    moveItemInArray(nextFormation, event.previousIndex, event.currentIndex);
    this.setOrderingContext({
      ...current,
      vehicleFormation: nextFormation,
    });
    const moved = nextFormation[event.currentIndex];
    if (moved) {
      this.showFormationReorderFeedback(
        `Reihenfolge gespeichert: ${moved.label} ist jetzt #${event.currentIndex + 1}.`,
      );
    } else {
      this.showFormationReorderFeedback('Reihenfolge gespeichert.');
    }
  }

  formationEntryMetric(entry: TimetableFormationVehicle): string {
    const values: string[] = [];
    if (entry.lengthMeters !== undefined) {
      values.push(`${entry.lengthMeters} m`);
    }
    if (entry.weightTons !== undefined) {
      values.push(`${entry.weightTons} t`);
    }
    if (entry.maxSpeedKph !== undefined) {
      values.push(`${entry.maxSpeedKph} km/h`);
    }
    return values.join(' · ');
  }

  formationDiagramCode(entry: TimetableFormationVehicle): string {
    const code = entry.code?.trim();
    if (code) {
      return this.truncateText(code, 14);
    }
    return this.truncateText(entry.label?.trim() || 'Einheit', 14);
  }

  formationDiagramMetrics(entry: TimetableFormationVehicle): string {
    const length = entry.lengthMeters !== undefined ? `${entry.lengthMeters}m` : '-';
    const weight = entry.weightTons !== undefined ? `${entry.weightTons}t` : '-';
    const speed = entry.maxSpeedKph !== undefined ? `${entry.maxSpeedKph}` : '-';
    return this.truncateText(`L:${length} G:${weight} V:${speed}`, 30);
  }

  formationEntryTooltip(entry: TimetableFormationVehicle): string {
    const typeLabel =
      entry.serviceType === 'tractive_unit'
        ? 'Triebfahrzeug'
        : entry.serviceType === 'wagon'
          ? 'Wagen'
          : 'PWG';
    const length = entry.lengthMeters !== undefined ? `${entry.lengthMeters} m` : 'nicht gesetzt';
    const weight = entry.weightTons !== undefined ? `${entry.weightTons} t` : 'nicht gesetzt';
    const speed = entry.maxSpeedKph !== undefined ? `${entry.maxSpeedKph} km/h` : 'nicht gesetzt';
    return [
      `Typ: ${typeLabel}`,
      `Code: ${entry.code}`,
      `Name: ${entry.label}`,
      `Länge: ${length}`,
      `Gewicht: ${weight}`,
      `vMax: ${speed}`,
    ].join(' · ');
  }

  formationEntryAriaLabel(entry: TimetableFormationVehicle): string {
    const typeLabel =
      entry.serviceType === 'tractive_unit'
        ? 'Triebfahrzeug'
        : entry.serviceType === 'wagon'
          ? 'Wagen'
          : 'PWG';
    const metric = this.formationEntryMetric(entry);
    const suffix = metric ? `, ${metric}` : '';
    return `${typeLabel}: ${entry.code} ${entry.label}${suffix}`;
  }

  formatSummaryValue(value: number | null | undefined, unit: string): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '—';
    }
    return `${Math.round(value * 10) / 10} ${unit}`;
  }

  openValidityCalendar(): void {
    this.validityCalendarOpen.set(true);
  }

  closeValidityCalendar(): void {
    this.validityCalendarOpen.set(false);
  }

  onValidityDatesChange(nextDates: string[]): void {
    const selected = this.normalizeDateListToRange(nextDates, this.validityRange());
    const fallback =
      this.validitySelectedDates()[0] ?? this.defaultValidityDate(this.validityRange());
    const nextValidityDates = selected.length ? selected : [fallback];
    this.setOrderingContext({
      ...(this.orderingContext() ?? {}),
      validityDate: nextValidityDates[0],
      validityDates: nextValidityDates,
    });
  }

  async applyAndReturn() {
    const bundle = this.buildDraftBundle();
    if (bundle) {
      const ok = await this.persistBundle(bundle);
      if (!ok) {
        return;
      }
    }
    this.navigateBack();
  }

  navigateBack() {
    const url = this.returnUrl();
    void this.router.navigateByUrl(url || '/');
  }

  setStep(step: EditorStep) {
    if (step === 'route' && !this.canProceedToRoute()) {
      return;
    }
    if (step === 'timing' && !this.canProceedToTiming()) {
      return;
    }
    this.activeStep.set(step);
  }

  goToOrdering() {
    this.setStep('ordering');
  }

  goToRoute() {
    this.setStep('route');
  }

  goToTiming() {
    this.setStep('timing');
  }

  private initializeDrafts(plan: TrainPlan) {
    this.autoSaveEnabled.set(false);
    this.saveState.set('idle');
    this.lastSavedIso.set(null);
    this.timetableEdited = false;
    this.validityCalendarOpen.set(false);
    this.formationReorderMessage.set(null);
    if (this.reorderFeedbackTimer !== null) {
      window.clearTimeout(this.reorderFeedbackTimer);
      this.reorderFeedbackTimer = null;
    }

    const existing = plan.routeMetadata?.timetableDrafts;
    const validExisting =
      existing && (existing.schemaVersion === 1 || existing.schemaVersion === 2)
        ? existing
        : null;

    let routeDraft = validExisting?.routeDraft ?? this.createRouteDraft(plan);
    routeDraft = {
      ...routeDraft,
      trainPlanId: plan.id,
      segments: buildSegments(routeDraft.stops, routeDraft.assumptions, routeDraft.segments),
    };

    let timetableDraft =
      validExisting?.timetableDraft ?? this.createTimetableDraft(plan, routeDraft);
    timetableDraft = this.syncTimetableDraft(routeDraft, timetableDraft) ?? timetableDraft;

    const routingOptions = {
      includeLinkSections: true,
      maxAlternatives: 2,
      ...(routeDraft.routingOptions ?? {}),
    };

    const previewStartTimeIso = routeDraft.previewStartTimeIso ?? timetableDraft.startTimeIso;
    routeDraft = {
      ...routeDraft,
      routingOptions,
      previewStartTimeIso,
      updatedAtIso:
        routeDraft.previewStartTimeIso !== previewStartTimeIso ||
        routeDraft.routingOptions !== routingOptions
          ? nowIso()
          : routeDraft.updatedAtIso,
    };

    const range = this.validityRange();
    const draftOrderingContext = validExisting?.orderingContext;
    const persistedOrderingContext = plan.routeMetadata?.orderingContext;
    const fallbackOrderingContext = this.createOrderingContext(plan, range);
    const orderingContext = this.normalizeOrderingContext(
      draftOrderingContext ?? persistedOrderingContext ?? fallbackOrderingContext,
      range,
      fallbackOrderingContext,
    );

    const alignedPreviewIso = this.buildPreviewStartIsoForDate(
      routeDraft.previewStartTimeIso,
      orderingContext.validityDate,
    );
    if (alignedPreviewIso && routeDraft.previewStartTimeIso !== alignedPreviewIso) {
      routeDraft = {
        ...routeDraft,
        previewStartTimeIso: alignedPreviewIso,
        updatedAtIso: nowIso(),
      };
      timetableDraft = this.shiftTimetableStart(timetableDraft, alignedPreviewIso);
    }

    const pattern = validExisting?.patternDefinition ?? null;
    this.routeDraft.set(routeDraft);
    this.timetableDraft.set(timetableDraft);
    this.patternDefinition.set(pattern);
    this.orderingContext.set(orderingContext);
    this.activeStep.set('ordering');
    this.lastDraftSignature = this.buildDraftSignature();
    this.autoSaveEnabled.set(true);
  }

  private createRouteDraft(plan: TrainPlan): RouteDraft {
    const stops: RouteStop[] = (plan.stops ?? []).map((stop) => ({
      stopId: createDraftId('stop'),
      kind:
        stop.type === 'origin'
          ? 'origin'
          : stop.type === 'destination'
            ? 'destination'
            : 'stop',
      op: stop.locationName
        ? { id: stop.locationCode, name: stop.locationName }
        : undefined,
      dwellSeconds: stop.dwellMinutes ? stop.dwellMinutes * 60 : undefined,
      refs: {
        location: {
          country: stop.countryCode ?? 'CH',
          primaryCode: stop.locationCode,
        },
      },
    }));
    const previewStartTimeIso = `${plan.calendar.validFrom}T08:00:00`;
    return {
      draftId: createDraftId('route'),
      trainPlanId: plan.id,
      stops,
      segments: [],
      assumptions: {
        defaultSpeedKph: DEFAULT_SPEED_KPH,
        defaultDwellSeconds: DEFAULT_DWELL_SECONDS,
      },
      routingOptions: {
        includeLinkSections: true,
        maxAlternatives: 2,
      },
      previewStartTimeIso,
      createdAtIso: nowIso(),
      updatedAtIso: nowIso(),
    };
  }

  private createTimetableDraft(plan: TrainPlan, routeDraft: RouteDraft): TimetableDraft {
    const dateIso = plan.calendar.validFrom;
    const startTimeIso = routeDraft.previewStartTimeIso ?? `${dateIso}T08:00:00`;
    const points = buildTimingPointsFromRoute(routeDraft, startTimeIso);
    return {
      draftId: createDraftId('timetable'),
      routeDraftId: routeDraft.draftId,
      startTimeIso,
      points,
    };
  }

  private syncTimetableDraft(routeDraft: RouteDraft, draft: TimetableDraft | null): TimetableDraft | null {
    if (!draft) {
      return null;
    }
    const stopIds = routeDraft.stops.map((stop) => stop.stopId);
    const existing = new Map(draft.points.map((point) => [point.stopId, point] as const));
    let cursorIso = draft.startTimeIso;
    const points: TimetableDraft['points'] = stopIds.map((stopId, index) => {
      const stop = routeDraft.stops[index];
      const existingPoint = existing.get(stopId);
      if (existingPoint) {
        const anchor = existingPoint.departureIso ?? existingPoint.arrivalIso ?? cursorIso;
        if (anchor) {
          cursorIso = anchor;
        }
        return { ...existingPoint };
      }
      if (index > 0) {
        const segment = routeDraft.segments[index - 1];
        cursorIso = addSecondsToIso(cursorIso, segment?.estimatedTravelSeconds ?? 0) ?? cursorIso;
      }
      const arrivalIso = cursorIso;
      if (stop.kind === 'destination' || stop.kind === 'pass') {
        return { stopId, arrivalIso };
      }
      const dwellSeconds = stop.dwellSeconds ?? routeDraft.assumptions.defaultDwellSeconds;
      const departureIso = addSecondsToIso(arrivalIso, dwellSeconds) ?? arrivalIso;
      cursorIso = departureIso;
      return { stopId, arrivalIso, departureIso };
    });
    return {
      ...draft,
      routeDraftId: routeDraft.draftId,
      points,
    };
  }

  private shiftTimetableStart(draft: TimetableDraft, nextStartIso: string): TimetableDraft {
    if (!nextStartIso || draft.startTimeIso === nextStartIso) {
      return draft;
    }
    const currentStartMs = parseIsoToUtcMs(draft.startTimeIso);
    const nextStartMs = parseIsoToUtcMs(nextStartIso);
    if (!Number.isFinite(currentStartMs) || !Number.isFinite(nextStartMs)) {
      return { ...draft, startTimeIso: nextStartIso };
    }
    const deltaMs = nextStartMs - currentStartMs;
    if (!Number.isFinite(deltaMs) || deltaMs === 0) {
      return { ...draft, startTimeIso: nextStartIso };
    }
    const shiftIso = (iso?: string) => {
      if (!iso) {
        return undefined;
      }
      const ms = parseIsoToUtcMs(iso);
      if (!Number.isFinite(ms)) {
        return iso;
      }
      return formatUtcMsToIso(ms + deltaMs);
    };
    return {
      ...draft,
      startTimeIso: nextStartIso,
      points: draft.points.map((point) => ({
        ...point,
        arrivalIso: shiftIso(point.arrivalIso),
        departureIso: shiftIso(point.departureIso),
      })),
    };
  }

  private buildDraftBundle(): TimetableDraftBundle | null {
    if (!this.routeDraft() || !this.timetableDraft()) {
      return null;
    }
    return {
      schemaVersion: 2,
      routeDraft: this.routeDraft() ?? undefined,
      timetableDraft: this.timetableDraft() ?? undefined,
      patternDefinition: this.patternDefinition() ?? undefined,
      orderingContext: this.orderingContext() ?? undefined,
      updatedAtIso: nowIso(),
    };
  }

  private buildDraftSignature(): string | null {
    const routeDraft = this.routeDraft();
    const timetableDraft = this.timetableDraft();
    if (!routeDraft || !timetableDraft) {
      return null;
    }
    return JSON.stringify({
      routeDraft,
      timetableDraft,
      patternDefinition: this.patternDefinition(),
      orderingContext: this.orderingContext(),
    });
  }

  private queueAutoSave(bundle: TimetableDraftBundle) {
    this.pendingBundle = bundle;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushAutoSave();
    }, 800);
  }

  private async flushAutoSave() {
    if (this.saveInFlight) {
      if (this.pendingBundle && this.saveTimer === null) {
        this.saveTimer = window.setTimeout(() => {
          this.saveTimer = null;
          void this.flushAutoSave();
        }, 400);
      }
      return;
    }
    const bundle = this.pendingBundle;
    if (!bundle) {
      return;
    }
    this.pendingBundle = null;
    await this.persistBundle(bundle);
    if (this.pendingBundle) {
      await this.flushAutoSave();
    }
  }

  private async persistBundle(bundle: TimetableDraftBundle): Promise<boolean> {
    const plan = this.plan();
    if (!plan) {
      return false;
    }
    this.saveInFlight = true;
    this.saveState.set('saving');
    const nextPlan: TrainPlan = {
      ...plan,
      routeMetadata: {
        ...(plan.routeMetadata ?? {}),
        orderingContext: this.orderingContext() ?? undefined,
        timetableDrafts: bundle,
      },
    };
    const saved = await this.trainPlans.savePlan(nextPlan);
    if (saved) {
      this.plan.set(saved);
      this.saveState.set('saved');
      this.lastSavedIso.set(bundle.updatedAtIso);
      this.saveInFlight = false;
      return true;
    }
    this.saveState.set('error');
    this.saveInFlight = false;
    return false;
  }

  private setOrderingContext(next: TimetableOrderingContext): void {
    const normalized = this.normalizeOrderingContext(
      next,
      this.validityRange(),
      this.createOrderingContext(this.plan(), this.validityRange()),
    );
    this.orderingContext.set(normalized);
    this.applyOrderingValidityToDrafts(normalized.validityDate);
  }

  private normalizeOrderingContextToCurrentRange(): void {
    const current = this.orderingContext();
    if (!current) {
      return;
    }
    const fallback = this.createOrderingContext(this.plan(), this.validityRange());
    const normalized = this.normalizeOrderingContext(current, this.validityRange(), fallback);
    if (JSON.stringify(current) === JSON.stringify(normalized)) {
      return;
    }
    this.orderingContext.set(normalized);
    this.applyOrderingValidityToDrafts(normalized.validityDate);
  }

  private normalizeOrderingContext(
    value: TimetableOrderingContext | null | undefined,
    range: ValidityRange,
    fallback: TimetableOrderingContext,
  ): TimetableOrderingContext {
    const raw = value ?? {};
    const otnOrNameInput = this.trimToUndefined(raw.otnOrNameInput);
    const derived = this.deriveOtnAndName(otnOrNameInput);
    const fallbackValidityDate =
      this.clampDateToRange(fallback.validityDate?.trim(), range) ??
      this.defaultValidityDate(range);
    const validityDates = this.normalizeValidityDates(
      raw.validityDates,
      raw.validityDate,
      range,
      fallbackValidityDate,
    );
    const validityDate = validityDates[0] ?? fallbackValidityDate;
    const vehicleFormation = this.normalizeVehicleFormation(raw.vehicleFormation);
    const pwgLengthMeters = this.normalizePositiveNumber(raw.pwgLengthMeters);
    const pwgWeightTons = this.normalizePositiveNumber(raw.pwgWeightTons);
    const pwgMaxSpeedKph = this.normalizePositiveNumber(raw.pwgMaxSpeedKph);
    const tractionOrPwg =
      this.buildTractionOrPwgSummary(vehicleFormation, {
        lengthMeters: pwgLengthMeters,
        weightTons: pwgWeightTons,
        maxSpeedKph: pwgMaxSpeedKph,
      }) ?? this.trimToUndefined(raw.tractionOrPwg);

    return {
      otnOrNameInput,
      operationalTrainNumber: derived.operationalTrainNumber,
      trainName: derived.trainName,
      reasonOfReference: this.trimToUndefined(raw.reasonOfReference),
      validityDate,
      validityDates,
      trainType: this.trimToUndefined(raw.trainType),
      trafficTypeCode: this.trimToUndefined(raw.trafficTypeCode),
      trafficTypeNetwork: this.trimToUndefined(raw.trafficTypeNetwork),
      serviceType: this.normalizeServiceType(raw.serviceType),
      vehicleFormation,
      pwgLengthMeters,
      pwgWeightTons,
      pwgMaxSpeedKph,
      tractionOrPwg,
      debtorCode: this.trimToUndefined(raw.debtorCode),
      distributionList: this.trimToUndefined(raw.distributionList),
      freeProcessingReason: this.trimToUndefined(raw.freeProcessingReason),
    };
  }

  private createOrderingContext(
    plan: TrainPlan | null,
    range: ValidityRange,
  ): TimetableOrderingContext {
    const seed = plan?.trainNumber?.trim() || '';
    const derived = this.deriveOtnAndName(seed);
    const validityDate = this.defaultValidityDate(range);
    return {
      otnOrNameInput: seed || undefined,
      operationalTrainNumber: derived.operationalTrainNumber,
      trainName: derived.trainName,
      validityDate,
      validityDates: [validityDate],
      trainType: this.trainTypeFromTechnical(plan?.technical?.trainType),
      freeProcessingReason: 'path_modification_due_to_path_alteration',
    };
  }

  private defaultValidityDate(range: ValidityRange): string {
    const todayIso = new Date().toISOString().slice(0, 10);
    return this.clampDateToRange(todayIso, range) ?? range.startIso;
  }

  private deriveOtnAndName(value: string | undefined): {
    operationalTrainNumber?: string;
    trainName?: string;
  } {
    const trimmed = value?.trim();
    if (!trimmed) {
      return {};
    }
    if (/^[1-9][0-9]{0,4}$/.test(trimmed)) {
      return { operationalTrainNumber: trimmed };
    }
    return { trainName: trimmed };
  }

  private normalizeServiceType(
    value: string | TimetableFormationServiceType | undefined,
  ): TimetableFormationServiceType | undefined {
    const normalized = value?.trim();
    if (
      normalized === 'tractive_unit' ||
      normalized === 'wagon' ||
      normalized === 'pwg'
    ) {
      return normalized;
    }
    return undefined;
  }

  private normalizeVehicleFormation(
    value: TimetableOrderingContext['vehicleFormation'],
  ): TimetableFormationVehicle[] | undefined {
    if (!Array.isArray(value) || !value.length) {
      return undefined;
    }
    const normalized: TimetableFormationVehicle[] = [];
    value.forEach((entry) => {
      const serviceType = this.normalizeServiceType(entry?.serviceType);
      if (!serviceType) {
        return;
      }
      const code = this.trimToUndefined(entry.code) ?? this.trimToUndefined(entry.label);
      const label = this.trimToUndefined(entry.label) ?? code;
      if (!code || !label) {
        return;
      }
      const normalizedEntry: TimetableFormationVehicle = {
        entryId: this.trimToUndefined(entry.entryId) ?? createDraftId('vehicle'),
        serviceType,
        code,
        label,
        source: entry.source === 'manual' ? 'manual' : 'catalog',
      };
      const length = this.normalizePositiveNumber(entry.lengthMeters);
      const weight = this.normalizePositiveNumber(entry.weightTons);
      const speed = this.normalizePositiveNumber(entry.maxSpeedKph);
      if (length !== undefined) {
        normalizedEntry.lengthMeters = length;
      }
      if (weight !== undefined) {
        normalizedEntry.weightTons = weight;
      }
      if (speed !== undefined) {
        normalizedEntry.maxSpeedKph = speed;
      }
      normalized.push(normalizedEntry);
    });
    return normalized.length ? normalized : undefined;
  }

  private normalizePositiveNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    const rounded = Math.round(parsed * 10) / 10;
    return rounded > 0 ? rounded : undefined;
  }

  private parsePositiveNumber(value: string): number | undefined {
    const normalized = value?.trim().replace(',', '.');
    if (!normalized) {
      return undefined;
    }
    return this.normalizePositiveNumber(Number(normalized));
  }

  private buildTractionOrPwgSummary(
    formation: TimetableFormationVehicle[] | undefined,
    pwg: {
      lengthMeters?: number;
      weightTons?: number;
      maxSpeedKph?: number;
    },
  ): string | undefined {
    const parts = (formation ?? [])
      .map((entry) => {
        const code = entry.code.trim();
        return code.length ? code : entry.label.trim();
      })
      .filter((entry) => entry.length > 0);
    if (parts.length) {
      return parts.join(' + ');
    }
    if (
      pwg.lengthMeters !== undefined ||
      pwg.weightTons !== undefined ||
      pwg.maxSpeedKph !== undefined
    ) {
      const metrics: string[] = [];
      if (pwg.lengthMeters !== undefined) {
        metrics.push(`${pwg.lengthMeters}m`);
      }
      if (pwg.weightTons !== undefined) {
        metrics.push(`${pwg.weightTons}t`);
      }
      if (pwg.maxSpeedKph !== undefined) {
        metrics.push(`${pwg.maxSpeedKph}km/h`);
      }
      return metrics.length ? `PWG ${metrics.join(' / ')}` : 'PWG';
    }
    return undefined;
  }

  private buildFormationTemplateSummary(template: VehicleComposition): string {
    const totalUnits = template.entries.reduce((sum, entry) => {
      const quantity = Number(entry.quantity);
      return Number.isFinite(quantity) && quantity > 0 ? sum + Math.floor(quantity) : sum;
    }, 0);
    return totalUnits > 0 ? `${totalUnits} Einheiten` : '0 Einheiten';
  }

  private vehicleTypeLabel(typeId: string): string {
    const type = this.vehicleTypeById().get(typeId);
    return type?.label?.trim() || typeId;
  }

  private trainTypeFromTechnical(value: string | undefined): string {
    const normalized = value?.trim().toLowerCase() ?? '';
    if (!normalized) {
      return '1';
    }
    if (normalized.includes('freight') || normalized.includes('cargo') || normalized.includes('gueter')) {
      return '2';
    }
    if (normalized.includes('light')) {
      return '3';
    }
    if (normalized.includes('engineering')) {
      return '4';
    }
    if (normalized.includes('emergency')) {
      return '5';
    }
    if (normalized.includes('mixed')) {
      return '6';
    }
    if (normalized.includes('passenger') || normalized.includes('person')) {
      return '1';
    }
    return '0';
  }

  private trimToUndefined(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private truncateText(value: string, maxLength: number): string {
    const normalized = value.trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private normalizeValidityDates(
    rawDates: readonly string[] | undefined,
    rawSingleDate: string | undefined,
    range: ValidityRange,
    fallbackDate: string,
  ): string[] {
    const dates = new Set<string>(this.normalizeDateListToRange(rawDates ?? [], range));
    const single = this.clampDateToRange(rawSingleDate?.trim(), range);
    if (single) {
      dates.add(single);
    }
    if (!dates.size && fallbackDate) {
      dates.add(fallbackDate);
    }
    return Array.from(dates).sort();
  }

  private normalizeDateList(values: readonly string[] | undefined): string[] {
    const dates = new Set<string>();
    for (const value of values ?? []) {
      const normalized = this.normalizeIsoDate(value);
      if (normalized) {
        dates.add(normalized);
      }
    }
    return Array.from(dates).sort();
  }

  private normalizeDateListToRange(
    values: readonly string[] | undefined,
    range: ValidityRange,
  ): string[] {
    const dates = new Set<string>();
    for (const value of values ?? []) {
      const clamped = this.clampDateToRange(value, range);
      if (clamped) {
        dates.add(clamped);
      }
    }
    return Array.from(dates).sort();
  }

  private isOrderingContextComplete(context: TimetableOrderingContext | null): boolean {
    if (!context) {
      return false;
    }
    return ORDERING_REQUIRED_FIELDS.every((field) =>
      this.hasRequiredFieldValue(context, field),
    );
  }

  private hasRequiredFieldValue(
    context: TimetableOrderingContext | null | undefined,
    field: RequiredOrderingFieldKey,
  ): boolean {
    if (!context) {
      return false;
    }
    if (field === 'validityDate') {
      return (
        this.validitySelectedDates().length > 0 ||
        !!context.validityDate?.trim()
      );
    }
    if (field === 'serviceType') {
      return !!context.serviceType?.trim();
    }
    if (field === 'otnOrNameInput') {
      return !!context.otnOrNameInput?.trim();
    }
    const value = context[field];
    return typeof value === 'string' && value.trim().length > 0;
  }

  private showFormationReorderFeedback(message: string): void {
    this.formationReorderMessage.set(message);
    if (this.reorderFeedbackTimer !== null) {
      window.clearTimeout(this.reorderFeedbackTimer);
    }
    this.reorderFeedbackTimer = window.setTimeout(() => {
      this.reorderFeedbackTimer = null;
      this.formationReorderMessage.set(null);
    }, 1800);
  }

  private applyOrderingValidityToDrafts(validityDate: string | undefined): void {
    if (!validityDate) {
      return;
    }
    const draft = this.routeDraft();
    if (!draft) {
      return;
    }
    const nextPreviewIso = this.buildPreviewStartIsoForDate(
      draft.previewStartTimeIso,
      validityDate,
    );
    if (!nextPreviewIso || nextPreviewIso === draft.previewStartTimeIso) {
      return;
    }
    this.onRouteDraftChange({
      ...draft,
      previewStartTimeIso: nextPreviewIso,
      updatedAtIso: nowIso(),
    });
  }

  private buildPreviewStartIsoForDate(
    existingIso: string | undefined,
    validityDate: string | undefined,
  ): string | null {
    const date = validityDate?.trim();
    if (!date || !this.isIsoDate(date)) {
      return null;
    }
    const timePart = existingIso?.split('T')[1] ?? '08:00:00';
    const normalizedTime = timePart.split('.')[0] || '08:00:00';
    const [hours, minutes] = normalizedTime.split(':');
    const hh = (hours ?? '08').padStart(2, '0');
    const mm = (minutes ?? '00').padStart(2, '0');
    return `${date}T${hh}:${mm}:00`;
  }

  private resolveValidityRange(
    plan: TrainPlan | null,
    queryStartRaw: string | null,
    queryEndRaw: string | null,
  ): ValidityRange {
    const planStart = this.normalizeIsoDate(plan?.calendar.validFrom);
    const planEnd = this.normalizeIsoDate(plan?.calendar.validTo);
    const queryStart = this.normalizeIsoDate(queryStartRaw);
    const queryEnd = this.normalizeIsoDate(queryEndRaw);

    let startIso = queryStart ?? planStart ?? new Date().toISOString().slice(0, 10);
    let endIso = queryEnd ?? planEnd ?? startIso;

    if (endIso < startIso) {
      endIso = startIso;
    }

    return {
      startIso,
      endIso,
      label: `${startIso} – ${endIso}`,
    };
  }

  private buildAllowedDatesForRange(range: ValidityRange): string[] {
    const start = new Date(`${range.startIso}T00:00:00`);
    const end = new Date(`${range.endIso}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return [];
    }
    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end && dates.length <= 1200) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  private clampDateToRange(
    rawDate: string | undefined,
    range: ValidityRange,
  ): string | null {
    const normalized = this.normalizeIsoDate(rawDate);
    if (!normalized) {
      return null;
    }
    if (normalized < range.startIso) {
      return range.startIso;
    }
    if (normalized > range.endIso) {
      return range.endIso;
    }
    return normalized;
  }

  private normalizeIsoDate(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed || !this.isIsoDate(trimmed)) {
      return null;
    }
    const parsed = new Date(`${trimmed}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : trimmed;
  }

  private isIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
}
