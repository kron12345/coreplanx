import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type {
  LatLng,
  OperationalPoint,
  OperationalPointListRequest,
  OperationalPointListResponse,
  OpReplacementStopLink,
  OpReplacementStopLinkListRequest,
  OpReplacementStopLinkListResponse,
  Personnel,
  PersonnelPool,
  PersonnelPoolListRequest,
  PersonnelPoolListResponse,
  PersonnelService,
  PersonnelServicePool,
  PersonnelServicePoolListRequest,
  PersonnelServicePoolListResponse,
  PersonnelSite,
  PersonnelSiteListRequest,
  PersonnelSiteListResponse,
  ReplacementEdge,
  ReplacementEdgeListRequest,
  ReplacementEdgeListResponse,
  ReplacementRoute,
  ReplacementRouteListRequest,
  ReplacementRouteListResponse,
  ReplacementStop,
  ReplacementStopListRequest,
  ReplacementStopListResponse,
  ResourceSnapshot,
  SectionOfLine,
  SectionOfLineListRequest,
  SectionOfLineListResponse,
  TopologyAttribute,
  TransferEdge,
  TransferEdgeListRequest,
  TransferEdgeListResponse,
  TransferNode,
  Vehicle,
  VehicleComposition,
  VehicleCompositionListRequest,
  VehicleCompositionListResponse,
  VehiclePool,
  VehiclePoolListRequest,
  VehiclePoolListResponse,
  VehicleService,
  VehicleServicePool,
  VehicleServicePoolListRequest,
  VehicleServicePoolListResponse,
  VehicleType,
  VehicleTypeListRequest,
  VehicleTypeListResponse,
} from './planning.types';
import { PlanningRepository } from './planning.repository';

@Injectable()
export class PlanningMasterDataService implements OnModuleInit {
  private readonly logger = new Logger(PlanningMasterDataService.name);
  private personnelServicePools: PersonnelServicePool[] = [];
  private personnelPools: PersonnelPool[] = [];
  private personnels: Personnel[] = [];
  private personnelServices: PersonnelService[] = [];
  private vehicleServicePools: VehicleServicePool[] = [];
  private vehiclePools: VehiclePool[] = [];
  private vehicles: Vehicle[] = [];
  private vehicleServices: VehicleService[] = [];
  private vehicleTypes: VehicleType[] = [];
  private vehicleCompositions: VehicleComposition[] = [];
  private operationalPoints: OperationalPoint[] = [];
  private sectionsOfLine: SectionOfLine[] = [];
  private personnelSites: PersonnelSite[] = [];
  private replacementStops: ReplacementStop[] = [];
  private replacementRoutes: ReplacementRoute[] = [];
  private replacementEdges: ReplacementEdge[] = [];
  private opReplacementStopLinks: OpReplacementStopLink[] = [];
  private transferEdges: TransferEdge[] = [];

  private readonly usingDatabase: boolean;

  constructor(private readonly repository: PlanningRepository) {
    this.usingDatabase = this.repository.isEnabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    await this.initializeMasterDataFromDatabase();
  }

  listPersonnelServicePools(): PersonnelServicePoolListResponse {
    return this.personnelServicePools.map((pool) =>
      this.clonePersonnelServicePool(pool),
    );
  }

  async savePersonnelServicePools(
    request?: PersonnelServicePoolListRequest,
  ): Promise<PersonnelServicePoolListResponse> {
    const incoming = request?.items ?? [];
    this.personnelServicePools = incoming.map((pool) =>
      this.clonePersonnelServicePool(pool),
    );
    if (this.usingDatabase) {
      await this.repository.replacePersonnelServicePools(
        this.personnelServicePools,
      );
    }
    return this.listPersonnelServicePools();
  }

  listPersonnelPools(): PersonnelPoolListResponse {
    return this.personnelPools.map((pool) => this.clonePersonnelPool(pool));
  }

