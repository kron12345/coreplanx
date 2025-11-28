export type StageId = 'base' | 'operations' | 'dispatch';

export const STAGE_IDS: StageId[] = ['base', 'operations', 'dispatch'];

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as string[]).includes(value);
}

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

export interface Personnel {
  id: string;
  name: string;
  externalRef?: string | null;
  homeBase?: string | null;
  attributes?: Record<string, unknown>;
}

export type PersonnelListRequest = ListPayload<Personnel>;
export type PersonnelListResponse = Personnel[];

export interface PersonnelService {
  id: string;
  name: string;
  poolId?: string | null;
  attributes?: Record<string, unknown>;
}

export type PersonnelServiceListRequest = ListPayload<PersonnelService>;
export type PersonnelServiceListResponse = PersonnelService[];

export interface Vehicle {
  id: string;
  name: string;
  typeId?: string | null;
  externalRef?: string | null;
  homeDepot?: string | null;
  attributes?: Record<string, unknown>;
}

export type VehicleListRequest = ListPayload<Vehicle>;
export type VehicleListResponse = Vehicle[];

export interface VehicleService {
  id: string;
  name: string;
  poolId?: string | null;
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
  locationCode?: string | null;
  attributes?: Record<string, unknown>;
}

export type PersonnelPoolListRequest = ListPayload<PersonnelPool>;
export type PersonnelPoolListResponse = PersonnelPool[];

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

export type OperationalPointListRequest = ListPayload<OperationalPoint>;
export type OperationalPointListResponse = OperationalPoint[];

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
  scope: PlanningStageRealtimeScope;
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

export type ActivityCategory = 'rest' | 'movement' | 'service' | 'other';
export type ActivityTimeMode = 'duration' | 'range' | 'point';
export type ActivityFieldKey = 'start' | 'end' | 'from' | 'to' | 'remark';

export interface ActivityTypeDefinition {
  id: string;
  label: string;
  description?: string | null;
  appliesTo: ResourceKind[];
  relevantFor: ResourceKind[];
  category: ActivityCategory;
  timeMode: ActivityTimeMode;
  fields: ActivityFieldKey[];
  defaultDurationMinutes: number;
}

export interface ActivityTemplate {
  id: string;
  label: string;
  description?: string | null;
  activityType?: string | null;
  defaultDurationMinutes?: number | null;
  attributes?: ActivityAttributes;
}

export interface ActivityDefinition {
  id: string;
  label: string;
  description?: string | null;
  activityType: string;
  templateId?: string | null;
  defaultDurationMinutes?: number | null;
  relevantFor?: ResourceKind[];
  attributes?: ActivityAttributes;
}

export interface LayerGroup {
  id: string;
  label: string;
  order?: number;
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

export interface ActivityCatalogSnapshot {
  types: ActivityTypeDefinition[];
  templates: ActivityTemplate[];
  definitions: ActivityDefinition[];
  layerGroups: LayerGroup[];
  translations: TranslationState;
}

export interface ResourceSnapshot {
  personnel: Personnel[];
  personnelServices: PersonnelService[];
  personnelServicePools: PersonnelServicePool[];
  personnelPools: PersonnelPool[];
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
  clientRequestId?: string;
}

export interface ActivityMutationResponse {
  appliedUpserts: string[];
  deletedIds: string[];
  version?: string | null;
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
