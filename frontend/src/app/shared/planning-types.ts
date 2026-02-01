import { WritableSignal } from '@angular/core';

export type UUID = string;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TopologyAttribute {
  key: string;
  value: string;
  /**
   * Optionale fachliche Gültigkeit ab (ISO-Datum, z. B. 2024-01-01).
   */
  validFrom?: string;
}

export interface AuditInfo {
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export type OpType = string;

export interface OperationalPoint extends AuditInfo {
  opId: UUID;
  uniqueOpId: string;
  countryCode: string;
  name: string;
  opType: OpType;
  position: LatLng;
   attributes?: TopologyAttribute[];
}

export type SolNature = 'REGULAR' | 'LINK';

export interface SectionOfLine extends AuditInfo {
  solId: UUID;
  startUniqueOpId: string;
  endUniqueOpId: string;
  lengthKm?: number;
  nature: SolNature;
  polyline?: LatLng[];
   attributes?: TopologyAttribute[];
}

export interface StationArea extends AuditInfo {
  stationAreaId: UUID;
  uniqueOpId?: string;
  name?: string;
  position?: LatLng;
  attributes?: TopologyAttribute[];
}

export interface Track extends AuditInfo {
  trackKey: UUID;
  trackId?: string;
  uniqueOpId?: string;
  platformEdgeIds?: UUID[];
  attributes?: TopologyAttribute[];
}

export interface PlatformEdge extends AuditInfo {
  platformEdgeId: UUID;
  platformId?: string;
  platformKey?: UUID;
  trackKey?: UUID;
  lengthMeters?: number;
  platformHeight?: string;
  attributes?: TopologyAttribute[];
}

export interface Platform extends AuditInfo {
  platformKey: UUID;
  platformId?: string;
  uniqueOpId?: string;
  name?: string;
  lengthMeters?: number;
  platformHeight?: string;
  platformEdgeIds?: UUID[];
  attributes?: TopologyAttribute[];
}

export interface Siding extends AuditInfo {
  sidingKey: UUID;
  sidingId?: string;
  uniqueOpId?: string;
  lengthMeters?: number;
  gradient?: string;
  hasRefuelling?: boolean;
  hasElectricShoreSupply?: boolean;
  hasWaterRestocking?: boolean;
  hasSandRestocking?: boolean;
  hasToiletDischarge?: boolean;
  hasExternalCleaning?: boolean;
  attributes?: TopologyAttribute[];
}

export type OpTrackRole = 'RUNNING' | 'SIDING';

export interface OpTrack {
  opTrackId: UUID;
  uniqueOpId: string;
  role: OpTrackRole;
  name?: string;
  polyline?: LatLng[];
   attributes?: TopologyAttribute[];
}

export type PersonnelSiteType = 'MELDESTELLE' | 'PAUSENRAUM' | 'BEREITSCHAFT' | 'BÜRO';

export interface PersonnelSite extends AuditInfo {
  siteId: UUID;
  siteType: PersonnelSiteType;
  name: string;
  uniqueOpId?: string;
  position: LatLng;
  openingHoursJson?: string;
   attributes?: TopologyAttribute[];
}

export interface ReplacementStop extends AuditInfo {
  replacementStopId: UUID;
  name: string;
  stopCode?: string;
  position: LatLng;
  nearestUniqueOpId?: string;
   attributes?: TopologyAttribute[];
}

export interface ReplacementRoute extends AuditInfo {
  replacementRouteId: UUID;
  name: string;
  operator?: string;
   attributes?: TopologyAttribute[];
}

export interface ReplacementEdge extends AuditInfo {
  replacementEdgeId: UUID;
  replacementRouteId: UUID;
  fromStopId: UUID;
  toStopId: UUID;
  seq: number;
  avgDurationSec?: number;
  distanceM?: number;
  polyline?: LatLng[];
   attributes?: TopologyAttribute[];
}

export type OpReplRelation = 'PRIMARY_SEV_STOP' | 'ALTERNATIVE' | 'TEMPORARY';

export interface OpReplacementStopLink extends AuditInfo {
  linkId: UUID;
  uniqueOpId: string;
  replacementStopId: UUID;
  relationType: OpReplRelation;
  walkingTimeSec?: number;
  distanceM?: number;
   attributes?: TopologyAttribute[];
}

export type TransferMode = 'WALK' | 'SHUTTLE' | 'INTERNAL';

export type TransferNode =
  | { kind: 'OP'; uniqueOpId: string }
  | { kind: 'PERSONNEL_SITE'; siteId: UUID }
  | { kind: 'REPLACEMENT_STOP'; replacementStopId: UUID };

export interface TransferEdge extends AuditInfo {
  transferId: UUID;
  from: TransferNode;
  to: TransferNode;
  mode: TransferMode;
  avgDurationSec?: number;
  distanceM?: number;
  bidirectional: boolean;
   attributes?: TopologyAttribute[];
}

export interface PlanningEntitySignals {
  operationalPoints: WritableSignal<OperationalPoint[]>;
  sectionsOfLine: WritableSignal<SectionOfLine[]>;
  stationAreas: WritableSignal<StationArea[]>;
  tracks: WritableSignal<Track[]>;
  platformEdges: WritableSignal<PlatformEdge[]>;
  platforms: WritableSignal<Platform[]>;
  sidings: WritableSignal<Siding[]>;
  personnelSites: WritableSignal<PersonnelSite[]>;
  replacementStops: WritableSignal<ReplacementStop[]>;
  replacementRoutes: WritableSignal<ReplacementRoute[]>;
  replacementEdges: WritableSignal<ReplacementEdge[]>;
  opReplacementStopLinks: WritableSignal<OpReplacementStopLink[]>;
  transferEdges: WritableSignal<TransferEdge[]>;
}

export type TopologyImportKind =
  | 'operational-points'
  | 'sections-of-line'
  | 'station-areas'
  | 'tracks'
  | 'platform-edges'
  | 'platforms'
  | 'sidings'
  | 'personnel-sites'
  | 'replacement-stops'
  | 'replacement-routes'
  | 'replacement-edges'
  | 'op-replacement-stop-links'
  | 'transfer-edges';

export type TopologyImportStatus = 'queued' | 'in-progress' | 'succeeded' | 'failed' | 'ignored';

export interface TopologyImportRequest {
  kinds?: TopologyImportKind[];
}

export interface TopologyImportResponse {
  startedAt: string;
  requestedKinds: TopologyImportKind[];
  message?: string;
}

export interface TopologyImportRealtimeEvent {
  status: TopologyImportStatus;
  kinds?: TopologyImportKind[];
  message?: string;
  source?: string;
  timestamp: string;
}