  async savePersonnelPools(
    request?: PersonnelPoolListRequest,
  ): Promise<PersonnelPoolListResponse> {
    const incoming = request?.items ?? [];
    this.personnelPools = incoming.map((pool) => this.clonePersonnelPool(pool));
    if (this.usingDatabase) {
      await this.repository.replacePersonnelPools(this.personnelPools);
    }
    return this.listPersonnelPools();
  }

  listVehicleServicePools(): VehicleServicePoolListResponse {
    return this.vehicleServicePools.map((pool) =>
      this.cloneVehicleServicePool(pool),
    );
  }

  async saveVehicleServicePools(
    request?: VehicleServicePoolListRequest,
  ): Promise<VehicleServicePoolListResponse> {
    const incoming = request?.items ?? [];
    this.vehicleServicePools = incoming.map((pool) =>
      this.cloneVehicleServicePool(pool),
    );
    if (this.usingDatabase) {
      await this.repository.replaceVehicleServicePools(this.vehicleServicePools);
    }
    return this.listVehicleServicePools();
  }

  listVehiclePools(): VehiclePoolListResponse {
    return this.vehiclePools.map((pool) => this.cloneVehiclePool(pool));
  }

  async saveVehiclePools(
    request?: VehiclePoolListRequest,
  ): Promise<VehiclePoolListResponse> {
    const incoming = request?.items ?? [];
    this.vehiclePools = incoming.map((pool) => this.cloneVehiclePool(pool));
    if (this.usingDatabase) {
      await this.repository.replaceVehiclePools(this.vehiclePools);
    }
    return this.listVehiclePools();
  }

  listVehicleTypes(): VehicleTypeListResponse {
    return this.vehicleTypes.map((type) => this.cloneVehicleType(type));
  }

  async saveVehicleTypes(
    request?: VehicleTypeListRequest,
  ): Promise<VehicleTypeListResponse> {
    const incoming = request?.items ?? [];
    this.vehicleTypes = incoming.map((type) => this.cloneVehicleType(type));
    if (this.usingDatabase) {
      await this.repository.replaceVehicleTypes(this.vehicleTypes);
    }
    return this.listVehicleTypes();
  }

  listVehicleCompositions(): VehicleCompositionListResponse {
    return this.vehicleCompositions.map((composition) =>
      this.cloneVehicleComposition(composition),
    );
  }

  async saveVehicleCompositions(
    request?: VehicleCompositionListRequest,
  ): Promise<VehicleCompositionListResponse> {
    const incoming = request?.items ?? [];
    this.vehicleCompositions = incoming.map((composition) =>
      this.cloneVehicleComposition(composition),
    );
    if (this.usingDatabase) {
      await this.repository.replaceVehicleCompositions(this.vehicleCompositions);
    }
    return this.listVehicleCompositions();
  }

  listOperationalPoints(): OperationalPointListResponse {
    return this.operationalPoints.map((point) => this.cloneOperationalPoint(point));
  }

  async saveOperationalPoints(
    request?: OperationalPointListRequest,
  ): Promise<OperationalPointListResponse> {
    const incoming = request?.items ?? [];
    this.operationalPoints = incoming.map((point) => this.cloneOperationalPoint(point));
    if (this.usingDatabase) {
      await this.repository.replaceOperationalPoints(this.operationalPoints);
    }
    return this.listOperationalPoints();
  }

  listSectionsOfLine(): SectionOfLineListResponse {
    return this.sectionsOfLine.map((section) => this.cloneSectionOfLine(section));
  }

  async saveSectionsOfLine(
    request?: SectionOfLineListRequest,
  ): Promise<SectionOfLineListResponse> {
    const incoming = request?.items ?? [];
    this.sectionsOfLine = incoming.map((section) => this.cloneSectionOfLine(section));
    if (this.usingDatabase) {
      await this.repository.replaceSectionsOfLine(this.sectionsOfLine);
    }
    return this.listSectionsOfLine();
  }

