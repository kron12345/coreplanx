import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityLinkRoleDialogResult } from './activity-link-role-dialog.component';
import { ActivityParticipantRole } from '../../models/activity';
import { mapLinkRoleToParticipantRole } from './planning-dashboard-activity.utils';
import { addParticipantToActivity, resourceParticipantCategory } from './planning-dashboard-participant.utils';

export function applyActivityCopyWithRoles(
  source: Activity,
  sourceResource: Resource,
  targetResource: Resource,
  roles: ActivityLinkRoleDialogResult,
  addParticipant: (
    activity: Activity,
    owner: Resource,
    partner?: Resource | null,
    partnerRole?: ActivityParticipantRole,
    options?: { retainPreviousOwner?: boolean; ownerCategory?: ReturnType<typeof resourceParticipantCategory> },
  ) => Activity,
): Activity {
  const sourceRole = mapLinkRoleToParticipantRole(roles.sourceRole);
  const targetRole = mapLinkRoleToParticipantRole(roles.targetRole);

  const withParticipant = addParticipant(source, sourceResource, targetResource, targetRole, {
    retainPreviousOwner: true,
  });
  return applyParticipantRoleUpdatesHelper(withParticipant, [
    { resourceId: sourceResource.id, role: sourceRole },
    { resourceId: targetResource.id, role: targetRole },
  ]);
}

export function applyParticipantRoleUpdatesHelper(
  activity: Activity,
  updates: Array<{ resourceId: string | null | undefined; role: ActivityParticipantRole | null | undefined }>,
): Activity {
  if (!updates.length) {
    return activity;
  }
  const roleMap = new Map(
    updates
      .filter((entry) => !!entry.role && !!entry.resourceId)
      .map((entry) => [entry.resourceId, entry.role as ActivityParticipantRole]),
  );
  if (roleMap.size === 0) {
    return activity;
  }
  let changed = false;
  const participants = (activity.participants ?? []).map((participant) => {
    const nextRole = roleMap.get(participant.resourceId);
    if (!nextRole || participant.role === nextRole) {
      return participant;
    }
    changed = true;
    return {
      ...participant,
      role: nextRole,
    };
  });
  return changed ? { ...activity, participants } : activity;
}
