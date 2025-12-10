import { Component, Signal, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { GanttComponent } from '../../gantt/gantt.component';
import { GanttWindowLauncherComponent } from './components/gantt-window-launcher.component';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { PlanningDataService, PlanningTimelineRange } from './planning-data.service';
import { Resource, ResourceKind } from '../../models/resource';
import { Activity, ActivityParticipant, ActivityParticipantRole, ServiceRole } from '../../models/activity';
import {
  ActivityParticipantCategory,
  getActivityOwnerByCategory,
  getActivityOwnerId,
  getActivityParticipantIds,
} from '../../models/activity-ownership';
import {
  ActivityFieldKey,
  ActivityTypeDefinition,
  ActivityTypeService,
  ActivityCategory,
} from '../../core/services/activity-type.service';
import { TranslationService } from '../../core/services/translation.service';
import {
  ActivityCatalogService,
  ActivityAttributeValue as ActivityCatalogAttribute,
} from '../../core/services/activity-catalog.service';
import {
  PLANNING_STAGE_METAS,
  PlanningResourceCategory,
  PlanningStageId,
  PlanningStageMeta,
} from './planning-stage.model';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';
import { SimulationService } from '../../core/services/simulation.service';
import { SimulationRecord } from '../../core/models/simulation.model';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import {
  ActivityLinkRole,
  ActivityLinkRoleDialogComponent,
  ActivityLinkRoleDialogResult,
} from './activity-link-role-dialog.component';
import { TemplateTimelineStoreService } from './template-timeline-store.service';
import { PlanningBoard, PlanningStageStore, StageRuntimeState } from './stores/planning-stage.store';
import { PlanningDashboardBoardFacade, StageResourceGroupConfig } from './planning-dashboard-board.facade';
import { ActivityCatalogOption } from './planning-dashboard.types';
import {
  buildAttributesFromCatalog,
  defaultColorForType,
  defaultTemplatePeriod,
  findNeighborActivities,
  isActivityOwnedBy,
  mapLinkRoleToParticipantRole,
  computeAssignmentCandidatesFor,
  resolveServiceRole,
} from './planning-dashboard-activity.utils';
import {
  addParticipantToActivity,
  moveParticipantToResource,
  resolvePrimaryRoleForResource,
  isPrimaryParticipantRole,
  resourceParticipantCategory,
} from './planning-dashboard-participant.utils';
import { PlanningDashboardServiceAssignmentFacade } from './planning-dashboard-service-assignment.facade';
import { applyActivityCopyWithRoles, applyParticipantRoleUpdatesHelper } from './planning-dashboard-activity-copy.utils';
import { fromLocalDateTime, toIsoDate, toLocalDateTime } from './planning-dashboard-time.utils';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';

interface PendingActivityState {
  stage: PlanningStageId;
  activity: Activity;
}

interface ResourceGroupView extends StageResourceGroupConfig {
  resources: Resource[];
}

interface ActivityEditPreviewState {
  stage: PlanningStageId;
  activity: Activity;
}

const STAGE_RESOURCE_GROUPS: Record<PlanningStageId, StageResourceGroupConfig[]> = {
  base: [
    {
      category: 'vehicle-service',
      label: 'Fahrzeugdienste',
      description: 'Umläufe und Fahrzeugdienste, die in den Pools der Planwoche entworfen werden.',
      icon: 'train',
    },
    {
      category: 'personnel-service',
      label: 'Personaldienste',
      description: 'Dienstfolgen für Fahr- und Begleitpersonal innerhalb der Planwoche.',
      icon: 'badge',
    },
  ],
  operations: [
    {
      category: 'vehicle-service',
      label: 'Fahrzeugdienste (Pool)',
      description: 'Standardisierte Dienste aus der Basisplanung als Grundlage für den Jahresausroll.',
      icon: 'train',
    },
    {
      category: 'personnel-service',
      label: 'Personaldienste (Pool)',
      description: 'Personaldienste aus der Basisplanung zur Verknüpfung mit Ressourcen.',
      icon: 'assignment_ind',
    },
    {
      category: 'vehicle',
      label: 'Fahrzeuge',
      description: 'Reale Fahrzeuge, die über das Jahr disponiert und mit Diensten verknüpft werden.',
      icon: 'directions_transit',
    },
    {
      category: 'personnel',
      label: 'Personal',
      description: 'Einsatzkräfte mit Verfügbarkeiten, Leistungen sowie Ruhetagen und Ferien.',
      icon: 'groups',
    },
  ],
};

const TYPE_PICKER_META: Array<{ id: ActivityCategory; label: string; icon: string }> = [
  { id: 'rest', label: 'Freitage', icon: 'beach_access' },
  { id: 'movement', label: 'Rangieren', icon: 'precision_manufacturing' },
  { id: 'service', label: 'Dienst & Pause', icon: 'schedule' },
  { id: 'other', label: 'Sonstige', icon: 'widgets' },
];

type ActivityTypePickerGroup = {
  id: ActivityCategory;
  label: string;
  icon: string;
  items: ActivityCatalogOption[];
};

@Component({
  selector: 'app-planning-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatTabsModule,
    MatMenuModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatChipsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    DragDropModule,
    DurationPipe,
    GanttComponent,
    GanttWindowLauncherComponent,
  ],
  templateUrl: './planning-dashboard.component.html',
  styleUrl: './planning-dashboard.component.scss',
})
export class PlanningDashboardComponent {
  private readonly data = inject(PlanningDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly timetableYearService = inject(TimetableYearService);
  private readonly managedTimetableYearBounds = this.timetableYearService.managedYearBoundsSignal();
  private readonly templateStore = inject(TemplateTimelineStoreService);
  private readonly templateMetaLoad = signal(false);
  private readonly simulationService = inject(SimulationService);

  readonly stages = PLANNING_STAGE_METAS;
  private readonly stageMetaMap: Record<PlanningStageId, PlanningStageMeta> = this.stages.reduce(
    (record, stage) => {
      record[stage.id] = stage;
      return record;
    },
    {} as Record<PlanningStageId, PlanningStageMeta>,
  );

  private readonly stageOrder: PlanningStageId[] = this.stages.map((stage) => stage.id);

  private readonly stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>> = {
    base: this.data.stageResources('base'),
    operations: this.data.stageResources('operations'),
  };

  private readonly baseTimelineFallback = this.data.stageTimelineRange('base');

  private readonly stageActivitySignals: Record<PlanningStageId, Signal<Activity[]>> = {
    base: this.data.stageActivities('base'),
    operations: this.data.stageActivities('operations'),
  };

  private readonly normalizedStageActivitySignals: Record<PlanningStageId, Signal<Activity[]>> = {
    base: computed(() => this.normalizeActivityList(this.stageActivitySignals.base())),
    operations: computed(() => this.normalizeActivityList(this.stageActivitySignals.operations())),
  };

  private readonly stageStore = new PlanningStageStore();
  private readonly boardFacade = new PlanningDashboardBoardFacade({
    stageStore: this.stageStore,
    stageMetaMap: this.stageMetaMap,
    stageResourceSignals: this.stageResourceSignals,
    normalizedStageActivitySignals: this.normalizedStageActivitySignals,
    activityOwnerId: (activity) => this.activityOwnerId(activity),
    resourceGroups: STAGE_RESOURCE_GROUPS,
  });
  private readonly filterFacade = new PlanningDashboardFilterFacade({
    stageOrder: this.stageOrder,
    timetableYearService: this.timetableYearService,
    data: this.data,
  });
  private readonly activityFacade = new PlanningDashboardActivityFacade({
    activityOwnerId: (activity) => this.activityOwnerId(activity),
    addParticipantToActivity: (activity, owner, partner, partnerRole, opts) =>
      addParticipantToActivity(activity, owner, partner, partnerRole, opts),
    moveParticipantToResource: (activity, participantId, target) =>
      moveParticipantToResource(activity, participantId, target),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    definitionHasField: (definition, field) => this.definitionHasField(definition, field),
    resolveServiceCategory: (resource) => this.resolveServiceCategory(resource),
    resourceParticipantCategory: (resource) => resourceParticipantCategory(resource),
    updateStageActivities: (stage, updater) => this.updateStageActivities(stage, updater),
    replaceActivity: (activity) => this.replaceActivity(activity),
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
    buildAttributesFromCatalog: (option) => buildAttributesFromCatalog(option),
    resolveServiceRole: (option) => resolveServiceRole(option),
    buildActivityTitle: (definition) => this.buildActivityTitle(definition),
    generateActivityId: (seed) => this.generateActivityId(seed),
    findActivityType: (typeId) => this.findActivityType(typeId),
  });
  private readonly activitySelection = new PlanningDashboardActivitySelectionFacade();

  private readonly stageTimelineSignals = {
    base: computed(() => this.computeBaseTimelineRange()),
    operations: this.data.stageTimelineRange('operations'),
  } as const;

  private readonly activeStageSignal = signal<PlanningStageId>('base');

  private readonly activityTypeService = inject(ActivityTypeService);
  private readonly activityCatalog = inject(ActivityCatalogService);
  private readonly translationService = inject(TranslationService);

  private readonly resourceViewModeState = signal<Record<PlanningStageId, Record<string, 'block' | 'detail'>>>(
    {
      base: {},
      operations: {},
    },
  );

  private readonly activityCreationToolSignal = signal<string>('');
  private readonly activityFormTypeSignal = signal<string>('');
  private readonly activityTypeMenuSelection = signal<ActivityCategory | null>(null);
  private readonly activityMoveTargetSignal = signal<string>('');
  private readonly pendingServiceResourceSignal = signal<Resource | null>(null);
  private readonly serviceAssignmentTargetSignal = signal<string | null>(null);
  private readonly serviceAssignmentFacade = new PlanningDashboardServiceAssignmentFacade({
    pendingServiceResourceSignal: this.pendingServiceResourceSignal,
    serviceAssignmentTargetSignal: this.serviceAssignmentTargetSignal,
    stageResourceSignals: this.stageResourceSignals,
    data: this.data,
    activeStage: () => this.activeStageSignal(),
    generateActivityId: (prefix) => this.generateActivityId(prefix),
  });
  private readonly stageYearSelectionState = this.filterFacade.stageYearSelectionState;
  private readonly pendingActivitySignal = signal<PendingActivityState | null>(null);
  private readonly pendingActivityOriginal = signal<Activity | null>(null);
  private readonly typePickerOpenSignal = signal(false);
  private readonly activityDetailsOpenSignal = signal(true);
  private readonly dialog = inject(MatDialog);
  private readonly activityEditPreviewSignal = signal<ActivityEditPreviewState | null>(null);
  protected readonly selectedTemplateId = computed(() => this.templateStore.selectedTemplateWithFallback()?.id ?? null);
  private readonly queryFrom = signal<string | null>(null);
  private readonly queryTo = signal<string | null>(null);
  private readonly selectedSimulationSignal = signal<SimulationRecord | null>(null);
  protected readonly planningVariant = this.data.planningVariant();
  protected readonly currentPeriods = computed(() => {
    const tpl = this.templateStore.selectedTemplateWithFallback();
    if (!tpl?.periods?.length) {
      return defaultTemplatePeriod(this.timetableYearService.defaultYearBounds());
    }
    return [...tpl.periods].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  });

  protected readonly activityForm = this.fb.group({
    start: ['', Validators.required],
    end: [''],
    type: [''],
    from: [''],
    to: [''],
    remark: [''],
  });

  constructor() {
    this.templateStore.loadTemplates();
    const initialStage = this.normalizeStageId(this.route.snapshot.queryParamMap.get('stage'));
    this.queryFrom.set(this.route.snapshot.queryParamMap.get('from'));
    this.queryTo.set(this.route.snapshot.queryParamMap.get('to'));
    this.setActiveStage(initialStage, false);
    if (this.route.snapshot.queryParamMap.get('stage') !== initialStage) {
      this.updateStageQueryParam(initialStage);
    }

    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        const stage = this.normalizeStageId(params.get('stage'));
        this.setActiveStage(stage, false);
        this.queryFrom.set(params.get('from'));
        this.queryTo.set(params.get('to'));
      });

