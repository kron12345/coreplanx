import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tick } from '../models/time-scale';
import { TemplatePeriod } from '../core/api/timeline-api.types';
import { addDays } from '../core/utils/time-math';

const PERIOD_PALETTE = ['#4c6fff', '#2eb88a', '#f2a541', '#c95ff2', '#f26b6b', '#3ab0ff'];

interface GroupSegment {
  label: string;
  leftPx: number;
  widthPx: number;
}

interface PeriodVisual {
  id: string;
  label: string;
  offsetPx: number;
  widthPx: number;
  color: string;
}

@Component({
    selector: 'app-gantt-timeline-header',
    imports: [CommonModule],
    templateUrl: './gantt-timeline-header.component.html',
    styleUrl: './gantt-timeline-header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class GanttTimelineHeaderComponent {
  private readonly ticksSignal = signal<Tick[]>([]);
  readonly ticks = this.ticksSignal.asReadonly();

  private readonly contentWidthSignal = signal(0);
  readonly contentWidth = this.contentWidthSignal.asReadonly();

  private readonly periodsSignal = signal<TemplatePeriod[]>([]);
  readonly periods = this.periodsSignal.asReadonly();

  private readonly pixelsPerMsSignal = signal(0);
  readonly pixelsPerMs = this.pixelsPerMsSignal.asReadonly();

  private readonly timelineStartSignal = signal<Date | null>(null);
  private readonly viewStartSignal = signal<Date | null>(null);
  private readonly viewEndSignal = signal<Date | null>(null);

  @Input({ required: true, alias: 'ticks' })
  set ticksInput(value: Tick[] | null | undefined) {
    this.ticksSignal.set(value ?? []);
  }

  @Input({ required: true, alias: 'contentWidth' })
  set contentWidthInput(value: number | null | undefined) {
    this.contentWidthSignal.set(Number(value) || 0);
  }

  @Input({ alias: 'periods' })
  set periodsInput(value: TemplatePeriod[] | null | undefined) {
    this.periodsSignal.set(value ?? []);
  }

  @Input({ alias: 'pixelsPerMs' })
  set pixelsPerMsInput(value: number | null | undefined) {
    this.pixelsPerMsSignal.set(Number(value) || 0);
  }

  @Input({ alias: 'timelineStart' })
  set timelineStartInput(value: Date | null | undefined) {
    this.timelineStartSignal.set(value ?? null);
  }

  @Input({ alias: 'viewStart' })
  set viewStartInput(value: Date | null | undefined) {
    this.viewStartSignal.set(value ?? null);
  }

  @Input({ alias: 'viewEnd' })
  set viewEndInput(value: Date | null | undefined) {
    this.viewEndSignal.set(value ?? null);
  }

  readonly groupedTickSegments = computed<GroupSegment[]>(() => {
    const ticks = this.ticksSignal();
    if (!ticks.length) {
      return [];
    }

    const segments: GroupSegment[] = [];
    let current: GroupSegment | null = null;

    const flushCurrent = () => {
      if (current === null) {
        return;
      }
      segments.push({
        label: current.label,
        leftPx: current.leftPx,
        widthPx: current.widthPx,
      });
      current = null;
    };

    ticks.forEach((tick) => {
      if (tick.widthPx <= 0) {
        return;
      }
      const label = tick.majorLabel ?? tick.label;
      const left = tick.offsetPx;
      const right = tick.offsetPx + tick.widthPx;

      if (!label) {
        if (current) {
          current.widthPx = Math.max(current.widthPx, right - current.leftPx);
        }
        return;
      }

      if (!current || current.label !== label || left > current.leftPx + current.widthPx + 0.5) {
        flushCurrent();
        current = {
          label,
          leftPx: left,
          widthPx: Math.max(0, right - left),
        };
        return;
      }

      const newWidth = Math.max(current.widthPx, right - current.leftPx);
      current.widthPx = newWidth;
    });

    flushCurrent();

    return segments;
  });

  readonly periodVisuals = computed<PeriodVisual[]>(() => {
    const timelineStart = this.timelineStartSignal();
    const viewStart = this.viewStartSignal();
    const viewEnd = this.viewEndSignal();
    const pixelsPerMs = this.pixelsPerMsSignal();
    const periods = this.periodsSignal();

    if (!timelineStart || !viewStart || !viewEnd || !pixelsPerMs || !periods.length) {
      return [];
    }

    const startMs = viewStart.getTime();
    const endMs = viewEnd.getTime();
    const timelineStartMs = timelineStart.getTime();

    return periods
      .map((period, idx) => {
        const pStart = new Date(period.validFrom).getTime();
        const rawEnd = period.validTo ? new Date(period.validTo).getTime() : endMs;
        const pEnd = addDays(new Date(rawEnd), 1).getTime() - 1; // inclusive day end
        const clampedStart = Math.max(pStart, startMs);
        const clampedEnd = Math.min(pEnd, endMs);
        if (clampedEnd <= clampedStart) {
          return null;
        }
        const leftPx = (clampedStart - timelineStartMs) * pixelsPerMs;
        const widthPx = Math.max(2, (clampedEnd - clampedStart) * pixelsPerMs);
        return {
          id: period.id ?? `period-${idx}`,
          label: `${period.validFrom} – ${period.validTo ?? ''}`.trim(),
          offsetPx: leftPx,
          widthPx,
          color: PERIOD_PALETTE[idx % PERIOD_PALETTE.length],
        };
      })
      .filter((p): p is PeriodVisual => p !== null);
  });
}
