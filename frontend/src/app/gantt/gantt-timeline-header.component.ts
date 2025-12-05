import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tick } from '../models/time-scale';
import { TemplatePeriod } from '../core/api/timeline-api.types';
import { addDays } from '../core/utils/time-math';

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
  standalone: true,
  imports: [CommonModule],
  templateUrl: './gantt-timeline-header.component.html',
  styleUrl: './gantt-timeline-header.component.scss',
})
export class GanttTimelineHeaderComponent {
  @Input({ required: true }) ticks: Tick[] = [];
  @Input({ required: true }) contentWidth = 0;
  @Input() periods: TemplatePeriod[] = [];
  @Input() pixelsPerMs = 0;
  @Input() timelineStart?: Date;
  @Input() viewStart?: Date;
  @Input() viewEnd?: Date;

  groupedTicks(): GroupSegment[] {
    if (!this.ticks.length) {
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

    this.ticks.forEach((tick) => {
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
  }

  periodVisuals(): PeriodVisual[] {
    if (
      !this.timelineStart ||
      !this.viewStart ||
      !this.viewEnd ||
      !this.pixelsPerMs ||
      !this.periods?.length
    ) {
      return [];
    }
    const startMs = this.viewStart.getTime();
    const endMs = this.viewEnd.getTime();
    const timelineStartMs = this.timelineStart.getTime();
    const palette = ['#4c6fff', '#2eb88a', '#f2a541', '#c95ff2', '#f26b6b', '#3ab0ff'];

    return this.periods
      .map((period, idx) => {
        const pStart = new Date(period.validFrom).getTime();
        const rawEnd = period.validTo ? new Date(period.validTo).getTime() : endMs;
        const pEnd = addDays(new Date(rawEnd), 1).getTime() - 1; // inclusive day end
        const clampedStart = Math.max(pStart, startMs);
        const clampedEnd = Math.min(pEnd, endMs);
        if (clampedEnd <= clampedStart) {
          return null;
        }
        const leftPx = (clampedStart - timelineStartMs) * this.pixelsPerMs;
        const widthPx = Math.max(2, (clampedEnd - clampedStart) * this.pixelsPerMs);
        return {
          id: period.id ?? `period-${idx}`,
          label: `${period.validFrom} – ${period.validTo ?? ''}`.trim(),
          offsetPx: leftPx,
          widthPx,
          color: palette[idx % palette.length],
        };
      })
      .filter((p): p is PeriodVisual => p !== null);
  }
}
