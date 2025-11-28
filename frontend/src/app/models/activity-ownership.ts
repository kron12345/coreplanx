import { Activity, ActivityParticipant, ActivityParticipantRole } from './activity';
import { ResourceKind } from './resource';

const PRIMARY_OWNER_ROLES: ReadonlySet<ActivityParticipantRole> = new Set([
  'primary-personnel',
  'primary-vehicle',
]);

export type ActivityParticipantCategory = 'personnel' | 'vehicle' | 'other';

export function classifyParticipant(
  participant: ActivityParticipant | null | undefined,
): ActivityParticipantCategory {
  if (!participant) {
    return 'other';
  }
  return participantCategoryFromKind(participant.kind);
}

export function participantCategoryFromKind(kind: ResourceKind | undefined): ActivityParticipantCategory {
  switch (kind) {
    case 'personnel':
    case 'personnel-service':
      return 'personnel';
    case 'vehicle':
    case 'vehicle-service':
      return 'vehicle';
    default:
      return 'other';
  }
}

export function getActivityOwnerParticipant(activity: Activity): ActivityParticipant | null {
  const participants = activity.participants;
  if (!participants || participants.length === 0) {
    return null;
  }
  const primary =
    participants.find(
      (participant) => !!participant.role && PRIMARY_OWNER_ROLES.has(participant.role),
    ) ?? null;
  return primary ?? participants[0];
}

export function getActivityOwnerId(activity: Activity): string | null {
  const ownerParticipant = getActivityOwnerParticipant(activity);
  return ownerParticipant?.resourceId ?? null;
}

export function getActivityParticipantIds(activity: Activity, includeOwner = true): string[] {
  const ids = new Set<string>();
  if (includeOwner) {
    const ownerId = getActivityOwnerId(activity);
    if (ownerId) {
      ids.add(ownerId);
    }
  }
  (activity.participants ?? []).forEach((participant) => {
    if (participant?.resourceId) {
      ids.add(participant.resourceId);
    }
  });
  return Array.from(ids);
}

export function getActivityOwnerByCategory(
  activity: Activity,
  category: ActivityParticipantCategory,
): ActivityParticipant | null {
  if (category === 'other') {
    return null;
  }
  const participants = activity.participants ?? [];
  if (!participants.length) {
    return null;
  }
  const desiredRole: ActivityParticipantRole | null =
    category === 'vehicle' ? 'primary-vehicle' : 'primary-personnel';
  const primary =
    participants.find(
      (participant) =>
        !!participant.role && participant.role === desiredRole && classifyParticipant(participant) === category,
    ) ?? null;
  if (primary) {
    return primary;
  }
  return (
    participants.find((participant) => classifyParticipant(participant) === category) ??
    null
  );
}

export function getActivityOwnersByCategory(
  activity: Activity,
): { personnel: ActivityParticipant | null; vehicle: ActivityParticipant | null } {
  return {
    personnel: getActivityOwnerByCategory(activity, 'personnel'),
    vehicle: getActivityOwnerByCategory(activity, 'vehicle'),
  };
}
