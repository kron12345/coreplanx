import type { PlanningStageId } from './planning-stage.model';
import type { PlanningTimelineRange } from './planning-data.types';

export type StageViewportState = {
  range: PlanningTimelineRange;
  window: PlanningTimelineRange;
  resourceIds: string[];
  signature: string;
};

export type StageViewportMap = Record<PlanningStageId, StageViewportState | null>;

