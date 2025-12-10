import { Activity, ActivityParticipant, ActivityParticipantRole } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityParticipantCategory, getActivityOwnerByCategory } from '../../models/activity-ownership';

export function resolvePrimaryRoleForResource(resource: Resource): ActivityParticipantRole {
  return resource.kind === 'vehicle' || resource.kind === 'vehicle-service'
    ? 'primary-vehicle'
    : 'primary-personnel';
}

export function isPrimaryParticipantRole(role: ActivityParticipantRole | undefined): boolean {
  return role === 'primary-personnel' || role === 'primary-vehicle';
}

export function addParticipantToActivity(
  activity: Activity,
  owner: Resource,
  partner?: Resource | null,
  partnerRole?: ActivityParticipantRole,
  options?: { retainPreviousOwner?: boolean; ownerCategory?: ActivityParticipantCategory },
): Activity {
  const participants = new Map<string, ActivityParticipant>();
  (activity.participants ?? []).forEach((participant) => {
    if (!participant?.resourceId) {
      return;
    }
    participants.set(participant.resourceId, { ...participant });
  });

  const ownerCategory = options?.ownerCategory ?? resourceParticipantCategory(owner);

  if (!options?.retainPreviousOwner && ownerCategory !== 'other') {
    const previousOwner = getActivityOwnerByCategory(activity, ownerCategory);
    if (previousOwner && previousOwner.resourceId !== owner.id) {
      participants.delete(previousOwner.resourceId);
    }
  }

  const ensureParticipant = (resource?: Resource | null, role?: ActivityParticipantRole) => {
    if (!resource?.id) {
      return;
    }
    const previous = participants.get(resource.id);
    const participant: ActivityParticipant = {
      resourceId: resource.id,
      kind: resource.kind,
      role: role ?? previous?.role,
    };
    participants.set(resource.id, participant);
  };

  ensureParticipant(partner, partnerRole);
  ensureParticipant(owner, resolvePrimaryRoleForResource(owner));

  const participantList = Array.from(participants.values()).sort((a, b) => {
    if (a.resourceId === owner.id) {
      return -1;
    }
    if (b.resourceId === owner.id) {
      return 1;
    }
    return a.resourceId.localeCompare(b.resourceId);
  });
  return {
    ...activity,
    participants: participantList,
  };
}

export function moveParticipantToResource(
  activity: Activity,
  fromResourceId: string | null | undefined,
  target: Resource,
): Activity {
  if (!fromResourceId) {
    return activity;
  }
  const participants = activity.participants ?? [];
  if (participants.length === 0) {
    return addParticipantToActivity(activity, target, undefined, undefined, {
      retainPreviousOwner: true,
    });
  }
  let updated = false;
  const mapped = participants.map((participant) => {
    if (participant.resourceId !== fromResourceId) {
      return participant;
    }
    updated = true;
    return {
      ...participant,
      resourceId: target.id,
      kind: target.kind,
    } as ActivityParticipant;
  });
  if (!updated) {
    return addParticipantToActivity(activity, target, undefined, undefined, {
      retainPreviousOwner: true,
    });
  }
  return {
    ...activity,
    participants: mapped,
  };
}

export function resourceParticipantCategory(resource: Resource | null): ActivityParticipantCategory {
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
