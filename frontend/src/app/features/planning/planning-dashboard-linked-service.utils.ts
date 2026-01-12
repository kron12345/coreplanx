import { Activity } from '../../models/activity';
import { Resource, ResourceKind } from '../../models/resource';
import { readAttributeBoolean } from '../../core/utils/activity-definition.utils';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { isPersonnelKind, isVehicleKind, resolveOppositeParticipantKind } from './planning-dashboard-participant.utils';

export interface LinkedServiceFieldState {
  kind: ResourceKind | null;
  visible: boolean;
  required: boolean;
}

export function resolveLinkedServiceFieldState(options: {
  anchor: Resource | null | undefined;
  definition: ActivityCatalogOption | null;
  catalogOption?: ActivityCatalogOption | null;
}): LinkedServiceFieldState {
  const anchor = options.anchor ?? null;
  if (!anchor) {
    return { kind: null, visible: false, required: false };
  }
  const linkKind = resolveOppositeParticipantKind(anchor.kind);
  if (!linkKind) {
    return { kind: null, visible: false, required: false };
  }
  const attrs = options.catalogOption?.attributes ?? options.definition?.attributes ?? null;
  const relevantFor = options.catalogOption?.relevantFor ?? options.definition?.relevantFor ?? null;
  const allowsVehicle = !relevantFor || relevantFor.length === 0 ? true : relevantFor.some((kind) => isVehicleKind(kind));
  const allowsPersonnel = !relevantFor || relevantFor.length === 0 ? true : relevantFor.some((kind) => isPersonnelKind(kind));
  const requiresVehicle =
    readAttributeBoolean(attrs, 'requires_vehicle') || (allowsVehicle && !allowsPersonnel);
  const requiresPersonnel =
    readAttributeBoolean(attrs, 'requires_personnel') || (allowsPersonnel && !allowsVehicle);

  if (isVehicleKind(linkKind)) {
    return {
      kind: linkKind,
      visible: allowsVehicle,
      required: requiresVehicle && allowsVehicle,
    };
  }
  if (isPersonnelKind(linkKind)) {
    return {
      kind: linkKind,
      visible: allowsPersonnel,
      required: requiresPersonnel && allowsPersonnel,
    };
  }
  return { kind: linkKind, visible: false, required: false };
}

export function resolveLinkedServiceLabel(kind: ResourceKind | null): string {
  switch (kind) {
    case 'vehicle-service':
      return 'Fahrzeugdienst';
    case 'vehicle':
      return 'Fahrzeug';
    case 'personnel-service':
      return 'Personaldienst';
    case 'personnel':
      return 'Personal';
    default:
      return 'Dienst';
  }
}

export function extractLinkedServiceParticipantId(activity: Activity, kind: ResourceKind | null): string | null {
  if (!kind) {
    return null;
  }
  const participants = activity.participants ?? [];
  const match = participants.find((participant) => participant.kind === kind);
  return match?.resourceId ?? null;
}
