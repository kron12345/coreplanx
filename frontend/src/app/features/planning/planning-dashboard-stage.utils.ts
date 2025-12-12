import { ActivatedRoute, Router } from '@angular/router';
import { PlanningStageId, PlanningStageMeta } from './planning-stage.model';

export function normalizeStageId(
  value: string | null,
  stageMetaMap: Record<PlanningStageId, PlanningStageMeta>,
  fallback: PlanningStageId = 'base',
): PlanningStageId {
  if (value && value in stageMetaMap) {
    return value as PlanningStageId;
  }
  return fallback;
}

export function updateStageQueryParam(router: Router, route: ActivatedRoute, stage: PlanningStageId): void {
  void router.navigate([], {
    relativeTo: route,
    queryParams: { stage },
    queryParamsHandling: 'merge',
    replaceUrl: true,
  });
}
