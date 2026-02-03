export type StageId = 'base' | 'operations' | 'dispatch';

export const STAGE_IDS: StageId[] = ['base', 'operations', 'dispatch'];

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as string[]).includes(value);
}

export type PlanningVariantId = string;

export interface TimelineRange {
  start: string;
  end: string;
}

export type ResourceKind =
  | 'personnel-service'
  | 'vehicle-service'
  | 'personnel'
  | 'vehicle';

export type ActivityScope = 'personnel-only' | 'vehicle-only' | 'mixed';

export interface Resource {
  id: string;
  name: string;
  kind: ResourceKind;
  dailyServiceCapacity?: number;
  attributes?: Record<string, unknown>;
}

export interface TemporalValue<T = unknown> {
  value: T;
  validFrom: string;
  validTo?: string | null;
}

export interface Personnel {
  id: string;
  firstName?: string | TemporalValue<string>[];
  lastName?: string;
  preferredName?: string | TemporalValue<string>[];
  qualifications?: string[];
  serviceIds?: string[];
  poolId?: string;
  homeStation?: string;
  availabilityStatus?: string;
  qualificationExpires?: string;
  isReserve?: boolean;

  /** Legacy/DB display name (derived from first/last). */
  name?: string;
  externalRef?: string | null;
  homeBase?: string | null;
  attributes?: Record<string, unknown>;
}

export type PersonnelListRequest = ListPayload<Personnel>;
export type PersonnelListResponse = Personnel[];

export interface PersonnelService {
  id: string;
  name: string;
  description?: string;
  requiredQualifications?: string[];
  poolId?: string | null;
  startTime?: string;
  endTime?: string;
  isNightService?: boolean;
  maxDailyInstances?: number;
  maxResourcesPerInstance?: number;
  attributes?: Record<string, unknown>;
}

export type PersonnelServiceListRequest = ListPayload<PersonnelService>;
export type PersonnelServiceListResponse = PersonnelService[];

export interface Vehicle {
  id: string;
  vehicleNumber?: string;
  typeId?: string | null;
  depot?: string | null;
  serviceIds?: string[];
  description?: string;
  poolId?: string;
  hasWifi?: boolean;
  fleetStatus?: string;
  lastInspectionDate?: string;
  rangeKm?: number;
  seatReservation?: boolean;

  /** Legacy/DB display label (derived from vehicleNumber). */
  name?: string;
  externalRef?: string | null;
  homeDepot?: string | null;
  attributes?: Record<string, unknown>;
}

export type VehicleListRequest = ListPayload<Vehicle>;
export type VehicleListResponse = Vehicle[];

export interface VehicleService {
  id: string;
  name: string;
  description?: string;
  requiredVehicleTypeIds?: string[];
  poolId?: string | null;
  startTime?: string;
  endTime?: string;
  isOvernight?: boolean;
  primaryRoute?: string;
  maxDailyInstances?: number;
  maxResourcesPerInstance?: number;
  attributes?: Record<string, unknown>;
}

export type VehicleServiceListRequest = ListPayload<VehicleService>;
export type VehicleServiceListResponse = VehicleService[];

export type PlanWeekResourceKind = 'vehicle-service' | 'personnel-service';

export interface PlanWeekTemplate {
  id: string;
  label: string;
  description?: string | null;
  baseWeekStartIso: string;
  variant?: string | null;
  slices: PlanWeekSlice[];
  createdAtIso: string;
  updatedAtIso: string;
  version: string;
}

export interface PlanWeekSlice {
  id: string;
  templateId: string;
  label?: string | null;
  startIso: string;
  endIso: string;
}

export interface PlanWeekActivity {
  id: string;
  templateId: string;
  title: string;
  startIso: string;
  endIso?: string | null;
  type?: string | null;
  remark?: string | null;
  attributes?: Record<string, unknown>;
  participants: PlanWeekActivityParticipant[];
}

export interface PlanWeekActivityParticipant {
  resourceId: string;
  role?: string | null;
}

export interface PlanWeekTemplateListResponse {
  items: PlanWeekTemplate[];
}

export interface PlanWeekActivityListResponse {
  items: PlanWeekActivity[];
}

export type PlanWeekValidityStatus = 'draft' | 'approved' | 'rolled-out';

