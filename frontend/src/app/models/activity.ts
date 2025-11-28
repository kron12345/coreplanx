import { Resource, ResourceKind } from './resource';

export type ActivityType = string;

export type ServiceRole = 'start' | 'segment' | 'end';

export type ActivityScope = 'personnel-only' | 'vehicle-only' | 'mixed';

export type ActivityParticipantRole =
  | 'primary-personnel'
  | 'secondary-personnel'
  | 'primary-vehicle'
  | 'secondary-vehicle'
  | 'teacher'
  | 'student';

export interface ActivityParticipant {
  resourceId: Resource['id'];
  kind: ResourceKind;
  role?: ActivityParticipantRole;
}

export type ActivityGroupRole = 'pre' | 'main' | 'post' | 'independent';

export interface ActivityGroup {
  id: string;
  label: string;
  description?: string | null;
  scope: ActivityScope;
  /**
   * Funktion der Gruppe relativ zu einer Hauptleistung:
   * Vorleistung, Hauptgruppe, Nachleistung oder eigenständig.
   */
  role: ActivityGroupRole;
  /**
   * Optionale Referenz auf eine Hauptaktivität, an die diese Gruppe
   * als Vor-/Nachleistungsgruppe angehängt ist.
   */
  attachedToActivityId?: string | null;
}

export interface Activity {
  id: string;
  /** Identifier of the owning client/tenant to keep multiple frontends in sync. */
  clientId?: string | null;
  title: string;
  start: string; // ISO
  end?: string | null; // ISO
  type?: ActivityType;
  from?: string | null;
  to?: string | null;
  remark?: string | null;
  serviceId?: string | null;
  /**
   * References the service definition in master data (e.g. PS-001) that this activity belongs to.
   */
  serviceTemplateId?: string | null;
  /**
   * Normalized service date (YYYYMMDD) to ensure uniqueness per calendar day.
   */
  serviceDate?: string | null;
  /**
   * Distinguishes whether the service template is personnel- or vehicle-based.
   */
  serviceCategory?: 'personnel-service' | 'vehicle-service';
  serviceRole?: ServiceRole | null;
  /** Physical location identifier to detect spatial conflicts. */
  locationId?: string | null;
  locationLabel?: string | null;
  /** Capacity buckets (e.g. same track or maintenance slot). */
  capacityGroupId?: string | null;
  /** Required qualifications for the activity; used for validations. */
  requiredQualifications?: string[];
  /** Qualifications currently covered by assigned participants. */
  assignedQualifications?: string[];
  /** Rule tags for working-time validations (e.g. night shift, rest). */
  workRuleTags?: string[];
  /**
   * Optionaler Verweis auf den zugehörigen Zuglauf.
   */
  trainRunId?: string | null;
  /**
   * Optional Liste der abgedeckten Zugabschnitte.
   */
  trainSegmentIds?: string[];
  /** Optional Row-Version für Optimistic Locking. */
  rowVersion?: string | null;
  /** Audit-Informationen (optional). */
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  /**
   * Fachlicher Geltungsbereich der Aktivität: nur Personal, nur Fahrzeug oder gemischt.
   * Wird in Kombination mit den Ressourcentypen der `participants` verwendet.
   */
  scope?: ActivityScope;
  /**
   * Teilnehmerliste mit Ressourcentypen und optionalen Rollen (z. B. Lehrer/Schüler).
   * Definiert zugleich die Primär- und Nebenressourcen.
   */
  participants?: ActivityParticipant[];
  /**
   * Optionale Gruppierung über mehrere Aktivitäten hinweg, z. B. Vor-/Nachleistungsgruppen.
   */
  groupId?: string | null;
  /**
   * Relative Reihenfolge innerhalb einer Gruppe (aufsteigend).
   */
  groupOrder?: number | null;
  /**
   * Arbitrary extension attributes stored without schema changes.
   * Preferred over the legacy `meta` bag.
   */
  attributes?: Record<string, unknown>;
  /** @deprecated Use `attributes` instead. */
  meta?: Record<string, unknown>;
}
