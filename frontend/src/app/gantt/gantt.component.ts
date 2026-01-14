import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
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
import { MS_IN_DAY, MS_IN_HOUR, MS_IN_MINUTE } from '../core/utils/time-math';
import { findNearestZoomConfig } from '../core/constants/time-scale.config';
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
import { GanttViewportFacade } from './gantt-viewport.facade';

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly layerGroups = inject(LayerGroupService);
  private readonly activityTypeInfoSignal = signal<Record<string, { label: string; showRoute: boolean }>>({});
  private readonly rowBuilder = new GanttRowBuilderFacade({
    timeScale: this.timeScale,
    layerGroups: this.layerGroups,
    activityTypeInfo: () => this.activityTypeInfoSignal(),
  });
  private readonly resourcesSignal = signal<Resource[]>([]);
  private readonly activitiesInputSignal = signal<Activity[]>([]);
  private readonly previewActivitiesInputSignal = signal<Activity[]>([]);
  private readonly activitiesSignal = computed<PreparedActivity[]>(() =>
    this.prepareActivities(this.activitiesInputSignal()),
  );
  private readonly previewActivitiesSignal = computed<PreparedActivity[]>(() =>
    this.prepareActivities(this.previewActivitiesInputSignal(), true),
  );
  private readonly displayActivitiesSignal = computed<PreparedActivity[]>(() => [
    ...this.activitiesSignal(),
    ...this.previewActivitiesSignal(),
  ]);
  private readonly pendingActivitySignal = signal<PreparedActivity | null>(null);
  private readonly syncingActivityIdsSignal = signal<ReadonlySet<string>>(new Set<string>());
  private readonly filterTerm = signal('');
  private readonly cursorTimeSignal = signal<Date | null>(null);
  private readonly markingModeSignal = signal(false);
  private readonly expandedGroups = signal<Set<string>>(new Set());
  private suppressNextTimelineClick = false;
  private lastViewportSignature: string | null = null;
  private readonly viewportFacade = new GanttViewportFacade({
    timeScale: this.timeScale,
    host: () => this.hostElement.nativeElement,
    headerScroller: () => this.headerScrollerDir?.element ?? null,
    suppressNextTimelineClick: () => {
      this.suppressNextTimelineClick = true;
    },
  });
  private readonly viewportReady = this.viewportFacade.viewportReady;
  private lastOverlapGroupKey: string | null = null;
  private lastOverlapActivityId: string | null = null;
  private pendingTimelineScrollLeft: number | null = null;
  private timelineScrollHandle: number | null = null;
  private lassoAutoScrollHandle: number | null = null;
  private lassoAutoScrollPointer: { x: number; y: number } | null = null;
  private readonly lassoAutoScrollEdgePx = 28;
  private readonly lassoAutoScrollMaxSpeedPx = 22;
  protected readonly periodsSignal = signal<TemplatePeriod[]>([]);
  private readonly timelineViewportWidthSignal = signal<number | null>(null);
  private headerResizeObserver: ResizeObserver | null = null;
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
    this.destroyRef.onDestroy(() => {
      this.dragFacade.cleanup();
      this.viewportFacade.cleanup();
      this.headerResizeObserver?.disconnect();
      this.headerResizeObserver = null;
      if (this.timelineScrollHandle !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.timelineScrollHandle);
        } else {
          clearTimeout(this.timelineScrollHandle);
        }
        this.timelineScrollHandle = null;
      }
      this.stopLassoAutoScroll();
      this.pendingTimelineScrollLeft = null;
    });

    effect(() => {
      if (!this.viewportReady()) {
        return;
      }
      const start = this.viewStart();
      const end = this.viewEnd();
      const signature = `${start.toISOString()}|${end.toISOString()}`;
      if (signature === this.lastViewportSignature) {
        return;
      }
      this.lastViewportSignature = signature;
      this.viewportChanged.emit({
        start: new Date(start),
        end: new Date(end),
      });
    });
  }

  protected get viewport() {
    return this.viewportFacade.viewport;
  }

  private previousResourceIds: string[] | null = null;
  private readonly rowScrollerElementsSignal = signal<HTMLElement[]>([]);
  readonly rowScrollerElements = this.rowScrollerElementsSignal.asReadonly();
  private readonly headerScrollerTargetsSignal = signal<HTMLElement[] | null>(null);
  readonly headerScrollerTargets = this.headerScrollerTargetsSignal.asReadonly();

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
  @Output() viewportChanged = new EventEmitter<{ start: Date; end: Date }>();

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
    this.activitiesInputSignal.set(value ?? []);
  }

  @Input()
  set previewActivities(value: Activity[] | null) {
    this.previewActivitiesInputSignal.set(value ?? []);
  }

  @Input()
  set activityTypeInfo(value: Record<string, { label: string; showRoute: boolean }> | null) {
    this.activityTypeInfoSignal.set(value ?? {});
  }

  @Input({ required: true })
  set timelineRange(value: { start: Date; end: Date }) {
    if (!value) {
      this.viewportFacade.setTimelineRange(null);
      return;
    }
    this.viewportFacade.setTimelineRange({
      start: new Date(value.start),
      end: new Date(value.end),
    });
  }

  @Input()
  set minTimelineDays(value: number | null | undefined) {
    this.viewportFacade.setMinTimelineDays(value);
  }

  @Input()
  set snapTimelineToMidnight(value: boolean | '') {
    this.viewportFacade.setSnapTimelineToMidnight(value);
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
  set syncingActivityIds(value: ReadonlySet<string> | string[] | null) {
    if (!value) {
      this.syncingActivityIdsSignal.set(new Set<string>());
      return;
    }
    if (value instanceof Set) {
      this.syncingActivityIdsSignal.set(value);
      return;
    }
    this.syncingActivityIdsSignal.set(new Set(value));
  }

  @Input()
  set periods(value: TemplatePeriod[] | null) {
    this.periodsSignal.set(value ?? []);
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
    this.displayActivitiesSignal().forEach((activity) => {
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
    const expandedResources: Resource[] = [];
    groups.forEach((group) => {
      if (expanded.has(group.id)) {
        expandedResources.push(...group.resources);
      }
    });

    const timelineData =
      this.viewportReady() && expandedResources.length > 0
        ? this.rowBuilder.buildTimelineData({
            resources: expandedResources,
            slotsByResource: this.activitySlotsByResource(),
            pendingActivityId: this.pendingActivitySignal()?.id ?? null,
            syncingActivityIds: this.syncingActivityIdsSignal(),
            viewStart: this.viewStart(),
            viewEnd: this.viewEnd(),
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
    return this.timeScale.getTicks(this.viewStart(), this.viewEnd());
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
    const start = this.viewStart();
    const end = this.inclusiveViewEnd(start, this.viewEnd());
    return `${this.rangeFormatter.format(start)} – ${this.rangeFormatter.format(end)}`;
  });

  readonly viewStart = computed(() => (this.viewportReady() ? this.viewport.viewStart() : new Date()));
  readonly viewEnd = computed(() =>
    this.viewportReady() ? this.effectiveViewEnd(this.viewport.viewStart()) : new Date(),
  );
  readonly viewDisplayEnd = computed(() => {
    if (!this.viewportReady()) {
      return new Date();
    }
    return this.inclusiveViewEnd(this.viewStart(), this.viewEnd());
  });
  readonly zoomLabel = computed(() => (this.viewportReady() ? this.describeZoom(this.viewport.rangeMs()) : '—'));
  readonly resourceCount = computed(() => this.resourcesSignal().length);

  readonly nowMarkerLeft = computed(() => {
    if (!this.viewportReady()) {
      return null;
    }
    const now = Date.now();
    const start = this.timeScale.timeToPx(now);
    const timelineStart = this.timeScale.timeToPx(this.viewStart());
    const timelineEnd = this.timeScale.timeToPx(this.viewEnd());
    if (now < this.viewStart().getTime() || now > this.viewEnd().getTime()) {
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
  readonly totalActivityCount = computed(() => this.activitiesInputSignal().length);
  readonly cursorTime = computed(() => this.cursorTimeSignal());
  readonly filterText = computed(() => this.filterTerm());
  readonly hasRows = computed(() => this.rows().length > 0);
  readonly isViewportReady = computed(() => this.viewportReady());
  readonly lassoBox = this.selection.lassoBox;
  readonly markingMode = this.markingModeSignal.asReadonly();

  private readonly rangeFormatter = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  ngAfterViewInit(): void {
    const header = this.headerScrollerDir?.element ?? null;
    this.headerScrollerTargetsSignal.set(header ? [header] : null);
    this.updateRowScrollerElements();
    queueMicrotask(() => this.updateScrollbarWidth());
    if (header && typeof ResizeObserver !== 'undefined') {
      this.headerResizeObserver = new ResizeObserver(() => {
        this.updateScrollbarWidth();
      });
      this.headerResizeObserver.observe(header);
    }
    this.rowScrollerDirs?.changes
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateRowScrollerElements();
        this.updateScrollbarWidth();
      });
  }

  onZoomIn() {
    this.viewportFacade.zoomIn();
  }

  onZoomOut() {
    this.viewportFacade.zoomOut();
  }

  onFilterChange(value: string) {
    this.filterTerm.set(value);
  }

  onMarkingModeChange(value: boolean) {
    this.markingModeSignal.set(!!value);
  }

  onGotoToday() {
    this.viewportFacade.gotoToday();
  }

  onGotoDate(date: Date) {
    this.viewportFacade.gotoDate(date);
  }

  onTimelineScroll(scrollLeft: number) {
    this.pendingTimelineScrollLeft = scrollLeft;
    if (this.timelineScrollHandle !== null) {
      return;
    }
    const flush = () => {
      this.timelineScrollHandle = null;
      const next = this.pendingTimelineScrollLeft;
      this.pendingTimelineScrollLeft = null;
      if (next === null) {
        return;
      }
      this.viewportFacade.setScrollLeft(next);
    };
    if (typeof requestAnimationFrame === 'function') {
      this.timelineScrollHandle = requestAnimationFrame(flush);
      return;
    }
    this.timelineScrollHandle = window.setTimeout(flush, 16);
  }

  onTimelineWheel(event: WheelEvent, container?: HTMLElement | null) {
    this.viewportFacade.handleWheel(event, container);
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
    if (this.viewportFacade.handleTouchPointerDown(event, host)) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button === 0) {
      const persistentMarking = this.markingModeSignal();
      const effectiveMarking = persistentMarking !== event.ctrlKey;
      if (effectiveMarking && !isActivityTarget && !!host.dataset['resourceId']) {
        this.selection.beginLassoSelection(event, host);
        this.updateLassoAutoScrollPointer(event);
        event.preventDefault();
        return;
      }
      if (!persistentMarking && this.selection.shouldStartLasso(event, host, isActivityTarget)) {
        this.selection.beginLassoSelection(event, host);
        this.updateLassoAutoScrollPointer(event);
        event.preventDefault();
        return;
      }
      if (isActivityTarget) {
        return;
      }
      this.suppressNextTimelineClick = false;
      this.viewportFacade.beginMousePan(event, host);
    }
  }

  onTimelinePointerMove(event: PointerEvent) {
    if (this.selection.handlePointerMove(event)) {
      this.updateLassoAutoScrollPointer(event);
      return;
    }
    this.viewportFacade.handlePointerMove(event);
  }

  onTimelinePointerUp(event: PointerEvent) {
    if (this.selection.handlePointerUp(event)) {
      this.stopLassoAutoScroll();
      return;
    }
    this.viewportFacade.handlePointerUp(event);
  }

  onTimelineMouseMove(event: MouseEvent, container?: HTMLElement) {
    if (!this.viewportReady()) {
      return;
    }
    const cursorTime = this.viewportFacade.pointerTime(
      event.clientX,
      container ?? (event.currentTarget as HTMLElement | null),
    );
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
    const start = this.viewportFacade.pointerTime(event.clientX, target);
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
      case 'm':
      case 'M':
        event.preventDefault();
        this.markingModeSignal.update((current) => !current);
        break;
      case '+':
      case '=':
        event.preventDefault();
        this.viewportFacade.zoomIn();
        break;
      case '-':
      case '_':
        event.preventDefault();
        this.viewportFacade.zoomOut();
        break;
      default:
        break;
    }
  }

  @HostListener('window:resize')
  handleResize() {
    this.updateScrollbarWidth();
  }

  private updateRowScrollerElements(): void {
    this.rowScrollerElementsSignal.set(
      this.rowScrollerDirs ? this.rowScrollerDirs.toArray().map((dir) => dir.element) : [],
    );
  }

  private updateScrollbarWidth(): void {
    const viewport = this.hostElement.nativeElement.querySelector('.gantt__viewport') as HTMLElement | null;
    if (!viewport) {
      return;
    }
    const width = Math.max(0, viewport.offsetWidth - viewport.clientWidth);
    if (!Number.isFinite(width)) {
      return;
    }
    this.hostElement.nativeElement.style.setProperty('--gantt-scrollbar-width', `${width}px`);
    this.updateTimelineViewportWidth();
  }

  private lastTimelineViewportWidth: number | null = null;

  private updateTimelineViewportWidth(): void {
    const header = this.headerScrollerDir?.element ?? null;
    const width = header?.clientWidth ?? 0;
    if (!Number.isFinite(width) || width <= 0) {
      return;
    }
    if (this.lastTimelineViewportWidth === width) {
      return;
    }
    this.lastTimelineViewportWidth = width;
    this.timelineViewportWidthSignal.set(width);
    this.viewportFacade.setViewportWidth(width);
  }

  private prepareActivities(value: Activity[], isPreview = false): PreparedActivity[] {
    const prepared: PreparedActivity[] = [];
    for (const activity of value ?? []) {
      const startMs = new Date(activity.start).getTime();
      const endMs = activity.end ? new Date(activity.end).getTime() : startMs;
      prepared.push({
        ...activity,
        startMs,
        endMs,
        ownerResourceId: getActivityOwnerId(activity),
        isPreview,
      });
    }
    return prepared;
  }

  private isActivityElement(element: HTMLElement | null): boolean {
    if (!element) {
      return false;
    }
    return !!element.closest('.gantt-activity');
  }

  private inclusiveViewEnd(viewStart: Date, viewEnd: Date): Date {
    const startMs = viewStart.getTime();
    const exclusiveMs = viewEnd.getTime();
    const inclusiveMs = Math.max(startMs, exclusiveMs - 1);
    return new Date(inclusiveMs);
  }

  private effectiveViewEnd(viewStart: Date): Date {
    const width = this.timelineViewportWidthSignal();
    const pxPerMs = this.timeScale.pixelsPerMs();
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || !Number.isFinite(pxPerMs) || pxPerMs <= 0) {
      return this.viewport.viewEnd();
    }
    const unclampedEndMs = viewStart.getTime() + width / pxPerMs;
    const timelineEndMs = this.timeScale.timelineEndDate().getTime();
    return new Date(Math.min(unclampedEndMs, timelineEndMs));
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

  private updateLassoAutoScrollPointer(event: PointerEvent): void {
    if (!this.selection.isLassoActive()) {
      return;
    }
    this.lassoAutoScrollPointer = { x: event.clientX, y: event.clientY };
    this.scheduleLassoAutoScroll();
  }

  private scheduleLassoAutoScroll(): void {
    if (this.lassoAutoScrollHandle !== null) {
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      this.lassoAutoScrollHandle = requestAnimationFrame(() => this.runLassoAutoScroll());
      return;
    }
    this.lassoAutoScrollHandle = window.setTimeout(() => this.runLassoAutoScroll(), 16);
  }

  private stopLassoAutoScroll(): void {
    if (this.lassoAutoScrollHandle !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.lassoAutoScrollHandle);
      } else {
        clearTimeout(this.lassoAutoScrollHandle);
      }
      this.lassoAutoScrollHandle = null;
    }
    this.lassoAutoScrollPointer = null;
  }

  private runLassoAutoScroll(): void {
    this.lassoAutoScrollHandle = null;
    if (!this.selection.isLassoActive() || !this.lassoAutoScrollPointer) {
      return;
    }
    const pointer = this.lassoAutoScrollPointer;
    const timelineContainer = this.headerScrollerDir?.element ?? null;
    const viewportElement = this.hostElement.nativeElement.querySelector('.gantt__viewport') as HTMLElement | null;
    const timelineRect = (timelineContainer ?? viewportElement)?.getBoundingClientRect() ?? null;
    const viewportRect = viewportElement?.getBoundingClientRect() ?? null;
    if (!timelineRect || !viewportRect) {
      return;
    }

    const dx = this.computeAutoScrollDelta(pointer.x, timelineRect.left, timelineRect.right);
    const dy = this.computeAutoScrollDelta(pointer.y, viewportRect.top, viewportRect.bottom);
    let didScroll = false;

    if (dx !== 0) {
      const before = this.viewport.scrollX();
      this.viewport.scrollBy(dx);
      const after = this.viewport.scrollX();
      didScroll = didScroll || Math.abs(after - before) > 0.5;
    }
    if (dy !== 0 && viewportElement) {
      const before = viewportElement.scrollTop;
      viewportElement.scrollTop += dy;
      const after = viewportElement.scrollTop;
      didScroll = didScroll || Math.abs(after - before) > 0.5;
    }

    if (!didScroll) {
      return;
    }
    this.selection.refreshLassoVisual();
    this.scheduleLassoAutoScroll();
  }

  private computeAutoScrollDelta(pointer: number, start: number, end: number): number {
    if (!Number.isFinite(pointer) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return 0;
    }
    const threshold = this.lassoAutoScrollEdgePx;
    const maxSpeed = this.lassoAutoScrollMaxSpeedPx;
    const distanceFromStart = pointer - start;
    if (distanceFromStart < threshold) {
      const ratio = Math.min(1, Math.max(0, (threshold - distanceFromStart) / threshold));
      const eased = ratio * ratio;
      const px = Math.max(1, Math.round(maxSpeed * eased));
      return -px;
    }
    const distanceToEnd = end - pointer;
    if (distanceToEnd < threshold) {
      const ratio = Math.min(1, Math.max(0, (threshold - distanceToEnd) / threshold));
      const eased = ratio * ratio;
      const px = Math.max(1, Math.round(maxSpeed * eased));
      return px;
    }
    return 0;
  }
}