export interface PlanWeekValidity {
  id: string;
  templateId: string;
  validFromIso: string;
  validToIso: string;
  includeWeekNumbers?: number[];
  excludeWeekNumbers?: number[];
  status: PlanWeekValidityStatus;
}

export interface PlanWeekValidityListResponse {
  items: PlanWeekValidity[];
}

export interface PlanWeekRolloutRequest {
  templateId: string;
  version: string;
  weekStartIso: string;
  weekCount: number;
  skipWeekCodes?: string[];
}

export interface WeekInstanceSummary {
  id: string;
  weekStartIso: string;
  status: WeekInstanceStatus;
}

export interface PlanWeekRolloutResponse {
  createdInstances: WeekInstanceSummary[];
}

export type WeekInstanceStatus =
  | 'planned'
  | 'released'
  | 'in-progress'
  | 'archived';

export interface ScheduledService {
  id: string;
  instanceId: string;
  sliceId: string;
  startIso: string;
  endIso: string;
  attributes?: Record<string, unknown>;
}

export type ServiceAssignmentResourceKind = 'vehicle' | 'personnel';

export interface ServiceAssignment {
  id: string;
  scheduledServiceId: string;
  resourceId: string;
  resourceKind: ServiceAssignmentResourceKind;
  assignedAtIso: string;
  assignedBy?: string | null;
}

export interface WeekInstance {
  id: string;
  templateId: string;
  weekStartIso: string;
  templateVersion: string;
  services: ScheduledService[];
  assignments: ServiceAssignment[];
  status: WeekInstanceStatus;
}

export interface WeekInstanceListResponse {
  items: WeekInstance[];
}

export type PlanWeekRealtimeScope =
  | 'template'
  | 'service'
  | 'validity'
  | 'rollout';

export interface PlanWeekRealtimeEvent {
  scope: PlanWeekRealtimeScope;
  templateId?: string | null;
  upserts?: (
    | PlanWeekTemplate
    | PlanWeekSlice
    | PlanWeekActivity
    | PlanWeekValidity
    | WeekInstanceSummary
  )[];
  deleteIds?: string[];
  version?: string | null;
  sourceClientId?: string | null;
  sourceConnectionId?: string | null;
  timestamp?: string | null;
}

export interface ListPayload<T> {
  items: T[];
}

export interface PersonnelServicePool {
  id: string;
  name: string;
  description?: string | null;
  serviceIds: string[];
  homeDepotId?: string | null;
  shiftCoordinator?: string | null;
  contactEmail?: string | null;
  attributes?: Record<string, unknown>;
}

export type PersonnelServicePoolListRequest = ListPayload<PersonnelServicePool>;
export type PersonnelServicePoolListResponse = PersonnelServicePool[];

export interface PersonnelPool {
  id: string;
  name: string;
  description?: string | null;
  personnelIds: string[];
  homeDepotId?: string | null;
  locationCode?: string | null;
  attributes?: Record<string, unknown>;
}

export type PersonnelPoolListRequest = ListPayload<PersonnelPool>;
export type PersonnelPoolListResponse = PersonnelPool[];

export interface HomeDepot {
  id: string;
  name: string;
  description?: string | null;
  /**
   * Zulässige Start-/Endstellen (PersonnelSite.siteId). Anfang = Ende wird in der Logik erzwungen.
   */
  siteIds: string[];
  /**
   * Zulässige Pausenräume (PersonnelSite.siteId) für reguläre Pausen.
   */
  breakSiteIds: string[];
  /**
   * Zulässige Pausenräume (PersonnelSite.siteId) für Kurzpausen / Arbeitsunterbrechungen.
   */
  shortBreakSiteIds: string[];
  /**
   * Zulässige Orte für auswärtige Übernachtungen (PersonnelSite.siteId).
   */
  overnightSiteIds: string[];
  attributes?: Record<string, unknown>;
}

export type HomeDepotListRequest = ListPayload<HomeDepot>;
export type HomeDepotListResponse = HomeDepot[];

export interface VehicleServicePool {
  id: string;
  name: string;
  description?: string | null;
  serviceIds: string[];
  dispatcher?: string | null;
  attributes?: Record<string, unknown>;
}

export type VehicleServicePoolListRequest = ListPayload<VehicleServicePool>;
export type VehicleServicePoolListResponse = VehicleServicePool[];

