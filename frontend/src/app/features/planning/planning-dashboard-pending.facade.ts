import { Signal } from '@angular/core';
import { Activity } from '../../models/activity';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivityFacade, PendingActivityState } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';

export class PlanningDashboardPendingFacade {
  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      activityFacade: PlanningDashboardActivityFacade;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      pendingActivitySignal: Signal<PendingActivityState | null> & {
        set: (val: PendingActivityState | null) => void;
      };
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
      setSelectedActivityState: (state: { activity: Activity; resource: Resource } | null) => void;
      setPendingActivity: (state: PendingActivityState | null) => void;
      setEditPreview: (state: { stage: PlanningStageId; activity: Activity } | null) => void;
      resourceParticipantCategory: (resource: Resource | null) => ActivityParticipantCategory;
      moveParticipantToResource: (activity: Activity, participantId: string, target: Resource) => Activity;
      addParticipantToActivity: (
        activity: Activity,
        owner: Resource,
        partner?: Resource | null,
        partnerRole?: any,
        opts?: any,
      ) => Activity;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
    },
  ) {}

  clearEditingPreview(): void {
    this.deps.setEditPreview(null);
  }

  isPendingSelection(activityId: string | null | undefined): boolean {
    return this.deps.activitySelection.isPendingSelection(
      activityId,
      this.deps.pendingActivitySignal(),
      this.deps.activeStage(),
    );
  }

  pendingActivityForStage(stage: PlanningStageId): Activity | null {
    return this.deps.activityFacade.pendingActivityForStage(stage, this.deps.pendingActivitySignal());
  }

  startPendingActivity(stage: PlanningStageId, resource: Resource, activity: Activity): void {
    this.deps.activityFacade.startPendingActivity(
      stage,
      resource,
      activity,
      (state) => this.deps.setSelectedActivityState(state),
      (state) => this.deps.setPendingActivity(state),
    );
    this.deps.activitySelection.selectedActivityIds.set(new Set());
    this.deps.activitySelection.selectedActivitySlot.set(null);
    this.clearEditingPreview();
  }

  commitPendingActivityUpdate(activity: Activity): void {
    const stage = this.deps.activeStage();
    this.deps.activityFacade.commitPendingActivityUpdate(
      stage,
      activity,
      this.deps.pendingActivitySignal(),
      this.deps.stageResourceSignals[stage](),
      (state) => this.deps.setSelectedActivityState(state),
      (state) => this.deps.setPendingActivity(state),
    );
  }

  updatePendingActivityPosition(event: {
    activity: Activity;
    targetResourceId: string;
    start: Date;
    end: Date | null;
    participantResourceId?: string | null;
    participantCategory?: ActivityParticipantCategory | null;
    sourceResourceId?: string | null;
    isOwnerSlot?: boolean;
  }): void {
    this.deps.activityFacade.updatePendingActivityPosition(
      event,
      this.deps.stageResourceSignals[this.deps.activeStage()](),
      (resource) => this.deps.resourceParticipantCategory(resource),
      (activity, participantId, target) => this.deps.moveParticipantToResource(activity, participantId, target),
      (activity, owner, partner, partnerRole, opts) =>
        this.deps.addParticipantToActivity(activity, owner, partner, partnerRole, opts),
      (activity) => this.deps.applyActivityTypeConstraints(activity),
      (activity) => this.commitPendingActivityUpdate(activity),
    );
  }
}
