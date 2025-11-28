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
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import {
  ActivityLinkRole,
  ActivityLinkRoleDialogComponent,
  ActivityLinkRoleDialogResult,
} from './activity-link-role-dialog.component';
import { TemplateTimelineStoreService } from './template-timeline-store.service';

interface PlanningBoard {
  id: string;
  title: string;
  resourceIds: string[];
  createdAt: number;
}

interface StageResourceGroupConfig {
  category: PlanningResourceCategory;
  label: string;
  description: string;
  icon: string;
}

interface ResourceGroupView extends StageResourceGroupConfig {
  resources: Resource[];
}

interface StageRuntimeState {
  boards: PlanningBoard[];
  selectedResourceIds: Set<string>;
  activeBoardId: string;
}

interface PendingActivityState {
  stage: PlanningStageId;
  activity: Activity;
}

interface ActivityCatalogOption {
  id: string; // activity key
  label: string;
  description?: string;
  defaultDurationMinutes: number | null;
  attributes: ActivityCatalogAttribute[];
  templateId: string | null;
  activityTypeId: string;
  typeDefinition: ActivityTypeDefinition;
  relevantFor?: ResourceKind[];
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

  private readonly stageTimelineSignals = {
    base: computed(() => this.computeBaseTimelineRange()),
    operations: this.data.stageTimelineRange('operations'),
  } as const;

  private readonly stageStateSignal = signal<Record<PlanningStageId, StageRuntimeState>>({
    base: this.createEmptyStageState(),
    operations: this.createEmptyStageState(),
  });

  private readonly activeStageSignal = signal<PlanningStageId>('base');

