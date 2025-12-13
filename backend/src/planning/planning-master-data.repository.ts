import { Injectable } from '@nestjs/common';
import type {
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
  SectionOfLine,
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
}

