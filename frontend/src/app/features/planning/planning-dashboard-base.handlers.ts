import { Signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { ActivityLinkRoleDialogResult } from './activity-link-role-dialog.component';
import { addParticipantToActivity, moveParticipantToResource, resourceParticipantCategory } from './planning-dashboard-participant.utils';
import { applyActivityCopyWithRoles } from './planning-dashboard-activity-copy.utils';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningStageId } from './planning-stage.model';
import { readActivityGroupMetaFromAttributes, writeActivityGroupMetaToAttributes } from './planning-activity-group.utils';

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
    const previousStartMs = new Date(event.activity.start).getTime();
    const nextStartMs = event.start.getTime();
    const shiftDeltaMs = Number.isFinite(previousStartMs) ? nextStartMs - previousStartMs : 0;
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
    const nextMainId = normalized.id;
    let shiftedAttachments: Array<{ originalId: string; activity: Activity }> = [];
    this.deps.updateStageActivities('base', (activities) => {
      const result = this.applyGroupAttachmentShift({
        activities,
        previousActivityId,
        nextMainId,
        normalizedMain: normalized,
        shiftDeltaMs,
      });
      shiftedAttachments = result.shiftedAttachments;
      return result.activities;
    });
    if (this.shouldPersistToTemplate(event.activity)) {
      this.deps.saveTemplateActivity({ ...normalized, id: baseId });
      shiftedAttachments.forEach(({ activity }) => {
        if (!this.shouldPersistToTemplate(activity)) {
          return;
        }
        const id = activity.id.split('@')[0] ?? activity.id;
        this.deps.saveTemplateActivity({ ...activity, id });
      });
    }
    const resource = targetResource ?? this.deps.activitySelection.selectedActivityState()?.resource ?? null;
    const currentSelection = this.deps.activitySelection.selectedActivityState();
    if (resource && currentSelection?.activity.id === previousActivityId) {
      this.deps.activitySelection.selectedActivityState.set({ activity: normalized, resource });
    }
    if (currentSelection && currentSelection.activity.id !== previousActivityId) {
      const shifted = shiftedAttachments.find((entry) => entry.originalId === currentSelection.activity.id) ?? null;
      if (shifted) {
        this.deps.activitySelection.selectedActivityState.set({
          activity: shifted.activity,
          resource: currentSelection.resource,
        });
      }
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

  private applyGroupAttachmentShift(options: {
    activities: Activity[];
    previousActivityId: string;
    nextMainId: string;
    normalizedMain: Activity;
    shiftDeltaMs: number;
  }): { activities: Activity[]; shiftedAttachments: Array<{ originalId: string; activity: Activity }> } {
    const { activities, previousActivityId, nextMainId, normalizedMain, shiftDeltaMs } = options;

    const attachments = shiftDeltaMs
      ? this.shiftedGroupAttachmentActivitiesFromList(activities, previousActivityId, nextMainId, shiftDeltaMs)
      : [];

    const idsToRemove = new Set<string>();
    if (normalizedMain.id !== previousActivityId) {
      idsToRemove.add(normalizedMain.id);
    }
    attachments.forEach((entry) => {
      if (entry.activity.id !== entry.originalId) {
        idsToRemove.add(entry.activity.id);
      }
    });

    const filtered = idsToRemove.size ? activities.filter((activity) => !idsToRemove.has(activity.id)) : activities;

    const attachmentMap = new Map(attachments.map((entry) => [entry.originalId, entry.activity]));

    const nextActivities = filtered.map((activity) => {
      if (activity.id === previousActivityId) {
        return {
          ...activity,
          id: normalizedMain.id,
          start: normalizedMain.start,
          end: normalizedMain.end,
          participants: normalizedMain.participants,
          attributes: normalizedMain.attributes,
          type: normalizedMain.type,
          title: normalizedMain.title,
          from: normalizedMain.from,
          to: normalizedMain.to,
          remark: normalizedMain.remark,
        };
      }
      const shifted = attachmentMap.get(activity.id);
      return shifted ?? activity;
    });
    return { activities: nextActivities, shiftedAttachments: attachments };
  }

  private shiftedGroupAttachmentActivitiesFromList(
    activities: Activity[],
    previousActivityId: string,
    nextMainId: string,
    shiftDeltaMs: number,
  ): Array<{ originalId: string; activity: Activity }> {
    const shifted: Array<{ originalId: string; activity: Activity }> = [];
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
      const updatedMeta = {
        ...(meta ?? { id: (activity.groupId ?? '').toString().trim() || 'grp' }),
        attachedToActivityId: nextMainId,
      };
      const nextAttributes = writeActivityGroupMetaToAttributes(activity.attributes ?? undefined, updatedMeta);
      const updated: Activity = this.deps.applyActivityTypeConstraints({
        ...activity,
        id: this.rewriteDayScopedId(activity.id, new Date(nextStartMs)),
        start: new Date(nextStartMs).toISOString(),
        end: nextEndMs !== null ? new Date(nextEndMs).toISOString() : null,
        attributes: nextAttributes,
      });
      shifted.push({ originalId: activity.id, activity: updated });
    }
    return shifted;
  }
}