export interface VehiclePool {
  id: string;
  name: string;
  description?: string | null;
  vehicleIds: string[];
  depotManager?: string | null;
  attributes?: Record<string, unknown>;
}

export type VehiclePoolListRequest = ListPayload<VehiclePool>;
export type VehiclePoolListResponse = VehiclePool[];

export interface VehicleType {
  id: string;
  label: string;
  category?: string | null;
  capacity?: number | null;
  maxSpeed?: number | null;
  maintenanceIntervalDays?: number | null;
  energyType?: string | null;
  manufacturer?: string | null;
  trainTypeCode?: string | null;
  lengthMeters?: number | null;
  weightTons?: number | null;
  brakeType?: string | null;
  brakePercentage?: number | null;
  tiltingCapability?: 'none' | 'passive' | 'active' | null;
  powerSupplySystems?: string[];
  trainProtectionSystems?: string[];
  etcsLevel?: string | null;
  gaugeProfile?: string | null;
  maxAxleLoad?: number | null;
  noiseCategory?: string | null;
  remarks?: string | null;
  attributes?: Record<string, unknown>;
}

export type VehicleTypeListRequest = ListPayload<VehicleType>;
export type VehicleTypeListResponse = VehicleType[];

export interface VehicleCompositionEntry {
  typeId: string;
  quantity: number;
}

export interface VehicleComposition {
  id: string;
  name: string;
  entries: VehicleCompositionEntry[];
  turnaroundBuffer?: string | null;
  remark?: string | null;
  attributes?: Record<string, unknown>;
}

export type VehicleCompositionListRequest = ListPayload<VehicleComposition>;
export type VehicleCompositionListResponse = VehicleComposition[];

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TopologyAttribute {
  key: string;
  value: string;
  validFrom?: string | null;
}

