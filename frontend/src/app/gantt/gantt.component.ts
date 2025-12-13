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
import { Activity } from '../models/activity';
import { getActivityOwnerId } from '../models/activity-ownership';
import { TimeScaleService } from '../core/services/time-scale.service';
import { createTimeViewport, TimeViewport } from '../core/signals/time-viewport.signal';
import { GanttMenuComponent } from './gantt-menu.component';
import { GanttResourcesComponent } from './gantt-resources.component';
import { GanttActivityDragData, GanttActivitySelectionEvent } from './gantt-activity.component';
import {
  GanttBackgroundSegment,
  GanttTimelineRowComponent,
  type GanttBar,
  type GanttServiceRange,
} from './gantt-timeline-row.component';
import { GanttTimelineHeaderComponent } from './gantt-timeline-header.component';
import { GanttStatusBarComponent } from './gantt-status-bar.component';
import { TrackHorizontalScrollDirective } from '../shared/directives/track-horizontal-scroll.directive';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { addDays, startOfDay, MS_IN_DAY, MS_IN_HOUR, MS_IN_MINUTE } from '../core/utils/time-math';
import { ZOOM_RANGE_MS, findNearestZoomConfig } from '../core/constants/time-scale.config';
import { LayerGroupService } from '../core/services/layer-group.service';
import { TemplatePeriod } from '../core/api/timeline-api.types';
import { GanttDragFacade } from './gantt-drag.facade';
import type {
  ActivityRepositionEventPayload,
  ActivitySelectionEventPayload,
  GanttDisplayRow,
  PreparedActivity,
  PreparedActivitySlot,
} from './gantt.models';
import { GanttRowBuilderFacade } from './gantt-row-builder.facade';
import { GanttSelectionFacade } from './gantt-selection.facade';

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
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class GanttComponent implements AfterViewInit {
  protected readonly timeScale = inject(TimeScaleService);
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly layerGroups = inject(LayerGroupService);
  private readonly activityTypeInfoSignal = signal<Record<string, { label: string; showRoute: boolean }>>({});
  private readonly rowBuilder = new GanttRowBuilderFacade({
    timeScale: this.timeScale,
    layerGroups: this.layerGroups,
    activityTypeInfo: () => this.activityTypeInfoSignal(),
  });
  private readonly resourcesSignal = signal<Resource[]>([]);
  private readonly activitiesSignal = signal<PreparedActivity[]>([]);
  private readonly pendingActivitySignal = signal<PreparedActivity | null>(null);
  private readonly filterTerm = signal('');
  private readonly cursorTimeSignal = signal<Date | null>(null);
  private readonly viewportReady = signal(false);
  private minTimelineDaysValue = 1;
  private snapTimelineToMidnightValue = true;
  private timelineRangeInput: { start: Date; end: Date } | null = null;
  private readonly expandedGroups = signal<Set<string>>(new Set());
  private readonly activeTouchPointers = new Map<number, { x: number; y: number }>();
  private pinchReferenceDistance: number | null = null;
  private touchPanLastX: number | null = null;
  private touchPointerContainer: HTMLElement | null = null;
  private readonly pinchLogThreshold = 0.08;
  private readonly mousePanActivationThreshold = 4;
  private mousePanPointerId: number | null = null;
  private mousePanStartX: number | null = null;
  private mousePanLastX: number | null = null;
  private mousePanMoved = false;
  private mousePanContainer: HTMLElement | null = null;
  private suppressNextTimelineClick = false;
  private lastOverlapGroupKey: string | null = null;
  private lastOverlapActivityId: string | null = null;
  protected readonly periodsSignal = signal<TemplatePeriod[]>([]);
  private readonly selection = new GanttSelectionFacade({
    host: () => this.hostElement.nativeElement,
    getResourceById: (id) => this.resourceMap().get(id),
    getActivityById: (id) => this.activityMap().get(id),
    emitSelectionToggle: (payload) => this.activitySelectionToggle.emit(payload),
    suppressNextTimelineClick: () => {
      this.suppressNextTimelineClick = true;
    },
  });
  private readonly dragFacade = new GanttDragFacade({
    host: () => this.hostElement.nativeElement,
    viewportReady: () => this.viewportReady(),
    timeScale: this.timeScale,
    resourceMap: () => this.resourceMap(),
    resourceKindMap: () => this.resourceKindMap(),
    suppressNextTimelineClick: () => {
      this.suppressNextTimelineClick = true;
    },
    emitReposition: (payload) => this.activityRepositionRequested.emit(payload),
    emitCopy: (payload) => this.activityCopyRequested.emit(payload),
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.dragFacade.cleanup());
  }

  protected viewport!: TimeViewport;
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
    this.selection.setSelectedActivityIds(value);
  }

  @Input({ required: true })
  set resources(value: Resource[]) {
    const list = (value ?? []).filter((resource) => this.rowBuilder.isDisplayableResource(resource));
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
    this.activityTypeInfoSignal.set(value ?? {});
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

  @Input()
  set periods(value: TemplatePeriod[] | null) {
    this.periodsSignal.set(value ?? []);
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
      this.rowBuilder.buildParticipantSlots(activity).forEach(addSlot);
    });
    const pending = this.pendingActivitySignal();
    if (pending) {
      this.rowBuilder.buildParticipantSlots(pending).forEach(addSlot);
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

  private readonly displayedSelectionIds = this.selection.displayedSelectionIds;

  readonly rows = computed<GanttDisplayRow[]>(() => {
    const resources = this.filteredResources();
    const groups = this.rowBuilder.buildGroups(resources);
    const expanded = this.expandedGroups();
    const rows: GanttDisplayRow[] = [];
    let resourceIndex = 0;

    const displaySelectedIds = this.displayedSelectionIds();
    const timelineData = this.viewportReady()
      ? this.rowBuilder.buildTimelineData({
          resources,
          slotsByResource: this.activitySlotsByResource(),
          pendingActivityId: this.pendingActivitySignal()?.id ?? null,
          viewStart: this.viewport.viewStart(),
          viewEnd: this.viewport.viewEnd(),
          selectedIds: displaySelectedIds,
          primarySlots: this.selection.primarySelectionSlots(),
        })
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

  readonly dragStatus = this.dragFacade.dragStatus;

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
  readonly lassoBox = this.selection.lassoBox;

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
      if (this.selection.shouldStartLasso(event, host, isActivityTarget)) {
        this.selection.beginLassoSelection(event, host);
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
    if (this.selection.handlePointerMove(event)) {
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
    if (this.selection.handlePointerUp(event)) {
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
    if (this.dragFacade.shouldBlockEdit(activity.id)) {
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
    this.selection.handleActivitySelectionToggle(resource, event);
    this.activitySelectionToggle.emit({
      resource,
      activity: event.activity,
      selectionMode: event.selectionMode,
    });
  }

  onActivityDragStarted(event: CdkDragStart<GanttActivityDragData>) {
    this.dragFacade.handleDragStarted(event);
  }

  onActivityDragMoved(event: CdkDragMove<GanttActivityDragData>) {
    this.dragFacade.handleDragMoved(event);
  }

  onActivityDragEnded(event: CdkDragEnd<GanttActivityDragData>) {
    this.dragFacade.handleDragEnded(event);
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
    // Always ensure the initial range spans the full timeline so keine Bereiche fehlen.
    return Math.max(requested, duration);
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

  private isActivityElement(element: HTMLElement | null): boolean {
    if (!element) {
      return false;
    }
    return !!element.closest('.gantt-activity');
  }

  private inclusiveViewEnd(viewStart: Date): Date {
    const startMs = viewStart.getTime();
    const exclusiveEnd = this.viewport.viewEnd();
    const exclusiveMs = exclusiveEnd.getTime();
    const inclusiveMs = Math.max(startMs, exclusiveMs - 1);
    return new Date(inclusiveMs);
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
