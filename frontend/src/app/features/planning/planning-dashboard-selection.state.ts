import { Signal, computed } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { computeMoveTargetOptions } from './planning-dashboard-timeline.utils';

export class PlanningDashboardSelectionState {
  readonly selectedActivity: Signal<{ activity: Activity; resource: Resource } | null>;
  readonly selectedActivities: Signal<{ activity: Activity; resource: Resource }[]>;
  readonly selectedActivityIdsArray: Signal<string[]>;
  readonly selectedActivitySlot: Signal<{ resourceId: string; activityId: string } | null>;
  readonly moveTargetOptions: Signal<Resource[]>;
  readonly activityMoveTarget: Signal<string>;
  readonly selectionSize: Signal<number>;
  readonly hasSelection: Signal<boolean>;

  constructor(
    private readonly deps: {
      activitySelection: PlanningDashboardActivitySelectionFacade;
      normalizedStageActivitySignals: Record<PlanningStageId, Signal<Activity[]>>;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
      activeStage: () => PlanningStageId;
      activityMoveTargetSignal: Signal<string>;
      stageState: (stage: PlanningStageId) => () => { selectedResourceIds: Set<string> };
    },
  ) {
    this.selectedActivity = computed(() => this.deps.activitySelection.selectedActivityState());
    this.selectedActivities = computed(() =>
      this.deps.activitySelection.computeSelectedActivities(
        this.deps.activitySelection.selectedActivityIds,
        this.deps.normalizedStageActivitySignals[this.deps.activeStage()],
        this.deps.stageResourceSignals[this.deps.activeStage()],
      ),
    );
    this.selectedActivityIdsArray = computed(() => Array.from(this.deps.activitySelection.selectedActivityIds()));
    this.selectedActivitySlot = computed(() => this.deps.activitySelection.selectedActivitySlot());
    this.moveTargetOptions = computed(() => {
      const selected = this.selectedActivities();
      const stage = this.deps.activeStage();
      return computeMoveTargetOptions(selected, this.deps.stageResourceSignals[stage]());
    });
    this.activityMoveTarget = computed(() => this.deps.activityMoveTargetSignal());
    this.selectionSize = computed(() => this.deps.stageState(this.deps.activeStage())().selectedResourceIds.size);
    this.hasSelection = computed(() => this.selectionSize() > 0);
  }
}
