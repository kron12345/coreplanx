import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type {
  Activity,
  ActivityCatalogSnapshot,
  ActivityDefinition,
  ActivityFilters,
  ActivityMutationRequest,
  ActivityMutationResponse,
  ActivityTemplate,
  ActivityTypeDefinition,
  ActivityValidationRequest,
  ActivityValidationResponse,
  LayerGroup,
  OperationalPointListRequest,
  OperationalPointListResponse,
  OpReplacementStopLinkListRequest,
  OpReplacementStopLinkListResponse,
  PersonnelPoolListRequest,
  PersonnelPoolListResponse,
  PersonnelServicePoolListRequest,
  PersonnelServicePoolListResponse,
  PersonnelSiteListRequest,
  PersonnelSiteListResponse,
  PlanningStageRealtimeEvent,
  PlanningStageSnapshot,
  ReplacementEdgeListRequest,
  ReplacementEdgeListResponse,
  ReplacementRouteListRequest,
  ReplacementRouteListResponse,
  ReplacementStopListRequest,
  ReplacementStopListResponse,
  Resource,
  ResourceMutationRequest,
  ResourceMutationResponse,
  ResourceSnapshot,
  SectionOfLineListRequest,
  SectionOfLineListResponse,
  TopologyImportEventRequest,
  TopologyImportRealtimeEvent,
  TopologyImportRequest,
  TopologyImportResponse,
  TransferEdgeListRequest,
  TransferEdgeListResponse,
  TranslationState,
  VehicleCompositionListRequest,
  VehicleCompositionListResponse,
  VehiclePoolListRequest,
  VehiclePoolListResponse,
  VehicleServicePoolListRequest,
  VehicleServicePoolListResponse,
  VehicleTypeListRequest,
  VehicleTypeListResponse,
} from './planning.types';
import { PlanningActivityCatalogService } from './planning-activity-catalog.service';
import { PlanningMasterDataService } from './planning-master-data.service';
import type { OperationsSnapshotRequest, OperationsSnapshotResponse } from './planning-snapshot.service';
import { PlanningSnapshotService } from './planning-snapshot.service';
import { PlanningStageService } from './planning-stage.service';
import { PlanningTopologyImportService } from './planning-topology-import.service';

@Injectable()
export class PlanningService {
  constructor(
    private readonly stageService: PlanningStageService,
    private readonly masterDataService: PlanningMasterDataService,
    private readonly catalogService: PlanningActivityCatalogService,
    private readonly snapshotService: PlanningSnapshotService,
    private readonly topologyImportService: PlanningTopologyImportService,
  ) {}

  getStageSnapshot(
    stageId: string,
    variantId: string,
    timetableYearLabel?: string | null,
  ): Promise<PlanningStageSnapshot> {
    return this.stageService.getStageSnapshot(stageId, variantId, timetableYearLabel);
  }

  listActivities(
    stageId: string,
    variantId: string,
    filters: ActivityFilters = {},
    timetableYearLabel?: string | null,
  ): Promise<Activity[]> {
    return this.stageService.listActivities(stageId, variantId, filters, timetableYearLabel);
  }

  listResources(
    stageId: string,
    variantId: string,
    timetableYearLabel?: string | null,
  ): Promise<Resource[]> {
    return this.stageService.listResources(stageId, variantId, timetableYearLabel);
  }

  mutateActivities(
    stageId: string,
    variantId: string,
    request?: ActivityMutationRequest,
    timetableYearLabel?: string | null,
  ): Promise<ActivityMutationResponse> {
    return this.stageService.mutateActivities(stageId, variantId, request, timetableYearLabel);
  }

  validateActivities(
    stageId: string,
    variantId: string,
    request?: ActivityValidationRequest,
    timetableYearLabel?: string | null,
  ): Promise<ActivityValidationResponse> {
    return this.stageService.validateActivities(stageId, variantId, request, timetableYearLabel);
  }

  streamStageEvents(
    stageId: string,
    variantId: string,
    userId?: string,
    connectionId?: string,
    timetableYearLabel?: string | null,
  ): Observable<PlanningStageRealtimeEvent> {
    return this.stageService.streamStageEvents(
      stageId,
      variantId,
      userId,
      connectionId,
      timetableYearLabel ?? null,
    );
  }

  mutateResources(
    stageId: string,
    variantId: string,
    request?: ResourceMutationRequest,
    timetableYearLabel?: string | null,
  ): Promise<ResourceMutationResponse> {
    return this.stageService.mutateResources(stageId, variantId, request, timetableYearLabel);
  }

  snapshotBaseToOperations(request: OperationsSnapshotRequest): Promise<OperationsSnapshotResponse> {
    return this.snapshotService.snapshotBaseToOperations(request);
  }

  listPersonnelServicePools(): PersonnelServicePoolListResponse {
    return this.masterDataService.listPersonnelServicePools();
  }

  savePersonnelServicePools(
    request?: PersonnelServicePoolListRequest,
  ): Promise<PersonnelServicePoolListResponse> {
    return this.masterDataService.savePersonnelServicePools(request);
  }

