import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, Signal, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuTrigger } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { GanttComponent } from '../../gantt/gantt.component';
import { GanttWindowLauncherComponent } from './components/gantt-window-launcher.component';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { PlanningDataService } from './planning-data.service';
import { PlanningDebugService, type PlanningDebugLogScope, type PlanningDebugLogSource } from './planning-debug.service';
import { PlanningDebugStreamService } from './planning-debug-stream.service';
import {
  PlanningRealtimeService,
  type PlanningCursorUpdate,
  type PlanningDragGhostEvent,
  type PlanningEditSnapshot,
  type PlanningEditUpdate,
  type PlanningLockUpdate,
  type PlanningPresenceSnapshot,
  type PlanningPresenceUpdate,
  type PlanningPresenceUser,
  type PlanningSelectionSnapshot,
  type PlanningSelectionUpdate,
} from './planning-realtime.service';
import { API_CONFIG } from '../../core/config/api-config';
import { ClientIdentityService } from '../../core/services/client-identity.service';
import type { PlanningTimelineRange } from './planning-data.types';
import { Resource } from '../../models/resource';
import { Activity, ActivityGroupRole, ServiceRole } from '../../models/activity';
import type {
  ActivityDragPreviewPayload,
  ActivityLockInfo,
  ActivitySelectionInfo,
  GanttRemoteCursor,
} from '../../gantt/gantt.models';
import {
  ActivityParticipantCategory,
  getActivityOwnerByCategory,
  getActivityOwnerId,
  getActivityParticipantIds,
} from '../../models/activity-ownership';
import type { ActivityCategory, ActivityFieldKey } from '../../core/models/activity-definition';
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
  PlanningCandidateBuildResponseDto,
  RulesetSelectionRequestDto,
  PlanningSolverResponseDto,
} from '../../core/api/planning-optimizer-api.types';
import { PlanningBoard, PlanningStageStore, StageRuntimeState } from './stores/planning-stage.store';
import { PlanningDashboardBoardFacade } from './planning-dashboard-board.facade';
import { ActivityCatalogOption, ActivityTypePickerGroup } from './planning-dashboard.types';
import {
  buildAttributesFromCatalog,
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
import {
  resolveLinkedServiceFieldState,
  resolveLinkedServiceLabel,
} from './planning-dashboard-linked-service.utils';
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
import { readActivityGroupMeta } from './planning-activity-group.utils';
import { normalizeStageId, updateStageQueryParam } from './planning-dashboard-stage.utils';
import { fromLocalDateTime, toIsoDate, toLocalDateTime } from './planning-dashboard-time.utils';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { findCatalogOptionByTypeId, definitionHasField, shouldShowEndField } from './planning-dashboard-activity.helpers';
import { STAGE_RESOURCE_GROUPS, type ActivityEditPreviewState, type PendingActivityState } from './planning-dashboard.constants';
import { ActivityCategoryService } from '../../core/services/activity-category.service';
import {
  applyLocationDefaults as applyLocationDefaultsUtil,
  type ActivityLocationDefinition,
  isLocationFieldHidden as isLocationFieldHiddenUtil,
} from './planning-dashboard-location-defaults.utils';
import { ConflictEntry, mapConflictCodesForOwner } from '../../shared/planning-conflicts';
import { PlanningOptimizerDialogComponent } from './planning-optimizer-dialog.component';

type LocationOptionKind = 'operational-point' | 'personnel-site';

type LocationAutocompleteOption = {
  key: string;
  value: string;
  label: string;
  description?: string;
  search: string;
  kind: LocationOptionKind;
  opId?: string | null;
};

type LocationOptionGroup = {
  op: LocationAutocompleteOption;
  sites: LocationAutocompleteOption[];
};

type LocationOptionGroupSet = {
  groups: LocationOptionGroup[];
  orphans: LocationAutocompleteOption[];
};

type SolverPreviewSource = 'manual';

type SolverPreviewState = {
  source: SolverPreviewSource;
  payload: PlanningSolverResponseDto;
  createdAt: Date;
  activityIds: string[];
  window?: { start: Date; end: Date } | null;
};

type SelectionDetailRow = {
  id: string;
  resource: string;
  service: string;
  type: string;
  start: string;
  end: string;
  from: string;
  to: string;
};

type SharedSelectionState = {
  stageId: PlanningStageId;
  activityIds: string[];
  primaryId: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  mode?: 'select' | 'edit';
  sourceConnectionId?: string | null;
  at?: string;
};

type SharedEditState = {
  stageId: PlanningStageId;
  activityId: string;
  userId: string;
  name?: string | null;
  color?: string | null;
  fields: Record<string, unknown>;
  activeField: string | null;
  sourceConnectionId?: string | null;
  at?: string;
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
  private readonly debug = inject(PlanningDebugService);
  private readonly debugStream = inject(PlanningDebugStreamService);
  private readonly realtime = inject(PlanningRealtimeService);
  private readonly apiConfig = inject(API_CONFIG);
  private readonly identity = inject(ClientIdentityService);
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
  private readonly optimizerLoadingSignal = signal({ candidates: false, solve: false });
  private readonly planningStore = inject(PlanningStoreService);
  private readonly solverPreviewSignal = signal<Record<PlanningStageId, SolverPreviewState | null>>({
    base: null,
    operations: null,
  });
  private readonly solverTimestampFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  private readonly selectionTimeFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  private readonly solverDrawerOpenSignal = signal(false);
  private readonly debugDrawerOpenSignal = signal(false);
  private readonly debugShowAllSignal = signal(false);
  private readonly debugExportOpenSignal = signal(false);
  private readonly debugBackendStreamEnabledSignal = signal(false);
  private readonly debugFilterQuerySignal = signal('');
  private readonly debugScopeFilterSignal = signal<string[]>([]);
  private readonly debugSourceFilterSignal = signal<string[]>([]);
  private readonly debugTopicFilterSignal = signal<string[]>([]);
  private readonly debugStreamTokenStorageKey = 'coreplanx-debug-stream-token';
  private readonly debugStreamTokenSignal = signal(this.loadDebugStreamToken());
  private readonly presenceMapSignal = signal<Map<string, PlanningPresenceUser>>(new Map());
  private readonly ghostMapSignal = signal<Record<PlanningStageId, Map<string, PlanningDragGhostEvent>>>({
    base: new Map(),
    operations: new Map(),
  });
  private readonly lockMapSignal = signal<Record<PlanningStageId, Map<string, PlanningLockUpdate>>>({
    base: new Map(),
    operations: new Map(),
  });
  private readonly cursorMapSignal = signal<Record<PlanningStageId, Map<string, PlanningCursorUpdate>>>({
    base: new Map(),
    operations: new Map(),
  });
  private readonly selectionMapSignal = signal<Record<PlanningStageId, Map<string, SharedSelectionState>>>({
    base: new Map(),
    operations: new Map(),
  });
  private readonly editMapSignal = signal<Record<PlanningStageId, Map<string, SharedEditState>>>({
    base: new Map(),
    operations: new Map(),
  });
  private readonly editFieldOrder = [
    'type',
    'start',
    'end',
    'durationMinutes',
    'from',
    'to',
    'remark',
    'linkedServiceId',
  ];
  private readonly editFieldLabels: Record<string, string> = {
    type: 'Typ',
    start: 'Start',
    end: 'Ende',
    durationMinutes: 'Dauer',
    from: 'Von',
    to: 'Nach',
    remark: 'Bemerkung',
    linkedServiceId: 'Dienst',
  };
  private lastSelectionSignature: string | null = null;
  private lastSelectionStage: PlanningStageId | null = null;
  private lastEditActivityId: string | null = null;
  private lastEditStage: PlanningStageId | null = null;
  private lastEditFormValue: Record<string, unknown> | null = null;
  private pendingCursorPayload: {
    stageId: PlanningStageId;
    time: Date | null;
    resourceId: string | null;
  } | null = null;
  private cursorSendHandle: number | null = null;
  private lastDraftGhostState: {
    stageId: PlanningStageId;
    activityId: string;
    resourceId: string;
    start: string;
    end: string | null;
  } | null = null;
  private lastDraftSignature: string | null = null;
  private readonly debugTimestampFormatter = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  private readonly selectionDetailsOpenSignal = signal(false);
  private readonly solverResourceSelectionSignal = signal<Set<string>>(new Set());
  private lastSolverResourceOptions = new Set<string>();
  private lastTemplateError: string | null = null;

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

  private readonly stageLoadingSignals: Record<PlanningStageId, Signal<boolean>> = {
    base: this.data.stageLoading('base'),
    operations: this.data.stageLoading('operations'),
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
    buildActivityTitle: (label) => buildActivityTitle(label),
    generateActivityId: (seed: string) => this.activityOpsFacade.generateActivityId(seed),
    findCatalogOptionByTypeId: (typeId) => this.findCatalogOptionByTypeId(typeId),
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

  private readonly activityCatalog = inject(ActivityCatalogService);
  private readonly translationService = inject(TranslationService);
  private readonly activityCategories = inject(ActivityCategoryService);
  private readonly catalogFacade = new PlanningDashboardCatalogFacade(
    this.activityCatalog,
    this.translationService,
    () => this.activityCategories.categories(),
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
  private readonly activityTypeGroupCollapseSignal = signal<Record<string, boolean>>(
    this.loadActivityTypeGroupCollapseState(),
  );
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
  private readonly activityTypePickerState = this.loadActivityTypePickerState();
  private readonly favoriteActivityTypeOptionIdsSignal = signal<string[]>(
    this.activityTypePickerState.favorites,
  );
  private readonly recentActivityTypeOptionIdsSignal = signal<string[]>(
    this.activityTypePickerState.recents,
  );
  private readonly activityTypeUsageCountsSignal = signal<Record<string, number>>(
    this.activityTypePickerState.usage,
  );
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly activityEditPreviewSignal = signal<ActivityEditPreviewState | null>(null);
  protected readonly selectedTemplateId = computed(() => this.templateStore.selectedTemplateWithFallback()?.id ?? null);
  private readonly queryFrom = signal<string | null>(null);
  private readonly queryTo = signal<string | null>(null);
  private readonly selectedSimulationSignal = signal<SimulationRecord | null>(null);
  protected readonly planningVariant = this.data.planningVariant();
  protected readonly optimizerLoading = computed(() => this.optimizerLoadingSignal());
  protected readonly solverPreviewState = computed(
    () => this.solverPreviewSignal()[this.activeStageSignal()],
  );
  protected readonly solverPreviewActivities = computed(() =>
    this.buildPreviewActivities(this.solverPreviewState()?.payload ?? null),
  );
  protected readonly ghostPreviewActivities = computed(() =>
    this.buildGhostActivities(this.activeStageSignal()),
  );
  protected readonly ganttPreviewActivities = computed(() => [
    ...this.solverPreviewActivities(),
    ...this.ghostPreviewActivities(),
  ]);
  protected readonly activityLocks = computed(() => this.buildActivityLocks(this.activeStageSignal()));
  protected readonly sharedActivitySelections = computed(() =>
    this.buildSharedActivitySelections(this.activeStageSignal()),
  );
  protected readonly remoteCursors = computed(() => this.buildRemoteCursors(this.activeStageSignal()));
  protected readonly remoteEditorsForSelected = computed(() => this.buildRemoteEditorsForSelected());
  protected readonly presenceUsers = computed(() => Array.from(this.presenceMapSignal().values()));
  protected readonly solverDrawerOpen = computed(() => this.solverDrawerOpenSignal());
  protected readonly debugDrawerOpen = computed(() => this.debugDrawerOpenSignal());
  protected readonly debugShowAll = computed(() => this.debugShowAllSignal());
  protected readonly debugExportOpen = computed(() => this.debugExportOpenSignal());
  protected readonly debugBackendStreamEnabled = computed(() => this.debugBackendStreamEnabledSignal());
  protected readonly debugPaused = this.debug.paused;
  protected readonly debugPendingCount = this.debug.pendingCount;
  protected readonly debugFilterQuery = computed(() => this.debugFilterQuerySignal());
  protected readonly debugScopeFilters = computed(() => this.debugScopeFilterSignal());
  protected readonly debugSourceFilters = computed(() => this.debugSourceFilterSignal());
  protected readonly debugTopicFilters = computed(() => this.debugTopicFilterSignal());
  protected readonly debugStreamToken = computed(() => this.debugStreamTokenSignal());
  protected readonly debugApiStatus = this.debug.apiStatus;
  protected readonly debugSseStatus = this.debug.sseStatus;
  protected readonly debugViewportStatus = this.debug.viewportStatus;
  protected readonly debugBackendStreamStatus = this.debug.backendStreamStatus;
  protected readonly debugScopeOptions = ['api', 'sse', 'viewport', 'system', 'mutation', 'backend'] as const;
  protected readonly debugSourceOptions = ['frontend', 'backend'] as const;
  protected readonly debugTopicOptions = ['planning', 'solver', 'assistant', 'db', 'rules', 'system'] as const;
  protected readonly debugAlertCount = computed(() => {
    const entries = this.debug.entries();
    return entries.filter((entry) => entry.level === 'warn' || entry.level === 'error').length;
  });
  protected readonly debugConnectionState = computed(() => {
    const api = this.debug.apiStatus();
    const sseMap = this.debug.sseStatus();
    const stageId = this.activeStageSignal();
    const sse = sseMap[stageId];
    if (api.state === 'error' || sse?.state === 'error') {
      return 'error';
    }
    if (sse?.state === 'disabled') {
      return api.state === 'ok' ? 'ok' : 'idle';
    }
    if (api.state === 'ok' && sse?.state === 'connected') {
      return 'ok';
    }
    if (api.state === 'ok' || sse?.state === 'connected') {
      return 'warn';
    }
    return 'idle';
  });
  protected readonly debugConnectionLabel = computed(() => {
    const state = this.debugConnectionState();
    if (state === 'ok') {
      return 'Verbunden';
    }
    if (state === 'warn') {
      return 'Teilweise';
    }
    if (state === 'error') {
      return 'Fehler';
    }
    return 'Verbinde...';
  });
  protected readonly debugLogEntries = computed(() => {
    const entries = this.debug.entries();
    const filtered = this.debugShowAllSignal()
      ? entries
      : entries.filter((entry) => entry.level === 'warn' || entry.level === 'error');
    const query = this.debugFilterQuerySignal().trim().toLowerCase();
    const scopeFilters = this.debugScopeFilterSignal();
    const sourceFilters = this.debugSourceFilterSignal();
    const topicFilters = this.debugTopicFilterSignal();
    const narrowed = filtered.filter((entry) => {
      if (scopeFilters.length && !scopeFilters.includes(entry.scope)) {
        return false;
      }
      const source = entry.source ?? 'frontend';
      if (sourceFilters.length && !sourceFilters.includes(source)) {
        return false;
      }
      if (topicFilters.length && (!entry.topic || !topicFilters.includes(entry.topic))) {
        return false;
      }
      if (query) {
        const message = entry.message.toLowerCase();
        if (message.includes(query)) {
          return true;
        }
        if (entry.context) {
          try {
            const contextText = JSON.stringify(entry.context).toLowerCase();
            if (contextText.includes(query)) {
              return true;
            }
          } catch {
            return false;
          }
        }
        return false;
      }
      return true;
    });
    return [...narrowed].reverse();
  });
  protected readonly debugExportJson = computed(() => JSON.stringify(this.buildDebugExportPayload(), null, 2));
  protected readonly selectionDetailsOpen = computed(() => this.selectionDetailsOpenSignal());
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
    linkedServiceId: [''],
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
          kind: 'operational-point',
          opId: uniqueId,
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
          kind: 'personnel-site',
          opId: uniqueId || null,
        } satisfies LocationAutocompleteOption;
      })
      .filter((entry) => entry.value.length > 0);
    mapped.sort((a, b) => a.label.localeCompare(b.label, 'de'));
    return mapped;
  });

  private readonly locationOptionGroups = computed<LocationOptionGroupSet>(() => {
    const ops = this.operationalPointLocationOptions();
    const sites = this.personnelSiteLocationOptions();
    if (!ops.length && !sites.length) {
      return { groups: [], orphans: [] };
    }
    const opMap = new Map<string, LocationAutocompleteOption>();
    ops.forEach((op) => {
      const opId = (op.opId ?? '').trim();
      if (opId) {
        opMap.set(opId, op);
      }
    });
    const sitesByOp = new Map<string, LocationAutocompleteOption[]>();
    const orphans: LocationAutocompleteOption[] = [];
    sites.forEach((site) => {
      const opId = (site.opId ?? '').trim();
      if (opId && opMap.has(opId)) {
        const list = sitesByOp.get(opId) ?? [];
        list.push(site);
        sitesByOp.set(opId, list);
      } else {
        orphans.push(site);
      }
    });
    const groups = ops.map((op) => {
      const opId = (op.opId ?? '').trim();
      const list = [...(opId ? sitesByOp.get(opId) ?? [] : [])];
      list.sort((a, b) => a.label.localeCompare(b.label, 'de'));
      return { op, sites: list };
    });
    orphans.sort((a, b) => a.label.localeCompare(b.label, 'de'));
    return { groups, orphans };
  });

  protected readonly fromLocationOptions = computed(() =>
    this.filterLocationOptions(this.fromLocationQuerySignal(), this.locationOptionGroups(), {
      groupLimit: 60,
      orphanLimit: 30,
    }),
  );
  protected readonly toLocationOptions = computed(() =>
    this.filterLocationOptions(this.toLocationQuerySignal(), this.locationOptionGroups(), {
      groupLimit: 60,
      orphanLimit: 30,
    }),
  );
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
  private readonly lastViewportByBoard = new Map<string, PlanningTimelineRange>();
  private lastActivityErrorMessage: string | null = null;
  private readonly dragPreviewThrottleMs = 80;
  private lastDragPreviewAt = 0;

  @ViewChild('typeSearchInput') private readonly typeSearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('typeMenuTrigger') private readonly typeMenuTrigger?: MatMenuTrigger;

  constructor() {
    this.planningStore.ensureInitialized();
    effect(() => {
      const stage = this.activeStageSignal();
      const error = this.activityError(stage)();
      if (!error) {
        this.lastActivityErrorMessage = null;
        return;
      }
      if (error === this.lastActivityErrorMessage) {
        return;
      }
      this.lastActivityErrorMessage = error;
      this.snackBar.open(error, 'OK', { duration: 6000 });
    });
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
      findCatalogOptionByTypeId: (typeId) => this.findCatalogOptionByTypeId(typeId),
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
      pendingActivitySignal: this.pendingActivitySignal,
      moveTargetOptions: this.moveTargetOptions,
      activityMoveTargetSignal: this.activityMoveTargetSignal,
    });

    effect(() => {
      this.syncSolverResourceSelection(this.solverResourceOptions());
    });

    effect(() => {
      const error = this.templateStore.error();
      if (!error) {
        this.lastTemplateError = null;
        return;
      }
      if (error === this.lastTemplateError) {
        return;
      }
      this.lastTemplateError = error;
      this.debug.log('error', 'api', 'Template konnte nicht geladen werden', {
        context: { message: error },
      });
    });

    effect(() => {
      const enabled = this.debugBackendStreamEnabledSignal();
      const token = this.debugStreamTokenSignal();
      if (enabled) {
        this.debugStream.connect({ token: token.trim().length > 0 ? token : undefined });
      } else {
        this.debugStream.disconnect();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.debugStream.disconnect();
      if (this.cursorSendHandle !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.cursorSendHandle);
        }
        clearTimeout(this.cursorSendHandle);
        this.cursorSendHandle = null;
      }
    });

    effect(() => {
      const stage = this.activeStageSignal();
      const state = this.stageStore.stageState(stage)();
      const activeBoardId = state.activeBoardId;
      if (!activeBoardId) {
        return;
      }
      const board = state.boards.find((entry) => entry.id === activeBoardId);
      if (!board) {
        return;
      }
      if (board.resourceIds.length === 0) {
        return;
      }
      const viewport = this.lastViewportByBoard.get(activeBoardId);
      if (!viewport) {
        return;
      }
      this.data.setStageViewport(stage, viewport, board.resourceIds);
    });

    this.realtime
      .presence()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.applyPresencePayload(payload));

    this.realtime
      .dragGhosts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.applyDragGhostPayload(payload));

    this.realtime
      .locks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.applyLockPayload(payload));

    this.realtime
      .cursor()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.applyCursorPayload(payload));

    this.realtime
      .selections()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.applySelectionPayload(payload));

    this.realtime
      .editUpdates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((payload) => this.applyEditPayload(payload));

    effect(() => {
      const stage = this.activeStageSignal();
      const activeBoardId = this.stageStore.stageState(stage)().activeBoardId ?? null;
      this.realtime.updatePresence({ stageId: stage, boardId: activeBoardId });
    });

    effect(() => {
      const stage = this.activeStageSignal();
      const selectedIds = this.activitySelection.selectedActivityIds();
      const selectionState = this.activitySelection.selectedActivityState();
      const slot = this.activitySelection.selectedActivitySlot();
      const editActivityId = selectionState?.activity?.id ?? null;
      const primaryId = editActivityId ?? slot?.activityId ?? null;
      const merged = new Set<string>(selectedIds);
      if (editActivityId) {
        merged.add(editActivityId);
      }
      const activityIds = Array.from(merged);
      const signatureIds = [...activityIds].sort((a, b) => a.localeCompare(b));
      const mode = editActivityId ? 'edit' : 'select';
      const signature = `${stage}|${mode}|${primaryId ?? ''}|${signatureIds.join(',')}`;

      if (this.lastSelectionStage && this.lastSelectionStage !== stage) {
        this.realtime.sendSelection({
          stageId: this.lastSelectionStage,
          activityIds: [],
          primaryId: null,
          mode: 'select',
        });
      }

      if (signature !== this.lastSelectionSignature) {
        this.lastSelectionSignature = signature;
        this.lastSelectionStage = stage;
        this.realtime.sendSelection({
          stageId: stage,
          activityIds,
          primaryId,
          mode,
        });
      }
    });

    effect(() => {
      const stage = this.activeStageSignal();
      const selection = this.activitySelection.selectedActivityState();
      const activityId = selection?.activity?.id ?? null;
      if (this.lastEditActivityId && (activityId !== this.lastEditActivityId || stage !== this.lastEditStage)) {
        this.realtime.sendEditUpdate({
          stageId: this.lastEditStage ?? stage,
          activityId: this.lastEditActivityId,
          state: 'end',
        });
      }
      if (activityId && (activityId !== this.lastEditActivityId || stage !== this.lastEditStage)) {
        this.realtime.sendEditUpdate({
          stageId: stage,
          activityId,
          state: 'start',
        });
      }
      this.lastEditActivityId = activityId;
      this.lastEditStage = stage;
      if (!activityId) {
        this.lastEditFormValue = null;
      } else {
        this.lastEditFormValue = this.activityForm.getRawValue() as Record<string, unknown>;
      }
    });

    this.activityForm.valueChanges
      .pipe(debounceTime(120), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.handleEditFormChange(value as Record<string, unknown>));

    effect(() => {
      const pending = this.pendingActivitySignal();
      this.syncDraftGhost(pending);
    });

    this.data.setAutopilotSuppressed(true);
  }

  protected readonly activeStageId = computed(() => this.activeStageSignal());

  protected readonly activeSyncingActivityIds = computed(
    () => this.stageSyncingActivityIdsSignals[this.activeStageSignal()](),
  );

  protected readonly activeStageLoading = computed(
    () => this.stageLoadingSignals[this.activeStageSignal()](),
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
  protected readonly activityCatalogOptionTypeMap = this.catalogFacade.activityCatalogOptionTypeMap;
  protected readonly activityCreationOptions = this.catalogFacade.activityCreationOptions;
  protected readonly activityTypeCandidates = this.catalogFacade.activityTypeCandidates;
  protected readonly quickActivityTypes = computed<ActivityCatalogOption[]>(() => {
    const candidates = this.activityTypeCandidates();
    if (!candidates.length) {
      return [];
    }
    const counts = this.activityTypeUsageCountsSignal();
    const maxQuickTypes = 6;
    const hasUsage = candidates.some((option) => (counts[option.id] ?? 0) > 0);
    if (!hasUsage) {
      return candidates.slice(0, maxQuickTypes);
    }
    const ranked = candidates.map((option, index) => {
      const raw = counts[option.id];
      const count = typeof raw === 'number' ? raw : Number(raw);
      return {
        option,
        index,
        count: Number.isFinite(count) ? count : 0,
      };
    });
    ranked.sort((a, b) => {
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.index - b.index;
    });
    return ranked.slice(0, maxQuickTypes).map((entry) => entry.option);
  });
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
    findCatalogOptionByTypeId: (id) => this.findCatalogOptionByTypeId(id),
    buildActivityTitle: (label) => buildActivityTitle(label),
    definitionHasField: (definition, field) => this.definitionHasField(definition, field as ActivityFieldKey),
    applyActivityTypeConstraints: (activity) => this.applyActivityTypeConstraints(activity),
    resolveResourceById: (id) =>
      this.stageResourceSignals[this.activeStageSignal()]().find((resource) => resource.id === id) ?? null,
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
      resolveActivityTypeForResource(resource, typeId, this.activityCreationOptions()),
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
    findCatalogOptionByTypeId: (typeId) => this.findCatalogOptionByTypeId(typeId),
    buildActivityTitle: (label) => buildActivityTitle(label),
    definitionHasField: (definition, field) => this.definitionHasField(definition, field),
    isPendingSelection: (id) => this.pendingFacade.isPendingSelection(id),
    updateStageActivities: (stage, updater) => this.activityOpsFacade.updateStageActivities(stage, updater),
    saveTemplateActivity: (activity) => this.saveTemplateActivity(activity),
    replaceActivity: (activity) => this.activityOpsFacade.replaceActivity(activity),
    clearEditingPreview: () => this.pendingFacade.clearEditingPreview(),
    deleteTemplateActivity: (templateId, baseId) => this.data.deleteTemplateActivity(templateId, baseId),
    onActivityMutated: (activity) => this.recordActivityTypeUsageFromActivity(activity),
  });

  protected readonly activityTypeInfoMap = computed(() => {
    const info: Record<string, { label: string; showRoute: boolean; serviceRole: ServiceRole | null }> = {};
    this.activityCatalogOptionTypeMap().forEach((option, typeId) => {
      const fields = option.fields ?? [];
      info[typeId] = {
        label: option.label,
        showRoute: fields.includes('from') || fields.includes('to'),
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
  protected readonly selectedActivityIsManaged = computed(() => {
    const selection = this.selectedActivity();
    return selection ? this.isManagedActivity(selection.activity) : false;
  });
  protected readonly selectedActivityDeleteBlocked = computed(() => {
    const selection = this.selectedActivity();
    return selection ? this.isDeletionBlockedActivity(selection.activity) : false;
  });
  protected readonly deletableSelectionCount = computed(() =>
    this.selectedActivities().filter((item) => !this.isDeletionBlockedActivity(item.activity)).length,
  );
  protected readonly selectedActivityIdsArray = this.selectionState.selectedActivityIdsArray;
  protected readonly selectedActivitySlot = this.selectionState.selectedActivitySlot;
  protected readonly moveTargetOptions = () => this.selectionState.moveTargetOptions();
  protected readonly activityMoveTarget = this.selectionState.activityMoveTarget;
  protected readonly solverResourceOptions = computed(() => {
    const unique = new Map<string, Resource>();
    this.selectedActivities().forEach(({ resource }) => {
      unique.set(resource.id, resource);
    });
    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly solverResourceSelection = computed(() => Array.from(this.solverResourceSelectionSignal()));
  protected readonly solverResourceSelectionLabel = computed(() => {
    const total = this.solverResourceOptions().length;
    const selected = this.solverResourceSelectionSignal().size;
    if (total === 0) {
      return 'Keine Ressourcen in der Auswahl';
    }
    if (selected === 0) {
      return 'Keine Ressourcen gewaehlt';
    }
    if (selected === total) {
      return 'Alle Ressourcen aktiv';
    }
    return `${selected} von ${total} Ressourcen`;
  });
  protected readonly solverActivityIds = computed(() => {
    const allowed = this.solverResourceSelectionSignal();
    const items = this.selectedActivities();
    const ids = new Set<string>();
    items.forEach((item) => {
      if (allowed.size === 0 || allowed.has(item.resource.id)) {
        ids.add(item.activity.id);
      }
    });
    return Array.from(ids);
  });
  protected readonly selectedActivityDetails = computed<SelectionDetailRow[]>(() => {
    const items = [...this.selectedActivities()];
    items.sort((a, b) => {
      const nameCompare = a.resource.name.localeCompare(b.resource.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.activity.start.localeCompare(b.activity.start);
    });
    return items.map((item) => ({
      id: item.activity.id,
      resource: item.resource.name,
      service: this.activityServiceLabel(item.activity),
      type: this.activityTypeLabel(item.activity.type),
      start: this.formatSelectionTimestamp(item.activity.start),
      end: this.formatSelectionTimestamp(item.activity.end),
      from: this.formatOptionalValue(item.activity.from),
      to: this.formatOptionalValue(item.activity.to),
    }));
  });

  protected readonly selectedActivityDefinition = computed<ActivityCatalogOption | null>(() => {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return null;
    }
    const typeOverride = this.activityFormTypeSignal();
    const typeId = (typeOverride || selection.activity.type) ?? null;
    const attrs = selection.activity.attributes as Record<string, unknown> | undefined;
    const activityKey = typeof attrs?.['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
    if (activityKey) {
      return this.activityCatalogOptionMap().get(activityKey) ?? null;
    }
    return findCatalogOptionByTypeId(this.activityCreationOptions, typeId);
  });

  protected readonly linkedServiceFieldState = computed(() => {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return { kind: null, visible: false, required: false };
    }
    const typeOverride = this.activityFormTypeSignal();
    const typeId = (typeOverride || selection.activity.type) ?? null;
    const definition = this.findCatalogOptionByTypeId(typeId);
    const option = this.selectedCatalogOption();
    const attrs = selection.activity.attributes as Record<string, unknown> | undefined;
    const activityKey = typeof attrs?.['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
    const matchesKey = !!activityKey && option?.id === activityKey;
    const matchesType = !!typeId && option?.activityTypeId === typeId;
    const catalogOption = matchesKey || matchesType ? option : null;
    return resolveLinkedServiceFieldState({
      anchor: selection.resource,
      definition,
      catalogOption,
    });
  });

  protected readonly linkedServiceFieldVisible = computed(() => this.linkedServiceFieldState().visible);
  protected readonly linkedServiceRequired = computed(() => this.linkedServiceFieldState().required);
  protected readonly linkedServiceLabel = computed(() => resolveLinkedServiceLabel(this.linkedServiceFieldState().kind));
  protected readonly linkedServiceOptions = computed(() => {
    const state = this.linkedServiceFieldState();
    if (!state.kind) {
      return [] as Array<{ id: string; name: string }>;
    }
    const resources = this.stageResourceSignals[this.activeStageSignal()]();
    return resources
      .filter((resource) => resource.kind === state.kind)
      .map((resource) => ({ id: resource.id, name: resource.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
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
    findCatalogOptionByTypeId: (typeId) => this.findCatalogOptionByTypeId(typeId),
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
    findCatalogOptionByTypeId: (id) => this.findCatalogOptionByTypeId(id),
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
    return this.activityTypeDisplayLabelMap().get(typeId) ?? typeId;
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

  protected toggleActivityTypeGroup(groupId: string): void {
    const trimmed = (groupId ?? '').trim();
    if (!trimmed) {
      return;
    }
    this.activityTypeGroupCollapseSignal.update((current) => ({
      ...current,
      [trimmed]: !(current[trimmed] ?? false),
    }));
    this.persistActivityTypeGroupCollapseState();
  }

  protected isActivityTypeGroupExpanded(groupId: string): boolean {
    const query = this.activityTypeSearchQuerySignal().trim();
    if (query.length) {
      return true;
    }
    return !(this.activityTypeGroupCollapseSignal()[groupId] ?? false);
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
    return null;
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
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (value: unknown) =>
      typeof value === 'boolean' ? value : typeof value === 'string' ? value.toLowerCase() === 'true' : false;
    return (
      role === 'start' ||
      role === 'end' ||
      toBool(attrs?.['is_service_start']) ||
      toBool(attrs?.['is_service_end'])
    );
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

  private recordActivityTypeUsageFromActivity(activity: Activity): void {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const key = typeof attrs?.['activityKey'] === 'string' ? (attrs['activityKey'] as string) : '';
    if (!key) {
      return;
    }
    this.recordActivityTypeUsage(key);
  }

  private recordActivityTypeUsage(optionId: string): void {
    const trimmed = (optionId ?? '').trim();
    if (!trimmed) {
      return;
    }
    this.activityTypeUsageCountsSignal.update((current) => {
      const next = { ...current };
      const raw = next[trimmed];
      const count = typeof raw === 'number' ? raw : Number(raw);
      next[trimmed] = Number.isFinite(count) ? count + 1 : 1;
      return next;
    });
    this.persistActivityTypePickerState();
  }

  private loadActivityTypeGroupCollapseState(): Record<string, boolean> {
    if (typeof window === 'undefined') {
      return {};
    }
    try {
      const raw = window.localStorage.getItem('coreplanx:planning:type-picker-groups:v1');
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as any;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      const state: Record<string, boolean> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (!key) {
          return;
        }
        state[key] = Boolean(value);
      });
      return state;
    } catch {
      return {};
    }
  }

  private persistActivityTypeGroupCollapseState(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        'coreplanx:planning:type-picker-groups:v1',
        JSON.stringify(this.activityTypeGroupCollapseSignal()),
      );
    } catch {
      // ignore storage issues
    }
  }

  private loadActivityTypePickerState(): { favorites: string[]; recents: string[]; usage: Record<string, number> } {
    if (typeof window === 'undefined') {
      return { favorites: [], recents: [], usage: {} };
    }
    try {
      const raw = window.localStorage.getItem('coreplanx:planning:type-picker:v1');
      if (!raw) {
        return { favorites: [], recents: [], usage: {} };
      }
      const parsed = JSON.parse(raw) as any;
      const favorites = Array.isArray(parsed?.favorites) ? parsed.favorites.map(String) : [];
      const recents = Array.isArray(parsed?.recents) ? parsed.recents.map(String) : [];
      const usage: Record<string, number> = {};
      const usageRaw = parsed?.usage;
      if (usageRaw && typeof usageRaw === 'object' && !Array.isArray(usageRaw)) {
        Object.entries(usageRaw).forEach(([key, value]) => {
          const count = typeof value === 'number' ? value : Number(value);
          if (!Number.isFinite(count) || count <= 0) {
            return;
          }
          usage[key] = Math.trunc(count);
        });
      }
      return { favorites, recents, usage };
    } catch {
      return { favorites: [], recents: [], usage: {} };
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
          usage: this.activityTypeUsageCountsSignal(),
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

  protected handleActivityEdit(event: { resource: Resource; activity: Activity }): void {
    if (this.isGhostDraftActivity(event.activity)) {
      this.handleGhostDraftEdit(event);
      return;
    }
    this.activityHandlers.handleActivityEdit(event);
  }

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

  protected handleCursorMoved(payload: { time: Date | null; resourceId: string | null }): void {
    const stageId = this.activeStageSignal();
    this.pendingCursorPayload = {
      stageId,
      time: payload.time ? new Date(payload.time) : null,
      resourceId: payload.resourceId ?? null,
    };
    if (this.cursorSendHandle !== null) {
      return;
    }
    const flush = () => {
      this.cursorSendHandle = null;
      const next = this.pendingCursorPayload;
      this.pendingCursorPayload = null;
      if (!next) {
        return;
      }
      this.realtime.sendCursor({
        stageId: next.stageId,
        userId: this.identity.userId(),
        time: next.time ? next.time.toISOString() : null,
        resourceId: next.resourceId ?? null,
      });
    };
    if (typeof requestAnimationFrame === 'function') {
      this.cursorSendHandle = requestAnimationFrame(flush);
    } else {
      this.cursorSendHandle = setTimeout(flush, 60);
    }
  }

  protected handleEditFieldFocus(field: string): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    this.realtime.sendEditUpdate({
      stageId: this.activeStageSignal(),
      activityId: selection.activity.id,
      field,
      value: this.readFormFieldValue(field),
      state: 'focus',
    });
  }

  protected handleEditFieldBlur(field: string): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    this.realtime.sendEditUpdate({
      stageId: this.activeStageSignal(),
      activityId: selection.activity.id,
      field,
      value: this.readFormFieldValue(field),
      state: 'blur',
    });
  }

  protected handleEditFieldOpened(field: string, opened: boolean): void {
    if (opened) {
      this.handleEditFieldFocus(field);
    } else {
      this.handleEditFieldBlur(field);
    }
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

  protected handleActivityDragPreview(event: ActivityDragPreviewPayload): void {
    if (!event?.activity?.id) {
      return;
    }
    if (event.state === 'move' && !event.isValid) {
      return;
    }
    const now = Date.now();
    if (event.state === 'move' && now - this.lastDragPreviewAt < this.dragPreviewThrottleMs) {
      return;
    }
    this.lastDragPreviewAt = now;
    this.realtime.sendDragGhost({
      stageId: this.activeStageSignal(),
      userId: this.identity.userId(),
      activityId: event.activity.id,
      resourceId: event.targetResourceId,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
      mode: event.mode,
      state: event.state,
      isValid: event.isValid,
    });
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

  protected async saveSelectedActivityEdits(): Promise<void> {
    await this.selectionHandlers.saveSelectedActivityEdits();
  }

  protected deleteSelectedActivity(): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.isDeletionBlockedActivity(selection.activity)) {
      this.notifyManagedDeleteBlocked(1);
      return;
    }
    this.selectionHandlers.deleteSelectedActivity();
  }

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

  protected setSolverResourceSelection(resourceIds: string[]): void {
    this.solverResourceSelectionSignal.set(new Set(resourceIds ?? []));
  }

  protected setSelectionDetailsOpen(open: boolean): void {
    this.selectionDetailsOpenSignal.set(open);
  }

  protected deleteActivitySelection(): void {
    const count = this.selectedActivities().length;
    if (count === 0) {
      return;
    }
    const deletable = this.selectedActivities().filter((item) => !this.isDeletionBlockedActivity(item.activity));
    if (deletable.length === 0) {
      this.notifyManagedDeleteBlocked(count);
      return;
    }
    if (deletable.length !== count) {
      this.notifyManagedDeleteBlocked(count - deletable.length);
      this.activitySelection.selectedActivityIds.set(new Set(deletable.map((item) => item.activity.id)));
    }
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '520px',
      data: {
        title: 'Auswahl löschen?',
        message: `${deletable.length} Aktivität(en) werden gelöscht. Fortfahren?`,
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

  protected isManagedActivity(activity: Activity | null | undefined): boolean {
    const id = (activity?.id ?? '').toString();
    return (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    );
  }

  private isDeletionBlockedActivity(activity: Activity | null | undefined): boolean {
    const id = (activity?.id ?? '').toString();
    return id.startsWith('svccommute:');
  }

  private notifyManagedDeleteBlocked(count: number): void {
    const message =
      count === 1
        ? 'Systemvorgaben können nicht gelöscht werden.'
        : `Systemvorgaben (${count}) können nicht gelöscht werden.`;
    this.snackBar.open(message, 'OK', { duration: 5000 });
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

  private findCatalogOptionByTypeId(id: string | null | undefined): ActivityCatalogOption | null {
    return findCatalogOptionByTypeId(this.activityCreationOptions, id);
  }

  protected definitionHasField(
    definition: ActivityCatalogOption | null,
    field: ActivityFieldKey,
  ): boolean {
    return definitionHasField(definition, field);
  }

  protected isLocationFieldHidden(definition: ActivityCatalogOption | null, field: 'from' | 'to'): boolean {
    return isLocationFieldHiddenUtil(this.buildLocationDefinitionForOption(definition), field);
  }

  protected shouldShowEndField(definition: ActivityCatalogOption | null): boolean {
    return shouldShowEndField(definition);
  }

  private applyPresencePayload(
    payload: PlanningPresenceSnapshot | PlanningPresenceUpdate | null | undefined,
  ): void {
    if (!payload) {
      return;
    }
    if (Array.isArray((payload as PlanningPresenceSnapshot).users)) {
      const snapshot = payload as PlanningPresenceSnapshot;
      const map = new Map<string, PlanningPresenceUser>();
      snapshot.users.forEach((user) => {
        if (!user?.userId) {
          return;
        }
        map.set(user.userId, {
          userId: user.userId,
          name: user.name ?? null,
          color: user.color ?? null,
          tabCount: user.tabCount ?? 0,
        });
      });
      this.presenceMapSignal.set(map);
      return;
    }
    const update = payload as PlanningPresenceUpdate;
    if (!update.userId) {
      return;
    }
    this.presenceMapSignal.update((current) => {
      const next = new Map(current);
      const existing = next.get(update.userId);
      const nextCount =
        typeof update.tabCount === 'number' ? update.tabCount : existing?.tabCount ?? 1;
      if (nextCount <= 0) {
        next.delete(update.userId);
        return next;
      }
      next.set(update.userId, {
        userId: update.userId,
        name: update.name ?? existing?.name ?? null,
        color: update.color ?? existing?.color ?? null,
        tabCount: nextCount,
      });
      return next;
    });
  }

  private applyDragGhostPayload(payload: PlanningDragGhostEvent | null | undefined): void {
    if (!payload?.stageId) {
      return;
    }
    const connectionId = this.realtime.connectionId();
    if (payload.sourceConnectionId && connectionId && payload.sourceConnectionId === connectionId) {
      return;
    }
    const key =
      payload.mode === 'create'
        ? payload.activityId
        : payload.sourceConnectionId ?? payload.userId ?? payload.activityId;
    if (!key) {
      return;
    }
    const shouldRemove = payload.state === 'end' || payload.isValid === false;
    this.ghostMapSignal.update((current) => {
      const nextStageMap = new Map(current[payload.stageId] ?? []);
      if (shouldRemove) {
        nextStageMap.delete(key);
      } else {
        nextStageMap.set(key, this.enrichGhostPayload(payload));
      }
      return {
        ...current,
        [payload.stageId]: nextStageMap,
      };
    });
  }

  private applyLockPayload(payload: PlanningLockUpdate | null | undefined): void {
    if (!payload?.stageId || !payload.activityId) {
      return;
    }
    if (payload.userId && payload.userId === this.identity.userId()) {
      return;
    }
    this.lockMapSignal.update((current) => {
      const nextStageMap = new Map(current[payload.stageId] ?? []);
      if (payload.state === 'released') {
        nextStageMap.delete(payload.activityId);
      } else {
        nextStageMap.set(payload.activityId, this.enrichLockPayload(payload));
      }
      return {
        ...current,
        [payload.stageId]: nextStageMap,
      };
    });
  }

  private applyCursorPayload(payload: PlanningCursorUpdate | null | undefined): void {
    if (!payload?.stageId) {
      return;
    }
    const connectionId = this.realtime.connectionId();
    if (payload.sourceConnectionId && connectionId && payload.sourceConnectionId === connectionId) {
      return;
    }
    const key = payload.sourceConnectionId ?? payload.userId ?? null;
    if (!key) {
      return;
    }
    const shouldRemove = !payload.time;
    this.cursorMapSignal.update((current) => {
      const nextStageMap = new Map(current[payload.stageId] ?? []);
      if (shouldRemove) {
        nextStageMap.delete(key);
      } else {
        nextStageMap.set(key, this.enrichCursorPayload(payload));
      }
      return {
        ...current,
        [payload.stageId]: nextStageMap,
      };
    });
  }

  private applySelectionPayload(
    payload: PlanningSelectionSnapshot | PlanningSelectionUpdate | null | undefined,
  ): void {
    if (!payload) {
      return;
    }
    const connectionId = this.realtime.connectionId();
    if (Array.isArray((payload as PlanningSelectionSnapshot).selections)) {
      const snapshot = payload as PlanningSelectionSnapshot;
      const base = new Map<string, SharedSelectionState>();
      const operations = new Map<string, SharedSelectionState>();
      snapshot.selections.forEach((entry) => {
        if (!entry?.stageId) {
          return;
        }
        if (entry.sourceConnectionId && connectionId && entry.sourceConnectionId === connectionId) {
          return;
        }
        const key = entry.sourceConnectionId ?? entry.userId ?? null;
        if (!key) {
          return;
        }
        const map = entry.stageId === 'base' ? base : operations;
        map.set(key, this.enrichSelectionPayload(entry));
      });
      this.selectionMapSignal.set({ base, operations });
      return;
    }
    const update = payload as PlanningSelectionUpdate;
    if (!update.stageId) {
      return;
    }
    if (update.sourceConnectionId && connectionId && update.sourceConnectionId === connectionId) {
      return;
    }
    const key = update.sourceConnectionId ?? update.userId ?? null;
    if (!key) {
      return;
    }
    const shouldRemove = (!update.activityIds || update.activityIds.length === 0) && !update.primaryId;
    this.selectionMapSignal.update((current) => {
      const nextStageMap = new Map(current[update.stageId] ?? []);
      if (shouldRemove) {
        nextStageMap.delete(key);
      } else {
        nextStageMap.set(key, this.enrichSelectionPayload(update));
      }
      return {
        ...current,
        [update.stageId]: nextStageMap,
      };
    });
  }

  private applyEditPayload(
    payload: PlanningEditSnapshot | PlanningEditUpdate | null | undefined,
  ): void {
    if (!payload) {
      return;
    }
    const connectionId = this.realtime.connectionId();
    if (Array.isArray((payload as PlanningEditSnapshot).edits)) {
      const snapshot = payload as PlanningEditSnapshot;
      const base = new Map<string, SharedEditState>();
      const operations = new Map<string, SharedEditState>();
      snapshot.edits.forEach((entry) => {
        if (!entry?.stageId || !entry.activityId) {
          return;
        }
        if (entry.sourceConnectionId && connectionId && entry.sourceConnectionId === connectionId) {
          return;
        }
        const key = entry.sourceConnectionId ?? entry.userId ?? null;
        if (!key) {
          return;
        }
        const map = entry.stageId === 'base' ? base : operations;
        map.set(
          key,
          this.enrichEditPayload({
            stageId: entry.stageId,
            activityId: entry.activityId,
            userId: entry.userId ?? key,
            name: entry.name ?? null,
            color: entry.color ?? null,
            fields: entry.fields ?? {},
            activeField: entry.field ?? null,
            sourceConnectionId: entry.sourceConnectionId ?? null,
            at: entry.at ?? undefined,
          }),
        );
      });
      this.editMapSignal.set({ base, operations });
      return;
    }
    const update = payload as PlanningEditUpdate;
    if (!update.stageId || !update.activityId) {
      return;
    }
    if (update.sourceConnectionId && connectionId && update.sourceConnectionId === connectionId) {
      return;
    }
    const key = update.sourceConnectionId ?? update.userId ?? null;
    if (!key) {
      return;
    }
    this.editMapSignal.update((current) => {
      const nextStageMap = new Map(current[update.stageId] ?? []);
      if (update.state === 'end') {
        nextStageMap.delete(key);
      } else {
        const existing = nextStageMap.get(key);
        const fields = { ...(existing?.fields ?? {}) };
        if (update.fields && Object.keys(update.fields).length > 0) {
          Object.assign(fields, update.fields);
        } else if (update.field) {
          fields[update.field] = update.value ?? null;
        }
        const activeField = update.state === 'blur' ? null : update.field ?? existing?.activeField ?? null;
        nextStageMap.set(
          key,
          this.enrichEditPayload({
            stageId: update.stageId,
            activityId: update.activityId,
            userId: update.userId ?? existing?.userId ?? key,
            name: update.name ?? existing?.name ?? null,
            color: update.color ?? existing?.color ?? null,
            fields,
            activeField,
            sourceConnectionId: update.sourceConnectionId ?? existing?.sourceConnectionId ?? null,
            at: update.at ?? existing?.at ?? undefined,
          }),
        );
      }
      return {
        ...current,
        [update.stageId]: nextStageMap,
      };
    });
  }

  private handleEditFormChange(value: Record<string, unknown>): void {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      this.lastEditFormValue = value;
      return;
    }
    if (!this.activityForm.dirty) {
      this.lastEditFormValue = value;
      return;
    }
    const previous = this.lastEditFormValue ?? {};
    const updates: Array<{ field: string; value: unknown }> = [];
    this.editFieldOrder.forEach((field) => {
      const before = this.normalizeEditValue(previous[field]);
      const after = this.normalizeEditValue(value[field]);
      if (before !== after) {
        updates.push({ field, value: value[field] ?? null });
      }
    });
    if (updates.length === 0) {
      this.lastEditFormValue = value;
      return;
    }
    const stageId = this.activeStageSignal();
    const activityId = selection.activity.id;
    updates.forEach((update) => {
      this.realtime.sendEditUpdate({
        stageId,
        activityId,
        field: update.field,
        value: update.value,
        state: 'change',
      });
    });
    this.lastEditFormValue = value;
  }

  private syncDraftGhost(pending: PendingActivityState | null): void {
    if (!pending?.activity) {
      this.clearDraftGhost();
      return;
    }
    const stageId = pending.stage;
    const activity = pending.activity;
    if (!activity?.id || !activity.start) {
      return;
    }
    const resourceId =
      this.activityOwnerId(activity) ?? activity.participants?.[0]?.resourceId ?? null;
    if (!resourceId) {
      return;
    }
    if (
      this.lastDraftGhostState &&
      (this.lastDraftGhostState.activityId !== activity.id ||
        this.lastDraftGhostState.stageId !== stageId)
    ) {
      this.clearDraftGhost();
    }
    const signature = this.buildDraftSignature(stageId, activity);
    if (signature === this.lastDraftSignature) {
      return;
    }
    const state = this.lastDraftGhostState ? 'move' : 'start';
    this.realtime.sendDragGhost({
      stageId,
      userId: this.identity.userId(),
      activityId: activity.id,
      resourceId,
      start: activity.start,
      end: activity.end ?? null,
      mode: 'create',
      state,
      isValid: true,
      draftActivity: this.buildDraftGhostActivity(activity),
    });
    this.lastDraftGhostState = {
      stageId,
      activityId: activity.id,
      resourceId,
      start: activity.start,
      end: activity.end ?? null,
    };
    this.lastDraftSignature = signature;
  }

  private clearDraftGhost(): void {
    if (!this.lastDraftGhostState) {
      return;
    }
    this.realtime.sendDragGhost({
      stageId: this.lastDraftGhostState.stageId,
      userId: this.identity.userId(),
      activityId: this.lastDraftGhostState.activityId,
      resourceId: this.lastDraftGhostState.resourceId,
      start: this.lastDraftGhostState.start,
      end: this.lastDraftGhostState.end ?? null,
      mode: 'create',
      state: 'end',
      isValid: true,
    });
    this.lastDraftGhostState = null;
    this.lastDraftSignature = null;
  }

  private buildDraftSignature(stageId: PlanningStageId, activity: Activity): string {
    const participants = activity.participants ?? [];
    const participantsKey = participants
      .map((participant) =>
        `${participant.resourceId}|${participant.kind}|${participant.role ?? ''}`,
      )
      .sort()
      .join(';');
    const attrs =
      activity.attributes && typeof activity.attributes === 'object' && !Array.isArray(activity.attributes)
        ? JSON.stringify(activity.attributes)
        : '';
    return [
      stageId,
      activity.id,
      activity.start,
      activity.end ?? '',
      activity.type ?? '',
      activity.title ?? '',
      activity.from ?? '',
      activity.to ?? '',
      activity.remark ?? '',
      activity.serviceId ?? '',
      activity.serviceCategory ?? '',
      activity.serviceRole ?? '',
      activity.locationId ?? '',
      activity.locationLabel ?? '',
      participantsKey,
      attrs,
    ].join('|');
  }

  private buildDraftGhostActivity(activity: Activity): Activity {
    return this.stripGhostAttributes(activity);
  }

  private stripGhostAttributes(activity: Activity): Activity {
    const attrs = activity.attributes;
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
      return activity;
    }
    const next = { ...(attrs as Record<string, unknown>) };
    delete next['ghost'];
    Object.keys(next).forEach((key) => {
      if (key.startsWith('ghost_') || key.startsWith('draft_')) {
        delete next[key];
      }
    });
    if (Object.keys(next).length === 0) {
      return { ...activity, attributes: undefined };
    }
    return { ...activity, attributes: next };
  }

  private readFormFieldValue(field: string): unknown {
    const control = this.activityForm.get(field);
    return control ? control.value : null;
  }

  private enrichGhostPayload(payload: PlanningDragGhostEvent): PlanningDragGhostEvent {
    if (payload.name && payload.color) {
      return payload;
    }
    const presence = this.presenceMapSignal().get(payload.userId);
    if (!presence) {
      return payload;
    }
    return {
      ...payload,
      name: payload.name ?? presence.name ?? null,
      color: payload.color ?? presence.color ?? null,
    };
  }

  private enrichLockPayload(payload: PlanningLockUpdate): PlanningLockUpdate {
    if (payload.name && payload.color) {
      return payload;
    }
    const presence = this.presenceMapSignal().get(payload.userId);
    if (!presence) {
      return payload;
    }
    return {
      ...payload,
      name: payload.name ?? presence.name ?? null,
      color: payload.color ?? presence.color ?? null,
    };
  }

  private enrichCursorPayload(payload: PlanningCursorUpdate): PlanningCursorUpdate {
    if (payload.name && payload.color) {
      return payload;
    }
    const presence = this.presenceMapSignal().get(payload.userId);
    if (!presence) {
      return payload;
    }
    return {
      ...payload,
      name: payload.name ?? presence.name ?? null,
      color: payload.color ?? presence.color ?? null,
    };
  }

  private enrichSelectionPayload(payload: PlanningSelectionUpdate): SharedSelectionState {
    const presence = payload.userId ? this.presenceMapSignal().get(payload.userId) : null;
    return {
      stageId: payload.stageId,
      activityIds: Array.isArray(payload.activityIds) ? payload.activityIds : [],
      primaryId: payload.primaryId ?? null,
      userId: payload.userId ?? presence?.userId ?? 'unknown',
      name: payload.name ?? presence?.name ?? null,
      color: payload.color ?? presence?.color ?? null,
      mode: payload.mode ?? 'select',
      sourceConnectionId: payload.sourceConnectionId ?? null,
      at: payload.at ?? undefined,
    };
  }

  private enrichEditPayload(payload: SharedEditState): SharedEditState {
    if (payload.name && payload.color) {
      return payload;
    }
    const presence = this.presenceMapSignal().get(payload.userId);
    if (!presence) {
      return payload;
    }
    return {
      ...payload,
      name: payload.name ?? presence.name ?? null,
      color: payload.color ?? presence.color ?? null,
    };
  }

  private normalizeEditValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toString() : '';
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private buildSharedActivitySelections(stage: PlanningStageId): Map<string, ActivitySelectionInfo> {
    const selections = this.selectionMapSignal()[stage];
    const edits = this.editMapSignal()[stage];
    if ((!selections || selections.size === 0) && (!edits || edits.size === 0)) {
      return new Map();
    }
    const aggregate = new Map<
      string,
      {
        label: string;
        color: string | null;
        isEditing: boolean;
        count: number;
        primaryLabel: string;
        primaryColor: string | null;
      }
    >();

    const addEntry = (activityId: string, label: string, color: string | null, isEditing: boolean) => {
      const safeLabel = label.trim().length ? label.trim() : 'Nutzer';
      const existing = aggregate.get(activityId);
      if (!existing) {
        aggregate.set(activityId, {
          label: safeLabel,
          color,
          isEditing,
          count: 1,
          primaryLabel: safeLabel,
          primaryColor: color,
        });
        return;
      }
      existing.count += 1;
      if (isEditing && !existing.isEditing) {
        existing.isEditing = true;
        existing.primaryLabel = safeLabel;
        existing.primaryColor = color;
      }
      existing.label =
        existing.count > 1 ? `${existing.primaryLabel} +${existing.count - 1}` : existing.primaryLabel;
      existing.color = existing.primaryColor;
      aggregate.set(activityId, existing);
    };

    selections?.forEach((entry) => {
      const ids = Array.isArray(entry.activityIds) ? entry.activityIds : [];
      const primaryId = entry.primaryId ?? null;
      const label = entry.name ?? entry.userId ?? 'Nutzer';
      const color = entry.color ?? null;
      const mode = entry.mode ?? 'select';
      const activityIds = ids.length ? [...ids] : [];
      if (primaryId && !activityIds.includes(primaryId)) {
        activityIds.push(primaryId);
      }
      activityIds.forEach((id) => {
        if (!id) {
          return;
        }
        const isEditing = mode === 'edit' && primaryId === id;
        addEntry(id, label, color, isEditing);
      });
    });

    edits?.forEach((entry) => {
      if (!entry.activityId) {
        return;
      }
      const label = entry.name ?? entry.userId ?? 'Bearbeitung';
      addEntry(entry.activityId, label, entry.color ?? null, true);
    });

    const result = new Map<string, ActivitySelectionInfo>();
    aggregate.forEach((entry, activityId) => {
      result.set(activityId, {
        label: entry.label,
        color: entry.color ?? null,
        isEditing: entry.isEditing,
      });
    });
    return result;
  }

  private buildRemoteCursors(stage: PlanningStageId): GanttRemoteCursor[] {
    const cursors = this.cursorMapSignal()[stage];
    if (!cursors || cursors.size === 0) {
      return [];
    }
    const list: GanttRemoteCursor[] = [];
    cursors.forEach((cursor, key) => {
      if (!cursor?.time) {
        return;
      }
      const time = new Date(cursor.time);
      if (!Number.isFinite(time.getTime())) {
        return;
      }
      const label = (cursor.name ?? cursor.userId ?? '').trim();
      list.push({
        id: key,
        time,
        label: label.length ? label : undefined,
        color: cursor.color ?? null,
        resourceId: cursor.resourceId ?? null,
      });
    });
    return list.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));
  }

  private buildRemoteEditorsForSelected(): Array<{
    key: string;
    label: string;
    color: string | null;
    activeFieldLabel: string | null;
    fields: Array<{ key: string; label: string; value: string }>;
  }> {
    const selection = this.activitySelection.selectedActivityState();
    if (!selection) {
      return [];
    }
    const edits = this.editMapSignal()[this.activeStageSignal()];
    if (!edits || edits.size === 0) {
      return [];
    }
    const activityId = selection.activity.id;
    const entries: Array<{
      key: string;
      label: string;
      color: string | null;
      activeFieldLabel: string | null;
      fields: Array<{ key: string; label: string; value: string }>;
    }> = [];
    edits.forEach((entry, key) => {
      if (entry.activityId !== activityId) {
        return;
      }
      const label = (entry.name ?? entry.userId ?? 'Nutzer').trim();
      entries.push({
        key,
        label: label.length ? label : 'Nutzer',
        color: entry.color ?? null,
        activeFieldLabel: entry.activeField ? this.formatEditFieldLabel(entry.activeField) : null,
        fields: this.formatEditFields(entry.fields ?? {}),
      });
    });
    return entries.sort((a, b) => a.label.localeCompare(b.label));
  }

  private formatEditFields(fields: Record<string, unknown>): Array<{ key: string; label: string; value: string }> {
    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return [];
    }
    const ordered = [
      ...this.editFieldOrder.filter((field) => keys.includes(field)),
      ...keys.filter((field) => !this.editFieldOrder.includes(field)),
    ];
    return ordered.map((field) => ({
      key: field,
      label: this.formatEditFieldLabel(field),
      value: this.formatEditFieldValue(field, fields[field]),
    }));
  }

  private formatEditFieldLabel(field: string): string {
    return this.editFieldLabels[field] ?? field;
  }

  private formatEditFieldValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    if (field === 'durationMinutes') {
      const num = typeof value === 'number' ? value : Number.parseFloat(String(value));
      if (Number.isFinite(num)) {
        return `${num} min`;
      }
    }
    if (field === 'start' || field === 'end') {
      if (typeof value === 'string') {
        const parsed = fromLocalDateTime(value);
        if (parsed && Number.isFinite(parsed.getTime())) {
          return this.selectionTimeFormatter.format(parsed);
        }
      }
      if (value instanceof Date && Number.isFinite(value.getTime())) {
        return this.selectionTimeFormatter.format(value);
      }
    }
    if (typeof value === 'string') {
      return value.trim().length ? value.trim() : '—';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toString() : '—';
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private buildGhostActivities(stage: PlanningStageId): Activity[] {
    const ghostMap = this.ghostMapSignal()[stage];
    if (!ghostMap || ghostMap.size === 0) {
      return [];
    }
    const resources = this.stageResourceSignals[stage]();
    if (resources.length === 0) {
      return [];
    }
    const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
    const result: Activity[] = [];
    ghostMap.forEach((ghost, key) => {
      if (!ghost?.start || !ghost.activityId || ghost.state === 'end' || ghost.isValid === false) {
        return;
      }
      const draft = ghost.draftActivity ?? null;
      const ownerId =
        ghost.resourceId ?? (draft ? this.activityOwnerId(draft) : null) ?? null;
      const resource = ownerId ? resourceMap.get(ownerId) : null;
      if (!resource) {
        return;
      }
      const label = `${draft?.title ?? ghost.name ?? ghost.userId ?? 'Bearbeitung'}`.trim();
      const isDraft = ghost.mode === 'create';
      const ghostId = isDraft ? ghost.activityId : `ghost:${ghost.activityId}:${key}`;
      const participants =
        draft?.participants && draft.participants.length
          ? draft.participants
          : [{ resourceId: resource.id, kind: resource.kind }];
      const draftAttributes =
        draft?.attributes && typeof draft.attributes === 'object' && !Array.isArray(draft.attributes)
          ? draft.attributes
          : null;
      result.push({
        ...(draft ?? {}),
        id: ghostId,
        title: label.length ? label : 'Bearbeitung',
        start: draft?.start ?? ghost.start,
        end: draft?.end ?? ghost.end ?? null,
        participants,
        attributes: {
          ...(draftAttributes ?? {}),
          ghost: true,
          ghost_user: ghost.userId,
          ghost_name: ghost.name ?? null,
          ghost_color: ghost.color ?? null,
          ghost_activity_id: ghost.activityId,
          ghost_key: key,
          ghost_mode: ghost.mode ?? null,
        },
      });
    });
    return result;
  }

  private isGhostDraftActivity(activity: Activity): boolean {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    if (!attrs || attrs['ghost'] !== true) {
      return false;
    }
    const mode = typeof attrs['ghost_mode'] === 'string' ? attrs['ghost_mode'] : null;
    return mode === 'create';
  }

  private handleGhostDraftEdit(event: { resource: Resource; activity: Activity }): void {
    const stage = this.activeStageSignal();
    const entry = this.resolveGhostEntry(stage, event.activity);
    if (!entry || entry.mode !== 'create') {
      return;
    }
    const draft = entry.draftActivity ?? event.activity;
    const cleaned = this.stripGhostAttributes(draft);
    const resourceId = entry.resourceId ?? this.activityOwnerId(cleaned) ?? event.resource.id;
    const resource =
      this.stageResourceSignals[stage]().find((item) => item.id === resourceId) ?? event.resource;
    this.confirmDiscardActivityEdits(() => {
      this.pendingActivityOriginal.set(cleaned);
      this.pendingFacade.startPendingActivity(stage, resource, cleaned);
    });
  }

  private resolveGhostEntry(
    stage: PlanningStageId,
    activity: Activity,
  ): PlanningDragGhostEvent | null {
    const ghostMap = this.ghostMapSignal()[stage];
    if (!ghostMap || ghostMap.size === 0) {
      return null;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const ghostKey = typeof attrs?.['ghost_key'] === 'string' ? attrs['ghost_key'] : null;
    const ghostActivityId =
      typeof attrs?.['ghost_activity_id'] === 'string' ? attrs['ghost_activity_id'] : null;
    if (ghostKey && ghostMap.has(ghostKey)) {
      const entry = ghostMap.get(ghostKey) ?? null;
      if (!entry) {
        return null;
      }
      if (!ghostActivityId || entry.activityId === ghostActivityId) {
        return entry;
      }
    }
    if (ghostActivityId) {
      for (const entry of ghostMap.values()) {
        if (entry.activityId === ghostActivityId) {
          return entry;
        }
      }
    }
    return null;
  }

  private buildActivityLocks(stage: PlanningStageId): Map<string, ActivityLockInfo> {
    const locks = this.lockMapSignal()[stage];
    if (!locks || locks.size === 0) {
      return new Map();
    }
    const map = new Map<string, ActivityLockInfo>();
    locks.forEach((lock, activityId) => {
      if (!lock || lock.state !== 'locked') {
        return;
      }
      const label = (lock.name ?? lock.userId ?? '').trim();
      if (!label) {
        return;
      }
      map.set(activityId, {
        label,
        color: lock.color ?? null,
      });
    });
    return map;
  }

  private normalizeActivityList(list: Activity[]): Activity[] {
    return normalizeActivityList(list, {
      catalogMap: () => this.activityCatalogOptionMap(),
      catalogTypeMap: () => this.activityCatalogOptionTypeMap(),
    });
  }

  private applyActivityTypeConstraints(activity: Activity): Activity {
    return applyActivityTypeConstraintsUtil(activity, {
      byId: () => this.activityCatalogOptionMap(),
      byType: () => this.activityCatalogOptionTypeMap(),
    });
  }

  private filterLocationOptions(
    query: string,
    groupSet: LocationOptionGroupSet,
    limits: { groupLimit: number; orphanLimit: number },
  ): LocationAutocompleteOption[] {
    if (!groupSet.groups.length && !groupSet.orphans.length) {
      return [];
    }
    const tokens = (query ?? '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const matchesTokens = (option: LocationAutocompleteOption) =>
      tokens.every((token) => option.search.includes(token));
    const result: LocationAutocompleteOption[] = [];
    let groupCount = 0;

    for (const group of groupSet.groups) {
      const shouldInclude =
        tokens.length === 0 ||
        matchesTokens(group.op) ||
        group.sites.some((site) => matchesTokens(site));
      if (!shouldInclude) {
        continue;
      }
      result.push(group.op, ...group.sites);
      groupCount += 1;
      if (groupCount >= limits.groupLimit) {
        break;
      }
    }

    const orphanCandidates =
      tokens.length === 0 ? groupSet.orphans : groupSet.orphans.filter((site) => matchesTokens(site));
    if (limits.orphanLimit > 0 && orphanCandidates.length) {
      result.push(...orphanCandidates.slice(0, limits.orphanLimit));
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

  private setOptimizerLoading(key: 'candidates' | 'solve', value: boolean): void {
    this.optimizerLoadingSignal.update((state) => ({ ...state, [key]: value }));
  }

  private handleOptimizerError(label: string, error: unknown): void {
    console.warn(`[PlanningDashboard] ${label} fehlgeschlagen`, error);
  }

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
    mode: 'candidates' | 'solver',
    payload: PlanningCandidateBuildResponseDto | PlanningSolverResponseDto,
    title: string,
  ): void {
    this.dialog.open(PlanningOptimizerDialogComponent, {
      data: { title, mode, payload },
      width: '720px',
    });
  }

  private resolveCatalogOptionForActivity(activity: Activity): ActivityCatalogOption | null {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const activityKey = typeof attrs?.['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
    if (activityKey) {
      return this.activityCatalogOptionMap().get(activityKey) ?? null;
    }
    const typeId = (activity.type ?? '').trim();
    if (!typeId) {
      return null;
    }
    return this.activityCatalogOptionTypeMap().get(typeId) ?? null;
  }

  private buildLocationDefinitionForActivity(activity: Activity): ActivityLocationDefinition | null {
    return this.resolveCatalogOptionForActivity(activity);
  }

  private buildLocationDefinitionForOption(
    option: ActivityCatalogOption | null,
  ): ActivityLocationDefinition | null {
    return option ?? null;
  }

  protected createBoardFromSelection(): void {
    this.boardActionsFacade.createBoardFromSelection();
  }

  protected openOptimizerCandidates(): void {
    if (this.optimizerLoadingSignal().candidates) {
      return;
    }
    const stage = this.activeStageSignal();
    const activityIds = this.solverActivityIds();
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
    const activityIds = this.solverActivityIds();
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

  protected openSolverDrawer(): void {
    this.debugDrawerOpenSignal.set(false);
    this.solverDrawerOpenSignal.set(true);
  }

  protected closeSolverDrawer(): void {
    this.solverDrawerOpenSignal.set(false);
  }

  protected toggleDebugDrawer(): void {
    const next = !this.debugDrawerOpenSignal();
    this.debugDrawerOpenSignal.set(next);
    if (next) {
      this.solverDrawerOpenSignal.set(false);
    }
  }

  protected closeDebugDrawer(): void {
    this.debugDrawerOpenSignal.set(false);
  }

  protected setDebugShowAll(value: boolean): void {
    this.debugShowAllSignal.set(value);
  }

  protected setDebugBackendStreamEnabled(value: boolean): void {
    this.debugBackendStreamEnabledSignal.set(value);
  }

  protected setDebugPaused(value: boolean): void {
    if (value) {
      this.debug.pause();
    } else {
      this.debug.resume();
    }
  }

  protected setDebugFilterQuery(value: string): void {
    this.debugFilterQuerySignal.set(value);
  }

  protected toggleDebugScopeFilter(scope: PlanningDebugLogScope): void {
    this.debugScopeFilterSignal.update((current) => this.toggleFilterValue(current, scope));
  }

  protected toggleDebugSourceFilter(source: PlanningDebugLogSource): void {
    this.debugSourceFilterSignal.update((current) => this.toggleFilterValue(current, source));
  }

  protected toggleDebugTopicFilter(topic: string): void {
    this.debugTopicFilterSignal.update((current) => this.toggleFilterValue(current, topic));
  }

  protected clearDebugFilters(): void {
    this.debugFilterQuerySignal.set('');
    this.debugScopeFilterSignal.set([]);
    this.debugSourceFilterSignal.set([]);
    this.debugTopicFilterSignal.set([]);
  }

  protected setDebugStreamToken(value: string): void {
    this.debugStreamTokenSignal.set(value);
    this.persistDebugStreamToken(value);
  }

  protected clearDebugLogs(): void {
    this.debug.clear();
  }

  protected toggleDebugExport(): void {
    this.debugExportOpenSignal.update((current) => !current);
  }

  protected copyDebugExport(): void {
    const payload = this.debugExportJson();
    if (!payload) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    navigator.clipboard.writeText(payload).catch(() => undefined);
  }

  protected formatDebugTimestamp(value?: string | null): string {
    if (!value) {
      return '-';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return this.debugTimestampFormatter.format(parsed);
  }

  protected formatApiStatusLabel(status: { state: 'idle' | 'ok' | 'error'; message?: string }): string {
    if (status.state === 'ok') {
      return 'Verbunden';
    }
    if (status.state === 'error') {
      return 'Fehler';
    }
    return 'Warte';
  }

  protected formatSseStatusLabel(status: {
    state: 'idle' | 'connected' | 'error' | 'disabled';
    message?: string;
  }): string {
    if (status.state === 'disabled') {
      return status.message?.trim().length ? status.message.trim() : 'Nicht genutzt';
    }
    if (status.state === 'connected') {
      return status.message?.trim().length ? status.message.trim() : 'Verbunden';
    }
    if (status.state === 'error') {
      return 'Fehler';
    }
    return 'Warte';
  }

  protected formatPresenceLabel(users: PlanningPresenceUser[]): string {
    if (!users.length) {
      return '—';
    }
    const entries = [...users].sort((a, b) => (a.name ?? a.userId).localeCompare(b.name ?? b.userId));
    return entries
      .map((user) => {
        const label = user.name?.trim().length ? user.name.trim() : user.userId;
        const count = user.tabCount > 1 ? ` (${user.tabCount})` : '';
        return `${label}${count}`;
      })
      .join(', ');
  }

  protected formatDebugContext(context?: Record<string, unknown>): string | null {
    if (!context || Object.keys(context).length === 0) {
      return null;
    }
    try {
      const serialized = JSON.stringify(context, null, 2);
      const limit = 4000;
      if (serialized.length <= limit) {
        return serialized;
      }
      return `${serialized.slice(0, limit)}\n... (truncated)`;
    } catch {
      return null;
    }
  }

  private toggleFilterValue(values: string[], value: string): string[] {
    if (values.includes(value)) {
      return values.filter((entry) => entry !== value);
    }
    return [...values, value];
  }

  private buildDebugExportPayload(): Record<string, unknown> {
    return {
      exportedAt: new Date().toISOString(),
      stageId: this.activeStageSignal(),
      apiBaseUrl: this.apiConfig.baseUrl,
      userId: this.identity.userId(),
      connectionId: this.identity.connectionId(),
      filters: {
        showAll: this.debugShowAllSignal(),
        query: this.debugFilterQuerySignal(),
        scopes: this.debugScopeFilterSignal(),
        sources: this.debugSourceFilterSignal(),
        topics: this.debugTopicFilterSignal(),
        paused: this.debug.paused(),
        pendingCount: this.debug.pendingCount(),
      },
      stream: {
        enabled: this.debugBackendStreamEnabledSignal(),
        tokenProvided: this.debugStreamTokenSignal().trim().length > 0,
      },
      status: {
        api: this.debug.apiStatus(),
        sse: this.debug.sseStatus(),
        backendStream: this.debug.backendStreamStatus(),
        viewport: this.debug.viewportStatus(),
      },
      entries: this.debug.exportEntries({ includePending: true }),
    };
  }

  private loadDebugStreamToken(): string {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      return window.localStorage.getItem(this.debugStreamTokenStorageKey) ?? '';
    } catch {
      return '';
    }
  }

  private persistDebugStreamToken(value: string): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const storage = window.localStorage;
      if (!value.trim()) {
        storage.removeItem(this.debugStreamTokenStorageKey);
        return;
      }
      storage.setItem(this.debugStreamTokenStorageKey, value);
    } catch {
      // ignore storage errors
    }
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
      this.solverDrawerOpenSignal.set(false);
      return;
    }
    this.data.applyActivityMutation(stage, payload.upserts ?? [], payload.deletedIds ?? []);
    this.clearSolverPreview(stage);
    this.solverDrawerOpenSignal.set(false);
  }

  protected discardSolverPreview(): void {
    this.clearSolverPreview(this.activeStageSignal());
    this.solverDrawerOpenSignal.set(false);
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
    if (source === 'manual') {
      this.solverDrawerOpenSignal.set(true);
    }
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

  private formatSelectionTimestamp(value?: string | null): string {
    if (!value) {
      return '–';
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return value;
    }
    return this.selectionTimeFormatter.format(date);
  }

  private formatOptionalValue(value?: string | null): string {
    const trimmed = (value ?? '').toString().trim();
    return trimmed.length ? trimmed : '–';
  }

  private activityServiceLabel(activity: Activity): string {
    const serviceId = (activity.serviceId ?? '').toString().trim();
    return serviceId.length ? serviceId : '–';
  }

  protected formatSolverTimestamp(value?: Date | null): string {
    if (!value) {
      return '';
    }
    return this.solverTimestampFormatter.format(value);
  }

  private syncSolverResourceSelection(options: Resource[]): void {
    const optionIds = new Set(options.map((resource) => resource.id));
    const current = this.solverResourceSelectionSignal();
    let next = new Set<string>();
    if (optionIds.size === 0) {
      next = new Set();
    } else if (current.size === 0) {
      next = new Set(optionIds);
    } else {
      current.forEach((id) => {
        if (optionIds.has(id)) {
          next.add(id);
        }
      });
      optionIds.forEach((id) => {
        if (!this.lastSolverResourceOptions.has(id)) {
          next.add(id);
        }
      });
    }
    if (!this.setsEqual(current, next)) {
      this.solverResourceSelectionSignal.set(next);
    }
    this.lastSolverResourceOptions = optionIds;
  }

  private setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
    if (a.size !== b.size) {
      return false;
    }
    for (const value of a) {
      if (!b.has(value)) {
        return false;
      }
    }
    return true;
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

  protected handleViewportChange(board: PlanningBoard, range: PlanningTimelineRange): void {
    if (!this.isActiveBoard(board.id)) {
      return;
    }
    this.lastViewportByBoard.set(board.id, range);
    if (board.resourceIds.length === 0) {
      return;
    }
    this.data.setStageViewport(this.activeStageSignal(), range, board.resourceIds);
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
