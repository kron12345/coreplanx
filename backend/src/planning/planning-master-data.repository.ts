import { Injectable } from '@nestjs/common';
import type {
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
  SectionOfLine,
  Siding,
  StationArea,
  Track,
  TransferEdge,
  Vehicle,
  VehicleComposition,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
} from './planning.types';
import type { MasterDataSets } from './planning.repository.types';
import { PlanningMasterDataReadRepository } from './planning-master-data.read.repository';
import { PlanningMasterDataWriteRepository } from './planning-master-data.write.repository';

@Injectable()
export class PlanningMasterDataRepository {
  constructor(
    private readonly readRepository: PlanningMasterDataReadRepository,
    private readonly writeRepository: PlanningMasterDataWriteRepository,
  ) {}

  get isEnabled(): boolean {
    return this.readRepository.isEnabled;
  }

  loadMasterData(): Promise<MasterDataSets> {
    return this.readRepository.loadMasterData();
  }

  replacePersonnelServicePools(items: PersonnelServicePool[]): Promise<void> {
    return this.writeRepository.replacePersonnelServicePools(items);
  }

  replacePersonnelPools(items: PersonnelPool[]): Promise<void> {
    return this.writeRepository.replacePersonnelPools(items);
  }

  replaceHomeDepots(items: HomeDepot[]): Promise<void> {
    return this.writeRepository.replaceHomeDepots(items);
  }

  replaceVehicleServicePools(items: VehicleServicePool[]): Promise<void> {
    return this.writeRepository.replaceVehicleServicePools(items);
  }

  replaceVehiclePools(items: VehiclePool[]): Promise<void> {
    return this.writeRepository.replaceVehiclePools(items);
  }

  replacePersonnel(items: Personnel[]): Promise<void> {
    return this.writeRepository.replacePersonnel(items);
  }

  replacePersonnelServices(items: PersonnelService[]): Promise<void> {
    return this.writeRepository.replacePersonnelServices(items);
  }

  replaceVehicles(items: Vehicle[]): Promise<void> {
    return this.writeRepository.replaceVehicles(items);
  }

  replaceVehicleServices(items: VehicleService[]): Promise<void> {
    return this.writeRepository.replaceVehicleServices(items);
  }

  replaceVehicleTypes(items: VehicleType[]): Promise<void> {
    return this.writeRepository.replaceVehicleTypes(items);
  }

  replaceVehicleCompositions(items: VehicleComposition[]): Promise<void> {
    return this.writeRepository.replaceVehicleCompositions(items);
  }

  replaceOperationalPoints(items: OperationalPoint[]): Promise<void> {
    return this.writeRepository.replaceOperationalPoints(items);
  }

  replaceSectionsOfLine(items: SectionOfLine[]): Promise<void> {
    return this.writeRepository.replaceSectionsOfLine(items);
  }

  replaceStationAreas(items: StationArea[]): Promise<void> {
    return this.writeRepository.replaceStationAreas(items);
  }

  replaceTracks(items: Track[]): Promise<void> {
    return this.writeRepository.replaceTracks(items);
  }

  replacePlatformEdges(items: PlatformEdge[]): Promise<void> {
    return this.writeRepository.replacePlatformEdges(items);
  }

  replacePlatforms(items: Platform[]): Promise<void> {
    return this.writeRepository.replacePlatforms(items);
  }

  replaceSidings(items: Siding[]): Promise<void> {
    return this.writeRepository.replaceSidings(items);
  }

  replacePersonnelSites(items: PersonnelSite[]): Promise<void> {
    return this.writeRepository.replacePersonnelSites(items);
  }

  replaceReplacementStops(items: ReplacementStop[]): Promise<void> {
    return this.writeRepository.replaceReplacementStops(items);
  }

  replaceReplacementRoutes(items: ReplacementRoute[]): Promise<void> {
    return this.writeRepository.replaceReplacementRoutes(items);
  }

  replaceReplacementEdges(items: ReplacementEdge[]): Promise<void> {
    return this.writeRepository.replaceReplacementEdges(items);
  }

  replaceOpReplacementStopLinks(items: OpReplacementStopLink[]): Promise<void> {
    return this.writeRepository.replaceOpReplacementStopLinks(items);
  }

  replaceTransferEdges(items: TransferEdge[]): Promise<void> {
    return this.writeRepository.replaceTransferEdges(items);
  }

  listOperationalPointsPaged(
    offset: number,
    limit: number,
    query?: string | null,
  ) {
    return this.readRepository.listOperationalPointsPaged(offset, limit, query);
  }

  listOperationalPointsInBounds(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number,
    limit?: number,
  ) {
    return this.readRepository.listOperationalPointsInBounds(
      minLat,
      minLng,
      maxLat,
      maxLng,
      limit,
    );
  }

  listOperationalPointsByIds(ids: string[]) {
    return this.readRepository.listOperationalPointsByIds(ids);
  }

  listSectionsOfLinePaged(
    offset: number,
    limit: number,
    query?: string | null,
  ) {
    return this.readRepository.listSectionsOfLinePaged(offset, limit, query);
  }

  listStationAreasPaged(
    offset: number,
    limit: number,
    query?: string | null,
  ) {
    return this.readRepository.listStationAreasPaged(offset, limit, query);
  }

  listTracksPaged(offset: number, limit: number, query?: string | null) {
    return this.readRepository.listTracksPaged(offset, limit, query);
  }

  listPlatformEdgesPaged(
    offset: number,
    limit: number,
    query?: string | null,
  ) {
    return this.readRepository.listPlatformEdgesPaged(offset, limit, query);
  }

  listPlatformsPaged(offset: number, limit: number, query?: string | null) {
    return this.readRepository.listPlatformsPaged(offset, limit, query);
  }

  listSidingsPaged(offset: number, limit: number, query?: string | null) {
    return this.readRepository.listSidingsPaged(offset, limit, query);
  }
}
