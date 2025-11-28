import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  Input,
  Output,
  EventEmitter,
  DestroyRef,
  ViewChild,
  ViewChildren,
  QueryList,
  computed,
  effect,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragEnd, CdkDragMove, CdkDragStart } from '@angular/cdk/drag-drop';
import { Resource } from '../models/resource';
import { Activity, ActivityParticipant, ActivityParticipantRole } from '../models/activity';
import {
  ActivityParticipantCategory,
  classifyParticipant,
  getActivityOwnerId,
  getActivityOwnersByCategory,
  participantCategoryFromKind,
} from '../models/activity-ownership';
import { TimeScaleService } from '../core/services/time-scale.service';
import { createTimeViewport, TimeViewport } from '../core/signals/time-viewport.signal';
import { GanttMenuComponent } from './gantt-menu.component';
import { GanttResourcesComponent } from './gantt-resources.component';
import { GanttActivityDragData, GanttActivitySelectionEvent } from './gantt-activity.component';
import {
  GanttBackgroundSegment,
  GanttBar,
  GanttServiceRange,
  GanttServiceRangeStatus,
  GanttTimelineRowComponent,
} from './gantt-timeline-row.component';
import { GanttTimelineHeaderComponent } from './gantt-timeline-header.component';
import { GanttStatusBarComponent, GanttDragStatus } from './gantt-status-bar.component';
import { TrackHorizontalScrollDirective } from '../shared/directives/track-horizontal-scroll.directive';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { addDays, startOfDay, MS_IN_DAY, MS_IN_HOUR, MS_IN_MINUTE } from '../core/utils/time-math';
import { ZOOM_RANGE_MS, findNearestZoomConfig } from '../core/constants/time-scale.config';
import { LayerGroupService } from '../core/services/layer-group.service';

interface PreparedActivity extends Activity {
  startMs: number;
  endMs: number;
  ownerResourceId: string | null;
}

interface PreparedActivitySlot {
  id: string;
  activity: PreparedActivity;
  participant: ActivityParticipant;
  resourceId: string;
  category: ActivityParticipantCategory;
  isOwner: boolean;
  icon: string | null;
  iconLabel: string | null;
}

interface GanttGroupRow {
  kind: 'group';
  id: string;
  label: string;
  icon: string;
  resourceIds: string[];
  resourceCount: number;
  expanded: boolean;
  category: string | null;
}

interface GanttResourceRow {
  kind: 'resource';
  id: string;
  resource: Resource;
  bars: GanttBar[];
  services: GanttServiceRange[];
  groupId: string;
  zebra: boolean;
}

type GanttDisplayRow = GanttGroupRow | GanttResourceRow;

interface GanttGroupDefinition {
  id: string;
  label: string;
  icon: string;
  category: string | null;
  resources: Resource[];
}

interface ServiceRangeAccumulator {
  id: string;
  minLeft: number;
  maxRight: number;
  startLeft: number | null;
  endLeft: number | null;
  startMs: number | null;
  endMs: number | null;
}

interface ActivityRepositionEventPayload {
  activity: Activity;
  targetResourceId: string;
  start: Date;
  end: Date | null;
  sourceResourceId?: string | null;
  participantCategory?: ActivityParticipantCategory | null;
  participantResourceId?: string | null;
  isOwnerSlot?: boolean;
}

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface NormalizedRect extends SelectionBox {
  right: number;
  bottom: number;
}

type ActivitySelectionMode = 'set' | 'toggle';

interface ActivitySelectionEventPayload {
  resource: Resource;
  activity: Activity;
  selectionMode: ActivitySelectionMode;
}

interface ActivitySlotSelection {
  activityId: string;
  resourceId: string;
}

interface ActivityDragState {
  activity: Activity;
  sourceResourceId: string;
  sourceResourceKind: Resource['kind'] | null;
  participantResourceId: string;
  participantCategory: ActivityParticipantCategory | null;
  isOwnerSlot: boolean;
  hasEnd: boolean;
  mode: 'move' | 'copy';
  pointerOffsetPx: number | null;
  durationMs: number;
  sourceCell: HTMLElement | null;
  hoverCell: HTMLElement | null;
  hoverRow: HTMLElement | null;
  pendingTarget: {
    resourceId: string;
    resourceKind: Resource['kind'] | null;
    start: Date;
    end: Date | null;
    leftPx: number;
    participantCategory: ActivityParticipantCategory | null;
  } | null;
}

type DragFeedbackState = GanttDragStatus['state'];
type DragFeedback = GanttDragStatus;

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

const RESOURCE_KIND_LABELS: Record<Resource['kind'], string> = {
  'personnel-service': 'Personaldienst',
  'vehicle-service': 'Fahrzeugdienst',
  personnel: 'Personalressource',
  vehicle: 'Fahrzeugressource',
};

const ZOOM_LABELS: Record<string, string> = {
  year: 'Jahr',
  quarter: 'Quartal',
  '2month': '2 Monate',
  month: 'Monat',
  '2week': '2 Wochen',
  week: 'Woche',
  '3day': '3 Tage',
  day: 'Tag',
  '12hour': '12 Stunden',
  '6hour': '6 Stunden',
  '3hour': '3 Stunden',
  hour: '1 Stunde',
  '30min': '30 Minuten',
  '15min': '15 Minuten',
  '10min': '10 Minuten',
  '5min': '5 Minuten',
};

