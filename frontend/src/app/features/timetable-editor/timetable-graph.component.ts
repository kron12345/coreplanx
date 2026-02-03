import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { formatIsoTime, parseIsoToUtcMs, formatUtcMsToIso } from './timetable-editor.utils';

export type GraphSnapMode = 'minute' | 'half-minute' | 'off';

export interface TimetableGraphPoint {
  stopId: string;
  label: string;
  kind: 'origin' | 'stop' | 'destination' | 'pass';
  timeIso?: string;
  distanceMeters: number;
}

@Component({
  selector: 'app-timetable-graph',
  standalone: true,
  template: '<canvas #canvas class="graph-canvas"></canvas>',
  styleUrl: './timetable-graph.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimetableGraphComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) private readonly canvas?: ElementRef<HTMLCanvasElement>;
  @Input() points: TimetableGraphPoint[] = [];
  @Input() snapMode: GraphSnapMode = 'minute';
  @Input() startTimeIso: string | null = null;
  @Output() timeDragged = new EventEmitter<{ stopId: string; timeIso: string }>();

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver?: ResizeObserver;
  private renderPoints: Array<{ stopId: string; x: number; y: number; timeIso?: string; kind: TimetableGraphPoint['kind'] }> = [];
  private draggingStopId: string | null = null;
  private timeRange: { minMs: number; maxMs: number } | null = null;

  ngAfterViewInit(): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) {
      return;
    }
    this.ctx = canvas.getContext('2d');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.resize();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['points'] || changes['snapMode'] || changes['startTimeIso']) {
      this.draw();
    }
  }

  ngOnDestroy(): void {
    const canvas = this.canvas?.nativeElement;
    if (canvas) {
      canvas.removeEventListener('mousedown', this.handleMouseDown);
    }
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.resizeObserver?.disconnect();
  }

  private resize() {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) {
      return;
    }
    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    this.draw();
  }

  private draw() {
    if (!this.ctx || !this.canvas) {
      return;
    }
    const ctx = this.ctx;
    const width = this.canvas.nativeElement.width;
    const height = this.canvas.nativeElement.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    if (!this.points.length) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px sans-serif';
      ctx.fillText('Keine Daten', 16, 24);
      return;
    }
    const margin = { left: 48, right: 24, top: 16, bottom: 32 };
    const maxDistance = Math.max(...this.points.map((p) => p.distanceMeters));
    const minDistance = Math.min(...this.points.map((p) => p.distanceMeters));
    const distanceRange = Math.max(1, maxDistance - minDistance);
    const times = this.points
      .map((p) => (p.timeIso ? parseIsoToUtcMs(p.timeIso) : Number.NaN))
      .filter((value) => Number.isFinite(value)) as number[];
    const startMs = this.startTimeIso ? parseIsoToUtcMs(this.startTimeIso) : Number.NaN;
    const minTime = times.length ? Math.min(...times) : startMs;
    const maxTime = times.length ? Math.max(...times) : startMs;
    const buffer = 10 * 60_000;
    const minMs = Number.isFinite(minTime) ? minTime - buffer : Date.now();
    const maxMs = Number.isFinite(maxTime) ? maxTime + buffer : minMs + 3600_000;
    this.timeRange = { minMs, maxMs };

    const xScale = (width - margin.left - margin.right) / Math.max(1, maxMs - minMs);
    const yScale = (height - margin.top - margin.bottom) / distanceRange;

    ctx.strokeStyle = '#cbd5f5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, height - margin.bottom);
    ctx.lineTo(width - margin.right, height - margin.bottom);
    ctx.stroke();

    ctx.strokeStyle = '#1e88e5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.renderPoints = [];
    this.points.forEach((point, index) => {
      const timeMs = point.timeIso ? parseIsoToUtcMs(point.timeIso) : minMs;
      const x = margin.left + (timeMs - minMs) * xScale;
      const y = height - margin.bottom - (point.distanceMeters - minDistance) * yScale;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      this.renderPoints.push({ stopId: point.stopId, x, y, timeIso: point.timeIso, kind: point.kind });
    });
    ctx.stroke();

    this.renderPoints.forEach((point) => {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#475569';
    ctx.font = '12px sans-serif';
    const labelTime = formatIsoTime(this.points[0]?.timeIso);
    if (labelTime) {
      ctx.fillText(labelTime, margin.left, height - 8);
    }
  }

  private handleMouseDown = (event: MouseEvent) => {
    if (!this.canvas) {
      return;
    }
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = this.renderPoints.find((point) => {
      const dx = point.x - x;
      const dy = point.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= 8;
    });
    if (hit && hit.kind !== 'pass') {
      this.draggingStopId = hit.stopId;
    }
  };

  private handleMouseMove = (event: MouseEvent) => {
    if (!this.draggingStopId || !this.canvas || !this.timeRange) {
      return;
    }
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const marginLeft = 48;
    const marginRight = 24;
    const width = this.canvas.nativeElement.width;
    const usable = Math.max(1, width - marginLeft - marginRight);
    const ratio = Math.min(1, Math.max(0, (x - marginLeft) / usable));
    const rawMs = this.timeRange.minMs + ratio * (this.timeRange.maxMs - this.timeRange.minMs);
    const snapped = this.applySnap(rawMs);
    const newIso = formatUtcMsToIso(snapped);
    this.timeDragged.emit({ stopId: this.draggingStopId, timeIso: newIso });
  };

  private handleMouseUp = () => {
    this.draggingStopId = null;
  };

  private applySnap(ms: number): number {
    if (this.snapMode === 'off') {
      return ms;
    }
    const stepMinutes = this.snapMode === 'half-minute' ? 0.5 : 1;
    const stepMs = stepMinutes * 60_000;
    return Math.round(ms / stepMs) * stepMs;
  }
}
