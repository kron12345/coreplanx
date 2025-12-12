import { Signal, computed } from '@angular/core';
import { Resource } from '../../models/resource';
import { PlanningTimelineRange } from './planning-data.service';
import { PlanningDashboardBoardFacade, StageResourceGroupConfig } from './planning-dashboard-board.facade';
import { PlanningStageId } from './planning-stage.model';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';
import { computeResourceGroups, computeTimelineRange } from './planning-dashboard-timeline.utils';

export interface ResourceGroupView extends StageResourceGroupConfig {
  resources: Resource[];
}

export class PlanningDashboardTimelineFacade {
  readonly timelineRange: Signal<PlanningTimelineRange>;
  readonly resourceGroups: Signal<ResourceGroupView[]>;

  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
      stageTimelineBase: () => PlanningTimelineRange;
      stageTimelineOperations: () => PlanningTimelineRange;
      selectedYearBounds: (stage: PlanningStageId) => TimetableYearBounds[];
      boardFacade: PlanningDashboardBoardFacade;
      stageResourceGroups: Record<PlanningStageId, StageResourceGroupConfig[]>;
    },
  ) {
    this.timelineRange = computed(() =>
      computeTimelineRange(
        this.deps.activeStage(),
        this.deps.stageTimelineBase(),
        this.deps.stageTimelineOperations(),
        this.deps.selectedYearBounds(this.deps.activeStage()),
      ),
    );

    this.resourceGroups = computed(() =>
      computeResourceGroups(
        this.deps.boardFacade.filterResourcesForStage(
          this.deps.activeStage(),
          this.deps.stageResourceSignals[this.deps.activeStage()](),
        ),
        this.deps.stageResourceGroups[this.deps.activeStage()],
      ),
    );
  }
}
