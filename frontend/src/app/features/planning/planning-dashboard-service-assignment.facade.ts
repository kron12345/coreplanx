import { Signal, WritableSignal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDataService } from './planning-data.service';
import { computeAssignmentCandidatesFor, isActivityOwnedBy } from './planning-dashboard-activity.utils';
import { addParticipantToActivity, resourceParticipantCategory } from './planning-dashboard-participant.utils';

export class PlanningDashboardServiceAssignmentFacade {
  constructor(
    private readonly deps: {
      pendingServiceResourceSignal: WritableSignal<Resource | null>;
      serviceAssignmentTargetSignal: WritableSignal<string | null>;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
      data: PlanningDataService;
      activeStage: () => PlanningStageId;
      generateActivityId: (prefix: string) => string;
    },
  ) {}

  handleRequest(resource: Resource): void {
    this.deps.pendingServiceResourceSignal.set(resource);
    const stage = this.deps.activeStage();
    const candidates = computeAssignmentCandidatesFor(resource, this.deps.stageResourceSignals[stage]());
    this.deps.serviceAssignmentTargetSignal.set(candidates[0]?.id ?? null);
  }

  setTarget(resourceId: string | null): void {
    this.deps.serviceAssignmentTargetSignal.set(resourceId);
  }

  confirm(): void {
    const serviceResource = this.deps.pendingServiceResourceSignal();
    const targetResourceId = this.deps.serviceAssignmentTargetSignal();
    if (!serviceResource || !targetResourceId) {
      return;
    }
    const stage = this.deps.activeStage();
    this.deps.data.updateStageData(stage, (stageData) => {
      const targetResource = stageData.resources.find((resource) => resource.id === targetResourceId) ?? null;
      if (!targetResource) {
        return stageData;
      }
      const existing = stageData.activities;
      const serviceActivities = existing.filter((activity) => isActivityOwnedBy(activity, serviceResource.id));
      const updatedExisting = existing.map((activity) => {
        if (!isActivityOwnedBy(activity, serviceResource.id)) {
          return activity;
        }
        return addParticipantToActivity(activity, serviceResource, targetResource, undefined, {
          retainPreviousOwner: false,
          ownerCategory: resourceParticipantCategory(serviceResource),
        });
      });
      const additions: Activity[] = [];
      serviceActivities.forEach((activity) => {
        const duplicate = existing.some(
          (entry) => isActivityOwnedBy(entry, targetResourceId) && entry.serviceId === activity.serviceId,
        );
        if (duplicate) {
          return;
        }
        additions.push(
          addParticipantToActivity(
            { ...activity, id: this.deps.generateActivityId('assign') },
            targetResource,
            serviceResource,
            undefined,
            {
              retainPreviousOwner: false,
              ownerCategory: resourceParticipantCategory(targetResource),
            },
          ),
        );
      });
      return {
        ...stageData,
        activities: [...updatedExisting, ...additions],
      };
    });
    this.deps.pendingServiceResourceSignal.set(null);
    this.deps.serviceAssignmentTargetSignal.set(null);
  }

  cancel(): void {
    this.deps.pendingServiceResourceSignal.set(null);
    this.deps.serviceAssignmentTargetSignal.set(null);
  }
}
