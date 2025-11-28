import { computed, signal } from '@angular/core';
import { ZoomLevel } from '../../models/time-scale';
import { clampDate, differenceInMs } from '../utils/time-math';
import {
  MAX_RANGE_MS,
  MIN_RANGE_MS,
  ZOOM_RANGE_MS,
  findNearestZoomConfig,
  interpolatePixelsPerMs,
} from '../constants/time-scale.config';

const DEFAULT_ZOOM_LEVEL: ZoomLevel = 'week';
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1 / ZOOM_IN_FACTOR;

export interface TimeViewportOptions {
  timelineStart: Date;
  timelineEnd: Date;
  initialZoom?: ZoomLevel;
  initialRangeMs?: number;
  initialCenter?: Date;
}

export interface TimeViewport {
  readonly viewStart: () => Date;
  readonly viewEnd: () => Date;
  readonly zoomLevel: () => ZoomLevel;
  readonly scrollX: () => number;
  readonly rangeMs: () => number;
  readonly pixelsPerMs: () => number;
  zoomIn(center?: Date): void;
  zoomOut(center?: Date): void;
  zoomBy(factor: number, center?: Date): void;
  setRange(rangeMs: number, center?: Date): void;
  scrollBy(px: number): void;
  setScrollPx(px: number): void;
  goto(time: Date): void;
  gotoToday(): void;
  viewCenter(): Date;
}

export function createTimeViewport(options: TimeViewportOptions): TimeViewport {
  const timelineStart = new Date(options.timelineStart);
  const timelineEnd = new Date(options.timelineEnd);
  const timelineDuration = Math.max(
    differenceInMs(timelineEnd, timelineStart),
    MIN_RANGE_MS,
  );

  const requestedRange =
    options.initialRangeMs ??
    ZOOM_RANGE_MS[options.initialZoom ?? DEFAULT_ZOOM_LEVEL];
  const minRange = Math.min(MIN_RANGE_MS, timelineDuration);
  const maxRange = Math.min(Math.max(MAX_RANGE_MS, minRange), timelineDuration);
  const rangeSignal = signal(clampRange(requestedRange, minRange, maxRange));

  const initialCenter = options.initialCenter ?? new Date();
  const initialStart = clampToTimeline(
    new Date(initialCenter.getTime() - rangeSignal() / 2),
    timelineStart,
    timelineEnd,
    rangeSignal(),
  );

  const viewStart = signal<Date>(initialStart);
  const viewEnd = computed(() => new Date(viewStart().getTime() + rangeSignal()));
  const pixelsPerMs = computed(() => interpolatePixelsPerMs(rangeSignal()));
  const scrollX = computed(() => {
    const pxPerMs = pixelsPerMs();
    const startTime = viewStart().getTime();
    const baseTime = timelineStart.getTime();
    return Math.max(0, (startTime - baseTime) * pxPerMs);
  });

  function zoomIn(center?: Date) {
    zoomBy(ZOOM_IN_FACTOR, center);
  }

  function zoomOut(center?: Date) {
    zoomBy(ZOOM_OUT_FACTOR, center);
  }

  function zoomBy(factor: number, center?: Date) {
    if (!Number.isFinite(factor) || factor <= 0) {
      return;
    }
    const nextRange = rangeSignal() * factor;
    setRange(nextRange, center);
  }

  function setRange(rangeMs: number, center?: Date) {
    const clampedRange = clampRange(rangeMs, minRange, maxRange);
    if (clampedRange === rangeSignal()) {
      maintainCenter(center);
      return;
    }
    rangeSignal.set(clampedRange);
    maintainCenter(center);
  }

  function rangeMs(): number {
    return rangeSignal();
  }

  function maintainCenter(center?: Date) {
    const target = center ?? viewCenter();
    const halfRange = rangeSignal() / 2;
    const nextStart = new Date(target.getTime() - halfRange);
    const clamped = clampToTimeline(nextStart, timelineStart, timelineEnd, rangeSignal());
    viewStart.set(clamped);
  }

  function viewCenter(): Date {
    return new Date(viewStart().getTime() + rangeSignal() / 2);
  }

  function scrollBy(px: number) {
    const pxPerMs = pixelsPerMs();
    if (!pxPerMs || !Number.isFinite(px)) {
      return;
    }
    const deltaMs = px / pxPerMs;
    shiftBy(deltaMs);
  }

  function setScrollPx(px: number) {
    const pxPerMs = pixelsPerMs();
    if (!pxPerMs || !Number.isFinite(px)) {
      return;
    }
    const nextStartTime = timelineStart.getTime() + px / pxPerMs;
    const nextStart = new Date(nextStartTime);
    const clamped = clampToTimeline(nextStart, timelineStart, timelineEnd, rangeSignal());
    viewStart.set(clamped);
  }

  function goto(time: Date) {
    maintainCenter(time);
  }

  function gotoToday() {
    goto(new Date());
  }

  function shiftBy(deltaMs: number) {
    const currentStart = viewStart();
    const nextStart = new Date(currentStart.getTime() + deltaMs);
    const clamped = clampToTimeline(nextStart, timelineStart, timelineEnd, rangeSignal());
    viewStart.set(clamped);
  }

  return {
    viewStart: () => viewStart(),
    viewEnd: () => viewEnd(),
    zoomLevel: () => findNearestZoomConfig(rangeSignal()).level,
    scrollX: () => scrollX(),
    rangeMs,
    pixelsPerMs: () => pixelsPerMs(),
    zoomIn,
    zoomOut,
    zoomBy,
    setRange,
    scrollBy,
    setScrollPx,
    goto,
    gotoToday,
    viewCenter,
  };

  function clampRange(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }

  function clampToTimeline(
    start: Date,
    timelineStartDate: Date,
    timelineEndDate: Date,
    currentRange: number,
  ): Date {
    const min = timelineStartDate;
    const max = new Date(Math.max(min.getTime(), timelineEndDate.getTime() - currentRange));
    if (max.getTime() <= min.getTime()) {
      return new Date(timelineStartDate);
    }
    return clampDate(start, min, max);
  }
}
