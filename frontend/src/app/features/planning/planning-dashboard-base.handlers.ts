import { Signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { ActivityLinkRoleDialogResult } from './activity-link-role-dialog.component';
import { addParticipantToActivity, resourceParticipantCategory } from './planning-dashboard-participant.utils';
import { applyActivityCopyWithRoles } from './planning-dashboard-activity-copy.utils';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningStageId } from './planning-stage.model';
import { moveParticipantToResource } from './planning-dashboard-participant.utils';

export class PlanningDashboardBaseHandlers {
  constructor(
    private readonly deps: {
      stageResourceSignal: Signal<Resource[]>;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      saveTemplateActivity: (activity: Activity) => void;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      templateId: () => string | null;
    },
  ) {}

  handleReposition(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    participantResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    sourceResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    const resources = this.deps.stageResourceSignal();
    const targetResource = resources.find((res) => res.id === event.targetResourceId) ?? null;
    const base: Activity = {
      ...event.activity,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
    };
    const isOwnerSlot = event.isOwnerSlot ?? true;
    const participantResourceId = event.participantResourceId ?? event.sourceResourceId ?? null;
    const category = event.participantCategory ?? resourceParticipantCategory(targetResource);
    const updated = targetResource
      ? !isOwnerSlot && participantResourceId
        ? moveParticipantToResource(base, participantResourceId, targetResource)
        : addParticipantToActivity(base, targetResource, undefined, undefined, {
            retainPreviousOwner: false,
            ownerCategory: category,
          })
      : base;
    const normalized = this.deps.applyActivityTypeConstraints(updated);
    const baseId = event.activity.id.split('@')[0] ?? event.activity.id;
    this.deps.updateStageActivities('base', (activities) =>
      activities.map((activity) =>
        activity.id === event.activity.id
          ? {
              ...activity,
              start: normalized.start,
              end: normalized.end,
              participants: normalized.participants,
              attributes: normalized.attributes,
              type: normalized.type,
              title: normalized.title,
              from: normalized.from,
              to: normalized.to,
              remark: normalized.remark,
            }
          : activity,
      ),
    );
    this.deps.saveTemplateActivity({ ...normalized, id: baseId });
    const resource = targetResource ?? this.deps.activitySelection.selectedActivityState()?.resource ?? null;
    const currentSelection = this.deps.activitySelection.selectedActivityState();
    if (resource && currentSelection?.activity.id === event.activity.id) {
      this.deps.activitySelection.selectedActivityState.set({ activity: normalized, resource });
    }
  }

  applyCopyWithRoles(
    source: Activity,
    sourceResource: Resource,
    targetResource: Resource,
    roles: ActivityLinkRoleDialogResult,
  ): void {
    const templateId = this.deps.templateId();
    if (!templateId) {
      return;
    }
    const updated = applyActivityCopyWithRoles(
      source,
      sourceResource,
      targetResource,
      roles,
      (act, owner, partner, partnerRole, opts) =>
        addParticipantToActivity(act, owner, partner, partnerRole, opts),
    );
    this.deps.saveTemplateActivity(this.deps.applyActivityTypeConstraints(updated));
  }
}