  private readonly boardCounters: Record<PlanningStageId, number> = {
    base: 1,
    operations: 1,
  };

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
  private readonly selectedActivityIdsSignal = signal<Set<string>>(new Set());
  private readonly activityMoveTargetSignal = signal<string>('');
  private readonly selectedActivityState = signal<{ activity: Activity; resource: Resource } | null>(null);
  private readonly selectedActivitySlotSignal = signal<{ activityId: string; resourceId: string } | null>(null);
  private readonly pendingServiceResourceSignal = signal<Resource | null>(null);
  private readonly serviceAssignmentTargetSignal = signal<string | null>(null);
  private readonly stageYearSelectionState = signal<Record<PlanningStageId, Set<string>>>(
    this.createEmptyYearSelection(),
  );
  private readonly pendingActivitySignal = signal<PendingActivityState | null>(null);
  private readonly pendingActivityOriginal = signal<Activity | null>(null);
  private readonly typePickerOpenSignal = signal(false);
  private readonly activityDetailsOpenSignal = signal(true);
  private readonly dialog = inject(MatDialog);
  private readonly activityEditPreviewSignal = signal<ActivityEditPreviewState | null>(null);
  protected readonly selectedTemplateId = computed(() => this.templateStore.selectedTemplateWithFallback()?.id ?? null);

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
    this.setActiveStage(initialStage, false);
    if (this.route.snapshot.queryParamMap.get('stage') !== initialStage) {
      this.updateStageQueryParam(initialStage);
    }

    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        const stage = this.normalizeStageId(params.get('stage'));
        this.setActiveStage(stage, false);
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
          const resources = this.stageResourceSignals[stage]();
          this.ensureStageInitialized(stage, resources);
        },
        { allowSignalWrites: true },
      );

      const snapshot = this.stageResourceSignals[stage]();
      if (snapshot.length > 0) {
        this.ensureStageInitialized(stage, snapshot);
      }
    });

    effect(
      () => {
        const pending = this.pendingActivitySignal();
        const activeStage = this.activeStageSignal();
        if (pending && pending.stage !== activeStage) {
          if (this.selectedActivityState()?.activity.id === pending.activity.id) {
            this.selectedActivityState.set(null);
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
        const selection = this.selectedActivityState();
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
          start: this.toLocalDateTime(selection.activity.start),
          end: selection.activity.end ? this.toLocalDateTime(selection.activity.end) : '',
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
        const selection = this.selectedActivityState();
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
        const selection = this.selectedActivityState();
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
        const currentSelection = this.selectedActivityIdsSignal();
        if (currentSelection.size === 0) {
        return;
        }
        const filtered = Array.from(currentSelection).filter((id) => validIds.has(id));
        if (filtered.length !== currentSelection.size) {
          this.selectedActivityIdsSignal.set(new Set(filtered));
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
        this.stageOrder.forEach((stage) => this.ensureStageYearSelection(stage, options));
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
    this.filterResourcesForStage(
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

  protected readonly timetableYearOptions = computed<TimetableYearBounds[]>(() => {
    const managed = this.managedTimetableYearBounds();
    if (managed.length) {
      return managed;
    }
    return [this.timetableYearService.defaultYearBounds()];
  });

  protected readonly timetableYearSummary = computed(() =>
    this.formatTimetableYearSummary(this.activeStageSignal()),
  );
  protected readonly basePlanningYearRange = computed(() =>
    this.computeStageYearRange('base'),
  );

  protected readonly boards = computed(
    () => this.stageStateSignal()[this.activeStageSignal()].boards,
  );
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
    const selection = this.selectedActivityState();
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
  protected readonly resourceError = this.data.resourceError;
  protected readonly timelineError = this.data.timelineError.bind(this.data);
  protected readonly templateError = this.templateStore.error;

  protected readonly selectedActivity = computed(() => this.selectedActivityState());
  protected readonly selectedActivities = computed(() => this.computeSelectedActivities());
  protected readonly selectedActivityIdsArray = computed(() => Array.from(this.selectedActivityIdsSignal()));
  protected readonly selectedActivitySlot = computed(() => this.selectedActivitySlotSignal());
  protected readonly moveTargetOptions = computed(() => this.computeMoveTargetOptions());
  protected readonly activityMoveTarget = computed(() => this.activityMoveTargetSignal());

  protected readonly selectedActivityDefinition = computed<ActivityTypeDefinition | null>(() => {
    const selection = this.selectedActivityState();
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
    () => this.stageStateSignal()[this.activeStageSignal()].selectedResourceIds.size,
  );

  protected readonly hasSelection = computed(() => this.selectionSize() > 0);

  protected readonly selectedResourceIds = computed(() =>
    this.normalizeResourceIds(
      Array.from(this.stageStateSignal()[this.activeStageSignal()].selectedResourceIds),
      this.activeStageSignal(),
    ),
  );

  protected readonly pendingActivity = computed<Activity | null>(() =>
    this.pendingActivityForStage(this.activeStageSignal()),
  );
  protected readonly isTypePickerOpen = computed(() => this.typePickerOpenSignal());
  protected readonly activityDetailsOpen = computed(() => this.activityDetailsOpenSignal());

  protected readonly isSelectedActivityPending = computed(() => {
    const selection = this.selectedActivityState();
    if (!selection) {
      return false;
    }
    return this.isPendingSelection(selection.activity.id);
  });

  protected readonly selectedBoardIndex = computed(() => {
    const stage = this.activeStageSignal();
    const state = this.stageStateSignal()[stage];
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
    if (!templateId || typeof window === 'undefined') {
      return;
    }
    const urlTree = this.router.createUrlTree(['/planning/periods'], {
      queryParams: { template: templateId },
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
    return this.stageStateSignal()[this.activeStageSignal()].selectedResourceIds.has(resourceId);
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
    const selection = this.selectedActivityState();
    const stage = this.activeStageSignal();
    if (!pendingState || !original || !selection) {
      return;
    }
    if (pendingState.stage !== stage || pendingState.activity.id !== original.id) {
      return;
    }

    this.pendingActivitySignal.set({ stage: pendingState.stage, activity: original });
    this.selectedActivityState.set({ activity: original, resource: selection.resource });

    this.activityForm.setValue({
      start: this.toLocalDateTime(original.start),
      end: original.end ? this.toLocalDateTime(original.end) : '',
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
    const start = this.fromLocalDateTime(value.start);
    if (!start) {
      return;
    }
    const baseEnd = value.end ? this.fromLocalDateTime(value.end) : new Date(start);
    if (!baseEnd) {
      return;
    }
    const nextEndMs = baseEnd.getTime() + deltaMinutes * 60 * 1000;
    const minEndMs = start.getTime() + 60 * 1000;
    const safeEnd = new Date(Math.max(nextEndMs, minEndMs));
    const nextEndLocal = this.toLocalDateTime(safeEnd.toISOString());
    this.activityForm.controls.end.setValue(nextEndLocal);
    this.activityForm.controls.end.markAsDirty();
  }

  protected shiftFormBy(deltaMinutes: number): void {
    const value = this.activityForm.getRawValue();
    if (!value.start) {
      return;
    }
    const start = this.fromLocalDateTime(value.start);
    if (!start) {
      return;
    }
    const end = value.end ? this.fromLocalDateTime(value.end) : null;
    const deltaMs = deltaMinutes * 60 * 1000;
    const nextStart = new Date(start.getTime() + deltaMs);
    this.activityForm.controls.start.setValue(this.toLocalDateTime(nextStart.toISOString()));
    this.activityForm.controls.start.markAsDirty();
    if (end) {
      const nextEnd = new Date(end.getTime() + deltaMs);
      this.activityForm.controls.end.setValue(this.toLocalDateTime(nextEnd.toISOString()));
      this.activityForm.controls.end.markAsDirty();
    }
  }

  private updatePendingActivityFromForm(): void {
    const selection = this.selectedActivityState();
    const pendingState = this.pendingActivitySignal();
    const stage = this.activeStageSignal();
    if (!selection || !pendingState) {
      return;
    }
    if (pendingState.stage !== stage || pendingState.activity.id !== selection.activity.id) {
      return;
    }

    const normalized = this.buildActivityFromForm(selection);
    if (!normalized) {
      return;
    }
    if (this.areActivitiesEquivalent(pendingState.activity, normalized)) {
      return;
    }
    this.commitPendingActivityUpdate(normalized);
  }

  private updateEditingPreviewFromForm(): void {
    const selection = this.selectedActivityState();
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
    const mappedDraft = stage === 'base' ? this.mapActivityToReferenceWeek(draft) : draft;
    const normalized = this.applyActivityTypeConstraints(mappedDraft);
    this.pendingActivityOriginal.set(normalized);
    this.startPendingActivity(stage, event.resource, normalized);
  }

  protected handleActivityEdit(event: { resource: Resource; activity: Activity }): void {
    if (!this.isPendingSelection(event.activity.id)) {
      this.pendingActivitySignal.set(null);
    }
    this.selectedActivityState.set({
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
    if (event.selectionMode === 'set') {
      const current = this.selectedActivityIdsSignal();
      if (current.size === 1 && current.has(event.activity.id)) {
        this.selectedActivityIdsSignal.set(new Set());
        this.selectedActivitySlotSignal.set(null);
      } else {
        this.selectedActivityIdsSignal.set(new Set([event.activity.id]));
        this.selectedActivitySlotSignal.set({ activityId: event.activity.id, resourceId: event.resource.id });
      }
      return;
    }
    this.selectedActivityIdsSignal.update((set) => {
      const next = new Set(set);
      if (next.has(event.activity.id)) {
        next.delete(event.activity.id);
        const slot = this.selectedActivitySlotSignal();
        if (slot && slot.activityId === event.activity.id) {
          this.selectedActivitySlotSignal.set(null);
        }
      } else {
        next.add(event.activity.id);
        this.selectedActivitySlotSignal.set({ activityId: event.activity.id, resourceId: event.resource.id });
      }
      return next;
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
      event.participantCategory ?? this.resourceParticipantCategory(targetResource);
    const applyUpdate = (activity: Activity): Activity => {
      const updatedBase: Activity = {
        ...activity,
        start: event.start.toISOString(),
        end: event.end ? event.end.toISOString() : null,
      };
      if (!isOwnerSlot && participantResourceId) {
        return this.moveParticipantToResource(updatedBase, participantResourceId, targetResource);
      }
      return this.addParticipantToActivity(updatedBase, targetResource, undefined, undefined, {
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
    const activeSelection = this.selectedActivityState();
    if (activeSelection?.activity.id === event.activity.id) {
      const resource = targetResource;
      const updatedSelectionActivity = this.applyActivityTypeConstraints(
        !isOwnerSlot && participantResourceId
          ? this.moveParticipantToResource(
              {
                ...activeSelection.activity,
                start: event.start.toISOString(),
                end: event.end ? event.end.toISOString() : null,
              },
              participantResourceId,
              targetResource,
            )
          : this.addParticipantToActivity(
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
      this.selectedActivityState.set({
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
    const sourceRole = this.mapLinkRoleToParticipantRole(roles.sourceRole);
    const targetRole = this.mapLinkRoleToParticipantRole(roles.targetRole);

    this.updateStageActivities(stage, (activities) =>
      activities.map((activity) => {
        if (activity.id !== source.id) {
          return activity;
        }
        const withParticipant = this.addParticipantToActivity(
          activity,
          sourceResource,
          targetResource,
          targetRole,
          { retainPreviousOwner: true },
        );
        const withRoles = this.applyParticipantRoleUpdates(withParticipant, [
          { resourceId: sourceResource.id, role: sourceRole },
          { resourceId: targetResource.id, role: targetRole },
        ]);
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
    const sourceRole = this.mapLinkRoleToParticipantRole(roles.sourceRole);
    const targetRole = this.mapLinkRoleToParticipantRole(roles.targetRole);
    const updated = this.applyParticipantRoleUpdates(
      this.addParticipantToActivity(
        source,
        sourceResource,
        targetResource,
        targetRole,
        { retainPreviousOwner: true },
      ),
      [
        { resourceId: sourceResource.id, role: sourceRole },
        { resourceId: targetResource.id, role: targetRole },
      ],
    );
    this.saveTemplateActivity(this.applyActivityTypeConstraints(updated));
  }

  protected clearActivitySelection(): void {
    this.selectedActivityIdsSignal.set(new Set());
    this.activityMoveTargetSignal.set('');
    this.selectedActivitySlotSignal.set(null);
  }

  protected clearSelectedActivity(): void {
    const selection = this.selectedActivityState();
    if (selection && this.isPendingSelection(selection.activity.id)) {
      this.pendingActivitySignal.set(null);
      this.pendingActivityOriginal.set(null);
    }
    this.selectedActivityState.set(null);
    this.clearEditingPreview();
  }

  private buildActivityFromForm(selection: { activity: Activity; resource: Resource } | null): Activity | null {
    if (!selection) {
      return null;
    }
    const value = this.activityForm.getRawValue();
    const startDate = value.start ? this.fromLocalDateTime(value.start) : null;
    if (!startDate) {
      return null;
    }
    const desiredType =
      value.type && value.type.length > 0 ? value.type : (selection.activity.type ?? '');
    const definition =
      this.findActivityType(desiredType) ?? this.findActivityType(selection.activity.type ?? null);
    const catalog = this.selectedCatalogOption();
    const isPoint = definition?.timeMode === 'point';
    const endDateRaw = !isPoint && value.end ? this.fromLocalDateTime(value.end) : null;
    const endDateValid =
      endDateRaw && endDateRaw.getTime() > startDate.getTime() ? endDateRaw : null;
    const mergedAttributes = catalog
      ? {
          ...(selection.activity.attributes ?? {}),
          ...(this.buildAttributesFromCatalog(catalog) ?? {}),
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
    const selection = this.selectedActivityState();
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
      this.selectedActivityState.set({ activity: normalized, resource: selection.resource });
      this.clearEditingPreview();
      return;
    }
    if (stage === 'base') {
      this.saveTemplateActivity(normalized);
      this.selectedActivityState.set({ activity: normalized, resource: selection.resource });
      this.clearEditingPreview();
      return;
    }
    this.replaceActivity(normalized);
  }

  protected deleteSelectedActivity(): void {
    const selection = this.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.isPendingSelection(selection.activity.id)) {
      this.pendingActivitySignal.set(null);
      this.selectedActivityState.set(null);
      return;
    }
    const stage = this.activeStageSignal();
    if (stage === 'base') {
      const templateId = this.templateStore.selectedTemplate()?.id;
      if (templateId) {
        this.data.deleteTemplateActivity(templateId, selection.activity.id);
      }
      this.selectedActivityState.set(null);
      return;
    }
    this.updateStageActivities(stage, (activities) =>
      activities.filter((activity) => activity.id !== selection.activity.id),
    );
    this.selectedActivityState.set(null);
    this.clearEditingPreview();
  }

  protected handleServiceAssignRequest(resource: Resource): void {
    this.pendingServiceResourceSignal.set(resource);
    const candidates = this.computeAssignmentCandidatesFor(resource);
    this.serviceAssignmentTargetSignal.set(candidates[0]?.id ?? null);
  }

  protected setServiceAssignmentTarget(resourceId: string | null): void {
    this.serviceAssignmentTargetSignal.set(resourceId);
  }

  protected confirmServiceAssignment(): void {
    const serviceResource = this.pendingServiceResourceSignal();
    const targetResourceId = this.serviceAssignmentTargetSignal();
    if (!serviceResource || !targetResourceId) {
      return;
    }
    const stage = this.activeStageSignal();
    this.data.updateStageData(stage, (stageData) => {
      const targetResource =
        stageData.resources.find((resource) => resource.id === targetResourceId) ?? null;
      if (!targetResource) {
        return stageData;
      }
      const existing = stageData.activities;
      const serviceActivities = existing.filter((activity) => this.isActivityOwnedBy(activity, serviceResource.id));
      const updatedExisting = existing.map((activity) => {
        if (!this.isActivityOwnedBy(activity, serviceResource.id)) {
          return activity;
        }
        return this.addParticipantToActivity(activity, serviceResource, targetResource, undefined, {
          retainPreviousOwner: false,
          ownerCategory: this.resourceParticipantCategory(serviceResource),
        });
      });
      const additions: Activity[] = [];
      serviceActivities.forEach((activity) => {
        const duplicate = existing.some(
          (entry) =>
            this.isActivityOwnedBy(entry, targetResourceId) && entry.serviceId === activity.serviceId,
        );
        if (!duplicate) {
          additions.push(
            this.addParticipantToActivity(
              {
                ...activity,
                id: this.generateActivityId('assign'),
              },
              targetResource,
              serviceResource,
              undefined,
              {
                retainPreviousOwner: false,
                ownerCategory: this.resourceParticipantCategory(targetResource),
              },
            ),
          );
        }
      });
      return {
        ...stageData,
        activities: [...updatedExisting, ...additions],
      };
    });
    this.pendingServiceResourceSignal.set(null);
    this.serviceAssignmentTargetSignal.set(null);
  }

  protected cancelServiceAssignment(): void {
    this.pendingServiceResourceSignal.set(null);
    this.serviceAssignmentTargetSignal.set(null);
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
    const selectionIds = this.selectedActivityIdsSignal();
    if (selectionIds.size === 0) {
      return;
    }
    const idsToMove = new Set(selectionIds);
    this.updateStageActivities(stage, (activities) =>
      activities.map((activity) => {
        if (!idsToMove.has(activity.id)) {
          return activity;
        }
        return this.addParticipantToActivity(activity, targetResource, undefined, undefined, {
          retainPreviousOwner: false,
          ownerCategory: this.resourceParticipantCategory(targetResource),
        });
      }),
    );
    const activeSelection = this.selectedActivityState();
    if (activeSelection && idsToMove.has(activeSelection.activity.id)) {
      this.selectedActivityState.set({
        activity: this.applyActivityTypeConstraints(
          this.addParticipantToActivity(
            activeSelection.activity,
            targetResource,
            undefined,
            undefined,
            { retainPreviousOwner: false, ownerCategory: this.resourceParticipantCategory(targetResource) },
          ),
        ),
        resource: targetResource,
      });
    }
  }

  protected shiftSelectedActivityBy(deltaMinutes: number): void {
    const selected = this.selectedActivities();
    const target =
      selected.length === 1 ? selected[0] : this.selectedActivityState();
    if (!target) {
      return;
    }
    const { activity } = target;
    const deltaMs = deltaMinutes * 60 * 1000;
    const start = new Date(activity.start).getTime() + deltaMs;
    const definition = this.findActivityType(activity.type ?? null);
    const end =
      definition?.timeMode === 'point' || !activity.end
        ? null
        : new Date(activity.end).getTime() + deltaMs;
    const updated: Activity = {
      ...activity,
      start: new Date(start).toISOString(),
      end: end ? new Date(end).toISOString() : null,
    };
    const normalized = this.applyActivityTypeConstraints(updated);
    if (this.isPendingSelection(activity.id)) {
      this.commitPendingActivityUpdate(normalized);
      return;
    }
    this.replaceActivity(normalized);
  }

  protected snapSelectedActivityToPrevious(): void {
    const selection = this.selectedActivityState();
    if (!selection) {
      return;
    }
    const formValue = this.activityForm.getRawValue();
    if (!formValue.start) {
      return;
    }
    const base = selection.activity;
    const startDate = this.fromLocalDateTime(formValue.start);
    const endDate = formValue.end ? this.fromLocalDateTime(formValue.end) : null;
    if (!startDate) {
      return;
    }
    const reference: Activity = {
      ...base,
      start: startDate.toISOString(),
      end: endDate ? endDate.toISOString() : null,
    };
    const neighbors = this.findNeighborActivities(reference);
    const previous = neighbors.previous;
    if (!previous) {
      return;
    }
    const prevTerminalIso = previous.end ?? previous.start;
    if (!prevTerminalIso) {
      return;
    }
    const definition = this.findActivityType(base.type ?? null);
    const isPoint = definition?.timeMode === 'point';
    const prevEndDate = new Date(prevTerminalIso);
    const prevEndMs = prevEndDate.getTime();
    if (!Number.isFinite(prevEndMs)) {
      return;
    }
    let updated: Activity;
    if (isPoint || !base.end) {
      updated = {
        ...base,
        start: prevEndDate.toISOString(),
      };
    } else {
      const currentStartMs = startDate.getTime();
      const currentEndMs = (endDate ?? startDate).getTime();
      const durationMs = Math.max(60_000, currentEndMs - currentStartMs);
      const newStartMs = prevEndMs;
      const newEndMs = newStartMs + durationMs;
      updated = {
        ...base,
        start: new Date(newStartMs).toISOString(),
        end: new Date(newEndMs).toISOString(),
      };
    }
    this.activityForm.controls.start.setValue(this.toLocalDateTime(updated.start));
    if (!isPoint && updated.end) {
      this.activityForm.controls.end.setValue(this.toLocalDateTime(updated.end));
    } else {
      this.activityForm.controls.end.setValue('');
    }
    this.activityForm.controls.start.markAsDirty();
    this.activityForm.controls.end.markAsDirty();
  }

  protected snapSelectedActivityToNext(): void {
    const selection = this.selectedActivityState();
    if (!selection) {
      return;
    }
    const formValue = this.activityForm.getRawValue();
    if (!formValue.start) {
      return;
    }
    const base = selection.activity;
    const startDate = this.fromLocalDateTime(formValue.start);
    const endDate = formValue.end ? this.fromLocalDateTime(formValue.end) : null;
    if (!startDate) {
      return;
    }
    const reference: Activity = {
      ...base,
      start: startDate.toISOString(),
      end: endDate ? endDate.toISOString() : null,
    };
    const neighbors = this.findNeighborActivities(reference);
    const next = neighbors.next;
    if (!next) {
      return;
    }
    const definition = this.findActivityType(base.type ?? null);
    const isPoint = definition?.timeMode === 'point';
    const nextStartDate = new Date(next.start);
    const nextStartMs = nextStartDate.getTime();
    let updated: Activity;
    if (isPoint || !endDate) {
      updated = {
        ...base,
        start: nextStartDate.toISOString(),
      };
    } else {
      const currentStartMs = startDate.getTime();
      const currentEndMs = endDate.getTime();
      const durationMs = Math.max(60_000, currentEndMs - currentStartMs);
      const newEndMs = nextStartMs;
      const newStartMs = newEndMs - durationMs;
      updated = {
        ...base,
        start: new Date(newStartMs).toISOString(),
        end: new Date(newEndMs).toISOString(),
      };
    }
    this.activityForm.controls.start.setValue(this.toLocalDateTime(updated.start));
    if (!isPoint && updated.end) {
      this.activityForm.controls.end.setValue(this.toLocalDateTime(updated.end));
    } else {
      this.activityForm.controls.end.setValue('');
    }
    this.activityForm.controls.start.markAsDirty();
    this.activityForm.controls.end.markAsDirty();
  }

  protected fillGapForSelectedActivity(): void {
    const selection = this.selectedActivityState();
    if (!selection) {
      return;
    }
    const formValue = this.activityForm.getRawValue();
    if (!formValue.start) {
      return;
    }
    const base = selection.activity;
    const startDate = this.fromLocalDateTime(formValue.start);
    const endDate = formValue.end ? this.fromLocalDateTime(formValue.end) : null;
    if (!startDate) {
      return;
    }
    const reference: Activity = {
      ...base,
      start: startDate.toISOString(),
      end: endDate ? endDate.toISOString() : null,
    };
    const neighbors = this.findNeighborActivities(reference);
    const previous = neighbors.previous;
    const next = neighbors.next;
    if (!previous || !next) {
      return;
    }
    const prevTerminalIso = previous.end ?? previous.start;
    if (!prevTerminalIso) {
      return;
    }
    const startMs = new Date(prevTerminalIso).getTime();
    const endMs = new Date(next.start).getTime();
    if (
      !(Number.isFinite(startMs) && Number.isFinite(endMs)) ||
      endMs <= startMs + 60_000
    ) {
      return;
    }
    const definition = this.findActivityType(base.type ?? null);
    const isPoint = definition?.timeMode === 'point';
    const updated: Activity = {
      ...base,
      start: new Date(startMs).toISOString(),
      end: isPoint ? null : new Date(endMs).toISOString(),
    };
    this.activityForm.controls.start.setValue(this.toLocalDateTime(updated.start));
    if (!isPoint && updated.end) {
      this.activityForm.controls.end.setValue(this.toLocalDateTime(updated.end));
    } else {
      this.activityForm.controls.end.setValue('');
    }
    this.activityForm.controls.start.markAsDirty();
    this.activityForm.controls.end.markAsDirty();
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
    const state = this.stageStateSignal()[stage];
    if (!state.activeBoardId) {
      return;
    }
    this.updateBoard(stage, state.activeBoardId, (resourceIds) =>
      this.normalizeResourceIds([...resourceIds, ...participantIds], stage),
    );
  }

  protected openBoardForParticipants(): void {
    const participantIds = this.selectedActivityParticipantIds();
    if (participantIds.length === 0) {
      return;
    }
    const stage = this.activeStageSignal();
    const board = this.createBoardState(stage, this.nextBoardTitle(stage, 'Dienst'), participantIds);
    this.updateStageState(stage, (state) => {
      state.boards.push(board);
      state.activeBoardId = board.id;
      return state;
    });
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
        : null) ?? this.selectedActivityState()?.resource ?? null;
    if (resource) {
      this.selectedActivityState.set({
        activity: this.applyActivityTypeConstraints(updated),
        resource,
      });
    } else {
      this.selectedActivityState.set(null);
    }
    this.clearEditingPreview();
  }

  private clearEditingPreview(): void {
    this.activityEditPreviewSignal.set(null);
  }

  private startPendingActivity(stage: PlanningStageId, resource: Resource, activity: Activity): void {
    this.pendingActivitySignal.set({ stage, activity });
    this.selectedActivityState.set({ activity, resource });
    this.selectedActivityIdsSignal.set(new Set());
    this.selectedActivitySlotSignal.set(null);
    this.clearEditingPreview();
  }

  private isPendingSelection(activityId: string | null | undefined): boolean {
    if (!activityId) {
      return false;
    }
    const pending = this.pendingActivitySignal();
    if (!pending) {
      return false;
    }
    return pending.stage === this.activeStageSignal() && pending.activity.id === activityId;
  }

  private commitPendingActivityUpdate(activity: Activity): void {
    const pending = this.pendingActivitySignal();
    if (!pending) {
      return;
    }
    this.pendingActivitySignal.set({ stage: pending.stage, activity });
    const stage = this.activeStageSignal();
    const ownerId = this.activityOwnerId(activity);
    const resource =
      (ownerId
        ? this.stageResourceSignals[stage]().find((entry) => entry.id === ownerId)
        : null) ?? this.selectedActivityState()?.resource ?? null;
    if (resource) {
      this.selectedActivityState.set({ activity, resource });
    } else {
      this.selectedActivityState.set(null);
    }
  }


  private pendingActivityForStage(stage: PlanningStageId): Activity | null {
    const pending = this.pendingActivitySignal();
    if (!pending || pending.stage !== stage) {
      return null;
    }
    return pending.activity;
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
    const stage = this.activeStageSignal();
    const targetResource =
      this.stageResourceSignals[stage]().find((entry) => entry.id === event.targetResourceId) ??
      null;
    const base: Activity = {
      ...event.activity,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
    };
    const updated = targetResource
      ? !event.isOwnerSlot && (event.participantResourceId ?? event.sourceResourceId)
        ? this.moveParticipantToResource(
            base,
            event.participantResourceId ?? event.sourceResourceId,
            targetResource,
          )
        : this.addParticipantToActivity(base, targetResource, undefined, undefined, {
            retainPreviousOwner: false,
            ownerCategory:
              event.participantCategory ?? this.resourceParticipantCategory(targetResource),
          })
      : base;
    this.commitPendingActivityUpdate(this.applyActivityTypeConstraints(updated));
  }

  private generateActivityId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private buildActivityTitle(definition: ActivityTypeDefinition | null): string {
    return definition?.label ?? 'Aktivität';
  }

  private computeSelectedActivities(): { activity: Activity; resource: Resource }[] {
    const selection = this.selectedActivityIdsSignal();
    if (selection.size === 0) {
      return [];
    }
    const stage = this.activeStageSignal();
    const activities = this.normalizedStageActivitySignals[stage]();
    const resources = this.stageResourceSignals[stage]();
    const activityMap = new Map(activities.map((activity) => [activity.id, activity]));
    const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
    const result: { activity: Activity; resource: Resource }[] = [];
    selection.forEach((id) => {
      const activity = activityMap.get(id);
      if (!activity) {
        return;
      }
      const ownerId = this.activityOwnerId(activity);
      if (!ownerId) {
        return;
      }
      const resource = resourceMap.get(ownerId);
      if (!resource) {
        return;
      }
      result.push({ activity, resource });
    });
    return result;
  }

  private findNeighborActivities(activity: Activity): { previous: Activity | null; next: Activity | null } {
    const stage = this.activeStageSignal();
    const all = this.normalizedStageActivitySignals[stage]();
    const serviceId = activity.serviceId ?? null;
    const role = activity.serviceRole ?? null;
    const type = activity.type ?? '';
    const isServiceBoundary =
      role === 'start' ||
      role === 'end' ||
      type === 'service-start' ||
      type === 'service-end';
    const requireServiceMatch = !!serviceId && !isServiceBoundary;
    const resourceId = this.activityOwnerId(activity);
    if (!resourceId) {
      return { previous: null, next: null };
    }
    const targetStartMs = new Date(activity.start).getTime();
    const targetEndMs = activity.end ? new Date(activity.end).getTime() : targetStartMs;
    if (!Number.isFinite(targetStartMs) || !Number.isFinite(targetEndMs)) {
      return { previous: null, next: null };
    }
    let previous: Activity | null = null;
    let next: Activity | null = null;
    let previousEndMs = Number.NEGATIVE_INFINITY;
    let nextStartMs = Number.POSITIVE_INFINITY;
    all.forEach((entry) => {
      if (entry.id === activity.id) {
        return;
      }
      if (!this.isActivityOwnedBy(entry, resourceId)) {
        return;
      }
      const entryService = entry.serviceId ?? null;
      if (requireServiceMatch && entryService !== serviceId) {
        return;
      }
      const startMs = new Date(entry.start).getTime();
      const endMs = entry.end ? new Date(entry.end).getTime() : startMs;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return;
      }
      if (endMs <= targetStartMs && endMs > previousEndMs) {
        previous = entry;
        previousEndMs = endMs;
      }
      if (startMs >= targetEndMs && startMs < nextStartMs) {
        next = entry;
        nextStartMs = startMs;
      }
    });
    return { previous, next };
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
    const selection = this.selectedActivityState();
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
    const nextAttrs: Record<string, unknown> = { ...attrs };
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
        this.defaultColorForType(activity.type ?? option?.activityTypeId ?? null, option?.typeDefinition.category);
      if (color) {
        nextAttrs['color'] = color;
        changed = true;
      }
    }
    if (!changed) {
      return activity;
    }
    return { ...activity, attributes: nextAttrs };
  }

  private activityOwnerId(activity: Activity): string | null {
    return getActivityOwnerId(activity);
  }

  private resolvePrimaryRoleForResource(resource: Resource): ActivityParticipantRole {
    return resource.kind === 'vehicle' || resource.kind === 'vehicle-service'
      ? 'primary-vehicle'
      : 'primary-personnel';
  }

  private isPrimaryParticipantRole(role: ActivityParticipantRole | undefined): boolean {
    return role === 'primary-personnel' || role === 'primary-vehicle';
  }

  private isActivityOwnedBy(activity: Activity, resourceId: string): boolean {
    if (!resourceId) {
      return false;
    }
    return this.activityOwnerId(activity) === resourceId;
  }

  private addParticipantToActivity(
    activity: Activity,
    owner: Resource,
    partner?: Resource | null,
    partnerRole?: ActivityParticipantRole,
    options?: { retainPreviousOwner?: boolean; ownerCategory?: ActivityParticipantCategory },
  ): Activity {
    const participants = new Map<string, ActivityParticipant>();
    (activity.participants ?? []).forEach((participant) => {
      if (!participant?.resourceId) {
        return;
      }
      participants.set(participant.resourceId, { ...participant });
    });

    const ownerCategory = options?.ownerCategory ?? this.resourceParticipantCategory(owner);

    if (!options?.retainPreviousOwner && ownerCategory !== 'other') {
      const previousOwner = getActivityOwnerByCategory(activity, ownerCategory);
      if (previousOwner && previousOwner.resourceId !== owner.id) {
        participants.delete(previousOwner.resourceId);
      }
    }

    const ensureParticipant = (resource?: Resource | null, role?: ActivityParticipantRole) => {
      if (!resource?.id) {
        return;
      }
      const previous = participants.get(resource.id);
      const participant: ActivityParticipant = {
        resourceId: resource.id,
        kind: resource.kind,
        role: role ?? previous?.role,
      };
      participants.set(resource.id, participant);
    };

    ensureParticipant(partner, partnerRole);
    ensureParticipant(owner, this.resolvePrimaryRoleForResource(owner));

    const participantList = Array.from(participants.values()).sort((a, b) => {
      if (a.resourceId === owner.id) {
        return -1;
      }
      if (b.resourceId === owner.id) {
        return 1;
      }
      return a.resourceId.localeCompare(b.resourceId);
    });
    return {
      ...activity,
      participants: participantList,
    };
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
      return this.addParticipantToActivity(activity, target, undefined, undefined, {
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

  private applyParticipantRoleUpdates(
    activity: Activity,
    updates: Array<{ resourceId: string; role: ActivityParticipantRole | null | undefined }>,
  ): Activity {
    if (!activity.participants?.length || !updates.length) {
      return activity;
    }
    const roleMap = new Map(
      updates
        .filter((entry) => !!entry.role && !!entry.resourceId)
        .map((entry) => [entry.resourceId, entry.role as ActivityParticipantRole]),
    );
    if (roleMap.size === 0) {
      return activity;
    }
    let changed = false;
    const participants = activity.participants.map((participant) => {
      const nextRole = roleMap.get(participant.resourceId);
      if (!nextRole || participant.role === nextRole) {
        return participant;
      }
      changed = true;
      return {
        ...participant,
        role: nextRole,
      };
    });
    return changed ? { ...activity, participants } : activity;
  }

  private mapLinkRoleToParticipantRole(role: ActivityLinkRole): ActivityParticipantRole {
    if (role === 'teacher' || role === 'student') {
      return role;
    }
    return 'secondary-personnel';
  }

  private computeAssignmentCandidatesFor(resource: Resource): Resource[] {
    const stage = this.activeStageSignal();
    const resources = this.stageResourceSignals[stage]();
    if (resource.kind === 'personnel-service') {
      return resources.filter((entry) => entry.kind === 'personnel');
    }
    if (resource.kind === 'vehicle-service') {
      return resources.filter((entry) => entry.kind === 'vehicle');
    }
    return [];
  }

  private computeAssignmentCandidates(): Resource[] {
    const pending = this.pendingServiceResourceSignal();
    if (!pending) {
      return [];
    }
    return this.computeAssignmentCandidatesFor(pending);
  }

  private toLocalDateTime(iso: string): string {
    if (!iso) {
      return '';
    }
    const date = new Date(iso);
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60 * 1000);
    return local.toISOString().slice(0, 16);
  }

  private fromLocalDateTime(value: string): Date | null {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  protected createBoardFromSelection(): void {
    const stage = this.activeStageSignal();
    const selection = this.selectedResourceIds();
    const resources = this.stageResourceSignals[stage]();
    const resourceIds =
      selection.length > 0 ? selection : resources.map((resource) => resource.id);
    const board = this.createBoardState(stage, this.nextBoardTitle(stage), resourceIds);

    this.updateStageState(stage, (state) => {
      state.boards.push(board);
      state.activeBoardId = board.id;
      return state;
    });
  }

  protected addSelectionToBoard(boardId: string): void {
    if (!this.hasSelection()) {
      return;
    }
    const stage = this.activeStageSignal();
    const selection = this.selectedResourceIds();
    this.updateBoard(stage, boardId, (resourceIds) =>
      this.normalizeResourceIds([...resourceIds, ...selection], stage),
    );
  }

  protected replaceBoardWithSelection(boardId: string): void {
    if (!this.hasSelection()) {
      return;
    }
    const stage = this.activeStageSignal();
    const selection = this.selectedResourceIds();
    this.updateBoard(stage, boardId, () => this.normalizeResourceIds(selection, stage));
  }

  protected setSelectionFromBoard(boardId: string): void {
    const stage = this.activeStageSignal();
    const board = this.stageStateSignal()[stage].boards.find((entry) => entry.id === boardId);
    if (!board) {
      return;
    }
    this.updateStageState(stage, (state) => {
      state.selectedResourceIds = new Set(board.resourceIds);
      return state;
    });
  }

  protected removeBoard(boardId: string): void {
    const stage = this.activeStageSignal();
    const state = this.stageStateSignal()[stage];
    if (state.boards.length <= 1) {
      return;
    }
    this.updateStageState(stage, (nextState) => {
      const index = nextState.boards.findIndex((board) => board.id === boardId);
      if (index === -1) {
        return nextState;
      }
      nextState.boards.splice(index, 1);
      if (nextState.activeBoardId === boardId) {
        const fallback = nextState.boards[Math.max(0, Math.min(index, nextState.boards.length - 1))];
        nextState.activeBoardId = fallback?.id ?? '';
      }
      return nextState;
    });
  }

  protected removeResourceFromBoard(boardId: string, resourceId: string): void {
    const stage = this.activeStageSignal();
    this.updateBoard(stage, boardId, (resourceIds) =>
      resourceIds.filter((id) => id !== resourceId),
    );
  }

  protected handleBoardIndexChange(index: number): void {
    const stage = this.activeStageSignal();
    const board = this.stageStateSignal()[stage].boards[index];
    if (!board) {
      return;
    }
    this.updateStageState(stage, (state) => {
      state.activeBoardId = board.id;
      return state;
    });
  }

  protected boardResources(board: PlanningBoard): Resource[] {
    const stage = this.activeStageSignal();
    const resourceSet = new Set(board.resourceIds);
    return this.filterResourcesForStage(stage, this.stageResourceSignals[stage]()).filter(
      (resource) => resourceSet.has(resource.id),
    );
  }

  protected boardActivities(board: PlanningBoard): Activity[] {
    const stage = this.activeStageSignal();
    const resourceSet = new Set(board.resourceIds);
    return this.normalizedStageActivitySignals[stage]().filter((activity) => {
      const ownerId = this.activityOwnerId(activity);
      return ownerId ? resourceSet.has(ownerId) : false;
    });
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
    return this.stageStateSignal()[stage].activeBoardId === boardId;
  }

  protected isTimetableYearSelected(label: string): boolean {
    const stage = this.activeStageSignal();
    return this.stageYearSelectionState()[stage]?.has(label) ?? false;
  }

  protected onTimetableYearToggle(label: string, checked: boolean): void {
    const stage = this.activeStageSignal();
    this.updateStageYearSelection(stage, (current, options) => {
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
        next.add(this.preferredYearLabel(options));
      }
      return next;
    });
  }

  protected selectDefaultTimetableYear(): void {
    const stage = this.activeStageSignal();
    this.updateStageYearSelection(stage, (_current, options) => {
      if (!options.length) {
        return _current;
      }
      return new Set([this.preferredYearLabel(options)]);
    });
  }

  protected selectAllTimetableYears(): void {
    const stage = this.activeStageSignal();
    this.updateStageYearSelection(stage, (_current, options) => {
      if (!options.length) {
        return _current;
      }
      return new Set(options.map((year) => year.label));
    });
  }

  private computeResourceGroups(stage: PlanningStageId): ResourceGroupView[] {
    const resources = this.filterResourcesForStage(stage, this.stageResourceSignals[stage]());
    const configs = STAGE_RESOURCE_GROUPS[stage];
    return configs
      .map((config) => {
        const items = resources.filter(
          (resource) => this.getResourceCategory(resource) === config.category,
        );
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

  private getResourceCategory(resource: Resource): PlanningResourceCategory | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const category = (attributes?.['category'] ?? null) as string | null;
    if (this.isPlanningResourceCategory(category)) {
      return category;
    }
    if (this.isPlanningResourceCategory(resource.kind)) {
      return resource.kind;
    }
    return null;
  }

  private isPlanningResourceCategory(
    value: string | null | undefined,
  ): value is PlanningResourceCategory {
    return (
      value === 'vehicle-service' ||
      value === 'personnel-service' ||
      value === 'vehicle' ||
      value === 'personnel'
    );
  }

  private updateStageState(
    stage: PlanningStageId,
    reducer: (state: StageRuntimeState) => StageRuntimeState,
  ): void {
    const current = this.stageStateSignal();
    const nextStageState = reducer(this.cloneStageState(current[stage]));
    this.stageStateSignal.set({
      ...current,
      [stage]: nextStageState,
    });
  }

  private updateBoard(
    stage: PlanningStageId,
    boardId: string,
    updater: (resourceIds: string[]) => string[],
  ): void {
    this.updateStageState(stage, (state) => {
      const index = state.boards.findIndex((board) => board.id === boardId);
      if (index === -1) {
        return state;
      }
      const target = state.boards[index];
      const updatedIds = updater([...target.resourceIds]);
      state.boards.splice(index, 1, {
        ...target,
        resourceIds: this.normalizeResourceIds(updatedIds, stage),
      });
      return state;
    });
  }

  private createEmptyStageState(): StageRuntimeState {
    return {
      boards: [],
      selectedResourceIds: new Set(),
      activeBoardId: '',
    };
  }

  private cloneStageState(state: StageRuntimeState): StageRuntimeState {
    return {
      boards: state.boards.map((board) => ({
        ...board,
        resourceIds: [...board.resourceIds],
      })),
      selectedResourceIds: new Set(state.selectedResourceIds),
      activeBoardId: state.activeBoardId,
    };
  }

  private ensureStageInitialized(stage: PlanningStageId, resources: Resource[]): void {
    const filteredResources = this.filterResourcesForStage(stage, resources);
    if (filteredResources.length === 0) {
      return;
    }

    const current = this.stageStateSignal();
    const state = this.cloneStageState(current[stage]);
    const orderMap = this.buildResourceOrderMap(filteredResources);
    let mutated = false;

    if (state.boards.length === 0) {
      const defaultBoards = this.createDefaultBoardsForStage(stage, filteredResources, orderMap);
      if (defaultBoards.length === 0) {
        const fallback = this.createBoardState(
          stage,
          this.nextBoardTitle(stage, 'Grundlage'),
          filteredResources.map((resource) => resource.id),
          orderMap,
        );
        state.boards = [fallback];
        state.activeBoardId = fallback.id;
      } else {
        state.boards = defaultBoards;
        state.activeBoardId = defaultBoards[0]?.id ?? '';
      }
      mutated = true;
    } else {
      const normalizedBoards = state.boards.map((board) => {
        const normalizedIds = this.normalizeResourceIds(board.resourceIds, stage, orderMap);
        if (!this.areIdsEqual(normalizedIds, board.resourceIds)) {
          mutated = true;
          return {
            ...board,
            resourceIds: normalizedIds,
          };
        }
        return board;
      });
      if (mutated) {
        state.boards = normalizedBoards;
      }
    }

    const filteredSelection = new Set(
      [...state.selectedResourceIds].filter((id) => orderMap.has(id)),
    );
    if (filteredSelection.size !== state.selectedResourceIds.size) {
      state.selectedResourceIds = filteredSelection;
      mutated = true;
    }

    if (!state.activeBoardId || !state.boards.some((board) => board.id === state.activeBoardId)) {
      state.activeBoardId = state.boards[0]?.id ?? '';
      mutated = true;
    }

    if (!mutated) {
      return;
    }

    this.stageStateSignal.set({
      ...current,
      [stage]: state,
    });
  }

  private nextBoardTitle(stage: PlanningStageId, suffix?: string): string {
    const meta = this.stageMetaMap[stage];
    const counter = this.boardCounters[stage]++;
    if (suffix) {
      return `${meta.shortLabel} · Plantafel ${counter} (${suffix})`;
    }
    return `${meta.shortLabel} · Plantafel ${counter}`;
  }

  private buildResourceOrderMap(resources: Resource[]): Map<string, number> {
    const map = new Map<string, number>();
    resources.forEach((resource, index) => map.set(resource.id, index));
    return map;
  }

  private normalizeResourceIds(
    resourceIds: string[],
    stage: PlanningStageId,
    order?: Map<string, number>,
  ): string[] {
    const orderMap =
      order ??
      this.buildResourceOrderMap(
        this.filterResourcesForStage(stage, this.stageResourceSignals[stage]()),
      );
    const seen = new Set<string>();
    const known: Array<{ id: string; order: number }> = [];
    const unmapped: string[] = [];

    resourceIds.forEach((id) => {
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      const position = orderMap.get(id);
      if (position === undefined) {
        unmapped.push(id);
      } else {
        known.push({ id, order: position });
      }
    });

    known.sort((a, b) => a.order - b.order);
    return [...known.map((entry) => entry.id), ...unmapped];
  }

  private areIdsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((id, index) => id === b[index]);
  }

  private createBoardState(
    stage: PlanningStageId,
    title: string,
    resourceIds: string[],
    order?: Map<string, number>,
  ): PlanningBoard {
    return {
      id: `board-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      title,
      resourceIds: this.normalizeResourceIds(resourceIds, stage, order),
      createdAt: Date.now(),
    };
  }

  private createDefaultBoardsForStage(
    stage: PlanningStageId,
    resources: Resource[],
    orderMap: Map<string, number>,
  ): PlanningBoard[] {
    const configs = STAGE_RESOURCE_GROUPS[stage] ?? [];
    const boards: PlanningBoard[] = [];
    const categorized = new Set<PlanningResourceCategory>();

    configs.forEach((config) => {
      const ids = resources
        .filter((resource) => this.getResourceCategory(resource) === config.category)
        .map((resource) => resource.id);
      if (ids.length === 0) {
        return;
      }
      boards.push(
        this.createBoardState(
          stage,
          `${this.stageMetaMap[stage].shortLabel} · ${config.label}`,
          ids,
          orderMap,
        ),
      );
      categorized.add(config.category);
    });

    const remaining = resources.filter((resource) => {
      const category = this.getResourceCategory(resource);
      if (!category) {
        return true;
      }
      return !categorized.has(category);
    });
    if (remaining.length > 0) {
      boards.push(
        this.createBoardState(
          stage,
          `${this.stageMetaMap[stage].shortLabel} · Weitere Ressourcen`,
          remaining.map((resource) => resource.id),
          orderMap,
        ),
      );
    }

    return boards;
  }

  private filterResourcesForStage(stage: PlanningStageId, resources: Resource[]): Resource[] {
    if (stage === 'base') {
      const serviceResources = resources.filter((resource) => this.isServiceResource(resource));
      if (serviceResources.length > 0) {
        return serviceResources;
      }
      return resources;
    }
    return resources;
  }

  private isServiceResource(resource: Resource): boolean {
    const category = this.getResourceCategory(resource);
    return category === 'vehicle-service' || category === 'personnel-service';
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
    const fallback = this.baseTimelineFallback();
    const start = new Date(fallback.start);
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
    end.setUTCHours(end.getUTCHours() + 20);
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
      startIso: this.toIsoDate(new Date(minStart)),
      endIso: this.toIsoDate(new Date(maxEnd)),
    };
  }

  private selectedYearBounds(stage: PlanningStageId): TimetableYearBounds[] {
    const selection = Array.from(this.stageYearSelectionState()[stage] ?? []);
    if (!selection.length) {
      return [];
    }
    const optionMap = new Map(
      this.timetableYearOptions().map(
        (year) => [year.label, year] as [string, TimetableYearBounds],
      ),
    );
    return selection
      .map((label) => optionMap.get(label))
      .filter((year): year is TimetableYearBounds => !!year);
  }

  private formatTimetableYearSummary(stage: PlanningStageId): string {
    const selection = Array.from(this.stageYearSelectionState()[stage] ?? []);
    if (selection.length === 0) {
      return 'Fahrplanjahr wählen';
    }
    if (selection.length === 1) {
      return `Fahrplanjahr ${selection[0]}`;
    }
    return `${selection.length} Fahrplanjahre`;
  }

  private createEmptyYearSelection(): Record<PlanningStageId, Set<string>> {
    return this.stageOrder.reduce((record, stage) => {
      record[stage] = new Set<string>();
      return record;
    }, {} as Record<PlanningStageId, Set<string>>);
  }

  private ensureStageYearSelection(stage: PlanningStageId, options: TimetableYearBounds[]): void {
    this.stageYearSelectionState.update((state) => {
      const current = state[stage] ?? new Set<string>();
      const validLabels = new Set(options.map((year) => year.label));
      const next = new Set(Array.from(current).filter((label) => validLabels.has(label)));
      if (next.size === 0 && options.length > 0) {
        next.add(this.preferredYearLabel(options));
      }
      if (this.areSetsEqual(next, current)) {
        return state;
      }
      return {
        ...state,
        [stage]: next,
      };
    });
  }

  private updateStageYearSelection(
    stage: PlanningStageId,
    updater: (current: Set<string>, options: TimetableYearBounds[]) => Set<string>,
  ): void {
    const options = this.timetableYearOptions();
    this.stageYearSelectionState.update((state) => {
      const current = state[stage] ?? new Set<string>();
      const next = updater(new Set(current), options);
      if (this.areSetsEqual(next, current)) {
        return state;
      }
      return {
        ...state,
        [stage]: next,
      };
    });
  }

  private preferredYearLabel(options: TimetableYearBounds[]): string {
    if (!options.length) {
      return '';
    }
    const today = new Date();
    const active =
      options.find((year) => today >= year.start && today <= year.end) ?? options[0];
    return active.label;
  }

  private areSetsEqual(a: Set<string>, b: Set<string>): boolean {
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

  private toIsoDate(date: Date): string {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }

  private mapActivityToReferenceWeek(activity: Activity): Activity {
    const template = this.templateStore.selectedTemplate();
    const periods = template?.periods ?? this.defaultTemplatePeriod();
    if (!periods.length) {
      return activity;
    }
    const startDate = new Date(activity.start);
    const targetPeriod = periods.find((period) => {
      const from = new Date(period.validFrom);
      const to = period.validTo ? new Date(period.validTo) : this.timetableYearService.defaultYearBounds().end;
      return startDate >= from && startDate <= to;
    });
    const period = targetPeriod ?? periods[0];
    const refStart = new Date(period.validFrom);
    const weekday = startDate.getUTCDay();
    const mappedStart = new Date(refStart);
    mappedStart.setUTCDate(refStart.getUTCDate() + weekday);
    const startTime =
      startDate.getUTCHours() * 3600_000 +
      startDate.getUTCMinutes() * 60_000 +
      startDate.getUTCSeconds() * 1000 +
      startDate.getUTCMilliseconds();
    mappedStart.setUTCMilliseconds(mappedStart.getUTCMilliseconds() + startTime);
    let mappedEnd: Date | null = null;
    if (activity.end) {
      const endDate = new Date(activity.end);
      const endTime =
        endDate.getUTCHours() * 3600_000 +
        endDate.getUTCMinutes() * 60_000 +
        endDate.getUTCSeconds() * 1000 +
        endDate.getUTCMilliseconds();
      mappedEnd = new Date(refStart);
      mappedEnd.setUTCDate(refStart.getUTCDate() + weekday);
      mappedEnd.setUTCMilliseconds(mappedEnd.getUTCMilliseconds() + endTime);
    }
    return {
      ...activity,
      start: mappedStart.toISOString(),
      end: mappedEnd ? mappedEnd.toISOString() : null,
    };
  }

  private defaultTemplatePeriod() {
    const year = this.timetableYearService.defaultYearBounds();
    return [
      {
        id: 'default-year',
        validFrom: year.startIso,
        validTo: year.endIso,
      },
    ];
  }

  private createActivityDraft(
    event: { resource: Resource; start: Date },
    definition: ActivityTypeDefinition,
    option: ActivityCatalogOption | null,
  ): Activity {
    const durationMinutes =
      option?.defaultDurationMinutes ?? definition.defaultDurationMinutes;
    const endDate =
      definition.timeMode === 'duration'
        ? new Date(event.start.getTime() + durationMinutes * 60 * 1000)
        : null;
    const draft: Activity = {
      id: this.generateActivityId(option?.id ?? definition.id),
      title: option?.label ?? this.buildActivityTitle(definition),
      start: event.start.toISOString(),
      end: endDate ? endDate.toISOString() : null,
      type: definition.id,
      serviceCategory: this.resolveServiceCategory(event.resource),
      attributes: this.buildAttributesFromCatalog(option),
    };
    if (this.definitionHasField(definition, 'from')) {
      draft.from = '';
    }
    if (this.definitionHasField(definition, 'to')) {
      draft.to = '';
    }
    if (this.definitionHasField(definition, 'remark')) {
      draft.remark = '';
    }
    return this.addParticipantToActivity(draft, event.resource, undefined, undefined, {
      retainPreviousOwner: false,
      ownerCategory: this.resourceParticipantCategory(event.resource),
    });
  }

  private buildAttributesFromCatalog(option: ActivityCatalogOption | null): Record<string, unknown> | undefined {
    if (!option) {
      return undefined;
    }
    const attrs: Record<string, unknown> = { activityKey: option.id };
    if (option.templateId) {
      attrs['templateId'] = option.templateId;
    }
    option.attributes.forEach((attr) => {
      const key = (attr?.key ?? '').trim();
      if (!key) {
        return;
      }
      const val = attr.meta?.['value'];
      if (val !== undefined) {
        attrs[key] = val;
      }
    });
    if (!attrs['color']) {
      const fallback = this.defaultColorForType(option.activityTypeId, option.typeDefinition.category);
      if (fallback) {
        attrs['color'] = fallback;
      }
    }
    return attrs;
  }

  private defaultColorForType(typeId: string | null, category?: ActivityCategory | null): string | null {
    const type = typeId?.toLowerCase() ?? '';
    if (type.includes('break') || type.includes('pause')) {
      return '#ffb74d';
    }
    if (type.includes('travel') || type.includes('fahrt')) {
      return '#26a69a';
    }
    if (type.includes('transfer')) {
      return '#26c6da';
    }
    if (type.includes('service-start')) {
      return '#43a047';
    }
    if (type.includes('service-end')) {
      return '#c62828';
    }
    if (category === 'movement') {
      return '#26c6da';
    }
    if (category === 'rest') {
      return '#8d6e63';
    }
    if (category === 'other') {
      return '#7b1fa2';
    }
    return '#1976d2';
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
    const category = event.participantCategory ?? this.resourceParticipantCategory(targetResource);
    const updated = targetResource
      ? !isOwnerSlot && participantResourceId
        ? this.moveParticipantToResource(base, participantResourceId, targetResource)
        : this.addParticipantToActivity(base, targetResource, undefined, undefined, {
            retainPreviousOwner: false,
            ownerCategory: category,
          })
      : base;
    const normalized = this.applyActivityTypeConstraints(updated);
    this.saveTemplateActivity(normalized);
    const resource = targetResource ?? this.selectedActivityState()?.resource ?? null;
    const currentSelection = this.selectedActivityState();
    if (resource && currentSelection?.activity.id === event.activity.id) {
      this.selectedActivityState.set({ activity: normalized, resource });
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
    this.selectedActivityState.set(null);
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
