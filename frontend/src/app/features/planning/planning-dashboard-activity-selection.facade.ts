import { Signal, WritableSignal, signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityParticipantCategory, getActivityParticipantIds } from '../../models/activity-ownership';

export class PlanningDashboardActivitySelectionFacade {
  readonly selectedActivityIds: WritableSignal<Set<string>> = signal(new Set<string>());
  readonly selectedActivityState: WritableSignal<{ activity: Activity; resource: Resource } | null> =
    signal<{ activity: Activity; resource: Resource } | null>(null);
  readonly selectedActivitySlot: WritableSignal<{ activityId: string; resourceId: string } | null> =
    signal<{ activityId: string; resourceId: string } | null>(null);

  clearSelection(): void {
    this.selectedActivityIds.set(new Set());
    this.selectedActivityState.set(null);
    this.selectedActivitySlot.set(null);
  }

  toggleSelection(event: {
    resource: Resource;
    activity: Activity;
    selectionMode: 'set' | 'toggle';
  }): void {
    if (event.selectionMode === 'set') {
      const current = this.selectedActivityIds();
      if (current.size === 1 && current.has(event.activity.id)) {
        this.selectedActivityIds.set(new Set());
        this.selectedActivitySlot.set(null);
      } else {
        this.selectedActivityIds.set(new Set([event.activity.id]));
        this.selectedActivitySlot.set({ activityId: event.activity.id, resourceId: event.resource.id });
      }
      return;
    }
    const next = new Set(this.selectedActivityIds());
    if (next.has(event.activity.id)) {
      next.delete(event.activity.id);
    } else {
      next.add(event.activity.id);
    }
    this.selectedActivityIds.set(next);
    this.selectedActivitySlot.set({ activityId: event.activity.id, resourceId: event.resource.id });
  }

  setSelection(activity: Activity, resource: Resource, slot: { activityId: string; resourceId: string }): void {
    this.selectedActivityState.set({ activity, resource });
    this.selectedActivitySlot.set(slot);
  }

  isPendingSelection(activityId: string | null | undefined, pending: { stage: string; activity: Activity } | null, activeStage: string): boolean {
    if (!activityId || !pending) {
      return false;
    }
    return pending.stage === activeStage && pending.activity.id === activityId;
  }

  computeSelectedActivities(
    selectedIds: Signal<Set<string>>,
    activities: Signal<Activity[]>,
    resources: Signal<Resource[]>,
  ): { activity: Activity; resource: Resource }[] {
    const selection = selectedIds();
    if (selection.size === 0) {
      return [];
    }
    const activityMap = new Map(activities().map((activity) => [activity.id, activity]));
    const resourceMap = new Map(resources().map((resource) => [resource.id, resource]));
    const result: { activity: Activity; resource: Resource }[] = [];
    selection.forEach((id) => {
      const activity = activityMap.get(id);
      if (!activity) {
        return;
      }
      const ownerId = this.activityOwnerId(activity);
      if (!ownerId) {
        return;
      }
      const resource = resourceMap.get(ownerId);
      if (!resource) {
        return;
      }
      result.push({ activity, resource });
    });
    return result;
  }

  selectedActivityParticipantIds(selection: { activity: Activity; resource: Resource } | null): string[] {
    if (!selection) {
      return [];
    }
    const category = this.resourceParticipantCategory(selection.resource);
    return getActivityParticipantIds(selection.activity, category === 'other');
  }

  private activityOwnerId(activity: Activity): string | null {
    const participants = activity.participants ?? [];
    const owner =
      participants.find((p) => p.role === 'primary-vehicle' || p.role === 'primary-personnel') ??
      participants[0] ??
      null;
    return owner?.resourceId ?? null;
  }

  private resourceParticipantCategory(resource: Resource | null): ActivityParticipantCategory {
    if (!resource) {
      return 'other';
    }
    if (resource.kind === 'vehicle' || resource.kind === 'vehicle-service') {
      return 'vehicle';
    }
    if (resource.kind === 'personnel' || resource.kind === 'personnel-service') {
      return 'personnel';
    }
    return 'other';
  }
}