export interface OperationalPoint {
  opId: string;
  uniqueOpId: string;
  countryCode: string;
  name: string;
  opType: string;
  position?: LatLng | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type OperationalPointListRequest = ListPayload<OperationalPoint>;
export type OperationalPointListResponse = OperationalPoint[];

export interface OperationalPointIdsRequest {
  ids: string[];
}

export interface OperationalPointBoundsRequest {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  limit?: number;
}

export type SectionOfLineNature = 'REGULAR' | 'LINK';

export interface SectionOfLine {
  solId: string;
  startUniqueOpId: string;
  endUniqueOpId: string;
  lengthKm?: number | null;
  nature: SectionOfLineNature;
  polyline?: LatLng[];
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type SectionOfLineListRequest = ListPayload<SectionOfLine>;
export type SectionOfLineListResponse = SectionOfLine[];

export interface TopologyRouteRequest {
  startUniqueOpId: string;
  endUniqueOpId: string;
  includeLinkSections?: boolean | null;
  allowedNatures?: SectionOfLineNature[] | null;
  attributeFilters?: Array<{ key: string; values?: string[] }>;
  maxAlternatives?: number | null;
}

export interface TopologyRouteSegment {
  solId: string;
  startUniqueOpId: string;
  endUniqueOpId: string;
  lengthKm?: number | null;
  polyline?: LatLng[];
}

export interface TopologyRouteResponse {
  status: 'ok' | 'no_route' | 'invalid';
  startUniqueOpId: string;
  endUniqueOpId: string;
  totalDistanceKm?: number;
  segments?: TopologyRouteSegment[];
  geometry?: LatLng[];
  alternatives?: TopologyRouteSegmentedRoute[];
  message?: string;
}

export interface TopologyRouteSegmentedRoute {
  totalDistanceKm?: number;
  segments?: TopologyRouteSegment[];
  geometry?: LatLng[];
}

export interface StationArea {
  stationAreaId: string;
  uniqueOpId?: string | null;
  name?: string | null;
  position?: LatLng | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type StationAreaListRequest = ListPayload<StationArea>;
export type StationAreaListResponse = StationArea[];

export interface Track {
  trackKey: string;
  trackId?: string | null;
  uniqueOpId?: string | null;
  platformEdgeIds?: string[];
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type TrackListRequest = ListPayload<Track>;
export type TrackListResponse = Track[];

export interface PlatformEdge {
  platformEdgeId: string;
  platformId?: string | null;
  platformKey?: string | null;
  trackKey?: string | null;
  lengthMeters?: number | null;
  platformHeight?: string | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type PlatformEdgeListRequest = ListPayload<PlatformEdge>;
export type PlatformEdgeListResponse = PlatformEdge[];

export interface Platform {
  platformKey: string;
  platformId?: string | null;
  uniqueOpId?: string | null;
  name?: string | null;
  lengthMeters?: number | null;
  platformHeight?: string | null;
  platformEdgeIds?: string[];
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type PlatformListRequest = ListPayload<Platform>;
export type PlatformListResponse = Platform[];

export interface Siding {
  sidingKey: string;
  sidingId?: string | null;
  uniqueOpId?: string | null;
  lengthMeters?: number | null;
  gradient?: string | null;
  hasRefuelling?: boolean | null;
  hasElectricShoreSupply?: boolean | null;
  hasWaterRestocking?: boolean | null;
  hasSandRestocking?: boolean | null;
  hasToiletDischarge?: boolean | null;
  hasExternalCleaning?: boolean | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type SidingListRequest = ListPayload<Siding>;
export type SidingListResponse = Siding[];

export type PersonnelSiteType =
  | 'MELDESTELLE'
  | 'PAUSENRAUM'
  | 'BEREITSCHAFT'
  | 'B\xdcRO';

export interface PersonnelSite {
  siteId: string;
  siteType: PersonnelSiteType;
  name: string;
  uniqueOpId?: string | null;
  position: LatLng;
  openingHoursJson?: string | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type PersonnelSiteListRequest = ListPayload<PersonnelSite>;
export type PersonnelSiteListResponse = PersonnelSite[];

export interface ReplacementStop {
  replacementStopId: string;
  name: string;
  stopCode?: string | null;
  position: LatLng;
  nearestUniqueOpId?: string | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type ReplacementStopListRequest = ListPayload<ReplacementStop>;
export type ReplacementStopListResponse = ReplacementStop[];

export interface ReplacementRoute {
  replacementRouteId: string;
  name: string;
  operator?: string | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type ReplacementRouteListRequest = ListPayload<ReplacementRoute>;
export type ReplacementRouteListResponse = ReplacementRoute[];

export interface ReplacementEdge {
  replacementEdgeId: string;
  replacementRouteId: string;
  fromStopId: string;
  toStopId: string;
  seq: number;
  avgDurationSec?: number | null;
  distanceM?: number | null;
  polyline?: LatLng[];
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type ReplacementEdgeListRequest = ListPayload<ReplacementEdge>;
export type ReplacementEdgeListResponse = ReplacementEdge[];

export type OpReplacementRelationType =
  | 'PRIMARY_SEV_STOP'
  | 'ALTERNATIVE'
  | 'TEMPORARY';

export interface OpReplacementStopLink {
  linkId: string;
  uniqueOpId: string;
  replacementStopId: string;
  relationType: OpReplacementRelationType;
  walkingTimeSec?: number | null;
  distanceM?: number | null;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type OpReplacementStopLinkListRequest =
  ListPayload<OpReplacementStopLink>;
export type OpReplacementStopLinkListResponse = OpReplacementStopLink[];

export type TransferNodeKind = 'OP' | 'PERSONNEL_SITE' | 'REPLACEMENT_STOP';

export interface TransferNodeBase {
  kind: TransferNodeKind;
}

export interface TransferNodeOperationalPoint extends TransferNodeBase {
  kind: 'OP';
  uniqueOpId: string;
}

export interface TransferNodePersonnelSite extends TransferNodeBase {
  kind: 'PERSONNEL_SITE';
  siteId: string;
}

export interface TransferNodeReplacementStop extends TransferNodeBase {
  kind: 'REPLACEMENT_STOP';
  replacementStopId: string;
}

export type TransferNode =
  | TransferNodeOperationalPoint
  | TransferNodePersonnelSite
  | TransferNodeReplacementStop;

export type TransferMode = 'WALK' | 'SHUTTLE' | 'INTERNAL';

export interface TransferEdge {
  transferId: string;
  from: TransferNode;
  to: TransferNode;
  mode: TransferMode;
  avgDurationSec?: number | null;
  distanceM?: number | null;
  bidirectional: boolean;
  attributes?: TopologyAttribute[];
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type TransferEdgeListRequest = ListPayload<TransferEdge>;
export type TransferEdgeListResponse = TransferEdge[];

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

export interface TopologyImportRequest {
  kinds?: TopologyImportKind[];
}

export interface TopologyImportResponse {
  startedAt: string;
  requestedKinds: TopologyImportKind[];
  message?: string;
}

export type TopologyImportStatus =
  | 'queued'
  | 'in-progress'
  | 'succeeded'
  | 'failed'
  | 'ignored';

export interface TopologyImportEventRequest {
  status: TopologyImportStatus;
  kinds?: TopologyImportKind[];
  message?: string;
  source?: string;
}

export interface TopologyImportRealtimeEvent
  extends TopologyImportEventRequest {
  timestamp: string;
}

export type PlanningStageRealtimeScope =
  | 'resources'
  | 'activities'
  | 'timeline';

export interface PlanningStageRealtimeEvent {
  stageId: StageId;
  variantId: PlanningVariantId;
  scope: PlanningStageRealtimeScope;
  clientRequestId?: string | null;
  version?: string | null;
  sourceClientId?: string | null;
  sourceConnectionId?: string | null;
  upserts?: (Resource | Activity)[];
  deleteIds?: string[];
  timelineRange?: TimelineRange;
}

export interface ActivityParticipant {
  resourceId: string;
  kind: ResourceKind;
  role?: string | null;
}

export interface TrainRun {
  id: string;
  trainNumber: string;
  timetableId?: string | null;
  attributes?: Record<string, unknown>;
}

export interface TrainSegment {
  id: string;
  trainRunId: string;
  sectionIndex: number;
  startTime: string;
  endTime: string;
  fromLocationId: string;
  toLocationId: string;
  pathId?: string | null;
  distanceKm?: number | null;
  attributes?: Record<string, unknown>;
}

export type ActivityAttributeDrawMode =
  | 'line-above'
  | 'line-below'
  | 'shift-up'
  | 'shift-down'
  | 'dot'
  | 'square'
  | 'triangle-up'
  | 'triangle-down'
  | 'thick'
  | 'background';

export interface ActivityAttributes {
  draw_as?: ActivityAttributeDrawMode;
  layer_group?: string;
  color?: string;
  default_duration?: number;
  relevant_for?: ResourceKind[];
  consider_capacity_conflicts?: boolean;
  is_short_break?: boolean;
  is_break?: boolean;
  is_service_start?: boolean;
  is_service_end?: boolean;
  is_absence?: boolean;
  is_reserve?: boolean;
  [key: string]: unknown;
}

export interface ActivityAttributeValue {
  key: string;
  meta?: Record<string, unknown>;
}

export type ActivityCategory = string;
export type ActivityTimeMode = 'duration' | 'range' | 'point';
export type ActivityFieldKey = 'start' | 'end' | 'from' | 'to' | 'remark';

export interface ActivityTemplate {
  id: string;
  label: string;
  description?: string | null;
  activityType?: string | null;
  defaultDurationMinutes?: number | null;
  attributes?: ActivityAttributeValue[];
}

export interface ActivityDefinition {
  id: string;
  label: string;
  description?: string | null;
  activityType: string;
  templateId?: string | null;
  defaultDurationMinutes?: number | null;
  relevantFor?: ResourceKind[];
  attributes?: ActivityAttributeValue[];
}

export interface LayerGroup {
  id: string;
  label: string;
  order?: number;
  description?: string | null;
}

export interface ActivityCategoryDefinition {
  id: string;
  label: string;
  order?: number;
  icon?: string | null;
  description?: string | null;
}

export interface TranslationEntry {
  key: string;
  locale: string;
  label?: string | null;
  abbreviation?: string | null;
}

export type TranslationState = Record<
  string,
  Record<string, { label?: string | null; abbreviation?: string | null }>
>;

export type CustomAttributePrimitiveType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'time';

export interface CustomAttributeDefinition {
  id: string;
  key: string;
  label: string;
  type: CustomAttributePrimitiveType;
  description?: string | null;
  entityId: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  temporal?: boolean;
  required?: boolean;
}

export type CustomAttributeState = Record<string, CustomAttributeDefinition[]>;

export interface ActivityCatalogSnapshot {
  templates: ActivityTemplate[];
  definitions: ActivityDefinition[];
  layerGroups: LayerGroup[];
  categories: ActivityCategoryDefinition[];
  translations: TranslationState;
  customAttributes: CustomAttributeState;
}

export interface ResourceSnapshot {
  personnel: Personnel[];
  personnelServices: PersonnelService[];
  personnelServicePools: PersonnelServicePool[];
  personnelPools: PersonnelPool[];
  homeDepots: HomeDepot[];
  vehicles: Vehicle[];
  vehicleServices: VehicleService[];
  vehicleServicePools: VehicleServicePool[];
  vehiclePools: VehiclePool[];
  vehicleTypes: VehicleType[];
  vehicleCompositions: VehicleComposition[];
}

export interface Activity {
  id: string;
  clientId?: string | null;
  title: string;
  start: string;
  end?: string | null;
  type?: string;
  from?: string | null;
  to?: string | null;
  remark?: string | null;
  serviceId?: string | null;
  serviceTemplateId?: string | null;
  serviceDate?: string | null;
  serviceCategory?: string | null;
  serviceRole?: string | null;
  locationId?: string | null;
  locationLabel?: string | null;
  capacityGroupId?: string | null;
  requiredQualifications?: string[];
  assignedQualifications?: string[];
  workRuleTags?: string[];
  rowVersion?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  scope?: ActivityScope | null;
  participants?: ActivityParticipant[];
  groupId?: string | null;
  groupOrder?: number | null;
  trainRunId?: string | null;
  trainSegmentIds?: string[];
  attributes?: ActivityAttributes;
  meta?: Record<string, unknown>;
}

export interface PlanningStageSnapshot {
  stageId: StageId;
  variantId: PlanningVariantId;
  timetableYearLabel?: string | null;
  resources: Resource[];
  activities: Activity[];
  trainRuns?: TrainRun[];
  trainSegments?: TrainSegment[];
  timelineRange: TimelineRange;
  version?: string | null;
}

export interface ActivityMutationRequest {
  upserts?: Activity[];
  deleteIds?: string[];
  skipAutopilot?: boolean;
  clientRequestId?: string;
}

export interface ActivityMutationResponse {
  appliedUpserts: string[];
  deletedIds: string[];
  upserts?: Activity[];
  version?: string | null;
  clientRequestId?: string;
}

export type PlanningRuleKind = 'generator' | 'constraint';
export type PlanningRuleFormat = 'yaml' | 'json';

export interface PlanningRule {
  id: string;
  stageId: StageId;
  variantId: PlanningVariantId;
  timetableYearLabel?: string | null;
  kind: PlanningRuleKind;
  executor: string;
  enabled: boolean;
  format: PlanningRuleFormat;
  raw: string;
  params: Record<string, unknown>;
  definition?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PlanningRuleListResponse {
  items: PlanningRule[];
}

export interface PlanningRuleMutationRequest {
  upserts?: PlanningRule[];
  deleteIds?: string[];
  clientRequestId?: string;
}

export interface PlanningRuleMutationResponse {
  appliedUpserts: string[];
  deletedIds: string[];
}

export interface ResourceMutationRequest {
  upserts?: Resource[];
  deleteIds?: string[];
  clientRequestId?: string;
}

export interface ResourceMutationResponse {
  appliedUpserts: string[];
  deletedIds: string[];
  version?: string | null;
  clientRequestId?: string;
}

export interface ActivityValidationRequest {
  activityIds?: string[];
  windowStart?: string;
  windowEnd?: string;
  resourceIds?: string[];
  clientRequestId?: string;
}

export type ValidationRule =
  | 'location-conflict'
  | 'capacity-conflict'
  | 'working-time'
  | 'qualification'
  | 'custom';

export type ValidationSeverity = 'info' | 'warning' | 'error';

export interface ActivityValidationIssue {
  id: string;
  rule: ValidationRule;
  severity: ValidationSeverity;
  message: string;
  activityIds: string[];
  meta?: Record<string, unknown>;
}

export interface ActivityValidationResponse {
  generatedAt: string;
  issues: ActivityValidationIssue[];
}

export interface ActivityFilters {
  from?: string;
  to?: string;
  resourceIds?: string[];
}

export interface PlanningStageViewportSubscriptionRequest {
  from: string;
  to: string;
  resourceIds?: string[];
  userId: string;
  connectionId: string;
}

export interface PlanningStageViewportSubscriptionResponse {
  ok: true;
}
