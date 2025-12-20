import { signal } from '@angular/core';
import { TimeScaleService } from '../core/services/time-scale.service';
import { createTimeViewport, TimeViewport } from '../core/signals/time-viewport.signal';
import { ZOOM_RANGE_MS } from '../core/constants/time-scale.config';
import { addDays, startOfDay, MS_IN_DAY } from '../core/utils/time-math';

export class GanttViewportFacade {
  private timelineRangeInput: { start: Date; end: Date } | null = null;
  private minTimelineDaysValue = 1;
  private snapTimelineToMidnightValue = true;
  private viewportInitialized = false;
  private lastTimelineRange: { start: number; end: number } | null = null;

  private readonly viewportReadySignal = signal(false);
  readonly viewportReady = this.viewportReadySignal.asReadonly();

  viewport!: TimeViewport;

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

  constructor(
    private readonly deps: {
      timeScale: TimeScaleService;
      host: () => HTMLElement;
      headerScroller: () => HTMLElement | null;
      suppressNextTimelineClick: () => void;
    },
  ) {}

  cleanup(): void {
    this.endMousePan();
    this.activeTouchPointers.clear();
    this.pinchReferenceDistance = null;
    this.touchPanLastX = null;
    this.touchPointerContainer = null;
  }

  setTimelineRange(value: { start: Date; end: Date } | null): void {
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

  setMinTimelineDays(value: number | null | undefined): void {
    const parsed = Number.isFinite(value as number) ? Math.max(1, Math.floor((value as number) ?? 1)) : 1;
    if (parsed === this.minTimelineDaysValue) {
      return;
    }
    this.minTimelineDaysValue = parsed;
    this.applyTimelineRange();
  }

  setSnapTimelineToMidnight(value: boolean | ''): void {
    const next = value !== false;
    if (next === this.snapTimelineToMidnightValue) {
      return;
    }
    this.snapTimelineToMidnightValue = next;
    this.applyTimelineRange();
  }

  zoomIn(): void {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.zoomIn(this.viewport.viewCenter());
    this.syncTimeScaleToViewport();
  }

  zoomOut(): void {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.zoomOut(this.viewport.viewCenter());
    this.syncTimeScaleToViewport();
  }

  gotoToday(): void {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.gotoToday();
  }

  gotoDate(date: Date): void {
    if (!this.viewportReady()) {
      return;
    }
    this.viewport.goto(date);
  }

  setScrollLeft(scrollLeft: number): void {
    if (!this.viewportReady()) {
      return;
    }
    if (!Number.isFinite(scrollLeft)) {
      return;
    }
    const current = this.viewport.scrollX();
    if (Math.abs(current - scrollLeft) <= 0.5) {
      return;
    }
    this.viewport.setScrollPx(scrollLeft);
  }

  handleWheel(event: WheelEvent, container?: HTMLElement | null): void {
    if (!this.viewportReady()) {
      return;
    }
    const host = container ?? this.deps.headerScroller() ?? null;
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

  handleTouchPointerDown(event: PointerEvent, container: HTMLElement): boolean {
    if (!this.viewportReady() || !this.isTouchPointer(event)) {
      return false;
    }
    this.touchPointerContainer = container;
    container.setPointerCapture?.(event.pointerId);
    this.activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.activeTouchPointers.size === 1) {
      this.touchPanLastX = event.clientX;
      this.pinchReferenceDistance = null;
    } else if (this.activeTouchPointers.size === 2) {
      this.touchPanLastX = null;
      this.pinchReferenceDistance = this.computePointerDistance();
    }
    event.preventDefault();
    return true;
  }

  beginMousePan(event: PointerEvent, container: HTMLElement): void {
    if (!this.viewportReady()) {
      return;
    }
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }
    this.mousePanPointerId = event.pointerId;
    this.mousePanStartX = event.clientX;
    this.mousePanLastX = event.clientX;
    this.mousePanMoved = false;
    this.mousePanContainer = container;
    container.setPointerCapture?.(event.pointerId);
  }

