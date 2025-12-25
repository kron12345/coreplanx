import { Signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { ActivityLinkRoleDialogResult } from './activity-link-role-dialog.component';
import { addParticipantToActivity, moveParticipantToResource, resourceParticipantCategory } from './planning-dashboard-participant.utils';
import { applyActivityCopyWithRoles } from './planning-dashboard-activity-copy.utils';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningStageId } from './planning-stage.model';

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
    const sourceResourceId = event.sourceResourceId ?? event.targetResourceId;
    const resourceChanged = Boolean(targetResource && sourceResourceId && event.targetResourceId !== sourceResourceId);
    const previousActivityId = event.activity.id;
    const base: Activity = {
      ...event.activity,
      id: this.rewriteDayScopedId(event.activity.id, event.start),
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
    };
    const isOwnerSlot = event.isOwnerSlot ?? true;
    const participantResourceId = event.participantResourceId ?? event.sourceResourceId ?? null;
    const category = event.participantCategory ?? resourceParticipantCategory(targetResource);
    const updated = targetResource && resourceChanged
      ? !isOwnerSlot && participantResourceId
        ? moveParticipantToResource(base, participantResourceId, targetResource)
        : addParticipantToActivity(base, targetResource, undefined, undefined, {
            retainPreviousOwner: false,
            ownerCategory: category,
          })
      : base;
    const normalized = this.deps.applyActivityTypeConstraints(this.markBoundaryManual(updated));
    const baseId = previousActivityId.split('@')[0] ?? previousActivityId;
    this.deps.updateStageActivities('base', (activities) =>
      (normalized.id !== previousActivityId ? activities.filter((activity) => activity.id !== normalized.id) : activities).map(
        (activity) =>
          activity.id === previousActivityId
            ? {
                ...activity,
                id: normalized.id,
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
    if (this.shouldPersistToTemplate(event.activity)) {
      this.deps.saveTemplateActivity({ ...normalized, id: baseId });
    }
    const resource = targetResource ?? this.deps.activitySelection.selectedActivityState()?.resource ?? null;
    const currentSelection = this.deps.activitySelection.selectedActivityState();
    if (resource && currentSelection?.activity.id === previousActivityId) {
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

  private shouldPersistToTemplate(activity: Activity): boolean {
    const id = (activity.id ?? '').toString();
    if (id.startsWith('svcstart:') || id.startsWith('svcend:') || id.startsWith('svcbreak:')) {
      return false;
    }
    return true;
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

  private rewriteDayScopedId(activityId: string, start: Date): string {
    const match = activityId.match(/^(.+)@(\d{4}-\d{2}-\d{2})$/);
    if (!match) {
      return activityId;
    }
    const baseId = match[1];
    const currentDay = match[2];
    const nextDay = start.toISOString().slice(0, 10);
    if (!nextDay || nextDay === currentDay) {
      return activityId;
    }
    return `${baseId}@${nextDay}`;
  }
}
