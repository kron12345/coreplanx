import type {
  Activity,
  ActivityDefinition,
  ActivityTemplate,
  ActivityTypeDefinition,
  CustomAttributeState,
  LayerGroup,
  OperationalPoint,
  OpReplacementStopLink,
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
  StageId,
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
  personnelSites: PersonnelSite[];
  replacementStops: ReplacementStop[];
  replacementRoutes: ReplacementRoute[];
  replacementEdges: ReplacementEdge[];
  opReplacementStopLinks: OpReplacementStopLink[];
  transferEdges: TransferEdge[];
}

export interface ActivityCatalogData {
  types: ActivityTypeDefinition[];
  templates: ActivityTemplate[];
  definitions: ActivityDefinition[];
  layerGroups: LayerGroup[];
  translations: TranslationState;
  customAttributes: CustomAttributeState;
}
