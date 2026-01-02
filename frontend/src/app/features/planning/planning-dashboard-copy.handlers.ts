import { MatDialog } from '@angular/material/dialog';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityLinkRoleDialogComponent, ActivityLinkRoleDialogResult } from './activity-link-role-dialog.component';
import { PlanningStageId } from './planning-stage.model';
import { applyActivityCopyWithRoles } from './planning-dashboard-activity-copy.utils';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { addParticipantToActivity, resolveSuggestedParticipantRole } from './planning-dashboard-participant.utils';

type CopyEvent = {
  activity: Activity;
  targetResourceId: string;
  start: Date;
  end: Date | null;
  sourceResourceId?: string | null;
  participantCategory?: ActivityParticipantCategory | null;
  participantResourceId?: string | null;
  isOwnerSlot?: boolean;
};

export class PlanningDashboardCopyHandlers {
  constructor(
    private readonly deps: {
      dialog: MatDialog;
      activeStage: () => PlanningStageId;
      activityOwnerId: (activity: Activity) => string | null;
      stageResourceSignals: Record<PlanningStageId, () => Resource[]>;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      saveTemplateActivity: (activity: Activity) => void;
      applyBaseCopyWithRoles: (
        source: Activity,
        sourceResource: Resource,
        targetResource: Resource,
        roles: ActivityLinkRoleDialogResult,
      ) => void;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      onActivityMutated?: (activity: Activity, stage: PlanningStageId) => void;
    },
  ) {}

  handleActivityCopy(event: CopyEvent): void {
    const stage = this.deps.activeStage();
    const source = event.activity;
    const targetResourceId = event.targetResourceId;
    const sourceRowId = event.sourceResourceId ?? event.participantResourceId ?? null;
    const sourceOwnerId = this.deps.activityOwnerId(source);
    if (!sourceOwnerId || targetResourceId === sourceOwnerId || (sourceRowId && targetResourceId === sourceRowId)) {
      return;
    }
    const resources = this.deps.stageResourceSignals[stage]();
    const sourceResource = resources.find((res) => res.id === sourceOwnerId) ?? null;
    const targetResource = resources.find((res) => res.id === targetResourceId);
    if (!targetResource) {
      return;
    }
    const rowResource = (sourceRowId ? resources.find((res) => res.id === sourceRowId) : null) ?? sourceResource;
    if (!rowResource || !sourceResource) {
      return;
    }

    const isVehicle = (resource: Resource) => resource.kind === 'vehicle' || resource.kind === 'vehicle-service';
    if (isVehicle(rowResource) && isVehicle(targetResource)) {
      const updated = this.deps.applyActivityTypeConstraints(
        addParticipantToActivity(
          source,
          sourceResource,
          targetResource,
          resolveSuggestedParticipantRole(source, targetResource),
          { retainPreviousOwner: true },
        ),
      );
      if (stage === 'base') {
        this.deps.saveTemplateActivity(updated);
        this.deps.onActivityMutated?.(updated, stage);
        return;
      }
      this.deps.updateStageActivities(stage, (activities) =>
        activities.map((activity) => (activity.id === source.id ? updated : activity)),
      );
      this.deps.onActivityMutated?.(updated, stage);
      return;
    }

    if (rowResource.kind !== targetResource.kind) {
      const updated = this.deps.applyActivityTypeConstraints(
        addParticipantToActivity(
          source,
          sourceResource,
          targetResource,
          resolveSuggestedParticipantRole(source, targetResource),
          { retainPreviousOwner: true },
        ),
      );
      if (stage === 'base') {
        this.deps.saveTemplateActivity(updated);
        this.deps.onActivityMutated?.(updated, stage);
        return;
      }
      this.deps.updateStageActivities(stage, (activities) =>
        activities.map((activity) => (activity.id === source.id ? updated : activity)),
      );
      this.deps.onActivityMutated?.(updated, stage);
      return;
    }
    const dialogRef = this.deps.dialog.open<
      ActivityLinkRoleDialogComponent,
      { sourceResourceName: string; targetResourceName: string },
      ActivityLinkRoleDialogResult | undefined
    >(ActivityLinkRoleDialogComponent, {
      width: '420px',
      data: {
        sourceResourceName: rowResource.name,
        targetResourceName: targetResource.name,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      if (stage === 'base') {
        this.deps.applyBaseCopyWithRoles(source, rowResource, targetResource, result);
        return;
      }
      this.applyActivityCopyWithRoles(stage, source, rowResource, targetResource, event, result);
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
        const updated = this.deps.applyActivityTypeConstraints(withRoles);
        this.deps.onActivityMutated?.(updated, stage);
        return updated;
      }),
    );
  }
}
