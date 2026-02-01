import type {
  Activity,
  ActivityDefinition,
  ActivityTemplate,
  ActivityCategoryDefinition,
  CustomAttributeState,
  LayerGroup,
  OperationalPoint,
  OpReplacementStopLink,
  Platform,
  PlatformEdge,
  Personnel,
  PersonnelPool,
  PersonnelService,
  PersonnelServicePool,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  HomeDepot,
  Resource,
  SectionOfLine,
  Siding,
  StageId,
  StationArea,
  Track,
  TimelineRange,
  TrainRun,
  TrainSegment,
  TransferEdge,
  TranslationState,
  Vehicle,
  VehicleComposition,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
} from './planning.types';

export interface StageData {
  stageId: StageId;
  variantId: string;
  timetableYearLabel?: string | null;
  timelineRange?: TimelineRange;
  version?: string | null;
  resources: Resource[];
  activities: Activity[];
  trainRuns: TrainRun[];
  trainSegments: TrainSegment[];
}

export interface MasterDataSets {
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
  operationalPoints: OperationalPoint[];
  sectionsOfLine: SectionOfLine[];
  stationAreas: StationArea[];
  tracks: Track[];
  platformEdges: PlatformEdge[];
  platforms: Platform[];
  sidings: Siding[];
  personnelSites: PersonnelSite[];
  replacementStops: ReplacementStop[];
  replacementRoutes: ReplacementRoute[];
  replacementEdges: ReplacementEdge[];
  opReplacementStopLinks: OpReplacementStopLink[];
  transferEdges: TransferEdge[];
}

export interface ActivityCatalogData {
  templates: ActivityTemplate[];
  definitions: ActivityDefinition[];
  layerGroups: LayerGroup[];
  categories: ActivityCategoryDefinition[];
  translations: TranslationState;
  customAttributes: CustomAttributeState;
}