  listPersonnelSites(): PersonnelSiteListResponse {
    return this.personnelSites.map((site) => this.clonePersonnelSite(site));
  }

  async savePersonnelSites(
    request?: PersonnelSiteListRequest,
  ): Promise<PersonnelSiteListResponse> {
    const incoming = request?.items ?? [];
    this.personnelSites = incoming.map((site) => this.clonePersonnelSite(site));
    if (this.usingDatabase) {
      await this.repository.replacePersonnelSites(this.personnelSites);
    }
    return this.listPersonnelSites();
  }

  listReplacementStops(): ReplacementStopListResponse {
    return this.replacementStops.map((stop) => this.cloneReplacementStop(stop));
  }

  async saveReplacementStops(
    request?: ReplacementStopListRequest,
  ): Promise<ReplacementStopListResponse> {
    const incoming = request?.items ?? [];
    this.replacementStops = incoming.map((stop) => this.cloneReplacementStop(stop));
    if (this.usingDatabase) {
      await this.repository.replaceReplacementStops(this.replacementStops);
    }
    return this.listReplacementStops();
  }

  listReplacementRoutes(): ReplacementRouteListResponse {
    return this.replacementRoutes.map((route) => this.cloneReplacementRoute(route));
  }

  async saveReplacementRoutes(
    request?: ReplacementRouteListRequest,
  ): Promise<ReplacementRouteListResponse> {
    const incoming = request?.items ?? [];
    this.replacementRoutes = incoming.map((route) => this.cloneReplacementRoute(route));
    if (this.usingDatabase) {
      await this.repository.replaceReplacementRoutes(this.replacementRoutes);
    }
    return this.listReplacementRoutes();
  }

  listReplacementEdges(): ReplacementEdgeListResponse {
    return this.replacementEdges.map((edge) => this.cloneReplacementEdge(edge));
  }

  async saveReplacementEdges(
    request?: ReplacementEdgeListRequest,
  ): Promise<ReplacementEdgeListResponse> {
    const incoming = request?.items ?? [];
    this.replacementEdges = incoming.map((edge) => this.cloneReplacementEdge(edge));
    if (this.usingDatabase) {
      await this.repository.replaceReplacementEdges(this.replacementEdges);
    }
    return this.listReplacementEdges();
  }

  listOpReplacementStopLinks(): OpReplacementStopLinkListResponse {
    return this.opReplacementStopLinks.map((link) =>
      this.cloneOpReplacementStopLink(link),
    );
  }

  async saveOpReplacementStopLinks(
    request?: OpReplacementStopLinkListRequest,
  ): Promise<OpReplacementStopLinkListResponse> {
    const incoming = request?.items ?? [];
    this.opReplacementStopLinks = incoming.map((link) =>
      this.cloneOpReplacementStopLink(link),
    );
    if (this.usingDatabase) {
      await this.repository.replaceOpReplacementStopLinks(this.opReplacementStopLinks);
    }
    return this.listOpReplacementStopLinks();
  }

  listTransferEdges(): TransferEdgeListResponse {
    return this.transferEdges.map((edge) => this.cloneTransferEdge(edge));
  }

  async saveTransferEdges(
    request?: TransferEdgeListRequest,
  ): Promise<TransferEdgeListResponse> {
    const incoming = request?.items ?? [];
    this.transferEdges = incoming.map((edge) => this.cloneTransferEdge(edge));
    if (this.usingDatabase) {
      await this.repository.replaceTransferEdges(this.transferEdges);
    }
    return this.listTransferEdges();
  }

