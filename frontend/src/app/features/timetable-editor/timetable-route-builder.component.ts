import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  effect,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, firstValueFrom, map, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { TopologyApiService } from '../../planning/topology-api.service';
import type {
  OperationalPoint,
  TopologyRouteResponse,
  TopologyRouteSegmentedRoute,
} from '../../shared/planning-types';
import type {
  RouteDraft,
  RouteSegment,
  RouteSegmentOpPath,
  RouteStop,
} from '../../core/models/timetable-draft.model';
import {
  DEFAULT_DWELL_SECONDS,
  DEFAULT_SPEED_KPH,
  buildSegments,
  buildTimingPointsFromRoute,
  createDraftId,
  formatIsoTime,
  formatOpLabel,
  nowIso,
  opToRef,
  toIsoWithTime,
} from './timetable-editor.utils';
import { TimetableRouteMapComponent } from './timetable-route-map.component';

type MapViewport = {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  zoom: number;
};

type SegmentRouteOptions = {
  primary: TopologyRouteSegmentedRoute;
  alternatives: TopologyRouteSegmentedRoute[];
};

@Component({
  selector: 'app-timetable-route-builder',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS, TimetableRouteMapComponent],
  templateUrl: './timetable-route-builder.component.html',
  styleUrl: './timetable-route-builder.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimetableRouteBuilderComponent {
  @ViewChild(TimetableRouteMapComponent)
  private readonly mapComponent?: TimetableRouteMapComponent;
  private readonly api = inject(TopologyApiService);

  private readonly draftSignal = signal<RouteDraft | null>(null);
  @Input() set draft(value: RouteDraft | null) {
    this.draftSignal.set(value);
  }
  @Output() draftChange = new EventEmitter<RouteDraft>();

  readonly originSearch = new FormControl<string | OperationalPoint | null>('');
  readonly destinationSearch = new FormControl<string | OperationalPoint | null>('');
  readonly originResults = signal<OperationalPoint[]>([]);
  readonly destinationResults = signal<OperationalPoint[]>([]);
  readonly insertSearch = new FormControl<string | OperationalPoint | null>('');
  readonly insertResults = signal<OperationalPoint[]>([]);
  readonly insertIndex = signal<number | null>(null);
  readonly insertKind = signal<RouteStop['kind']>('stop');
  readonly insertDwellMinutes = signal<number>(Math.round(DEFAULT_DWELL_SECONDS / 60));
  readonly mapOperationalPoints = signal<OperationalPoint[]>([]);
  readonly minOpZoom = 7;
  readonly maxOpMarkers = 500;

  private readonly viewportUpdates = new Subject<MapViewport>();

  readonly stops = computed<RouteStop[]>(() => this.draftSignal()?.stops ?? []);
  readonly segments = computed<RouteSegment[]>(() => this.draftSignal()?.segments ?? []);
  readonly assumptions = computed(() =>
    this.draftSignal()?.assumptions ?? {
      defaultSpeedKph: DEFAULT_SPEED_KPH,
      defaultDwellSeconds: DEFAULT_DWELL_SECONDS,
    },
  );
  readonly routingOptions = computed(
    () =>
      this.draftSignal()?.routingOptions ?? {
        includeLinkSections: true,
        maxAlternatives: 2,
      },
  );
  readonly includeLinkSections = computed(
    () => this.routingOptions().includeLinkSections ?? true,
  );
  readonly maxAlternatives = computed(() =>
    this.routingOptions().maxAlternatives ?? 2,
  );
  readonly electrificationMode = computed(() => {
    const filters = this.routingOptions().attributeFilters ?? [];
    const electrified = filters.find((filter) => filter.key === 'electrified');
    if (!electrified || !electrified.values?.length) {
      return 'any';
    }
    if (electrified.values.includes('true')) {
      return 'electrified';
    }
    if (electrified.values.includes('false')) {
      return 'not_electrified';
    }
    return 'any';
  });
  readonly previewStartTimeIso = computed(() => this.draftSignal()?.previewStartTimeIso ?? '');
  readonly previewStartTimeValue = computed(() => formatIsoTime(this.previewStartTimeIso()));
  readonly previewRows = computed(() => {
    const draft = this.draftSignal();
    if (!draft) {
      return [];
    }
    const timing = draft.previewStartTimeIso
      ? buildTimingPointsFromRoute(draft, draft.previewStartTimeIso)
      : [];
    const timingByStop = new Map(timing.map((point) => [point.stopId, point] as const));
    return draft.stops.map((stop) => ({
      stop,
      timing: timingByStop.get(stop.stopId),
      arrival: formatIsoTime(timingByStop.get(stop.stopId)?.arrivalIso),
      departure: formatIsoTime(timingByStop.get(stop.stopId)?.departureIso),
    }));
  });

  readonly segmentRouteOptions = signal<Record<string, SegmentRouteOptions>>({});
  readonly segmentSelection = signal<Record<string, number>>({});
  readonly routeOpIdsBySegment = signal<Record<string, string[]>>({});
  readonly routeOpLookup = signal<Map<string, OperationalPoint>>(new Map());
  readonly routingState = signal<'idle' | 'loading'>('idle');
  readonly panelOpenState = signal(false);
  readonly showPassPoints = signal(true);

  readonly originStop = computed(() => this.stops().find((stop) => stop.kind === 'origin') ?? null);
  readonly destinationStop = computed(
    () => this.stops().find((stop) => stop.kind === 'destination') ?? null,
  );
  readonly panelOpen = computed(() => this.panelOpenState());

  readonly intermediateStops = computed(() =>
    this.stops().filter((stop) => stop.kind === 'stop' || stop.kind === 'pass'),
  );
  readonly routeOpSequence = computed(() => {
    const idsBySegment = this.routeOpIdsBySegment();
    const sequence: string[] = [];
    this.segments().forEach((segment) => {
      const ids = idsBySegment[segment.segmentId] ?? [];
      ids.forEach((id) => {
        if (!id) {
          return;
        }
        if (sequence.length === 0 || sequence[sequence.length - 1] !== id) {
          sequence.push(id);
        }
      });
    });
    return sequence;
  });
  readonly routeOpDisplay = computed(() => {
    const lookup = this.routeOpLookup();
    return this.routeOpSequence().map((id) => ({
      id,
      op: lookup.get(id),
    }));
  });

  private routeRequestId = 0;
  private lastRouteKey = '';
  private opLookupRequestId = 0;
  private lastOpLookupKey = '';

  constructor() {
    this.setupSearch(this.originSearch, this.originResults);
    this.setupSearch(this.destinationSearch, this.destinationResults);
    this.setupSearch(this.insertSearch, this.insertResults);

    this.viewportUpdates
      .pipe(
        debounceTime(200),
        map((viewport) => ({
          viewport,
          key: this.viewportKey(viewport),
        })),
        distinctUntilChanged((prev, next) => prev.key === next.key),
        switchMap(({ viewport }) => {
          if (viewport.zoom < this.minOpZoom) {
            return of([] as OperationalPoint[]);
          }
          return this.api
            .listOperationalPointsInBounds(
              viewport.minLat,
              viewport.minLng,
              viewport.maxLat,
              viewport.maxLng,
              2000,
            )
            .pipe(catchError(() => of([] as OperationalPoint[])));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((ops) => this.mapOperationalPoints.set(ops ?? []));

    effect(() => {
      const origin = this.originStop();
      if (origin?.op) {
        this.originSearch.setValue(`${origin.op.name} · ${origin.op.id}`, { emitEvent: false });
      }
    });

    effect(() => {
      const destination = this.destinationStop();
      if (destination?.op) {
        this.destinationSearch.setValue(`${destination.op.name} · ${destination.op.id}`, { emitEvent: false });
      }
    });

    effect(() => {
      if (!this.panelOpenState() && this.stops().length) {
        this.panelOpenState.set(true);
      }
    });
  }

  displayOp = (op: OperationalPoint | string | null): string => {
    if (!op || typeof op === 'string') {
      return op ?? '';
    }
    return formatOpLabel(op);
  };

  stopLabel(stopId: string): string {
    const stop = this.stops().find((entry) => entry.stopId === stopId);
    return stop?.op?.name ?? stopId;
  }

  setOrigin(op: OperationalPoint) {
    if (!this.draftSignal()) {
      return;
    }
    const nextStops = [...this.stops()];
    const existingIndex = nextStops.findIndex((stop) => stop.kind === 'origin');
    const updatedStop: RouteStop = {
      stopId: existingIndex >= 0 ? nextStops[existingIndex].stopId : createDraftId('stop'),
      kind: 'origin',
      op: opToRef(op),
      dwellSeconds: 0,
      refs: {
        location: { country: op.countryCode, primaryCode: op.uniqueOpId },
      },
    };
    if (existingIndex >= 0) {
      nextStops[existingIndex] = updatedStop;
    } else {
      nextStops.unshift(updatedStop);
    }
    this.panelOpenState.set(true);
    this.emitDraft(this.applySegments(nextStops));
  }

  setDestination(op: OperationalPoint) {
    if (!this.draftSignal()) {
      return;
    }
    const nextStops = [...this.stops()];
    const existingIndex = nextStops.findIndex((stop) => stop.kind === 'destination');
    const updatedStop: RouteStop = {
      stopId: existingIndex >= 0 ? nextStops[existingIndex].stopId : createDraftId('stop'),
      kind: 'destination',
      op: opToRef(op),
      dwellSeconds: 0,
      refs: {
        location: { country: op.countryCode, primaryCode: op.uniqueOpId },
      },
    };
    if (existingIndex >= 0) {
      nextStops[existingIndex] = updatedStop;
    } else {
      nextStops.push(updatedStop);
    }
    this.panelOpenState.set(true);
    this.emitDraft(this.applySegments(nextStops));
  }

  addIntermediate(op: OperationalPoint) {
    if (!this.draftSignal()) {
      return;
    }
    if (this.hasStopForOp(op.uniqueOpId)) {
      return;
    }
    const nextStops = [...this.stops()];
    const destinationIndex = nextStops.findIndex((stop) => stop.kind === 'destination');
    const newStop: RouteStop = {
      stopId: createDraftId('stop'),
      kind: 'stop',
      op: opToRef(op),
      dwellSeconds: this.assumptions().defaultDwellSeconds,
      refs: {
        location: { country: op.countryCode, primaryCode: op.uniqueOpId },
      },
    };
    const insertIndex = destinationIndex >= 0 ? destinationIndex : nextStops.length;
    nextStops.splice(insertIndex, 0, newStop);
    this.panelOpenState.set(true);
    this.emitDraft(this.applySegments(nextStops));
    this.insertSearch.setValue('', { emitEvent: false });
  }

  openInsert(afterIndex: number) {
    this.panelOpenState.set(true);
    const insertIndex = this.resolveInsertIndex(afterIndex);
    this.insertIndex.set(insertIndex);
    this.insertKind.set('stop');
    this.insertDwellMinutes.set(Math.round(this.assumptions().defaultDwellSeconds / 60));
    this.insertSearch.setValue('', { emitEvent: false });
  }

  cancelInsert() {
    this.insertIndex.set(null);
    this.insertSearch.setValue('', { emitEvent: false });
  }

  confirmInsert(op: OperationalPoint) {
    const current = this.draftSignal();
    const index = this.insertIndex();
    if (!current || index === null) {
      return;
    }
    if (this.hasStopForOp(op.uniqueOpId)) {
      this.cancelInsert();
      return;
    }
    const nextStops = [...this.stops()];
    const kind = this.insertKind();
    const dwellMinutes = this.insertDwellMinutes();
    const dwellSeconds =
      kind === 'stop'
        ? Math.max(0, Math.round((Number(dwellMinutes) || 0) * 60))
        : 0;
    const newStop: RouteStop = {
      stopId: createDraftId('stop'),
      kind: kind === 'origin' || kind === 'destination' ? 'stop' : kind,
      op: opToRef(op),
      dwellSeconds,
      refs: {
        location: { country: op.countryCode, primaryCode: op.uniqueOpId },
      },
    };
    const safeIndex = Math.max(1, Math.min(index, nextStops.length));
    nextStops.splice(safeIndex, 0, newStop);
    this.cancelInsert();
    this.panelOpenState.set(true);
    this.emitDraft(this.applySegments(nextStops));
  }

  updateInsertKind(kind: RouteStop['kind']) {
    this.insertKind.set(kind);
  }

  updateInsertDwell(value: string) {
    const next = Number(value);
    this.insertDwellMinutes.set(Number.isFinite(next) ? next : 0);
  }

  removeStop(stopId: string) {
    if (!this.draftSignal()) {
      return;
    }
    const nextStops = this.stops().filter((stop) => stop.stopId !== stopId);
    this.emitDraft(this.applySegments(nextStops));
  }

  moveStop(stopId: string, direction: -1 | 1) {
    if (!this.draftSignal()) {
      return;
    }
    const list = [...this.stops()];
    const index = list.findIndex((stop) => stop.stopId === stopId);
    if (index < 0) {
      return;
    }
    const current = list[index];
    if (current.kind === 'origin' || current.kind === 'destination') {
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= list.length) {
      return;
    }
    const [entry] = list.splice(index, 1);
    list.splice(target, 0, entry);
    this.emitDraft(this.applySegments(list));
  }

  updateStopKind(stopId: string, kind: RouteStop['kind']) {
    if (!this.draftSignal()) {
      return;
    }
    const nextStops = this.stops().map((stop) =>
      stop.stopId === stopId
        ? {
            ...stop,
            kind,
            dwellSeconds:
              kind === 'stop'
                ? stop.dwellSeconds ?? this.assumptions().defaultDwellSeconds
                : 0,
          }
        : stop,
    );
    this.emitDraft(this.applySegments(nextStops));
  }

  updateDwell(stopId: string, dwellMinutes: string) {
    if (!this.draftSignal()) {
      return;
    }
    const minutes = Number(dwellMinutes);
    const seconds = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes * 60)) : 0;
    const nextStops = this.stops().map((stop) =>
      stop.stopId === stopId ? { ...stop, dwellSeconds: seconds } : stop,
    );
    this.emitDraft(this.applySegments(nextStops));
  }

  updateAssumptionSpeed(value: string) {
    if (!this.draftSignal()) {
      return;
    }
    const current = this.draftSignal() as RouteDraft;
    const next = Number(value);
    const speed = Number.isFinite(next) && next > 0 ? next : DEFAULT_SPEED_KPH;
    const updatedDraft: RouteDraft = {
      ...current,
      assumptions: {
        ...current.assumptions,
        defaultSpeedKph: speed,
      },
    };
    const nextSegments = buildSegments(updatedDraft.stops, updatedDraft.assumptions, updatedDraft.segments);
    this.emitDraft({
      ...updatedDraft,
      segments: nextSegments,
      updatedAtIso: nowIso(),
    });
  }

  updateAssumptionDwell(value: string) {
    if (!this.draftSignal()) {
      return;
    }
    const current = this.draftSignal() as RouteDraft;
    const next = Number(value);
    const dwellSeconds = Number.isFinite(next) && next >= 0 ? Math.round(next * 60) : DEFAULT_DWELL_SECONDS;
    const nextStops = this.stops().map((stop) =>
      stop.kind === 'stop' && !stop.dwellSeconds
        ? { ...stop, dwellSeconds }
        : stop,
    );
    this.emitDraft({
      ...current,
      assumptions: {
        ...current.assumptions,
        defaultDwellSeconds: dwellSeconds,
      },
      stops: nextStops,
      segments: buildSegments(nextStops, { ...current.assumptions, defaultDwellSeconds: dwellSeconds }, current.segments),
      updatedAtIso: nowIso(),
    });
  }

  onMapOperationalPointSelected(op: OperationalPoint) {
    this.panelOpenState.set(true);
    if (this.hasStopForOp(op.uniqueOpId)) {
      return;
    }
    if (!this.originStop()) {
      this.setOrigin(op);
      return;
    }
    if (!this.destinationStop()) {
      this.setDestination(op);
      return;
    }
    this.addIntermediate(op);
  }

  onMapViewportChanged(viewport: MapViewport) {
    this.viewportUpdates.next(viewport);
  }

  updateIncludeLinkSections(include: boolean) {
    const current = this.draftSignal();
    if (!current) {
      return;
    }
    const nextDraft: RouteDraft = {
      ...current,
      routingOptions: {
        ...(current.routingOptions ?? {}),
        includeLinkSections: include,
      },
      updatedAtIso: nowIso(),
    };
    this.queueRoutePlanning(nextDraft);
    this.emitDraft(nextDraft);
  }

  updateMaxAlternatives(value: string) {
    const current = this.draftSignal();
    if (!current) {
      return;
    }
    const parsed = Number(value);
    const maxAlternatives = Number.isFinite(parsed)
      ? Math.max(0, Math.min(3, Math.round(parsed)))
      : 0;
    const nextDraft: RouteDraft = {
      ...current,
      routingOptions: {
        ...(current.routingOptions ?? {}),
        maxAlternatives,
      },
      updatedAtIso: nowIso(),
    };
    this.queueRoutePlanning(nextDraft);
    this.emitDraft(nextDraft);
  }

  updateElectrificationFilter(mode: 'any' | 'electrified' | 'not_electrified') {
    const current = this.draftSignal();
    if (!current) {
      return;
    }
    const existing = current.routingOptions?.attributeFilters ?? [];
    const filtered = existing.filter((filter) => filter.key !== 'electrified');
    if (mode === 'electrified') {
      filtered.push({ key: 'electrified', values: ['true'] });
    } else if (mode === 'not_electrified') {
      filtered.push({ key: 'electrified', values: ['false'] });
    }
    const nextDraft: RouteDraft = {
      ...current,
      routingOptions: {
        ...(current.routingOptions ?? {}),
        attributeFilters: filtered,
      },
      updatedAtIso: nowIso(),
    };
    this.queueRoutePlanning(nextDraft);
    this.emitDraft(nextDraft);
  }

  updatePreviewStartTime(value: string) {
    const current = this.draftSignal();
    if (!current) {
      return;
    }
    const timeValue = value?.trim();
    const baseDate = (current.previewStartTimeIso ?? nowIso()).split('T')[0];
    const nextIso = timeValue ? toIsoWithTime(baseDate, timeValue) : undefined;
    const nextDraft: RouteDraft = {
      ...current,
      previewStartTimeIso: nextIso,
      updatedAtIso: nowIso(),
    };
    this.emitDraft(nextDraft);
  }

  selectAlternative(segmentId: string, selection: number) {
    const current = this.draftSignal();
    if (!current) {
      return;
    }
    const options = this.segmentRouteOptions()[segmentId];
    if (!options) {
      return;
    }
    const nextSelection = {
      ...this.segmentSelection(),
      [segmentId]: selection,
    };
    this.segmentSelection.set(nextSelection);
    const route =
      selection === 0 ? options.primary : options.alternatives[selection - 1];
    if (!route) {
      return;
    }
    const nextPaths = {
      ...(current.segmentOpPaths ?? {}),
      [segmentId]: this.segmentPathFromRoute(route),
    };
    const nextSegments = this.segments().map((segment) =>
      segment.segmentId === segmentId
        ? this.applyRouteToSegment(segment, route, current.assumptions)
        : segment,
    );
    this.updateRouteOpsFromSelection(
      { ...current, segments: nextSegments, segmentOpPaths: nextPaths },
      this.segmentRouteOptions(),
    );
    this.emitDraft({
      ...current,
      segments: nextSegments,
      segmentOpPaths: nextPaths,
      updatedAtIso: nowIso(),
    });
  }

  segmentSelectionValue(segmentId: string): number {
    return this.segmentSelection()[segmentId] ?? 0;
  }

  togglePassPoints() {
    this.showPassPoints.update((value) => !value);
  }

  focusPassOp(opId: string) {
    const entry = this.routeOpLookup().get(opId);
    if (!entry?.position || !this.mapComponent) {
      return;
    }
    this.mapComponent.focusOnCoordinates(entry.position.lat, entry.position.lng);
  }

  convertPassOpToStop(opId: string) {
    const current = this.draftSignal();
    if (!current || this.hasStopForOp(opId)) {
      return;
    }
    const insertIndex = this.findInsertIndexForOp(opId);
    const lookup = this.routeOpLookup();
    const op = lookup.get(opId);
    const newStop: RouteStop = {
      stopId: createDraftId('stop'),
      kind: 'stop',
      op: op
        ? opToRef(op)
        : {
            id: opId,
            name: opId,
          },
      dwellSeconds: this.assumptions().defaultDwellSeconds,
      refs: op
        ? { location: { country: op.countryCode, primaryCode: op.uniqueOpId } }
        : undefined,
    };
    const nextStops = [...this.stops()];
    const safeIndex = Math.max(1, Math.min(insertIndex, nextStops.length));
    nextStops.splice(safeIndex, 0, newStop);
    this.panelOpenState.set(true);
    this.emitDraft(this.applySegments(nextStops));
  }

  updateSegmentSpeed(segmentId: string, value: string) {
    if (!this.draftSignal()) {
      return;
    }
    const current = this.draftSignal() as RouteDraft;
    const speed = Number(value);
    const nextSegments = this.segments().map((segment) => {
      if (segment.segmentId !== segmentId) {
        return segment;
      }
      const assumedSpeedKph = Number.isFinite(speed) && speed > 0 ? speed : undefined;
      const baseSpeed = assumedSpeedKph ?? this.assumptions().defaultSpeedKph;
      const travelSeconds =
        baseSpeed > 0
          ? Math.round(segment.distanceMeters / (baseSpeed * (1000 / 3600)))
          : 0;
      return {
        ...segment,
        assumedSpeedKph,
        estimatedTravelSeconds: travelSeconds,
      };
    });
    this.emitDraft({
      ...current,
      segments: nextSegments,
      updatedAtIso: nowIso(),
    });
  }

  private setupSearch(control: FormControl<string | OperationalPoint | null>, target: typeof this.originResults) {
    control.valueChanges
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((value) => {
          const term = typeof value === 'string' ? value.trim() : value?.name ?? '';
          if (!term || term.length < 2) {
            return of({ items: [] as OperationalPoint[] });
          }
          return this.api.listOperationalPointsPaged(0, 15, term).pipe(
            catchError(() => of({ items: [] as OperationalPoint[] })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((response) => target.set(response.items ?? []));
  }

  private applySegments(stops: RouteStop[]): RouteDraft {
    const current = this.draftSignal();
    if (!current) {
      throw new Error('Draft not initialized');
    }
    const segments = buildSegments(stops, current.assumptions, current.segments);
    const nextDraft: RouteDraft = {
      ...current,
      stops,
      segments,
      updatedAtIso: nowIso(),
    };
    this.queueRoutePlanning(nextDraft);
    return nextDraft;
  }

  private emitDraft(next: RouteDraft) {
    this.draftChange.emit(next);
  }

  private queueRoutePlanning(draft: RouteDraft) {
    const routeKey = this.buildRouteKey(draft);
    if (!routeKey || routeKey === this.lastRouteKey) {
      return;
    }
    this.lastRouteKey = routeKey;
    const requestId = ++this.routeRequestId;
    this.routingState.set('loading');
    this.routeOpIdsBySegment.set({});
    this.routeOpLookup.set(new Map());
    const pairs = this.buildRoutePairs(draft.stops);
    if (!pairs.length || pairs.length !== draft.stops.length - 1) {
      this.routingState.set('idle');
      return;
    }
    const routingOptions = draft.routingOptions ?? {};
    const includeLinkSections = routingOptions.includeLinkSections ?? true;
    const allowedNatures = routingOptions.allowedNatures;
    const attributeFilters = routingOptions.attributeFilters;
    const maxAlternatives = routingOptions.maxAlternatives;
    Promise.all(
      pairs.map((pair) =>
        firstValueFrom(
          this.api
            .planSectionRoute({
              startUniqueOpId: pair.from.op?.id ?? '',
              endUniqueOpId: pair.to.op?.id ?? '',
              includeLinkSections,
              allowedNatures,
              attributeFilters,
              maxAlternatives,
            })
            .pipe(catchError(() => of(null as TopologyRouteResponse | null))),
        ),
      ),
    ).then((results) => {
      if (requestId !== this.routeRequestId) {
        return;
      }
      if (!results.length) {
        this.routingState.set('idle');
        return;
      }
      const merged = this.mergeRoutesIntoSegments(draft, results);
      if (!merged) {
        this.routingState.set('idle');
        return;
      }
      const nextSegments = this.applySelectionToSegments(
        merged.segments,
        merged.options,
        draft.assumptions,
      );
      this.segmentRouteOptions.set(merged.options);
      this.updateRouteOpsFromSelection(
        { ...draft, segments: nextSegments, segmentOpPaths: merged.paths },
        merged.options,
      );
      this.emitDraft({
        ...draft,
        segments: nextSegments,
        segmentOpPaths: merged.paths,
        updatedAtIso: nowIso(),
      });
      this.routingState.set('idle');
    }).catch(() => {
      if (requestId === this.routeRequestId) {
        this.routingState.set('idle');
      }
    });
  }

  private buildRoutePairs(stops: RouteStop[]): Array<{ from: RouteStop; to: RouteStop }> {
    const pairs: Array<{ from: RouteStop; to: RouteStop }> = [];
    for (let index = 0; index < stops.length - 1; index += 1) {
      const from = stops[index];
      const to = stops[index + 1];
      if (from.op?.id && to.op?.id) {
        pairs.push({ from, to });
      }
    }
    return pairs;
  }

  private resolveInsertIndex(afterIndex: number): number {
    const destinationIndex = this.stops().findIndex((stop) => stop.kind === 'destination');
    const target = afterIndex + 1;
    if (destinationIndex >= 0) {
      return Math.min(target, destinationIndex);
    }
    return Math.max(1, target);
  }

  private buildRouteKey(draft: RouteDraft): string {
    const stopsKey = draft.stops.map((stop) => stop.op?.id ?? stop.stopId).join('|');
    if (!stopsKey) {
      return '';
    }
    const options = draft.routingOptions ?? {};
    const includeLink = options.includeLinkSections ?? true;
    const natures = (options.allowedNatures ?? []).slice().sort().join(',');
    const filters = (options.attributeFilters ?? [])
      .map((filter) => {
        const key = filter.key?.trim().toLowerCase() ?? '';
        const values = (filter.values ?? []).slice().sort().join(',');
        return `${key}:${values}`;
      })
      .sort()
      .join('|');
    const maxAlternatives = options.maxAlternatives ?? '';
    return `${stopsKey}::${includeLink}|${natures}|${filters}|${maxAlternatives}`;
  }

  private viewportKey(viewport: MapViewport): string {
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return [
      round(viewport.minLat),
      round(viewport.minLng),
      round(viewport.maxLat),
      round(viewport.maxLng),
      Math.round(viewport.zoom),
    ].join('|');
  }

  private mergeRoutesIntoSegments(
    draft: RouteDraft,
    routes: Array<TopologyRouteResponse | null>,
  ): {
    segments: RouteSegment[];
    options: Record<string, SegmentRouteOptions>;
    paths: Record<string, RouteSegmentOpPath[]>;
  } | null {
    if (!routes.length) {
      return null;
    }
    const baseSegments = buildSegments(draft.stops, draft.assumptions, draft.segments);
    const options: Record<string, SegmentRouteOptions> = {};
    const paths: Record<string, RouteSegmentOpPath[]> = {};
    const nextSegments = baseSegments.map((segment, index) => {
      const route = routes[index];
      if (!route || route.status !== 'ok') {
        return segment;
      }
      if (route.segments?.length) {
        paths[segment.segmentId] = route.segments.map((entry) => ({
          startUniqueOpId: entry.startUniqueOpId,
          endUniqueOpId: entry.endUniqueOpId,
          lengthKm: entry.lengthKm ?? null,
        }));
      }
      const primary: TopologyRouteSegmentedRoute = {
        totalDistanceKm: route.totalDistanceKm,
        segments: route.segments,
        geometry: route.geometry,
      };
      options[segment.segmentId] = {
        primary,
        alternatives: route.alternatives ?? [],
      };
      return this.applyRouteToSegment(segment, primary, draft.assumptions);
    });
    return { segments: nextSegments, options, paths };
  }

  private updateRouteOpsFromSelection(
    draft: RouteDraft,
    options: Record<string, SegmentRouteOptions>,
  ) {
    const selections = this.segmentSelection();
    const idsBySegment: Record<string, string[]> = {};
    const segmentOrder = buildSegments(draft.stops, draft.assumptions, draft.segments);
    segmentOrder.forEach((segment) => {
      const segmentOptions = options[segment.segmentId];
      if (!segmentOptions) {
        return;
      }
      const selection = selections[segment.segmentId] ?? 0;
      const route =
        selection === 0
          ? segmentOptions.primary
          : segmentOptions.alternatives[selection - 1];
      idsBySegment[segment.segmentId] = this.extractOpSequence(route);
    });
    this.routeOpIdsBySegment.set(idsBySegment);
    const orderedIds: string[] = [];
    const seen = new Set<string>();
    segmentOrder.forEach((segment) => {
      const ids = idsBySegment[segment.segmentId] ?? [];
      ids.forEach((id) => {
        if (!id || seen.has(id)) {
          return;
        }
        seen.add(id);
        orderedIds.push(id);
      });
    });
    this.refreshRouteOpLookup(orderedIds);
  }

  private refreshRouteOpLookup(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id)));
    if (!uniqueIds.length) {
      this.lastOpLookupKey = '';
      this.routeOpLookup.set(new Map());
      if (this.draftSignal()?.routeOps?.length) {
        const current = this.draftSignal() as RouteDraft;
        this.emitDraft({ ...current, routeOps: [], updatedAtIso: nowIso() });
      }
      return;
    }
    const key = uniqueIds.join('|');
    if (key === this.lastOpLookupKey) {
      return;
    }
    this.lastOpLookupKey = key;
    const requestId = ++this.opLookupRequestId;
    firstValueFrom(this.api.listOperationalPointsByIds(uniqueIds))
      .then((ops) => {
        if (requestId !== this.opLookupRequestId) {
          return;
        }
        const lookup = new Map(ops.map((op) => [op.uniqueOpId, op]));
        this.routeOpLookup.set(lookup);
        const draft = this.draftSignal();
        if (draft) {
          const ordered = this.routeOpSequence();
          const routeOps = ordered.map((id) => {
            const op = lookup.get(id);
            return {
              id,
              name: op?.name ?? id,
              lat: op?.position?.lat,
              lon: op?.position?.lng,
            };
          });
          this.emitDraft({ ...draft, routeOps, updatedAtIso: nowIso() });
        }
      })
      .catch(() => {
        if (requestId === this.opLookupRequestId) {
          this.routeOpLookup.set(new Map());
        }
      });
  }

  private extractOpSequence(route?: TopologyRouteSegmentedRoute): string[] {
    const segments = route?.segments ?? [];
    if (!segments.length) {
      return [];
    }
    const sequence: string[] = [];
    segments.forEach((segment) => {
      if (segment.startUniqueOpId) {
        if (sequence.length === 0 || sequence[sequence.length - 1] !== segment.startUniqueOpId) {
          sequence.push(segment.startUniqueOpId);
        }
      }
      if (segment.endUniqueOpId) {
        if (sequence.length === 0 || sequence[sequence.length - 1] !== segment.endUniqueOpId) {
          sequence.push(segment.endUniqueOpId);
        }
      }
    });
    return sequence;
  }

  private segmentPathFromRoute(route: TopologyRouteSegmentedRoute): RouteSegmentOpPath[] {
    const segments = route.segments ?? [];
    return segments.map((entry) => ({
      startUniqueOpId: entry.startUniqueOpId,
      endUniqueOpId: entry.endUniqueOpId,
      lengthKm: entry.lengthKm ?? null,
    }));
  }

  private findInsertIndexForOp(opId: string): number {
    const sequence = this.routeOpSequence();
    if (!sequence.length) {
      return this.stops().length;
    }
    const targetIndex = sequence.indexOf(opId);
    if (targetIndex < 0) {
      return this.stops().length;
    }
    const stopPositions = this.stops()
      .map((stop, index) => ({
        index,
        pos: sequence.indexOf(stop.op?.id ?? ''),
      }))
      .filter((entry) => entry.pos >= 0)
      .sort((a, b) => a.pos - b.pos);
    let insertAfter = 0;
    for (const entry of stopPositions) {
      if (entry.pos < targetIndex) {
        insertAfter = entry.index;
      } else {
        break;
      }
    }
    const destinationIndex = this.stops().findIndex((stop) => stop.kind === 'destination');
    if (destinationIndex >= 0) {
      return Math.min(insertAfter + 1, destinationIndex);
    }
    return insertAfter + 1;
  }

  private hasStopForOp(uniqueOpId: string): boolean {
    return this.stops().some((stop) => stop.op?.id === uniqueOpId);
  }

  private applyRouteToSegment(
    segment: RouteSegment,
    route: TopologyRouteSegmentedRoute,
    assumptions: RouteDraft['assumptions'],
  ): RouteSegment {
    const geometry = (route.geometry ?? [])
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      .map((point) => [point.lat, point.lng]);
    if (!geometry.length) {
      return segment;
    }
    const distanceMeters =
      route.totalDistanceKm && route.totalDistanceKm > 0
        ? Math.round(route.totalDistanceKm * 1000)
        : segment.distanceMeters;
    const assumedSpeedKph = segment.assumedSpeedKph;
    const speed = assumedSpeedKph ?? assumptions.defaultSpeedKph;
    const estimatedTravelSeconds =
      speed > 0
        ? Math.round(distanceMeters / (speed * (1000 / 3600)))
        : segment.estimatedTravelSeconds;
    return {
      ...segment,
      distanceMeters,
      estimatedTravelSeconds,
      geometry,
    };
  }

  private applySelectionToSegments(
    segments: RouteSegment[],
    options: Record<string, SegmentRouteOptions>,
    assumptions: RouteDraft['assumptions'],
  ): RouteSegment[] {
    const selections = this.segmentSelection();
    return segments.map((segment) => {
      const selection = selections[segment.segmentId] ?? 0;
      const segmentOptions = options[segment.segmentId];
      if (!segmentOptions) {
        return segment;
      }
      const route =
        selection === 0
          ? segmentOptions.primary
          : segmentOptions.alternatives[selection - 1];
      if (!route) {
        return segment;
      }
      return this.applyRouteToSegment(segment, route, assumptions);
    });
  }
}