    effect(
      () => {
        const template = this.templateStore.selectedTemplateWithFallback();
        const templateId = template?.id ?? null;
        const range = this.computeBaseTimelineRange();
        this.data.setBaseTimelineRange(range);
        this.data.setBaseTemplateContext(templateId, {
          periods: template?.periods ?? null,
          specialDays: template?.specialDays ?? null,
        });
        if (templateId) {
          this.data.reloadBaseTimeline();
        }
      },
      { allowSignalWrites: true },
    );

    this.stageOrder.forEach((stage) => {
      effect(
        () => {
          this.stageResourceSignals[stage]();
          this.boardFacade.ensureStageInitialized(stage);
        },
        { allowSignalWrites: true },
      );

      const snapshot = this.stageResourceSignals[stage]();
      if (snapshot.length > 0) {
        this.boardFacade.ensureStageInitialized(stage);
      }
    });

    effect(
      () => {
        const pending = this.pendingActivitySignal();
        const activeStage = this.activeStageSignal();
        if (pending && pending.stage !== activeStage) {
          if (this.activitySelection.selectedActivityState()?.activity.id === pending.activity.id) {
            this.activitySelection.selectedActivityState.set(null);
          }
          this.pendingActivitySignal.set(null);
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const preview = this.activityEditPreviewSignal();
        const activeStage = this.activeStageSignal();
        if (preview && preview.stage !== activeStage) {
          this.clearEditingPreview();
        }
      },
      { allowSignalWrites: true },
    );

    this.activityForm.controls.type.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.activityFormTypeSignal.set(value ?? '');
    });

    this.activityForm.controls.type.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.activityFormTypeSignal.set(value ?? ''));

    this.activityForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.updatePendingActivityFromForm();
      this.updateEditingPreviewFromForm();
    });

    effect(
      () => {
        const options = this.simulationOptions();
        if (!options.length) {
          this.selectedSimulationSignal.set(null);
          this.data.setPlanningVariant(null);
          return;
        }
        const current = this.selectedSimulationSignal();
        const next =
          (current && options.find((sim) => sim.id === current.id)) ??
          options.find((sim) => sim.productive) ??
          options[0];
        if (!current || current.id !== next.id) {
          this.selectedSimulationSignal.set(next);
          this.filterFacade.applySimulationSelection(next);
        } else {
          this.filterFacade.applySimulationSelection(current);
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const selection = this.activitySelection.selectedActivityState();
        const defaultCatalog = this.selectedCatalogOption();
        const defaultTypeId = defaultCatalog?.activityTypeId ?? '';
        if (!selection) {
          this.activityForm.reset({
            start: '',
            end: '',
            type: defaultTypeId,
            from: '',
            to: '',
            remark: '',
          });
          this.activityFormTypeSignal.set(defaultTypeId);
          this.clearEditingPreview();
          return;
        }
        this.activityForm.setValue({
          start: toLocalDateTime(selection.activity.start),
          end: selection.activity.end ? toLocalDateTime(selection.activity.end) : '',
          type: selection.activity.type ?? '',
          from: selection.activity.from ?? '',
          to: selection.activity.to ?? '',
          remark: selection.activity.remark ?? '',
        });
        this.activityFormTypeSignal.set(selection.activity.type ?? '');
        this.clearEditingPreview();
        if (!this.isPendingSelection(selection.activity.id)) {
          this.activityForm.markAsPristine();
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    const attrs = (selection.activity.attributes ?? {}) as Record<string, unknown>;
        const activityKey =
          typeof attrs['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
        if (activityKey && this.activityCatalogOptionMap().has(activityKey)) {
          this.activityCreationToolSignal.set(activityKey);
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const options = this.activityCreationOptions();
        if (options.length === 0) {
          this.activityCreationToolSignal.set('');
          return;
        }
        const current = this.activityCreationToolSignal();
        if (!current || !options.some((option) => option.id === current)) {
          this.activityCreationToolSignal.set(options[0].id);
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const selection = this.activitySelection.selectedActivityState();
        if (selection) {
          return;
        }
        const option = this.selectedCatalogOption();
        const typeId = option?.activityTypeId ?? '';
        this.activityForm.controls.type.setValue(typeId);
        this.activityFormTypeSignal.set(typeId);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const stage = this.activeStageSignal();
        const activities = this.normalizedStageActivitySignals[stage]();
        const validIds = new Set(activities.map((activity) => activity.id));
        const currentSelection = this.activitySelection.selectedActivityIds();
        if (currentSelection.size === 0) {
        return;
        }
        const filtered = Array.from(currentSelection).filter((id) => validIds.has(id));
        if (filtered.length !== currentSelection.size) {
          this.activitySelection.selectedActivityIds.set(new Set(filtered));
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const options = this.moveTargetOptions();
        const current = this.activityMoveTargetSignal();
        if (options.length === 0) {
          if (current) {
            this.activityMoveTargetSignal.set('');
        }
        return;
        }
        if (!current || !options.some((resource) => resource.id === current)) {
          this.activityMoveTargetSignal.set(options[0].id);
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const groups = this.activityTypePickerGroups();
        if (!groups.length) {
          this.activityTypeMenuSelection.set(null);
          return;
        }
        const current = this.activityTypeMenuSelection();
        if (!current || !groups.some((group) => group.id === current)) {
          this.activityTypeMenuSelection.set(groups[0].id);
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const options = this.timetableYearOptions();
        this.stageOrder.forEach((stage) => this.filterFacade.ensureStageYearSelection(stage, options));
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const typeId = this.activityFormTypeSignal();
        const definition = this.findActivityType(typeId);
        if (definition?.timeMode === 'point') {
          const control = this.activityForm.controls.end;
          if (control.value) {
            control.setValue('', { emitEvent: false });
            control.markAsPristine();
          }
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
      },
      { allowSignalWrites: true },
    );
  }

  protected readonly activeStageId = computed(() => this.activeStageSignal());

  protected readonly activeStageMeta = computed(
    () => this.stageMetaMap[this.activeStageSignal()],
  );

  protected readonly resources = computed(() =>
    this.boardFacade.filterResourcesForStage(
      this.activeStageSignal(),
      this.stageResourceSignals[this.activeStageSignal()](),
    ),
  );

  protected readonly activities = computed(
    () => this.normalizedStageActivitySignals[this.activeStageSignal()](),
  );

  protected readonly timelineRange = computed(() =>
    this.computeTimelineRange(this.activeStageSignal()),
  );

  protected readonly resourceGroups = computed(() =>
    this.computeResourceGroups(this.activeStageSignal()),
  );

  protected readonly simulationOptions = computed<SimulationRecord[]>(() => {
    const years = Array.from(this.stageYearSelectionState()[this.activeStageSignal()] ?? []);
    const fallbackYear = this.filterFacade.preferredYearLabel(this.timetableYearOptions());
    const targetYears = years.length ? years : [fallbackYear];
    const entries: SimulationRecord[] = [];
    targetYears.forEach((label) => {
      this.simulationService.byTimetableYear(label).forEach((sim) => entries.push(sim));
    });
    return entries.sort((a, b) => {
      if (!!a.productive !== !!b.productive) {
        return a.productive ? -1 : 1;
      }
      return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
    });
  });

  protected readonly selectedSimulationId = computed(
    () => this.selectedSimulationSignal()?.id ?? null,
  );

  protected readonly selectedSimulationLabel = computed(() => {
    const sim = this.selectedSimulationSignal();
    if (!sim) {
      return 'Variante wählen';
    }
    const prefix = sim.productive ? 'Produktiv' : 'Simulation';
    return `${prefix}: ${sim.label}`;
  });

  protected readonly timetableYearOptions = computed<TimetableYearBounds[]>(() => {
    const managed = this.managedTimetableYearBounds();
    if (managed.length) {
      return managed;
    }
    return [this.timetableYearService.defaultYearBounds()];
  });

  protected readonly timetableYearSummary = computed(() =>
    this.filterFacade.formatTimetableYearSummary(this.activeStageSignal()),
  );
  protected readonly basePlanningYearRange = computed(() =>
    this.computeStageYearRange('base'),
  );

  protected readonly boards = computed(() => this.stageStore.stageState(this.activeStageSignal())().boards);
  protected readonly activityTypeDefinitions = this.activityTypeService.definitions;
  protected readonly activityTypeDisplayLabelMap = computed(() => {
    // access translations signal for reactivity on locale changes
    this.translationService.translations();
    const map = new Map<string, string>();
    this.activityTypeDefinitions().forEach((definition) => {
      const translated = this.translationService.translate(
        `activityType:${definition.id}`,
        definition.label,
      );
      map.set(definition.id, translated || definition.label);
    });
    return map;
  });
  private readonly activityCatalogOptions = computed<ActivityCatalogOption[]>(() => {
    const typeMap = this.activityTypeMap();
    const displayLabelMap = this.activityTypeDisplayLabelMap();
    return this.activityCatalog
      .definitions()
      .map((entry) => {
        const type = typeMap.get(entry.activityType ?? '');
        if (!type) {
          return null;
        }
        // Dauer und Relevant-für bevorzugt aus Attributen lesen
        const attrList = entry.attributes ?? [];
        const attrByKey = new Map(
          attrList.map((a) => [a.key, a] as const),
        );
        const durationAttr = attrByKey.get('default_duration');
        const relevantAttr = attrByKey.get('relevant_for');
        const durationFromAttr =
          durationAttr && durationAttr.meta?.['value']
            ? Number(durationAttr.meta['value'])
            : null;
        const relevantFromAttr =
          relevantAttr && relevantAttr.meta?.['value']
            ? (relevantAttr.meta['value'] as string).split(',').map((v) => v.trim()).filter(Boolean)
            : null;

        const effectiveDuration =
          Number.isFinite(durationFromAttr ?? NaN) && (durationFromAttr ?? 0) > 0
            ? (durationFromAttr as number)
            : entry.defaultDurationMinutes ?? type.defaultDurationMinutes;
        const effectiveRelevantFor =
          (relevantFromAttr && relevantFromAttr.length
            ? (relevantFromAttr as ResourceKind[])
            : entry.relevantFor && entry.relevantFor.length
              ? entry.relevantFor
              : type.relevantFor) ?? type.appliesTo;
        const translatedTypeLabel = displayLabelMap.get(type.id) ?? type.label;

        return {
          id: entry.id,
          label: translatedTypeLabel,
          description: entry.description ?? type.description,
          defaultDurationMinutes: effectiveDuration ?? null,
          attributes: attrList,
          templateId: entry.templateId ?? null,
          activityTypeId: entry.activityType ?? type.id,
          typeDefinition: type,
          relevantFor: effectiveRelevantFor,
        } as ActivityCatalogOption;
      })
      .filter((entry): entry is ActivityCatalogOption => !!entry);
  });
  protected readonly activityCreationOptions = this.activityCatalogOptions;
  protected readonly activityTypeCandidates = computed(() => {
    const options = this.activityCatalogOptions();
    const selection = this.activitySelection.selectedActivityState();
    const resourceKind = selection?.resource.kind ?? null;
    if (!resourceKind) {
      return options;
    }
    return options.filter((option) => {
      const relevant = option.relevantFor ?? option.typeDefinition.relevantFor ?? option.typeDefinition.appliesTo;
      return relevant.includes(resourceKind);
    });
  });
  protected readonly quickActivityTypes = computed<ActivityCatalogOption[]>(() => {
    const candidates = this.activityTypeCandidates();
    if (!candidates.length) {
      return [];
    }
    // Erste paar sinnvolle Typen als Schnellauswahl anbieten
    const MAX_QUICK_TYPES = 6;
    return candidates.slice(0, MAX_QUICK_TYPES);
  });
  protected readonly activityTypePickerGroups = computed<ActivityTypePickerGroup[]>(() => {
    const options = this.activityTypeCandidates();
    if (!options.length) {
      return [];
    }
    const groups = TYPE_PICKER_META.map((meta) => ({
      id: meta.id,
      label: meta.label,
      icon: meta.icon,
      items: [] as ActivityCatalogOption[],
    }));
    options.forEach((option) => {
      const targetId = option.typeDefinition.category ?? 'other';
      const target =
        groups.find((group) => group.id === targetId) ??
        groups.find((group) => group.id === 'other') ??
        groups[0];
      target.items.push(option);
    });
    return groups
      .filter((group) => group.items.length > 0)
      .map((group) => ({
        id: group.id,
        label: group.label,
        icon: group.icon,
        items: [...group.items].sort((a, b) => a.label.localeCompare(b.label, 'de')),
      }));
  });
  protected readonly activityCatalogOptionMap = computed(() =>
    new Map<string, ActivityCatalogOption>(this.activityCatalogOptions().map((option) => [option.id, option])),
  );
  protected readonly selectedCatalogOption = computed<ActivityCatalogOption | null>(() => {
    const id = this.activityCreationToolSignal();
    return id ? this.activityCatalogOptionMap().get(id) ?? null : null;
  });

  protected readonly activityTypeMap = computed(() => {
    const map = new Map<string, ActivityTypeDefinition>();
    this.activityTypeDefinitions().forEach((definition) => map.set(definition.id, definition));
    return map;
  });

  protected readonly activityTypeInfoMap = computed(() => {
    const info: Record<string, { label: string; showRoute: boolean; serviceRole: ServiceRole | null }> = {};
    this.activityTypeDefinitions().forEach((definition) => {
      const translated = this.activityTypeDisplayLabelMap().get(definition.id) ?? definition.label;
      info[definition.id] = {
        label: translated,
        showRoute: definition.fields.includes('from') || definition.fields.includes('to'),
        serviceRole: null,
      };
    });
    return info;
  });

  protected readonly activeTypePickerGroup = computed<ActivityTypePickerGroup | null>(() => {
    const groups = this.activityTypePickerGroups();
    if (!groups.length) {
      return null;
    }
    const current = this.activityTypeMenuSelection();
    return groups.find((group) => group.id === current) ?? groups[0];
  });

  protected readonly resourceViewModes = computed(
    () => this.resourceViewModeState()[this.activeStageSignal()],
  );

  protected readonly activityCreationTool = computed(() => this.activityCreationToolSignal());
  // Bind service methods to preserve `this` when used as callbacks in the template.
  protected readonly resourceError = this.data.resourceError.bind(this.data);
  protected readonly timelineError = this.data.timelineError.bind(this.data);
  protected readonly templateError = this.templateStore.error;

  protected readonly selectedActivity = computed(() => this.activitySelection.selectedActivityState());
  protected readonly selectedActivities = computed(() =>
    this.activitySelection.computeSelectedActivities(
      this.activitySelection.selectedActivityIds,
      this.normalizedStageActivitySignals[this.activeStageSignal()],
      this.stageResourceSignals[this.activeStageSignal()],
    ),
  );
  protected readonly selectedActivityIdsArray = computed<string[]>(() =>
    Array.from(this.activitySelection.selectedActivityIds()),
  );
  protected readonly selectedActivitySlot = computed(() => this.activitySelection.selectedActivitySlot());
  protected readonly moveTargetOptions = computed(() => this.computeMoveTargetOptions());
  protected readonly activityMoveTarget = computed(() => this.activityMoveTargetSignal());

  protected readonly selectedActivityDefinition = computed<ActivityTypeDefinition | null>(() => {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return null;
    }
    const typeOverride = this.activityFormTypeSignal();
    const typeId = (typeOverride || selection.activity.type) ?? null;
    return this.findActivityType(typeId);
  });

  protected readonly pendingServiceResource = computed(() => this.pendingServiceResourceSignal());

  protected readonly serviceAssignmentTarget = computed(() => this.serviceAssignmentTargetSignal());

  protected readonly assignmentCandidates = computed(() => this.computeAssignmentCandidates());

  protected readonly selectionSize = computed(
    () => this.stageStore.stageState(this.activeStageSignal())().selectedResourceIds.size,
  );

  protected readonly hasSelection = computed(() => this.selectionSize() > 0);

  protected readonly selectedResourceIds = computed(() =>
    this.boardFacade.normalizeResourceIds(
      Array.from(this.stageStore.stageState(this.activeStageSignal())().selectedResourceIds),
      this.activeStageSignal(),
    ),
  );

  protected readonly pendingActivity = computed<Activity | null>(() =>
    this.pendingActivityForStage(this.activeStageSignal()),
  );
  protected readonly isTypePickerOpen = computed(() => this.typePickerOpenSignal());
  protected readonly activityDetailsOpen = computed(() => this.activityDetailsOpenSignal());

  protected readonly isSelectedActivityPending = computed(() => {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return false;
    }
    return this.isPendingSelection(selection.activity.id);
  });

  protected readonly selectedBoardIndex = computed(() => {
    const stage = this.activeStageSignal();
    const state = this.stageStore.stageState(stage)();
    return Math.max(0, state.boards.findIndex((board) => board.id === state.activeBoardId));
  });

  protected trackResource(_: number, resource: Resource): string {
    return resource.id;
  }

  protected trackBoard(_: number, board: PlanningBoard): string {
    return board.id;
  }

  protected trackFocus(_: number, focus: string): string {
    return focus;
  }

  protected trackActivityCatalog(_: number, option: ActivityCatalogOption): string {
    return option.id;
  }

  protected trackActivity(_: number, item: { activity: Activity; resource: Resource }): string {
    return item.activity.id;
  }

  protected activityTypeLabel(typeId: string | null | undefined): string {
    if (!typeId) {
      return 'Aktivität';
    }
    return (
      this.activityTypeDisplayLabelMap().get(typeId) ??
      this.activityTypeMap().get(typeId)?.label ??
      'Aktivität'
    );
  }

  protected setActivityTypePickerGroup(groupId: ActivityTypePickerGroup['id']): void {
    if (!groupId || this.activityTypeMenuSelection() === groupId) {
      return;
    }
    this.activityTypeMenuSelection.set(groupId);
  }

  protected isActivityOptionSelected(optionId: string): boolean {
    return this.activityCreationToolSignal() === optionId;
  }

  protected selectCatalogActivity(optionId: string): void {
    const option = this.activityCatalogOptionMap().get(optionId);
    if (!option) {
      return;
    }
    this.activityCreationToolSignal.set(option.id);
    this.activityForm.controls.type.setValue(option.activityTypeId);
    this.activityForm.controls.type.markAsDirty();
    this.activityFormTypeSignal.set(option.activityTypeId);
  }

  protected openPeriodsWindow(): void {
    let templateId = this.selectedTemplateId();
    if (!templateId) {
      const first = this.templateStore.templates()[0];
      if (first) {
        this.templateStore.selectTemplate(first.id);
        templateId = first.id;
      }
    }
    if (typeof window === 'undefined') {
      return;
    }
    const urlTree = this.router.createUrlTree(['/planning/periods'], {
      queryParams: templateId ? { template: templateId } : undefined,
    });
    const url = this.router.serializeUrl(urlTree);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  protected openTypePicker(): void {
    this.typePickerOpenSignal.set(true);
  }

  protected closeTypePicker(): void {
    this.typePickerOpenSignal.set(false);
  }

  protected selectActivityTypeFromPicker(optionId: string): void {
    this.selectCatalogActivity(optionId);
    this.closeTypePicker();
  }

  protected toggleActivityDetails(): void {
    this.activityDetailsOpenSignal.update((current) => !current);
  }

  protected onStageChange(stage: PlanningStageId | null | undefined): void {
    if (!stage || !(stage in this.stageMetaMap)) {
      return;
    }
    const nextStage = stage as PlanningStageId;
    this.setActiveStage(nextStage, true);
  }

  protected onSelectionToggle(resourceId: string, selected: boolean): void {
    const stage = this.activeStageSignal();
    this.updateStageState(stage, (state) => {
      if (selected) {
        state.selectedResourceIds.add(resourceId);
      } else {
        state.selectedResourceIds.delete(resourceId);
      }
      return state;
    });
  }

  protected isResourceSelected(resourceId: string): boolean {
    return this.stageStore.stageState(this.activeStageSignal())().selectedResourceIds.has(resourceId);
  }

  protected clearSelection(): void {
    const stage = this.activeStageSignal();
    this.updateStageState(stage, (state) => {
      state.selectedResourceIds = new Set();
      return state;
    });
  }

  protected selectAllResources(): void {
    const stage = this.activeStageSignal();
    const resources = this.stageResourceSignals[stage]();
    this.updateStageState(stage, (state) => {
      state.selectedResourceIds = new Set(resources.map((resource) => resource.id));
      return state;
    });
  }

  protected setActivityCreationTool(tool: string): void {
    const options = this.activityCreationOptions();
    const next = options.some((option) => option.id === tool) ? tool : options[0]?.id ?? '';
    this.activityCreationToolSignal.set(next);
  }

  protected resetPendingActivityEdits(): void {
    const pendingState = this.pendingActivitySignal();
    const original = this.pendingActivityOriginal();
    const selection = this.activitySelection.selectedActivityState();
    const stage = this.activeStageSignal();
    if (!pendingState || !original || !selection) {
      return;
    }
    if (pendingState.stage !== stage || pendingState.activity.id !== original.id) {
      return;
    }

    this.pendingActivitySignal.set({ stage: pendingState.stage, activity: original });
    this.activitySelection.selectedActivityState.set({ activity: original, resource: selection.resource });

    this.activityForm.setValue({
      start: toLocalDateTime(original.start),
      end: original.end ? toLocalDateTime(original.end) : '',
      type: original.type ?? '',
      from: original.from ?? '',
      to: original.to ?? '',
      remark: original.remark ?? '',
    });
    this.activityForm.markAsPristine();
  }

  protected adjustFormEndBy(deltaMinutes: number): void {
    const value = this.activityForm.getRawValue();
    if (!value.start) {
      return;
    }
    const start = fromLocalDateTime(value.start);
    if (!start) {
      return;
    }
    const baseEnd = value.end ? fromLocalDateTime(value.end) : new Date(start);
    if (!baseEnd) {
      return;
    }
    const nextEndMs = baseEnd.getTime() + deltaMinutes * 60 * 1000;
    const minEndMs = start.getTime() + 60 * 1000;
    const safeEnd = new Date(Math.max(nextEndMs, minEndMs));
    const nextEndLocal = toLocalDateTime(safeEnd.toISOString());
    this.activityForm.controls.end.setValue(nextEndLocal);
    this.activityForm.controls.end.markAsDirty();
  }

  protected shiftFormBy(deltaMinutes: number): void {
    const value = this.activityForm.getRawValue();
    if (!value.start) {
      return;
    }
    const start = fromLocalDateTime(value.start);
    if (!start) {
      return;
    }
    const end = value.end ? fromLocalDateTime(value.end) : null;
    const deltaMs = deltaMinutes * 60 * 1000;
    const nextStart = new Date(start.getTime() + deltaMs);
    this.activityForm.controls.start.setValue(toLocalDateTime(nextStart.toISOString()));
    this.activityForm.controls.start.markAsDirty();
    if (end) {
      const nextEnd = new Date(end.getTime() + deltaMs);
      this.activityForm.controls.end.setValue(toLocalDateTime(nextEnd.toISOString()));
      this.activityForm.controls.end.markAsDirty();
    }
  }

  private updatePendingActivityFromForm(): void {
    this.activityFacade.updatePendingFromForm(
      this.activeStageSignal(),
      this.activitySelection.selectedActivityState(),
      this.pendingActivitySignal(),
      (selection) => this.buildActivityFromForm(selection),
      (a, b) => this.areActivitiesEquivalent(a, b),
      (activity) => this.commitPendingActivityUpdate(activity),
    );
  }

  private updateEditingPreviewFromForm(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      this.clearEditingPreview();
      return;
    }
    if (this.isPendingSelection(selection.activity.id)) {
      this.clearEditingPreview();
      return;
    }
    const normalized = this.buildActivityFromForm(selection);
    if (!normalized) {
      this.clearEditingPreview();
      return;
    }
    if (this.areActivitiesEquivalent(selection.activity, normalized)) {
      this.clearEditingPreview();
      return;
    }
    this.activityEditPreviewSignal.set({ stage: this.activeStageSignal(), activity: normalized });
  }

  protected handleResourceViewModeChange(event: { resourceId: string; mode: 'block' | 'detail' }): void {
    const stage = this.activeStageSignal();
    const current = this.resourceViewModeState();
    const stageModes = { ...(current[stage] ?? {}), [event.resourceId]: event.mode };
    this.resourceViewModeState.set({
      ...current,
      [stage]: stageModes,
    });
  }

  protected handleActivityCreate(event: { resource: Resource; start: Date }): void {
    const stage = this.activeStageSignal();
    if (stage === 'base' && !this.templateStore.selectedTemplate()?.id) {
      return;
    }
    const selectedOption = this.activityCatalogOptionMap().get(this.activityCreationToolSignal());
    const typeId = selectedOption?.activityTypeId ?? selectedOption?.typeDefinition.id ?? null;
    const definition = this.resolveActivityTypeForResource(event.resource, typeId);
    if (!definition) {
      return;
    }
    const draft = this.createActivityDraft(event, definition, selectedOption ?? null);
    const normalized = this.applyActivityTypeConstraints(draft);
    this.pendingActivityOriginal.set(normalized);
    this.startPendingActivity(stage, event.resource, normalized);
  }

  protected handleActivityEdit(event: { resource: Resource; activity: Activity }): void {
    if (!this.isPendingSelection(event.activity.id)) {
      this.pendingActivitySignal.set(null);
    }
    this.activitySelection.selectedActivityState.set({
      resource: event.resource,
      activity: this.applyActivityTypeConstraints(event.activity),
    });
    this.clearEditingPreview();
  }

  protected handleActivitySelectionToggle(event: {
    resource: Resource;
    activity: Activity;
    selectionMode: 'set' | 'toggle';
  }): void {
    this.activitySelection.toggleSelection(event);
  }

  protected handleActivityReposition(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    sourceResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    participantResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    if (this.isPendingSelection(event.activity.id)) {
      this.updatePendingActivityPosition(event);
      return;
    }
    const stage = this.activeStageSignal();
    if (stage === 'base') {
      this.handleBaseActivityReposition(event);
      return;
    }
    const targetId = event.targetResourceId;
    const targetResource =
      this.stageResourceSignals[stage]().find((resource) => resource.id === targetId) ?? null;
    if (!targetResource) {
      return;
    }
    const attrs = (event.activity.attributes ?? {}) as Record<string, unknown>;
    const linkGroupId =
      typeof attrs['linkGroupId'] === 'string' ? (attrs['linkGroupId'] as string) : null;
    const isOwnerSlot = event.isOwnerSlot ?? true;
    const participantResourceId = event.participantResourceId ?? event.sourceResourceId ?? null;
    const targetCategory =
      event.participantCategory ?? resourceParticipantCategory(targetResource);
    const applyUpdate = (activity: Activity): Activity => {
      const updatedBase: Activity = {
        ...activity,
        start: event.start.toISOString(),
        end: event.end ? event.end.toISOString() : null,
      };
      if (!isOwnerSlot && participantResourceId) {
        return moveParticipantToResource(updatedBase, participantResourceId, targetResource);
      }
      return addParticipantToActivity(updatedBase, targetResource, undefined, undefined, {
        retainPreviousOwner: false,
        ownerCategory: targetCategory,
      });
    };
    this.updateStageActivities(stage, (activities) => {
      if (!linkGroupId) {
        return activities.map((activity) => {
          if (activity.id !== event.activity.id) {
            return activity;
          }
          return applyUpdate(activity);
        });
      }
      return activities.map((activity) => {
        const currentAttrs = (activity.attributes ?? {}) as Record<string, unknown>;
        const currentGroupId =
          typeof currentAttrs['linkGroupId'] === 'string'
            ? (currentAttrs['linkGroupId'] as string)
            : null;
        if (activity.id === event.activity.id) {
          return applyUpdate(activity);
        }
        if (!currentGroupId || currentGroupId !== linkGroupId) {
          return activity;
        }
        return {
          ...activity,
          start: event.start.toISOString(),
          end: event.end ? event.end.toISOString() : null,
        };
      });
    });
    const activeSelection = this.activitySelection.selectedActivityState();
    if (activeSelection?.activity.id === event.activity.id) {
      const resource = targetResource;
      const updatedSelectionActivity = this.applyActivityTypeConstraints(
        !isOwnerSlot && participantResourceId
          ? moveParticipantToResource(
              {
                ...activeSelection.activity,
                start: event.start.toISOString(),
                end: event.end ? event.end.toISOString() : null,
              },
              participantResourceId,
              targetResource,
            )
          : addParticipantToActivity(
              {
                ...activeSelection.activity,
                start: event.start.toISOString(),
                end: event.end ? event.end.toISOString() : null,
              },
              targetResource,
              undefined,
              undefined,
              {
                retainPreviousOwner: false,
                ownerCategory: targetCategory,
              },
            ),
      );
      this.activitySelection.selectedActivityState.set({
        activity: updatedSelectionActivity,
        resource,
      });
    }
  }

  protected handleActivityCopy(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
  }): void {
    const stage = this.activeStageSignal();
    const source = event.activity;
    const targetResourceId = event.targetResourceId;
    const sourceOwnerId = this.activityOwnerId(source);
    if (!sourceOwnerId || targetResourceId === sourceOwnerId) {
      return;
    }
    const resources = this.stageResourceSignals[stage]();
    const sourceResource = resources.find((res) => res.id === sourceOwnerId);
    const targetResource = resources.find((res) => res.id === targetResourceId);
    if (!sourceResource || !targetResource || sourceResource.kind !== targetResource.kind) {
      return;
    }
    const dialogRef = this.dialog.open<
      ActivityLinkRoleDialogComponent,
      {
        sourceResourceName: string;
        targetResourceName: string;
      },
      ActivityLinkRoleDialogResult | undefined
    >(ActivityLinkRoleDialogComponent, {
      width: '420px',
      data: {
        sourceResourceName: sourceResource.name,
        targetResourceName: targetResource.name,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      if (stage === 'base') {
        this.applyBaseActivityCopyWithRoles(source, sourceResource, targetResource, event, result);
      } else {
        this.applyActivityCopyWithRoles(stage, source, sourceResource, targetResource, event, result);
      }
    });
  }

  private applyActivityCopyWithRoles(
    stage: PlanningStageId,
    source: Activity,
    sourceResource: Resource,
    targetResource: Resource,
    event: {
      activity: Activity;
      targetResourceId: string;
      start: Date;
      end: Date | null;
    },
    roles: ActivityLinkRoleDialogResult,
  ): void {
    this.updateStageActivities(stage, (activities) =>
      activities.map((activity) => {
        if (activity.id !== source.id) {
          return activity;
        }
        const withRoles = applyActivityCopyWithRoles(
          activity,
          sourceResource,
          targetResource,
          roles,
          (act, owner, partner, partnerRole, opts) =>
            addParticipantToActivity(act, owner, partner, partnerRole, opts),
        );
        return this.applyActivityTypeConstraints(withRoles);
      }),
    );
  }

  private applyBaseActivityCopyWithRoles(
    source: Activity,
    sourceResource: Resource,
    targetResource: Resource,
    event: {
      activity: Activity;
      targetResourceId: string;
      start: Date;
      end: Date | null;
    },
    roles: ActivityLinkRoleDialogResult,
  ): void {
    const templateId = this.templateStore.selectedTemplate()?.id;
    if (!templateId) {
      return;
    }
    const updated = applyActivityCopyWithRoles(
      source,
      sourceResource,
      targetResource,
      roles,
      (act, owner, partner, partnerRole, opts) =>
        addParticipantToActivity(act, owner, partner, partnerRole, opts),
    );
    this.saveTemplateActivity(this.applyActivityTypeConstraints(updated));
  }

  protected clearActivitySelection(): void {
    this.activitySelection.clearSelection();
    this.activityMoveTargetSignal.set('');
  }

  protected clearSelectedActivity(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (selection && this.isPendingSelection(selection.activity.id)) {
      this.pendingActivitySignal.set(null);
      this.pendingActivityOriginal.set(null);
    }
    this.activitySelection.selectedActivityState.set(null);
    this.clearEditingPreview();
  }

  private buildActivityFromForm(selection: { activity: Activity; resource: Resource } | null): Activity | null {
    if (!selection) {
      return null;
    }
    const value = this.activityForm.getRawValue();
    const startDate = value.start ? fromLocalDateTime(value.start) : null;
    if (!startDate) {
      return null;
    }
    const desiredType =
      value.type && value.type.length > 0 ? value.type : (selection.activity.type ?? '');
    const definition =
      this.findActivityType(desiredType) ?? this.findActivityType(selection.activity.type ?? null);
    const catalog = this.selectedCatalogOption();
    const isPoint = definition?.timeMode === 'point';
    const endDateRaw = !isPoint && value.end ? fromLocalDateTime(value.end) : null;
    const endDateValid =
      endDateRaw && endDateRaw.getTime() > startDate.getTime() ? endDateRaw : null;
    const mergedAttributes = catalog
      ? {
          ...(selection.activity.attributes ?? {}),
          ...(buildAttributesFromCatalog(catalog) ?? {}),
        }
      : selection.activity.attributes;
    const updated: Activity = {
      ...selection.activity,
      title: catalog?.label ?? this.buildActivityTitle(definition ?? null),
      start: startDate.toISOString(),
      end: endDateValid ? endDateValid.toISOString() : null,
      type: (desiredType || selection.activity.type) ?? '',
      attributes: mergedAttributes,
    };
    if (definition) {
      if (this.definitionHasField(definition, 'from')) {
        updated.from = value.from ?? '';
      } else {
        updated.from = undefined;
      }
      if (this.definitionHasField(definition, 'to')) {
        updated.to = value.to ?? '';
      } else {
        updated.to = undefined;
      }
      if (this.definitionHasField(definition, 'remark')) {
        updated.remark = value.remark ?? '';
      } else {
        updated.remark = undefined;
      }
    }
    return this.applyActivityTypeConstraints(updated);
  }

  private areActivitiesEquivalent(a: Activity, b: Activity): boolean {
    const norm = (value: string | null | undefined) => value ?? '';
    return (
      a.start === b.start &&
      (a.end ?? null) === (b.end ?? null) &&
      norm(a.type) === norm(b.type) &&
      norm(a.title) === norm(b.title) &&
      norm(a.from) === norm(b.from) &&
      norm(a.to) === norm(b.to) &&
      norm(a.remark) === norm(b.remark)
    );
  }

  protected saveSelectedActivityEdits(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.activityForm.invalid) {
      this.activityForm.markAllAsTouched();
      return;
    }
    const stage = this.activeStageSignal();
    const pending = this.pendingActivitySignal();
    const isPendingDraft =
      pending && pending.stage === stage && pending.activity.id === selection.activity.id;
    const normalized = this.buildActivityFromForm(selection);
    if (!normalized) {
      return;
    }
    if (isPendingDraft) {
      if (stage === 'base') {
        this.saveTemplateActivity(normalized);
      } else {
        this.updateStageActivities(stage, (activities) => [...activities, normalized]);
      }
      this.pendingActivitySignal.set(null);
      this.pendingActivityOriginal.set(null);
      this.activitySelection.selectedActivityState.set({ activity: normalized, resource: selection.resource });
      this.clearEditingPreview();
      return;
    }
    if (stage === 'base') {
      this.saveTemplateActivity(normalized);
      this.activitySelection.selectedActivityState.set({ activity: normalized, resource: selection.resource });
      this.clearEditingPreview();
      return;
    }
    this.replaceActivity(normalized);
  }

  protected deleteSelectedActivity(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.isPendingSelection(selection.activity.id)) {
      this.pendingActivitySignal.set(null);
      this.activitySelection.selectedActivityState.set(null);
      return;
    }
    const stage = this.activeStageSignal();
    if (stage === 'base') {
      const templateId = this.templateStore.selectedTemplate()?.id;
      if (templateId) {
        const baseId = selection.activity.id.split('@')[0] ?? selection.activity.id;
        this.data.deleteTemplateActivity(templateId, baseId);
      }
      this.activitySelection.selectedActivityState.set(null);
      return;
    }
    this.updateStageActivities(stage, (activities) =>
      activities.filter((activity) => activity.id !== selection.activity.id),
    );
    this.activitySelection.selectedActivityState.set(null);
    this.clearEditingPreview();
  }

  protected handleServiceAssignRequest(resource: Resource): void {
    this.serviceAssignmentFacade.handleRequest(resource);
  }

  protected setServiceAssignmentTarget(resourceId: string | null): void {
    this.serviceAssignmentFacade.setTarget(resourceId);
  }

  protected confirmServiceAssignment(): void {
    this.serviceAssignmentFacade.confirm();
  }

  protected cancelServiceAssignment(): void {
    this.serviceAssignmentFacade.cancel();
  }

  protected setMoveSelectionTarget(resourceId: string | null): void {
    this.activityMoveTargetSignal.set(resourceId ?? '');
  }

  protected moveSelectionToTarget(): void {
    const targetId = this.activityMoveTargetSignal();
    if (!targetId) {
      return;
    }
    const stage = this.activeStageSignal();
    const targetResource = this.stageResourceSignals[stage]().find(
      (resource) => resource.id === targetId,
    );
    if (!targetResource) {
      return;
    }
    const selectionIds = this.activitySelection.selectedActivityIds();
    if (selectionIds.size === 0) {
      return;
    }
    const idsToMove = new Set(selectionIds);
    this.updateStageActivities(stage, (activities) =>
      activities.map((activity) => {
        if (!idsToMove.has(activity.id)) {
          return activity;
        }
        return addParticipantToActivity(activity, targetResource, undefined, undefined, {
          retainPreviousOwner: false,
          ownerCategory: resourceParticipantCategory(targetResource),
        });
      }),
    );
    const activeSelection = this.activitySelection.selectedActivityState();
    if (activeSelection && idsToMove.has(activeSelection.activity.id)) {
      this.activitySelection.selectedActivityState.set({
        activity: this.applyActivityTypeConstraints(
          addParticipantToActivity(
            activeSelection.activity,
            targetResource,
            undefined,
            undefined,
            { retainPreviousOwner: false, ownerCategory: resourceParticipantCategory(targetResource) },
          ),
        ),
        resource: targetResource,
      });
    }
  }

  protected shiftSelectedActivityBy(deltaMinutes: number): void {
    this.activityFacade.shiftSelectedActivityBy(
      deltaMinutes,
      this.selectedActivities(),
      this.activitySelection.selectedActivityState(),
      (typeId) => this.findActivityType(typeId),
      (activityId) => this.isPendingSelection(activityId),
      (activity) => this.applyActivityTypeConstraints(activity),
      (activity) => this.commitPendingActivityUpdate(activity),
      (activity) => this.replaceActivity(activity),
    );
  }

  protected snapSelectedActivityToPrevious(): void {
    this.activityFacade.snapToNeighbor(
      'previous',
      this.activitySelection.selectedActivityState(),
      this.activityForm,
      (activity) =>
        findNeighborActivities(
          activity,
          this.normalizedStageActivitySignals[this.activeStageSignal()](),
          this.activityOwnerId(activity),
        ),
      (typeId) => this.findActivityType(typeId),
    );
  }

  protected snapSelectedActivityToNext(): void {
    this.activityFacade.snapToNeighbor(
      'next',
      this.activitySelection.selectedActivityState(),
      this.activityForm,
      (activity) =>
        findNeighborActivities(
          activity,
          this.normalizedStageActivitySignals[this.activeStageSignal()](),
          this.activityOwnerId(activity),
        ),
      (typeId) => this.findActivityType(typeId),
    );
  }

  protected fillGapForSelectedActivity(): void {
    this.activityFacade.fillGapForSelectedActivity(
      this.activitySelection.selectedActivityState(),
      this.activityForm,
      (activity) =>
        findNeighborActivities(
          activity,
          this.normalizedStageActivitySignals[this.activeStageSignal()](),
          this.activityOwnerId(activity),
        ),
      (typeId) => this.findActivityType(typeId),
    );
  }

  protected snapFormToPrevious(): void {
    this.snapSelectedActivityToPrevious();
  }

  protected snapFormToNext(): void {
    this.snapSelectedActivityToNext();
  }

  protected fillGapForForm(): void {
    this.fillGapForSelectedActivity();
  }

  protected addParticipantsToActiveBoard(): void {
    const participantIds = this.selectedActivityParticipantIds();
    if (participantIds.length === 0) {
      return;
    }
    const stage = this.activeStageSignal();
    const state = this.stageStore.stageState(stage)();
    if (!state.activeBoardId) {
      return;
    }
    this.boardFacade.addSelectionToBoard(stage, state.activeBoardId, participantIds);
  }

  protected openBoardForParticipants(): void {
    const participantIds = this.selectedActivityParticipantIds();
    if (participantIds.length === 0) {
      return;
    }
    const stage = this.activeStageSignal();
    this.boardFacade.createBoardFromSelection(stage, participantIds, this.stageResourceSignals[stage]());
  }

  private updateStageActivities(
    stage: PlanningStageId,
    updater: (activities: Activity[]) => Activity[],
  ): void {
    this.data.updateStageData(stage, (stageData) => {
      const next = updater([...stageData.activities]);
      return {
        ...stageData,
        activities: this.normalizeActivityList(next),
      };
    });
  }

  private replaceActivity(updated: Activity): void {
    const stage = this.activeStageSignal();
    this.updateStageActivities(stage, (activities) => {
      const attrs = (updated.attributes ?? {}) as Record<string, unknown>;
      const linkGroupId = typeof attrs['linkGroupId'] === 'string' ? (attrs['linkGroupId'] as string) : null;
      if (!linkGroupId) {
        return activities.map((activity) => (activity.id === updated.id ? updated : activity));
      }
      return activities.map((activity) => {
        const currentAttrs = (activity.attributes ?? {}) as Record<string, unknown>;
        const currentGroupId =
          typeof currentAttrs['linkGroupId'] === 'string' ? (currentAttrs['linkGroupId'] as string) : null;
        if (!currentGroupId || currentGroupId !== linkGroupId) {
          return activity.id === updated.id ? updated : activity;
        }
        // Gleiche Gruppe: Inhalt übernehmen, Ressourcenkontext beibehalten.
        const next: Activity = {
          ...activity,
          title: updated.title,
          start: updated.start,
          end: updated.end,
          type: updated.type,
          from: updated.from,
          to: updated.to,
          remark: updated.remark,
          attributes: {
            ...(updated.attributes ?? {}),
            ...(activity.attributes ?? {}),
            linkGroupId,
          },
        };
        return next;
      });
    });
    const ownerId = this.activityOwnerId(updated);
    const resource =
      (ownerId
        ? this.stageResourceSignals[stage]().find((entry) => entry.id === ownerId)
        : null) ?? this.activitySelection.selectedActivityState()?.resource ?? null;
    if (resource) {
      this.activitySelection.selectedActivityState.set({
        activity: this.applyActivityTypeConstraints(updated),
        resource,
      });
    } else {
      this.activitySelection.selectedActivityState.set(null);
    }
    this.clearEditingPreview();
  }

  private clearEditingPreview(): void {
    this.activityEditPreviewSignal.set(null);
  }

  private startPendingActivity(stage: PlanningStageId, resource: Resource, activity: Activity): void {
    this.activityFacade.startPendingActivity(
      stage,
      resource,
      activity,
      (state) => this.activitySelection.selectedActivityState.set(state),
      (state) => this.pendingActivitySignal.set(state),
    );
    this.activitySelection.selectedActivityIds.set(new Set());
    this.activitySelection.selectedActivitySlot.set(null);
    this.clearEditingPreview();
  }

  private isPendingSelection(activityId: string | null | undefined): boolean {
    return this.activitySelection.isPendingSelection(
      activityId,
      this.pendingActivitySignal(),
      this.activeStageSignal(),
    );
  }

  private commitPendingActivityUpdate(activity: Activity): void {
    this.activityFacade.commitPendingActivityUpdate(
      this.activeStageSignal(),
      activity,
      this.pendingActivitySignal(),
      this.stageResourceSignals[this.activeStageSignal()](),
      (state) => this.activitySelection.selectedActivityState.set(state),
      (state) => this.pendingActivitySignal.set(state),
    );
  }


  private pendingActivityForStage(stage: PlanningStageId): Activity | null {
    return this.activityFacade.pendingActivityForStage(stage, this.pendingActivitySignal());
  }

  private updatePendingActivityPosition(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    participantResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    sourceResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    this.activityFacade.updatePendingActivityPosition(
      event,
      this.stageResourceSignals[this.activeStageSignal()](),
      (resource) => resourceParticipantCategory(resource),
      (activity, participantId, target) => moveParticipantToResource(activity, participantId, target),
      (activity, owner, partner, partnerRole, opts) =>
        addParticipantToActivity(activity, owner, partner, partnerRole, opts),
      (activity) => this.applyActivityTypeConstraints(activity),
      (activity) => this.commitPendingActivityUpdate(activity),
    );
  }

  private generateActivityId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private buildActivityTitle(definition: ActivityTypeDefinition | null): string {
    return definition?.label ?? 'Aktivität';
  }

  private computeMoveTargetOptions(): Resource[] {
    const selected = this.selectedActivities();
    if (selected.length === 0) {
      return [];
    }
    const baseKind = selected[0].resource.kind;
    const isHomogeneous = selected.every((item) => item.resource.kind === baseKind);
    if (!isHomogeneous) {
      return [];
    }
    const stage = this.activeStageSignal();
    return this.stageResourceSignals[stage]().filter((resource) => resource.kind === baseKind);
  }

  private resolveServiceCategory(
    resource: Resource,
  ): 'personnel-service' | 'vehicle-service' | undefined {
    if (resource.kind === 'personnel' || resource.kind === 'personnel-service') {
      return 'personnel-service';
    }
    if (resource.kind === 'vehicle' || resource.kind === 'vehicle-service') {
      return 'vehicle-service';
    }
    return undefined;
  }

  private resourceParticipantCategory(resource: Resource | null): ActivityParticipantCategory {
    if (!resource) {
      return 'other';
    }
    if (resource.kind === 'vehicle' || resource.kind === 'vehicle-service') {
      return 'vehicle';
    }
    if (resource.kind === 'personnel' || resource.kind === 'personnel-service') {
      return 'personnel';
    }
    return 'other';
  }

  private selectedActivityParticipantIds(): string[] {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return [];
    }
    return getActivityParticipantIds(selection.activity);
  }

  private findActivityType(id: string | null | undefined): ActivityTypeDefinition | null {
    if (!id) {
      return null;
    }
    return this.activityTypeDefinitions().find((definition) => definition.id === id) ?? null;
  }

  private definitionAppliesToResource(definition: ActivityTypeDefinition, resource: Resource): boolean {
    return (definition.relevantFor ?? definition.appliesTo).includes(resource.kind);
  }

  private resolveActivityTypeForResource(
    resource: Resource,
    requestedId: string | null | undefined,
  ): ActivityTypeDefinition | null {
    const definitions = this.activityTypeDefinitions();
    if (requestedId) {
      const requested = definitions.find(
        (definition) => definition.id === requestedId && this.definitionAppliesToResource(definition, resource),
      );
      if (requested) {
        return requested;
      }
    }
    return definitions.find((definition) => this.definitionAppliesToResource(definition, resource)) ?? null;
  }

  protected definitionHasField(
    definition: ActivityTypeDefinition | null,
    field: ActivityFieldKey,
  ): boolean {
    if (field === 'start' || field === 'end') {
      return true;
    }
    if (!definition) {
      return false;
    }
    return definition.fields.includes(field);
  }

  protected shouldShowEndField(definition: ActivityTypeDefinition | null): boolean {
    if (!definition) {
      return true;
    }
    return definition.timeMode !== 'point';
  }

  private normalizeActivityList(list: Activity[]): Activity[] {
    if (!list.length) {
      return list;
    }
    let mutated = false;
    const normalized = list.map((activity) => {
      let next = this.applyActivityTypeConstraints(activity);
      next = this.ensureActivityCatalogAttributes(next);
      if (next !== activity) {
        mutated = true;
      }
      return next;
    });
    return mutated ? normalized : list;
  }

  private applyActivityTypeConstraints(activity: Activity): Activity {
    const definition = this.activityTypeMap().get(activity.type ?? '');
    if (!definition) {
      return activity;
    }
    if (definition.timeMode === 'point' && activity.end) {
      if (activity.end === null) {
        return activity;
      }
      return { ...activity, end: null };
    }
    return activity;
  }

  private ensureActivityCatalogAttributes(activity: Activity): Activity {
    const attrs = (activity.attributes ?? {}) as Record<string, unknown>;
    const existingKey = typeof attrs['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
    const candidateKey = existingKey ?? activity.type ?? null;
    if (!candidateKey) {
      return activity;
    }
    const option = this.activityCatalogOptionMap().get(candidateKey) ?? null;
    let changed = false;
    let nextAttrs: Record<string, unknown> = { ...attrs };
    if (!existingKey) {
      nextAttrs['activityKey'] = candidateKey;
      changed = true;
    }
    if (option?.templateId && !nextAttrs['templateId']) {
      nextAttrs['templateId'] = option.templateId;
      changed = true;
    }
    if (option?.attributes?.length) {
      option.attributes.forEach((attr) => {
        const key = (attr?.key ?? '').trim();
        if (!key || key in nextAttrs) {
          return;
        }
        nextAttrs[key] = attr.meta?.['value'] ?? '';
        changed = true;
      });
    }
    if (!nextAttrs['color']) {
      const color =
        (option?.attributes.find((attr) => attr.key === 'color')?.meta?.['value'] as string | undefined) ??
        defaultColorForType(activity.type ?? option?.activityTypeId ?? null, option?.typeDefinition.category);
      if (color) {
        nextAttrs['color'] = color;
        changed = true;
      }
    }
    const role = resolveServiceRole(option);
    if (role && activity.serviceRole !== role) {
      changed = true;
    }
    if (!changed) {
      return activity;
    }
    return { ...activity, attributes: nextAttrs, serviceRole: role ?? activity.serviceRole };
  }

  private activityOwnerId(activity: Activity): string | null {
    return getActivityOwnerId(activity);
  }

  private moveParticipantToResource(
    activity: Activity,
    fromResourceId: string | null | undefined,
    target: Resource,
  ): Activity {
    if (!fromResourceId) {
      return activity;
    }
    const participants = activity.participants ?? [];
    if (participants.length === 0) {
      return addParticipantToActivity(activity, target, undefined, undefined, {
        retainPreviousOwner: true,
      });
    }
    let updated = false;
    const mapped = participants.map((participant) => {
      if (participant.resourceId !== fromResourceId) {
        return participant;
      }
      updated = true;
      return {
        ...participant,
        resourceId: target.id,
        kind: target.kind,
      };
    });
    const uniq = new Map<string, ActivityParticipant>();
    mapped.forEach((participant) => {
      if (participant?.resourceId) {
        uniq.set(participant.resourceId, participant);
      }
    });
    if (!updated) {
      uniq.set(target.id, {
        resourceId: target.id,
        kind: target.kind,
      });
    }
    return {
      ...activity,
      participants: Array.from(uniq.values()),
    };
  }

  private computeAssignmentCandidates(): Resource[] {
    const pending = this.pendingServiceResourceSignal();
    if (!pending) {
      return [];
    }
    const stage = this.activeStageSignal();
    return computeAssignmentCandidatesFor(pending, this.stageResourceSignals[stage]());
  }


  protected createBoardFromSelection(): void {
    const stage = this.activeStageSignal();
    const selection = this.selectedResourceIds();
    const resources = this.stageResourceSignals[stage]();
    this.boardFacade.createBoardFromSelection(stage, selection, resources);
  }

  protected addSelectionToBoard(boardId: string): void {
    if (!this.hasSelection()) {
      return;
    }
    const stage = this.activeStageSignal();
    const selection = this.selectedResourceIds();
    this.boardFacade.addSelectionToBoard(stage, boardId, selection);
  }

  protected replaceBoardWithSelection(boardId: string): void {
    if (!this.hasSelection()) {
      return;
    }
    const stage = this.activeStageSignal();
    const selection = this.selectedResourceIds();
    this.boardFacade.replaceBoardWithSelection(stage, boardId, selection);
  }

  protected setSelectionFromBoard(boardId: string): void {
    const stage = this.activeStageSignal();
    this.boardFacade.setSelectionFromBoard(stage, boardId);
  }

  protected removeBoard(boardId: string): void {
    const stage = this.activeStageSignal();
    this.boardFacade.removeBoard(stage, boardId);
  }

  protected removeResourceFromBoard(boardId: string, resourceId: string): void {
    const stage = this.activeStageSignal();
    this.boardFacade.removeResourceFromBoard(stage, boardId, resourceId);
  }

  protected handleBoardIndexChange(index: number): void {
    const stage = this.activeStageSignal();
    this.boardFacade.handleBoardIndexChange(stage, index);
  }

  protected boardResources(board: PlanningBoard): Resource[] {
    const stage = this.activeStageSignal();
    return this.boardFacade.boardResources(stage, board);
  }

  protected boardActivities(board: PlanningBoard): Activity[] {
    const stage = this.activeStageSignal();
    return this.boardFacade.boardActivities(stage, board);
  }

  protected boardPendingActivity(board: PlanningBoard): Activity | null {
    const stage = this.activeStageSignal();
    const pending = this.pendingActivityForStage(stage);
    if (pending) {
      const ownerId = this.activityOwnerId(pending);
      if (ownerId && board.resourceIds.includes(ownerId)) {
        return pending;
      }
    }
    const preview = this.activityEditPreviewSignal();
    if (preview && preview.stage === stage) {
      const ownerId = this.activityOwnerId(preview.activity);
      if (ownerId && board.resourceIds.includes(ownerId)) {
        return preview.activity;
      }
    }
    return null;
  }

  protected isActiveBoard(boardId: string): boolean {
    const stage = this.activeStageSignal();
    return this.boardFacade.isActiveBoard(stage, boardId);
  }

  protected isTimetableYearSelected(label: string): boolean {
    const stage = this.activeStageSignal();
    return this.stageYearSelectionState()[stage]?.has(label) ?? false;
  }

  protected onTimetableYearToggle(label: string, checked: boolean): void {
    const stage = this.activeStageSignal();
    this.filterFacade.updateStageYearSelection(stage, this.timetableYearOptions(), (current, options) => {
      const next = new Set(current);
      if (checked) {
        next.add(label);
      } else {
        if (next.size <= 1) {
          return current;
        }
        next.delete(label);
      }
      if (next.size === 0 && options.length) {
        next.add(this.filterFacade.preferredYearLabel(options));
      }
      return next;
    });
  }

  protected selectDefaultTimetableYear(): void {
    const stage = this.activeStageSignal();
    this.filterFacade.updateStageYearSelection(stage, this.timetableYearOptions(), (_current, options) => {
      if (!options.length) {
        return _current;
      }
      return new Set([this.filterFacade.preferredYearLabel(options)]);
    });
  }

  protected selectAllTimetableYears(): void {
    const stage = this.activeStageSignal();
    this.filterFacade.updateStageYearSelection(stage, this.timetableYearOptions(), (_current, options) => {
      if (!options.length) {
        return _current;
      }
      return new Set(options.map((year) => year.label));
    });
  }

  protected onSimulationSelect(simulationId: string): void {
    const sim = this.simulationOptions().find((entry) => entry.id === simulationId);
    if (!sim) {
      return;
    }
    this.selectedSimulationSignal.set(sim);
    this.filterFacade.applySimulationSelection(sim);
  }

  private computeResourceGroups(stage: PlanningStageId): ResourceGroupView[] {
    const resources = this.boardFacade.filterResourcesForStage(stage, this.stageResourceSignals[stage]());
    const configs = STAGE_RESOURCE_GROUPS[stage];
    return configs
      .map((config) => {
        const items = resources.filter((resource) => this.resourceCategory(resource) === config.category);
        if (items.length === 0) {
          return null;
        }
        return {
          ...config,
          resources: items,
        };
      })
      .filter((group): group is ResourceGroupView => !!group);
  }

  private resourceCategory(resource: Resource): PlanningResourceCategory | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const category = (attributes?.['category'] ?? null) as string | null;
    if (
      category === 'vehicle-service' ||
      category === 'personnel-service' ||
      category === 'vehicle' ||
      category === 'personnel'
    ) {
      return category;
    }
    if (
      resource.kind === 'vehicle-service' ||
      resource.kind === 'personnel-service' ||
      resource.kind === 'vehicle' ||
      resource.kind === 'personnel'
    ) {
      return resource.kind as PlanningResourceCategory;
    }
    return null;
  }

  private updateStageState(
    stage: PlanningStageId,
    reducer: (state: StageRuntimeState) => StageRuntimeState,
  ): void {
    this.stageStore.updateStage(stage, (state) => reducer(state));
  }

  private computeTimelineRange(stage: PlanningStageId): PlanningTimelineRange {
    if (stage === 'base') {
      return this.stageTimelineSignals.base();
    }
    const selectedYears = this.selectedYearBounds(stage);
    if (!selectedYears.length) {
      return this.stageTimelineSignals[stage]();
    }
    const minStart = Math.min(...selectedYears.map((year) => year.start.getTime()));
    const maxEnd = Math.max(...selectedYears.map((year) => year.end.getTime()));
    return {
      start: new Date(minStart),
      end: new Date(maxEnd),
    };
  }

  private computeBaseTimelineRange(): PlanningTimelineRange {
    const variant = this.planningVariant();
    const bounds = variant?.timetableYearLabel
      ? this.timetableYearService.getYearByLabel(variant.timetableYearLabel)
      : this.timetableYearService.defaultYearBounds();
    const fromIso = this.queryFrom() ?? bounds.startIso;
    const toIso = this.queryTo() ?? bounds.endIso;
    const start = new Date(`${fromIso}T00:00:00Z`);
    const end = new Date(`${toIso}T23:59:59Z`);
    return { start, end };
  }

  private computeStageYearRange(
    stage: PlanningStageId,
  ): { startIso: string; endIso: string } | null {
    const selected = this.selectedYearBounds(stage);
    const source =
      selected.length > 0 ? selected : [this.timetableYearService.defaultYearBounds()];
    if (!source.length) {
      return null;
    }
    const minStart = Math.min(...source.map((year) => year.start.getTime()));
    const maxEnd = Math.max(...source.map((year) => year.end.getTime()));
    return {
      startIso: toIsoDate(new Date(minStart)),
      endIso: toIsoDate(new Date(maxEnd)),
    };
  }

  private selectedYearBounds(stage: PlanningStageId): TimetableYearBounds[] {
    return this.filterFacade.selectedYearBounds(stage, this.timetableYearOptions());
  }

  private mapActivityToReferenceWeek(activity: Activity): Activity {
    const template = this.templateStore.selectedTemplate();
    const periods = template?.periods ?? defaultTemplatePeriod(this.timetableYearService.defaultYearBounds());
    return this.activityFacade.mapActivityToReferenceWeek(
      activity,
      periods,
      this.timetableYearService.defaultYearBounds().end,
    );
  }

  private createActivityDraft(
    event: { resource: Resource; start: Date },
    definition: ActivityTypeDefinition,
    option: ActivityCatalogOption | null,
  ): Activity {
    const draft = this.activityFacade.createDraft(
      this.activeStageSignal(),
      event,
      definition,
      option,
    );
    return draft;
  }

  private handleBaseActivityReposition(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    participantResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    sourceResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    const resources = this.stageResourceSignals.base();
    const targetResource = resources.find((res) => res.id === event.targetResourceId) ?? null;
    const base: Activity = {
      ...event.activity,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
    };
    const isOwnerSlot = event.isOwnerSlot ?? true;
    const participantResourceId = event.participantResourceId ?? event.sourceResourceId ?? null;
    const category = event.participantCategory ?? resourceParticipantCategory(targetResource);
    const updated = targetResource
      ? !isOwnerSlot && participantResourceId
        ? moveParticipantToResource(base, participantResourceId, targetResource)
        : addParticipantToActivity(base, targetResource, undefined, undefined, {
            retainPreviousOwner: false,
            ownerCategory: category,
          })
      : base;
    const normalized = this.applyActivityTypeConstraints(updated);
    // Sofort lokal die angeklickte Instanz ersetzen; andere Reflektionen bleiben bis zur nächsten Reload unverändert.
    const baseId = event.activity.id.split('@')[0] ?? event.activity.id;
    this.updateStageActivities('base', (activities) =>
      activities.map((activity) =>
        activity.id === event.activity.id
          ? {
              ...activity,
              start: normalized.start,
              end: normalized.end,
              participants: normalized.participants,
              attributes: normalized.attributes,
              type: normalized.type,
              title: normalized.title,
              from: normalized.from,
              to: normalized.to,
              remark: normalized.remark,
            }
          : activity,
      ),
    );
    // Persistenz gegen Template erfolgt mit Basis-ID (ohne Reflektions-Suffix) und der aktuellen Zeitlage.
    this.saveTemplateActivity({ ...normalized, id: baseId });
    const resource = targetResource ?? this.activitySelection.selectedActivityState()?.resource ?? null;
    const currentSelection = this.activitySelection.selectedActivityState();
    if (resource && currentSelection?.activity.id === event.activity.id) {
      this.activitySelection.selectedActivityState.set({ activity: normalized, resource });
    }
  }

  private saveTemplateActivity(activity: Activity): void {
    const templateId = this.templateStore.selectedTemplate()?.id;
    if (!templateId) {
      return;
    }
    this.data.upsertTemplateActivity(templateId, activity);
  }

  private setActiveStage(stage: PlanningStageId, updateUrl: boolean): void {
    const current = this.activeStageSignal();
    if (current === stage) {
      if (updateUrl) {
        this.updateStageQueryParam(stage);
      }
      return;
    }
    this.activitySelection.selectedActivityState.set(null);
    this.pendingServiceResourceSignal.set(null);
    this.serviceAssignmentTargetSignal.set(null);
    this.clearActivitySelection();
    this.activeStageSignal.set(stage);
    if (updateUrl) {
      this.updateStageQueryParam(stage);
    }
  }

  private updateStageQueryParam(stage: PlanningStageId): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { stage },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private normalizeStageId(value: string | null): PlanningStageId {
    if (value && value in this.stageMetaMap) {
      return value as PlanningStageId;
    }
    return 'base';
  }
}