  getResourceSnapshot(): ResourceSnapshot {
    return {
      personnel: this.personnels.map((item) => this.clonePersonnel(item)),
      personnelServices: this.personnelServices.map((item) =>
        this.clonePersonnelService(item),
      ),
      personnelServicePools: this.listPersonnelServicePools(),
      personnelPools: this.listPersonnelPools(),
      vehicles: this.vehicles.map((item) => this.cloneVehicle(item)),
      vehicleServices: this.vehicleServices.map((item) =>
        this.cloneVehicleService(item),
      ),
      vehicleServicePools: this.listVehicleServicePools(),
      vehiclePools: this.listVehiclePools(),
      vehicleTypes: this.listVehicleTypes(),
      vehicleCompositions: this.listVehicleCompositions(),
    };
  }

  async replaceResourceSnapshot(
    snapshot?: ResourceSnapshot,
  ): Promise<ResourceSnapshot> {
    const nextPersonnel = snapshot?.personnel ?? [];
    const nextPersonnelServices = snapshot?.personnelServices ?? [];
    const nextPersonnelServicePools = snapshot?.personnelServicePools ?? [];
    const nextPersonnelPools = snapshot?.personnelPools ?? [];
    const nextVehicles = snapshot?.vehicles ?? [];
    const nextVehicleServices = snapshot?.vehicleServices ?? [];
    const nextVehicleServicePools = snapshot?.vehicleServicePools ?? [];
    const nextVehiclePools = snapshot?.vehiclePools ?? [];
    const nextVehicleTypes = snapshot?.vehicleTypes ?? [];
    const nextVehicleCompositions = snapshot?.vehicleCompositions ?? [];

    this.personnels = nextPersonnel.map((entry) => this.clonePersonnel(entry));
    this.personnelServices = nextPersonnelServices.map((entry) =>
      this.clonePersonnelService(entry),
    );
    this.personnelServicePools = nextPersonnelServicePools.map((pool) =>
      this.clonePersonnelServicePool(pool),
    );
    this.personnelPools = nextPersonnelPools.map((pool) =>
      this.clonePersonnelPool(pool),
    );
    this.vehicles = nextVehicles.map((entry) => this.cloneVehicle(entry));
    this.vehicleServices = nextVehicleServices.map((entry) =>
      this.cloneVehicleService(entry),
    );
    this.vehicleServicePools = nextVehicleServicePools.map((pool) =>
      this.cloneVehicleServicePool(pool),
    );
    this.vehiclePools = nextVehiclePools.map((pool) => this.cloneVehiclePool(pool));
    this.vehicleTypes = nextVehicleTypes.map((type) => this.cloneVehicleType(type));
    this.vehicleCompositions = nextVehicleCompositions.map((composition) =>
      this.cloneVehicleComposition(composition),
    );

    if (this.usingDatabase) {
      await Promise.all([
        this.repository.replacePersonnel(this.personnels),
        this.repository.replacePersonnelServices(this.personnelServices),
        this.repository.replacePersonnelServicePools(this.personnelServicePools),
        this.repository.replacePersonnelPools(this.personnelPools),
        this.repository.replaceVehicles(this.vehicles),
        this.repository.replaceVehicleServices(this.vehicleServices),
        this.repository.replaceVehicleServicePools(this.vehicleServicePools),
        this.repository.replaceVehiclePools(this.vehiclePools),
        this.repository.replaceVehicleTypes(this.vehicleTypes),
        this.repository.replaceVehicleCompositions(this.vehicleCompositions),
      ]);
    }

    return this.getResourceSnapshot();
  }

