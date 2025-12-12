import { Signal, WritableSignal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { addParticipantToActivity, resourceParticipantCategory } from './planning-dashboard-participant.utils';
import { ActivityTypeDefinition } from '../../core/services/activity-type.service';

export class PlanningDashboardSelectionActionsFacade {
  constructor(
    private readonly deps: {
      activitySelection: PlanningDashboardActivitySelectionFacade;
      activityFacade: PlanningDashboardActivityFacade;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
      activeStage: () => PlanningStageId;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      isPendingSelection: (activityId: string | null | undefined) => boolean;
      commitPendingActivityUpdate: (activity: Activity) => void;
      replaceActivity: (activity: Activity) => void;
      findActivityType: (typeId: string | null | undefined) => ActivityTypeDefinition | null;
      activityMoveTargetSignal: WritableSignal<string>;
    },
  ) {}

  resetMoveTarget(): void {
    this.deps.activityMoveTargetSignal.set('');
  }

  setMoveSelectionTarget(resourceId: string | null): void {
    this.deps.activityMoveTargetSignal.set(resourceId ?? '');
  }

  moveSelectionToTarget(): void {
    const targetId = this.deps.activityMoveTargetSignal();
    if (!targetId) {
      return;
    }
    const stage = this.deps.activeStage();
    const targetResource = this.deps.stageResourceSignals[stage]().find((resource) => resource.id === targetId);
    if (!targetResource) {
      return;
    }
    const selectionIds = this.deps.activitySelection.selectedActivityIds();
    if (selectionIds.size === 0) {
      return;
    }
    const idsToMove = new Set(selectionIds);
    this.deps.updateStageActivities(stage, (activities) =>
      activities.map((activity) => {
        if (!idsToMove.has(activity.id)) {
          return activity;
        }
        return addParticipantToActivity(activity, targetResource, undefined, undefined, {
          retainPreviousOwner: false,
          ownerCategory: resourceParticipantCategory(targetResource),
        });
      }),
    );
    const activeSelection = this.deps.activitySelection.selectedActivityState();
    if (activeSelection && idsToMove.has(activeSelection.activity.id)) {
      this.deps.activitySelection.selectedActivityState.set({
        activity: this.deps.applyActivityTypeConstraints(
          addParticipantToActivity(
            activeSelection.activity,
            targetResource,
            undefined,
            undefined,
            { retainPreviousOwner: false, ownerCategory: resourceParticipantCategory(targetResource) },
          ),
        ),
        resource: targetResource,
      });
    }
  }

  shiftSelectedActivityBy(deltaMinutes: number, normalizedActivities: { activity: Activity; resource: Resource }[]): void {
    this.deps.activityFacade.shiftSelectedActivityBy(
      deltaMinutes,
      normalizedActivities,
      this.deps.activitySelection.selectedActivityState(),
      (typeId) => this.deps.findActivityType(typeId),
      (activityId) => this.deps.isPendingSelection(activityId),
      (activity) => this.deps.applyActivityTypeConstraints(activity),
      (activity) => this.deps.commitPendingActivityUpdate(activity),
      (activity) => this.deps.replaceActivity(activity),
    );
  }

  snapSelectedActivity(
    direction: 'previous' | 'next',
    findNeighbors: (activity: Activity) => { previous: Activity | null; next: Activity | null },
    activityForm: { patchValue: (val: any) => void },
    findType: (typeId: string | null | undefined) => ActivityTypeDefinition | null,
  ): void {
    this.deps.activityFacade.snapToNeighbor(
      direction,
      this.deps.activitySelection.selectedActivityState(),
      activityForm as any,
      findNeighbors,
      findType,
    );
  }

  fillGapForSelectedActivity(
    findNeighbors: (activity: Activity) => { previous: Activity | null; next: Activity | null },
    activityForm: { patchValue: (val: any) => void },
    findType: (typeId: string | null | undefined) => ActivityTypeDefinition | null,
  ): void {
    this.deps.activityFacade.fillGapForSelectedActivity(
      this.deps.activitySelection.selectedActivityState(),
      activityForm as any,
      findNeighbors,
      findType,
    );
  }
}
