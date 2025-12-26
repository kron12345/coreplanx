import { Signal, WritableSignal } from '@angular/core';
import { Activity, ServiceRole } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardPendingFacade } from './planning-dashboard-pending.facade';
import { PlanningDashboardSelectionActionsFacade } from './planning-dashboard-selection-actions.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningDashboardBaseHandlers } from './planning-dashboard-base.handlers';
import { PlanningDashboardOperationsHandlers } from './planning-dashboard-operations.handlers';
import { PlanningDashboardActivityHandlersFacade } from './planning-dashboard-activity.handlers.facade';
import { PlanningDashboardCopyHandlers } from './planning-dashboard-copy.handlers';
import { ActivityGroupRole } from '../../models/activity';

type NeighborFinder = (activity: Activity) => { previous: Activity | null; next: Activity | null };

export class PlanningDashboardSelectionHandlers {
  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      pendingFacade: PlanningDashboardPendingFacade;
      selectionActions: PlanningDashboardSelectionActionsFacade;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      pendingActivitySignal: { (): any; set: (val: any) => void };
      pendingActivityOriginal: { (): Activity | null; set: (val: Activity | null) => void };
      baseHandlers: PlanningDashboardBaseHandlers;
      operationsHandlers: PlanningDashboardOperationsHandlers;
      copyHandlers: PlanningDashboardCopyHandlers;
      activityHandlers: PlanningDashboardActivityHandlersFacade;
      findActivityType: (id: string | null | undefined) => ActivityTypeDefinition | null;
      activityForm: { patchValue: (val: any) => void };
      selectedActivities: Signal<{ activity: Activity; resource: Resource }[]>;
      activityMoveTargetSignal: WritableSignal<string>;
    },
  ) {}

  toggleSelection(event: { resource: Resource; activity: Activity; selectionMode: 'set' | 'toggle' }): void {
    this.deps.activitySelection.toggleSelection(event);
  }

  clearActivitySelection(): void {
    this.deps.activitySelection.clearSelection();
    this.deps.activityMoveTargetSignal.set('');
  }

  clearSelectedActivity(): void {
    const selection = this.deps.activitySelection.selectedActivityState();
    if (selection && this.deps.pendingFacade.isPendingSelection(selection.activity.id)) {
      this.deps.pendingActivitySignal.set(null);
      this.deps.pendingActivityOriginal.set(null);
    }
    this.deps.activitySelection.selectedActivityState.set(null);
    this.deps.pendingFacade.clearEditingPreview();
  }

  saveSelectedActivityEdits(): void {
    this.deps.activityHandlers.saveSelectedActivityEdits();
  }

  deleteSelectedActivity(): void {
    this.deps.activityHandlers.deleteSelectedActivity();
  }

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
    if (this.deps.pendingFacade.isPendingSelection(event.activity.id)) {
      this.deps.pendingFacade.updatePendingActivityPosition(event);
      return;
    }
    const stage = this.deps.activeStage();
    if (stage === 'base') {
      this.deps.baseHandlers.handleReposition(event);
      return;
    }
    this.deps.operationsHandlers.handleReposition(event);
  }

  handleCopy(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    sourceResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    participantResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    this.deps.copyHandlers.handleActivityCopy(event);
  }

  shiftSelectedActivityBy(deltaMinutes: number): void {
    this.deps.selectionActions.shiftSelectedActivityBy(deltaMinutes, this.deps.selectedActivities());
  }

  setMoveSelectionTarget(resourceId: string | null): void {
    this.deps.selectionActions.setMoveSelectionTarget(resourceId);
  }

  moveSelectionToTarget(): void {
    this.deps.selectionActions.moveSelectionToTarget();
  }

  shiftSelectionBy(deltaMinutes: number): void {
    this.deps.selectionActions.shiftSelectionBy(deltaMinutes, this.deps.selectedActivities());
  }

  deleteSelection(): void {
    this.deps.selectionActions.deleteSelection();
  }

  snapSelectedActivity(direction: 'previous' | 'next', neighborFinder: NeighborFinder): void {
    this.deps.selectionActions.snapSelectedActivity(
      direction,
      neighborFinder,
      this.deps.activityForm,
      this.deps.findActivityType,
    );
  }

  fillGapForSelectedActivity(neighborFinder: NeighborFinder): void {
    this.deps.selectionActions.fillGapForSelectedActivity(neighborFinder, this.deps.activityForm, this.deps.findActivityType);
  }

  createGroupFromSelection(options: { label: string; role: ActivityGroupRole; attachedToActivityId?: string | null }): void {
    this.deps.selectionActions.createGroupFromSelection(options);
  }

  updateGroupMeta(groupId: string, meta: { label: string; role: ActivityGroupRole; attachedToActivityId?: string | null }): void {
    this.deps.selectionActions.updateGroupMeta(groupId, meta);
  }

  addSelectionToFocusedGroup(): void {
    this.deps.selectionActions.addSelectionToFocusedGroup();
  }

  removeSelectionFromGroup(): void {
    this.deps.selectionActions.removeSelectionFromGroup();
  }
}
