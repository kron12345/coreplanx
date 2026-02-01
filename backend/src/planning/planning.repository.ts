import { Injectable } from '@nestjs/common';
import type {
  Activity,
  HomeDepot,
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
  Resource,
  SectionOfLine,
  Siding,
  StageId,
  StationArea,
  Track,
  TimelineRange,
  TransferEdge,
  Vehicle,
  VehicleComposition,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
} from './planning.types';
import type {
  ActivityCatalogData,
  MasterDataSets,
  StageData,
} from './planning.repository.types';
import { PlanningActivityCatalogRepository } from './planning-activity-catalog.repository';
import { PlanningMasterDataRepository } from './planning-master-data.repository';
import { PlanningStageRepository } from './planning-stage.repository';

export type {
  ActivityCatalogData,
  MasterDataSets,
  StageData,
} from './planning.repository.types';

@Injectable()
export class PlanningRepository {
  constructor(
    private readonly stageRepository: PlanningStageRepository,
    private readonly masterDataRepository: PlanningMasterDataRepository,
    private readonly catalogRepository: PlanningActivityCatalogRepository,
  ) {}

  get isEnabled(): boolean {
    return this.stageRepository.isEnabled;
  }

  loadStageData(
    stageId: StageId,
    variantId: string,
  ): Promise<StageData | null> {
    return this.stageRepository.loadStageData(stageId, variantId);
  }

  updateStageMetadata(
    stageId: StageId,
    variantId: string,
    timeline: TimelineRange,
    version?: string | null,
    timetableYearLabel?: string | null,
  ): Promise<void> {
    return this.stageRepository.updateStageMetadata(
      stageId,
      variantId,
      timeline,
      version,
      timetableYearLabel,
    );
  }

  applyResourceMutations(
    stageId: StageId,
    variantId: string,
    upserts: Resource[],
    deleteIds: string[],
  ): Promise<void> {
    return this.stageRepository.applyResourceMutations(
      stageId,
      variantId,
      upserts,
      deleteIds,
    );
  }

  applyActivityMutations(
    stageId: StageId,
    variantId: string,
    upserts: Activity[],
    deleteIds: string[],
  ): Promise<void> {
    return this.stageRepository.applyActivityMutations(
      stageId,
      variantId,
      upserts,
      deleteIds,
    );
  }

  deleteActivities(
    stageId: StageId,
    variantId: string,
    deleteIds: string[],
  ): Promise<void> {
    return this.stageRepository.deleteActivities(stageId, variantId, deleteIds);
  }

  loadMasterData(): Promise<MasterDataSets> {
    return this.masterDataRepository.loadMasterData();
  }

  replacePersonnelServicePools(items: PersonnelServicePool[]): Promise<void> {
    return this.masterDataRepository.replacePersonnelServicePools(items);
  }

  replacePersonnelPools(items: PersonnelPool[]): Promise<void> {
    return this.masterDataRepository.replacePersonnelPools(items);
  }

  replaceHomeDepots(items: HomeDepot[]): Promise<void> {
    return this.masterDataRepository.replaceHomeDepots(items);
  }

  replaceVehicleServicePools(items: VehicleServicePool[]): Promise<void> {
    return this.masterDataRepository.replaceVehicleServicePools(items);
  }

  replaceVehiclePools(items: VehiclePool[]): Promise<void> {
    return this.masterDataRepository.replaceVehiclePools(items);
  }

  replacePersonnel(items: Personnel[]): Promise<void> {
    return this.masterDataRepository.replacePersonnel(items);
  }

  replacePersonnelServices(items: PersonnelService[]): Promise<void> {
    return this.masterDataRepository.replacePersonnelServices(items);
  }

  replaceVehicles(items: Vehicle[]): Promise<void> {
    return this.masterDataRepository.replaceVehicles(items);
  }

  replaceVehicleServices(items: VehicleService[]): Promise<void> {
    return this.masterDataRepository.replaceVehicleServices(items);
  }

  replaceVehicleTypes(items: VehicleType[]): Promise<void> {
    return this.masterDataRepository.replaceVehicleTypes(items);
  }

  replaceVehicleCompositions(items: VehicleComposition[]): Promise<void> {
    return this.masterDataRepository.replaceVehicleCompositions(items);
  }

  replaceOperationalPoints(items: OperationalPoint[]): Promise<void> {
    return this.masterDataRepository.replaceOperationalPoints(items);
  }

  replaceSectionsOfLine(items: SectionOfLine[]): Promise<void> {
    return this.masterDataRepository.replaceSectionsOfLine(items);
  }

  replaceStationAreas(items: StationArea[]): Promise<void> {
    return this.masterDataRepository.replaceStationAreas(items);
  }

  replaceTracks(items: Track[]): Promise<void> {
    return this.masterDataRepository.replaceTracks(items);
  }

  replacePlatformEdges(items: PlatformEdge[]): Promise<void> {
    return this.masterDataRepository.replacePlatformEdges(items);
  }

  replacePlatforms(items: Platform[]): Promise<void> {
    return this.masterDataRepository.replacePlatforms(items);
  }

  replaceSidings(items: Siding[]): Promise<void> {
    return this.masterDataRepository.replaceSidings(items);
  }

  replacePersonnelSites(items: PersonnelSite[]): Promise<void> {
    return this.masterDataRepository.replacePersonnelSites(items);
  }

  replaceReplacementStops(items: ReplacementStop[]): Promise<void> {
    return this.masterDataRepository.replaceReplacementStops(items);
  }

  replaceReplacementRoutes(items: ReplacementRoute[]): Promise<void> {
    return this.masterDataRepository.replaceReplacementRoutes(items);
  }

  replaceReplacementEdges(items: ReplacementEdge[]): Promise<void> {
    return this.masterDataRepository.replaceReplacementEdges(items);
  }

  replaceOpReplacementStopLinks(items: OpReplacementStopLink[]): Promise<void> {
    return this.masterDataRepository.replaceOpReplacementStopLinks(items);
  }

  replaceTransferEdges(items: TransferEdge[]): Promise<void> {
    return this.masterDataRepository.replaceTransferEdges(items);
  }

  loadActivityCatalog(): Promise<ActivityCatalogData> {
    return this.catalogRepository.loadActivityCatalog();
  }

  replaceActivityCatalog(catalog: ActivityCatalogData): Promise<void> {
    return this.catalogRepository.replaceActivityCatalog(catalog);
  }
}
