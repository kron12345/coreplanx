import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { AssistantUiContextService } from '../../core/services/assistant-ui-context.service';
import { TrainPlanService } from '../../core/services/train-plan.service';
import type { TrainPlan } from '../../core/models/train-plan.model';
import type {
  PatternDefinition,
  RouteDraft,
  RouteStop,
  TimetableDraft,
  TimetableDraftBundle,
} from '../../core/models/timetable-draft.model';
import {
  DEFAULT_DWELL_SECONDS,
  DEFAULT_SPEED_KPH,
  addSecondsToIso,
  buildTimingPointsFromRoute,
  buildSegments,
  createDraftId,
  nowIso,
  parseIsoToUtcMs,
  formatUtcMsToIso,
} from './timetable-editor.utils';
import { TimetableRouteBuilderComponent } from './timetable-route-builder.component';
import { TimetableTimingEditorComponent } from './timetable-timing-editor.component';

@Component({
  selector: 'app-timetable-editor',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS, TimetableRouteBuilderComponent, TimetableTimingEditorComponent],
  templateUrl: './timetable-editor.component.html',
  styleUrl: './timetable-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimetableEditorComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly trainPlans = inject(TrainPlanService);
  private readonly assistantUiContext = inject(AssistantUiContextService);

  readonly planId = signal<string | null>(null);
  readonly plan = signal<TrainPlan | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly returnUrl = signal<string>('/');
  readonly orderId = signal<string | null>(null);
  readonly itemId = signal<string | null>(null);

  readonly routeDraft = signal<RouteDraft | null>(null);
  readonly timetableDraft = signal<TimetableDraft | null>(null);
  readonly patternDefinition = signal<PatternDefinition | null>(null);
  readonly activeStep = signal<'route' | 'timing'>('route');
  readonly saveState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly lastSavedIso = signal<string | null>(null);

  private autoSaveEnabled = signal(false);
  private lastDraftSignature: string | null = null;
  private saveTimer: number | null = null;
  private saveInFlight = false;
  private pendingBundle: TimetableDraftBundle | null = null;

  readonly hasPlan = computed(() => !!this.plan());
  readonly canProceedToTiming = computed(() => {
    const draft = this.routeDraft();
    if (!draft) {
      return false;
    }
    const hasOrigin = draft.stops.some((stop) => stop.kind === 'origin');
    const hasDestination = draft.stops.some((stop) => stop.kind === 'destination');
    return hasOrigin && hasDestination;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const planId = params.get('planId');
      if (planId !== this.planId()) {
        this.planId.set(planId);
        void this.loadPlan(planId);
      }
    });

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.returnUrl.set(params.get('returnUrl') ?? '/');
      this.orderId.set(params.get('orderId'));
      this.itemId.set(params.get('itemId'));
    });

    effect(() => {
      if (!this.autoSaveEnabled()) {
        return;
      }
      const signature = this.buildDraftSignature();
      if (!signature || signature === this.lastDraftSignature) {
        return;
      }
      this.lastDraftSignature = signature;
      const bundle = this.buildDraftBundle();
      if (bundle) {
        this.queueAutoSave(bundle);
      }
    });
  }

  async loadPlan(planId: string | null) {
    if (!planId) {
      this.error.set('Kein Fahrplan ausgewählt.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    let plan = this.trainPlans.getById(planId);
    if (!plan) {
      await this.trainPlans.refresh();
      plan = this.trainPlans.getById(planId);
    }
    if (!plan) {
      this.error.set('Fahrplan nicht gefunden.');
      this.loading.set(false);
      return;
    }
    this.plan.set(plan);
    this.initializeDrafts(plan);
    this.loading.set(false);
    this.assistantUiContext.setBreadcrumbs(['Auftragsmanager', 'Fahrplan-Editor']);
    this.assistantUiContext.setDocKey('timetable-editor');
    this.assistantUiContext.setDocSubtopic('Fahrplan-Editor');
  }

  onRouteDraftChange(next: RouteDraft) {
    this.routeDraft.set(next);
    let timetableDraft = this.timetableDraft();
    if (timetableDraft && next.previewStartTimeIso) {
      timetableDraft = this.shiftTimetableStart(timetableDraft, next.previewStartTimeIso);
    }
    const synced = this.syncTimetableDraft(next, timetableDraft);
    if (synced) {
      this.timetableDraft.set(synced);
    }
  }

  onTimetableDraftChange(next: TimetableDraft) {
    this.timetableDraft.set(next);
  }

  onPatternChange(next: PatternDefinition | null) {
    this.patternDefinition.set(next);
  }

  async applyAndReturn() {
    const bundle = this.buildDraftBundle();
    if (bundle) {
      const ok = await this.persistBundle(bundle);
      if (!ok) {
        return;
      }
    }
    this.navigateBack();
  }

  navigateBack() {
    const url = this.returnUrl();
    void this.router.navigateByUrl(url || '/');
  }

  setStep(step: 'route' | 'timing') {
    if (step === 'timing' && !this.canProceedToTiming()) {
      return;
    }
    this.activeStep.set(step);
  }

  goToTiming() {
    this.setStep('timing');
  }

  goToRoute() {
    this.activeStep.set('route');
  }

  private initializeDrafts(plan: TrainPlan) {
    this.autoSaveEnabled.set(false);
    this.saveState.set('idle');
    this.lastSavedIso.set(null);
    const existing = plan.routeMetadata?.timetableDrafts;
    const validExisting = existing?.schemaVersion === 1 ? existing : null;
    let routeDraft = validExisting?.routeDraft ?? this.createRouteDraft(plan);
    routeDraft = {
      ...routeDraft,
      trainPlanId: plan.id,
      segments: buildSegments(routeDraft.stops, routeDraft.assumptions, routeDraft.segments),
    };
    let timetableDraft =
      validExisting?.timetableDraft ?? this.createTimetableDraft(plan, routeDraft);
    timetableDraft = this.syncTimetableDraft(routeDraft, timetableDraft) ?? timetableDraft;
    const routingOptions = {
      includeLinkSections: true,
      maxAlternatives: 2,
      ...(routeDraft.routingOptions ?? {}),
    };
    const previewStartTimeIso =
      routeDraft.previewStartTimeIso ?? timetableDraft.startTimeIso;
    routeDraft = {
      ...routeDraft,
      routingOptions,
      previewStartTimeIso,
      updatedAtIso:
        routeDraft.previewStartTimeIso !== previewStartTimeIso ||
        routeDraft.routingOptions !== routingOptions
          ? nowIso()
          : routeDraft.updatedAtIso,
    };
    const pattern = validExisting?.patternDefinition ?? null;
    this.routeDraft.set(routeDraft);
    this.timetableDraft.set(timetableDraft);
    this.patternDefinition.set(pattern);
    this.lastDraftSignature = this.buildDraftSignature();
    this.autoSaveEnabled.set(true);
  }

  private createRouteDraft(plan: TrainPlan): RouteDraft {
    const stops: RouteStop[] = (plan.stops ?? []).map((stop) => ({
      stopId: createDraftId('stop'),
      kind: stop.type === 'origin' ? 'origin' : stop.type === 'destination' ? 'destination' : 'stop',
      op: stop.locationName
        ? { id: stop.locationCode, name: stop.locationName }
        : undefined,
      dwellSeconds: stop.dwellMinutes ? stop.dwellMinutes * 60 : undefined,
      refs: {
        location: {
          country: stop.countryCode ?? 'CH',
          primaryCode: stop.locationCode,
        },
      },
    }));
    const previewStartTimeIso = `${plan.calendar.validFrom}T08:00:00`;
    return {
      draftId: createDraftId('route'),
      trainPlanId: plan.id,
      stops,
      segments: [],
      assumptions: {
        defaultSpeedKph: DEFAULT_SPEED_KPH,
        defaultDwellSeconds: DEFAULT_DWELL_SECONDS,
      },
      routingOptions: {
        includeLinkSections: true,
        maxAlternatives: 2,
      },
      previewStartTimeIso,
      createdAtIso: nowIso(),
      updatedAtIso: nowIso(),
    };
  }

  private createTimetableDraft(plan: TrainPlan, routeDraft: RouteDraft): TimetableDraft {
    const dateIso = plan.calendar.validFrom;
    const startTimeIso = routeDraft.previewStartTimeIso ?? `${dateIso}T08:00:00`;
    const points = buildTimingPointsFromRoute(routeDraft, startTimeIso);
    return {
      draftId: createDraftId('timetable'),
      routeDraftId: routeDraft.draftId,
      startTimeIso,
      points,
    };
  }

  private syncTimetableDraft(routeDraft: RouteDraft, draft: TimetableDraft | null): TimetableDraft | null {
    if (!draft) {
      return null;
    }
    const stopIds = routeDraft.stops.map((stop) => stop.stopId);
    const existing = new Map(draft.points.map((point) => [point.stopId, point] as const));
    let cursorIso = draft.startTimeIso;
    const points: TimetableDraft['points'] = stopIds.map((stopId, index) => {
      const stop = routeDraft.stops[index];
      const existingPoint = existing.get(stopId);
      if (existingPoint) {
        const anchor = existingPoint.departureIso ?? existingPoint.arrivalIso ?? cursorIso;
        if (anchor) {
          cursorIso = anchor;
        }
        return { ...existingPoint };
      }
      if (index > 0) {
        const segment = routeDraft.segments[index - 1];
        cursorIso = addSecondsToIso(cursorIso, segment?.estimatedTravelSeconds ?? 0) ?? cursorIso;
      }
      const arrivalIso = cursorIso;
      if (stop.kind === 'destination' || stop.kind === 'pass') {
        return { stopId, arrivalIso };
      }
      const dwellSeconds = stop.dwellSeconds ?? routeDraft.assumptions.defaultDwellSeconds;
      const departureIso = addSecondsToIso(arrivalIso, dwellSeconds) ?? arrivalIso;
      cursorIso = departureIso;
      return { stopId, arrivalIso, departureIso };
    });
    return {
      ...draft,
      routeDraftId: routeDraft.draftId,
      points,
    };
  }

  private shiftTimetableStart(draft: TimetableDraft, nextStartIso: string): TimetableDraft {
    if (!nextStartIso || draft.startTimeIso === nextStartIso) {
      return draft;
    }
    const currentStartMs = parseIsoToUtcMs(draft.startTimeIso);
    const nextStartMs = parseIsoToUtcMs(nextStartIso);
    if (!Number.isFinite(currentStartMs) || !Number.isFinite(nextStartMs)) {
      return { ...draft, startTimeIso: nextStartIso };
    }
    const deltaMs = nextStartMs - currentStartMs;
    if (!Number.isFinite(deltaMs) || deltaMs === 0) {
      return { ...draft, startTimeIso: nextStartIso };
    }
    const shiftIso = (iso?: string) => {
      if (!iso) {
        return undefined;
      }
      const ms = parseIsoToUtcMs(iso);
      if (!Number.isFinite(ms)) {
        return iso;
      }
      return formatUtcMsToIso(ms + deltaMs);
    };
    return {
      ...draft,
      startTimeIso: nextStartIso,
      points: draft.points.map((point) => ({
        ...point,
        arrivalIso: shiftIso(point.arrivalIso),
        departureIso: shiftIso(point.departureIso),
      })),
    };
  }

  private buildDraftBundle(): TimetableDraftBundle | null {
    if (!this.routeDraft() || !this.timetableDraft()) {
      return null;
    }
    return {
      schemaVersion: 1,
      routeDraft: this.routeDraft() ?? undefined,
      timetableDraft: this.timetableDraft() ?? undefined,
      patternDefinition: this.patternDefinition() ?? undefined,
      updatedAtIso: nowIso(),
    };
  }

  private buildDraftSignature(): string | null {
    const routeDraft = this.routeDraft();
    const timetableDraft = this.timetableDraft();
    if (!routeDraft || !timetableDraft) {
      return null;
    }
    return JSON.stringify({
      routeDraft,
      timetableDraft,
      patternDefinition: this.patternDefinition(),
    });
  }

  private queueAutoSave(bundle: TimetableDraftBundle) {
    this.pendingBundle = bundle;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushAutoSave();
    }, 800);
  }

  private async flushAutoSave() {
    if (this.saveInFlight) {
      if (this.pendingBundle && this.saveTimer === null) {
        this.saveTimer = window.setTimeout(() => {
          this.saveTimer = null;
          void this.flushAutoSave();
        }, 400);
      }
      return;
    }
    const bundle = this.pendingBundle;
    if (!bundle) {
      return;
    }
    this.pendingBundle = null;
    await this.persistBundle(bundle);
    if (this.pendingBundle) {
      await this.flushAutoSave();
    }
  }

  private async persistBundle(bundle: TimetableDraftBundle): Promise<boolean> {
    const plan = this.plan();
    if (!plan) {
      return false;
    }
    this.saveInFlight = true;
    this.saveState.set('saving');
    const nextPlan: TrainPlan = {
      ...plan,
      routeMetadata: {
        ...(plan.routeMetadata ?? {}),
        timetableDrafts: bundle,
      },
    };
    const saved = await this.trainPlans.savePlan(nextPlan);
    if (saved) {
      this.plan.set(saved);
      this.saveState.set('saved');
      this.lastSavedIso.set(bundle.updatedAtIso);
      this.saveInFlight = false;
      return true;
    } else {
      this.saveState.set('error');
    }
    this.saveInFlight = false;
    return false;
  }
}
