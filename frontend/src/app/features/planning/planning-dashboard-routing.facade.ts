import { ActivatedRoute, Router } from '@angular/router';
import { Signal } from '@angular/core';
import { PlanningStageId, PlanningStageMeta } from './planning-stage.model';
import { normalizeStageId, updateStageQueryParam } from './planning-dashboard-stage.utils';

export class PlanningDashboardRoutingFacade {
  constructor(
    private readonly deps: {
      route: ActivatedRoute;
      router: Router;
      stageMetaMap: Record<PlanningStageId, PlanningStageMeta>;
      activeStageSignal: Signal<PlanningStageId> & { set: (val: PlanningStageId) => void };
      queryFrom: Signal<string | null> & { set: (val: string | null) => void };
      queryTo: Signal<string | null> & { set: (val: string | null) => void };
      onStageChanged: (stage: PlanningStageId) => void;
    },
  ) {}

  init(): void {
    const initialStage = normalizeStageId(
      this.deps.route.snapshot.queryParamMap.get('stage'),
      this.deps.stageMetaMap,
    );
    this.deps.queryFrom.set(this.deps.route.snapshot.queryParamMap.get('from'));
    this.deps.queryTo.set(this.deps.route.snapshot.queryParamMap.get('to'));
    this.setActiveStage(initialStage, false);
    if (this.deps.route.snapshot.queryParamMap.get('stage') !== initialStage) {
      updateStageQueryParam(this.deps.router, this.deps.route, initialStage);
    }

    this.deps.route.queryParamMap.subscribe((params) => {
      const stage = normalizeStageId(params.get('stage'), this.deps.stageMetaMap);
      this.setActiveStage(stage, false);
      this.deps.queryFrom.set(params.get('from'));
      this.deps.queryTo.set(params.get('to'));
    });
  }

  setActiveStage(stage: PlanningStageId, updateUrl: boolean): void {
    const current = this.deps.activeStageSignal();
    if (current === stage) {
      if (updateUrl) {
        updateStageQueryParam(this.deps.router, this.deps.route, stage);
      }
      return;
    }
    this.deps.onStageChanged(stage);
    this.deps.activeStageSignal.set(stage);
    if (updateUrl) {
      updateStageQueryParam(this.deps.router, this.deps.route, stage);
    }
  }
}
