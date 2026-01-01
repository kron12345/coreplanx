import { Signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { addParticipantToActivity, moveParticipantToResource, resourceParticipantCategory } from './planning-dashboard-participant.utils';
import { readActivityGroupMetaFromAttributes } from './planning-activity-group.utils';

export class PlanningDashboardOperationsHandlers {
  constructor(
    private readonly deps: {
      stageResourceSignal: Signal<Resource[]>;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      applyLocationDefaults: (activity: Activity, activities: Activity[]) => Activity;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      activityOwnerId: (activity: Activity) => string | null;
      ensureRequiredParticipants?: (
        stage: PlanningStageId,
        anchorResource: Resource,
        activity: Activity,
      ) => Promise<Activity | null>;
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
    void this.handleRepositionAsync(event);
  }

  private async handleRepositionAsync(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    sourceResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    participantResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): Promise<void> {
    const stage: PlanningStageId = 'operations';
    const previousActivityId = event.activity.id;
    const previousStartMs = new Date(event.activity.start).getTime();
    const nextStartMs = event.start.getTime();
    const shiftDeltaMs = Number.isFinite(previousStartMs) ? nextStartMs - previousStartMs : 0;
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
    const updatedMain = applyUpdate(event.activity);
    const anchorResource = targetResource ?? this.deps.activitySelection.selectedActivityState()?.resource ?? null;
    const shouldEnsure = !!this.deps.ensureRequiredParticipants && !!anchorResource;
    const ensuredMain = shouldEnsure
      ? await this.deps.ensureRequiredParticipants!(stage, anchorResource!, updatedMain)
      : updatedMain;
    if (!ensuredMain) {
      return;
    }
    let ensuredWithDefaults = ensuredMain;
    let shiftedAttachments = new Map<string, Activity>();
    this.deps.updateStageActivities(stage, (activities) => {
      ensuredWithDefaults = this.deps.applyLocationDefaults(ensuredWithDefaults, activities);
      shiftedAttachments = shiftDeltaMs
        ? this.shiftedGroupAttachmentMap(activities, previousActivityId, shiftDeltaMs)
        : new Map<string, Activity>();
      if (!linkGroupId) {
        return activities.map((activity) => {
          if (activity.id !== event.activity.id) {
            return shiftedAttachments.get(activity.id) ?? activity;
          }
          return ensuredWithDefaults;
        });
      }
      return activities.map((activity) => {
        const currentAttrs = (activity.attributes ?? {}) as Record<string, unknown>;
        const currentGroupId =
          typeof currentAttrs['linkGroupId'] === 'string'
            ? (currentAttrs['linkGroupId'] as string)
            : null;
        if (activity.id === event.activity.id) {
          return ensuredWithDefaults;
        }
        const shifted = shiftedAttachments.get(activity.id);
        if (shifted) {
          return shifted;
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
      const updatedSelectionActivity = this.deps.applyActivityTypeConstraints(ensuredWithDefaults);
      this.deps.activitySelection.selectedActivityState.set({
        activity: updatedSelectionActivity,
        resource,
      });
      return;
    }
    if (activeSelection) {
      const shifted = shiftedAttachments.get(activeSelection.activity.id) ?? null;
      if (shifted) {
        this.deps.activitySelection.selectedActivityState.set({
          activity: shifted,
          resource: activeSelection.resource,
        });
      }
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

  private shiftedGroupAttachmentMap(
    activities: Activity[],
    previousActivityId: string,
    shiftDeltaMs: number,
  ): Map<string, Activity> {
    const shifted = new Map<string, Activity>();
    for (const activity of activities) {
      if (activity.id === previousActivityId) {
        continue;
      }
      const meta = readActivityGroupMetaFromAttributes(activity.attributes ?? undefined);
      const attachedTo = (meta?.attachedToActivityId ?? '').toString().trim();
      if (!attachedTo || attachedTo !== previousActivityId) {
        continue;
      }
      const startMs = new Date(activity.start).getTime();
      if (!Number.isFinite(startMs)) {
        continue;
      }
      const endIso = activity.end ?? null;
      const endMs = endIso ? new Date(endIso).getTime() : null;
      const nextStartMs = startMs + shiftDeltaMs;
      const nextEndMs = endMs !== null && Number.isFinite(endMs) ? endMs + shiftDeltaMs : null;
      shifted.set(
        activity.id,
        this.deps.applyActivityTypeConstraints({
          ...activity,
          start: new Date(nextStartMs).toISOString(),
          end: nextEndMs !== null ? new Date(nextEndMs).toISOString() : null,
        }),
      );
    }
    return shifted;
  }
}
