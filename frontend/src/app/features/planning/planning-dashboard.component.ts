import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Signal, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuTrigger } from '@angular/material/menu';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { GanttComponent } from '../../gantt/gantt.component';
import { GanttWindowLauncherComponent } from './components/gantt-window-launcher.component';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { PlanningDataService } from './planning-data.service';
import type { PlanningTimelineRange } from './planning-data.types';
import { Resource } from '../../models/resource';
import { Activity, ServiceRole } from '../../models/activity';
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
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';
import { SimulationService } from '../../core/services/simulation.service';
import { SimulationRecord } from '../../core/models/simulation.model';
import { ActivityLinkRole, ActivityLinkRoleDialogComponent, ActivityLinkRoleDialogResult } from './activity-link-role-dialog.component';
import { TemplateTimelineStoreService } from './template-timeline-store.service';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import { ActivityApiService } from '../../core/api/activity-api.service';
import { PlanningBoard, PlanningStageStore, StageRuntimeState } from './stores/planning-stage.store';
import { PlanningDashboardBoardFacade } from './planning-dashboard-board.facade';
import { ActivityCatalogOption, ActivityTypePickerGroup } from './planning-dashboard.types';
import {
  buildAttributesFromCatalog,
  defaultColorForType,
  defaultTemplatePeriod,
  findNeighborActivities,
  isActivityOwnedBy,
  mapLinkRoleToParticipantRole,
  computeAssignmentCandidatesFor,
  buildActivityTitle,
  resolveActivityTypeForResource,
  resolveServiceCategory,
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
import { PlanningDashboardSelectionActionsFacade } from './planning-dashboard-selection-actions.facade';
import { PlanningDashboardSelectionHandlers } from './planning-dashboard-selection.handlers';
import { initFormEffects, initSimulationSelectionEffects } from './planning-dashboard-form.effects';
import {
  initTemplateTimelineEffects,
  initStageResourceEffects,
  initStageCleanupEffects,
  initTimetableYearEffects,
  initSelectionMaintenanceEffects,
} from './planning-dashboard-stage.effects';
import { buildStageMetaMap } from './planning-dashboard-stage.utils';
import { PlanningDashboardBoardActionsFacade } from './planning-dashboard-board.actions';
import { PlanningDashboardCatalogFacade } from './planning-dashboard-catalog.facade';
import {
  computeTimelineRange,
  computeResourceGroups,
  computeBaseTimelineRange,
  computeStageYearRange,
} from './planning-dashboard-timeline.utils';
import { buildActivityFromForm, areActivitiesEquivalent } from './planning-dashboard-activity.handlers';
import { PlanningDashboardActivityHandlersFacade } from './planning-dashboard-activity.handlers.facade';
import { PlanningDashboardUiFacade } from './planning-dashboard-ui.facade';
import { PlanningDashboardPendingFacade } from './planning-dashboard-pending.facade';
import { PlanningDashboardBaseHandlers } from './planning-dashboard-base.handlers';
import { PlanningDashboardTimelineFacade } from './planning-dashboard-timeline.facade';
import { PlanningDashboardSelectionFacade } from './planning-dashboard-selection.facade';
import { PlanningDashboardYearFacade } from './planning-dashboard-year.facade';
import { PlanningDashboardRoutingFacade } from './planning-dashboard-routing.facade';
import { PlanningDashboardSimulationFacade } from './planning-dashboard-simulation.facade';
import { PlanningDashboardOperationsHandlers } from './planning-dashboard-operations.handlers';
import { PlanningDashboardFormFacade } from './planning-dashboard-form.facade';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog/confirm-dialog.component';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { EMPTY } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, startWith, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanningDashboardAssignmentFacade } from './planning-dashboard-assignment.facade';
import { PlanningDashboardActivityOpsFacade } from './planning-dashboard-activity-ops.facade';
import { PlanningDashboardSelectionState } from './planning-dashboard-selection.state';
import { PlanningDashboardFilterHandlers } from './planning-dashboard-filter.handlers';
import { PlanningDashboardCopyHandlers } from './planning-dashboard-copy.handlers';
import { applyActivityTypeConstraints as applyActivityTypeConstraintsUtil, normalizeActivityList } from './planning-dashboard-activity-normalize.utils';
import { normalizeStageId, updateStageQueryParam } from './planning-dashboard-stage.utils';
import { fromLocalDateTime, toIsoDate, toLocalDateTime } from './planning-dashboard-time.utils';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { findActivityTypeById, definitionHasField, shouldShowEndField } from './planning-dashboard-activity.helpers';
import { STAGE_RESOURCE_GROUPS, TYPE_PICKER_META, type ActivityEditPreviewState, type PendingActivityState } from './planning-dashboard.constants';
import { ConflictEntry, mapConflictCodes } from '../../shared/planning-conflicts';

type LocationAutocompleteOption = {
  key: string;
  value: string;
  label: string;
  description?: string;
  search: string;
};

@Component({
    selector: 'app-planning-dashboard',
    imports: [
        CommonModule,
        ReactiveFormsModule,
        ...MATERIAL_IMPORTS,
        DragDropModule,
        GanttComponent,
        GanttWindowLauncherComponent,
    ],
    templateUrl: './planning-dashboard.component.html',
    styleUrl: './planning-dashboard.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlanningDashboardComponent {
  private readonly data = inject(PlanningDataService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly timetableYearService = inject(TimetableYearService);
  private readonly managedTimetableYearBounds = this.timetableYearService.managedYearBoundsSignal();
  private readonly templateStore = inject(TemplateTimelineStoreService);
  private readonly timelineApi = inject(TimelineApiService);
  private readonly activityApi = inject(ActivityApiService);
  private readonly templateMetaLoad = signal(false);
  private readonly simulationService = inject(SimulationService);
  private readonly publishInProgress = signal(false);
  private readonly snapshotInProgress = signal(false);
  private readonly planningStore = inject(PlanningStoreService);

  private readonly fromLocationQuerySignal = signal('');
  private readonly toLocationQuerySignal = signal('');

  readonly stages = PLANNING_STAGE_METAS;
  private readonly stageMetaMap: Record<PlanningStageId, PlanningStageMeta> = buildStageMetaMap(this.stages);

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
  private readonly activityFacade: PlanningDashboardActivityFacade = new PlanningDashboardActivityFacade({
    activityOwnerId: (activity) => this.activityOwnerId(activity),
    addParticipantToActivity: (activity, owner, partner, partnerRole, opts) =>
      addParticipantToActivity(activity, owner, partner, partnerRole, opts),
    moveParticipantToResource: (activity, participantId, target) =>
      moveParticipantToResource(activity, participantId, target),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    definitionHasField: (definition, field) => this.definitionHasField(definition, field),
    resolveServiceCategory: (resource) => resolveServiceCategory(resource),
    resourceParticipantCategory: (resource) => resourceParticipantCategory(resource),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    replaceActivity: (activity) => this.activityOpsFacade.replaceActivity(activity),
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
    buildAttributesFromCatalog: (option) => buildAttributesFromCatalog(option),
    resolveServiceRole: (option) => resolveServiceRole(option),
    buildActivityTitle: (definition) => buildActivityTitle(definition),
    generateActivityId: (seed: string) => this.activityOpsFacade.generateActivityId(seed),
    findActivityType: (typeId) => this.findActivityType(typeId),
  });
  private readonly activitySelection = new PlanningDashboardActivitySelectionFacade();

  private readonly stageTimelineSignals = {
    base: computed(() =>
      computeBaseTimelineRange({
        variant: this.planningVariant(),
        timetableYearService: this.timetableYearService,
        queryFrom: this.queryFrom(),
        queryTo: this.queryTo(),
      }),
    ),
    operations: this.data.stageTimelineRange('operations'),
  } as const;

  private readonly activeStageSignal = signal<PlanningStageId>('base');

  private readonly activityTypeService = inject(ActivityTypeService);
  private readonly activityCatalog = inject(ActivityCatalogService);
  private readonly translationService = inject(TranslationService);
  private readonly catalogFacade = new PlanningDashboardCatalogFacade(
    this.activityTypeService,
    this.activityCatalog,
    this.translationService,
    TYPE_PICKER_META,
    this.activitySelection,
    () => this.activityCreationToolSignal(),
    () => this.activityTypeMenuSelection(),
  );

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
    generateActivityId: (prefix) => this.activityOpsFacade.generateActivityId(prefix),
  });
  private readonly timelineFacade = new PlanningDashboardTimelineFacade({
    activeStage: () => this.activeStageSignal(),
    stageResourceSignals: this.stageResourceSignals,
    stageTimelineBase: this.stageTimelineSignals.base,
    stageTimelineOperations: this.stageTimelineSignals.operations,
    selectedYearBounds: (stage) => this.selectedYearBounds(stage),
    boardFacade: this.boardFacade,
    stageResourceGroups: STAGE_RESOURCE_GROUPS,
  });
  private readonly selectionFacade = new PlanningDashboardSelectionFacade({
    activeStage: () => this.activeStageSignal(),
    stageStore: this.stageStore,
    resourceViewModeState: this.resourceViewModeState,
    setResourceViewModeState: (updater) => this.resourceViewModeState.update((current) => updater(current)),
    stageResourceSignals: this.stageResourceSignals,
  });
  private readonly stageYearSelectionState = this.filterFacade.stageYearSelectionState;
  private readonly pendingActivitySignal = signal<PendingActivityState | null>(null);
  private readonly pendingActivityOriginal = signal<Activity | null>(null);
  private readonly activityDetailsOpenSignal = signal(true);
  private readonly timeSyncSourceSignal = signal<'end' | 'duration'>('end');
  private readonly activityTypeSearchQuerySignal = signal('');
  private readonly favoriteActivityTypeOptionIdsSignal = signal<string[]>(
    this.loadActivityTypePickerState().favorites,
  );
  private readonly recentActivityTypeOptionIdsSignal = signal<string[]>(
    this.loadActivityTypePickerState().recents,
  );
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
    durationMinutes: [''],
    type: [''],
    from: [''],
    to: [''],
    remark: [''],
  });

  protected readonly includePersonnelSitesInLocationLookup = computed(() => {
    const selection = this.activitySelection.selectedActivityState();
    const kind = selection?.resource.kind ?? null;
    return kind === 'personnel' || kind === 'personnel-service';
  });

  private readonly operationalPointLocationOptions = computed<LocationAutocompleteOption[]>(() => {
    const ops = this.planningStore.operationalPoints();
    const mapped = ops
      .filter((op) => op.uniqueOpId?.trim().length)
      .map((op) => {
        const uniqueId = op.uniqueOpId.trim();
        const name = (op.name ?? '').trim();
        return {
          key: `op:${uniqueId}`,
          value: uniqueId,
          label: uniqueId,
          description: name,
          search: `${uniqueId} ${name}`.toLowerCase(),
        } satisfies LocationAutocompleteOption;
      });
    mapped.sort((a, b) => a.label.localeCompare(b.label, 'de'));
    return mapped;
  });

  private readonly personnelSiteLocationOptions = computed<LocationAutocompleteOption[]>(() => {
    const sites = this.planningStore.personnelSites();
    const opMap = this.planningStore.operationalPointMap();
    const mapped = sites
      .filter((site) => site.uniqueOpId?.trim().length)
      .map((site) => {
        const uniqueId = site.uniqueOpId?.trim() ?? '';
        const opName = uniqueId ? (opMap.get(uniqueId)?.name ?? '').trim() : '';
        const siteName = (site.name ?? '').trim();
        const siteType = (site.siteType ?? '').trim();
        const descriptionParts = [
          siteType,
          opName ? opName : null,
          uniqueId ? `(${uniqueId})` : null,
        ].filter(Boolean) as string[];
        return {
          key: `site:${site.siteId}`,
          value: uniqueId,
          label: siteName || uniqueId,
          description: descriptionParts.join(' · '),
          search: `${siteName} ${siteType} ${uniqueId} ${opName}`.toLowerCase(),
        } satisfies LocationAutocompleteOption;
      })
      .filter((entry) => entry.value.length > 0);
    mapped.sort((a, b) => a.label.localeCompare(b.label, 'de'));
    return mapped;
  });

  protected readonly fromOperationalPointOptions = computed(() =>
    this.filterLocationOptions(this.fromLocationQuerySignal(), this.operationalPointLocationOptions(), 60),
  );
  protected readonly toOperationalPointOptions = computed(() =>
    this.filterLocationOptions(this.toLocationQuerySignal(), this.operationalPointLocationOptions(), 60),
  );

  protected readonly fromPersonnelSiteOptions = computed(() => {
    if (!this.includePersonnelSitesInLocationLookup()) {
      return [];
    }
    return this.filterLocationOptions(this.fromLocationQuerySignal(), this.personnelSiteLocationOptions(), 30);
  });
  protected readonly toPersonnelSiteOptions = computed(() => {
    if (!this.includePersonnelSitesInLocationLookup()) {
      return [];
    }
    return this.filterLocationOptions(this.toLocationQuerySignal(), this.personnelSiteLocationOptions(), 30);
  });
  private readonly routingFacade = new PlanningDashboardRoutingFacade({
    route: this.route,
    router: this.router,
    stageMetaMap: this.stageMetaMap,
    activeStageSignal: this.activeStageSignal,
    queryFrom: this.queryFrom,
    queryTo: this.queryTo,
    destroyRef: this.destroyRef,
  });
  private readonly yearFacade = new PlanningDashboardYearFacade({
    activeStage: () => this.activeStageSignal(),
    filterFacade: this.filterFacade,
    timetableYearService: this.timetableYearService,
    managedYearBounds: this.managedTimetableYearBounds,
    stageYearSelectionState: this.stageYearSelectionState,
  });
  private readonly simulationFacade = new PlanningDashboardSimulationFacade({
    activeStage: () => this.activeStageSignal(),
    stageYearSelectionState: this.stageYearSelectionState,
    filterFacade: this.filterFacade,
    timetableYearOptions: this.yearFacade.timetableYearOptions,
    simulationService: this.simulationService,
    selectedSimulationSignal: this.selectedSimulationSignal,
  });
  private readonly operationsHandlers = new PlanningDashboardOperationsHandlers({
    stageResourceSignal: this.stageResourceSignals.operations,
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    activitySelection: this.activitySelection,
    activityOwnerId: (activity) => this.activityOwnerId(activity),
  });
  private readonly assignmentFacade = new PlanningDashboardAssignmentFacade({
    activeStage: () => this.activeStageSignal(),
    pendingServiceResourceSignal: this.pendingServiceResourceSignal,
    serviceAssignmentTargetSignal: this.serviceAssignmentTargetSignal,
    stageResourceSignals: this.stageResourceSignals,
    serviceAssignmentFacade: this.serviceAssignmentFacade,
  });
  private readonly copyHandlers = new PlanningDashboardCopyHandlers({
    dialog: this.dialog,
    activeStage: () => this.activeStageSignal(),
    activityOwnerId: (activity) => this.activityOwnerId(activity),
    stageResourceSignals: this.stageResourceSignals,
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    applyBaseCopyWithRoles: (source, sourceResource, targetResource, roles) =>
      this.baseHandlers.applyCopyWithRoles(source, sourceResource, targetResource, roles),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
  });
  private readonly selectionState = new PlanningDashboardSelectionState({
    activitySelection: this.activitySelection,
    normalizedStageActivitySignals: this.normalizedStageActivitySignals,
    stageResourceSignals: this.stageResourceSignals,
    activeStage: () => this.activeStageSignal(),
    activityMoveTargetSignal: this.activityMoveTargetSignal,
    stageState: (stage) => this.stageStore.stageState(stage),
  });

  private readonly boardResourcesCache = new Map<
    string,
    { resourceIdsRef: string[]; stageResourcesRef: Resource[]; result: Resource[] }
  >();
  private readonly boardActivitiesCache = new Map<
    string,
    { resourceIdsRef: string[]; stageActivitiesRef: Activity[]; result: Activity[] }
  >();

  @ViewChild('typeSearchInput') private readonly typeSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('typeMenuTrigger') private readonly typeMenuTrigger?: MatMenuTrigger;

  constructor() {
    this.planningStore.ensureInitialized();
    this.activityForm.controls['from'].valueChanges
      .pipe(
        startWith(this.activityForm.controls['from'].value ?? ''),
        map((value) => (value ?? '').toString()),
        debounceTime(80),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((value) => this.fromLocationQuerySignal.set(value));
    this.activityForm.controls['to'].valueChanges
      .pipe(
        startWith(this.activityForm.controls['to'].value ?? ''),
        map((value) => (value ?? '').toString()),
        debounceTime(80),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((value) => this.toLocationQuerySignal.set(value));

    this.templateStore.loadTemplates();
    this.routingFacade.init();

    initTemplateTimelineEffects({
      templateStore: this.templateStore,
      computeBaseTimelineRange: () =>
        computeBaseTimelineRange({
          variant: this.planningVariant(),
          timetableYearService: this.timetableYearService,
          queryFrom: this.queryFrom(),
          queryTo: this.queryTo(),
        }),
      currentVariantId: () => this.planningVariant()?.id ?? 'default',
      data: this.data,
    });

    initStageResourceEffects({
      stageOrder: this.stageOrder,
      stageResourceSignals: this.stageResourceSignals,
      boardFacade: this.boardFacade,
    });

    initStageCleanupEffects({
      pendingActivitySignal: this.pendingActivitySignal,
      activeStageSignal: () => this.activeStageSignal(),
      activitySelection: this.activitySelection,
      activityEditPreviewSignal: this.activityEditPreviewSignal,
      clearEditingPreview: () => this.pendingFacade.clearEditingPreview(),
    });

    initSimulationSelectionEffects({
      simulationOptions: this.simulationOptions,
      selectedSimulationSignal: this.selectedSimulationSignal,
      filterFacade: this.filterFacade,
      dataSetPlanningVariant: (variant) => this.data.setPlanningVariant(variant),
    });

    initFormEffects({
      destroyRef: this.destroyRef,
      activityForm: this.activityForm,
      activityFormTypeSignal: () => this.activityFormTypeSignal(),
      setActivityFormType: (val) => this.activityFormTypeSignal.set(val),
      setActivityFormPristine: () => this.activityForm.markAsPristine(),
      findActivityType: (typeId) => this.findActivityType(typeId),
      selectedCatalogOption: this.selectedCatalogOption,
      selectedActivityState: this.activitySelection.selectedActivityState,
      activitySelection: this.activitySelection,
      isPendingSelection: (id) => this.pendingFacade.isPendingSelection(id),
      clearEditingPreview: () => this.pendingFacade.clearEditingPreview(),
      updatePendingActivityFromForm: () => this.formFacade.updatePendingActivityFromForm(),
      updateEditingPreviewFromForm: () => this.formFacade.updateEditingPreviewFromForm(),
      activityCreationOptions: this.activityCreationOptions,
      activityCreationToolSignal: () => this.activityCreationToolSignal(),
      setActivityCreationTool: (val) => this.setActivityCreationTool(val),
      selectedCatalogOptionMapHas: (key) => this.activityCatalogOptionMap().has(key),
      activityCreationToolSetter: (val) => this.activityCreationToolSignal.set(val),
      activityTypeCandidates: this.activityTypeCandidates,
      quickActivityTypes: this.quickActivityTypes,
      activityTypeMenuSelection: this.activityTypeMenuSelection,
      timeSyncSource: () => this.timeSyncSourceSignal(),
      setTimeSyncSource: (value) => this.timeSyncSourceSignal.set(value),
    });

    initTimetableYearEffects({
      stageOrder: this.stageOrder,
      timetableYearOptions: this.timetableYearOptions,
      filterFacade: this.filterFacade,
    });

    initSelectionMaintenanceEffects({
      activeStageSignal: () => this.activeStageSignal(),
      normalizedStageActivitySignals: this.normalizedStageActivitySignals,
      activitySelection: this.activitySelection,
      moveTargetOptions: this.moveTargetOptions,
      activityMoveTargetSignal: this.activityMoveTargetSignal,
    });
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

  protected readonly timelineRange = this.timelineFacade.timelineRange;

  protected readonly resourceGroups = this.timelineFacade.resourceGroups;

  protected readonly simulationOptions = this.simulationFacade.simulationOptions;

  protected readonly selectedSimulationId = this.simulationFacade.selectedSimulationId;

  protected readonly selectedSimulationLabel = this.simulationFacade.selectedSimulationLabel;

  protected readonly timetableYearOptions = this.yearFacade.timetableYearOptions;

  protected readonly timetableYearSummary = this.yearFacade.timetableYearSummary;
  protected readonly basePlanningYearRange = this.yearFacade.basePlanningYearRange;

  protected readonly boards = computed(() => this.stageStore.stageState(this.activeStageSignal())().boards);
  protected readonly activityTypeDisplayLabelMap = this.catalogFacade.activityTypeDisplayLabelMap;
  protected readonly activityTypeMap = this.catalogFacade.activityTypeMap;
  protected readonly activityCreationOptions = this.catalogFacade.activityCreationOptions;
  protected readonly activityTypeCandidates = this.catalogFacade.activityTypeCandidates;
  protected readonly quickActivityTypes = this.catalogFacade.quickActivityTypes;
  protected readonly activityTypePickerGroups = this.catalogFacade.activityTypePickerGroups;
  protected readonly activityCatalogOptionMap = this.catalogFacade.activityCatalogOptionMap;
  protected readonly selectedCatalogOption = this.catalogFacade.selectedCatalogOption;
  private readonly pendingFacade: PlanningDashboardPendingFacade = new PlanningDashboardPendingFacade({
    activeStage: () => this.activeStageSignal(),
    activityFacade: this.activityFacade,
    activitySelection: this.activitySelection,
    pendingActivitySignal: this.pendingActivitySignal,
    stageResourceSignals: this.stageResourceSignals,
    setSelectedActivityState: (state) => this.activitySelection.selectedActivityState.set(state),
    setPendingActivity: (state) => this.pendingActivitySignal.set(state),
    setEditPreview: (state) => this.activityEditPreviewSignal.set(state),
    resourceParticipantCategory: (resource) => resourceParticipantCategory(resource),
    moveParticipantToResource: (activity, participantId, target) => moveParticipantToResource(activity, participantId, target),
    addParticipantToActivity: (activity, owner, partner, partnerRole, opts) =>
      addParticipantToActivity(activity, owner, partner, partnerRole, opts),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
  });
  private readonly activityOpsFacade: PlanningDashboardActivityOpsFacade = new PlanningDashboardActivityOpsFacade({
    data: this.data,
    activeStage: () => this.activeStageSignal(),
    normalizeActivityList: (list) => this.normalizeActivityList(list),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    activitySelection: this.activitySelection,
    pendingFacade: this.pendingFacade,
    activityOwnerId: (activity) => this.activityOwnerId(activity),
    stageResourceSignals: this.stageResourceSignals,
  });
  private readonly boardActionsFacade = new PlanningDashboardBoardActionsFacade({
    boardFacade: this.boardFacade,
    activeStage: () => this.activeStageSignal(),
    selectedResourceIds: () => this.selectedResourceIds(),
    stageResourceSignals: this.stageResourceSignals,
    stageStore: this.stageStore,
    pendingActivityForStage: (stage) => this.pendingFacade.pendingActivityForStage(stage),
    previewActivityForStage: (stage) => {
      const preview = this.activityEditPreviewSignal();
      return preview && preview.stage === stage ? preview.activity : null;
    },
    activityOwnerId: (activity) => this.activityOwnerId(activity),
  });
  private readonly filterHandlers = new PlanningDashboardFilterHandlers({
    yearFacade: this.yearFacade,
    simulationFacade: this.simulationFacade,
  });
  private readonly formFacade = new PlanningDashboardFormFacade({
    activityForm: this.activityForm,
    activityFacade: this.activityFacade,
    activitySelection: this.activitySelection,
    pendingFacade: this.pendingFacade,
    pendingActivitySignal: this.pendingActivitySignal,
    activeStage: () => this.activeStageSignal(),
    selectedCatalogOption: this.selectedCatalogOption,
    findActivityType: (id) => this.findActivityType(id),
    buildActivityTitle: (definition) => buildActivityTitle(definition),
    definitionHasField: (definition, field) => this.definitionHasField(definition, field as ActivityFieldKey),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    setEditPreview: (state) => this.activityEditPreviewSignal.set(state),
    clearEditPreview: () => this.pendingFacade.clearEditingPreview(),
  });
  private readonly uiFacade = new PlanningDashboardUiFacade({
    activityCreationOptions: this.catalogFacade.activityCreationOptions,
    activityCatalogOptionMap: () => this.activityCatalogOptionMap(),
    activityCreationToolSignal: this.activityCreationToolSignal,
    activityFormTypeSignal: this.activityFormTypeSignal,
    activityTypeMenuSelection: this.activityTypeMenuSelection,
    activityForm: this.activityForm,
  });
  private readonly baseHandlers = new PlanningDashboardBaseHandlers({
    stageResourceSignal: this.stageResourceSignals.base,
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
    activitySelection: this.activitySelection,
    templateId: () => this.templateStore.selectedTemplate()?.id ?? null,
  });
  private readonly activityHandlers = new PlanningDashboardActivityHandlersFacade({
    activeStage: () => this.activeStageSignal(),
    activityFacade: this.activityFacade,
    activitySelection: this.activitySelection,
    templateSelected: () => !!this.templateStore.selectedTemplate()?.id,
    selectedTemplateId: () => this.templateStore.selectedTemplate()?.id ?? null,
    activityCreationTool: () => this.activityCreationToolSignal(),
    catalogOptionById: (id) => this.activityCatalogOptionMap().get(id),
    resolveActivityTypeForResource: (resource, typeId) =>
      resolveActivityTypeForResource(resource, typeId, this.activityTypeDefinitions()),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    pendingActivityOriginal: this.pendingActivityOriginal,
    pendingActivitySignal: this.pendingActivitySignal,
    startPendingActivity: (stage, resource, activity) => this.pendingFacade.startPendingActivity(stage, resource, activity),
    activityForm: this.activityForm,
    selectedCatalogOption: this.selectedCatalogOption,
    findActivityType: (typeId) => findActivityTypeById(this.activityTypeDefinitions, typeId),
    buildActivityTitle: (definition) => buildActivityTitle(definition),
    definitionHasField: (definition, field) => this.definitionHasField(definition, field),
    isPendingSelection: (id) => this.pendingFacade.isPendingSelection(id),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
    replaceActivity: (activity) => this.activityOpsFacade.replaceActivity(activity),
    clearEditingPreview: () => this.pendingFacade.clearEditingPreview(),
    deleteTemplateActivity: (templateId, baseId) => this.data.deleteTemplateActivity(templateId, baseId),
  });

  protected readonly activityTypeDefinitions = this.activityTypeService.definitions;

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

  protected readonly activityTypeSearchQuery = computed(() => this.activityTypeSearchQuerySignal());

  protected readonly favoriteActivityTypeOptions = computed<ActivityCatalogOption[]>(() =>
    this.mapActivityTypeOptionIds(this.favoriteActivityTypeOptionIdsSignal(), 12),
  );

  protected readonly recentActivityTypeOptions = computed<ActivityCatalogOption[]>(() =>
    this.mapActivityTypeOptionIds(this.recentActivityTypeOptionIdsSignal(), 12),
  );

  protected readonly filteredActivityTypePickerGroups = computed<ActivityTypePickerGroup[]>(() => {
    const query = this.activityTypeSearchQuerySignal().trim().toLowerCase();
    const groups = this.activityTypePickerGroups();
    if (!query) {
      return groups;
    }
    const tokens = query.split(/\s+/).filter(Boolean);
    const matches = (option: ActivityCatalogOption) => {
      const haystack = `${option.label} ${option.description ?? ''} ${option.id} ${option.activityTypeId}`.toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    };
    return groups
      .map((group) => ({ ...group, items: group.items.filter(matches) }))
      .filter((group) => group.items.length > 0);
  });

  protected readonly activeTypePickerGroup = computed<ActivityTypePickerGroup | null>(() => {
    const groups = this.filteredActivityTypePickerGroups();
    if (!groups.length) {
      return null;
    }
    const current = this.activityTypeMenuSelection();
    return groups.find((group) => group.id === current) ?? groups[0];
  });

  protected readonly resourceViewModes = this.selectionFacade.resourceViewModes();

  protected readonly activityCreationTool = computed(() => this.activityCreationToolSignal());
  // Bind service methods to preserve `this` when used as callbacks in the template.
  protected readonly resourceError = this.data.resourceError.bind(this.data);
  protected readonly timelineError = this.data.timelineError.bind(this.data);
  protected readonly templateError = this.templateStore.error;

  protected readonly selectedActivity = this.selectionState.selectedActivity;
  protected readonly selectedActivities = this.selectionState.selectedActivities;
  protected readonly selectedActivityIdsArray = this.selectionState.selectedActivityIdsArray;
  protected readonly selectedActivitySlot = this.selectionState.selectedActivitySlot;
  protected readonly moveTargetOptions = () => this.selectionState.moveTargetOptions();
  protected readonly activityMoveTarget = this.selectionState.activityMoveTarget;

  protected readonly selectedActivityDefinition = computed<ActivityTypeDefinition | null>(() => {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return null;
    }
    const typeOverride = this.activityFormTypeSignal();
    const typeId = (typeOverride || selection.activity.type) ?? null;
    return findActivityTypeById(this.activityTypeDefinitions, typeId);
  });

  private readonly selectionActionsFacade = new PlanningDashboardSelectionActionsFacade({
    activitySelection: this.activitySelection,
    activityFacade: this.activityFacade,
    stageResourceSignals: this.stageResourceSignals,
    activeStage: () => this.activeStageSignal(),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    isPendingSelection: (id) => this.pendingFacade.isPendingSelection(id),
    commitPendingActivityUpdate: (activity) => this.pendingFacade.commitPendingActivityUpdate(activity),
    replaceActivity: (activity) => this.activityOpsFacade.replaceActivity(activity),
    findActivityType: (typeId) => this.findActivityType(typeId),
    activityMoveTargetSignal: this.activityMoveTargetSignal,
  });
  private readonly selectionHandlers = new PlanningDashboardSelectionHandlers({
    activeStage: () => this.activeStageSignal(),
    pendingFacade: this.pendingFacade,
    selectionActions: this.selectionActionsFacade,
    activitySelection: this.activitySelection,
    pendingActivitySignal: this.pendingActivitySignal,
    pendingActivityOriginal: this.pendingActivityOriginal,
    baseHandlers: this.baseHandlers,
    operationsHandlers: this.operationsHandlers,
    copyHandlers: this.copyHandlers,
    activityHandlers: this.activityHandlers,
    findActivityType: (id) => this.findActivityType(id),
    activityForm: this.activityForm,
    selectedActivities: this.selectionState.selectedActivities,
    activityMoveTargetSignal: this.activityMoveTargetSignal,
  });

  protected readonly pendingServiceResource = computed(() => this.pendingServiceResourceSignal());
  protected readonly serviceAssignmentTarget = computed(() => this.serviceAssignmentTargetSignal());
  protected readonly assignmentCandidates = this.assignmentFacade.assignmentCandidates;

  protected readonly selectionSize = this.selectionState.selectionSize;

  protected readonly hasSelection = this.selectionState.hasSelection;

  protected readonly selectedResourceIds = computed(() =>
    this.boardFacade.normalizeResourceIds(
      Array.from(this.stageStore.stageState(this.activeStageSignal())().selectedResourceIds),
      this.activeStageSignal(),
    ),
  );

  protected readonly pendingActivity = computed<Activity | null>(() =>
    this.pendingFacade.pendingActivityForStage(this.activeStageSignal()),
  );
  protected readonly activityDetailsOpen = computed(() => this.activityDetailsOpenSignal());

  protected readonly isSelectedActivityPending = computed(() => {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return false;
    }
    return this.pendingFacade.isPendingSelection(selection.activity.id);
  });

  protected readonly selectedBoardIndex = computed(() => {
    const stage = this.activeStageSignal();
    const state = this.stageStore.stageState(stage)();
    return Math.max(0, state.boards.findIndex((board) => board.id === state.activeBoardId));
  });

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

  protected setActivityTypePickerGroup(groupId: ActivityTypePickerGroup['id']): void { this.uiFacade.setActivityTypePickerGroup(groupId); }

  protected isActivityOptionSelected(optionId: string): boolean { return this.uiFacade.isActivityOptionSelected(optionId); }

  protected selectCatalogActivity(optionId: string): void {
    this.recordRecentActivityType(optionId);
    this.uiFacade.selectCatalogActivity(optionId);
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
    const variant = this.planningVariant();
    const queryParams: Record<string, string> = {};
    if (templateId) {
      queryParams['template'] = templateId;
    }
    if (variant?.id) {
      queryParams['variantId'] = variant.id;
    }
    if (variant?.timetableYearLabel) {
      queryParams['timetableYearLabel'] = variant.timetableYearLabel;
    }
    const urlTree = this.router.createUrlTree(['/planning/periods'], {
      queryParams: Object.keys(queryParams).length ? queryParams : undefined,
    });
    const url = this.router.serializeUrl(urlTree);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  protected setActivityTypeSearchQuery(query: string): void {
    this.activityTypeSearchQuerySignal.set((query ?? '').toString());
  }

  protected onActivityTypeMenuOpened(): void {
    setTimeout(() => {
      const input = this.typeSearchInput?.nativeElement;
      input?.focus();
      input?.select();
    }, 0);
  }

  protected isActivityTypeFavorite(optionId: string): boolean {
    return this.favoriteActivityTypeOptionIdsSignal().includes(optionId);
  }

  protected toggleActivityTypeFavorite(optionId: string): void {
    const trimmed = (optionId ?? '').trim();
    if (!trimmed) {
      return;
    }
    const current = this.favoriteActivityTypeOptionIdsSignal();
    const next = current.includes(trimmed)
      ? current.filter((id) => id !== trimmed)
      : [trimmed, ...current];
    this.favoriteActivityTypeOptionIdsSignal.set(next.slice(0, 32));
    this.persistActivityTypePickerState();
  }

  protected activityTypeOptionColor(option: ActivityCatalogOption | null | undefined): string | null {
    if (!option) {
      return null;
    }
    const keys = ['color', 'bar_color', 'display_color', 'main_color'];
    for (const key of keys) {
      const raw = option.attributes.find((attr) => attr.key === key)?.meta?.['value'];
      if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
      }
    }
    return defaultColorForType(option.activityTypeId, option.typeDefinition.category);
  }

  protected selectedServicePreview(): { label: string; serviceId: string; date: string } | null {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return null;
    }
    const resource = selection.resource;
    if (resource.kind !== 'personnel-service' && resource.kind !== 'vehicle-service') {
      return null;
    }
    const rawStart = this.activityForm.controls['start'].value as string | null | undefined;
    const startDate = typeof rawStart === 'string' ? fromLocalDateTime(rawStart) : null;
    const date = startDate ? toIsoDate(startDate) : toIsoDate(new Date(selection.activity.start));
    const stage = this.activeStageSignal();
    const serviceId = `svc:${stage}:${resource.id}:${date}`;
    return {
      label: `${resource.name} · ${date}`,
      serviceId,
      date,
    };
  }

  protected selectedActivityConflicts(): ConflictEntry[] {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return [];
    }
    return mapConflictCodes(selection.activity.attributes);
  }

  private mapActivityTypeOptionIds(ids: string[], limit: number): ActivityCatalogOption[] {
    const map = this.activityCatalogOptionMap();
    const result: ActivityCatalogOption[] = [];
    for (const id of ids) {
      const option = map.get(id);
      if (!option) {
        continue;
      }
      result.push(option);
      if (result.length >= limit) {
        break;
      }
    }
    return result;
  }

  private recordRecentActivityType(optionId: string): void {
    const trimmed = (optionId ?? '').trim();
    if (!trimmed) {
      return;
    }
    const current = this.recentActivityTypeOptionIdsSignal();
    const next = [trimmed, ...current.filter((id) => id !== trimmed)].slice(0, 32);
    this.recentActivityTypeOptionIdsSignal.set(next);
    this.persistActivityTypePickerState();
  }

  private loadActivityTypePickerState(): { favorites: string[]; recents: string[] } {
    if (typeof window === 'undefined') {
      return { favorites: [], recents: [] };
    }
    try {
      const raw = window.localStorage.getItem('coreplanx:planning:type-picker:v1');
      if (!raw) {
        return { favorites: [], recents: [] };
      }
      const parsed = JSON.parse(raw) as any;
      const favorites = Array.isArray(parsed?.favorites) ? parsed.favorites.map(String) : [];
      const recents = Array.isArray(parsed?.recents) ? parsed.recents.map(String) : [];
      return { favorites, recents };
    } catch {
      return { favorites: [], recents: [] };
    }
  }

  private persistActivityTypePickerState(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        'coreplanx:planning:type-picker:v1',
        JSON.stringify({
          favorites: this.favoriteActivityTypeOptionIdsSignal(),
          recents: this.recentActivityTypeOptionIdsSignal(),
        }),
      );
    } catch {
      // ignore storage issues
    }
  }

  protected setActivityEditorMode(mode: 'basic' | 'advanced'): void {
    this.activityDetailsOpenSignal.set(mode === 'advanced');
  }

  protected markTimeSyncSource(source: 'end' | 'duration'): void {
    this.timeSyncSourceSignal.set(source);
  }

  protected canPublishBasePlanning(): boolean {
    if (this.publishInProgress()) {
      return false;
    }
    if (this.activeStageSignal() !== 'base') {
      return false;
    }
    const variant = this.planningVariant();
    if (!variant || variant.type !== 'simulation') {
      return false;
    }
    return !!this.selectedTemplateId();
  }

  protected publishBasePlanningToProductive(): void {
    if (!this.canPublishBasePlanning()) {
      return;
    }
    const variant = this.planningVariant();
    if (!variant) {
      return;
    }
    const timetableYearLabel = variant.timetableYearLabel?.trim();
    if (!timetableYearLabel) {
      console.warn('[PlanningDashboard] Missing timetableYearLabel for publish.');
      return;
    }
    const templateId = this.selectedTemplateId();
    if (!templateId) {
      return;
    }
    const targetVariantId = `PROD-${timetableYearLabel}`;
    const confirm: ConfirmDialogData = {
      title: 'Basisplanung veröffentlichen',
      message:
        `Diese Basisplanung aus "${variant.label}" als neue produktive Basis für ${timetableYearLabel} übernehmen?\n` +
        'Die bisherige produktive Basis wird archiviert.',
      confirmLabel: 'Veröffentlichen',
      cancelLabel: 'Abbrechen',
    };
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: confirm,
      width: '520px',
    });
    dialogRef.afterClosed().subscribe((accepted) => {
      if (!accepted) {
        return;
      }
      this.publishInProgress.set(true);
      this.timelineApi
        .publishTemplateSet(
          templateId,
          targetVariantId,
          {
            variantId: variant.id,
            timetableYearLabel,
          },
        )
        .pipe(
          take(1),
          tap(() => {
            this.onSimulationSelect(targetVariantId);
            this.templateStore.loadTemplates(true);
          }),
          catchError((error) => {
            console.error('[PlanningDashboard] Failed to publish base planning', error);
            if (typeof window !== 'undefined') {
              window.alert('Veröffentlichen fehlgeschlagen. Details siehe Konsole.');
            }
            return EMPTY;
          }),
          finalize(() => this.publishInProgress.set(false)),
        )
        .subscribe();
    });
  }

  protected canSnapshotOperationsFromBase(): boolean {
    if (this.snapshotInProgress()) {
      return false;
    }
    if (this.activeStageSignal() !== 'operations') {
      return false;
    }
    const variant = this.planningVariant();
    if (!variant || variant.type !== 'productive') {
      return false;
    }
    return !!this.selectedTemplateId();
  }

  protected snapshotOperationsFromBase(): void {
    if (!this.canSnapshotOperationsFromBase()) {
      return;
    }
    const variant = this.planningVariant();
    if (!variant) {
      return;
    }
    const timetableYearLabel = variant.timetableYearLabel?.trim();
    if (!timetableYearLabel) {
      console.warn('[PlanningDashboard] Missing timetableYearLabel for snapshot.');
      return;
    }
    const templateId = this.selectedTemplateId();
    if (!templateId) {
      return;
    }
    const hasExisting = this.stageActivitySignals.operations().length > 0;
    const confirm: ConfirmDialogData = hasExisting
      ? {
          title: 'Snapshot überschreiben',
          message:
            'Im Betrieb existieren bereits Aktivitäten.\n' +
            `Soll die Basisplanung aus "${variant.label}" als Snapshot neu übernommen und die bestehende Betriebsplanung überschrieben werden?`,
          confirmLabel: 'Überschreiben',
          cancelLabel: 'Abbrechen',
        }
      : {
          title: 'Snapshot erstellen',
          message: `Basisplanung aus "${variant.label}" als Snapshot in den Betrieb übernehmen?`,
          confirmLabel: 'Übernehmen',
          cancelLabel: 'Abbrechen',
        };
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: confirm,
      width: '520px',
    });
    dialogRef.afterClosed().subscribe((accepted) => {
      if (!accepted) {
        return;
      }
      this.snapshotInProgress.set(true);
      this.activityApi
        .snapshotOperationsFromBase(
          { templateId, replaceExisting: hasExisting },
          { variantId: variant.id, timetableYearLabel },
        )
        .pipe(
          take(1),
          tap(() => this.data.refreshStage('operations')),
          catchError((error) => {
            console.error('[PlanningDashboard] Failed to create operations snapshot', error);
            if (typeof window !== 'undefined') {
              window.alert('Snapshot fehlgeschlagen. Details siehe Konsole.');
            }
            return EMPTY;
          }),
          finalize(() => this.snapshotInProgress.set(false)),
        )
        .subscribe();
    });
  }

  protected onStageChange(stage: PlanningStageId | null | undefined): void {
    if (!stage || !(stage in this.stageMetaMap)) {
      return;
    }
    const nextStage = stage as PlanningStageId;
    this.routingFacade.setActiveStage(nextStage, true);
  }

  protected onSelectionToggle(resourceId: string, selected: boolean): void { this.selectionFacade.onSelectionToggle(resourceId, selected); }

  protected isResourceSelected(resourceId: string): boolean { return this.selectionFacade.isResourceSelected(resourceId); }

  protected clearSelection(): void { this.selectionFacade.clearSelection(); }

  protected selectAllResources(): void { this.selectionFacade.selectAllResources(); }

  protected setActivityCreationTool(tool: string): void { this.uiFacade.setActivityCreationTool(tool); }

  protected resetPendingActivityEdits(): void { this.activityHandlers.resetPendingActivityEdits(); }

  protected adjustFormEndBy(deltaMinutes: number): void { this.formFacade.adjustFormEndBy(deltaMinutes); }

  protected shiftFormBy(deltaMinutes: number): void { this.formFacade.shiftFormBy(deltaMinutes); }

  protected handleResourceViewModeChange(event: { resourceId: string; mode: 'block' | 'detail' }): void { this.selectionFacade.handleResourceViewModeChange(event); }

  protected handleActivityCreate(event: { resource: Resource; start: Date }): void { this.activityHandlers.handleActivityCreate(event); }

  protected handleActivityEdit(event: { resource: Resource; activity: Activity }): void { this.activityHandlers.handleActivityEdit(event); }

  protected handleActivitySelectionToggle(event: {
    resource: Resource;
    activity: Activity;
    selectionMode: 'set' | 'toggle';
  }): void {
    const current = this.activitySelection.selectedActivityState();
    if (!current || event.selectionMode === 'toggle' || current.activity.id === event.activity.id) {
      this.selectionHandlers.toggleSelection(event);
      return;
    }
    if (!this.hasUnsavedActivityEdits(current.activity.id)) {
      this.selectionHandlers.toggleSelection(event);
      return;
    }
    this.confirmDiscardActivityEdits(() => {
      this.selectionHandlers.clearSelectedActivity();
      this.selectionHandlers.toggleSelection(event);
    });
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
    this.selectionHandlers.handleReposition(event);
  }

  protected handleActivityCopy(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
  }): void {
    this.selectionHandlers.handleCopy(event);
  }

  protected clearActivitySelection(): void { this.selectionHandlers.clearActivitySelection(); }

  protected clearSelectedActivity(): void {
    this.confirmDiscardActivityEdits(() => this.selectionHandlers.clearSelectedActivity());
  }

  protected saveSelectedActivityEdits(): void { this.selectionHandlers.saveSelectedActivityEdits(); }

  protected deleteSelectedActivity(): void { this.selectionHandlers.deleteSelectedActivity(); }

  protected duplicateSelectedActivity(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.pendingFacade.isPendingSelection(selection.activity.id)) {
      return;
    }
    const source = selection.activity;
    const stage = this.activeStageSignal();
    const resource = selection.resource;
    const sourceStart = new Date(source.start);
    const sourceEnd = source.end ? new Date(source.end) : null;
    const durationMs =
      sourceEnd && sourceEnd.getTime() > sourceStart.getTime()
        ? sourceEnd.getTime() - sourceStart.getTime()
        : Math.max(
            1,
            (this.selectedCatalogOption()?.defaultDurationMinutes ??
              this.selectedActivityDefinition()?.defaultDurationMinutes ??
              30),
          ) * 60_000;
    const nextStart = (sourceEnd ?? sourceStart);
    const nextEnd = durationMs > 0 ? new Date(nextStart.getTime() + durationMs) : null;

    const duplicated: Activity = {
      ...source,
      id: this.activityOpsFacade.generateActivityId('dup'),
      clientId: null,
      start: nextStart.toISOString(),
      end: nextEnd ? nextEnd.toISOString() : null,
      rowVersion: null,
      createdAt: null,
      createdBy: null,
      updatedAt: null,
      updatedBy: null,
      serviceRole: null,
    };
    this.pendingFacade.startPendingActivity(stage, resource, this.applyActivityTypeConstraints(duplicated));
  }

  protected saveSelectedActivityToTemplate(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.pendingFacade.isPendingSelection(selection.activity.id)) {
      return;
    }
    this.saveTemplateActivity(selection.activity);
  }

  @HostListener('document:keydown', ['$event'])
  protected handleGlobalKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      const selection = this.activitySelection.selectedActivityState();
      if (!selection) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.typeMenuTrigger?.openMenu();
      return;
    }
    if (event.key === 'Escape') {
      const trigger = this.typeMenuTrigger;
      if (trigger?.menuOpen) {
        event.preventDefault();
        event.stopPropagation();
        trigger.closeMenu();
        return;
      }
      const selection = this.activitySelection.selectedActivityState();
      if (!selection) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.clearSelectedActivity();
    }
  }

  private hasUnsavedActivityEdits(activityId: string | null | undefined): boolean {
    if (!activityId) {
      return false;
    }
    if (this.pendingFacade.isPendingSelection(activityId)) {
      return true;
    }
    return this.activityForm.dirty;
  }

  private confirmDiscardActivityEdits(onConfirm: () => void): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      onConfirm();
      return;
    }
    const isPending = this.pendingFacade.isPendingSelection(selection.activity.id);
    const isDirty = this.activityForm.dirty;
    if (!isPending && !isDirty) {
      onConfirm();
      return;
    }
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '520px',
      data: {
        title: isPending ? 'Entwurf verwerfen?' : 'Änderungen verwerfen?',
        message: isPending
          ? 'Diese Aktivität ist noch nicht gespeichert. Entwurf wirklich verwerfen?'
          : 'Ungespeicherte Änderungen gehen verloren. Fortfahren?',
        confirmLabel: 'Verwerfen',
        cancelLabel: 'Abbrechen',
      } satisfies ConfirmDialogData,
    });
    dialogRef.afterClosed().subscribe((accepted) => {
      if (accepted) {
        onConfirm();
      }
    });
  }

  protected handleServiceAssignRequest(resource: Resource): void { this.assignmentFacade.handleServiceAssignRequest(resource); }

  protected setServiceAssignmentTarget(resourceId: string | null): void { this.assignmentFacade.setServiceAssignmentTarget(resourceId); }

  protected confirmServiceAssignment(): void { this.assignmentFacade.confirmServiceAssignment(); }

  protected cancelServiceAssignment(): void { this.assignmentFacade.cancelServiceAssignment(); }

  protected setMoveSelectionTarget(resourceId: string | null): void { this.selectionHandlers.setMoveSelectionTarget(resourceId); }

  protected moveSelectionToTarget(): void { this.selectionHandlers.moveSelectionToTarget(); }

  protected shiftSelectedActivityBy(deltaMinutes: number): void { this.selectionHandlers.shiftSelectedActivityBy(deltaMinutes); }

  protected snapSelectedActivityToPrevious(): void {
    this.selectionHandlers.snapSelectedActivity(
      'previous',
      (activity) =>
        findNeighborActivities(
          activity,
          this.normalizedStageActivitySignals[this.activeStageSignal()](),
          this.activityOwnerId(activity),
        ),
    );
  }

  protected snapSelectedActivityToNext(): void {
    this.selectionHandlers.snapSelectedActivity(
      'next',
      (activity) =>
        findNeighborActivities(
          activity,
          this.normalizedStageActivitySignals[this.activeStageSignal()](),
          this.activityOwnerId(activity),
        ),
    );
  }

  protected fillGapForSelectedActivity(): void {
    this.selectionHandlers.fillGapForSelectedActivity(
      (activity) =>
        findNeighborActivities(
          activity,
          this.normalizedStageActivitySignals[this.activeStageSignal()](),
          this.activityOwnerId(activity),
        ),
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

  protected fromLocationSuggestion(): string | null {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return null;
    }
    const { previous } = findNeighborActivities(
      selection.activity,
      this.normalizedStageActivitySignals[this.activeStageSignal()](),
      this.activityOwnerId(selection.activity),
    );
    const suggestion = (previous?.to ?? previous?.from ?? '').toString().trim();
    if (!suggestion) {
      return null;
    }
    const current = (this.activityForm.controls['from'].value ?? '').toString().trim();
    return suggestion !== current ? suggestion : null;
  }

  protected applyFromLocationSuggestion(): void {
    const suggestion = this.fromLocationSuggestion();
    if (!suggestion) {
      return;
    }
    this.activityForm.controls['from'].setValue(suggestion);
    this.activityForm.controls['from'].markAsDirty();
  }

  protected toLocationSuggestion(): string | null {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return null;
    }
    const { next } = findNeighborActivities(
      selection.activity,
      this.normalizedStageActivitySignals[this.activeStageSignal()](),
      this.activityOwnerId(selection.activity),
    );
    const suggestion = (next?.from ?? next?.to ?? '').toString().trim();
    if (!suggestion) {
      return null;
    }
    const current = (this.activityForm.controls['to'].value ?? '').toString().trim();
    return suggestion !== current ? suggestion : null;
  }

  protected applyToLocationSuggestion(): void {
    const suggestion = this.toLocationSuggestion();
    if (!suggestion) {
      return;
    }
    this.activityForm.controls['to'].setValue(suggestion);
    this.activityForm.controls['to'].markAsDirty();
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

  private selectedActivityParticipantIds(): string[] {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return [];
    }
    return getActivityParticipantIds(selection.activity);
  }

  private findActivityType(id: string | null | undefined): ActivityTypeDefinition | null {
    return findActivityTypeById(this.activityTypeDefinitions, id);
  }

  protected definitionHasField(
    definition: ActivityTypeDefinition | null,
    field: ActivityFieldKey,
  ): boolean {
    return definitionHasField(definition, field);
  }

  protected shouldShowEndField(definition: ActivityTypeDefinition | null): boolean {
    return shouldShowEndField(definition);
  }

  private normalizeActivityList(list: Activity[]): Activity[] {
    return normalizeActivityList(list, {
      typeMap: () => this.activityTypeMap(),
      catalogMap: () => this.activityCatalogOptionMap(),
    });
  }

  private applyActivityTypeConstraints(activity: Activity): Activity {
    return applyActivityTypeConstraintsUtil(activity, () => this.activityTypeMap());
  }

  private filterLocationOptions(
    query: string,
    options: LocationAutocompleteOption[],
    limit: number,
  ): LocationAutocompleteOption[] {
    if (!options.length) {
      return [];
    }
    const tokens = (query ?? '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) {
      return options.slice(0, limit);
    }
    const result: LocationAutocompleteOption[] = [];
    for (const option of options) {
      if (tokens.every((token) => option.search.includes(token))) {
        result.push(option);
      }
      if (result.length >= limit) {
        break;
      }
    }
    return result;
  }

  private activityOwnerId(activity: Activity): string | null {
    return getActivityOwnerId(activity);
  }

  protected createBoardFromSelection(): void {
    this.boardActionsFacade.createBoardFromSelection();
  }

  protected addSelectionToBoard(boardId: string): void {
    if (!this.hasSelection()) {
      return;
    }
    this.boardActionsFacade.addSelectionToBoard(boardId);
  }

  protected replaceBoardWithSelection(boardId: string): void {
    if (!this.hasSelection()) {
      return;
    }
    this.boardActionsFacade.replaceBoardWithSelection(boardId);
  }

  protected setSelectionFromBoard(boardId: string): void {
    this.boardActionsFacade.setSelectionFromBoard(boardId);
  }

  protected removeBoard(boardId: string): void {
    this.boardActionsFacade.removeBoard(boardId);
  }

  protected removeResourceFromBoard(boardId: string, resourceId: string): void {
    this.boardActionsFacade.removeResourceFromBoard(boardId, resourceId);
  }

  protected handleBoardIndexChange(index: number): void {
    this.boardActionsFacade.handleBoardIndexChange(index);
  }

  protected boardResources(board: PlanningBoard): Resource[] {
    const stage = this.activeStageSignal();
    const stageResources = this.stageResourceSignals[stage]();
    const key = `${stage}:${board.id}`;
    const cached = this.boardResourcesCache.get(key);
    if (
      cached &&
      cached.resourceIdsRef === board.resourceIds &&
      cached.stageResourcesRef === stageResources
    ) {
      return cached.result;
    }
    const result = this.boardActionsFacade.boardResources(board);
    this.boardResourcesCache.set(key, {
      resourceIdsRef: board.resourceIds,
      stageResourcesRef: stageResources,
      result,
    });
    return result;
  }

  protected boardActivities(board: PlanningBoard): Activity[] {
    const stage = this.activeStageSignal();
    const stageActivities = this.normalizedStageActivitySignals[stage]();
    const key = `${stage}:${board.id}`;
    const cached = this.boardActivitiesCache.get(key);
    if (
      cached &&
      cached.resourceIdsRef === board.resourceIds &&
      cached.stageActivitiesRef === stageActivities
    ) {
      return cached.result;
    }
    const result = this.boardActionsFacade.boardActivities(board);
    this.boardActivitiesCache.set(key, {
      resourceIdsRef: board.resourceIds,
      stageActivitiesRef: stageActivities,
      result,
    });
    return result;
  }

  protected boardPendingActivity(board: PlanningBoard): Activity | null {
    return this.boardActionsFacade.boardPendingActivity(board);
  }

  protected isActiveBoard(boardId: string): boolean {
    const stage = this.activeStageSignal();
    return this.boardFacade.isActiveBoard(stage, boardId);
  }

  protected isTimetableYearSelected(label: string): boolean {
    return this.filterHandlers.isTimetableYearSelected(label);
  }

  protected onTimetableYearToggle(label: string, checked: boolean): void {
    this.filterHandlers.onTimetableYearToggle(label, checked);
  }

  protected selectDefaultTimetableYear(): void {
    this.filterHandlers.selectDefaultTimetableYear();
  }

  protected selectAllTimetableYears(): void {
    this.filterHandlers.selectAllTimetableYears();
  }

  protected onSimulationSelect(simulationId: string): void {
    this.filterHandlers.onSimulationSelect(simulationId);
  }

  private selectedYearBounds(stage: PlanningStageId): TimetableYearBounds[] {
    return this.yearFacade.selectedYearBounds(stage);
  }

  private saveTemplateActivity(activity: Activity): void {
    const templateId = this.templateStore.selectedTemplate()?.id;
    if (!templateId) {
      return;
    }
    this.data.upsertTemplateActivity(templateId, activity);
  }
}
