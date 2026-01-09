import { Signal, WritableSignal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { addParticipantToActivity, resourceParticipantCategory } from './planning-dashboard-participant.utils';
import type { ActivityCatalogOption } from './planning-dashboard.types';
import { ActivityGroupRole } from '../../models/activity';
import { applyActivityGroup, readActivityGroupMeta } from './planning-activity-group.utils';

export class PlanningDashboardSelectionActionsFacade {
  constructor(
    private readonly deps: {
      activitySelection: PlanningDashboardActivitySelectionFacade;
      activityFacade: PlanningDashboardActivityFacade;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
      stageActivitySignals: Record<PlanningStageId, Signal<Activity[]>>;
      activeStage: () => PlanningStageId;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      isPendingSelection: (activityId: string | null | undefined) => boolean;
      commitPendingActivityUpdate: (activity: Activity) => void;
      replaceActivity: (activity: Activity) => void;
      findCatalogOptionByTypeId: (typeId: string | null | undefined) => ActivityCatalogOption | null;
      activityMoveTargetSignal: WritableSignal<string>;
      saveTemplateActivity: (activity: Activity) => void;
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

  shiftSelectionBy(deltaMinutes: number, normalizedActivities: { activity: Activity; resource: Resource }[]): void {
    if (!deltaMinutes) {
      return;
    }
    const selectionIds = this.deps.activitySelection.selectedActivityIds();
    if (selectionIds.size === 0) {
      return;
    }
    const stage = this.deps.activeStage();
    const deltaMs = deltaMinutes * 60_000;
    const updates = new Map<string, Activity>();
    normalizedActivities.forEach(({ activity }) => {
      const startMs = new Date(activity.start).getTime();
      if (!Number.isFinite(startMs)) {
        return;
      }
      const endIso = activity.end ?? null;
      const endMs = endIso ? new Date(endIso).getTime() : null;
      const next: Activity = {
        ...activity,
        start: new Date(startMs + deltaMs).toISOString(),
        end:
          endMs !== null && Number.isFinite(endMs)
            ? new Date(endMs + deltaMs).toISOString()
            : null,
      };
      updates.set(activity.id, this.deps.applyActivityTypeConstraints(next));
    });
    if (updates.size) {
      const movedIds = new Set(updates.keys());
      this.deps.stageActivitySignals[stage]().forEach((activity) => {
        if (updates.has(activity.id)) {
          return;
        }
        const meta = readActivityGroupMeta(activity);
        const attachedTo = (meta?.attachedToActivityId ?? '').toString().trim();
        if (!attachedTo || !movedIds.has(attachedTo) || selectionIds.has(activity.id)) {
          return;
        }
        const startMs = new Date(activity.start).getTime();
        if (!Number.isFinite(startMs)) {
          return;
        }
        const endIso = activity.end ?? null;
        const endMs = endIso ? new Date(endIso).getTime() : null;
        updates.set(
          activity.id,
          this.deps.applyActivityTypeConstraints({
            ...activity,
            start: new Date(startMs + deltaMs).toISOString(),
            end: endMs !== null && Number.isFinite(endMs) ? new Date(endMs + deltaMs).toISOString() : null,
          }),
        );
      });
    }
    if (updates.size === 0) {
      return;
    }
    this.deps.updateStageActivities(stage, (activities) =>
      activities.map((activity) => updates.get(activity.id) ?? activity),
    );

    const activeSelection = this.deps.activitySelection.selectedActivityState();
    if (activeSelection) {
      const updated = updates.get(activeSelection.activity.id);
      if (updated) {
        this.deps.activitySelection.selectedActivityState.set({
          activity: updated,
          resource: activeSelection.resource,
        });
      }
    }
  }

  deleteSelection(): void {
    const selectionIds = this.deps.activitySelection.selectedActivityIds();
    if (selectionIds.size === 0) {
      return;
    }
    const stage = this.deps.activeStage();
    const ids = new Set(selectionIds);
    this.deps.updateStageActivities(stage, (activities) => activities.filter((activity) => !ids.has(activity.id)));
    this.deps.activitySelection.clearSelection();
    this.resetMoveTarget();
  }

  shiftSelectedActivityBy(deltaMinutes: number, normalizedActivities: { activity: Activity; resource: Resource }[]): void {
    this.deps.activityFacade.shiftSelectedActivityBy(
      deltaMinutes,
      normalizedActivities,
      this.deps.activitySelection.selectedActivityState(),
      (typeId) => this.deps.findCatalogOptionByTypeId(typeId),
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
    findType: (typeId: string | null | undefined) => ActivityCatalogOption | null,
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
    findType: (typeId: string | null | undefined) => ActivityCatalogOption | null,
  ): void {
    this.deps.activityFacade.fillGapForSelectedActivity(
      this.deps.activitySelection.selectedActivityState(),
      activityForm as any,
      findNeighbors,
      findType,
    );
  }

  createGroupFromSelection(options: {
    label: string;
    role: ActivityGroupRole;
    attachedToActivityId?: string | null;
  }): void {
    const selectionIds = this.deps.activitySelection.selectedActivityIds();
    if (selectionIds.size === 0) {
      return;
    }
    const stage = this.deps.activeStage();
    const groupId = this.generateGroupId();
    const stageActivities = this.deps.stageActivitySignals[stage]();
    const selection = stageActivities.filter((activity) => selectionIds.has(activity.id));
    const orderById = buildGroupOrder(selection);
    const updated = new Map<string, Activity>();
    stageActivities.forEach((activity) => {
      if (!selectionIds.has(activity.id)) {
        return;
      }
      const next = this.deps.applyActivityTypeConstraints(
        applyActivityGroup(activity, {
          id: groupId,
          order: orderById.get(activity.id) ?? null,
          label: options.label,
          role: options.role,
          attachedToActivityId: options.attachedToActivityId ?? null,
        }),
      );
      updated.set(activity.id, next);
    });
    if (!updated.size) {
      return;
    }
    this.deps.updateStageActivities(stage, (activities) =>
      activities.map((activity) => updated.get(activity.id) ?? activity),
    );
    if (stage === 'base') {
      updated.forEach((activity) => this.deps.saveTemplateActivity(activity));
    }
  }

  updateGroupMeta(groupId: string, meta: { label: string; role: ActivityGroupRole; attachedToActivityId?: string | null }): void {
    const trimmed = (groupId ?? '').toString().trim();
    if (!trimmed) {
      return;
    }
    const stage = this.deps.activeStage();
    const stageActivities = this.deps.stageActivitySignals[stage]();
    const updated = new Map<string, Activity>();
    stageActivities.forEach((activity) => {
      if (activity.groupId !== trimmed) {
        return;
      }
      const next = this.deps.applyActivityTypeConstraints(
        applyActivityGroup(activity, {
          id: trimmed,
          order: activity.groupOrder ?? null,
          label: meta.label,
          role: meta.role,
          attachedToActivityId: meta.attachedToActivityId ?? null,
        }),
      );
      updated.set(activity.id, next);
    });
    if (!updated.size) {
      return;
    }
    this.deps.updateStageActivities(stage, (activities) =>
      activities.map((activity) => updated.get(activity.id) ?? activity),
    );
    if (stage === 'base') {
      updated.forEach((activity) => this.deps.saveTemplateActivity(activity));
    }
  }

  addSelectionToFocusedGroup(): void {
    const focus = this.deps.activitySelection.selectedActivityState()?.activity ?? null;
    const focusGroupId = focus?.groupId ?? null;
    if (!focusGroupId) {
      return;
    }
    const groupMeta = focus ? readActivityGroupMeta(focus) : null;
    if (!groupMeta) {
      return;
    }
    const selectionIds = this.deps.activitySelection.selectedActivityIds();
    if (selectionIds.size === 0) {
      return;
    }
    const stage = this.deps.activeStage();
    const stageActivities = this.deps.stageActivitySignals[stage]();
    const members = stageActivities.filter((activity) => activity.groupId === focusGroupId);
    const maxOrder = members.reduce((max, activity) => Math.max(max, activity.groupOrder ?? 0), 0);
    const selection = stageActivities.filter(
      (activity) => selectionIds.has(activity.id) && activity.groupId !== focusGroupId,
    );
    if (!selection.length) {
      return;
    }
    const orderById = buildGroupOrder(selection);
    const updated = new Map<string, Activity>();
    stageActivities.forEach((activity) => {
      if (!selectionIds.has(activity.id) || activity.groupId === focusGroupId) {
        return;
      }
      const nextOrder = maxOrder + (orderById.get(activity.id) ?? 0);
      const next = this.deps.applyActivityTypeConstraints(
        applyActivityGroup(activity, {
          ...groupMeta,
          order: Number.isFinite(nextOrder) && nextOrder > 0 ? nextOrder : null,
        }),
      );
      updated.set(activity.id, next);
    });
    if (!updated.size) {
      return;
    }
    this.deps.updateStageActivities(stage, (activities) =>
      activities.map((activity) => updated.get(activity.id) ?? activity),
    );
    if (stage === 'base') {
      updated.forEach((activity) => this.deps.saveTemplateActivity(activity));
    }
  }

  removeSelectionFromGroup(): void {
    const selectionIds = this.deps.activitySelection.selectedActivityIds();
    if (selectionIds.size === 0) {
      return;
    }
    const stage = this.deps.activeStage();
    const stageActivities = this.deps.stageActivitySignals[stage]();
    const updated = new Map<string, Activity>();
    stageActivities.forEach((activity) => {
      if (!selectionIds.has(activity.id) || !activity.groupId) {
        return;
      }
      const next = this.deps.applyActivityTypeConstraints(applyActivityGroup(activity, null));
      updated.set(activity.id, next);
    });
    if (!updated.size) {
      return;
    }
    this.deps.updateStageActivities(stage, (activities) =>
      activities.map((activity) => updated.get(activity.id) ?? activity),
    );
    if (stage === 'base') {
      updated.forEach((activity) => this.deps.saveTemplateActivity(activity));
    }
  }

  private generateGroupId(): string {
    return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function buildGroupOrder(activities: Activity[]): Map<string, number> {
  const sorted = [...activities].sort((a, b) => {
    const aMs = new Date(a.start).getTime();
    const bMs = new Date(b.start).getTime();
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) {
      return aMs - bMs;
    }
    return a.id.localeCompare(b.id);
  });
  const map = new Map<string, number>();
  sorted.forEach((activity, index) => {
    map.set(activity.id, index + 1);
  });
  return map;
}