  private async initializeMasterDataFromDatabase(): Promise<void> {
    try {
      const masterData = await this.repository.loadMasterData();
      this.personnelServicePools = masterData.personnelServicePools.map((pool) =>
        this.clonePersonnelServicePool(pool),
      );
      this.personnelPools = masterData.personnelPools.map((pool) =>
        this.clonePersonnelPool(pool),
      );
      this.vehicleServicePools = masterData.vehicleServicePools.map((pool) =>
        this.cloneVehicleServicePool(pool),
      );
      this.vehiclePools = masterData.vehiclePools.map((pool) =>
        this.cloneVehiclePool(pool),
      );
      this.vehicleTypes = masterData.vehicleTypes.map((type) =>
        this.cloneVehicleType(type),
      );
      this.vehicleCompositions = masterData.vehicleCompositions.map((composition) =>
        this.cloneVehicleComposition(composition),
      );
      this.operationalPoints = masterData.operationalPoints.map((point) =>
        this.cloneOperationalPoint(point),
      );
      this.sectionsOfLine = masterData.sectionsOfLine.map((section) =>
        this.cloneSectionOfLine(section),
      );
      this.personnelSites = masterData.personnelSites.map((site) =>
        this.clonePersonnelSite(site),
      );
      this.replacementStops = masterData.replacementStops.map((stop) =>
        this.cloneReplacementStop(stop),
      );
      this.replacementRoutes = masterData.replacementRoutes.map((route) =>
        this.cloneReplacementRoute(route),
      );
      this.replacementEdges = masterData.replacementEdges.map((edge) =>
        this.cloneReplacementEdge(edge),
      );
      this.opReplacementStopLinks = masterData.opReplacementStopLinks.map((link) =>
        this.cloneOpReplacementStopLink(link),
      );
      this.transferEdges = masterData.transferEdges.map((edge) =>
        this.cloneTransferEdge(edge),
      );
      this.personnels = masterData.personnel.map((item) => this.clonePersonnel(item));
      this.personnelServices = masterData.personnelServices.map((item) =>
        this.clonePersonnelService(item),
      );
      this.vehicles = masterData.vehicles.map((item) => this.cloneVehicle(item));
      this.vehicleServices = masterData.vehicleServices.map((item) =>
        this.cloneVehicleService(item),
      );
    } catch (error) {
      this.logger.error(
        'Stammdaten konnten nicht aus der Datenbank geladen werden – verwende leere Sammlungen.',
        (error as Error).stack ?? String(error),
      );
      this.personnelServicePools = [];
      this.personnelPools = [];
      this.vehicleServicePools = [];
      this.vehiclePools = [];
      this.vehicleTypes = [];
      this.vehicleCompositions = [];
      this.operationalPoints = [];
      this.sectionsOfLine = [];
      this.personnelSites = [];
      this.replacementStops = [];
      this.replacementRoutes = [];
      this.replacementEdges = [];
      this.opReplacementStopLinks = [];
      this.transferEdges = [];
      this.personnels = [];
      this.personnelServices = [];
      this.vehicles = [];
      this.vehicleServices = [];
    }
  }

  private clonePersonnelServicePool(pool: PersonnelServicePool): PersonnelServicePool {
    return {
      ...pool,
      serviceIds: [...(pool.serviceIds ?? [])],
      attributes: pool.attributes ? { ...pool.attributes } : undefined,
    };
  }

  private clonePersonnel(entity: Personnel): Personnel {
    return {
      ...entity,
      attributes: entity.attributes ? { ...entity.attributes } : undefined,
    };
  }

  private clonePersonnelService(entity: PersonnelService): PersonnelService {
    return {
      ...entity,
      attributes: entity.attributes ? { ...entity.attributes } : undefined,
    };
  }

  private clonePersonnelPool(pool: PersonnelPool): PersonnelPool {
    return {
      ...pool,
      personnelIds: [...(pool.personnelIds ?? [])],
      attributes: pool.attributes ? { ...pool.attributes } : undefined,
    };
  }

  private cloneVehicleServicePool(pool: VehicleServicePool): VehicleServicePool {
    return {
      ...pool,
      serviceIds: [...(pool.serviceIds ?? [])],
      attributes: pool.attributes ? { ...pool.attributes } : undefined,
    };
  }

  private cloneVehicle(entity: Vehicle): Vehicle {
    return {
      ...entity,
      attributes: entity.attributes ? { ...entity.attributes } : undefined,
    };
  }

  private cloneVehicleService(entity: VehicleService): VehicleService {
    return {
      ...entity,
      attributes: entity.attributes ? { ...entity.attributes } : undefined,
    };
  }

