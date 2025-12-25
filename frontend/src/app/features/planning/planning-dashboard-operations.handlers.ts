import { Signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { addParticipantToActivity, moveParticipantToResource, resourceParticipantCategory } from './planning-dashboard-participant.utils';

export class PlanningDashboardOperationsHandlers {
  constructor(
    private readonly deps: {
      stageResourceSignal: Signal<Resource[]>;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      activityOwnerId: (activity: Activity) => string | null;
    },
  ) {}

  handleReposition(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    sourceResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    participantResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    const stage: PlanningStageId = 'operations';
    const targetId = event.targetResourceId;
    const targetResource =
      this.deps.stageResourceSignal().find((resource) => resource.id === targetId) ?? null;
    if (!targetResource) {
      return;
    }
    const sourceResourceId = event.sourceResourceId ?? event.targetResourceId;
    const resourceChanged = event.targetResourceId !== sourceResourceId;
    const attrs = (event.activity.attributes ?? {}) as Record<string, unknown>;
    const linkGroupId =
      typeof attrs['linkGroupId'] === 'string' ? (attrs['linkGroupId'] as string) : null;
    const isOwnerSlot = event.isOwnerSlot ?? true;
    const participantResourceId = event.participantResourceId ?? event.sourceResourceId ?? null;
    const targetCategory =
      event.participantCategory ?? resourceParticipantCategory(targetResource);
    const applyUpdate = (activity: Activity): Activity => {
      const updatedBase: Activity = {
        ...activity,
        start: event.start.toISOString(),
        end: event.end ? event.end.toISOString() : null,
      };
      const withManual = this.markBoundaryManual(updatedBase);
      if (!resourceChanged) {
        return withManual;
      }
      if (!isOwnerSlot && participantResourceId) {
        return moveParticipantToResource(withManual, participantResourceId, targetResource);
      }
      return addParticipantToActivity(withManual, targetResource, undefined, undefined, {
        retainPreviousOwner: false,
        ownerCategory: targetCategory,
      });
    };
    this.deps.updateStageActivities(stage, (activities) => {
      if (!linkGroupId) {
        return activities.map((activity) => {
          if (activity.id !== event.activity.id) {
            return activity;
          }
          return applyUpdate(activity);
        });
      }
      return activities.map((activity) => {
        const currentAttrs = (activity.attributes ?? {}) as Record<string, unknown>;
        const currentGroupId =
          typeof currentAttrs['linkGroupId'] === 'string'
            ? (currentAttrs['linkGroupId'] as string)
            : null;
        if (activity.id === event.activity.id) {
          return applyUpdate(activity);
        }
        if (!currentGroupId || currentGroupId !== linkGroupId) {
          return activity;
        }
        return {
          ...activity,
          start: event.start.toISOString(),
          end: event.end ? event.end.toISOString() : null,
        };
      });
    });
    const activeSelection = this.deps.activitySelection.selectedActivityState();
    if (activeSelection?.activity.id === event.activity.id) {
      const resource = targetResource;
      const updatedBaseSelection = this.markBoundaryManual({
        ...activeSelection.activity,
        start: event.start.toISOString(),
        end: event.end ? event.end.toISOString() : null,
      });
      const updatedSelectionActivity = this.deps.applyActivityTypeConstraints(
        resourceChanged
          ? !isOwnerSlot && participantResourceId
            ? moveParticipantToResource(updatedBaseSelection, participantResourceId, targetResource)
            : addParticipantToActivity(updatedBaseSelection, targetResource, undefined, undefined, {
                retainPreviousOwner: false,
                ownerCategory: targetCategory,
              })
          : updatedBaseSelection,
      );
      this.deps.activitySelection.selectedActivityState.set({
        activity: updatedSelectionActivity,
        resource,
      });
    }
  }

  private markBoundaryManual(activity: Activity): Activity {
    const role = activity.serviceRole ?? null;
    const type = (activity.type ?? '').toString();
    const isBoundary = role === 'start' || role === 'end' || type === 'service-start' || type === 'service-end';
    if (!isBoundary) {
      return activity;
    }
    const attrs = { ...(activity.attributes ?? {}) } as Record<string, unknown>;
    attrs['manual_service_boundary'] = true;
    return { ...activity, attributes: attrs };
  }
}
