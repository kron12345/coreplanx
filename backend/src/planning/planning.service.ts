import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import type { Readable } from 'stream';
import { Observable, Subject } from 'rxjs';
import {
  Activity,
  ActivityFilters,
  ActivityMutationRequest,
  ActivityMutationResponse,
  ActivityValidationIssue,
  ActivityValidationRequest,
  ActivityValidationResponse,
  ActivityAttributes,
  ActivityCatalogSnapshot,
  ActivityDefinition,
  ActivityTemplate,
  ActivityTypeDefinition,
  PlanningStageSnapshot,
  Resource,
  ResourceSnapshot,
  Personnel,
  PersonnelService,
  ResourceMutationRequest,
  ResourceMutationResponse,
  LayerGroup,
  PersonnelServicePool,
  PersonnelServicePoolListRequest,
  PersonnelServicePoolListResponse,
  PersonnelPool,
  PersonnelPoolListRequest,
  PersonnelPoolListResponse,
  Vehicle,
  VehicleService,
  VehicleServicePool,
  VehicleServicePoolListRequest,
  VehicleServicePoolListResponse,
  VehiclePool,
  VehiclePoolListRequest,
  VehiclePoolListResponse,
  VehicleType,
  VehicleTypeListRequest,
  VehicleTypeListResponse,
  VehicleComposition,
  VehicleCompositionListRequest,
  VehicleCompositionListResponse,
  PlanningStageRealtimeEvent,
  StageId,
  TimelineRange,
  STAGE_IDS,
  isStageId,
  TrainRun,
  TrainSegment,
  OperationalPoint,
  OperationalPointListRequest,
  OperationalPointListResponse,
  LatLng,
  SectionOfLine,
  SectionOfLineListRequest,
  SectionOfLineListResponse,
  TopologyAttribute,
  PersonnelSite,
  PersonnelSiteListRequest,
  PersonnelSiteListResponse,
  ReplacementStop,
  ReplacementStopListRequest,
  ReplacementStopListResponse,
  ReplacementRoute,
  ReplacementRouteListRequest,
  ReplacementRouteListResponse,
  ReplacementEdge,
  ReplacementEdgeListRequest,
  ReplacementEdgeListResponse,
  OpReplacementStopLink,
  OpReplacementStopLinkListRequest,
  OpReplacementStopLinkListResponse,
  TransferNode,
  TransferEdge,
  TransferEdgeListRequest,
  TransferEdgeListResponse,
  TopologyImportRequest,
  TopologyImportResponse,
  TopologyImportKind,
  TopologyImportEventRequest,
  TopologyImportRealtimeEvent,
  TranslationState,
  ResourceKind,
  ActivityFieldKey,
} from './planning.types';
import { PlanningRepository } from './planning.repository';

interface StageState {
  stageId: StageId;
  resources: Resource[];
  activities: Activity[];
  trainRuns: TrainRun[];
  trainSegments: TrainSegment[];
  timelineRange: TimelineRange;
  version: string | null;
}

interface SourceContext {
  userId?: string;
  connectionId?: string;
}

@Injectable()
export class PlanningService implements OnModuleInit {
  private readonly logger = new Logger(PlanningService.name);
  private readonly stages = new Map<StageId, StageState>();
  private validationIssueCounter = 0;
  private readonly stageEventSubjects = new Map<
    StageId,
    Subject<PlanningStageRealtimeEvent>
  >();
  private readonly heartbeatIntervalMs = 30000;
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
  private activityTypes: ActivityTypeDefinition[] = [];
  private activityTemplates: ActivityTemplate[] = [];
  private activityDefinitions: ActivityDefinition[] = [];
  private activityLayerGroups: LayerGroup[] = [];
  private activityTranslations: TranslationState = {};
  private readonly topologyImportEvents =
    new Subject<TopologyImportRealtimeEvent>();
  private readonly topologyScriptsDir = path.join(
    process.cwd(),
    'integrations',
    'topology-import',
  );
  private readonly topologyPythonBin =
    process.env.TOPOLOGY_IMPORT_PYTHON ?? 'python3';
  private readonly topologyImportCountry =
    process.env.TOPOLOGY_IMPORT_COUNTRY ?? 'DEU';
  private readonly topologyImportApiBase =
    process.env.TOPOLOGY_IMPORT_API_BASE ??
    process.env.TOPOLOGY_API_BASE ??
    'http://localhost:3000/api/v1';
  private readonly topologyNormalizePrefix =
    process.env.TOPOLOGY_IMPORT_NORMALIZE_PREFIX ?? 'DE';
  private readonly topologyNormalizeFill =
    process.env.TOPOLOGY_IMPORT_NORMALIZE_FILL ?? '0';
  private readonly topologySolPrefixes =
    process.env.TOPOLOGY_IMPORT_SOL_PREFIXES ??
    '0,1,2,3,4,5,6,7,8,9,A,B,C,D,E,F';
  private readonly runningTopologyProcesses = new Map<
    TopologyImportKind,
    ChildProcess
  >();

  private readonly usingDatabase: boolean;