  private cloneVehiclePool(pool: VehiclePool): VehiclePool {
    return {
      ...pool,
      vehicleIds: [...(pool.vehicleIds ?? [])],
      attributes: pool.attributes ? { ...pool.attributes } : undefined,
    };
  }

  private cloneVehicleType(type: VehicleType): VehicleType {
    return {
      ...type,
      powerSupplySystems: type.powerSupplySystems
        ? [...type.powerSupplySystems]
        : type.powerSupplySystems,
      trainProtectionSystems: type.trainProtectionSystems
        ? [...type.trainProtectionSystems]
        : type.trainProtectionSystems,
      attributes: type.attributes ? { ...type.attributes } : undefined,
    };
  }

  private cloneVehicleComposition(composition: VehicleComposition): VehicleComposition {
    return {
      ...composition,
      entries: (composition.entries ?? []).map((entry) => ({ ...entry })),
      attributes: composition.attributes ? { ...composition.attributes } : undefined,
    };
  }

  private cloneOperationalPoint(point: OperationalPoint): OperationalPoint {
    return {
      ...point,
      position: this.cloneLatLngOptional(point.position),
      attributes: this.cloneTopologyAttributes(point.attributes),
    };
  }

  private cloneSectionOfLine(section: SectionOfLine): SectionOfLine {
    return {
      ...section,
      polyline: section.polyline?.map((entry) => this.cloneLatLng(entry)),
      attributes: this.cloneTopologyAttributes(section.attributes),
    };
  }

  private clonePersonnelSite(site: PersonnelSite): PersonnelSite {
    return {
      ...site,
      position: this.cloneLatLng(site.position),
      attributes: this.cloneTopologyAttributes(site.attributes),
    };
  }

  private cloneReplacementStop(stop: ReplacementStop): ReplacementStop {
    return {
      ...stop,
      position: this.cloneLatLng(stop.position),
      attributes: this.cloneTopologyAttributes(stop.attributes),
    };
  }

  private cloneReplacementRoute(route: ReplacementRoute): ReplacementRoute {
    return {
      ...route,
      attributes: this.cloneTopologyAttributes(route.attributes),
    };
  }

  private cloneReplacementEdge(edge: ReplacementEdge): ReplacementEdge {
    return {
      ...edge,
      polyline: edge.polyline?.map((entry) => this.cloneLatLng(entry)),
      attributes: this.cloneTopologyAttributes(edge.attributes),
    };
  }

  private cloneOpReplacementStopLink(link: OpReplacementStopLink): OpReplacementStopLink {
    return {
      ...link,
      attributes: this.cloneTopologyAttributes(link.attributes),
    };
  }

  private cloneTransferEdge(edge: TransferEdge): TransferEdge {
    return {
      ...edge,
      from: this.cloneTransferNode(edge.from),
      to: this.cloneTransferNode(edge.to),
      attributes: this.cloneTopologyAttributes(edge.attributes),
    };
  }

  private cloneTransferNode(node: TransferNode): TransferNode {
    switch (node.kind) {
      case 'OP':
        return { kind: 'OP', uniqueOpId: node.uniqueOpId };
      case 'PERSONNEL_SITE':
        return { kind: 'PERSONNEL_SITE', siteId: node.siteId };
      case 'REPLACEMENT_STOP':
        return { kind: 'REPLACEMENT_STOP', replacementStopId: node.replacementStopId };
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
  }

  private cloneLatLng(value: LatLng): LatLng {
    return { lat: value.lat, lng: value.lng };
  }

  private cloneLatLngOptional(value?: LatLng | null): LatLng | undefined {
    return value ? this.cloneLatLng(value) : undefined;
  }

  private cloneTopologyAttributes(
    attributes?: TopologyAttribute[],
  ): TopologyAttribute[] | undefined {
    return attributes?.map((attribute) => ({ ...attribute }));
  }
}

