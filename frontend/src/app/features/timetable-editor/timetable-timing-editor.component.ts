import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import type {
  PatternDefinition,
  RouteDraft,
  RouteStop,
  TimetableDraft,
  TimingPoint,
} from '../../core/models/timetable-draft.model';
import {
  addMinutesToIso,
  buildCumulativeDistances,
  buildPassThroughPoints,
  formatIsoTime,
  parseIsoToUtcMs,
  toIsoWithTime,
} from './timetable-editor.utils';
import { TimetableGraphComponent, TimetableGraphPoint, GraphSnapMode } from './timetable-graph.component';

@Component({
  selector: 'app-timetable-timing-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS, TimetableGraphComponent],
  templateUrl: './timetable-timing-editor.component.html',
  styleUrl: './timetable-timing-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimetableTimingEditorComponent {
  private readonly routeDraftSignal = signal<RouteDraft | null>(null);
  private readonly timetableDraftSignal = signal<TimetableDraft | null>(null);
  private readonly patternDefinitionSignal = signal<PatternDefinition | null>(null);
  @Input() set routeDraft(value: RouteDraft | null) {
    this.routeDraftSignal.set(value);
  }
  @Input() set timetableDraft(value: TimetableDraft | null) {
    this.timetableDraftSignal.set(value);
  }
  @Input() set patternDefinition(value: PatternDefinition | null) {
    this.patternDefinitionSignal.set(value);
  }
  @Output() timetableDraftChange = new EventEmitter<TimetableDraft>();
  @Output() patternDefinitionChange = new EventEmitter<PatternDefinition | null>();

  readonly snapMode = signal<GraphSnapMode>('minute');
  readonly patternDefinitionValue = computed(() => this.patternDefinitionSignal());
  readonly timetableDraftValue = computed(() => this.timetableDraftSignal());

  readonly stopRows = computed(() => {
    const route = this.routeDraftSignal();
    const draft = this.timetableDraftSignal();
    if (!route || !draft) {
      return [];
    }
    const pointMap = new Map(draft.points.map((point) => [point.stopId, point] as const));
    const passPoints = buildPassThroughPoints(route, draft.points);
    const passPointMap = new Map(passPoints.map((point) => [point.opId, point]));
    const sequence = this.buildRouteSequence(route);
    return sequence.map((opId) => {
      const stop = route.stops.find((entry) => entry.op?.id === opId);
      if (stop) {
        const point = pointMap.get(stop.stopId);
        return {
          stop,
          point,
          isPassThrough: false,
          arrival: formatIsoTime(point?.arrivalIso),
          departure: formatIsoTime(point?.departureIso),
        };
      }
      const passPoint = passPointMap.get(opId);
      const op = route.routeOps?.find((entry) => entry.id === opId);
      return {
        stop: {
          stopId: passPoint?.stopId ?? `pass-${opId}`,
          op: op ?? passPoint?.op ?? { id: opId, name: opId },
          kind: 'pass' as const,
        },
        point: passPoint,
        isPassThrough: true,
        arrival: formatIsoTime(passPoint?.arrivalIso),
        departure: formatIsoTime(passPoint?.departureIso),
      };
    });
  });

  readonly graphPoints = computed<TimetableGraphPoint[]>(() => {
    if (!this.routeDraftSignal() || !this.timetableDraftSignal()) {
      return [];
    }
    const routeDraft = this.routeDraftSignal() as RouteDraft;
    const timetableDraft = this.timetableDraftSignal() as TimetableDraft;
    const distanceMap = buildCumulativeDistances(routeDraft);
    const pointMap = new Map(timetableDraft.points.map((point) => [point.stopId, point] as const));
    const passPoints = buildPassThroughPoints(routeDraft, timetableDraft.points);
    const passPointMap = new Map(passPoints.map((point) => [point.opId, point]));
    const sequence = this.buildRouteSequence(routeDraft);
    return sequence.map((opId) => {
      const stop = routeDraft.stops.find((entry) => entry.op?.id === opId);
      if (stop) {
        const point = pointMap.get(stop.stopId);
        const timeIso = this.pickAnchorTime(stop, point);
        return {
          stopId: stop.stopId,
          label: stop.op?.name ?? stop.stopId,
          kind: stop.kind,
          timeIso,
          distanceMeters: distanceMap.get(stop.stopId) ?? 0,
        };
      }
      const passPoint = passPointMap.get(opId);
      const timeIso = passPoint?.arrivalIso ?? passPoint?.departureIso;
      return {
        stopId: passPoint?.stopId ?? `pass-${opId}`,
        label: passPoint?.op?.name ?? opId,
        kind: 'pass',
        timeIso,
        distanceMeters: passPoint?.distanceMeters ?? 0,
      };
    });
  });

  readonly warnings = computed(() => {
    if (!this.routeDraftSignal() || !this.timetableDraftSignal()) {
      return [];
    }
    const routeDraft = this.routeDraftSignal() as RouteDraft;
    const timetableDraft = this.timetableDraftSignal() as TimetableDraft;
    const warnings: string[] = [];
    const points = new Map(timetableDraft.points.map((point) => [point.stopId, point] as const));
    for (const stop of routeDraft.stops) {
      if (stop.kind === 'stop') {
        const point = points.get(stop.stopId);
        if (!point?.arrivalIso || !point.departureIso) {
          continue;
        }
        const dwellMs = parseIsoToUtcMs(point.departureIso) - parseIsoToUtcMs(point.arrivalIso);
        const dwellSeconds = dwellMs / 1000;
        const minDwell = stop.dwellSeconds ?? routeDraft.assumptions.defaultDwellSeconds;
        if (Number.isFinite(dwellSeconds) && dwellSeconds < minDwell) {
          warnings.push(
            `${stop.op?.name ?? 'Halt'}: Aufenthalt ${Math.round(dwellSeconds / 60)} min < ${Math.round(minDwell / 60)} min`,
          );
        }
      }
    }
    routeDraft.segments.forEach((segment) => {
      const from = points.get(segment.fromStopId);
      const to = points.get(segment.toStopId);
      const fromTime = from?.departureIso ?? from?.arrivalIso;
      const toTime = to?.arrivalIso ?? to?.departureIso;
      if (!fromTime || !toTime) {
        return;
      }
      const travelMinutes =
        (parseIsoToUtcMs(toTime) - parseIsoToUtcMs(fromTime)) / 60_000;
      const minMinutes = (segment.estimatedTravelSeconds ?? 0) / 60;
      if (Number.isFinite(travelMinutes) && travelMinutes < minMinutes) {
        warnings.push(
          `Segment ${segment.fromStopId}→${segment.toStopId}: ${Math.round(travelMinutes)} min < ${Math.round(minMinutes)} min`,
        );
      }
    });
    return warnings;
  });

  onTimeChanged(stopId: string, field: 'arrival' | 'departure', value: string) {
    if (!this.timetableDraftSignal()) {
      return;
    }
    const draft = this.timetableDraftSignal() as TimetableDraft;
    const dateIso = draft.startTimeIso.split('T')[0];
    const iso = value ? toIsoWithTime(dateIso, value) : undefined;
    const nextPoints = draft.points.map((point) => {
      if (point.stopId !== stopId) {
        return point;
      }
      return field === 'arrival'
        ? { ...point, arrivalIso: iso }
        : { ...point, departureIso: iso };
    });
    this.emitDraft({ ...draft, points: nextPoints });
  }

  onGraphDragged(event: { stopId: string; timeIso: string }) {
    if (!this.timetableDraftSignal() || !this.routeDraftSignal()) {
      return;
    }
    const draft = this.timetableDraftSignal() as TimetableDraft;
    const routeDraft = this.routeDraftSignal() as RouteDraft;
    const points = draft.points.map((point) => ({ ...point }));
    const index = points.findIndex((point) => point.stopId === event.stopId);
    if (index < 0) {
      return;
    }
    const stop = routeDraft.stops.find((entry) => entry.stopId === event.stopId);
    const point = points[index];
    const anchor = this.pickAnchorTime(stop, point);
    if (!anchor) {
      return;
    }
    const deltaMinutes =
      (parseIsoToUtcMs(event.timeIso) - parseIsoToUtcMs(anchor)) / 60_000;
    if (Number.isFinite(deltaMinutes)) {
      point.arrivalIso = addMinutesToIso(point.arrivalIso, deltaMinutes);
      point.departureIso = addMinutesToIso(point.departureIso, deltaMinutes);
      points[index] = point;
      this.emitDraft({ ...draft, points });
    }
  }

  updatePatternHeadway(value: string) {
    this.updatePattern({ headwayMinutes: Number(value) });
  }

  updatePatternStart(value: string) {
    this.updatePattern({ startTimeIso: this.combinePatternTime(value) });
  }

  updatePatternEnd(value: string) {
    this.updatePattern({ endTimeIso: this.combinePatternTime(value) });
  }

  clearPattern() {
    this.patternDefinitionChange.emit(null);
  }

  private updatePattern(patch: Partial<PatternDefinition>) {
    if (!this.timetableDraftSignal()) {
      return;
    }
    const base = this.patternDefinitionValue() ?? {
      patternId: `pattern-${this.timetableDraftSignal()!.draftId}`,
      baseTimetableDraftId: this.timetableDraftSignal()!.draftId,
      headwayMinutes: 60,
      startTimeIso: this.timetableDraftSignal()!.startTimeIso,
      endTimeIso: this.timetableDraftSignal()!.startTimeIso,
    };
    this.patternDefinitionChange.emit({
      ...base,
      ...patch,
      headwayMinutes:
        typeof patch.headwayMinutes === 'number' && Number.isFinite(patch.headwayMinutes)
          ? Math.max(1, Math.round(patch.headwayMinutes))
          : base.headwayMinutes,
    });
  }

  private combinePatternTime(timeValue: string): string {
    const dateIso = this.timetableDraftSignal()?.startTimeIso.split('T')[0] ?? '2025-01-01';
    return timeValue ? toIsoWithTime(dateIso, timeValue) : this.timetableDraftSignal()?.startTimeIso ?? `${dateIso}T00:00:00`;
  }

  private emitDraft(next: TimetableDraft) {
    this.timetableDraftChange.emit(next);
  }

  private pickAnchorTime(stop: RouteStop | undefined, point: TimingPoint | undefined): string | undefined {
    if (!point) {
      return undefined;
    }
    if (stop?.kind === 'origin') {
      return point.departureIso ?? point.arrivalIso;
    }
    if (stop?.kind === 'destination') {
      return point.arrivalIso ?? point.departureIso;
    }
    return point.arrivalIso ?? point.departureIso;
  }

  private buildRouteSequence(routeDraft: RouteDraft): string[] {
    if (routeDraft.routeOps?.length) {
      return routeDraft.routeOps.map((op) => op.id);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    const paths = routeDraft.segmentOpPaths ?? {};
    routeDraft.segments.forEach((segment) => {
      const path = paths[segment.segmentId] ?? [];
      path.forEach((entry) => {
        if (entry.startUniqueOpId && !seen.has(entry.startUniqueOpId)) {
          seen.add(entry.startUniqueOpId);
          ids.push(entry.startUniqueOpId);
        }
        if (entry.endUniqueOpId && !seen.has(entry.endUniqueOpId)) {
          seen.add(entry.endUniqueOpId);
          ids.push(entry.endUniqueOpId);
        }
      });
    });
    if (ids.length) {
      return ids;
    }
    return routeDraft.stops.map((stop) => stop.op?.id ?? stop.stopId);
  }
}
