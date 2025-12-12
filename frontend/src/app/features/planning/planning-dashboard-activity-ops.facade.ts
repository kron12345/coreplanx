import { Signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDataService } from './planning-data.service';
import { PlanningDashboardPendingFacade } from './planning-dashboard-pending.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';

type UpdateActivitiesFn = (activities: Activity[]) => Activity[];

export class PlanningDashboardActivityOpsFacade {
  constructor(
    private readonly deps: {
      data: PlanningDataService;
      activeStage: () => PlanningStageId;
      normalizeActivityList: (list: Activity[]) => Activity[];
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      pendingFacade: PlanningDashboardPendingFacade;
      activityOwnerId: (activity: Activity) => string | null;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
    },
  ) {}

  updateStageActivities(stage: PlanningStageId, updater: UpdateActivitiesFn): void {
    this.deps.data.updateStageData(stage, (stageData) => {
      const next = updater([...stageData.activities]);
      return {
        ...stageData,
        activities: this.deps.normalizeActivityList(next),
      };
    });
  }

  replaceActivity(updated: Activity): void {
    const stage = this.deps.activeStage();
    this.updateStageActivities(stage, (activities) => {
      const attrs = (updated.attributes ?? {}) as Record<string, unknown>;
      const linkGroupId = typeof attrs['linkGroupId'] === 'string' ? (attrs['linkGroupId'] as string) : null;
      if (!linkGroupId) {
        return activities.map((activity) => (activity.id === updated.id ? updated : activity));
      }
      return activities.map((activity) => {
        const currentAttrs = (activity.attributes ?? {}) as Record<string, unknown>;
        const currentGroupId =
          typeof currentAttrs['linkGroupId'] === 'string' ? (currentAttrs['linkGroupId'] as string) : null;
        if (!currentGroupId || currentGroupId !== linkGroupId) {
          return activity.id === updated.id ? updated : activity;
        }
        const next: Activity = {
          ...activity,
          title: updated.title,
          start: updated.start,
          end: updated.end,
          type: updated.type,
          from: updated.from,
          to: updated.to,
          remark: updated.remark,
          attributes: {
            ...(updated.attributes ?? {}),
            ...(activity.attributes ?? {}),
            linkGroupId,
          },
        };
        return next;
      });
    });
    const ownerId = this.deps.activityOwnerId(updated);
    const resource =
      (ownerId
        ? this.deps.stageResourceSignals[stage]().find((entry) => entry.id === ownerId)
        : null) ?? this.deps.activitySelection.selectedActivityState()?.resource ?? null;
    if (resource) {
      this.deps.activitySelection.selectedActivityState.set({
        activity: this.deps.applyActivityTypeConstraints(updated),
        resource,
      });
    } else {
      this.deps.activitySelection.selectedActivityState.set(null);
    }
    this.deps.pendingFacade.clearEditingPreview();
  }

  generateActivityId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
