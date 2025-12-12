import { Signal, computed } from '@angular/core';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardServiceAssignmentFacade } from './planning-dashboard-service-assignment.facade';
import { computeAssignmentCandidatesFor } from './planning-dashboard-activity.utils';

export class PlanningDashboardAssignmentFacade {
  readonly assignmentCandidates: Signal<Resource[]>;

  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      pendingServiceResourceSignal: Signal<Resource | null>;
      serviceAssignmentTargetSignal: Signal<string | null>;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
      serviceAssignmentFacade: PlanningDashboardServiceAssignmentFacade;
    },
  ) {
    this.assignmentCandidates = computed(() => {
      const pending = this.deps.pendingServiceResourceSignal();
      if (!pending) {
        return [];
      }
      const stage = this.deps.activeStage();
      return computeAssignmentCandidatesFor(pending, this.deps.stageResourceSignals[stage]());
    });
  }

  handleServiceAssignRequest(resource: Resource): void {
    this.deps.serviceAssignmentFacade.handleRequest(resource);
  }

  setServiceAssignmentTarget(resourceId: string | null): void {
    this.deps.serviceAssignmentFacade.setTarget(resourceId);
  }

  confirmServiceAssignment(): void {
    this.deps.serviceAssignmentFacade.confirm();
  }

  cancelServiceAssignment(): void {
    this.deps.serviceAssignmentFacade.cancel();
  }
}
