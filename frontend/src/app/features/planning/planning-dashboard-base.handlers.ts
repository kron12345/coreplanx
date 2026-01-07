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
      applyLocationDefaults: (activity: Activity, activities: Activity[]) => Activity;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      saveTemplateActivity: (activity: Activity) => void;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      templateId: () => string | null;
      ensureRequiredParticipants?: (
        stage: PlanningStageId,
        anchorResource: Resource,
        activity: Activity,
      ) => Promise<Activity | null>;
      onActivityMutated?: (activity: Activity, stage: PlanningStageId) => void;
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
    void this.handleRepositionAsync(event);
  }

  private async handleRepositionAsync(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    participantResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    sourceResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): Promise<void> {
    const stage: PlanningStageId = 'base';
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
      id: this.shiftDayScopedId(event.activity.id, shiftDeltaMs),
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
    const anchorResource = targetResource ?? this.deps.activitySelection.selectedActivityState()?.resource ?? null;
    const shouldEnsure = !!this.deps.ensureRequiredParticipants && !!anchorResource;
    const ensured = shouldEnsure
      ? await this.deps.ensureRequiredParticipants!(stage, anchorResource!, normalized)
      : normalized;
    if (!ensured) {
      return;
    }
    let ensuredWithDefaults = ensured;
    const nextMainId = ensured.id;
    let shiftedAttachments: Array<{ originalId: string; activity: Activity }> = [];
    this.deps.updateStageActivities('base', (activities) => {
      ensuredWithDefaults = this.deps.applyLocationDefaults(
        ensuredWithDefaults,
        activities.filter((entry) => entry.id !== previousActivityId),
      );
      const result = this.applyGroupAttachmentShift({
        activities,
        previousActivityId,
        nextMainId,
        normalizedMain: ensuredWithDefaults,
        shiftDeltaMs,
      });
      shiftedAttachments = result.shiftedAttachments;
      return result.activities;
    });
    if (this.shouldPersistToTemplate(event.activity)) {
      this.deps.saveTemplateActivity(ensuredWithDefaults);
      shiftedAttachments.forEach(({ activity }) => {
        if (!this.shouldPersistToTemplate(activity)) {
          return;
        }
        this.deps.saveTemplateActivity(activity);
      });
    }
    const resource = targetResource ?? this.deps.activitySelection.selectedActivityState()?.resource ?? null;
    const currentSelection = this.deps.activitySelection.selectedActivityState();
    if (resource && currentSelection?.activity.id === previousActivityId) {
      this.deps.activitySelection.selectedActivityState.set({ activity: ensuredWithDefaults, resource });
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
    this.deps.onActivityMutated?.(ensuredWithDefaults, stage);
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
    const normalized = this.deps.applyActivityTypeConstraints(updated);
    this.deps.saveTemplateActivity(normalized);
    this.deps.onActivityMutated?.(normalized, 'base');
  }

  private shouldPersistToTemplate(activity: Activity): boolean {
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

  private shiftDayScopedId(activityId: string, shiftDeltaMs: number): string {
    const match = activityId.match(/^(.+)@(\d{4}-\d{2}-\d{2})$/);
    if (!match) {
      return activityId;
    }
    const baseId = match[1];
    const currentDay = match[2];
    if (!Number.isFinite(shiftDeltaMs) || shiftDeltaMs === 0) {
      return activityId;
    }
    const deltaDays = Math.round(shiftDeltaMs / (24 * 3600_000));
    if (!deltaDays) {
      return activityId;
    }
    const currentDate = new Date(`${currentDay}T00:00:00.000Z`);
    if (!Number.isFinite(currentDate.getTime())) {
      return activityId;
    }
    currentDate.setUTCDate(currentDate.getUTCDate() + deltaDays);
    const nextDay = currentDate.toISOString().slice(0, 10);
    if (!nextDay) {
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
        const merged = { ...activity, ...normalizedMain, id: normalizedMain.id };
        // Preserve rowVersion so the backend update does not trigger optimistic-lock conflicts.
        if (!merged.rowVersion && activity.rowVersion) {
          merged.rowVersion = activity.rowVersion;
        }
        return merged;
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
        id: this.shiftDayScopedId(activity.id, shiftDeltaMs),
        start: new Date(nextStartMs).toISOString(),
        end: nextEndMs !== null ? new Date(nextEndMs).toISOString() : null,
        attributes: nextAttributes,
        rowVersion: activity.rowVersion ?? null,
      });
      shifted.push({ originalId: activity.id, activity: updated });
    }
    return shifted;
  }
}
