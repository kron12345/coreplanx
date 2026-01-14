import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type {
  HomeDepot,
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
import {
  SYSTEM_POOL_DESCRIPTIONS,
  SYSTEM_POOL_IDS,
  SYSTEM_POOL_LABELS,
} from './planning-master-data.constants';

interface MasterDataDefaultsFile {
  resources?: Partial<ResourceSnapshot>;
  topology?: Partial<{
    operationalPoints: OperationalPoint[];
    sectionsOfLine: SectionOfLine[];
    personnelSites: PersonnelSite[];
    replacementStops: ReplacementStop[];
    replacementRoutes: ReplacementRoute[];
    replacementEdges: ReplacementEdge[];
    opReplacementStopLinks: OpReplacementStopLink[];
    transferEdges: TransferEdge[];
  }>;
}

@Injectable()
export class PlanningMasterDataService implements OnModuleInit {
  private readonly logger = new Logger(PlanningMasterDataService.name);
  private personnelServicePools: PersonnelServicePool[] = [];
  private personnelPools: PersonnelPool[] = [];
  private homeDepots: HomeDepot[] = [];
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
  private defaultsLoaded = false;
  private loadedFromDatabase = false;
  private defaultResources: ResourceSnapshot | null = null;
  private defaultTopology: NonNullable<
    MasterDataDefaultsFile['topology']
  > | null = null;

  constructor(private readonly repository: PlanningRepository) {
    this.usingDatabase = this.repository.isEnabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.usingDatabase) {
      this.logger.warn(
        'Database is disabled; master data will be stored in memory only and reset on restart.',
      );
      return;
    }
    this.loadedFromDatabase = await this.initializeMasterDataFromDatabase();
    if (!this.loadedFromDatabase) {
      this.logger.warn(
        'Skipping default seeding because master data could not be loaded.',
      );
      return;
    }
    await this.seedDefaultsIfEmpty();
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
    this.personnelServicePools = this.ensureSystemPersonnelServicePools(
      incoming.map((pool) => this.clonePersonnelServicePool(pool)),
    );
    const normalized = this.normalizeState();
    await this.persistResourceSnapshot(normalized);
    return this.listPersonnelServicePools();
  }

  listPersonnelPools(): PersonnelPoolListResponse {
    return this.personnelPools.map((pool) => this.clonePersonnelPool(pool));
  }

  async savePersonnelPools(
    request?: PersonnelPoolListRequest,
  ): Promise<PersonnelPoolListResponse> {
    const incoming = request?.items ?? [];
    this.personnelPools = this.ensureSystemPersonnelPools(
      incoming.map((pool) => this.clonePersonnelPool(pool)),
    );
    const normalized = this.normalizeState();
    await this.persistResourceSnapshot(normalized);
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
    this.vehicleServicePools = this.ensureSystemVehicleServicePools(
      incoming.map((pool) => this.cloneVehicleServicePool(pool)),
    );
    const normalized = this.normalizeState();
    await this.persistResourceSnapshot(normalized);
    return this.listVehicleServicePools();
  }

  listVehiclePools(): VehiclePoolListResponse {
    return this.vehiclePools.map((pool) => this.cloneVehiclePool(pool));
  }

  async saveVehiclePools(
    request?: VehiclePoolListRequest,
  ): Promise<VehiclePoolListResponse> {
    const incoming = request?.items ?? [];
    this.vehiclePools = this.ensureSystemVehiclePools(
      incoming.map((pool) => this.cloneVehiclePool(pool)),
    );
    const normalized = this.normalizeState();
    await this.persistResourceSnapshot(normalized);
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
      await this.repository.replaceVehicleCompositions(
        this.vehicleCompositions,
      );
    }
    return this.listVehicleCompositions();
  }

  listOperationalPoints(): OperationalPointListResponse {
    return this.operationalPoints.map((point) =>
      this.cloneOperationalPoint(point),
    );
  }

  async saveOperationalPoints(
    request?: OperationalPointListRequest,
  ): Promise<OperationalPointListResponse> {
    const incoming = request?.items ?? [];
    this.operationalPoints = incoming.map((point) =>
      this.cloneOperationalPoint(point),
    );
    if (this.usingDatabase) {
      await this.repository.replaceOperationalPoints(this.operationalPoints);
    }
    return this.listOperationalPoints();
  }

  listSectionsOfLine(): SectionOfLineListResponse {
    return this.sectionsOfLine.map((section) =>
      this.cloneSectionOfLine(section),
    );
  }

  async saveSectionsOfLine(
    request?: SectionOfLineListRequest,
  ): Promise<SectionOfLineListResponse> {
    const incoming = request?.items ?? [];
    this.sectionsOfLine = incoming.map((section) =>
      this.cloneSectionOfLine(section),
    );
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
    this.replacementStops = incoming.map((stop) =>
      this.cloneReplacementStop(stop),
    );
    if (this.usingDatabase) {
      await this.repository.replaceReplacementStops(this.replacementStops);
    }
    return this.listReplacementStops();
  }

  listReplacementRoutes(): ReplacementRouteListResponse {
    return this.replacementRoutes.map((route) =>
      this.cloneReplacementRoute(route),
    );
  }

  async saveReplacementRoutes(
    request?: ReplacementRouteListRequest,
  ): Promise<ReplacementRouteListResponse> {
    const incoming = request?.items ?? [];
    this.replacementRoutes = incoming.map((route) =>
      this.cloneReplacementRoute(route),
    );
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
    this.replacementEdges = incoming.map((edge) =>
      this.cloneReplacementEdge(edge),
    );
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
      await this.repository.replaceOpReplacementStopLinks(
        this.opReplacementStopLinks,
      );
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
      homeDepots: this.homeDepots.map((item) => this.cloneHomeDepot(item)),
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
    const nextSnapshot: ResourceSnapshot = {
      personnel: snapshot?.personnel ?? [],
      personnelServices: snapshot?.personnelServices ?? [],
      personnelServicePools: snapshot?.personnelServicePools ?? [],
      personnelPools: snapshot?.personnelPools ?? [],
      homeDepots: snapshot?.homeDepots ?? [],
      vehicles: snapshot?.vehicles ?? [],
      vehicleServices: snapshot?.vehicleServices ?? [],
      vehicleServicePools: snapshot?.vehicleServicePools ?? [],
      vehiclePools: snapshot?.vehiclePools ?? [],
      vehicleTypes: snapshot?.vehicleTypes ?? [],
      vehicleCompositions: snapshot?.vehicleCompositions ?? [],
    };

    const normalized = this.normalizeResourceSnapshot(nextSnapshot);
    this.applySnapshotToState(normalized);

    await this.persistResourceSnapshot(normalized);

    return this.getResourceSnapshot();
  }

  async resetResourcesToDefaults(): Promise<ResourceSnapshot> {
    const defaults = this.getDefaults();
    if (!defaults) {
      throw new Error('Master data defaults not configured');
    }
    await this.replaceResourceSnapshot(defaults.resources);
    return this.getResourceSnapshot();
  }

  async resetPersonnelToDefaults(): Promise<ResourceSnapshot> {
    const defaults = this.getDefaults();
    if (!defaults) {
      throw new Error('Master data defaults not configured');
    }
    const current = this.getResourceSnapshot();
    await this.replaceResourceSnapshot({
      ...current,
      personnelServicePools: defaults.resources.personnelServicePools,
      personnelPools: defaults.resources.personnelPools,
      homeDepots: defaults.resources.homeDepots,
      personnelServices: defaults.resources.personnelServices,
      personnel: defaults.resources.personnel,
    });
    return this.getResourceSnapshot();
  }

  async resetVehiclesToDefaults(): Promise<ResourceSnapshot> {
    const defaults = this.getDefaults();
    if (!defaults) {
      throw new Error('Master data defaults not configured');
    }
    const current = this.getResourceSnapshot();
    await this.replaceResourceSnapshot({
      ...current,
      vehicleServicePools: defaults.resources.vehicleServicePools,
      vehiclePools: defaults.resources.vehiclePools,
      vehicleServices: defaults.resources.vehicleServices,
      vehicles: defaults.resources.vehicles,
      vehicleTypes: defaults.resources.vehicleTypes,
      vehicleCompositions: defaults.resources.vehicleCompositions,
    });
    return this.getResourceSnapshot();
  }

  async resetTopologyToDefaults(): Promise<void> {
    const defaults = this.getDefaults();
    if (!defaults) {
      throw new Error('Topology defaults not configured');
    }
    const topology = defaults.topology;

    this.operationalPoints = (topology.operationalPoints ?? []).map((item) =>
      this.cloneOperationalPoint(item),
    );
    this.sectionsOfLine = (topology.sectionsOfLine ?? []).map((item) =>
      this.cloneSectionOfLine(item),
    );
    this.personnelSites = (topology.personnelSites ?? []).map((item) =>
      this.clonePersonnelSite(item),
    );
    this.replacementStops = (topology.replacementStops ?? []).map((item) =>
      this.cloneReplacementStop(item),
    );
    this.replacementRoutes = (topology.replacementRoutes ?? []).map((item) =>
      this.cloneReplacementRoute(item),
    );
    this.replacementEdges = (topology.replacementEdges ?? []).map((item) =>
      this.cloneReplacementEdge(item),
    );
    this.opReplacementStopLinks = (topology.opReplacementStopLinks ?? []).map(
      (item) => this.cloneOpReplacementStopLink(item),
    );
    this.transferEdges = (topology.transferEdges ?? []).map((item) =>
      this.cloneTransferEdge(item),
    );

    if (this.usingDatabase) {
      await Promise.all([
        this.repository.replaceOperationalPoints(this.operationalPoints),
        this.repository.replaceSectionsOfLine(this.sectionsOfLine),
        this.repository.replacePersonnelSites(this.personnelSites),
        this.repository.replaceReplacementStops(this.replacementStops),
        this.repository.replaceReplacementRoutes(this.replacementRoutes),
        this.repository.replaceReplacementEdges(this.replacementEdges),
        this.repository.replaceOpReplacementStopLinks(
          this.opReplacementStopLinks,
        ),
        this.repository.replaceTransferEdges(this.transferEdges),
      ]);
    }
  }

  private getDefaults(): {
    resources: ResourceSnapshot;
    topology: NonNullable<MasterDataDefaultsFile['topology']>;
  } | null {
    this.loadDefaultsOnce();
    if (!this.defaultResources || !this.defaultTopology) {
      return null;
    }
    return { resources: this.defaultResources, topology: this.defaultTopology };
  }

  private loadDefaultsOnce(): void {
    if (this.defaultsLoaded) {
      return;
    }
    this.defaultsLoaded = true;

    const defaultsLocation = this.resolveDefaultsLocation();
    if (!defaultsLocation) {
      this.logger.warn('Master data defaults not found; skipping seeding.');
      return;
    }
    const doc = this.loadDefaultsDocument(defaultsLocation);
    if (!doc) {
      return;
    }
    this.defaultResources = {
      personnel: doc.resources?.personnel ?? [],
      personnelServices: doc.resources?.personnelServices ?? [],
      personnelServicePools: doc.resources?.personnelServicePools ?? [],
      personnelPools: doc.resources?.personnelPools ?? [],
      homeDepots: doc.resources?.homeDepots ?? [],
      vehicles: doc.resources?.vehicles ?? [],
      vehicleServices: doc.resources?.vehicleServices ?? [],
      vehicleServicePools: doc.resources?.vehicleServicePools ?? [],
      vehiclePools: doc.resources?.vehiclePools ?? [],
      vehicleTypes: doc.resources?.vehicleTypes ?? [],
      vehicleCompositions: doc.resources?.vehicleCompositions ?? [],
    };

    this.defaultTopology = {
      operationalPoints: doc.topology?.operationalPoints ?? [],
      sectionsOfLine: doc.topology?.sectionsOfLine ?? [],
      personnelSites: doc.topology?.personnelSites ?? [],
      replacementStops: doc.topology?.replacementStops ?? [],
      replacementRoutes: doc.topology?.replacementRoutes ?? [],
      replacementEdges: doc.topology?.replacementEdges ?? [],
      opReplacementStopLinks: doc.topology?.opReplacementStopLinks ?? [],
      transferEdges: doc.topology?.transferEdges ?? [],
    };
  }

  private loadDefaultsDocument(
    location: string,
  ): MasterDataDefaultsFile | null {
    let stat: ReturnType<typeof statSync> | null = null;
    try {
      stat = statSync(location);
    } catch {
      stat = null;
    }
    if (stat?.isDirectory()) {
      return this.loadDefaultsFromDirectory(location);
    }
    return this.loadDefaultsFromFile(location);
  }

  private loadDefaultsFromFile(path: string): MasterDataDefaultsFile | null {
    const raw = readFileSync(path, 'utf-8');
    try {
      return (yaml.load(raw) ?? {}) as MasterDataDefaultsFile;
    } catch (error) {
      this.logger.error(
        `Failed to parse master data defaults file ${path}`,
        (error as Error).stack ?? String(error),
      );
      return null;
    }
  }

  private loadDefaultsFromDirectory(
    dir: string,
  ): MasterDataDefaultsFile | null {
    let files: string[] = [];
    try {
      files = readdirSync(dir)
        .filter(
          (entry) =>
            entry.endsWith('.yaml') ||
            entry.endsWith('.yml') ||
            entry.endsWith('.json'),
        )
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      this.logger.error(
        `Failed to read master data defaults directory ${dir}`,
        (error as Error).stack ?? String(error),
      );
      return null;
    }
    const merged: MasterDataDefaultsFile = {};
    for (const filename of files) {
      const fullPath = join(dir, filename);
      let raw: string;
      try {
        raw = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }
      const format = filename.endsWith('.json') ? 'json' : 'yaml';
      let parsed: any;
      try {
        parsed = format === 'json' ? JSON.parse(raw) : yaml.load(raw);
      } catch (error) {
        this.logger.error(
          `Failed to parse master data defaults file ${fullPath}`,
          (error as Error).stack ?? String(error),
        );
        continue;
      }
      this.deepMergeDefaults(merged, (parsed ?? {}) as MasterDataDefaultsFile);
    }
    return merged;
  }

  private deepMergeDefaults(target: any, source: any): any {
    if (!source || typeof source !== 'object') {
      return target;
    }
    if (!target || typeof target !== 'object') {
      return source;
    }
    if (Array.isArray(target) && Array.isArray(source)) {
      target.push(...source);
      return target;
    }
    if (Array.isArray(target) || Array.isArray(source)) {
      return source;
    }
    Object.entries(source).forEach(([key, value]) => {
      if (!(key in target)) {
        target[key] = value;
        return;
      }
      const current = target[key];
      if (Array.isArray(current) && Array.isArray(value)) {
        target[key] = [...current, ...value];
        return;
      }
      if (
        current &&
        value &&
        typeof current === 'object' &&
        typeof value === 'object' &&
        !Array.isArray(current) &&
        !Array.isArray(value)
      ) {
        target[key] = this.deepMergeDefaults({ ...current }, value);
        return;
      }
      target[key] = value;
    });
    return target;
  }

  private resolveDefaultsLocation(): string | null {
    const candidates = [
      join(process.cwd(), 'catalog', 'master-data', 'defaults'),
      join(process.cwd(), 'backend', 'catalog', 'master-data', 'defaults'),
      join(__dirname, '..', '..', '..', 'catalog', 'master-data', 'defaults'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'backend',
        'catalog',
        'master-data',
        'defaults',
      ),
      join(process.cwd(), 'catalog', 'master-data', 'defaults.yaml'),
      join(process.cwd(), 'backend', 'catalog', 'master-data', 'defaults.yaml'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'catalog',
        'master-data',
        'defaults.yaml',
      ),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'backend',
        'catalog',
        'master-data',
        'defaults.yaml',
      ),
    ];
    for (const candidate of candidates) {
      try {
        const stat = statSync(candidate);
        if (stat.isDirectory()) {
          const entries = readdirSync(candidate).filter(
            (entry) =>
              entry.endsWith('.yaml') ||
              entry.endsWith('.yml') ||
              entry.endsWith('.json'),
          );
          if (entries.length) {
            return candidate;
          }
          continue;
        }
        if (stat.isFile()) {
          readFileSync(candidate, 'utf-8');
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  private async seedDefaultsIfEmpty(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    const hasAny =
      this.personnelServicePools.length > 0 ||
      this.personnelPools.length > 0 ||
      this.homeDepots.length > 0 ||
      this.personnels.length > 0 ||
      this.personnelServices.length > 0 ||
      this.vehicleServicePools.length > 0 ||
      this.vehiclePools.length > 0 ||
      this.vehicles.length > 0 ||
      this.vehicleServices.length > 0 ||
      this.vehicleTypes.length > 0 ||
      this.vehicleCompositions.length > 0 ||
      this.operationalPoints.length > 0 ||
      this.sectionsOfLine.length > 0 ||
      this.personnelSites.length > 0 ||
      this.replacementStops.length > 0 ||
      this.replacementRoutes.length > 0 ||
      this.replacementEdges.length > 0 ||
      this.opReplacementStopLinks.length > 0 ||
      this.transferEdges.length > 0;
    if (hasAny) {
      return;
    }

    const defaults = this.getDefaults();
    if (!defaults) {
      return;
    }
    await this.replaceResourceSnapshot(defaults.resources);
    await this.resetTopologyToDefaults();
    this.logger.log('Seeded master data & topology with factory defaults.');
  }

  normalizeResourceSnapshot(snapshot: ResourceSnapshot): ResourceSnapshot {
    const cloned = this.cloneResourceSnapshot(snapshot);
    const withSystemPools = this.ensureSystemPoolsInSnapshot(cloned);
    const withAssignments = this.assignMissingPoolIds(withSystemPools);
    return this.rebuildPoolMembership(withAssignments);
  }

  private normalizeState(): ResourceSnapshot {
    const normalized = this.normalizeResourceSnapshot(
      this.getResourceSnapshot(),
    );
    this.applySnapshotToState(normalized);
    return normalized;
  }

  private applySnapshotToState(snapshot: ResourceSnapshot): void {
    this.personnels = snapshot.personnel.map((entry) =>
      this.clonePersonnel(entry),
    );
    this.personnelServices = snapshot.personnelServices.map((entry) =>
      this.clonePersonnelService(entry),
    );
    this.personnelServicePools = snapshot.personnelServicePools.map((pool) =>
      this.clonePersonnelServicePool(pool),
    );
    this.personnelPools = snapshot.personnelPools.map((pool) =>
      this.clonePersonnelPool(pool),
    );
    this.homeDepots = snapshot.homeDepots.map((item) =>
      this.cloneHomeDepot(item),
    );
    this.vehicles = snapshot.vehicles.map((entry) => this.cloneVehicle(entry));
    this.vehicleServices = snapshot.vehicleServices.map((entry) =>
      this.cloneVehicleService(entry),
    );
    this.vehicleServicePools = snapshot.vehicleServicePools.map((pool) =>
      this.cloneVehicleServicePool(pool),
    );
    this.vehiclePools = snapshot.vehiclePools.map((pool) =>
      this.cloneVehiclePool(pool),
    );
    this.vehicleTypes = snapshot.vehicleTypes.map((type) =>
      this.cloneVehicleType(type),
    );
    this.vehicleCompositions = snapshot.vehicleCompositions.map((composition) =>
      this.cloneVehicleComposition(composition),
    );
  }

  private cloneResourceSnapshot(snapshot: ResourceSnapshot): ResourceSnapshot {
    return {
      personnel: (snapshot.personnel ?? []).map((entry) =>
        this.clonePersonnel(entry),
      ),
      personnelServices: (snapshot.personnelServices ?? []).map((entry) =>
        this.clonePersonnelService(entry),
      ),
      personnelServicePools: (snapshot.personnelServicePools ?? []).map(
        (pool) => this.clonePersonnelServicePool(pool),
      ),
      personnelPools: (snapshot.personnelPools ?? []).map((pool) =>
        this.clonePersonnelPool(pool),
      ),
      homeDepots: (snapshot.homeDepots ?? []).map((item) =>
        this.cloneHomeDepot(item),
      ),
      vehicles: (snapshot.vehicles ?? []).map((entry) =>
        this.cloneVehicle(entry),
      ),
      vehicleServices: (snapshot.vehicleServices ?? []).map((entry) =>
        this.cloneVehicleService(entry),
      ),
      vehicleServicePools: (snapshot.vehicleServicePools ?? []).map((pool) =>
        this.cloneVehicleServicePool(pool),
      ),
      vehiclePools: (snapshot.vehiclePools ?? []).map((pool) =>
        this.cloneVehiclePool(pool),
      ),
      vehicleTypes: (snapshot.vehicleTypes ?? []).map((type) =>
        this.cloneVehicleType(type),
      ),
      vehicleCompositions: (snapshot.vehicleCompositions ?? []).map(
        (composition) => this.cloneVehicleComposition(composition),
      ),
    };
  }

  private ensureSystemPoolsInSnapshot(
    snapshot: ResourceSnapshot,
  ): ResourceSnapshot {
    return {
      ...snapshot,
      personnelServicePools: this.ensureSystemPersonnelServicePools(
        snapshot.personnelServicePools,
      ),
      personnelPools: this.ensureSystemPersonnelPools(snapshot.personnelPools),
      vehicleServicePools: this.ensureSystemVehicleServicePools(
        snapshot.vehicleServicePools,
      ),
      vehiclePools: this.ensureSystemVehiclePools(snapshot.vehiclePools),
    };
  }

  private ensureSystemPersonnelServicePools(
    pools: PersonnelServicePool[],
  ): PersonnelServicePool[] {
    const systemId = SYSTEM_POOL_IDS.personnelServicePool;
    const existing = pools.find((pool) => pool.id === systemId);
    const systemPool: PersonnelServicePool = {
      id: systemId,
      name: SYSTEM_POOL_LABELS.personnelServicePool,
      description: SYSTEM_POOL_DESCRIPTIONS.personnelServicePool,
      serviceIds: existing?.serviceIds ?? [],
      homeDepotId: existing?.homeDepotId ?? undefined,
      shiftCoordinator: existing?.shiftCoordinator ?? undefined,
      contactEmail: existing?.contactEmail ?? undefined,
      attributes: this.mergeSystemAttributes(existing?.attributes),
    };
    if (existing) {
      return pools.map((pool) => (pool.id === systemId ? systemPool : pool));
    }
    return [...pools, systemPool];
  }

  private ensureSystemPersonnelPools(pools: PersonnelPool[]): PersonnelPool[] {
    const systemId = SYSTEM_POOL_IDS.personnelPool;
    const existing = pools.find((pool) => pool.id === systemId);
    const systemPool: PersonnelPool = {
      id: systemId,
      name: SYSTEM_POOL_LABELS.personnelPool,
      description: SYSTEM_POOL_DESCRIPTIONS.personnelPool,
      personnelIds: existing?.personnelIds ?? [],
      homeDepotId: existing?.homeDepotId ?? undefined,
      locationCode: existing?.locationCode ?? undefined,
      attributes: this.mergeSystemAttributes(existing?.attributes),
    };
    if (existing) {
      return pools.map((pool) => (pool.id === systemId ? systemPool : pool));
    }
    return [...pools, systemPool];
  }

  private ensureSystemVehicleServicePools(
    pools: VehicleServicePool[],
  ): VehicleServicePool[] {
    const systemId = SYSTEM_POOL_IDS.vehicleServicePool;
    const existing = pools.find((pool) => pool.id === systemId);
    const systemPool: VehicleServicePool = {
      id: systemId,
      name: SYSTEM_POOL_LABELS.vehicleServicePool,
      description: SYSTEM_POOL_DESCRIPTIONS.vehicleServicePool,
      serviceIds: existing?.serviceIds ?? [],
      dispatcher: existing?.dispatcher ?? undefined,
      attributes: this.mergeSystemAttributes(existing?.attributes),
    };
    if (existing) {
      return pools.map((pool) => (pool.id === systemId ? systemPool : pool));
    }
    return [...pools, systemPool];
  }

  private ensureSystemVehiclePools(pools: VehiclePool[]): VehiclePool[] {
    const systemId = SYSTEM_POOL_IDS.vehiclePool;
    const existing = pools.find((pool) => pool.id === systemId);
    const systemPool: VehiclePool = {
      id: systemId,
      name: SYSTEM_POOL_LABELS.vehiclePool,
      description: SYSTEM_POOL_DESCRIPTIONS.vehiclePool,
      vehicleIds: existing?.vehicleIds ?? [],
      depotManager: existing?.depotManager ?? undefined,
      attributes: this.mergeSystemAttributes(existing?.attributes),
    };
    if (existing) {
      return pools.map((pool) => (pool.id === systemId ? systemPool : pool));
    }
    return [...pools, systemPool];
  }

  private mergeSystemAttributes(
    attributes?: Record<string, unknown>,
  ): Record<string, unknown> {
    return { ...(attributes ?? {}), systemPool: true };
  }

  private assignMissingPoolIds(snapshot: ResourceSnapshot): ResourceSnapshot {
    const servicePoolIds = new Set(
      snapshot.personnelServicePools.map((pool) => pool.id),
    );
    const personnelPoolIds = new Set(
      snapshot.personnelPools.map((pool) => pool.id),
    );
    const vehicleServicePoolIds = new Set(
      snapshot.vehicleServicePools.map((pool) => pool.id),
    );
    const vehiclePoolIds = new Set(
      snapshot.vehiclePools.map((pool) => pool.id),
    );
    const personnelServicePoolByService = new Map<string, string>();
    snapshot.personnelServicePools.forEach((pool) => {
      (pool.serviceIds ?? []).forEach((serviceId) => {
        if (!personnelServicePoolByService.has(serviceId)) {
          personnelServicePoolByService.set(serviceId, pool.id);
        }
      });
    });
    const vehicleServicePoolByService = new Map<string, string>();
    snapshot.vehicleServicePools.forEach((pool) => {
      (pool.serviceIds ?? []).forEach((serviceId) => {
        if (!vehicleServicePoolByService.has(serviceId)) {
          vehicleServicePoolByService.set(serviceId, pool.id);
        }
      });
    });
    const personnelPoolByPerson = new Map<string, string>();
    snapshot.personnelPools.forEach((pool) => {
      (pool.personnelIds ?? []).forEach((personId) => {
        if (!personnelPoolByPerson.has(personId)) {
          personnelPoolByPerson.set(personId, pool.id);
        }
      });
    });
    const vehiclePoolByVehicle = new Map<string, string>();
    snapshot.vehiclePools.forEach((pool) => {
      (pool.vehicleIds ?? []).forEach((vehicleId) => {
        if (!vehiclePoolByVehicle.has(vehicleId)) {
          vehiclePoolByVehicle.set(vehicleId, pool.id);
        }
      });
    });

    const personnelServices = snapshot.personnelServices.map((service) => {
      const poolId = this.normalizePoolId(service.poolId);
      const mapped = personnelServicePoolByService.get(service.id);
      const resolved =
        poolId && servicePoolIds.has(poolId)
          ? poolId
          : mapped && servicePoolIds.has(mapped)
            ? mapped
            : SYSTEM_POOL_IDS.personnelServicePool;
      return { ...service, poolId: resolved };
    });

    const personnel = snapshot.personnel.map((person) => {
      const poolId = this.normalizePoolId(person.poolId);
      const mapped = personnelPoolByPerson.get(person.id);
      const resolved = poolId
        ? personnelPoolIds.has(poolId)
          ? poolId
          : mapped && personnelPoolIds.has(mapped)
            ? mapped
            : SYSTEM_POOL_IDS.personnelPool
        : mapped && personnelPoolIds.has(mapped)
          ? mapped
          : undefined;
      return { ...person, poolId: resolved };
    });

    const vehicleServices = snapshot.vehicleServices.map((service) => {
      const poolId = this.normalizePoolId(service.poolId);
      const mapped = vehicleServicePoolByService.get(service.id);
      const resolved =
        poolId && vehicleServicePoolIds.has(poolId)
          ? poolId
          : mapped && vehicleServicePoolIds.has(mapped)
            ? mapped
            : SYSTEM_POOL_IDS.vehicleServicePool;
      return { ...service, poolId: resolved };
    });

    const vehicles = snapshot.vehicles.map((vehicle) => {
      const poolId = this.normalizePoolId(vehicle.poolId);
      const mapped = vehiclePoolByVehicle.get(vehicle.id);
      const resolved = poolId
        ? vehiclePoolIds.has(poolId)
          ? poolId
          : mapped && vehiclePoolIds.has(mapped)
            ? mapped
            : SYSTEM_POOL_IDS.vehiclePool
        : mapped && vehiclePoolIds.has(mapped)
          ? mapped
          : undefined;
      return { ...vehicle, poolId: resolved };
    });

    return {
      ...snapshot,
      personnelServices,
      personnel,
      vehicleServices,
      vehicles,
    };
  }

  private normalizePoolId(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  private rebuildPoolMembership(snapshot: ResourceSnapshot): ResourceSnapshot {
    const serviceIdsByPool = new Map<string, string[]>();
    snapshot.personnelServices.forEach((service) => {
      if (!service.poolId) {
        return;
      }
      const list = serviceIdsByPool.get(service.poolId) ?? [];
      if (!list.includes(service.id)) {
        list.push(service.id);
      }
      serviceIdsByPool.set(service.poolId, list);
    });

    const personnelIdsByPool = new Map<string, string[]>();
    snapshot.personnel.forEach((person) => {
      if (!person.poolId) {
        return;
      }
      const list = personnelIdsByPool.get(person.poolId) ?? [];
      if (!list.includes(person.id)) {
        list.push(person.id);
      }
      personnelIdsByPool.set(person.poolId, list);
    });

    const vehicleServiceIdsByPool = new Map<string, string[]>();
    snapshot.vehicleServices.forEach((service) => {
      if (!service.poolId) {
        return;
      }
      const list = vehicleServiceIdsByPool.get(service.poolId) ?? [];
      if (!list.includes(service.id)) {
        list.push(service.id);
      }
      vehicleServiceIdsByPool.set(service.poolId, list);
    });

    const vehicleIdsByPool = new Map<string, string[]>();
    snapshot.vehicles.forEach((vehicle) => {
      if (!vehicle.poolId) {
        return;
      }
      const list = vehicleIdsByPool.get(vehicle.poolId) ?? [];
      if (!list.includes(vehicle.id)) {
        list.push(vehicle.id);
      }
      vehicleIdsByPool.set(vehicle.poolId, list);
    });

    return {
      ...snapshot,
      personnelServicePools: snapshot.personnelServicePools.map((pool) => ({
        ...pool,
        serviceIds: serviceIdsByPool.get(pool.id) ?? [],
      })),
      personnelPools: snapshot.personnelPools.map((pool) => ({
        ...pool,
        personnelIds: personnelIdsByPool.get(pool.id) ?? [],
      })),
      vehicleServicePools: snapshot.vehicleServicePools.map((pool) => ({
        ...pool,
        serviceIds: vehicleServiceIdsByPool.get(pool.id) ?? [],
      })),
      vehiclePools: snapshot.vehiclePools.map((pool) => ({
        ...pool,
        vehicleIds: vehicleIdsByPool.get(pool.id) ?? [],
      })),
    };
  }

  private prepareSnapshotForPersistence(
    snapshot: ResourceSnapshot,
  ): ResourceSnapshot {
    const reconciled = this.rebuildPoolMembership(snapshot);
    return {
      ...reconciled,
      personnel: reconciled.personnel.map((p) =>
        this.preparePersonnelForPersistence(p),
      ),
      vehicles: reconciled.vehicles.map((v) =>
        this.prepareVehicleForPersistence(v),
      ),
      personnelServices: reconciled.personnelServices.map((s) =>
        this.prepareServiceForPersistence(s),
      ),
      vehicleServices: reconciled.vehicleServices.map((s) =>
        this.prepareServiceForPersistence(s),
      ),
      personnelServicePools: reconciled.personnelServicePools.map((p) =>
        this.preparePoolForPersistence(p),
      ),
      personnelPools: reconciled.personnelPools.map((p) =>
        this.preparePoolForPersistence(p),
      ),
      homeDepots: reconciled.homeDepots.map((d) => this.cloneHomeDepot(d)),
      vehicleServicePools: reconciled.vehicleServicePools.map((p) =>
        this.preparePoolForPersistence(p),
      ),
      vehiclePools: reconciled.vehiclePools.map((p) =>
        this.preparePoolForPersistence(p),
      ),
      vehicleTypes: reconciled.vehicleTypes.map((t) =>
        this.cloneVehicleType(t),
      ),
      vehicleCompositions: reconciled.vehicleCompositions.map((c) =>
        this.cloneVehicleComposition(c),
      ),
    };
  }

  private async persistResourceSnapshot(
    snapshot: ResourceSnapshot,
  ): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    const persisted = this.prepareSnapshotForPersistence(snapshot);
    await Promise.all([
      this.repository.replacePersonnel(persisted.personnel),
      this.repository.replacePersonnelServices(persisted.personnelServices),
      this.repository.replacePersonnelServicePools(
        persisted.personnelServicePools,
      ),
      this.repository.replacePersonnelPools(persisted.personnelPools),
      this.repository.replaceHomeDepots(persisted.homeDepots),
      this.repository.replaceVehicles(persisted.vehicles),
      this.repository.replaceVehicleServices(persisted.vehicleServices),
      this.repository.replaceVehicleServicePools(persisted.vehicleServicePools),
      this.repository.replaceVehiclePools(persisted.vehiclePools),
      this.repository.replaceVehicleTypes(persisted.vehicleTypes),
      this.repository.replaceVehicleCompositions(persisted.vehicleCompositions),
    ]);
  }

  private preparePersonnelForPersistence(person: Personnel): Personnel {
    const record = person as unknown as Record<string, unknown>;
    const id = String(record['id'] ?? '').trim();
    const nameRaw =
      typeof record['name'] === 'string' ? record['name'].trim() : '';
    const derived = nameRaw || this.derivePersonnelName(record) || id;
    const externalRef =
      typeof record['externalRef'] === 'string'
        ? record['externalRef']
        : undefined;
    const homeBase =
      typeof record['homeBase'] === 'string' ? record['homeBase'] : undefined;
    const attributes = this.mergeAttributes(record, [
      'id',
      'name',
      'externalRef',
      'homeBase',
    ]);
    return {
      ...(person as any),
      id,
      name: derived,
      externalRef,
      homeBase,
      attributes,
    };
  }

  private prepareVehicleForPersistence(vehicle: Vehicle): Vehicle {
    const record = vehicle as unknown as Record<string, unknown>;
    const id = String(record['id'] ?? '').trim();
    const nameRaw =
      typeof record['name'] === 'string' ? record['name'].trim() : '';
    const vehicleNumber =
      typeof record['vehicleNumber'] === 'string'
        ? record['vehicleNumber'].trim()
        : '';
    const derived = nameRaw || vehicleNumber || id;
    const externalRef =
      typeof record['externalRef'] === 'string'
        ? record['externalRef']
        : undefined;
    const homeDepot =
      typeof record['homeDepot'] === 'string'
        ? record['homeDepot']
        : typeof record['depot'] === 'string'
          ? record['depot']
          : undefined;
    const typeId =
      typeof record['typeId'] === 'string' ? record['typeId'] : undefined;
    const attributes = this.mergeAttributes(record, [
      'id',
      'name',
      'typeId',
      'externalRef',
      'homeDepot',
    ]);
    return {
      ...(vehicle as any),
      id,
      name: derived,
      typeId,
      externalRef,
      homeDepot,
      attributes,
    };
  }

  private prepareServiceForPersistence(
    service: PersonnelService | VehicleService,
  ): any {
    const record = service as unknown as Record<string, unknown>;
    const id = String(record['id'] ?? '').trim();
    const name =
      typeof record['name'] === 'string' ? record['name'].trim() : id;
    const poolId =
      typeof record['poolId'] === 'string' ? record['poolId'] : undefined;
    const attributes = this.mergeAttributes(record, ['id', 'name', 'poolId']);
    return {
      ...(service as any),
      id,
      name,
      poolId,
      attributes,
    };
  }

  private preparePoolForPersistence(pool: any): any {
    const record = pool as unknown as Record<string, unknown>;
    const id = String(record['id'] ?? '').trim();
    const name =
      typeof record['name'] === 'string' ? record['name'].trim() : id;
    const description =
      typeof record['description'] === 'string'
        ? record['description']
        : undefined;
    const attributes = this.mergeAttributes(record, [
      'id',
      'name',
      'description',
    ]);
    return {
      ...pool,
      id,
      name,
      description,
      attributes,
    };
  }

  private mergeAttributes(
    record: Record<string, unknown>,
    excludeKeys: string[],
  ): Record<string, unknown> {
    const existing = record['attributes'];
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    Object.entries(record).forEach(([key, value]) => {
      if (key === 'attributes' || excludeKeys.includes(key)) {
        return;
      }
      if (value === undefined) {
        return;
      }
      base[key] = value;
    });
    return base;
  }

  private derivePersonnelName(record: Record<string, unknown>): string {
    const first = this.resolveTemporalText(record['firstName']);
    const last =
      typeof record['lastName'] === 'string' ? record['lastName'].trim() : '';
    const preferred = this.resolveTemporalText(record['preferredName']);
    const candidate = [first, last].filter(Boolean).join(' ').trim();
    if (preferred && candidate) {
      return `${preferred} (${candidate})`;
    }
    return preferred || candidate;
  }

  private resolveTemporalText(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (Array.isArray(value) && value.length) {
      const first = value[0];
      const candidate = typeof first?.value === 'string' ? first.value : '';
      return candidate.trim();
    }
    return '';
  }

  private async initializeMasterDataFromDatabase(): Promise<boolean> {
    try {
      const masterData = await this.repository.loadMasterData();
      this.personnelServicePools = masterData.personnelServicePools.map(
        (pool) => this.clonePersonnelServicePool(pool),
      );
      this.personnelPools = masterData.personnelPools.map((pool) =>
        this.clonePersonnelPool(pool),
      );
      this.homeDepots = masterData.homeDepots.map((item) =>
        this.cloneHomeDepot(item),
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
      this.vehicleCompositions = masterData.vehicleCompositions.map(
        (composition) => this.cloneVehicleComposition(composition),
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
      this.opReplacementStopLinks = masterData.opReplacementStopLinks.map(
        (link) => this.cloneOpReplacementStopLink(link),
      );
      this.transferEdges = masterData.transferEdges.map((edge) =>
        this.cloneTransferEdge(edge),
      );
      this.personnels = masterData.personnel.map((item) =>
        this.clonePersonnel(item),
      );
      this.personnelServices = masterData.personnelServices.map((item) =>
        this.clonePersonnelService(item),
      );
      this.vehicles = masterData.vehicles.map((item) =>
        this.cloneVehicle(item),
      );
      this.vehicleServices = masterData.vehicleServices.map((item) =>
        this.cloneVehicleService(item),
      );
      return true;
    } catch (error) {
      this.logger.error(
        'Stammdaten konnten nicht aus der Datenbank geladen werden – verwende leere Sammlungen.',
        (error as Error).stack ?? String(error),
      );
      this.personnelServicePools = [];
      this.personnelPools = [];
      this.homeDepots = [];
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
      return false;
    } finally {
      this.normalizeState();
    }
  }

  private clonePersonnelServicePool(
    pool: PersonnelServicePool,
  ): PersonnelServicePool {
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

  private cloneHomeDepot(depot: HomeDepot): HomeDepot {
    return {
      ...depot,
      siteIds: [...(depot.siteIds ?? [])],
      breakSiteIds: [...(depot.breakSiteIds ?? [])],
      shortBreakSiteIds: [...(depot.shortBreakSiteIds ?? [])],
      overnightSiteIds: [...(depot.overnightSiteIds ?? [])],
      attributes: depot.attributes ? { ...depot.attributes } : undefined,
    };
  }

  private cloneVehicleServicePool(
    pool: VehicleServicePool,
  ): VehicleServicePool {
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

  private cloneVehicleComposition(
    composition: VehicleComposition,
  ): VehicleComposition {
    return {
      ...composition,
      entries: (composition.entries ?? []).map((entry) => ({ ...entry })),
      attributes: composition.attributes
        ? { ...composition.attributes }
        : undefined,
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

  private cloneOpReplacementStopLink(
    link: OpReplacementStopLink,
  ): OpReplacementStopLink {
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
        return {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: node.replacementStopId,
        };
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