  listPersonnelPools(): PersonnelPoolListResponse {
    return this.masterDataService.listPersonnelPools();
  }

  savePersonnelPools(
    request?: PersonnelPoolListRequest,
  ): Promise<PersonnelPoolListResponse> {
    return this.masterDataService.savePersonnelPools(request);
  }

  listVehicleServicePools(): VehicleServicePoolListResponse {
    return this.masterDataService.listVehicleServicePools();
  }

  saveVehicleServicePools(
    request?: VehicleServicePoolListRequest,
  ): Promise<VehicleServicePoolListResponse> {
    return this.masterDataService.saveVehicleServicePools(request);
  }

  listVehiclePools(): VehiclePoolListResponse {
    return this.masterDataService.listVehiclePools();
  }

  saveVehiclePools(
    request?: VehiclePoolListRequest,
  ): Promise<VehiclePoolListResponse> {
    return this.masterDataService.saveVehiclePools(request);
  }

  listVehicleTypes(): VehicleTypeListResponse {
    return this.masterDataService.listVehicleTypes();
  }

  saveVehicleTypes(
    request?: VehicleTypeListRequest,
  ): Promise<VehicleTypeListResponse> {
    return this.masterDataService.saveVehicleTypes(request);
  }

  listVehicleCompositions(): VehicleCompositionListResponse {
    return this.masterDataService.listVehicleCompositions();
  }

  saveVehicleCompositions(
    request?: VehicleCompositionListRequest,
  ): Promise<VehicleCompositionListResponse> {
    return this.masterDataService.saveVehicleCompositions(request);
  }

  listOperationalPoints(): OperationalPointListResponse {
    return this.masterDataService.listOperationalPoints();
  }

  saveOperationalPoints(
    request?: OperationalPointListRequest,
  ): Promise<OperationalPointListResponse> {
    return this.masterDataService.saveOperationalPoints(request);
  }

  listSectionsOfLine(): SectionOfLineListResponse {
    return this.masterDataService.listSectionsOfLine();
  }

  saveSectionsOfLine(
    request?: SectionOfLineListRequest,
  ): Promise<SectionOfLineListResponse> {
    return this.masterDataService.saveSectionsOfLine(request);
  }

  listPersonnelSites(): PersonnelSiteListResponse {
    return this.masterDataService.listPersonnelSites();
  }

  savePersonnelSites(
    request?: PersonnelSiteListRequest,
  ): Promise<PersonnelSiteListResponse> {
    return this.masterDataService.savePersonnelSites(request);
  }

  listReplacementStops(): ReplacementStopListResponse {
    return this.masterDataService.listReplacementStops();
  }

  saveReplacementStops(
    request?: ReplacementStopListRequest,
  ): Promise<ReplacementStopListResponse> {
    return this.masterDataService.saveReplacementStops(request);
  }

  listReplacementRoutes(): ReplacementRouteListResponse {
    return this.masterDataService.listReplacementRoutes();
  }

  saveReplacementRoutes(
    request?: ReplacementRouteListRequest,
  ): Promise<ReplacementRouteListResponse> {
    return this.masterDataService.saveReplacementRoutes(request);
  }

  listReplacementEdges(): ReplacementEdgeListResponse {
    return this.masterDataService.listReplacementEdges();
  }

  saveReplacementEdges(
    request?: ReplacementEdgeListRequest,
  ): Promise<ReplacementEdgeListResponse> {
    return this.masterDataService.saveReplacementEdges(request);
  }

  listOpReplacementStopLinks(): OpReplacementStopLinkListResponse {
    return this.masterDataService.listOpReplacementStopLinks();
  }

  saveOpReplacementStopLinks(
    request?: OpReplacementStopLinkListRequest,
  ): Promise<OpReplacementStopLinkListResponse> {
    return this.masterDataService.saveOpReplacementStopLinks(request);
  }

  listTransferEdges(): TransferEdgeListResponse {
    return this.masterDataService.listTransferEdges();
  }

  saveTransferEdges(
    request?: TransferEdgeListRequest,
  ): Promise<TransferEdgeListResponse> {
    return this.masterDataService.saveTransferEdges(request);
  }

  getResourceSnapshot(): ResourceSnapshot {
    return this.masterDataService.getResourceSnapshot();
  }

  replaceResourceSnapshot(snapshot?: ResourceSnapshot): Promise<ResourceSnapshot> {
    return this.masterDataService.replaceResourceSnapshot(snapshot);
  }

  normalizeResourceSnapshot(snapshot: ResourceSnapshot): ResourceSnapshot {
    return this.masterDataService.normalizeResourceSnapshot(snapshot);
  }

  resetResourcesToDefaults(): Promise<ResourceSnapshot> {
    return this.masterDataService.resetResourcesToDefaults();
  }

  resetPersonnelToDefaults(): Promise<ResourceSnapshot> {
    return this.masterDataService.resetPersonnelToDefaults();
  }