  constructor(private readonly repository: PlanningRepository) {
    this.usingDatabase = this.repository.isEnabled;
    if (!this.usingDatabase) {
      STAGE_IDS.forEach((stageId) => {
        this.stages.set(stageId, this.createEmptyStage(stageId));
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    await this.initializeStagesFromDatabase();
    await this.initializeMasterDataFromDatabase();
    await this.initializeActivityCatalogFromDatabase();
  }

  getStageSnapshot(stageId: string): PlanningStageSnapshot {
    const stage = this.getStage(stageId);
    return {
      stageId: stage.stageId,
      resources: stage.resources.map((resource) =>
        this.cloneResource(resource),
      ),
      activities: stage.activities.map((activity) =>
        this.cloneActivity(activity),
      ),
      trainRuns: stage.trainRuns.map((run) => this.cloneTrainRun(run)),
      trainSegments: stage.trainSegments.map((segment) =>
        this.cloneTrainSegment(segment),
      ),
      timelineRange: { ...stage.timelineRange },
      version: stage.version,
    };
  }

  listActivities(stageId: string, filters: ActivityFilters = {}): Activity[] {
    const stage = this.getStage(stageId);
    const filtered = this.applyActivityFilters(stage.activities, filters);
    return filtered.map((activity) => this.cloneActivity(activity));
  }

  listResources(stageId: string): Resource[] {
    const stage = this.getStage(stageId);
    return stage.resources.map((resource) => this.cloneResource(resource));
  }

  async mutateActivities(
    stageId: string,
    request?: ActivityMutationRequest,
  ): Promise<ActivityMutationResponse> {
    const stage = this.getStage(stageId);
    const previousTimeline = { ...stage.timelineRange };
    const upserts = request?.upserts ?? [];
    const deleteIds = new Set(request?.deleteIds ?? []);
    const appliedUpserts: string[] = [];
    const deletedIds: string[] = [];

    upserts.forEach((incoming) => {
      this.upsertActivity(stage, incoming);
      appliedUpserts.push(incoming.id);
      deleteIds.delete(incoming.id);
    });

    if (deleteIds.size > 0) {
      stage.activities = stage.activities.filter((activity) => {
        if (deleteIds.has(activity.id)) {
          deletedIds.push(activity.id);
          return false;
        }
        return true;
      });
    }

    stage.version = this.nextVersion();
    stage.timelineRange = this.computeTimelineRange(
      stage.activities,
      stage.timelineRange,
    );
    const timelineChanged =
      previousTimeline.start !== stage.timelineRange.start ||
      previousTimeline.end !== stage.timelineRange.end;

    const activitySnapshots = appliedUpserts.length
      ? this.collectActivitySnapshots(stage, appliedUpserts)
      : [];

    const sourceContext = this.extractSourceContext(request?.clientRequestId);
    if (appliedUpserts.length || deletedIds.length) {
      this.emitStageEvent(stage.stageId, {
        stageId: stage.stageId,
        scope: 'activities',
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        upserts: activitySnapshots.length ? activitySnapshots : undefined,
        deleteIds: deletedIds.length ? [...deletedIds] : undefined,
      });
    }
    if (timelineChanged) {
      this.emitTimelineEvent(stage, sourceContext);
    }

    if (this.usingDatabase) {
      await this.repository.applyActivityMutations(
        stage.stageId,
        activitySnapshots,
        deletedIds,
      );
      await this.repository.updateStageMetadata(
        stage.stageId,
        stage.timelineRange,
        stage.version,
      );
    }

    return {
      appliedUpserts,
      deletedIds,
      version: stage.version,
    };
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
      await this.repository.replaceVehicleServicePools(
        this.vehicleServicePools,
      );
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
    this.vehiclePools = nextVehiclePools.map((pool) =>
      this.cloneVehiclePool(pool),
    );
    this.vehicleTypes = nextVehicleTypes.map((type) =>
      this.cloneVehicleType(type),
    );
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

  getActivityCatalog(): ActivityCatalogSnapshot {
    return this.buildActivityCatalogSnapshot();
  }

  async replaceActivityCatalog(
    snapshot: ActivityCatalogSnapshot,
  ): Promise<ActivityCatalogSnapshot> {
    const normalized = this.normalizeCatalogSnapshot(snapshot);
    this.applyCatalogState(normalized);
    await this.persistActivityCatalog();
    return this.buildActivityCatalogSnapshot();
  }

  listActivityTypes(): ActivityTypeDefinition[] {
    return this.activityTypes.map((type) => this.cloneActivityType(type));
  }

  getActivityType(typeId: string): ActivityTypeDefinition {
    const found = this.activityTypes.find((type) => type.id === typeId);
    if (!found) {
      throw new NotFoundException(
        `Activity Type ${typeId} ist nicht vorhanden.`,
      );
    }
    return this.cloneActivityType(found);
  }

  async createActivityType(
    payload: ActivityTypeDefinition,
  ): Promise<ActivityTypeDefinition> {
    const normalized = this.normalizeActivityTypeDefinition(payload);
    if (this.activityTypes.some((type) => type.id === normalized.id)) {
      throw new ConflictException(
        `Activity Type ${normalized.id} existiert bereits.`,
      );
    }
    this.activityTypes.push(normalized);
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityType(normalized);
  }

  async upsertActivityType(
    typeId: string,
    payload: ActivityTypeDefinition,
  ): Promise<ActivityTypeDefinition> {
    const normalized = this.normalizeActivityTypeDefinition(payload, typeId);
    const index = this.activityTypes.findIndex((type) => type.id === typeId);
    if (index >= 0) {
      this.activityTypes[index] = normalized;
    } else {
      this.activityTypes.push(normalized);
    }
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityType(normalized);
  }

  async deleteActivityType(typeId: string): Promise<void> {
    const index = this.activityTypes.findIndex((type) => type.id === typeId);
    if (index < 0) {
      throw new NotFoundException(
        `Activity Type ${typeId} ist nicht vorhanden.`,
      );
    }
    this.activityTypes.splice(index, 1);
    await this.persistActivityCatalog();
  }

  listActivityTemplates(): ActivityTemplate[] {
    return this.activityTemplates.map((template) =>
      this.cloneActivityTemplate(template),
    );
  }

  getActivityTemplate(templateId: string): ActivityTemplate {
    const found = this.activityTemplates.find(
      (template) => template.id === templateId,
    );
    if (!found) {
      throw new NotFoundException(
        `Activity Template ${templateId} ist nicht vorhanden.`,
      );
    }
    return this.cloneActivityTemplate(found);
  }

  async createActivityTemplate(
    payload: ActivityTemplate,
  ): Promise<ActivityTemplate> {
    const normalized = this.normalizeActivityTemplate(payload);
    if (
      this.activityTemplates.some((template) => template.id === normalized.id)
    ) {
      throw new ConflictException(
        `Activity Template ${normalized.id} existiert bereits.`,
      );
    }
    this.activityTemplates.push(normalized);
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityTemplate(normalized);
  }

  async upsertActivityTemplate(
    templateId: string,
    payload: ActivityTemplate,
  ): Promise<ActivityTemplate> {
    const normalized = this.normalizeActivityTemplate(payload, templateId);
    const index = this.activityTemplates.findIndex(
      (template) => template.id === templateId,
    );
    if (index >= 0) {
      this.activityTemplates[index] = normalized;
    } else {
      this.activityTemplates.push(normalized);
    }
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityTemplate(normalized);
  }

  async deleteActivityTemplate(templateId: string): Promise<void> {
    const index = this.activityTemplates.findIndex(
      (template) => template.id === templateId,
    );
    if (index < 0) {
      throw new NotFoundException(
        `Activity Template ${templateId} ist nicht vorhanden.`,
      );
    }
    this.activityTemplates.splice(index, 1);
    await this.persistActivityCatalog();
  }

  listActivityDefinitions(): ActivityDefinition[] {
    return this.activityDefinitions.map((definition) =>
      this.cloneActivityDefinition(definition),
    );
  }

  getActivityDefinition(definitionId: string): ActivityDefinition {
    const found = this.activityDefinitions.find(
      (definition) => definition.id === definitionId,
    );
    if (!found) {
      throw new NotFoundException(
        `Activity Definition ${definitionId} ist nicht vorhanden.`,
      );
    }
    return this.cloneActivityDefinition(found);
  }

  async createActivityDefinition(
    payload: ActivityDefinition,
  ): Promise<ActivityDefinition> {
    const normalized = this.normalizeActivityDefinition(payload);
    if (
      this.activityDefinitions.some(
        (definition) => definition.id === normalized.id,
      )
    ) {
      throw new ConflictException(
        `Activity Definition ${normalized.id} existiert bereits.`,
      );
    }
    this.activityDefinitions.push(normalized);
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityDefinition(normalized);
  }

  async upsertActivityDefinition(
    definitionId: string,
    payload: ActivityDefinition,
  ): Promise<ActivityDefinition> {
    const normalized = this.normalizeActivityDefinition(payload, definitionId);
    const index = this.activityDefinitions.findIndex(
      (definition) => definition.id === definitionId,
    );
    if (index >= 0) {
      this.activityDefinitions[index] = normalized;
    } else {
      this.activityDefinitions.push(normalized);
    }
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityDefinition(normalized);
  }

  async deleteActivityDefinition(definitionId: string): Promise<void> {
    const index = this.activityDefinitions.findIndex(
      (definition) => definition.id === definitionId,
    );
    if (index < 0) {
      throw new NotFoundException(
        `Activity Definition ${definitionId} ist nicht vorhanden.`,
      );
    }
    this.activityDefinitions.splice(index, 1);
    await this.persistActivityCatalog();
  }

  listLayerGroups(): LayerGroup[] {
    return this.activityLayerGroups.map((layer) => this.cloneLayerGroup(layer));
  }

  getLayerGroup(layerId: string): LayerGroup {
    const found = this.activityLayerGroups.find(
      (layer) => layer.id === layerId,
    );
    if (!found) {
      throw new NotFoundException(
        `Layer-Gruppe ${layerId} ist nicht vorhanden.`,
      );
    }
    return this.cloneLayerGroup(found);
  }

  async createLayerGroup(payload: LayerGroup): Promise<LayerGroup> {
    const normalized = this.normalizeLayerGroup(payload);
    if (this.activityLayerGroups.some((layer) => layer.id === normalized.id)) {
      throw new ConflictException(
        `Layer-Gruppe ${normalized.id} existiert bereits.`,
      );
    }
    this.activityLayerGroups.push(normalized);
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneLayerGroup(normalized);
  }

  async upsertLayerGroup(
    layerId: string,
    payload: LayerGroup,
  ): Promise<LayerGroup> {
    const normalized = this.normalizeLayerGroup(payload, layerId);
    const index = this.activityLayerGroups.findIndex(
      (layer) => layer.id === layerId,
    );
    if (index >= 0) {
      this.activityLayerGroups[index] = normalized;
    } else {
      this.activityLayerGroups.push(normalized);
    }
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneLayerGroup(normalized);
  }

  async deleteLayerGroup(layerId: string): Promise<void> {
    const index = this.activityLayerGroups.findIndex(
      (layer) => layer.id === layerId,
    );
    if (index < 0) {
      throw new NotFoundException(
        `Layer-Gruppe ${layerId} ist nicht vorhanden.`,
      );
    }
    this.activityLayerGroups.splice(index, 1);
    await this.persistActivityCatalog();
  }

  getTranslations(): TranslationState {
    return this.cloneTranslationState(this.activityTranslations);
  }

  async replaceTranslations(
    translations: TranslationState,
  ): Promise<TranslationState> {
    this.activityTranslations = this.normalizeTranslations(translations);
    await this.persistActivityCatalog();
    return this.cloneTranslationState(this.activityTranslations);
  }

  getTranslationsForLocale(
    locale: string,
  ): Record<string, { label?: string | null; abbreviation?: string | null }> {
    const localeKey = this.normalizeLocale(locale);
    const state = this.activityTranslations[localeKey] ?? {};
    return { ...state };
  }

  async replaceTranslationsForLocale(
    locale: string,
    entries: Record<
      string,
      { label?: string | null; abbreviation?: string | null }
    >,
  ): Promise<
    Record<string, { label?: string | null; abbreviation?: string | null }>
  > {
    const localeKey = this.normalizeLocale(locale);
    const normalized = this.normalizeTranslations({
      ...this.activityTranslations,
      [localeKey]: entries,
    });
    this.activityTranslations = normalized;
    await this.persistActivityCatalog();
    return { ...(this.activityTranslations[localeKey] ?? {}) };
  }

  async deleteTranslationsForLocale(locale: string): Promise<void> {
    const localeKey = this.normalizeLocale(locale);
    if (!this.activityTranslations[localeKey]) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [localeKey]: _removed, ...rest } = this.activityTranslations;
    this.activityTranslations = rest;
    await this.persistActivityCatalog();
  }

  async triggerTopologyImport(
    request?: TopologyImportRequest,
  ): Promise<TopologyImportResponse> {
    const requestedKinds = this.normalizeTopologyKinds(request?.kinds);
    const startedAt = new Date().toISOString();
    const normalizedKindsLabel = requestedKinds.length
      ? requestedKinds.join(', ')
      : 'keine gültigen Typen';
    this.logger.debug(
      `Topologie-Import-Trigger empfangen. Normalisierte Typen: ${normalizedKindsLabel}. Roh-Anfrage: ${JSON.stringify(
        request ?? {},
      )}`,
    );
    requestedKinds.forEach((kind) => {
      this.logger.log(
        `Topologie-Import für ${kind} wurde vom Frontend angestoßen.`,
      );
    });
    if (!requestedKinds.length) {
      this.logger.warn(
        'Topologie-Import wurde ohne gültige Typen angefragt und wird ignoriert.',
      );
      this.publishTopologyImportEvent({
        status: 'ignored',
        kinds: [],
        message: 'Keine gültigen Topologie-Typen übergeben.',
        source: 'backend',
      });
      return {
        startedAt,
        requestedKinds,
        message:
          'Import-Anfrage ignoriert – keine gültigen Typen. Migration oder Konfiguration prüfen.',
      };
    }
    this.publishTopologyImportEvent({
      status: 'queued',
      kinds: requestedKinds,
      message: `Import angefordert (${normalizedKindsLabel}). Python-Skripte melden Statusmeldungen über den Stream.`,
      source: 'backend',
    });
    this.launchTopologyImportScripts(requestedKinds);
    return {
      startedAt,
      requestedKinds,
      message: `Import wurde angestoßen (${normalizedKindsLabel}). Fortschritt siehe Stream /planning/topology/import/events.`,
    };
  }

  streamTopologyImportEvents(): Observable<TopologyImportRealtimeEvent> {
    return new Observable<TopologyImportRealtimeEvent>((subscriber) => {
      this.logger.debug(
        'Neuer Listener für Topologie-Import-Events registriert.',
      );
      const subscription = this.topologyImportEvents.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => {
        this.logger.debug(
          'Listener für Topologie-Import-Events wurde abgemeldet.',
        );
        subscription.unsubscribe();
      };
    });
  }

  publishTopologyImportEvent(
    request: TopologyImportEventRequest,
  ): TopologyImportRealtimeEvent {
    const event: TopologyImportRealtimeEvent = {
      timestamp: new Date().toISOString(),
      ...request,
    };
    const logParts = [
      `Topologie-Import-Event [${event.status}]`,
      `Quelle: ${event.source ?? 'unbekannt'}`,
      `Typen: ${event.kinds?.length ? event.kinds.join(', ') : 'keine Angabe'}`,
    ];
    if (event.message) {
      logParts.push(`Nachricht: ${event.message}`);
    }
    this.logger.debug(logParts.join(' | '));
    this.topologyImportEvents.next(event);
    return event;
  }

  private launchTopologyImportScripts(kinds: TopologyImportKind[]): void {
    kinds.forEach((kind) => {
      try {
        this.spawnTopologyProcess(kind);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Topologie-Skript für ${kind} konnte nicht gestartet werden: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        this.publishTopologyImportEvent({
          status: 'failed',
          kinds: [kind],
          source: 'backend',
          message: `Skript-Start fehlgeschlagen: ${message}`,
        });
      }
    });
  }

  private spawnTopologyProcess(kind: TopologyImportKind): void {
    if (this.runningTopologyProcesses.has(kind)) {
      this.logger.warn(
        `Topologie-Skript für ${kind} läuft bereits – erneuter Start wird ignoriert.`,
      );
      this.publishTopologyImportEvent({
        status: 'ignored',
        kinds: [kind],
        source: 'backend',
        message: 'Import bereits aktiv – erneuter Start ignoriert.',
      });
      return;
    }
    const definition = this.getTopologyScriptDefinition(kind);
    if (!definition) {
      this.logger.warn(
        `Kein Topologie-Skript für ${kind} konfiguriert – bitte Implementierung ergänzen.`,
      );
      this.publishTopologyImportEvent({
        status: 'failed',
        kinds: [kind],
        source: 'backend',
        message:
          'Kein Python-Skript für diesen Topologie-Typ hinterlegt. Bitte Backend anpassen.',
      });
      return;
    }
    const { script, args, source } = definition;
    const commandPreview = `${this.topologyPythonBin} ${script} ${args.join(' ')}`;
    this.logger.log(
      `Starte Topologie-Skript ${script} für ${kind}. Kommando: ${commandPreview}`,
    );
    this.publishTopologyImportEvent({
      status: 'in-progress',
      kinds: [kind],
      source,
      message: `Starte Skript ${script}`,
    });
    const child = spawn(this.topologyPythonBin, [script, ...args], {
      cwd: this.topologyScriptsDir,
      env: {
        ...process.env,
        TOPOLOGY_API_BASE: this.topologyImportApiBase,
        PYTHONUNBUFFERED: '1',
      },
    });
    this.runningTopologyProcesses.set(kind, child);
    if (child.stdout) {
      this.handleTopologyProcessOutput(kind, child.stdout, `${source}:stdout`);
    }
    if (child.stderr) {
      this.handleTopologyProcessOutput(kind, child.stderr, `${source}:stderr`);
    }

    child.on('error', (error) => {
      this.runningTopologyProcesses.delete(kind);
      this.logger.error(
        `Topologie-Skript ${script} konnte nicht gestartet werden: ${error.message}`,
        error.stack,
      );
      this.publishTopologyImportEvent({
        status: 'failed',
        kinds: [kind],
        source,
        message: `Skript-Start fehlgeschlagen: ${error.message}`,
      });
    });

    child.on('exit', (code, signal) => {
      this.runningTopologyProcesses.delete(kind);
      const success = typeof code === 'number' && code === 0 && !signal;
      const status = success ? 'succeeded' : 'failed';
      const reason = success
        ? `Skript ${script} beendet (Exit-Code ${code}).`
        : `Skript ${script} beendet (Exit-Code ${code ?? 'unbekannt'}, Signal ${signal ?? 'keins'}).`;
      if (success) {
        this.logger.log(reason);
      } else {
        this.logger.error(reason);
      }
      this.publishTopologyImportEvent({
        status,
        kinds: [kind],
        source,
        message: reason,
      });
    });
  }

  private handleTopologyProcessOutput(
    kind: TopologyImportKind,
    stream: Readable,
    source: string,
  ): void {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach((line) => this.emitTopologyProcessLine(kind, source, line));
    });
    stream.on('end', () => {
      if (buffer.trim().length) {
        this.emitTopologyProcessLine(kind, source, buffer);
      }
    });
  }

  private emitTopologyProcessLine(
    kind: TopologyImportKind,
    source: string,
    rawLine: string,
  ): void {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    const message = `[${source}] ${line}`;
    this.logger.debug(`Topologie-${kind}: ${message}`);
    this.publishTopologyImportEvent({
      status: 'in-progress',
      kinds: [kind],
      source,
      message,
    });
  }

  private getTopologyScriptDefinition(kind: TopologyImportKind): {
    script: string;
    args: string[];
    source: string;
  } | null {
    if (kind === 'operational-points') {
      return {
        script: 'era_ops_export-V1.0.py',
        args: this.buildOpsImportArgs(),
        source: 'era_ops_export',
      };
    }
    if (kind === 'sections-of-line') {
      return {
        script: 'era_sols_export-v1.0.py',
        args: this.buildSolImportArgs(),
        source: 'era_sols_export',
      };
    }
    return null;
  }

  private buildOpsImportArgs(): string[] {
    const args = [
      '--country',
      this.topologyImportCountry,
      '--api-base',
      this.topologyImportApiBase,
      '--page-size',
      process.env.TOPOLOGY_IMPORT_OPS_PAGE_SIZE ?? '1500',
      '--parallel',
      process.env.TOPOLOGY_IMPORT_OPS_PARALLEL ?? '5',
      '--timeout',
      process.env.TOPOLOGY_IMPORT_OPS_TIMEOUT ?? '120',
      '--retries',
      process.env.TOPOLOGY_IMPORT_OPS_RETRIES ?? '7',
    ];
    if (this.topologyNormalizePrefix) {
      args.push('--normalize-prefix', this.topologyNormalizePrefix);
    }
    if (this.topologyNormalizeFill) {
      args.push('--normalize-fillchar', this.topologyNormalizeFill);
    }
    const importSource =
      process.env.TOPOLOGY_IMPORT_OPS_SOURCE ?? 'era_ops_backend_runner';
    if (importSource) {
      args.push('--import-source', importSource);
    }
    return args;
  }

  private buildSolImportArgs(): string[] {
    const args = [
      '--country',
      this.topologyImportCountry,
      '--api-base',
      this.topologyImportApiBase,
      '--page-size',
      process.env.TOPOLOGY_IMPORT_SOLS_PAGE_SIZE ?? '1500',
      '--min-page-size',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_PAGE_SIZE ?? '300',
      '--timeout',
      process.env.TOPOLOGY_IMPORT_SOLS_TIMEOUT ?? '90',
      '--retries',
      process.env.TOPOLOGY_IMPORT_SOLS_RETRIES ?? '7',
      '--limit-sols',
      process.env.TOPOLOGY_IMPORT_SOLS_LIMIT ?? '0',
      '--batch-endpoints',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_ENDPOINTS ?? '120',
      '--min-batch-endpoints',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_ENDPOINTS ?? '40',
      '--batch-meta',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_META ?? '80',
      '--min-batch-meta',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_META ?? '10',
      '--batch-opids',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_OPIDS ?? '120',
      '--min-batch-opids',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_OPIDS ?? '40',
      '--batch-track-dirs',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_TRACK_DIRS ?? '120',
      '--min-batch-track-dirs',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_TRACK_DIRS ?? '40',
      '--batch-track-prop',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_TRACK_PROP ?? '80',
      '--min-batch-track-prop',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_TRACK_PROP ?? '30',
      '--batch-labels',
      process.env.TOPOLOGY_IMPORT_SOLS_BATCH_LABELS ?? '20',
      '--min-batch-labels',
      process.env.TOPOLOGY_IMPORT_SOLS_MIN_BATCH_LABELS ?? '5',
    ];
    if (this.topologySolPrefixes) {
      args.push('--sol-prefixes', this.topologySolPrefixes);
    }
    if (this.getBooleanEnv('TOPOLOGY_IMPORT_SOLS_SKIP_ON_TIMEOUT', true)) {
      args.push('--skip-on-timeout');
    }
    if (this.topologyNormalizePrefix) {
      args.push('--normalize-prefix', this.topologyNormalizePrefix);
    }
    if (this.topologyNormalizeFill) {
      args.push('--normalize-fillchar', this.topologyNormalizeFill);
    }
    const importSource =
      process.env.TOPOLOGY_IMPORT_SOLS_SOURCE ?? 'era_sols_backend_runner';
    if (importSource) {
      args.push('--import-source', importSource);
    }
    return args;
  }

  private getBooleanEnv(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined) {
      return fallback;
    }
    return ['1', 'true', 'on', 'yes'].includes(raw.toLowerCase());
  }