  handlePointerMove(event: PointerEvent): void {
    if (!this.viewportReady()) {
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
        this.deps.suppressNextTimelineClick();
        this.deps.host().classList.add('gantt--panning');
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

  handlePointerUp(event: PointerEvent): void {
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

  pointerTime(clientX: number, container: HTMLElement | null): Date {
    if (!container) {
      return this.viewport.viewCenter();
    }
    const rect = container.getBoundingClientRect();
    const relativeX = clientX - rect.left + container.scrollLeft;
    return this.deps.timeScale.pxToTime(relativeX);
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

  private initializeViewport(start: Date, end: Date): void {
    if (this.viewportInitialized) {
      return;
    }
    this.deps.timeScale.setTimelineRange(start, end);
    this.viewport = createTimeViewport({
      timelineStart: start,
      timelineEnd: end,
      initialRangeMs: this.computeInitialRange(start, end, ZOOM_RANGE_MS['week']),
      initialCenter: start,
    });
    this.viewportInitialized = true;
    this.syncTimeScaleToViewport();
    this.viewportReadySignal.set(true);
  }

  private resetViewport(start: Date, end: Date): void {
    const previousRange = this.viewport?.rangeMs() ?? ZOOM_RANGE_MS['week'];
    const previousCenter = this.viewport?.viewCenter() ?? start;
    this.viewportReadySignal.set(false);
    this.deps.timeScale.setTimelineRange(start, end);
    this.viewport = createTimeViewport({
      timelineStart: start,
      timelineEnd: end,
      initialRangeMs: this.computeInitialRange(start, end, previousRange),
      initialCenter: this.clampCenter(previousCenter, start, end),
    });
    this.syncTimeScaleToViewport();
    this.viewportReadySignal.set(true);
  }

  private computeInitialRange(start: Date, end: Date, requested: number): number {
    const duration = Math.max(1, end.getTime() - start.getTime());
    return Math.min(requested, duration);
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

  private syncTimeScaleToViewport(): void {
    if (!this.viewport) {
      return;
    }
    this.deps.timeScale.setPixelsPerMs(this.viewport.pixelsPerMs());
  }

  private applyZoomAtPointer(factor: number, clientX: number, container: HTMLElement | null): void {
    if (!this.viewportReady()) {
      return;
    }
    const host = container ?? this.deps.headerScroller() ?? null;
    const focus = this.pointerTime(clientX, host);
    const safeFactor = Math.min(Math.max(factor, 0.2), 5);
    this.viewport.zoomBy(safeFactor, focus);
    this.syncTimeScaleToViewport();
    const pointerPx = this.deps.timeScale.timeToPx(focus);
    const offset = this.computeViewportOffset(clientX, host);
    this.viewport.setScrollPx(pointerPx - offset);
  }

  private computeViewportOffset(clientX: number, container: HTMLElement | null): number {
    const target = container ?? (this.deps.headerScroller() ?? this.deps.host());
    const rect = target.getBoundingClientRect();
    const raw = clientX - rect.left;
    const clamped = Math.min(Math.max(raw, 0), target.clientWidth || raw);
    return Number.isFinite(clamped) ? clamped : 0;
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

  private endMousePan(target?: HTMLElement | null): void {
    if (this.mousePanPointerId !== null) {
      const host = target ?? this.mousePanContainer;
      if (host?.hasPointerCapture?.(this.mousePanPointerId)) {
        host.releasePointerCapture(this.mousePanPointerId);
      }
    }
    if (this.mousePanMoved) {
      this.deps.host().classList.remove('gantt--panning');
    }
    this.mousePanPointerId = null;
    this.mousePanStartX = null;
    this.mousePanLastX = null;
    this.mousePanContainer = null;
    this.mousePanMoved = false;
  }
}
