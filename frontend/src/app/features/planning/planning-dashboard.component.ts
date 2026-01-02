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
import { Activity, ActivityGroupRole, ServiceRole } from '../../models/activity';
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
import { ActivityCatalogService } from '../../core/services/activity-catalog.service';
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
import { ActivityGroupDialogComponent, ActivityGroupDialogData, ActivityGroupDialogResult } from './activity-group-dialog.component';
import { TemplateTimelineStoreService } from './template-timeline-store.service';
import { TimelineApiService } from '../../core/api/timeline-api.service';
import { ActivityApiService } from '../../core/api/activity-api.service';
import { PlanningOptimizerApiService } from '../../core/api/planning-optimizer-api.service';
import type { PlanningApiContext } from '../../core/api/planning-api-context';
import type {
  AutopilotPreviewResponseDto,
  PlanningCandidateBuildResponseDto,
  RulesetSelectionRequestDto,
  PlanningSolverResponseDto,
} from '../../core/api/planning-optimizer-api.types';
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
import { EMPTY, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, startWith, switchMap, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanningDashboardAssignmentFacade } from './planning-dashboard-assignment.facade';
import { PlanningDashboardActivityOpsFacade } from './planning-dashboard-activity-ops.facade';
import { PlanningDashboardSelectionState } from './planning-dashboard-selection.state';
import { PlanningDashboardFilterHandlers } from './planning-dashboard-filter.handlers';
import { PlanningDashboardCopyHandlers } from './planning-dashboard-copy.handlers';
import { applyActivityTypeConstraints as applyActivityTypeConstraintsUtil, normalizeActivityList } from './planning-dashboard-activity-normalize.utils';
import { readActivityGroupMeta } from './planning-activity-group.utils';
import { normalizeStageId, updateStageQueryParam } from './planning-dashboard-stage.utils';
import { fromLocalDateTime, toIsoDate, toLocalDateTime } from './planning-dashboard-time.utils';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { findActivityTypeById, definitionHasField, shouldShowEndField } from './planning-dashboard-activity.helpers';
import { STAGE_RESOURCE_GROUPS, TYPE_PICKER_META, type ActivityEditPreviewState, type PendingActivityState } from './planning-dashboard.constants';
import {
  applyLocationDefaults as applyLocationDefaultsUtil,
  type ActivityLocationDefinition,
  isLocationFieldHidden as isLocationFieldHiddenUtil,
} from './planning-dashboard-location-defaults.utils';
import { ConflictEntry, mapConflictCodesForOwner } from '../../shared/planning-conflicts';
import { PlanningOptimizerDialogComponent } from './planning-optimizer-dialog.component';

type LocationAutocompleteOption = {
  key: string;
  value: string;
  label: string;
  description?: string;
  search: string;
};

type SolverPreviewSource = 'auto' | 'manual';

type SolverPreviewState = {
  source: SolverPreviewSource;
  payload: PlanningSolverResponseDto;
  createdAt: Date;
  activityIds: string[];
  window?: { start: Date; end: Date } | null;
};

type AutoSolverStatusState = 'idle' | 'running' | 'ready' | 'error';

type AutoSolverStatus = {
  state: AutoSolverStatusState;
  message?: string | null;
  updatedAt?: Date | null;
};

type AutoSolverRequest = {
  stage: PlanningStageId;
  activityIds: string[];
  windowStart: Date;
  windowEnd: Date;
};

