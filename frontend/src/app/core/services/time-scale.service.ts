import { Injectable, Signal, computed, signal } from '@angular/core';
import { Tick, ZoomLevel } from '../../models/time-scale';
import {
  ceilToStep,
  differenceInMs,
  floorToStep,
  MS_IN_DAY,
  isSameDay,
  isWeekend,
} from '../utils/time-math';
import {
  ZOOM_CONFIG_MAP,
  findNearestZoomConfigByPixels,
} from '../constants/time-scale.config';

const MIN_MINOR_LABEL_WIDTH = 68;
const MIN_DETAIL_LABEL_WIDTH = 48;

@Injectable({ providedIn: 'root' })
export class TimeScaleService {
  private readonly timelineStart = signal<Date>(new Date());
  private readonly timelineEnd = signal<Date>(new Date());
  private readonly pixelsPerMsSignal = signal<number>(ZOOM_CONFIG_MAP['week'].pxPerMs);
  private readonly contentWidthSignal: Signal<number>;

  constructor() {
    this.contentWidthSignal = computed(() => {
      const duration = Math.max(
        differenceInMs(this.timelineEnd(), this.timelineStart()),
        24 * 60 * 60 * 1000,
      );
      return duration * this.pixelsPerMsSignal();
    });
  }

  setTimelineRange(start: Date, end: Date): void {
    if (end.getTime() <= start.getTime()) {
      throw new Error('Timeline end must be after timeline start.');
    }
    this.timelineStart.set(new Date(start));
    this.timelineEnd.set(new Date(end));
  }

  setPixelsPerMs(value: number): void {
    const clamped = Math.max(1 / (365 * 24 * 60 * 60 * 1000), value);
    this.pixelsPerMsSignal.set(clamped);
  }

  activeZoomLevel(): ZoomLevel {
    return findNearestZoomConfigByPixels(this.pixelsPerMsSignal()).level;
  }

  contentWidth(): number {
    return Math.max(1, Math.round(this.contentWidthSignal()));
  }

  pixelsPerMs(): number {
    return this.pixelsPerMsSignal();
  }

  timeToPx(date: Date | number): number {
    if (!this.hasTimelineRange()) {
      return 0;
    }
    const timeValue = typeof date === 'number' ? date : date.getTime();
    const clampedTime = Math.min(
      Math.max(timeValue, this.timelineStart().getTime()),
      this.timelineEnd().getTime(),
    );
    return (clampedTime - this.timelineStart().getTime()) * this.pixelsPerMs();
  }

  pxToTime(px: number): Date {
    if (!this.hasTimelineRange()) {
      return new Date(this.timelineStart().getTime());
    }
    const base = this.timelineStart().getTime();
    const time = base + px / this.pixelsPerMs();
    return new Date(time);
  }

  getTicks(viewStart: Date, viewEnd: Date): Tick[] {
    const pxPerMs = this.pixelsPerMs();
    const cfg = findNearestZoomConfigByPixels(pxPerMs);
    const start = floorToStep(viewStart, cfg.stepMs);
    const end = ceilToStep(viewEnd, cfg.stepMs);
    const timelineStartMs = this.timelineStart().getTime();
    const timelineEndMs = this.timelineEnd().getTime();
    const ticks: Tick[] = [];
    const now = new Date();

    // Generate visible ticks only for the current viewport to keep rendering light.
    for (let ts = start.getTime(); ts <= end.getTime(); ts += cfg.stepMs) {
      const stepStartMs = ts;
      const stepEndMs = ts + cfg.stepMs;
      const clampedStartMs = Math.max(stepStartMs, timelineStartMs);
      const clampedEndMs = Math.min(stepEndMs, timelineEndMs);
      if (clampedEndMs <= clampedStartMs) {
        continue;
      }

      const widthPx = Math.max(0, (clampedEndMs - clampedStartMs) * pxPerMs);
      if (widthPx <= 0) {
        continue;
      }
      const offsetPx = (clampedStartMs - timelineStartMs) * pxPerMs;
      const offset = clampedStartMs - timelineStartMs;
      const index = Math.floor(offset / cfg.stepMs);
      const date = new Date(clampedStartMs);
      const bucketIndex = Math.floor(offset / cfg.majorStepMs);
      const bucketStartMs = timelineStartMs + bucketIndex * cfg.majorStepMs;
      const bucketDate = new Date(bucketStartMs);
      const isMajor = ((clampedStartMs - timelineStartMs) % cfg.majorStepMs + cfg.majorStepMs) % cfg.majorStepMs === 0;
      const baseLabel = cfg.label(date);
      const majorLabel = cfg.majorLabel?.(bucketDate);
      const showMinor = widthPx >= MIN_MINOR_LABEL_WIDTH;
      const minorLabel = showMinor ? cfg.minorLabel?.(date) : undefined;
      const label =
        widthPx < MIN_DETAIL_LABEL_WIDTH && cfg.compactLabel ? cfg.compactLabel(date) : baseLabel;

      ticks.push({
        time: date,
        label,
        majorLabel,
        minorLabel,
        widthPx,
        offsetPx,
        index,
        isMajor,
        isWeekend: isWeekend(date),
        isNow:
          (cfg.stepMs >= MS_IN_DAY && isSameDay(date, now)) ||
          Math.abs(ts - now.getTime()) < cfg.stepMs,
      });
    }

    return ticks;
  }

  hasTimelineRange(): boolean {
    return this.timelineEnd().getTime() > this.timelineStart().getTime();
  }
}