@Component({
  selector: 'app-gantt',
  standalone: true,
  imports: [
    CommonModule,
    ScrollingModule,
    MatIconModule,
    GanttMenuComponent,
    GanttResourcesComponent,
    GanttTimelineRowComponent,
    GanttTimelineHeaderComponent,
    GanttStatusBarComponent,
    TrackHorizontalScrollDirective,
  ],
  templateUrl: './gantt.component.html',
  styleUrl: './gantt.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GanttComponent implements AfterViewInit {
  private readonly timeScale = inject(TimeScaleService);
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly layerGroups = inject(LayerGroupService);
  private readonly resourcesSignal = signal<Resource[]>([]);
  private readonly allowedResourceCategories = new Set([
    'personnel',
    'personnel-service',
    'vehicle',
    'vehicle-service',
  ]);
  private readonly activitiesSignal = signal<PreparedActivity[]>([]);
  private readonly pendingActivitySignal = signal<PreparedActivity | null>(null);
  private readonly filterTerm = signal('');
  private readonly cursorTimeSignal = signal<Date | null>(null);
  private readonly viewportReady = signal(false);
  private minTimelineDaysValue = 1;
  private snapTimelineToMidnightValue = true;
  private timelineRangeInput: { start: Date; end: Date } | null = null;
  private readonly expandedGroups = signal<Set<string>>(new Set());
  private readonly selectedActivityIdsSignal = signal<Set<string>>(new Set());
  private readonly lassoPreviewSelection = signal<Set<string>>(new Set());
  private readonly lassoBoxSignal = signal<SelectionBox | null>(null);
  private readonly activeTouchPointers = new Map<number, { x: number; y: number }>();
  private pinchReferenceDistance: number | null = null;
  private touchPanLastX: number | null = null;
  private touchPointerContainer: HTMLElement | null = null;
  private readonly pinchLogThreshold = 0.08;
  private readonly mousePanActivationThreshold = 4;
  private readonly dragFeedbackSignal = signal<DragFeedback>({ state: 'idle', message: '' });
  private readonly dragTimeFormat = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  private dragState: ActivityDragState | null = null;
  private dragOriginCell: HTMLElement | null = null;
  private dragOriginRow: HTMLElement | null = null;
  private dragBadgeElement: HTMLElement | null = null;
  private activityTypeInfoMap: Record<string, { label: string; showRoute: boolean }> = {};
  private dragEditBlockUntil = 0;
  private dragEditBlockGlobalUntil = 0;
  private dragEditBlockActivityId: string | null = null;
  private mousePanPointerId: number | null = null;
  private mousePanStartX: number | null = null;
  private mousePanLastX: number | null = null;
  private mousePanMoved = false;
  private mousePanContainer: HTMLElement | null = null;
  private lassoState: {
    pointerId: number;
    originX: number;
    originY: number;
    currentX: number;
    currentY: number;
    additive: boolean;
  } | null = null;
  private lassoPointerContainer: HTMLElement | null = null;
  private lassoHits = new Map<string, Set<string>>();
  private readonly lassoActivationThreshold = 6;
  private suppressNextTimelineClick = false;
  private lastOverlapGroupKey: string | null = null;
  private lastOverlapActivityId: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.updateDragBadge(null));
  }

  private extractActivityColor(activity: Activity): string | null {
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const color = attrs?.['color'];
    if (typeof color === 'string' && color.trim().length > 0) {
      return color.trim();
    }
    return null;
  }

  private viewport!: TimeViewport;
  private viewportInitialized = false;
  private lastTimelineRange: { start: number; end: number } | null = null;
  private previousResourceIds: string[] | null = null;
  private previousActivityIds: string[] | null = null;
  private previousActivitySignature: string | null = null;

  @ViewChild('headerScroller', { read: TrackHorizontalScrollDirective })
  private headerScrollerDir?: TrackHorizontalScrollDirective;

  @ViewChildren('rowScroller', { read: TrackHorizontalScrollDirective })
  private rowScrollerDirs?: QueryList<TrackHorizontalScrollDirective>;

  @Output() removeResource = new EventEmitter<Resource['id']>();
  @Output() activitySelectionToggle = new EventEmitter<ActivitySelectionEventPayload>();
  @Output() resourceViewModeChange = new EventEmitter<{ resourceId: string; mode: 'block' | 'detail' }>();
  @Output() serviceAssignmentRequested = new EventEmitter<Resource>();
  @Output() activityCreateRequested = new EventEmitter<{ resource: Resource; start: Date }>();
  @Output() activityEditRequested = new EventEmitter<{ resource: Resource; activity: Activity }>();
  @Output() activityRepositionRequested = new EventEmitter<ActivityRepositionEventPayload>();
  @Output() activityCopyRequested = new EventEmitter<ActivityRepositionEventPayload>();

  @Input()
  set selectedActivityIds(value: string[] | null) {
    const next = new Set(value ?? []);
    this.selectedActivityIdsSignal.set(next);
    this.prunePrimarySelectionSlots(next);
  }

  @Input({ required: true })
  set resources(value: Resource[]) {
    const list = (value ?? []).filter((resource) => this.isDisplayableResource(resource));
    const nextIds = list.map((resource) => resource.id);
    if (this.previousResourceIds && arraysEqual(this.previousResourceIds, nextIds)) {
      return;
    }
    this.previousResourceIds = nextIds;
    this.resourcesSignal.set(list);
    this.resetExpandedGroups(list);
  }

  @Input()
  resourceViewModes: Record<string, 'block' | 'detail'> = {};

  @Input({ required: true })
  set activities(value: Activity[]) {
    const prepared = (value ?? []).map((activity) => {
      const startDate = new Date(activity.start);
      const startMs = startDate.getTime();
      const endMs = activity.end ? new Date(activity.end).getTime() : startMs;
      return {
        ...activity,
        startMs,
        endMs,
        ownerResourceId: getActivityOwnerId(activity),
      };
    });
    const nextIds = prepared.map((activity) => activity.id);
    const signature = prepared
      .map(
        (activity) =>
          [
            activity.id,
            activity.ownerResourceId ?? '',
            activity.startMs,
            activity.endMs,
            // Teilnehmer-Fingerprint, damit neue/entfernte Ressourcen sofort sichtbar werden.
            (activity.participants ?? [])
              .map((participant) => `${participant.resourceId}:${participant.role ?? ''}`)
              .sort()
              .join(','),
          ].join(':'),
      )
      .join('|');
    if (
      this.previousActivityIds &&
      arraysEqual(this.previousActivityIds, nextIds) &&
      this.previousActivitySignature === signature
    ) {
      return;
    }
    this.previousActivityIds = nextIds;
    this.previousActivitySignature = signature;
    this.activitiesSignal.set(prepared);
  }

  @Input()
  set activityTypeInfo(value: Record<string, { label: string; showRoute: boolean }> | null) {
    this.activityTypeInfoMap = value ?? {};
  }

  @Input({ required: true })
  set timelineRange(value: { start: Date; end: Date }) {
    if (!value) {
      this.timelineRangeInput = null;
      return;
    }
    this.timelineRangeInput = {
      start: new Date(value.start),
      end: new Date(value.end),
    };
    this.applyTimelineRange();
  }

  @Input()
  set minTimelineDays(value: number | null | undefined) {
    const parsed = Number.isFinite(value as number) ? Math.max(1, Math.floor((value as number) ?? 1)) : 1;
    if (parsed === this.minTimelineDaysValue) {
      return;
    }
    this.minTimelineDaysValue = parsed;
    this.applyTimelineRange();
  }

  @Input()
  set snapTimelineToMidnight(value: boolean | '') {
    const next = value !== false;
    if (next === this.snapTimelineToMidnightValue) {
      return;
    }
    this.snapTimelineToMidnightValue = next;
    this.applyTimelineRange();
  }

  @Input()
  set pendingActivity(value: Activity | null) {
    if (!value) {
      this.pendingActivitySignal.set(null);
      return;
    }
    const start = new Date(value.start);
    const end = value.end ? new Date(value.end) : new Date(value.start);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      this.pendingActivitySignal.set(null);
      return;
    }
    const prepared: PreparedActivity = {
      ...value,
      start: value.start,
      end: value.end ?? null,
      startMs: start.getTime(),
      endMs: end.getTime(),
      ownerResourceId: getActivityOwnerId(value),
    };
    this.pendingActivitySignal.set(prepared);
  }

  private applyTimelineRange(): void {
    if (!this.timelineRangeInput) {
      return;
    }
    let normalizedStart = this.snapTimelineToMidnightValue
      ? startOfDay(this.timelineRangeInput.start)
      : new Date(this.timelineRangeInput.start);
    let normalizedEndBase = this.snapTimelineToMidnightValue
      ? startOfDay(this.timelineRangeInput.end)
      : new Date(this.timelineRangeInput.end);
    if (!Number.isFinite(normalizedStart.getTime())) {
      normalizedStart = new Date();
    }
    if (!Number.isFinite(normalizedEndBase.getTime())) {
      normalizedEndBase = addDays(normalizedStart, Math.max(1, this.minTimelineDaysValue));
    }
    let normalizedEnd: Date;
    if (normalizedEndBase.getTime() <= normalizedStart.getTime()) {
      normalizedEnd = new Date(normalizedStart.getTime() + MS_IN_DAY);
    } else {
      normalizedEnd = new Date(normalizedEndBase.getTime());
    }
    if (this.snapTimelineToMidnightValue) {
      normalizedEnd = new Date(normalizedEnd.getTime() + MS_IN_DAY);
    }
    const minRangeMs = Math.max(1, this.minTimelineDaysValue) * MS_IN_DAY;
    if (normalizedEnd.getTime() - normalizedStart.getTime() < minRangeMs) {
      normalizedEnd = new Date(normalizedStart.getTime() + minRangeMs);
    }
    const nextRange = {
      start: normalizedStart.getTime(),
      end: normalizedEnd.getTime(),
    };
    if (
      this.lastTimelineRange &&
      this.lastTimelineRange.start === nextRange.start &&
      this.lastTimelineRange.end === nextRange.end
    ) {
      return;
    }
    this.lastTimelineRange = nextRange;
    const startDate = new Date(nextRange.start);
    const endDate = new Date(nextRange.end);
    if (this.viewportInitialized) {
      this.resetViewport(startDate, endDate);
    } else {
      this.initializeViewport(startDate, endDate);
    }
  }


  readonly filteredResources = computed(() => {
    const term = this.filterTerm().trim().toLowerCase();
    const resources = this.resourcesSignal();
    if (!term) {
      return resources;
    }
    return resources.filter((resource) => {
      const base = `${resource.id} ${resource.name}`.toLowerCase();
      const attr = resource.attributes
        ? JSON.stringify(resource.attributes).toLowerCase()
        : '';
      return base.includes(term) || attr.includes(term);
    });
  });

  readonly resourceMap = computed(() => {
    const map = new Map<string, Resource>();
    this.resourcesSignal().forEach((resource) => map.set(resource.id, resource));
    return map;
  });

  readonly resourceKindMap = computed(() => {
    const map = new Map<string, Resource['kind']>();
    this.resourcesSignal().forEach((resource) => map.set(resource.id, resource.kind));
    return map;
  });

  readonly activityMap = computed(() => {
    const map = new Map<string, Activity>();
    this.activitiesSignal().forEach((activity) => map.set(activity.id, activity));
    const pending = this.pendingActivitySignal();
    if (pending) {
      map.set(pending.id, pending);
    }
    return map;
  });

  readonly activitySlotsByResource = computed(() => {
    const allowedResourceIds = new Set(this.resourcesSignal().map((resource) => resource.id));
    const map = new Map<string, PreparedActivitySlot[]>();
    const addSlot = (slot: PreparedActivitySlot) => {
      if (!allowedResourceIds.has(slot.resourceId)) {
        return;
      }
      const list = map.get(slot.resourceId);
      if (list) {
        list.push(slot);
      } else {
        map.set(slot.resourceId, [slot]);
      }
    };
    this.activitiesSignal().forEach((activity) => {
      this.buildParticipantSlots(activity).forEach(addSlot);
    });
    const pending = this.pendingActivitySignal();
    if (pending) {
      this.buildParticipantSlots(pending).forEach(addSlot);
    }
    map.forEach((list) =>
      list.sort(
        (a, b) =>
          a.activity.startMs - b.activity.startMs ||
          a.activity.id.localeCompare(b.activity.id),
      ),
    );
    return map;
  });

  private readonly displayedSelectionIds = computed(() => {
    const base = this.selectedActivityIdsSignal();
    const preview = this.lassoPreviewSelection();
    if (!preview.size) {
      return base;
    }
    const combined = new Set(base);
    preview.forEach((id) => combined.add(id));
    return combined;
  });

  readonly rows = computed<GanttDisplayRow[]>(() => {
    const resources = this.filteredResources();
    const groups = this.buildGroups(resources);
    const expanded = this.expandedGroups();
    const rows: GanttDisplayRow[] = [];
    let resourceIndex = 0;

    const displaySelectedIds = this.displayedSelectionIds();
    const timelineData = this.viewportReady()
      ? this.buildTimelineData(resources, displaySelectedIds)
      : new Map<string, { bars: GanttBar[]; services: GanttServiceRange[] }>();

    groups.forEach((group) => {
      const isExpanded = expanded.has(group.id);
      rows.push({
        kind: 'group',
        id: group.id,
        label: group.label,
        icon: group.icon,
        category: group.category,
        resourceIds: group.resources.map((resource) => resource.id),
        resourceCount: group.resources.length,
        expanded: isExpanded,
      });

      if (!isExpanded) {
        return;
      }

      group.resources.forEach((resource) => {
        const data = timelineData.get(resource.id) ?? { bars: [], services: [] };
        const zebra = resourceIndex % 2 === 1;
        resourceIndex += 1;
        rows.push({
          kind: 'resource',
          id: resource.id,
          resource,
          bars: data.bars,
          services: data.services,
          groupId: group.id,
          zebra,
        });
      });
    });

    return rows;
  });

  readonly ticks = computed(() => {
    if (!this.viewportReady() || !this.timeScale.hasTimelineRange()) {
      return [];
    }
    return this.timeScale.getTicks(this.viewport.viewStart(), this.viewport.viewEnd());
  });

  readonly dragStatus = computed<GanttDragStatus>(() => this.dragFeedbackSignal());

  readonly tickBackgroundSegments = computed<GanttBackgroundSegment[]>(() => {
    if (!this.viewportReady() || !this.timeScale.hasTimelineRange()) {
      return [];
    }
    const segments: GanttBackgroundSegment[] = [];
    this.ticks().forEach((tick) => {
      if (tick.widthPx <= 0) {
        return;
      }
      const classes = ['gantt-timeline-row__background--tick'];
      classes.push(
        tick.index % 2 === 1
          ? 'gantt-timeline-row__background--tick-alt'
          : 'gantt-timeline-row__background--tick-base',
      );
      if (tick.isMajor) {
        classes.push('gantt-timeline-row__background--tick-major');
      }
      segments.push({
        left: tick.offsetPx,
        width: tick.widthPx,
        cssClass: classes.join(' '),
      });
    });
    return segments;
  });

  readonly contentWidth = computed(() =>
    this.viewportReady() && this.timeScale.hasTimelineRange()
      ? this.timeScale.contentWidth()
      : 0,
  );
  readonly scrollX = computed(() => (this.viewportReady() ? this.viewport.scrollX() : 0));

  readonly viewRangeLabel = computed(() => {
    if (!this.viewportReady()) {
      return '';
    }
    const start = this.viewport.viewStart();
    const end = this.inclusiveViewEnd(start);
    return `${this.rangeFormatter.format(start)} – ${this.rangeFormatter.format(end)}`;
  });

  readonly viewStart = computed(() => (this.viewportReady() ? this.viewport.viewStart() : new Date()));
  readonly viewEnd = computed(() => (this.viewportReady() ? this.viewport.viewEnd() : new Date()));
  readonly viewDisplayEnd = computed(() => {
    if (!this.viewportReady()) {
      return new Date();
    }
    return this.inclusiveViewEnd(this.viewport.viewStart());
  });
  readonly zoomLabel = computed(() => (this.viewportReady() ? this.describeZoom(this.viewport.rangeMs()) : '—'));
  readonly resourceCount = computed(() => this.resourcesSignal().length);
  private primarySelectionSlots = new Set<string>();

  readonly nowMarkerLeft = computed(() => {
    if (!this.viewportReady()) {
      return null;
    }
    const now = Date.now();
    const start = this.timeScale.timeToPx(now);
    const timelineStart = this.timeScale.timeToPx(this.viewport.viewStart());
    const timelineEnd = this.timeScale.timeToPx(this.viewport.viewEnd());
    if (now < this.viewport.viewStart().getTime() || now > this.viewport.viewEnd().getTime()) {
      return null;
    }
    return start;
  });

  readonly weekendSegments = computed<GanttBackgroundSegment[]>(() =>
    this.viewportReady()
      ? this.ticks()
          .filter((tick) => tick.isWeekend && tick.widthPx > 0)
          .map((tick) => ({
            left: tick.offsetPx,
            width: tick.widthPx,
            cssClass: 'gantt-timeline-row__background--weekend',
          }))
      : [],
  );

  readonly timelineBackgroundSegments = computed(() => [
    ...this.weekendSegments(),
    ...this.tickBackgroundSegments(),
  ]);

  readonly visibleResourceCount = computed(() =>
    this.rows().reduce((count, row) => (row.kind === 'resource' ? count + 1 : count), 0),
  );
  readonly visibleActivityCount = computed(() =>
    this.rows().reduce(
      (sum, row) => (row.kind === 'resource' ? sum + row.bars.length : sum),
      0,
    ),
  );
  readonly totalActivityCount = computed(() => this.activitiesSignal().length);
  readonly cursorTime = computed(() => this.cursorTimeSignal());
  readonly filterText = computed(() => this.filterTerm());
  readonly hasRows = computed(() => this.rows().length > 0);
  readonly isViewportReady = computed(() => this.viewportReady());
  readonly lassoBox = computed(() => this.lassoBoxSignal());

  rowScrollerElements(): HTMLElement[] {
    return this.rowScrollerDirs
      ? this.rowScrollerDirs.toArray().map((dir) => dir.element)
      : [];
  }

  headerScrollerTargets(): HTMLElement[] | null {
    const element = this.headerScrollerDir?.element ?? null;
    return element ? [element] : null;
  }

  private readonly rangeFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  private readonly serviceLabelFormatter = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  ngAfterViewInit(): void {
    this.setupScrollSyncEffects();
    if (this.rowScrollerDirs) {
      queueMicrotask(() => {
        const scrollLeft = this.scrollX();
        this.rowScrollerDirs?.forEach((dir) => dir.setScrollLeft(scrollLeft));
      });
      this.rowScrollerDirs.changes
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          const scrollLeft = this.scrollX();
          this.rowScrollerDirs?.forEach((dir) => dir.setScrollLeft(scrollLeft));
        });
    }
  }

  onZoomIn() {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.zoomIn(this.viewport.viewCenter());
    this.syncTimeScaleToViewport();
  }

  onZoomOut() {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.zoomOut(this.viewport.viewCenter());
    this.syncTimeScaleToViewport();
  }

  onFilterChange(value: string) {
    this.filterTerm.set(value);
  }

  onGotoToday() {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.gotoToday();
  }

  onGotoDate(date: Date) {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.goto(date);
  }

  onTimelineScroll(scrollLeft: number) {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.setScrollPx(scrollLeft);
  }

  onTimelineWheel(event: WheelEvent, container?: HTMLElement | null) {
    if (!this.viewportReady()) {
      return;
    }
    const host = container ?? this.headerScrollerDir?.element ?? null;
    const preferScroll =
      (!event.ctrlKey && !event.metaKey && !event.altKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) ||
      event.shiftKey;
    if (preferScroll) {
      event.preventDefault();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      this.viewport.scrollBy(delta);
      return;
    }
    event.preventDefault();
    if (event.deltaY === 0) {
      return;
    }
    const factor = Math.exp(event.deltaY * 0.0012);
    this.applyZoomAtPointer(factor, event.clientX, host ?? (event.currentTarget as HTMLElement | null));
  }

  onTimelinePointerDown(event: PointerEvent, container?: HTMLElement | null) {
    if (!this.viewportReady()) {
      return;
    }
    const host = container ?? (event.currentTarget as HTMLElement | null);
    if (!host) {
      return;
    }
    const targetElement = event.target as HTMLElement | null;
    const isActivityTarget = this.isActivityElement(targetElement);
    if (this.isTouchPointer(event)) {
      this.touchPointerContainer = host;
      host.setPointerCapture?.(event.pointerId);
      this.activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.activeTouchPointers.size === 1) {
        this.touchPanLastX = event.clientX;
        this.pinchReferenceDistance = null;
      } else if (this.activeTouchPointers.size === 2) {
        this.touchPanLastX = null;
        this.pinchReferenceDistance = this.computePointerDistance();
      }
      event.preventDefault();
      return;
    }
    if (event.pointerType === 'mouse' && event.button === 0) {
      if (this.shouldStartLasso(event, host, isActivityTarget)) {
        this.beginLassoSelection(event, host);
        event.preventDefault();
        return;
      }
      if (isActivityTarget) {
        return;
      }
      this.mousePanPointerId = event.pointerId;
      this.mousePanStartX = event.clientX;
      this.mousePanLastX = event.clientX;
      this.mousePanMoved = false;
      this.mousePanContainer = host;
      this.suppressNextTimelineClick = false;
      host.setPointerCapture?.(event.pointerId);
    }
  }

  onTimelinePointerMove(event: PointerEvent) {
    if (!this.viewportReady()) {
      return;
    }
    if (this.handleLassoPointerMove(event)) {
      return;
    }
    if (this.isTouchPointer(event)) {
      if (!this.activeTouchPointers.has(event.pointerId)) {
        return;
      }
      this.activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.activeTouchPointers.size === 1 && this.touchPanLastX !== null) {
        const deltaX = event.clientX - this.touchPanLastX;
        if (Math.abs(deltaX) > 0.5) {
          this.viewport.scrollBy(-deltaX);
          this.touchPanLastX = event.clientX;
        }
        event.preventDefault();
        return;
      }
      if (this.activeTouchPointers.size >= 2) {
        const distance = this.computePointerDistance();
        if (distance && this.pinchReferenceDistance) {
          const scale = distance / this.pinchReferenceDistance;
        if (Math.abs(Math.log(scale)) >= this.pinchLogThreshold) {
          const midpointX = this.computePointerMidpointX();
          const factor = scale > 0 ? 1 / scale : 1;
          this.applyZoomAtPointer(factor, midpointX, this.touchPointerContainer);
          this.pinchReferenceDistance = distance;
        }
        } else {
          this.pinchReferenceDistance = distance;
        }
        event.preventDefault();
      }
      return;
    }
    if (event.pointerType === 'mouse' && this.mousePanPointerId === event.pointerId && this.mousePanLastX !== null) {
      const startX = this.mousePanStartX ?? event.clientX;
      const totalDelta = event.clientX - startX;
      if (!this.mousePanMoved && Math.abs(totalDelta) < this.mousePanActivationThreshold) {
        this.mousePanLastX = event.clientX;
        return;
      }
      if (!this.mousePanMoved) {
        this.mousePanMoved = true;
        this.suppressNextTimelineClick = true;
        this.hostElement.nativeElement.classList.add('gantt--panning');
      }
      const deltaX = event.clientX - this.mousePanLastX;
      if (deltaX !== 0) {
        this.viewport.scrollBy(-deltaX);
      }
      this.mousePanLastX = event.clientX;
      if (this.mousePanStartX === null) {
        this.mousePanStartX = startX;
      }
      event.preventDefault();
    }
  }

  onTimelinePointerUp(event: PointerEvent) {
    if (this.handleLassoPointerUp(event)) {
      return;
    }
    if (this.isTouchPointer(event)) {
      if (this.activeTouchPointers.has(event.pointerId)) {
        this.activeTouchPointers.delete(event.pointerId);
      }
      const target = (event.currentTarget as HTMLElement | null) ?? this.touchPointerContainer;
      target?.hasPointerCapture?.(event.pointerId) && target.releasePointerCapture(event.pointerId);
      if (this.activeTouchPointers.size === 0) {
        this.touchPanLastX = null;
        this.touchPointerContainer = null;
      } else if (this.activeTouchPointers.size === 1) {
        const remaining = Array.from(this.activeTouchPointers.values())[0];
        this.touchPanLastX = remaining.x;
      }
      if (this.activeTouchPointers.size < 2) {
        this.pinchReferenceDistance = null;
      }
      return;
    }
    if (event.pointerType === 'mouse' && this.mousePanPointerId === event.pointerId) {
      const target = (event.currentTarget as HTMLElement | null) ?? this.mousePanContainer;
      this.endMousePan(target);
    }
  }

  onTimelineMouseMove(event: MouseEvent, container?: HTMLElement) {
    if (!this.viewportReady()) {
      return;
    }
    const cursorTime = this.getPointerTime(event.clientX, container ?? (event.currentTarget as HTMLElement | null));
    this.cursorTimeSignal.set(cursorTime);
  }

  onTimelineMouseLeave() {
    this.cursorTimeSignal.set(null);
  }

  onGroupToggle(groupId: string) {
    const next = new Set(this.expandedGroups());
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    this.expandedGroups.set(next);
  }

  onResourceRemove(resourceId: string) {
    this.removeResource.emit(resourceId);
  }

  onResourceViewModeChange(resourceId: string, mode: 'block' | 'detail') {
    this.resourceViewModeChange.emit({ resourceId, mode });
  }

  onServiceAssignRequest(resource: Resource) {
    this.serviceAssignmentRequested.emit(resource);
  }

  onTimelineCellClick(event: MouseEvent, resource: Resource, container?: HTMLElement | null) {
    if (!this.viewportReady()) {
      return;
    }
    if (this.suppressNextTimelineClick) {
      this.suppressNextTimelineClick = false;
      return;
    }
    const target = container ?? (event.currentTarget as HTMLElement | null) ?? null;
    const start = this.getPointerTime(event.clientX, target);
    this.activityCreateRequested.emit({ resource, start });
    this.suppressNextTimelineClick = false;
  }

  onActivityEditRequested(resource: Resource, activity: Activity) {
    if (this.shouldBlockEdit(activity.id)) {
      return;
    }
    const group = this.findOverlappingActivities(resource.id, activity);
    if (group.length <= 1) {
      this.lastOverlapGroupKey = null;
      this.lastOverlapActivityId = null;
      this.activityEditRequested.emit({ resource, activity });
      return;
    }
    const groupKey = group
      .map((entry) => entry.id)
      .sort()
      .join('|');
    let nextIndex = 0;
    if (this.lastOverlapGroupKey === groupKey && this.lastOverlapActivityId) {
      const currentIndex = group.findIndex((entry) => entry.id === this.lastOverlapActivityId);
      if (currentIndex >= 0) {
        nextIndex = (currentIndex + 1) % group.length;
      }
    } else {
      const clickedIndex = group.findIndex((entry) => entry.id === activity.id);
      nextIndex = clickedIndex >= 0 ? clickedIndex : 0;
    }
    const target = group[nextIndex];
    this.lastOverlapGroupKey = groupKey;
    this.lastOverlapActivityId = target.id;
    this.activityEditRequested.emit({ resource, activity: target });
  }

  onActivitySelectionToggle(resource: Resource, event: GanttActivitySelectionEvent) {
    if (event.selectionMode === 'set') {
      this.setPrimarySelectionSlots([{ activityId: event.activity.id, resourceId: resource.id }]);
    } else {
      const currentlySelected = this.selectedActivityIdsSignal().has(event.activity.id);
      if (currentlySelected) {
        this.removePrimarySelectionSlot(event.activity.id, resource.id);
      } else {
        this.addPrimarySelectionSlots([{ activityId: event.activity.id, resourceId: resource.id }]);
      }
    }
    this.activitySelectionToggle.emit({
      resource,
      activity: event.activity,
      selectionMode: event.selectionMode,
    });
  }

  onActivityDragStarted(event: CdkDragStart<GanttActivityDragData>) {
    if (!this.viewportReady()) {
      this.setDragFeedback('invalid', 'Zeitachse nicht bereit.');
      return;
    }
    this.suppressNextTimelineClick = true;
    this.blockActivityEdit(event.source.data.activity.id);
    const activity = event.source.data.activity;
    const sourceCell = this.findTimelineCellForElement(event.source.element.nativeElement);
    const sourceResourceKind =
      this.resourceKindMap().get(event.source.data.resourceId) ?? null;
    const participantCategory =
      event.source.data.participantCategory ??
      this.resourceCategoryFromKind(sourceResourceKind);
    this.dragState = {
      activity,
      sourceResourceId: event.source.data.resourceId,
      sourceResourceKind,
      participantResourceId: event.source.data.participantResourceId ?? event.source.data.resourceId,
      participantCategory,
      isOwnerSlot: event.source.data.isOwnerSlot ?? true,
      mode: event.source.data.mode ?? 'move',
      hasEnd: !!activity.end,
      pointerOffsetPx: null,
      durationMs:
        activity.end && activity.end.length > 0
          ? new Date(activity.end).getTime() - new Date(activity.start).getTime()
          : 0,
      sourceCell,
      hoverCell: null,
      hoverRow: null,
      pendingTarget: null,
    };
    this.hostElement.nativeElement.classList.add('gantt--dragging');
    this.setDragOriginCell(sourceCell);
    this.applyDragHoverCell(sourceCell);
    this.setDragFeedback('info', 'Leistung wird verschoben …');
  }

  onActivityDragMoved(event: CdkDragMove<GanttActivityDragData>) {
    if (!this.viewportReady() || !this.dragState) {
      return;
    }
    const pointer = event.pointerPosition;
    const pointerCell = this.findResourceCellAtPoint(pointer.x, pointer.y);
    const positionCell = pointerCell ?? this.dragState.sourceCell;
    if (!positionCell) {
      this.dragState.pendingTarget = null;
      this.applyDragHoverCell(null);
      this.updateDragBadge('Außerhalb Bereich', pointer);
      this.setDragFeedback('invalid', 'Zeiger außerhalb der Ressourcen.');
      return;
    }
    if (pointerCell !== this.dragState.hoverCell) {
      this.applyDragHoverCell(pointerCell);
    }
    if (this.dragState.pointerOffsetPx === null) {
      const rect = positionCell.getBoundingClientRect();
      const pointerRelativeX = pointer.x - rect.left + positionCell.scrollLeft;
      const barLeft = event.source.data.initialLeft;
      this.dragState.pointerOffsetPx = pointerRelativeX - barLeft;
    }
    const pointerOffset = this.dragState.pointerOffsetPx ?? 0;
    const rect = positionCell.getBoundingClientRect();
    const relativeX = pointer.x - rect.left + positionCell.scrollLeft;
    const targetLeft = relativeX - pointerOffset;
    const clampedLeft = this.clampTimelineLeftPx(targetLeft);
    const pointerResourceId = pointerCell?.dataset['resourceId'] ?? null;
    const pointerResourceKind =
      pointerResourceId ? this.resourceKindMap().get(pointerResourceId) ?? null : null;
    const fallbackResourceId =
      this.dragState.pendingTarget?.resourceId ?? this.dragState.sourceResourceId;
    const targetResourceId = pointerResourceId ?? fallbackResourceId;
    let targetResourceKind =
      pointerResourceKind ??
      (targetResourceId === this.dragState.sourceResourceId
        ? this.dragState.sourceResourceKind
        : this.dragState.pendingTarget?.resourceKind ?? null);
    const sameResource = targetResourceId === this.dragState.sourceResourceId;
    const sourceKind =
      this.resourceKindMap().get(this.dragState.sourceResourceId) ?? this.dragState.sourceResourceKind;
    this.dragState.sourceResourceKind = sourceKind ?? this.dragState.sourceResourceKind ?? null;
    const requiredCategory = this.dragState.participantCategory;
    const pointerCategory = pointerResourceKind
      ? this.resourceCategoryFromKind(pointerResourceKind)
      : null;
    const categoryMismatch = (candidate: ActivityParticipantCategory | null) => {
      if (!requiredCategory || requiredCategory === 'other') {
        return false;
      }
      if (!candidate || candidate === 'other') {
        return true;
      }
      return candidate !== requiredCategory;
    };
    if (!sameResource) {
      if (pointerResourceId && pointerResourceId !== this.dragState.sourceResourceId) {
        if (categoryMismatch(pointerCategory)) {
          this.dragState.pendingTarget = null;
          this.applyDragHoverCell(pointerCell);
          this.updateDragBadge(
            `Nur ${this.describeParticipantCategory(requiredCategory)}`,
            pointer,
          );
          this.setDragFeedback(
            'invalid',
            `Nur ${this.describeParticipantCategory(requiredCategory)} können dieses Element aufnehmen.`,
          );
          return;
        }
        targetResourceKind = pointerResourceKind;
      } else {
        if (
          !this.dragState.pendingTarget ||
          this.dragState.pendingTarget.resourceId === this.dragState.sourceResourceId
        ) {
          this.dragState.pendingTarget = null;
          this.applyDragHoverCell(pointerCell);
          this.updateDragBadge('Kein Ziel', pointer);
          this.setDragFeedback('invalid', 'Kein gültiger Zielbereich ausgewählt.');
          return;
        }
        targetResourceKind = this.dragState.pendingTarget.resourceKind;
      }
    } else if (pointerResourceId && categoryMismatch(pointerCategory)) {
      this.dragState.pendingTarget = null;
      this.applyDragHoverCell(pointerCell);
      this.updateDragBadge(
        `Nur ${this.describeParticipantCategory(requiredCategory)}`,
        pointer,
      );
      this.setDragFeedback(
        'invalid',
        `Nur ${this.describeParticipantCategory(requiredCategory)} können dieses Element aufnehmen.`,
      );
      return;
    }
    let startTime = this.timeScale.pxToTime(clampedLeft);
    let endTime =
      this.dragState.hasEnd && this.dragState.durationMs > 0
        ? new Date(startTime.getTime() + this.dragState.durationMs)
        : null;
    if (!sameResource) {
      startTime = new Date(this.dragState.activity.start);
      endTime =
        this.dragState.hasEnd && this.dragState.activity.end
          ? new Date(this.dragState.activity.end)
          : null;
    }
    this.dragState.pendingTarget = {
      resourceId: targetResourceId,
      resourceKind: targetResourceKind ?? null,
      start: startTime,
      end: endTime,
      leftPx: clampedLeft,
      participantCategory: pointerCategory ?? this.dragState.participantCategory ?? null,
    };
    const badgeLabel = sameResource
      ? `${this.formatTimeLabel(startTime)}`
      : `${this.getResourceName(targetResourceId)} • ${this.formatTimeLabel(startTime)}`;
    this.updateDragBadge(badgeLabel, pointer);
    if (sameResource) {
      const verb = this.dragState.mode === 'copy' ? 'kopiert' : 'verschoben';
      this.setDragFeedback(
        'valid',
        `Loslassen ${verb} Start auf ${this.formatTimeLabel(startTime)}.`,
      );
    } else {
      const verb = this.dragState.mode === 'copy' ? 'kopiert' : 'verschiebt';
      this.setDragFeedback(
        'valid',
        `Loslassen ${verb} auf "${this.getResourceName(targetResourceId)}".`,
      );
    }
  }

  onActivityDragEnded(event: CdkDragEnd<GanttActivityDragData>) {
    if (!this.dragState) {
      return;
    }
    this.blockActivityEdit(this.dragState.activity.id);
    this.hostElement.nativeElement.classList.remove('gantt--dragging');
    this.applyDragHoverCell(null);
    this.setDragOriginCell(null);
    this.updateDragBadge(null);
    const pending = this.dragState.pendingTarget;
    const activity = this.dragState.activity;
    const originalStartMs = new Date(activity.start).getTime();
    const originalEndMs =
      this.dragState.hasEnd && activity.end ? new Date(activity.end).getTime() : null;
    if (!pending) {
      this.setDragFeedback('invalid', 'Keine gültige Zielposition – Aktion verworfen.');
      event.source.reset();
      this.dragState = null;
      return;
    }
    const pendingEndMs = pending.end ? pending.end.getTime() : null;
    const changedStart = pending.start.getTime() !== originalStartMs;
    const changedDuration = pendingEndMs !== originalEndMs;
    const resourceChanged = pending.resourceId !== this.dragState.sourceResourceId;
    if (resourceChanged || changedStart || changedDuration) {
      const emitEnd =
        this.dragState.hasEnd && pending.end
          ? pending.end
          : this.dragState.hasEnd
            ? new Date(pending.start)
            : null;
      const payload: ActivityRepositionEventPayload = {
        activity,
        start: pending.start,
        end: emitEnd,
        targetResourceId: pending.resourceId,
        sourceResourceId: this.dragState.sourceResourceId,
        participantCategory: this.dragState.participantCategory,
        participantResourceId: this.dragState.participantResourceId,
        isOwnerSlot: this.dragState.isOwnerSlot,
      };
      if (this.dragState.mode === 'copy') {
        this.activityCopyRequested.emit(payload);
        if (resourceChanged) {
          this.setDragFeedback(
            'info',
            `Leistung auf "${this.getResourceName(pending.resourceId)}" kopiert.`,
          );
        } else {
          this.setDragFeedback(
            'info',
            `Kopie bei ${this.formatTimeLabel(pending.start)} erstellt.`,
          );
        }
      } else {
        this.activityRepositionRequested.emit(payload);
        if (resourceChanged) {
          this.setDragFeedback(
            'info',
            `Leistung auf "${this.getResourceName(pending.resourceId)}" verschoben.`,
          );
        } else if (changedStart || changedDuration) {
          this.setDragFeedback(
            'info',
            `Startzeit aktualisiert (${this.formatTimeLabel(pending.start)}).`,
          );
        }
      }
    } else {
      this.setDragFeedback('info', 'Keine Änderung – ursprüngliche Position bleibt erhalten.');
    }
    event.source.reset();
    this.dragState = null;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent) {
    if (!this.viewportReady()) {
      return;
    }
    const active = (document.activeElement ?? null) as HTMLElement | null;
    if (active && !this.hostElement.nativeElement.contains(active)) {
      return;
    }
    if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) {
      return;
    }
    switch (event.key) {
      case 'h':
      case 'H':
        event.preventDefault();
        this.onGotoToday();
        break;
      case '+':
      case '=':
        event.preventDefault();
        this.viewport.zoomIn(this.viewport.viewCenter());
        this.syncTimeScaleToViewport();
        break;
      case '-':
      case '_':
        event.preventDefault();
        this.viewport.zoomOut(this.viewport.viewCenter());
        this.syncTimeScaleToViewport();
        break;
      default:
        break;
    }
  }

  private initializeViewport(start: Date, end: Date) {
    if (this.viewportInitialized) {
      return;
    }
    this.timeScale.setTimelineRange(start, end);
    this.viewport = createTimeViewport({
      timelineStart: start,
      timelineEnd: end,
      initialRangeMs: this.computeInitialRange(start, end, ZOOM_RANGE_MS['week']),
      initialCenter: start,
    });
    this.viewportInitialized = true;
    this.syncTimeScaleToViewport();
    this.viewportReady.set(true);
  }

  private resetViewport(start: Date, end: Date) {
    const previousRange = this.viewport?.rangeMs() ?? ZOOM_RANGE_MS['week'];
    const previousCenter = this.viewport?.viewCenter() ?? start;
    this.viewportReady.set(false);
    this.timeScale.setTimelineRange(start, end);
    this.viewport = createTimeViewport({
      timelineStart: start,
      timelineEnd: end,
      initialRangeMs: this.computeInitialRange(start, end, previousRange),
      initialCenter: this.clampCenter(previousCenter, start, end),
    });
    this.syncTimeScaleToViewport();
    this.viewportReady.set(true);
  }

  private computeInitialRange(start: Date, end: Date, requested: number): number {
    const duration = Math.max(1, end.getTime() - start.getTime());
    const shortTimelineThreshold = 12 * MS_IN_DAY;
    if (duration > shortTimelineThreshold) {
      return requested;
    }
    const desired = Math.min(duration, 5 * MS_IN_DAY);
    return Math.max(requested, desired);
  }

  private setupScrollSyncEffects() {
    runInInjectionContext(this.injector, () => {
      effect(() => {
        if (!this.viewportReady()) {
          return;
        }
        const scrollLeft = this.scrollX();
        this.headerScrollerDir?.setScrollLeft(scrollLeft);
        this.rowScrollerDirs?.forEach((dir) => dir.setScrollLeft(scrollLeft));
      }, { allowSignalWrites: true });
    });
  }

  private setDragFeedback(state: DragFeedbackState, message: string) {
    this.dragFeedbackSignal.set({ state, message });
  }

  private getResourceName(id: string | null): string {
    if (!id) {
      return '';
    }
    return this.resourceMap().get(id)?.name ?? id;
  }

  private formatTimeLabel(date: Date): string {
    return this.dragTimeFormat.format(date);
  }

  private describeResourceKind(kind: Resource['kind'] | null): string {
    if (!kind) {
      return 'Ressource';
    }
    return RESOURCE_KIND_LABELS[kind] ?? 'Ressource';
  }

  private describeParticipantCategory(category: ActivityParticipantCategory | null): string {
    switch (category) {
      case 'vehicle':
        return 'Fahrzeugressourcen';
      case 'personnel':
        return 'Personalressourcen';
      default:
        return 'passende Ressourcen';
    }
  }

  private setDragOriginCell(cell: HTMLElement | null) {
    if (this.dragOriginCell === cell) {
      return;
    }
    this.dragOriginCell?.classList.remove('gantt__timeline-cell--drag-origin');
    this.dragOriginRow?.classList.remove('gantt__row--drag-origin');
    if (cell) {
      cell.classList.add('gantt__timeline-cell--drag-origin');
      const row = this.findRowForCell(cell);
      row?.classList.add('gantt__row--drag-origin');
      this.dragOriginRow = row;
    } else {
      this.dragOriginRow = null;
    }
    this.dragOriginCell = cell;
  }

  private applyDragHoverCell(cell: HTMLElement | null) {
    if (!this.dragState) {
      return;
    }
    if (this.dragState.hoverCell === cell) {
      return;
    }
    this.dragState.hoverCell?.classList.remove('gantt__timeline-cell--drag-hover');
    this.dragState.hoverRow?.classList.remove('gantt__row--drag-hover');
    if (cell) {
      cell.classList.add('gantt__timeline-cell--drag-hover');
      const row = this.findRowForCell(cell);
      if (row) {
        row.classList.add('gantt__row--drag-hover');
      }
      this.dragState.hoverRow = row ?? null;
    } else {
      this.dragState.hoverRow = null;
    }
    this.dragState.hoverCell = cell;
  }

  private findRowForCell(cell: HTMLElement | null): HTMLElement | null {
    if (!cell) {
      return null;
    }
    return cell.closest('.gantt__row') as HTMLElement | null;
  }

  private updateDragBadge(label: string | null, pointer?: { x: number; y: number }) {
    if (!label) {
      if (this.dragBadgeElement) {
        this.dragBadgeElement.remove();
        this.dragBadgeElement = null;
      }
      return;
    }
    if (!this.dragBadgeElement) {
      const badge = document.createElement('div');
      badge.className = 'gantt-drag-badge';
      document.body.appendChild(badge);
      this.dragBadgeElement = badge;
    }
    this.dragBadgeElement.textContent = label;
    if (pointer) {
      const offsetX = 0;
      const offsetY = -30;
      this.dragBadgeElement.style.left = `${pointer.x + offsetX}px`;
      this.dragBadgeElement.style.top = `${pointer.y + offsetY}px`;
    }
  }

  private getPointerTime(clientX: number, container: HTMLElement | null): Date {
    if (!container) {
      return this.viewport.viewCenter();
    }
    const rect = container.getBoundingClientRect();
    const relativeX = clientX - rect.left + container.scrollLeft;
    return this.timeScale.pxToTime(relativeX);
  }

  private endMousePan(target?: HTMLElement | null): void {
    if (this.mousePanPointerId !== null) {
      const host = target ?? this.mousePanContainer;
      if (host?.hasPointerCapture?.(this.mousePanPointerId)) {
        host.releasePointerCapture(this.mousePanPointerId);
      }
    }
    if (this.mousePanMoved) {
      this.hostElement.nativeElement.classList.remove('gantt--panning');
    }
    this.mousePanPointerId = null;
    this.mousePanStartX = null;
    this.mousePanLastX = null;
    this.mousePanContainer = null;
    this.mousePanMoved = false;
  }

  private findTimelineCellForElement(element: HTMLElement | null): HTMLElement | null {
    if (!element) {
      return null;
    }
    return element.closest('.gantt__timeline-cell') as HTMLElement | null;
  }

  private applyZoomAtPointer(factor: number, clientX: number, container: HTMLElement | null) {
    if (!this.viewportReady()) {
      return;
    }
    const host = container ?? this.headerScrollerDir?.element ?? null;
    const focus = this.getPointerTime(clientX, host);
    const safeFactor = Math.min(Math.max(factor, 0.2), 5);
    this.viewport.zoomBy(safeFactor, focus);
    this.syncTimeScaleToViewport();
    const pointerPx = this.timeScale.timeToPx(focus);
    const offset = this.computeViewportOffset(clientX, host);
    this.viewport.setScrollPx(pointerPx - offset);
  }

  private computeViewportOffset(clientX: number, container: HTMLElement | null): number {
    const target = container ?? (this.headerScrollerDir?.element ?? this.hostElement.nativeElement);
    const rect = target.getBoundingClientRect();
    const raw = clientX - rect.left;
    const clamped = Math.min(Math.max(raw, 0), target.clientWidth || raw);
    return Number.isFinite(clamped) ? clamped : 0;
  }

  private shouldStartLasso(event: PointerEvent, host: HTMLElement | null, isActivityTarget: boolean): boolean {
    if (!host || isActivityTarget) {
      return false;
    }
    if (!host.dataset['resourceId']) {
      return false;
    }
    return event.shiftKey || event.altKey || event.metaKey || event.ctrlKey;
  }

  private beginLassoSelection(event: PointerEvent, host: HTMLElement): void {
    this.lassoState = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      additive: event.metaKey || event.ctrlKey,
    };
    this.lassoPointerContainer = host;
    this.lassoHits = new Map<string, Set<string>>();
    this.lassoPreviewSelection.set(new Set());
    this.lassoBoxSignal.set(null);
    host.setPointerCapture?.(event.pointerId);
  }

  private handleLassoPointerMove(event: PointerEvent): boolean {
    if (!this.lassoState || event.pointerId !== this.lassoState.pointerId) {
      return false;
    }
    this.lassoState.currentX = event.clientX;
    this.lassoState.currentY = event.clientY;
    this.updateLassoVisual();
    event.preventDefault();
    return true;
  }

  private handleLassoPointerUp(event: PointerEvent): boolean {
    if (!this.lassoState || event.pointerId !== this.lassoState.pointerId) {
      return false;
    }
    const rect = this.computeLassoRect();
    const target = (event.currentTarget as HTMLElement | null) ?? this.lassoPointerContainer;
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    const hits = new Map<string, Set<string>>();
    this.lassoHits.forEach((set, activityId) => hits.set(activityId, new Set(set)));
    const additive = this.lassoState.additive;
    this.resetLassoState();
    if (!rect) {
      return false;
    }
    this.suppressNextTimelineClick = true;
    if (hits.size === 0) {
      event.preventDefault();
      return true;
    }
    this.applyLassoSelection(hits, additive);
    event.preventDefault();
    return true;
  }

  private updateLassoVisual(): void {
    const rect = this.computeLassoRect();
    if (!rect) {
      this.lassoBoxSignal.set(null);
      this.lassoPreviewSelection.set(new Set());
    this.lassoHits = new Map<string, Set<string>>();
      return;
    }
    const hostRect = this.hostElement.nativeElement.getBoundingClientRect();
    const box: SelectionBox = {
      left: rect.left - hostRect.left,
      top: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    };
    this.lassoBoxSignal.set(box);
    this.updateLassoHits(rect);
  }

  private computeLassoRect(): NormalizedRect | null {
    if (!this.lassoState) {
      return null;
    }
    const { originX, originY, currentX, currentY } = this.lassoState;
    const width = Math.abs(currentX - originX);
    const height = Math.abs(currentY - originY);
    if (width < this.lassoActivationThreshold && height < this.lassoActivationThreshold) {
      return null;
    }
    const left = Math.min(originX, currentX);
    const top = Math.min(originY, currentY);
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  private updateLassoHits(rect: NormalizedRect): void {
    const hits = new Map<string, Set<string>>();
    const preview = new Set<string>();
    const elements = this.hostElement.nativeElement.querySelectorAll(
      '.gantt-activity[data-activity-id]',
    );
    elements.forEach((element: Element) => {
      const activityElement = element as HTMLElement;
      const activityId = activityElement.dataset['activityId'] ?? '';
      const resourceId = activityElement.dataset['resourceId'] ?? '';
      if (!activityId || !resourceId) {
        return;
      }
      const targetRect = activityElement.getBoundingClientRect();
      if (!this.rectanglesOverlap(rect, targetRect)) {
        return;
      }
      let record = hits.get(activityId);
      if (!record) {
        record = new Set<string>();
        hits.set(activityId, record);
      }
      record.add(resourceId);
      preview.add(activityId);
    });
    this.lassoHits = hits;
    this.lassoPreviewSelection.set(preview);
  }

  private rectanglesOverlap(a: NormalizedRect, b: DOMRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  private resetLassoState(): void {
    if (this.lassoPointerContainer) {
      this.lassoPointerContainer = null;
    }
    this.lassoState = null;
    this.lassoHits = new Map<string, Set<string>>();
    this.lassoPreviewSelection.set(new Set());
    this.lassoBoxSignal.set(null);
  }

  private encodeSelectionSlot(activityId: string, resourceId: string): string {
    return `${activityId}:::${resourceId}`;
  }

  private decodeSelectionSlot(key: string): ActivitySlotSelection {
    const [activityId, resourceId] = key.split(':::', 2);
    return {
      activityId,
      resourceId: resourceId ?? '',
    };
  }

  private prunePrimarySelectionSlots(validActivityIds: ReadonlySet<string>): void {
    if (validActivityIds.size === 0) {
      this.primarySelectionSlots = new Set();
      return;
    }
    const next = new Set<string>();
    this.primarySelectionSlots.forEach((key) => {
      const { activityId } = this.decodeSelectionSlot(key);
      if (validActivityIds.has(activityId)) {
        next.add(key);
      }
    });
    this.primarySelectionSlots = next;
  }

  private setPrimarySelectionSlots(slots: Iterable<ActivitySlotSelection>): void {
    const next = new Set<string>();
    for (const slot of slots) {
      next.add(this.encodeSelectionSlot(slot.activityId, slot.resourceId));
    }
    this.primarySelectionSlots = next;
  }

  private addPrimarySelectionSlots(slots: Iterable<ActivitySlotSelection>): void {
    const next = new Set(this.primarySelectionSlots);
    for (const slot of slots) {
      next.add(this.encodeSelectionSlot(slot.activityId, slot.resourceId));
    }
    this.primarySelectionSlots = next;
  }

  private removePrimarySelectionSlot(activityId: string, resourceId: string): void {
    const key = this.encodeSelectionSlot(activityId, resourceId);
    if (!this.primarySelectionSlots.has(key)) {
      return;
    }
    const next = new Set(this.primarySelectionSlots);
    next.delete(key);
    this.primarySelectionSlots = next;
  }

  private applyLassoSelection(hits: Map<string, Set<string>>, additive: boolean): void {
    const entries = Array.from(hits.entries());
    if (!entries.length) {
      return;
    }
    const slots: ActivitySlotSelection[] = [];
    entries.forEach(([activityId, resourceIds]) => {
      resourceIds.forEach((resourceId) => {
        slots.push({ activityId, resourceId });
      });
    });
    if (!slots.length) {
      return;
    }
    if (additive) {
      this.addPrimarySelectionSlots(slots);
    } else {
      this.setPrimarySelectionSlots(slots);
    }
    entries.forEach(([activityId, resourceIds], index) => {
      const iterator = resourceIds.values().next();
      if (iterator.done) {
        return;
      }
      const resourceId = iterator.value;
      const resource = this.resourceMap().get(resourceId);
      const activity = this.activityMap().get(activityId);
      if (!resource || !activity) {
        return;
      }
      const mode: ActivitySelectionMode = !additive && index === 0 ? 'set' : 'toggle';
      this.activitySelectionToggle.emit({
        resource,
        activity,
        selectionMode: mode,
      });
    });
  }

  private isActivityElement(element: HTMLElement | null): boolean {
    if (!element) {
      return false;
    }
    return !!element.closest('.gantt-activity');
  }

  private findResourceCellAtPoint(x: number, y: number): HTMLElement | null {
    const host = this.hostElement.nativeElement;
    const stack = document.elementsFromPoint(x, y) as HTMLElement[];
    for (const element of stack) {
      if (!host.contains(element)) {
        continue;
      }
      const cell = this.findTimelineCellForElement(element);
      if (cell && cell.dataset['resourceId']) {
        return cell;
      }
    }
    return null;
  }

  private clampTimelineLeftPx(value: number): number {
    const width = this.timeScale.contentWidth();
    if (!Number.isFinite(width) || width <= 0) {
      return Math.max(0, value);
    }
    return Math.min(Math.max(0, value), width);
  }

  private inclusiveViewEnd(viewStart: Date): Date {
    const startMs = viewStart.getTime();
    const exclusiveEnd = this.viewport.viewEnd();
    const exclusiveMs = exclusiveEnd.getTime();
    const inclusiveMs = Math.max(startMs, exclusiveMs - 1);
    return new Date(inclusiveMs);
  }

  private buildTimelineData(
    resources: Resource[],
    selectedIds: ReadonlySet<string>,
  ): Map<string, { bars: GanttBar[]; services: GanttServiceRange[] }> {
    const map = new Map<string, { bars: GanttBar[]; services: GanttServiceRange[] }>();
    if (!this.viewportReady()) {
      resources.forEach((resource) => map.set(resource.id, { bars: [], services: [] }));
      return map;
    }

    const pending = this.pendingActivitySignal();
    const pendingId = pending?.id ?? null;
    const start = this.viewport.viewStart();
    const end = this.viewport.viewEnd();
    const startMs = start.getTime();
    const endMs = end.getTime();
    const pxPerMs = this.timeScale.pixelsPerMs();

    const primarySlots = this.primarySelectionSlots;

    resources.forEach((resource) => {
      const slots = this.activitySlotsByResource().get(resource.id) ?? [];
      const bars: GanttBar[] = [];
      const serviceMap = new Map<string, ServiceRangeAccumulator>();
      for (const slot of slots) {
        const activity = slot.activity;
        if (activity.endMs < startMs - 2 * 60 * 60 * 1000 || activity.startMs > endMs + 2 * 60 * 60 * 1000) {
          continue;
        }
        const rawLeft = this.timeScale.timeToPx(activity.startMs);
        const rawRight = this.timeScale.timeToPx(activity.endMs);
        const displayInfo = this.activityDisplayInfo(activity);
        const isMilestone = !activity.end;
        const left = Math.round(rawLeft);
        const right = Math.round(rawRight);
        let barWidth = Math.max(1, right - left);
        let barLeft = left;
        if (isMilestone) {
          barWidth = 24;
          barLeft = Math.round(rawLeft) - Math.floor(barWidth / 2);
          const contentWidth = this.timeScale.contentWidth();
          const maxLeft = Math.max(0, contentWidth - barWidth);
          barLeft = Math.min(Math.max(0, barLeft), maxLeft);
        }
        const classes = this.resolveBarClasses(activity);
        if (isMilestone) {
          classes.push('gantt-activity--milestone');
        }
        // Erweiterte Darstellung aus Attributen (draw_as / layer)
        const attrMap = activity.attributes as Record<string, unknown> | undefined;
        const drawAs =
          typeof attrMap?.['draw_as'] === 'string' ? (attrMap['draw_as'] as string) : null;
        const layerGroupId =
          typeof attrMap?.['layer_group'] === 'string'
            ? (attrMap['layer_group'] as string)
            : typeof attrMap?.['layer'] === 'string'
              ? (attrMap['layer'] as string)
              : null;
        const layerGroup = this.layerGroups.getById(layerGroupId) ?? this.layerGroups.getById('default');
        switch (drawAs) {
          case 'line-above':
            classes.push('gantt-activity--draw-line-above');
            break;
          case 'line-below':
            classes.push('gantt-activity--draw-line-below');
            break;
          case 'shift-up':
            classes.push('gantt-activity--draw-shift-up');
            break;
          case 'shift-down':
            classes.push('gantt-activity--draw-shift-down');
            break;
          case 'dot':
            classes.push('gantt-activity--draw-dot');
            break;
          case 'square':
            classes.push('gantt-activity--draw-square');
            break;
          case 'triangle-up':
            classes.push('gantt-activity--draw-triangle-up');
            break;
          case 'triangle-down':
            classes.push('gantt-activity--draw-triangle-down');
            break;
          case 'thick':
            classes.push('gantt-activity--draw-thick');
            break;
          case 'background':
            classes.push('gantt-activity--draw-background');
            break;
          default:
            break;
        }
        if (layerGroup?.id === 'background') {
          classes.push('gantt-activity--layer-background');
        } else if (layerGroup?.id === 'marker') {
          classes.push('gantt-activity--layer-marker');
        }
        const isPending = pendingId === activity.id;
        if (isPending) {
          classes.push('gantt-activity--ghost', 'gantt-activity--pending');
        }
        const isMirror = !slot.isOwner;
        if (isMirror) {
          classes.push('gantt-activity--mirror');
        }
        const primarySelected = primarySlots.has(this.encodeSelectionSlot(activity.id, slot.resourceId));
        bars.push({
          id: slot.id,
          activity,
          left: barLeft,
          width: barWidth,
          classes,
          color: this.extractActivityColor(activity),
          dragDisabled: false,
          selected: selectedIds.has(activity.id),
          primarySelected,
          label: displayInfo.label,
          showRoute: !isMilestone && displayInfo.showRoute && !!(activity.from || activity.to),
          isMirror,
          zIndex: layerGroup?.order,
          participantResourceId: slot.resourceId,
          participantCategory: slot.category,
          isOwner: slot.isOwner,
          roleIcon: slot.icon,
          roleLabel: slot.iconLabel,
        });
        const serviceId = activity.serviceId;
        if (!serviceId) {
          continue;
        }
        const displayStart = isMilestone ? barLeft + Math.round(barWidth / 2) : left;
        const displayEnd = isMilestone ? barLeft + Math.round(barWidth / 2) : right;
        let accumulator = serviceMap.get(serviceId);
        if (!accumulator) {
          accumulator = {
            id: serviceId,
            minLeft: Number.POSITIVE_INFINITY,
            maxRight: Number.NEGATIVE_INFINITY,
            startLeft: null,
            endLeft: null,
            startMs: null,
            endMs: null,
          };
          serviceMap.set(serviceId, accumulator);
        }
        accumulator.minLeft = Math.min(accumulator.minLeft, displayStart);
        accumulator.maxRight = Math.max(accumulator.maxRight, displayEnd);
        if (
          (activity.type === 'service-start' || activity.serviceRole === 'start') &&
          (accumulator.startLeft === null || displayStart < accumulator.startLeft)
        ) {
          accumulator.startLeft = displayStart;
          accumulator.startMs = activity.startMs;
        }
        if (
          (activity.type === 'service-end' || activity.serviceRole === 'end') &&
          (accumulator.endLeft === null || displayEnd > accumulator.endLeft)
        ) {
          accumulator.endLeft = displayEnd;
          accumulator.endMs = activity.endMs;
        }
      }
      const services = Array.from(serviceMap.values())
        .map((entry) => this.createServiceRange(entry))
        .filter((range): range is GanttServiceRange => !!range);
      map.set(resource.id, { bars, services });
    });

    return map;
  }

  private buildParticipantSlots(activity: PreparedActivity): PreparedActivitySlot[] {
    if (!activity.participants || activity.participants.length === 0) {
      return [];
    }
    const owners = getActivityOwnersByCategory(activity);
    return activity.participants
      .filter((participant): participant is ActivityParticipant => !!participant?.resourceId)
      .map((participant, index) => {
        const category = classifyParticipant(participant);
        const ownerMatch =
          (category === 'vehicle' &&
            owners.vehicle?.resourceId === participant.resourceId) ||
          (category === 'personnel' &&
            owners.personnel?.resourceId === participant.resourceId);
        const isOwner =
          ownerMatch ||
          (category === 'other' && index === 0 && !owners.vehicle && !owners.personnel);
        const iconInfo = this.participantRoleIcon(participant, isOwner, category);
        return {
          id: `${activity.id}:${participant.resourceId}`,
          activity,
          participant,
          resourceId: participant.resourceId,
          category,
          isOwner,
          icon: iconInfo.icon,
          iconLabel: iconInfo.label,
        };
      });
  }

  private buildGroups(resources: Resource[]): GanttGroupDefinition[] {
    const groups = new Map<string, GanttGroupDefinition>();
    resources.forEach((resource) => {
      const category = this.resolveCategory(resource);
      const poolId = this.resolvePoolId(resource);
      const poolName = this.resolvePoolName(resource);
      const groupId = this.groupIdForParts(category, poolId);
      const label = poolName ?? this.defaultGroupLabel(category, poolId);
      const icon = this.iconForCategory(category);
      const existing = groups.get(groupId);
      if (existing) {
        existing.resources.push(resource);
      } else {
        groups.set(groupId, {
          id: groupId,
          label,
          icon,
          category,
          resources: [resource],
        });
      }
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        resources: [...group.resources].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => {
        const categoryDiff = this.categorySortKey(a.category) - this.categorySortKey(b.category);
        if (categoryDiff !== 0) {
          return categoryDiff;
        }
        return a.label.localeCompare(b.label);
      });
  }

  private resolveCategory(resource: Resource): string | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const category = attributes?.['category'];
    return typeof category === 'string' ? category : null;
  }

  private resolvePoolId(resource: Resource): string | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const poolId = attributes?.['poolId'];
    return typeof poolId === 'string' ? poolId : null;
  }

  private resolvePoolName(resource: Resource): string | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const poolName = attributes?.['poolName'];
    return typeof poolName === 'string' && poolName.length > 0 ? poolName : null;
  }

  private isDisplayableResource(resource: Resource): boolean {
    const category = this.resolveCategory(resource);
    if (category && this.allowedResourceCategories.has(category)) {
      return true;
    }
    return this.allowedResourceCategories.has(resource.kind);
  }

  private groupIdForParts(category: string | null, poolId: string | null): string {
    return `${category ?? 'uncategorized'}|${poolId ?? 'none'}`;
  }

  private iconForCategory(category: string | null): string {
    switch (category) {
      case 'vehicle-service':
        return 'route';
      case 'personnel-service':
        return 'badge';
      case 'vehicle':
        return 'directions_transit';
      case 'personnel':
        return 'groups';
      default:
        return 'inventory_2';
    }
  }

  private participantRoleIcon(
    participant: ActivityParticipant,
    isOwner: boolean,
    category: ActivityParticipantCategory,
  ): { icon: string | null; label: string | null } {
    switch (participant.role) {
      case 'teacher':
        return { icon: 'school', label: 'Lehrer' };
      case 'student':
        return { icon: 'face', label: 'Schüler' };
      case 'primary-personnel':
        return { icon: 'workspace_premium', label: 'Hauptpersonal' };
      case 'secondary-personnel':
        return { icon: 'groups', label: 'Begleitpersonal' };
      case 'primary-vehicle':
        return { icon: 'train', label: 'Fahrzeug (Primär)' };
      case 'secondary-vehicle':
        return { icon: 'directions_transit', label: 'Fahrzeug (Sekundär)' };
      default:
        break;
    }
    if (!isOwner) {
      return { icon: 'link', label: 'Verknüpfte Ressource' };
    }
    if (category === 'vehicle') {
      return { icon: 'train', label: 'Fahrzeug' };
    }
    if (category === 'personnel') {
      return { icon: 'badge', label: 'Personal' };
    }
    return { icon: null, label: null };
  }

  private defaultGroupLabel(category: string | null, poolId: string | null): string {
    switch (category) {
      case 'vehicle-service':
        return poolId ? `Fahrzeugdienst-Pool ${poolId}` : 'Fahrzeugdienste';
      case 'personnel-service':
        return poolId ? `Personaldienst-Pool ${poolId}` : 'Personaldienste';
      case 'vehicle':
        return poolId ? `Fahrzeugpool ${poolId}` : 'Fahrzeuge';
      case 'personnel':
        return poolId ? `Personalpool ${poolId}` : 'Personal';
      default:
        return 'Weitere Ressourcen';
    }
  }

  private resourceCategoryFromKind(
    kind: Resource['kind'] | null | undefined,
  ): ActivityParticipantCategory {
    return participantCategoryFromKind(kind ?? undefined);
  }

  private resetExpandedGroups(_resources: Resource[]): void {
    this.expandedGroups.set(new Set());
  }

  resourceViewMode(resourceId: string): 'block' | 'detail' {
    return this.resourceViewModes?.[resourceId] ?? 'detail';
  }

  private describeZoom(rangeMs: number): string {
    const approx = findNearestZoomConfig(rangeMs);
    const label = ZOOM_LABELS[approx.level] ?? approx.level;
    const span = this.formatRangeSpan(rangeMs);
    return `${label} · ${span}`;
  }

  private formatRangeSpan(rangeMs: number): string {
    if (!Number.isFinite(rangeMs) || rangeMs <= 0) {
      return '—';
    }
    if (rangeMs >= 3 * MS_IN_DAY) {
      return `${Math.round(rangeMs / MS_IN_DAY)} Tage`;
    }
    if (rangeMs >= MS_IN_DAY) {
      return `${(rangeMs / MS_IN_DAY).toFixed(1)} Tage`;
    }
    if (rangeMs >= 3 * MS_IN_HOUR) {
      return `${Math.round(rangeMs / MS_IN_HOUR)} Stunden`;
    }
    if (rangeMs >= MS_IN_HOUR) {
      return `${(rangeMs / MS_IN_HOUR).toFixed(1)} Stunden`;
    }
    return `${Math.max(1, Math.round(rangeMs / MS_IN_MINUTE))} Minuten`;
  }

  private computePointerDistance(): number {
    const points = Array.from(this.activeTouchPointers.values());
    if (points.length < 2) {
      return 0;
    }
    const [a, b] = points;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  private computePointerMidpointX(): number {
    if (this.activeTouchPointers.size === 0) {
      return this.touchPointerContainer
        ? this.touchPointerContainer.getBoundingClientRect().left + this.touchPointerContainer.clientWidth / 2
        : 0;
    }
    const total = Array.from(this.activeTouchPointers.values()).reduce((sum, point) => sum + point.x, 0);
    return total / this.activeTouchPointers.size;
  }

  private isTouchPointer(event: PointerEvent): boolean {
    return event.pointerType === 'touch' || event.pointerType === 'pen';
  }

  private syncTimeScaleToViewport(): void {
    if (!this.viewport) {
      return;
    }
    this.timeScale.setPixelsPerMs(this.viewport.pixelsPerMs());
  }

  private categorySortKey(category: string | null): number {
    switch (category) {
      case 'vehicle-service':
        return 0;
      case 'personnel-service':
        return 1;
      case 'vehicle':
        return 2;
      case 'personnel':
        return 3;
      default:
        return 99;
    }
  }

  private clampCenter(center: Date, start: Date, end: Date): Date {
    const startMs = start.getTime();
    const endMs = end.getTime();
    const value = center.getTime();
    if (value <= startMs) {
      return new Date(start);
    }
    if (value >= endMs) {
      return new Date(end);
    }
    return new Date(center);
  }

  private resolveBarClasses(activity: PreparedActivity): string[] {
    const classes: string[] = [];
    if (activity.serviceId) {
      classes.push('gantt-activity--within-service');
      if (activity.serviceRole === 'start' || activity.type === 'service-start') {
        classes.push('gantt-activity--service-boundary', 'gantt-activity--service-boundary-start');
      } else if (activity.serviceRole === 'end' || activity.type === 'service-end') {
        classes.push('gantt-activity--service-boundary', 'gantt-activity--service-boundary-end');
      }
    } else {
      classes.push('gantt-activity--outside-service');
    }
    return classes;
  }

  private createServiceRange(entry: ServiceRangeAccumulator): GanttServiceRange | null {
    const hasStart = entry.startLeft !== null;
    const hasEnd = entry.endLeft !== null;
    if (!hasStart && !hasEnd && !Number.isFinite(entry.minLeft) && !Number.isFinite(entry.maxRight)) {
      return null;
    }
    let left: number;
    let right: number;
    if (hasStart && hasEnd) {
      left = Math.min(entry.startLeft!, entry.endLeft!);
      right = Math.max(entry.startLeft!, entry.endLeft!);
    } else {
      const fallbackLeft = Number.isFinite(entry.minLeft) ? entry.minLeft : entry.endLeft ?? entry.startLeft ?? 0;
      const fallbackRight = Number.isFinite(entry.maxRight) ? entry.maxRight : entry.startLeft ?? entry.endLeft ?? fallbackLeft;
      left = Math.min(fallbackLeft, fallbackRight);
      right = Math.max(fallbackLeft, fallbackRight);
      if (hasStart && !hasEnd) {
        left = Math.min(left, entry.startLeft!);
        right = Math.max(right, entry.startLeft! + 32);
      } else if (!hasStart && hasEnd) {
        right = Math.max(right, entry.endLeft!);
        left = Math.min(left, entry.endLeft! - 32);
      } else if (!hasStart && !hasEnd) {
        right = Math.max(right, left + 32);
      }
    }
    if (right - left < 12) {
      right = left + 12;
    }
    if (left < 0) {
      right -= left;
      left = 0;
    }
    const status: GanttServiceRangeStatus = hasStart && hasEnd ? 'complete' : hasStart ? 'missing-end' : hasEnd ? 'missing-start' : 'missing-both';
    const label = this.buildServiceRangeLabel(entry.startMs, entry.endMs, status);
    return {
      id: entry.id,
      label,
      left,
      width: Math.max(4, right - left),
      status,
    };
  }

  private buildServiceRangeLabel(
    startMs: number | null,
    endMs: number | null,
    status: GanttServiceRangeStatus,
  ): string {
    const format = (value: number | null) => (value ? this.serviceLabelFormatter.format(new Date(value)) : '—');
    switch (status) {
      case 'complete':
        return `Dienst ${format(startMs)} – ${format(endMs)}`;
      case 'missing-end':
        return `Dienst ${format(startMs)} • Ende fehlt`;
      case 'missing-start':
        return `Dienst ${format(endMs)} • Start fehlt`;
      default:
        return 'Dienst (unvollständig)';
    }
  }

  private activityDisplayInfo(activity: Activity): { label: string; showRoute: boolean } {
    const typeId = activity.type ?? '';
    const info = this.activityTypeInfoMap[typeId];
    const label = info?.label ?? (typeId || 'Aktivität');
    const showRoute = info?.showRoute ?? false;
    return { label, showRoute };
  }


  private blockActivityEdit(activityId: string) {
    this.dragEditBlockActivityId = activityId;
    this.dragEditBlockUntil = Date.now() + 1500;
    this.dragEditBlockGlobalUntil = this.dragEditBlockUntil;
  }

  private shouldBlockEdit(activityId: string): boolean {
    if (Date.now() < this.dragEditBlockGlobalUntil) {
      return true;
    }
    if (this.dragState && this.dragState.activity.id === activityId) {
      return true;
    }
    if (!this.dragEditBlockActivityId || this.dragEditBlockActivityId !== activityId) {
      return false;
    }
    if (Date.now() < this.dragEditBlockUntil) {
      return true;
    }
    this.dragEditBlockActivityId = null;
    this.dragEditBlockUntil = 0;
    this.dragEditBlockGlobalUntil = 0;
    return false;
  }

  private findOverlappingActivities(resourceId: string, reference: Activity): Activity[] {
    const slots = this.activitySlotsByResource().get(resourceId) ?? [];
    const list = slots.map((slot) => slot.activity);
    const uniqueActivities: PreparedActivity[] = [];
    const seen = new Set<string>();
    list.forEach((activity) => {
      if (seen.has(activity.id)) {
        return;
      }
      seen.add(activity.id);
      uniqueActivities.push(activity);
    });
    const refStartMs = new Date(reference.start).getTime();
    const refEndMs = reference.end ? new Date(reference.end).getTime() : refStartMs;
    if (!Number.isFinite(refStartMs) || !Number.isFinite(refEndMs)) {
      return [reference];
    }
    const overlaps = uniqueActivities.filter((entry) => {
      const start = entry.startMs;
      const end = entry.endMs;
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return false;
      }
      return end > refStartMs && start < refEndMs;
    });
    if (!overlaps.length) {
      return [reference];
    }
    overlaps.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
    return overlaps;
  }
}