const AUTO_SOLVER_WINDOW_MS = 14 * 60 * 60 * 1000;
const AUTO_SOLVER_STORAGE_KEY = 'coreplanx:planning:auto-solver:v1';

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
  private readonly optimizerApi = inject(PlanningOptimizerApiService);
  private readonly templateMetaLoad = signal(false);
  private readonly simulationService = inject(SimulationService);
  private readonly publishInProgress = signal(false);
  private readonly snapshotInProgress = signal(false);
  private readonly optimizerLoadingSignal = signal({ preview: false, candidates: false, solve: false });
  private readonly planningStore = inject(PlanningStoreService);
  private readonly autoSolverEnabledSignal = signal(this.readAutoSolverEnabled());
  private readonly autoSolverStatusSignal = signal<Record<PlanningStageId, AutoSolverStatus>>({
    base: { state: 'idle', message: null, updatedAt: null },
    operations: { state: 'idle', message: null, updatedAt: null },
  });
  private readonly solverPreviewSignal = signal<Record<PlanningStageId, SolverPreviewState | null>>({
    base: null,
    operations: null,
  });
  private readonly autoSolverRequest$ = new Subject<AutoSolverRequest>();
  private readonly solverTimestampFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

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

  private readonly stageSyncingActivityIdsSignals: Record<PlanningStageId, Signal<ReadonlySet<string>>> = {
    base: this.data.syncingActivityIds('base'),
    operations: this.data.syncingActivityIds('operations'),
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
  protected readonly optimizerLoading = computed(() => this.optimizerLoadingSignal());
  protected readonly autoSolverEnabled = computed(() => this.autoSolverEnabledSignal());
  protected readonly autoSolverStatus = computed(
    () => this.autoSolverStatusSignal()[this.activeStageSignal()],
  );
  protected readonly solverPreviewState = computed(
    () => this.solverPreviewSignal()[this.activeStageSignal()],
  );
  protected readonly solverPreviewActivities = computed(() =>
    this.buildPreviewActivities(this.solverPreviewState()?.payload ?? null),
  );
  protected readonly autoSolverStatusLabel = computed(() => {
    if (!this.autoSolverEnabledSignal()) {
      return 'Deaktiviert';
    }
    const status = this.autoSolverStatus();
    if (status.state === 'running') {
      return 'Auto-Solver laeuft...';
    }
    if (status.state === 'ready') {
      return 'Preview bereit';
    }
    if (status.state === 'error') {
      return status.message?.trim().length ? status.message : 'Solver fehlgeschlagen';
    }
    return 'Bereit';
  });
  protected readonly autoSolverStatusIcon = computed(() => {
    if (!this.autoSolverEnabledSignal()) {
      return 'toggle_off';
    }
    const status = this.autoSolverStatus();
    switch (status.state) {
      case 'running':
        return 'hourglass_top';
      case 'ready':
        return 'check_circle';
      case 'error':
        return 'error';
      default:
        return 'radio_button_unchecked';
    }
  });
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
      .filter((site) => site.siteId?.trim().length)
      .map((site) => {
        const siteId = site.siteId?.trim() ?? '';
        const uniqueId = site.uniqueOpId?.trim() ?? '';
        const opName = uniqueId ? (opMap.get(uniqueId)?.name ?? '').trim() : '';
        const siteName = (site.name ?? '').trim();
        const siteType = (site.siteType ?? '').trim();
        const descriptionParts = [
          siteType,
          opName ? opName : null,
          uniqueId ? `(${uniqueId})` : null,
          siteId && siteId !== uniqueId ? `ID: ${siteId}` : null,
        ].filter(Boolean) as string[];
        return {
          key: `site:${site.siteId}`,
          value: siteId,
          label: siteName || siteId,
          description: descriptionParts.join(' · '),
          search: `${siteName} ${siteType} ${siteId} ${uniqueId} ${opName}`.toLowerCase(),
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
    applyLocationDefaults: (activity, activities) =>
      applyLocationDefaultsUtil({
        activity,
        definition: this.buildLocationDefinitionForActivity(activity),
        activities,
        ownerId: this.activityOwnerId(activity),
      }),
    activitySelection: this.activitySelection,
    activityOwnerId: (activity) => this.activityOwnerId(activity),
    ensureRequiredParticipants: (stage, anchorResource, activity) =>
      this.activityHandlers.ensureRequiredParticipantsForActivity(stage, anchorResource, activity),
    onActivityMutated: (activity, stage) => this.handleSolverActivityMutation(activity, stage),
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
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
    applyBaseCopyWithRoles: (source, sourceResource, targetResource, roles) =>
      this.baseHandlers.applyCopyWithRoles(source, sourceResource, targetResource, roles),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    onActivityMutated: (activity, stage) => this.handleSolverActivityMutation(activity, stage),
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

    this.data.setAutopilotSuppressed(this.autoSolverEnabledSignal());

    this.autoSolverRequest$
      .pipe(
        debounceTime(240),
        tap((request) => {
          this.clearSolverPreview(request.stage, 'auto');
          this.setAutoSolverStatus(request.stage, {
            state: 'running',
            message: 'Solver wird ausgefuehrt...',
            updatedAt: new Date(),
          });
        }),
        switchMap((request) => {
          if (!this.autoSolverEnabledSignal()) {
            return EMPTY;
          }
          const payload = this.buildOptimizerPayload(request.stage, {
            activityIds: request.activityIds,
            timelineRange: { start: request.windowStart, end: request.windowEnd },
          });
          if (!payload) {
            this.setAutoSolverStatus(request.stage, {
              state: 'error',
              message: 'Keine Leistungen im Zeitfenster gefunden.',
              updatedAt: new Date(),
            });
            return EMPTY;
          }
          return this.optimizerApi.solve(request.stage, payload, this.buildOptimizerContext()).pipe(
            take(1),
            tap((response) => {
              this.setSolverPreview(request.stage, response, 'auto', request.activityIds, {
                start: request.windowStart,
                end: request.windowEnd,
              });
              this.setAutoSolverStatus(request.stage, { state: 'ready', message: null, updatedAt: new Date() });
            }),
            catchError((error) => {
              this.handleOptimizerError('Auto-Solver', error);
              this.setAutoSolverStatus(request.stage, {
                state: 'error',
                message: 'Solver fehlgeschlagen.',
                updatedAt: new Date(),
              });
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected readonly activeStageId = computed(() => this.activeStageSignal());

  protected readonly activeSyncingActivityIds = computed(
    () => this.stageSyncingActivityIdsSignals[this.activeStageSignal()](),
  );

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
    applyLocationDefaults: (activity, activities) =>
      applyLocationDefaultsUtil({
        activity,
        definition: this.buildLocationDefinitionForActivity(activity),
        activities,
        ownerId: this.activityOwnerId(activity),
      }),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
    activitySelection: this.activitySelection,
    templateId: () => this.templateStore.selectedTemplate()?.id ?? null,
    ensureRequiredParticipants: (stage, anchorResource, activity) =>
      this.activityHandlers.ensureRequiredParticipantsForActivity(stage, anchorResource, activity),
    onActivityMutated: (activity, stage) => this.handleSolverActivityMutation(activity, stage),
  });
  private readonly activityHandlers = new PlanningDashboardActivityHandlersFacade({
    activeStage: () => this.activeStageSignal(),
    activityFacade: this.activityFacade,
    activitySelection: this.activitySelection,
    dialog: this.dialog,
    stageResources: (stage) => this.stageResourceSignals[stage](),
    templateSelected: () => !!this.templateStore.selectedTemplate()?.id,
    selectedTemplateId: () => this.templateStore.selectedTemplate()?.id ?? null,
    activityCreationTool: () => this.activityCreationToolSignal(),
    catalogOptionById: (id) => this.activityCatalogOptionMap().get(id),
    resolveActivityTypeForResource: (resource, typeId) =>
      resolveActivityTypeForResource(resource, typeId, this.activityTypeDefinitions()),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    stageActivities: (stage) => this.normalizedStageActivitySignals[stage](),
    applyLocationDefaults: (activity, activities) =>
      applyLocationDefaultsUtil({
        activity,
        definition: this.buildLocationDefinitionForActivity(activity),
        activities,
        ownerId: this.activityOwnerId(activity),
      }),
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
    onActivityMutated: (activity, stage) => this.handleSolverActivityMutation(activity, stage),
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
  protected readonly activityError = this.data.activityError.bind(this.data);
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

  protected readonly selectedGroupSummary = computed(() => {
    const items = this.selectedActivities();
    if (!items.length) {
      return null;
    }
    const groupIds = new Set(
      items
        .map((item) => (item.activity.groupId ?? '').toString().trim())
        .filter((id) => id.length > 0),
    );
    if (groupIds.size !== 1) {
      return null;
    }
    const groupId = Array.from(groupIds)[0];
    const meta = readActivityGroupMeta(items[0].activity);
    return {
      groupId,
      label: meta?.label ?? 'Gruppe',
      role: (meta?.role ?? 'independent') as ActivityGroupRole,
      attachedToActivityId: meta?.attachedToActivityId ?? null,
    };
  });

  protected readonly selectionHasGroup = computed(() =>
    this.selectedActivities().some((item) => !!item.activity.groupId),
  );

  protected readonly canAddSelectionToFocusedGroup = computed(() => {
    const focus = this.activitySelection.selectedActivityState()?.activity ?? null;
    if (!focus?.groupId) {
      return false;
    }
    return this.selectedActivities().length > 0;
  });

  private readonly selectionActionsFacade = new PlanningDashboardSelectionActionsFacade({
    activitySelection: this.activitySelection,
    activityFacade: this.activityFacade,
    stageResourceSignals: this.stageResourceSignals,
    stageActivitySignals: this.normalizedStageActivitySignals,
    activeStage: () => this.activeStageSignal(),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    isPendingSelection: (id) => this.pendingFacade.isPendingSelection(id),
    commitPendingActivityUpdate: (activity) => this.pendingFacade.commitPendingActivityUpdate(activity),
    replaceActivity: (activity) => this.activityOpsFacade.replaceActivity(activity),
    findActivityType: (typeId) => this.findActivityType(typeId),
    activityMoveTargetSignal: this.activityMoveTargetSignal,
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
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
    const mappedServiceId = this.serviceIdForOwner(selection.activity, resource.id);
    const serviceId = mappedServiceId ?? (() => {
      const rawStart = this.activityForm.controls['start'].value as string | null | undefined;
      const startDate = typeof rawStart === 'string' ? fromLocalDateTime(rawStart) : null;
      const date = startDate ? toIsoDate(startDate) : toIsoDate(new Date(selection.activity.start));
      const stage = this.activeStageSignal();
      return `svc:${stage}:${resource.id}:${date}`;
    })();
    const date = this.parseDayKeyFromServiceId(serviceId) ?? toIsoDate(new Date(selection.activity.start));
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
    return mapConflictCodesForOwner(selection.activity.attributes ?? undefined, selection.resource.id);
  }

  private serviceIdForOwner(activity: Activity, ownerId: string): string | null {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const rawMap = attrs?.['service_by_owner'];
    if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
      return null;
    }
    const entry = (rawMap as Record<string, any>)[ownerId];
    const rawServiceId = entry?.serviceId;
    if (typeof rawServiceId === 'string' && rawServiceId.trim().length) {
      return rawServiceId.trim();
    }
    return null;
  }

  private parseDayKeyFromServiceId(serviceId: string): string | null {
    const trimmed = (serviceId ?? '').trim();
    if (!trimmed.startsWith('svc:')) {
      return null;
    }
    const parts = trimmed.split(':');
    const dayKey = parts[parts.length - 1] ?? '';
    return /^\\d{4}-\\d{2}-\\d{2}$/.test(dayKey) ? dayKey : null;
  }

  protected isSelectedServiceBoundary(): boolean {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return false;
    }
    const activity = selection.activity;
    const role = activity.serviceRole ?? null;
    const type = (activity.type ?? '').toString();
    return role === 'start' || role === 'end' || type === 'service-start' || type === 'service-end';
  }

  protected isSelectedServiceBoundaryManual(): boolean {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return false;
    }
    const attrs = selection.activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['manual_service_boundary'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      return raw.trim().toLowerCase() === 'true';
    }
    return false;
  }

  protected restoreAutomaticServiceBoundary(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    const attrs = { ...(selection.activity.attributes ?? {}) } as Record<string, unknown>;
    if (!('manual_service_boundary' in attrs)) {
      return;
    }
    delete attrs['manual_service_boundary'];
    this.activityOpsFacade.replaceActivity({ ...selection.activity, attributes: attrs });
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
    sourceResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    participantResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    this.selectionHandlers.handleCopy(event);
  }

  protected clearActivitySelection(): void { this.selectionHandlers.clearActivitySelection(); }

  protected createGroupFromSelection(): void {
    if (this.selectedActivities().length === 0) {
      return;
    }
    const focus = this.activitySelection.selectedActivityState();
    const focusActivity =
      focus && focus.activity?.id
        ? {
            id: focus.activity.id,
            label: `${this.activityTypeLabel(focus.activity.type)} · ${focus.resource.name}`,
          }
        : null;
    const dialogRef = this.dialog.open<
      ActivityGroupDialogComponent,
      ActivityGroupDialogData,
      ActivityGroupDialogResult | undefined
    >(ActivityGroupDialogComponent, {
      width: '520px',
      data: {
        title: 'Gruppe erstellen',
        initialLabel: 'Gruppe',
        initialRole: 'independent',
        initialAttachedToActivityId: null,
        focusActivity: focusActivity,
      },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.selectionHandlers.createGroupFromSelection({
        label: result.label,
        role: result.role,
        attachedToActivityId: result.attachedToActivityId ?? null,
      });
    });
  }

  protected editSelectedGroup(): void {
    const group = this.selectedGroupSummary();
    if (!group) {
      return;
    }
    const focus = this.activitySelection.selectedActivityState();
    const focusActivity =
      focus && focus.activity?.id
        ? {
            id: focus.activity.id,
            label: `${this.activityTypeLabel(focus.activity.type)} · ${focus.resource.name}`,
          }
        : null;
    const dialogRef = this.dialog.open<
      ActivityGroupDialogComponent,
      ActivityGroupDialogData,
      ActivityGroupDialogResult | undefined
    >(ActivityGroupDialogComponent, {
      width: '520px',
      data: {
        title: 'Gruppe bearbeiten',
        initialLabel: group.label,
        initialRole: group.role,
        initialAttachedToActivityId: group.attachedToActivityId,
        focusActivity: focusActivity,
      },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.selectionHandlers.updateGroupMeta(group.groupId, {
        label: result.label,
        role: result.role,
        attachedToActivityId: result.attachedToActivityId ?? null,
      });
    });
  }

  protected addSelectionToFocusedGroup(): void {
    this.selectionHandlers.addSelectionToFocusedGroup();
  }

  protected removeSelectionFromGroup(): void {
    this.selectionHandlers.removeSelectionFromGroup();
  }

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
    if (event.key === 'Delete') {
      const active = (document.activeElement ?? null) as HTMLElement | null;
      if (active && (active.isContentEditable || ['INPUT', 'TEXTAREA'].includes(active.tagName))) {
        return;
      }
      const selectedIds = this.activitySelection.selectedActivityIds();
      if (selectedIds.size === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (selectedIds.size === 1) {
        this.deleteSelectedActivity();
      } else {
        this.deleteActivitySelection();
      }
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

  protected shiftSelectionBy(deltaMinutes: number): void { this.selectionHandlers.shiftSelectionBy(deltaMinutes); }

  protected deleteActivitySelection(): void {
    const count = this.selectedActivities().length;
    if (count === 0) {
      return;
    }
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '520px',
      data: {
        title: 'Auswahl löschen?',
        message: `${count} Aktivität(en) werden gelöscht. Fortfahren?`,
        confirmLabel: 'Löschen',
        cancelLabel: 'Abbrechen',
      } satisfies ConfirmDialogData,
    });
    dialogRef.afterClosed().subscribe((accepted) => {
      if (accepted) {
        this.selectionHandlers.deleteSelection();
      }
    });
  }

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

  protected isLocationFieldHidden(definition: ActivityCatalogOption | null, field: 'from' | 'to'): boolean {
    return isLocationFieldHiddenUtil(this.buildLocationDefinitionForOption(definition), field);
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

  private buildOptimizerContext(): PlanningApiContext {
    const variant = this.planningVariant();
    return {
      variantId: variant?.id ?? 'default',
      timetableYearLabel: variant?.timetableYearLabel ?? null,
    };
  }

  private setOptimizerLoading(
    key: 'preview' | 'candidates' | 'solve',
    value: boolean,
  ): void {
    this.optimizerLoadingSignal.update((state) => ({ ...state, [key]: value }));
  }

  private handleOptimizerError(label: string, error: unknown): void {
    console.warn(`[PlanningDashboard] ${label} fehlgeschlagen`, error);
  }

  private openOptimizerDialog(
    mode: 'autopilot',
    payload: AutopilotPreviewResponseDto,
    title: string,
  ): void;
  private openOptimizerDialog(
    mode: 'candidates',
    payload: PlanningCandidateBuildResponseDto,
    title: string,
  ): void;
  private openOptimizerDialog(
    mode: 'solver',
    payload: PlanningSolverResponseDto,
    title: string,
  ): void;
  private openOptimizerDialog(
    mode: 'autopilot' | 'candidates' | 'solver',
    payload: AutopilotPreviewResponseDto | PlanningCandidateBuildResponseDto | PlanningSolverResponseDto,
    title: string,
  ): void {
    this.dialog.open(PlanningOptimizerDialogComponent, {
      data: { title, mode, payload },
      width: '720px',
    });
  }

  private resolveCatalogOptionForActivity(activity: Activity): ActivityCatalogOption | null {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const key =
      typeof attrs?.['activityKey'] === 'string'
        ? (attrs['activityKey'] as string)
        : (activity.type ?? '').trim();
    if (!key) {
      return null;
    }
    return this.activityCatalogOptionMap().get(key) ?? null;
  }

  private buildLocationDefinitionForActivity(activity: Activity): ActivityLocationDefinition | null {
    const option = this.resolveCatalogOptionForActivity(activity);
    const typeDefinition = option?.typeDefinition ?? this.findActivityType(activity.type ?? null);
    if (!typeDefinition) {
      return null;
    }
    return {
      type: typeDefinition,
      attributes: option?.attributes ?? null,
    };
  }

  private buildLocationDefinitionForOption(
    option: ActivityCatalogOption | null,
  ): ActivityLocationDefinition | null {
    if (!option?.typeDefinition) {
      return null;
    }
    return {
      type: option.typeDefinition,
      attributes: option.attributes ?? null,
    };
  }

  protected createBoardFromSelection(): void {
    this.boardActionsFacade.createBoardFromSelection();
  }

  protected openAutopilotPreview(): void {
    if (this.optimizerLoadingSignal().preview) {
      return;
    }
    const stage = this.activeStageSignal();
    this.setOptimizerLoading('preview', true);
    this.optimizerApi
      .previewAutopilot(stage, this.buildOptimizerContext())
      .pipe(
        take(1),
        finalize(() => this.setOptimizerLoading('preview', false)),
        catchError((error) => {
          this.handleOptimizerError('Autopilot-Preview', error);
          return EMPTY;
        }),
      )
      .subscribe((payload) => {
        this.openOptimizerDialog('autopilot', payload, 'Autopilot-Preview');
      });
  }

  protected openOptimizerCandidates(): void {
    if (this.optimizerLoadingSignal().candidates) {
      return;
    }
    const stage = this.activeStageSignal();
    const activityIds = this.selectedActivityIdsArray();
    if (!activityIds.length) {
      return;
    }
    const selection = this.buildOptimizerPayload(stage, { activityIds });
    if (!selection) {
      return;
    }
    this.setOptimizerLoading('candidates', true);
    this.optimizerApi
      .buildCandidates(stage, selection, this.buildOptimizerContext())
      .pipe(
        take(1),
        finalize(() => this.setOptimizerLoading('candidates', false)),
        catchError((error) => {
          this.handleOptimizerError('Solver-Kandidaten', error);
          return EMPTY;
        }),
      )
      .subscribe((payload) => {
        this.openOptimizerDialog('candidates', payload, 'Solver-Kandidaten');
      });
  }

  protected openOptimizerSolve(): void {
    if (this.optimizerLoadingSignal().solve) {
      return;
    }
    const stage = this.activeStageSignal();
    const activityIds = this.selectedActivityIdsArray();
    if (!activityIds.length) {
      return;
    }
    const selection = this.buildOptimizerPayload(stage, { activityIds });
    if (!selection) {
      return;
    }
    this.clearSolverPreview(stage, 'manual');
    this.setOptimizerLoading('solve', true);
    this.optimizerApi
      .solve(stage, selection, this.buildOptimizerContext())
      .pipe(
        take(1),
        finalize(() => this.setOptimizerLoading('solve', false)),
        catchError((error) => {
          this.handleOptimizerError('Solver-Preview', error);
          return EMPTY;
        }),
      )
      .subscribe((payload) => {
        this.setSolverPreview(stage, payload, 'manual', activityIds, null);
      });
  }

  private buildOptimizerPayload(
    stage: PlanningStageId,
    options?: { activityIds?: string[]; timelineRange?: { start: Date; end: Date } },
  ): RulesetSelectionRequestDto | undefined {
    const activityIds = (options?.activityIds ?? []).filter((entry) => !!entry);
    const selection: RulesetSelectionRequestDto | undefined = activityIds.length
      ? { activityIds }
      : undefined;
    if (stage !== 'base') {
      return selection;
    }
    const template = this.templateStore.selectedTemplateWithFallback();
    const range = options?.timelineRange ?? this.timelineRange();
    if (!template || !range?.start || !range?.end) {
      return selection;
    }
    return {
      ...selection,
      templateId: template.id,
      timelineRange: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
    };
  }

  protected applySolverPreview(): void {
    const preview = this.solverPreviewState();
    if (!preview) {
      return;
    }
    const stage = this.activeStageSignal();
    const payload = preview.payload;
    if (payload.upserts.length === 0 && payload.deletedIds.length === 0) {
      this.clearSolverPreview(stage);
      return;
    }
    this.data.applyActivityMutation(stage, payload.upserts ?? [], payload.deletedIds ?? []);
    this.clearSolverPreview(stage);
  }

  protected discardSolverPreview(): void {
    this.clearSolverPreview(this.activeStageSignal());
  }

  protected setAutoSolverEnabled(enabled: boolean): void {
    this.autoSolverEnabledSignal.set(enabled);
    this.persistAutoSolverEnabled(enabled);
    this.data.setAutopilotSuppressed(enabled);
    if (!enabled) {
      this.clearSolverPreview('base', 'auto');
      this.clearSolverPreview('operations', 'auto');
      this.setAutoSolverStatus('base', { state: 'idle', message: null, updatedAt: new Date() });
      this.setAutoSolverStatus('operations', { state: 'idle', message: null, updatedAt: new Date() });
    }
  }

  private setAutoSolverStatus(stage: PlanningStageId, status: AutoSolverStatus): void {
    this.autoSolverStatusSignal.update((current) => ({ ...current, [stage]: status }));
  }

  private setSolverPreview(
    stage: PlanningStageId,
    payload: PlanningSolverResponseDto,
    source: SolverPreviewSource,
    activityIds: string[],
    window?: { start: Date; end: Date } | null,
  ): void {
    this.solverPreviewSignal.update((current) => ({
      ...current,
      [stage]: {
        source,
        payload,
        createdAt: new Date(),
        activityIds,
        window: window ?? null,
      },
    }));
  }

  private clearSolverPreview(stage: PlanningStageId, source?: SolverPreviewSource): void {
    const current = this.solverPreviewSignal()[stage];
    if (!current) {
      return;
    }
    if (source && current.source !== source) {
      return;
    }
    this.solverPreviewSignal.update((state) => ({ ...state, [stage]: null }));
    if (current.source === 'auto') {
      this.setAutoSolverStatus(stage, { state: 'idle', message: null, updatedAt: new Date() });
    }
  }

  private handleSolverActivityMutation(activity: Activity, stage: PlanningStageId): void {
    if (!this.autoSolverEnabledSignal()) {
      return;
    }
    const request = this.buildAutoSolverRequest(activity, stage);
    if (!request) {
      this.setAutoSolverStatus(stage, {
        state: 'error',
        message: 'Kein passendes Zeitfenster gefunden.',
        updatedAt: new Date(),
      });
      return;
    }
    this.autoSolverRequest$.next(request);
  }

  private buildAutoSolverRequest(activity: Activity, stage: PlanningStageId): AutoSolverRequest | null {
    const window = this.buildAutoSolverWindow(activity);
    if (!window) {
      return null;
    }
    const resourceIds = new Set(getActivityParticipantIds(activity));
    if (!resourceIds.size) {
      return null;
    }
    const startMs = window.start.getTime();
    const endMs = window.end.getTime();
    const activityIds = Array.from(
      new Set(
        this.normalizedStageActivitySignals[stage]()
          .filter((entry) => this.activityOverlapsWindow(entry, startMs, endMs))
          .filter((entry) => this.activityTouchesResources(entry, resourceIds))
          .map((entry) => entry.id),
      ),
    );
    if (!activityIds.length) {
      return null;
    }
    return {
      stage,
      activityIds,
      windowStart: window.start,
      windowEnd: window.end,
    };
  }

  private buildAutoSolverWindow(activity: Activity): { start: Date; end: Date } | null {
    const startMs = new Date(activity.start).getTime();
    const endMs = activity.end ? new Date(activity.end).getTime() : startMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return null;
    }
    const baseStart = Math.min(startMs, endMs);
    const baseEnd = Math.max(startMs, endMs);
    return {
      start: new Date(baseStart - AUTO_SOLVER_WINDOW_MS),
      end: new Date(baseEnd + AUTO_SOLVER_WINDOW_MS),
    };
  }

  private activityOverlapsWindow(activity: Activity, windowStartMs: number, windowEndMs: number): boolean {
    const startMs = new Date(activity.start).getTime();
    const endMs = activity.end ? new Date(activity.end).getTime() : startMs;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return false;
    }
    return endMs >= windowStartMs && startMs <= windowEndMs;
  }

  private activityTouchesResources(activity: Activity, resourceIds: ReadonlySet<string>): boolean {
    const ids = getActivityParticipantIds(activity);
    return ids.some((id) => resourceIds.has(id));
  }

  private buildPreviewActivities(payload: PlanningSolverResponseDto | null): Activity[] {
    if (!payload?.upserts?.length) {
      return [];
    }
    return payload.upserts.map((activity, index) => ({
      ...activity,
      id: `preview:${index}:${activity.id}`,
    }));
  }

  protected formatSolverTimestamp(value?: Date | null): string {
    if (!value) {
      return '';
    }
    return this.solverTimestampFormatter.format(value);
  }

  private readAutoSolverEnabled(): boolean {
    try {
      const value = localStorage.getItem(AUTO_SOLVER_STORAGE_KEY);
      if (value === null) {
        return false;
      }
      return value === 'true';
    } catch {
      return false;
    }
  }

  private persistAutoSolverEnabled(enabled: boolean): void {
    try {
      localStorage.setItem(AUTO_SOLVER_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore storage errors (e.g. privacy mode).
    }
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
