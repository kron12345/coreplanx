import { MatDialog } from '@angular/material/dialog';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityLinkRoleDialogComponent, ActivityLinkRoleDialogResult } from './activity-link-role-dialog.component';
import { PlanningStageId } from './planning-stage.model';
import { applyActivityCopyWithRoles } from './planning-dashboard-activity-copy.utils';
import { addParticipantToActivity } from './planning-dashboard-participant.utils';

type CopyEvent = {
  activity: Activity;
  targetResourceId: string;
  start: Date;
  end: Date | null;
};

export class PlanningDashboardCopyHandlers {
  constructor(
    private readonly deps: {
      dialog: MatDialog;
      activeStage: () => PlanningStageId;
      activityOwnerId: (activity: Activity) => string | null;
      stageResourceSignals: Record<PlanningStageId, () => Resource[]>;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      applyBaseCopyWithRoles: (
        source: Activity,
        sourceResource: Resource,
        targetResource: Resource,
        roles: ActivityLinkRoleDialogResult,
      ) => void;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
    },
  ) {}

  handleActivityCopy(event: CopyEvent): void {
    const stage = this.deps.activeStage();
    const source = event.activity;
    const targetResourceId = event.targetResourceId;
    const sourceOwnerId = this.deps.activityOwnerId(source);
    if (!sourceOwnerId || targetResourceId === sourceOwnerId) {
      return;
    }
    const resources = this.deps.stageResourceSignals[stage]();
    const sourceResource = resources.find((res) => res.id === sourceOwnerId);
    const targetResource = resources.find((res) => res.id === targetResourceId);
    if (!sourceResource || !targetResource || sourceResource.kind !== targetResource.kind) {
      return;
    }
    const dialogRef = this.deps.dialog.open<
      ActivityLinkRoleDialogComponent,
      { sourceResourceName: string; targetResourceName: string },
      ActivityLinkRoleDialogResult | undefined
    >(ActivityLinkRoleDialogComponent, {
      width: '420px',
      data: {
        sourceResourceName: sourceResource.name,
        targetResourceName: targetResource.name,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      if (stage === 'base') {
        this.deps.applyBaseCopyWithRoles(source, sourceResource, targetResource, result);
        return;
      }
      this.applyActivityCopyWithRoles(stage, source, sourceResource, targetResource, event, result);
    });
  }

  private applyActivityCopyWithRoles(
    stage: PlanningStageId,
    source: Activity,
    sourceResource: Resource,
    targetResource: Resource,
    event: CopyEvent,
    roles: ActivityLinkRoleDialogResult,
  ): void {
    this.deps.updateStageActivities(stage, (activities) =>
      activities.map((activity) => {
        if (activity.id !== source.id) {
          return activity;
        }
        const withRoles = applyActivityCopyWithRoles(
          activity,
          sourceResource,
          targetResource,
          roles,
          (act, owner, partner, partnerRole, opts) =>
            addParticipantToActivity(act, owner, partner, partnerRole, opts),
        );
        return this.deps.applyActivityTypeConstraints(withRoles);
      }),
    );
  }
}