  resetVehiclesToDefaults(): Promise<ResourceSnapshot> {
    return this.masterDataService.resetVehiclesToDefaults();
  }

  resetTopologyToDefaults(): Promise<void> {
    return this.masterDataService.resetTopologyToDefaults();
  }

  getActivityCatalog(): ActivityCatalogSnapshot {
    return this.catalogService.getActivityCatalog();
  }

  replaceActivityCatalog(
    snapshot: ActivityCatalogSnapshot,
  ): Promise<ActivityCatalogSnapshot> {
    return this.catalogService.replaceActivityCatalog(snapshot);
  }

  listActivityTypes(): ActivityTypeDefinition[] {
    return this.catalogService.listActivityTypes();
  }

  getActivityType(typeId: string): ActivityTypeDefinition {
    return this.catalogService.getActivityType(typeId);
  }

  createActivityType(payload: ActivityTypeDefinition): Promise<ActivityTypeDefinition> {
    return this.catalogService.createActivityType(payload);
  }

  upsertActivityType(
    typeId: string,
    payload: ActivityTypeDefinition,
  ): Promise<ActivityTypeDefinition> {
    return this.catalogService.upsertActivityType(typeId, payload);
  }

  deleteActivityType(typeId: string): Promise<void> {
    return this.catalogService.deleteActivityType(typeId);
  }

  listActivityTemplates(): ActivityTemplate[] {
    return this.catalogService.listActivityTemplates();
  }

  getActivityTemplate(templateId: string): ActivityTemplate {
    return this.catalogService.getActivityTemplate(templateId);
  }

  createActivityTemplate(payload: ActivityTemplate): Promise<ActivityTemplate> {
    return this.catalogService.createActivityTemplate(payload);
  }

  upsertActivityTemplate(
    templateId: string,
    payload: ActivityTemplate,
  ): Promise<ActivityTemplate> {
    return this.catalogService.upsertActivityTemplate(templateId, payload);
  }

  deleteActivityTemplate(templateId: string): Promise<void> {
    return this.catalogService.deleteActivityTemplate(templateId);
  }

  listActivityDefinitions(): ActivityDefinition[] {
    return this.catalogService.listActivityDefinitions();
  }

  getActivityDefinition(definitionId: string): ActivityDefinition {
    return this.catalogService.getActivityDefinition(definitionId);
  }

  createActivityDefinition(payload: ActivityDefinition): Promise<ActivityDefinition> {
    return this.catalogService.createActivityDefinition(payload);
  }

  upsertActivityDefinition(
    definitionId: string,
    payload: ActivityDefinition,
  ): Promise<ActivityDefinition> {
    return this.catalogService.upsertActivityDefinition(definitionId, payload);
  }

  deleteActivityDefinition(definitionId: string): Promise<void> {
    return this.catalogService.deleteActivityDefinition(definitionId);
  }

  listLayerGroups(): LayerGroup[] {
    return this.catalogService.listLayerGroups();
  }

  getLayerGroup(layerId: string): LayerGroup {
    return this.catalogService.getLayerGroup(layerId);
  }

  createLayerGroup(payload: LayerGroup): Promise<LayerGroup> {
    return this.catalogService.createLayerGroup(payload);
  }

  upsertLayerGroup(layerId: string, payload: LayerGroup): Promise<LayerGroup> {
    return this.catalogService.upsertLayerGroup(layerId, payload);
  }

  deleteLayerGroup(layerId: string): Promise<void> {
    return this.catalogService.deleteLayerGroup(layerId);
  }

  getTranslations(): TranslationState {
    return this.catalogService.getTranslations();
  }

  replaceTranslations(payload: TranslationState): Promise<TranslationState> {
    return this.catalogService.replaceTranslations(payload);
  }

  getTranslationsForLocale(
    locale: string,
  ): Record<string, { label?: string | null; abbreviation?: string | null }> {
    return this.catalogService.getTranslationsForLocale(locale);
  }

  replaceTranslationsForLocale(
    locale: string,
    payload: Record<
      string,
      { label?: string | null; abbreviation?: string | null }
    >,
  ): Promise<
    Record<string, { label?: string | null; abbreviation?: string | null }>
  > {
    return this.catalogService.replaceTranslationsForLocale(locale, payload);
  }

  deleteTranslationsForLocale(locale: string): Promise<void> {
    return this.catalogService.deleteTranslationsForLocale(locale);
  }

  triggerTopologyImport(
    request?: TopologyImportRequest,
  ): Promise<TopologyImportResponse> {
    return this.topologyImportService.triggerTopologyImport(request);
  }

  streamTopologyImportEvents(): Observable<TopologyImportRealtimeEvent> {
    return this.topologyImportService.streamTopologyImportEvents();
  }

  publishTopologyImportEvent(
    request: TopologyImportEventRequest,
  ): TopologyImportRealtimeEvent {
    return this.topologyImportService.publishTopologyImportEvent(request);
  }
}