  validateActivities(
    stageId: string,
    request?: ActivityValidationRequest,
  ): ActivityValidationResponse {
    const stage = this.getStage(stageId);
    const filters: ActivityFilters = {
      from: request?.windowStart,
      to: request?.windowEnd,
      resourceIds: request?.resourceIds,
    };

    let selected = this.applyActivityFilters(stage.activities, filters);
    if (request?.activityIds?.length) {
      const ids = new Set(request.activityIds);
      selected = selected.filter((activity) => ids.has(activity.id));
    }

    const issues = this.detectOverlapIssues(selected);

    return {
      generatedAt: this.nextVersion(),
      issues,
    };
  }

  streamStageEvents(
    stageId: string,
    _userId?: string,
    _connectionId?: string,
  ): Observable<PlanningStageRealtimeEvent> {
    const stage = this.getStage(stageId);
    const subject = this.getStageEventSubject(stage.stageId);
    return new Observable<PlanningStageRealtimeEvent>((subscriber) => {
      const subscription = subject.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      subscriber.next(this.createTimelineEvent(stage));
      const heartbeat = setInterval(() => {
        const currentStage = this.getStage(stage.stageId);
        subscriber.next(this.createTimelineEvent(currentStage));
      }, this.heartbeatIntervalMs);
      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }

  async mutateResources(
    stageId: string,
    request?: ResourceMutationRequest,
  ): Promise<ResourceMutationResponse> {
    const stage = this.getStage(stageId);
    const previousTimeline = { ...stage.timelineRange };
    const upserts = request?.upserts ?? [];
    const deleteIds = new Set(request?.deleteIds ?? []);
    const appliedUpserts: string[] = [];
    const deletedIds: string[] = [];

    upserts.forEach((incoming) => {
      this.upsertResource(stage, incoming);
      appliedUpserts.push(incoming.id);
      deleteIds.delete(incoming.id);
    });

    if (deleteIds.size > 0) {
      stage.resources = stage.resources.filter((resource) => {
        if (deleteIds.has(resource.id)) {
          deletedIds.push(resource.id);
          return false;
        }
        return true;
      });
    }

    const deletedSet = deletedIds.length ? new Set(deletedIds) : undefined;
    let activitiesChanged = false;
    const orphanedActivityIds: string[] = [];
    if (deletedSet) {
      const originalLength = stage.activities.length;
      // Drop Aktivitäten ohne gültige Ressource, damit der Snapshot konsistent bleibt.
      stage.activities = stage.activities.filter((activity) => {
        const participants = activity.participants ?? [];
        if (
          participants.length > 0 &&
          participants.every((participant) =>
            deletedSet.has(participant.resourceId),
          )
        ) {
          orphanedActivityIds.push(activity.id);
          return false;
        }
        return true;
      });
      activitiesChanged = stage.activities.length !== originalLength;
    }

    stage.version = this.nextVersion();
    let timelineChanged = false;
    if (activitiesChanged) {
      stage.timelineRange = this.computeTimelineRange(
        stage.activities,
        stage.timelineRange,
      );
      timelineChanged =
        previousTimeline.start !== stage.timelineRange.start ||
        previousTimeline.end !== stage.timelineRange.end;
    }

    const resourceSnapshots = appliedUpserts.length
      ? this.collectResourceSnapshots(stage, appliedUpserts)
      : [];

    const sourceContext = this.extractSourceContext(request?.clientRequestId);
    if (appliedUpserts.length || deletedIds.length) {
      this.emitStageEvent(stage.stageId, {
        stageId: stage.stageId,
        scope: 'resources',
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        upserts: resourceSnapshots.length ? resourceSnapshots : undefined,
        deleteIds: deletedIds.length ? [...deletedIds] : undefined,
      });
    }
    if (orphanedActivityIds.length) {
      this.emitStageEvent(stage.stageId, {
        stageId: stage.stageId,
        scope: 'activities',
        version: stage.version,
        sourceClientId: sourceContext.userId,
        sourceConnectionId: sourceContext.connectionId,
        deleteIds: [...orphanedActivityIds],
      });
    }
    if (timelineChanged) {
      this.emitTimelineEvent(stage, sourceContext);
    }

    if (this.usingDatabase) {
      await this.repository.applyResourceMutations(
        stage.stageId,
        resourceSnapshots,
        deletedIds,
      );
      if (orphanedActivityIds.length) {
        await this.repository.deleteActivities(
          stage.stageId,
          orphanedActivityIds,
        );
      }
      await this.repository.updateStageMetadata(
        stage.stageId,
        stage.timelineRange,
        stage.version,
      );
    }

    return {
      appliedUpserts,
      deletedIds,
      version: stage.version,
    };
  }

  private async initializeStagesFromDatabase(): Promise<void> {
    for (const stageId of STAGE_IDS) {
      await this.loadStageFromDatabase(stageId);
    }
  }

  private async initializeMasterDataFromDatabase(): Promise<void> {
    try {
      const masterData = await this.repository.loadMasterData();
      this.personnelServicePools = masterData.personnelServicePools.map(
        (pool) => this.clonePersonnelServicePool(pool),
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

  private async initializeActivityCatalogFromDatabase(): Promise<void> {
    try {
      const catalog = await this.repository.loadActivityCatalog();
      const normalized = this.normalizeCatalogSnapshot(catalog);
      this.applyCatalogState(normalized);
    } catch (error) {
      this.logger.error(
        'Activity-Katalog konnte nicht aus der Datenbank geladen werden – verwende leeren Katalog.',
        (error as Error).stack ?? String(error),
      );
      this.applyCatalogState(
        this.normalizeCatalogSnapshot({
          types: [],
          templates: [],
          definitions: [],
          layerGroups: [],
          translations: {},
        }),
      );
    }
  }

  private async loadStageFromDatabase(stageId: StageId): Promise<void> {
    try {
      const data = await this.repository.loadStageData(stageId);
      if (!data) {
        const emptyStage = this.createEmptyStage(stageId);
        this.stages.set(stageId, emptyStage);
        await this.repository.updateStageMetadata(
          stageId,
          emptyStage.timelineRange,
          emptyStage.version,
        );
        return;
      }

      const timelineRange = this.computeTimelineRange(
        data.activities,
        data.timelineRange ?? this.defaultTimelineRange(),
      );
      const version = data.version ?? this.nextVersion();
      const stage: StageState = {
        stageId,
        resources: data.resources.map((resource) =>
          this.cloneResource(resource),
        ),
        activities: data.activities.map((activity) =>
          this.cloneActivity(activity),
        ),
        trainRuns: data.trainRuns.map((run) => this.cloneTrainRun(run)),
        trainSegments: data.trainSegments.map((segment) =>
          this.cloneTrainSegment(segment),
        ),
        timelineRange,
        version,
      };
      this.stages.set(stageId, stage);

      if (
        !data.timelineRange ||
        data.timelineRange.start !== timelineRange.start ||
        data.timelineRange.end !== timelineRange.end ||
        data.version !== version
      ) {
        await this.repository.updateStageMetadata(
          stageId,
          timelineRange,
          version,
        );
      }
    } catch (error) {
      this.logger.error(
        `Stage ${stageId} konnte nicht aus der Datenbank geladen werden – verwende eine leere Stage.`,
        (error as Error).stack ?? String(error),
      );
      this.stages.set(stageId, this.createEmptyStage(stageId));
    }
  }

  private createEmptyStage(stageId: StageId): StageState {
    return {
      stageId,
      resources: [],
      activities: [],
      trainRuns: [],
      trainSegments: [],
      timelineRange: this.defaultTimelineRange(),
      version: this.nextVersion(),
    };
  }

  private cloneResource(resource: Resource): Resource {
    return {
      ...resource,
      attributes: resource.attributes ? { ...resource.attributes } : undefined,
    };
  }

  private cloneActivity(activity: Activity): Activity {
    return {
      ...activity,
      requiredQualifications: activity.requiredQualifications
        ? [...activity.requiredQualifications]
        : undefined,
      assignedQualifications: activity.assignedQualifications
        ? [...activity.assignedQualifications]
        : undefined,
      workRuleTags: activity.workRuleTags
        ? [...activity.workRuleTags]
        : undefined,
      participants: activity.participants
        ? activity.participants.map((participant) => ({ ...participant }))
        : undefined,
      attributes: activity.attributes ? { ...activity.attributes } : undefined,
      meta: activity.meta ? { ...activity.meta } : undefined,
    };
  }

  private cloneTrainRun(run: TrainRun): TrainRun {
    return {
      ...run,
      attributes: run.attributes ? { ...run.attributes } : undefined,
    };
  }

  private cloneTrainSegment(segment: TrainSegment): TrainSegment {
    return {
      ...segment,
      attributes: segment.attributes ? { ...segment.attributes } : undefined,
    };
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

  private cloneActivityType(
    type: ActivityTypeDefinition,
  ): ActivityTypeDefinition {
    return {
      ...type,
      description: type.description ?? undefined,
      appliesTo: [...(type.appliesTo ?? [])],
      relevantFor: [...(type.relevantFor ?? [])],
      fields: [...(type.fields ?? [])],
    };
  }

  private cloneActivityTemplate(template: ActivityTemplate): ActivityTemplate {
    return {
      ...template,
      description: template.description ?? undefined,
      activityType: template.activityType ?? undefined,
      defaultDurationMinutes: template.defaultDurationMinutes ?? undefined,
      attributes: this.cloneActivityAttributes(template.attributes),
    };
  }

  private cloneActivityDefinition(
    definition: ActivityDefinition,
  ): ActivityDefinition {
    return {
      ...definition,
      description: definition.description ?? undefined,
      templateId: definition.templateId ?? undefined,
      defaultDurationMinutes: definition.defaultDurationMinutes ?? undefined,
      relevantFor: definition.relevantFor
        ? [...definition.relevantFor]
        : undefined,
      attributes: this.cloneActivityAttributes(definition.attributes),
    };
  }

  private cloneLayerGroup(layer: LayerGroup): LayerGroup {
    return {
      ...layer,
      order: layer.order ?? undefined,
      description: layer.description ?? undefined,
    };
  }

  private cloneActivityAttributes(
    attributes?: ActivityAttributes,
  ): ActivityAttributes | undefined {
    return attributes ? { ...attributes } : undefined;
  }

  private cloneTranslationState(state: TranslationState): TranslationState {
    const clone: TranslationState = {};
    Object.entries(state ?? {}).forEach(([locale, entries]) => {
      clone[locale] = { ...(entries ?? {}) };
    });
    return clone;
  }

  private buildActivityCatalogSnapshot(): ActivityCatalogSnapshot {
    this.sortActivityCatalog();
    return {
      types: this.activityTypes.map((type) => this.cloneActivityType(type)),
      templates: this.activityTemplates.map((template) =>
        this.cloneActivityTemplate(template),
      ),
      definitions: this.activityDefinitions.map((definition) =>
        this.cloneActivityDefinition(definition),
      ),
      layerGroups: this.activityLayerGroups.map((layer) =>
        this.cloneLayerGroup(layer),
      ),
      translations: this.cloneTranslationState(this.activityTranslations),
    };
  }

  private applyCatalogState(snapshot: ActivityCatalogSnapshot): void {
    this.activityTypes = snapshot.types.map((type) =>
      this.cloneActivityType(type),
    );
    this.activityTemplates = snapshot.templates.map((template) =>
      this.cloneActivityTemplate(template),
    );
    this.activityDefinitions = snapshot.definitions.map((definition) =>
      this.cloneActivityDefinition(definition),
    );
    this.activityLayerGroups = snapshot.layerGroups.map((layer) =>
      this.cloneLayerGroup(layer),
    );
    this.activityTranslations = this.cloneTranslationState(
      snapshot.translations,
    );
    this.sortActivityCatalog();
  }

  private sortActivityCatalog(): void {
    this.activityTypes.sort((a, b) => a.id.localeCompare(b.id));
    this.activityTemplates.sort((a, b) => a.id.localeCompare(b.id));
    this.activityDefinitions.sort((a, b) => a.id.localeCompare(b.id));
    this.activityLayerGroups.sort((a, b) => {
      const orderA = this.normalizeOptionalNumber(a.order) ?? 50;
      const orderB = this.normalizeOptionalNumber(b.order) ?? 50;
      if (orderA === orderB) {
        return a.id.localeCompare(b.id);
      }
      return orderA - orderB;
    });
  }

  private async persistActivityCatalog(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    await this.repository.replaceActivityCatalog(
      this.buildActivityCatalogSnapshot(),
    );
  }

  private normalizeCatalogSnapshot(
    snapshot: ActivityCatalogSnapshot,
  ): ActivityCatalogSnapshot {
    return {
      types: (snapshot.types ?? []).map((type) =>
        this.normalizeActivityTypeDefinition(type),
      ),
      templates: (snapshot.templates ?? []).map((template) =>
        this.normalizeActivityTemplate(template),
      ),
      definitions: (snapshot.definitions ?? []).map((definition) =>
        this.normalizeActivityDefinition(definition),
      ),
      layerGroups: (snapshot.layerGroups ?? []).map((layer) =>
        this.normalizeLayerGroup(layer),
      ),
      translations: this.normalizeTranslations(snapshot.translations),
    };
  }

  private normalizeActivityTypeDefinition(
    payload: ActivityTypeDefinition,
    overrideId?: string,
  ): ActivityTypeDefinition {
    const id = this.normalizeIdentifier(
      overrideId ?? payload.id,
      'Activity Type ID',
    );
    const label = this.normalizeIdentifier(
      payload.label,
      'Activity Type Label',
    );
    const appliesTo = this.normalizeResourceKinds(payload.appliesTo);
    if (!appliesTo.length) {
      throw new BadRequestException(
        'Activity Type benötigt mindestens ein appliesTo-Element.',
      );
    }
    const relevantFor = this.normalizeResourceKinds(payload.relevantFor);
    if (!relevantFor.length) {
      throw new BadRequestException(
        'Activity Type benötigt mindestens ein relevantFor-Element.',
      );
    }
    const fields = this.normalizeActivityFields(payload.fields);
    const defaultDuration = this.normalizeOptionalNumber(
      payload.defaultDurationMinutes,
    );
    if (defaultDuration === undefined) {
      throw new BadRequestException(
        'Activity Type defaultDurationMinutes muss gesetzt sein.',
      );
    }
    if (defaultDuration < 0) {
      throw new BadRequestException(
        'Activity Type defaultDurationMinutes darf nicht negativ sein.',
      );
    }
    if (!payload.category) {
      throw new BadRequestException('Activity Type category ist erforderlich.');
    }
    if (!payload.timeMode) {
      throw new BadRequestException('Activity Type timeMode ist erforderlich.');
    }

    return {
      id,
      label,
      description: payload.description?.trim() || undefined,
      appliesTo,
      relevantFor,
      category: payload.category,
      timeMode: payload.timeMode,
      fields,
      defaultDurationMinutes: defaultDuration,
    };
  }

  private normalizeActivityTemplate(
    payload: ActivityTemplate,
    overrideId?: string,
  ): ActivityTemplate {
    const id = this.normalizeIdentifier(
      overrideId ?? payload.id,
      'Activity Template ID',
    );
    const label = this.normalizeIdentifier(
      payload.label,
      'Activity Template Label',
    );
    const defaultDuration = this.normalizeOptionalNumber(
      payload.defaultDurationMinutes,
    );
    if (defaultDuration !== undefined && defaultDuration < 0) {
      throw new BadRequestException(
        'Activity Template defaultDurationMinutes darf nicht negativ sein.',
      );
    }
    const activityType = payload.activityType?.trim();
    return {
      id,
      label,
      description: payload.description?.trim() || undefined,
      activityType: activityType || undefined,
      defaultDurationMinutes: defaultDuration,
      attributes: this.applyActivityAttributeDefaults(payload.attributes),
    };
  }

  private normalizeActivityDefinition(
    payload: ActivityDefinition,
    overrideId?: string,
  ): ActivityDefinition {
    const id = this.normalizeIdentifier(
      overrideId ?? payload.id,
      'Activity Definition ID',
    );
    const label = this.normalizeIdentifier(
      payload.label,
      'Activity Definition Label',
    );
    const activityType = this.normalizeIdentifier(
      payload.activityType,
      'Activity Definition activityType',
    );
    const defaultDuration = this.normalizeOptionalNumber(
      payload.defaultDurationMinutes,
    );
    if (defaultDuration !== undefined && defaultDuration < 0) {
      throw new BadRequestException(
        'Activity Definition defaultDurationMinutes darf nicht negativ sein.',
      );
    }
    const relevantFor = this.normalizeResourceKinds(payload.relevantFor);

    return {
      id,
      label,
      description: payload.description?.trim() || undefined,
      activityType,
      templateId: payload.templateId ?? undefined,
      defaultDurationMinutes: defaultDuration,
      relevantFor: relevantFor.length ? relevantFor : undefined,
      attributes: this.applyActivityAttributeDefaults(payload.attributes),
    };
  }

  private normalizeLayerGroup(
    payload: LayerGroup,
    overrideId?: string,
  ): LayerGroup {
    const id = this.normalizeIdentifier(overrideId ?? payload.id, 'Layer ID');
    const label = this.normalizeIdentifier(payload.label, 'Layer Label');
    const order = this.normalizeOptionalNumber(payload.order) ?? 50;
    return {
      id,
      label,
      order,
      description: payload.description?.trim() || undefined,
    };
  }

  private normalizeTranslations(
    translations?: TranslationState,
  ): TranslationState {
    const normalized: TranslationState = {};
    Object.entries(translations ?? {}).forEach(([locale, entries]) => {
      const localeKey = this.normalizeLocale(locale);
      const normalizedEntries: Record<
        string,
        { label?: string | null; abbreviation?: string | null }
      > = {};
      Object.entries(entries ?? {}).forEach(([key, value]) => {
        const normalizedKey = (key ?? '').trim();
        if (!normalizedKey) {
          throw new BadRequestException(
            'Translation-Key darf nicht leer sein.',
          );
        }
        normalizedEntries[normalizedKey] = {
          label: value?.label ?? null,
          abbreviation: value?.abbreviation ?? null,
        };
      });
      normalized[localeKey] = normalizedEntries;
    });
    return normalized;
  }

  private normalizeIdentifier(
    value: string | undefined,
    context: string,
  ): string {
    const normalized = (value ?? '').trim();
    if (!normalized) {
      throw new BadRequestException(`${context} darf nicht leer sein.`);
    }
    return normalized;
  }

  private normalizeOptionalNumber(value?: number | null): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return parsed;
  }

  private normalizeResourceKinds(
    values?: (string | ResourceKind)[],
  ): ResourceKind[] {
    const allowed: ResourceKind[] = [
      'personnel-service',
      'vehicle-service',
      'personnel',
      'vehicle',
    ];
    const allowedSet = new Set<ResourceKind>(allowed);
    const cleaned = (values ?? [])
      .map((entry) => (entry ?? '').trim())
      .filter((entry) => allowedSet.has(entry as ResourceKind)) as ResourceKind[];
    return Array.from(new Set(cleaned));
  }

  private normalizeActivityFields(
    values?: (string | ActivityFieldKey)[],
  ): ActivityFieldKey[] {
    const allowed: ActivityFieldKey[] = ['start', 'end', 'from', 'to', 'remark'];
    const allowedSet = new Set<ActivityFieldKey>(allowed);
    const cleaned = (values ?? [])
      .map((entry) => (entry ?? '').trim())
      .filter((entry) => allowedSet.has(entry as ActivityFieldKey)) as ActivityFieldKey[];
    return Array.from(new Set(cleaned));
  }

  private normalizeLocale(locale: string): string {
    const normalized = (locale ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('Locale darf nicht leer sein.');
    }
    return normalized;
  }

  private applyActivityAttributeDefaults(
    attributes?: ActivityAttributes,
  ): ActivityAttributes {
    const defaults: ActivityAttributes = {
      draw_as: 'thick',
      layer_group: 'default',
      color: '#1976d2',
      consider_capacity_conflicts: true,
      is_short_break: false,
      is_break: false,
      is_service_start: false,
      is_service_end: false,
      is_absence: false,
      is_reserve: false,
    };
    const incoming = attributes ?? {};
    const result: ActivityAttributes = { ...defaults };
    Object.entries(incoming).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        result[key] = value;
      }
    });
    return result;
  }

  private getStageEventSubject(
    stageId: StageId,
  ): Subject<PlanningStageRealtimeEvent> {
    const existing = this.stageEventSubjects.get(stageId);
    if (existing) {
      return existing;
    }
    const subject = new Subject<PlanningStageRealtimeEvent>();
    this.stageEventSubjects.set(stageId, subject);
    return subject;
  }

  private emitStageEvent(
    stageId: StageId,
    event: PlanningStageRealtimeEvent,
  ): void {
    const subject = this.getStageEventSubject(stageId);
    subject.next(event);
  }

  private emitTimelineEvent(
    stage: StageState,
    sourceContext?: SourceContext,
  ): void {
    this.emitStageEvent(
      stage.stageId,
      this.createTimelineEvent(stage, sourceContext),
    );
  }

  private createTimelineEvent(
    stage: StageState,
    sourceContext?: SourceContext,
  ): PlanningStageRealtimeEvent {
    return {
      stageId: stage.stageId,
      scope: 'timeline',
      version: stage.version,
      sourceClientId: sourceContext?.userId,
      sourceConnectionId: sourceContext?.connectionId,
      timelineRange: { ...stage.timelineRange },
    };
  }

  private collectResourceSnapshots(
    stage: StageState,
    ids: string[],
  ): Resource[] {
    return ids
      .map((id) => stage.resources.find((resource) => resource.id === id))
      .filter((resource): resource is Resource => Boolean(resource))
      .map((resource) => this.cloneResource(resource));
  }

  private collectActivitySnapshots(
    stage: StageState,
    ids: string[],
  ): Activity[] {
    return ids
      .map((id) => stage.activities.find((activity) => activity.id === id))
      .filter((activity): activity is Activity => Boolean(activity))
      .map((activity) => this.cloneActivity(activity));
  }

  private extractSourceContext(clientRequestId?: string): SourceContext {
    if (!clientRequestId) {
      return {};
    }
    const segments = clientRequestId.split('|');
    const [userId, connectionId] = segments;
    return {
      userId: userId || undefined,
      connectionId: connectionId || undefined,
    };
  }

  private getStage(stageIdValue: string): StageState {
    if (!isStageId(stageIdValue)) {
      throw new NotFoundException(`Stage ${stageIdValue} ist unbekannt.`);
    }
    const stage = this.stages.get(stageIdValue);
    if (!stage) {
      throw new NotFoundException(
        `Stage ${stageIdValue} ist nicht initialisiert.`,
      );
    }
    return stage;
  }

  private applyActivityFilters(
    activities: Activity[],
    filters: ActivityFilters = {},
  ): Activity[] {
    const fromMs = this.parseIso(filters.from);
    const toMs = this.parseIso(filters.to);
    const resourceFilter = filters.resourceIds?.length
      ? new Set(filters.resourceIds)
      : undefined;

    return activities.filter((activity) => {
      if (resourceFilter) {
        const participants = activity.participants ?? [];
        const matchesResource = participants.some((participant) =>
          resourceFilter.has(participant.resourceId),
        );
        if (!matchesResource) {
          return false;
        }
      }

      const startMs = this.parseIso(activity.start);
      const endMs = this.parseIso(activity.end ?? activity.start ?? '');

      if (fromMs !== undefined && endMs !== undefined && endMs <= fromMs) {
        return false;
      }

      if (toMs !== undefined && startMs !== undefined && startMs >= toMs) {
        return false;
      }

      return true;
    });
  }

  private upsertActivity(stage: StageState, incoming: Activity): void {
    const clone = this.cloneActivity(incoming);
    const index = stage.activities.findIndex(
      (activity) => activity.id === incoming.id,
    );
    if (index >= 0) {
      stage.activities[index] = clone;
    } else {
      stage.activities.push(clone);
    }
  }

  private upsertResource(stage: StageState, incoming: Resource): void {
    const clone = this.cloneResource(incoming);
    const index = stage.resources.findIndex(
      (resource) => resource.id === incoming.id,
    );
    if (index >= 0) {
      stage.resources[index] = clone;
    } else {
      stage.resources.push(clone);
    }
  }

  private detectOverlapIssues(
    activities: Activity[],
  ): ActivityValidationIssue[] {
    const byResource = new Map<string, Activity[]>();
    activities.forEach((activity) => {
      const participants = activity.participants ?? [];
      participants.forEach((participant) => {
        const collection = byResource.get(participant.resourceId) ?? [];
        collection.push(activity);
        byResource.set(participant.resourceId, collection);
      });
    });

    const issues: ActivityValidationIssue[] = [];
    byResource.forEach((list, resourceId) => {
      const sorted = [...list].sort(
        (a, b) => (this.parseIso(a.start) ?? 0) - (this.parseIso(b.start) ?? 0),
      );
      for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (this.activitiesOverlap(previous, current)) {
          this.validationIssueCounter += 1;
          issues.push({
            id: `working-time-${resourceId}-${this.validationIssueCounter}`,
            rule: 'working-time',
            severity: 'warning',
            message: `Aktivitäten ${previous.id} und ${current.id} überschneiden sich auf Ressource ${resourceId}.`,
            activityIds: [previous.id, current.id],
            meta: { resourceId },
          });
        }
      }
    });
    return issues;
  }

  private activitiesOverlap(a: Activity, b: Activity): boolean {
    const aStart = this.parseIso(a.start) ?? 0;
    const aEnd = this.parseIso(a.end ?? a.start ?? '') ?? aStart;
    const bStart = this.parseIso(b.start) ?? 0;
    const bEnd = this.parseIso(b.end ?? b.start ?? '') ?? bStart;

    return aStart < bEnd && bStart < aEnd;
  }

  private computeTimelineRange(
    activities: Activity[],
    fallback: TimelineRange,
  ): TimelineRange {
    if (!activities.length) {
      return { ...fallback };
    }
    const starts: number[] = [];
    const ends: number[] = [];
    activities.forEach((activity) => {
      const startMs = this.parseIso(activity.start);
      if (startMs !== undefined) {
        starts.push(startMs);
      }
      const endMs = this.parseIso(activity.end ?? activity.start ?? '');
      if (endMs !== undefined) {
        ends.push(endMs);
      }
    });
    if (!starts.length || !ends.length) {
      return { ...fallback };
    }
    const min = Math.min(...starts);
    const max = Math.max(...ends);
    return {
      start: new Date(min).toISOString(),
      end: new Date(max).toISOString(),
    };
  }

  private defaultTimelineRange(): TimelineRange {
    return {
      start: '2025-03-01T06:00:00.000Z',
      end: '2025-03-01T18:00:00.000Z',
    };
  }

  private parseIso(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
  }

  private normalizeTopologyKinds(
    kinds?: TopologyImportKind[],
  ): TopologyImportKind[] {
    const allowed: TopologyImportKind[] = [
      'operational-points',
      'sections-of-line',
      'personnel-sites',
      'replacement-stops',
      'replacement-routes',
      'replacement-edges',
      'op-replacement-stop-links',
      'transfer-edges',
    ];
    if (!kinds?.length) {
      return [...allowed];
    }
    const allowedSet = new Set<TopologyImportKind>(allowed);
    const normalized: TopologyImportKind[] = [];
    kinds.forEach((kind) => {
      if (allowedSet.has(kind) && !normalized.includes(kind)) {
        normalized.push(kind);
      }
    });
    return normalized;
  }

  private nextVersion(): string {
    return new Date().toISOString();
  }
}
