import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tick } from '../models/time-scale';

interface GroupSegment {
  label: string;
  leftPx: number;
  widthPx: number;
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
}
