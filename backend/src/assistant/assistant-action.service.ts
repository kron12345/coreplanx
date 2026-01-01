import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import {
  AssistantActionChangeDto,
  AssistantActionCommitRequestDto,
  AssistantActionCommitResponseDto,
  AssistantActionPreviewRequestDto,
  AssistantActionPreviewResponseDto,
  AssistantActionResolveRequestDto,
} from './assistant.dto';
import {
  OllamaOpenAiClient,
  OllamaOpenAiHttpError,
  OllamaOpenAiNetworkError,
  OllamaOpenAiTimeoutError,
} from './ollama-openai.client';
import { AssistantDocumentationService } from './assistant.documentation.service';
import { COREPLANX_ASSISTANT_ACTION_SYSTEM_PROMPT } from './assistant.action.system-prompt';
import { AssistantActionPreviewStore } from './assistant-action-preview.store';
import {
  AssistantActionClarificationApply,
  AssistantActionClarificationStore,
} from './assistant-action-clarification.store';
import { AssistantActionAuditService } from './assistant-action-audit.service';
import type {
  AssistantActionCommitTask,
  AssistantActionRefreshHint,
  AssistantActionTopologyScope,
} from './assistant-action.types';
import {
  applyMessageBudget,
  buildUiContextMessage,
} from './assistant-context-budget';
import { PlanningService } from '../planning/planning.service';
import { SYSTEM_POOL_IDS } from '../planning/planning-master-data.constants';
import { TimetableYearService } from '../variants/timetable-year.service';
import type {
  HomeDepot,
  OperationalPoint,
  OpReplacementStopLink,
  Personnel,
  PersonnelPool,
  PersonnelService,
  PersonnelServicePool,
  PersonnelSite,
  ResourceSnapshot,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  SectionOfLine,
  TemporalValue,
  TransferEdge,
  TransferNode,
  Vehicle,
  VehicleComposition,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
} from '../planning/planning.types';

type ActionPayload = {
  action?: string;
  schemaVersion?: number;
  reason?: string;
  pool?: unknown;
  poolName?: unknown;
  servicePool?: unknown;
  personnelServicePool?: unknown;
  vehicleServicePool?: unknown;
  personnelPool?: unknown;
  vehiclePool?: unknown;
  homeDepot?: unknown;
  homeDepots?: unknown;
  vehicleType?: unknown;
  vehicleTypes?: unknown;
  vehicleComposition?: unknown;
  vehicleCompositions?: unknown;
  timetableYear?: unknown;
  timetableYears?: unknown;
  simulation?: unknown;
  simulations?: unknown;
  operationalPoint?: unknown;
  operationalPoints?: unknown;
  sectionOfLine?: unknown;
  sectionsOfLine?: unknown;
  personnelSite?: unknown;
  personnelSites?: unknown;
  replacementStop?: unknown;
  replacementStops?: unknown;
  replacementRoute?: unknown;
  replacementRoutes?: unknown;
  replacementEdge?: unknown;
  replacementEdges?: unknown;
  opReplacementStopLink?: unknown;
  opReplacementStopLinks?: unknown;
  transferEdge?: unknown;
  transferEdges?: unknown;
  service?: unknown;
  services?: unknown;
  personnelService?: unknown;
  vehicleService?: unknown;
  personnel?: unknown;
  person?: unknown;
  people?: unknown;
  vehicles?: unknown;
  vehicle?: unknown;
  target?: unknown;
  patch?: unknown;
  items?: unknown;
  actions?: unknown[];
};

type ActionApplyAppliedOutcome = {
  type: 'applied';
  snapshot: ResourceSnapshot;
  summary: string;
  changes: AssistantActionChangeDto[];
  commitTasks?: AssistantActionCommitTask[];
  refreshHints?: AssistantActionRefreshHint[];
};

type ActionApplyFeedbackOutcome = {
  type: 'feedback';
  response: AssistantActionPreviewResponseDto;
};

type ActionApplyClarificationOutcome = {
  type: 'clarification';
  response: AssistantActionPreviewResponseDto;
};

type ActionApplyOutcome =
  | ActionApplyAppliedOutcome
  | ActionApplyFeedbackOutcome
  | ActionApplyClarificationOutcome;

type ClarificationRequest = {
  title: string;
  options: Array<{ id: string; label: string; details?: string }>;
  apply: AssistantActionClarificationApply;
};

type ActionContext = {
  clientId: string | null;
  role: string | null;
  rootPayload: ActionPayload;
  baseSnapshot: ResourceSnapshot;
  baseHash: string;
  pathPrefix: Array<string | number>;
  topologyState?: ActionTopologyState;
};

type ActionTopologyState = {
  operationalPoints: OperationalPoint[];
  sectionsOfLine: SectionOfLine[];
  personnelSites: PersonnelSite[];
  replacementStops: ReplacementStop[];
  replacementRoutes: ReplacementRoute[];
  replacementEdges: ReplacementEdge[];
  opReplacementStopLinks: OpReplacementStopLink[];
  transferEdges: TransferEdge[];
};

const ALLOWED_ACTIONS = new Set([
  'none',
  'batch',
  'create_personnel_service_pool',
  'create_vehicle_service_pool',
  'create_personnel_service',
  'create_vehicle_service',
  'create_personnel_pool',
  'create_vehicle_pool',
  'create_home_depot',
  'create_personnel',
  'create_vehicle',
  'create_vehicle_type',
  'create_vehicle_composition',
  'create_timetable_year',
  'create_simulation',
  'create_operational_point',
  'create_section_of_line',
  'create_personnel_site',
  'create_replacement_stop',
  'create_replacement_route',
  'create_replacement_edge',
  'create_op_replacement_stop_link',
  'create_transfer_edge',
  'update_personnel_service_pool',
  'update_vehicle_service_pool',
  'update_personnel_pool',
  'update_vehicle_pool',
  'update_home_depot',
  'update_personnel_service',
  'update_vehicle_service',
  'update_personnel',
  'update_vehicle',
  'update_vehicle_type',
  'update_vehicle_composition',
  'update_simulation',
  'update_operational_point',
  'update_section_of_line',
  'update_personnel_site',
  'update_replacement_stop',
  'update_replacement_route',
  'update_replacement_edge',
  'update_op_replacement_stop_link',
  'update_transfer_edge',
  'delete_personnel_service_pool',
  'delete_vehicle_service_pool',
  'delete_personnel_pool',
  'delete_vehicle_pool',
  'delete_home_depot',
  'delete_personnel_service',
  'delete_vehicle_service',
  'delete_personnel',
  'delete_vehicle',
  'delete_vehicle_type',
  'delete_vehicle_composition',
  'delete_timetable_year',
  'delete_simulation',
  'delete_operational_point',
  'delete_section_of_line',
  'delete_personnel_site',
  'delete_replacement_stop',
  'delete_replacement_route',
  'delete_replacement_edge',
  'delete_op_replacement_stop_link',
  'delete_transfer_edge',
]);

const ROOT_FIELDS_BY_ACTION: Record<string, string[]> = {
  none: ['action', 'reason'],
  batch: ['action', 'actions', 'reason'],
  create_personnel_service_pool: ['action', 'pool', 'services', 'reason'],
  create_vehicle_service_pool: ['action', 'pool', 'services', 'reason'],
  create_personnel_service: ['action', 'pool', 'services', 'items', 'reason'],
  create_vehicle_service: ['action', 'pool', 'services', 'items', 'reason'],
  create_personnel_pool: ['action', 'pool', 'reason'],
  create_vehicle_pool: ['action', 'pool', 'reason'],
  create_home_depot: ['action', 'homeDepot', 'homeDepots', 'items', 'reason'],
  create_personnel: ['action', 'personnel', 'pool', 'items', 'reason'],
  create_vehicle: ['action', 'vehicles', 'pool', 'items', 'reason'],
  create_vehicle_type: ['action', 'vehicleType', 'vehicleTypes', 'items', 'reason'],
  create_vehicle_composition: ['action', 'vehicleComposition', 'vehicleCompositions', 'items', 'reason'],
  create_timetable_year: ['action', 'timetableYear', 'timetableYears', 'items', 'reason'],
  create_simulation: ['action', 'simulation', 'simulations', 'items', 'reason'],
  create_operational_point: ['action', 'operationalPoint', 'operationalPoints', 'items', 'reason'],
  create_section_of_line: ['action', 'sectionOfLine', 'sectionsOfLine', 'items', 'reason'],
  create_personnel_site: ['action', 'personnelSite', 'personnelSites', 'items', 'reason'],
  create_replacement_stop: ['action', 'replacementStop', 'replacementStops', 'items', 'reason'],
  create_replacement_route: ['action', 'replacementRoute', 'replacementRoutes', 'items', 'reason'],
  create_replacement_edge: ['action', 'replacementEdge', 'replacementEdges', 'items', 'reason'],
  create_op_replacement_stop_link: ['action', 'opReplacementStopLink', 'opReplacementStopLinks', 'items', 'reason'],
  create_transfer_edge: ['action', 'transferEdge', 'transferEdges', 'items', 'reason'],
  update_personnel_service_pool: ['action', 'target', 'patch', 'reason'],
  update_vehicle_service_pool: ['action', 'target', 'patch', 'reason'],
  update_personnel_pool: ['action', 'target', 'patch', 'reason'],
  update_vehicle_pool: ['action', 'target', 'patch', 'reason'],
  update_home_depot: ['action', 'target', 'patch', 'reason'],
  update_personnel_service: ['action', 'target', 'patch', 'reason'],
  update_vehicle_service: ['action', 'target', 'patch', 'reason'],
  update_personnel: ['action', 'target', 'patch', 'reason'],
  update_vehicle: ['action', 'target', 'patch', 'reason'],
  update_vehicle_type: ['action', 'target', 'patch', 'reason'],
  update_vehicle_composition: ['action', 'target', 'patch', 'reason'],
  update_simulation: ['action', 'target', 'patch', 'reason'],
  update_operational_point: ['action', 'target', 'patch', 'reason'],
  update_section_of_line: ['action', 'target', 'patch', 'reason'],
  update_personnel_site: ['action', 'target', 'patch', 'reason'],
  update_replacement_stop: ['action', 'target', 'patch', 'reason'],
  update_replacement_route: ['action', 'target', 'patch', 'reason'],
  update_replacement_edge: ['action', 'target', 'patch', 'reason'],
  update_op_replacement_stop_link: ['action', 'target', 'patch', 'reason'],
  update_transfer_edge: ['action', 'target', 'patch', 'reason'],
  delete_personnel_service_pool: ['action', 'target', 'reason'],
  delete_vehicle_service_pool: ['action', 'target', 'reason'],
  delete_personnel_pool: ['action', 'target', 'reason'],
  delete_vehicle_pool: ['action', 'target', 'reason'],
  delete_home_depot: ['action', 'target', 'reason'],
  delete_personnel_service: ['action', 'target', 'reason'],
  delete_vehicle_service: ['action', 'target', 'reason'],
  delete_personnel: ['action', 'target', 'reason'],
  delete_vehicle: ['action', 'target', 'reason'],
  delete_vehicle_type: ['action', 'target', 'reason'],
  delete_vehicle_composition: ['action', 'target', 'reason'],
  delete_timetable_year: ['action', 'target', 'reason'],
  delete_simulation: ['action', 'target', 'reason'],
  delete_operational_point: ['action', 'target', 'reason'],
  delete_section_of_line: ['action', 'target', 'reason'],
  delete_personnel_site: ['action', 'target', 'reason'],
  delete_replacement_stop: ['action', 'target', 'reason'],
  delete_replacement_route: ['action', 'target', 'reason'],
  delete_replacement_edge: ['action', 'target', 'reason'],
  delete_op_replacement_stop_link: ['action', 'target', 'reason'],
  delete_transfer_edge: ['action', 'target', 'reason'],
};

const DEFAULT_ROOT_FIELDS = [
  'action',
  'schemaVersion',
  'reason',
  'pool',
  'poolName',
  'servicePool',
  'personnelServicePool',
  'vehicleServicePool',
  'personnelPool',
  'vehiclePool',
  'homeDepot',
  'homeDepots',
  'vehicleType',
  'vehicleTypes',
  'vehicleComposition',
  'vehicleCompositions',
  'timetableYear',
  'timetableYears',
  'simulation',
  'simulations',
  'operationalPoint',
  'operationalPoints',
  'sectionOfLine',
  'sectionsOfLine',
  'personnelSite',
  'personnelSites',
  'replacementStop',
  'replacementStops',
  'replacementRoute',
  'replacementRoutes',
  'replacementEdge',
  'replacementEdges',
  'opReplacementStopLink',
  'opReplacementStopLinks',
  'transferEdge',
  'transferEdges',
  'service',
  'services',
  'personnelService',
  'vehicleService',
  'personnel',
  'person',
  'people',
  'vehicles',
  'vehicle',
  'target',
  'patch',
  'items',
  'actions',
];

const POOL_KEYS = [
  'id',
  'poolId',
  'name',
  'poolName',
  'description',
  'homeDepot',
  'homeDepotId',
  'homeDepotName',
  'shiftCoordinator',
  'contactEmail',
  'dispatcher',
  'depotManager',
  'locationCode',
];

const SERVICE_KEYS = [
  'id',
  'name',
  'serviceName',
  'description',
  'startTime',
  'endTime',
  'isNightService',
  'requiredQualifications',
  'maxDailyInstances',
  'maxResourcesPerInstance',
  'isOvernight',
  'primaryRoute',
  'pool',
  'poolName',
  'poolId',
  'requiredVehicleTypeIds',
];

const PERSONNEL_KEYS = [
  'id',
  'firstName',
  'lastName',
  'preferredName',
  'name',
  'fullName',
  'label',
  'pool',
  'poolName',
  'poolId',
  'qualifications',
  'qualification',
  'services',
  'serviceNames',
  'serviceIds',
  'homeStation',
  'availabilityStatus',
  'qualificationExpires',
  'isReserve',
];

const VEHICLE_KEYS = [
  'id',
  'vehicleNumber',
  'number',
  'name',
  'typeId',
  'type',
  'typeLabel',
  'vehicleType',
  'pool',
  'poolName',
  'poolId',
  'services',
  'serviceNames',
  'serviceIds',
  'description',
  'depot',
];

const TARGET_KEYS = [
  'id',
  'poolId',
  'poolName',
  'servicePoolName',
  'name',
  'firstName',
  'lastName',
  'fullName',
  'label',
  'homeDepotId',
  'homeDepotName',
  'timetableYearLabel',
  'variantId',
  'simulationId',
  'opId',
  'uniqueOpId',
  'solId',
  'siteId',
  'replacementStopId',
  'replacementRouteId',
  'replacementEdgeId',
  'linkId',
  'transferId',
  'stopCode',
  'compositionId',
  'personnelId',
  'vehicleId',
  'vehicleNumber',
  'number',
  'serviceName',
  'type',
  'typeId',
  'typeLabel',
  'vehicleType',
];

const PATCH_KEYS = [
  'name',
  'fullName',
  'firstName',
  'lastName',
  'preferredName',
  'description',
  'label',
  'category',
  'capacity',
  'maxSpeed',
  'energyType',
  'manufacturer',
  'trainTypeCode',
  'lengthMeters',
  'weightTons',
  'brakeType',
  'brakePercentage',
  'tiltingCapability',
  'powerSupplySystems',
  'trainProtectionSystems',
  'etcsLevel',
  'gaugeProfile',
  'maintenanceIntervalDays',
  'maxAxleLoad',
  'noiseCategory',
  'remarks',
  'entries',
  'entriesSerialized',
  'turnaroundBuffer',
  'remark',
  'opId',
  'uniqueOpId',
  'countryCode',
  'opType',
  'lat',
  'lng',
  'position',
  'solId',
  'startUniqueOpId',
  'endUniqueOpId',
  'lengthKm',
  'nature',
  'siteId',
  'siteType',
  'openingHoursJson',
  'replacementStopId',
  'stopCode',
  'nearestUniqueOpId',
  'replacementRouteId',
  'replacementEdgeId',
  'fromStopId',
  'toStopId',
  'seq',
  'avgDurationSec',
  'distanceM',
  'linkId',
  'relationType',
  'walkingTimeSec',
  'transferId',
  'from',
  'to',
  'mode',
  'bidirectional',
  'siteIds',
  'breakSiteIds',
  'shortBreakSiteIds',
  'overnightSiteIds',
  'homeDepot',
  'homeDepotId',
  'homeDepotName',
  'shiftCoordinator',
  'contactEmail',
  'dispatcher',
  'locationCode',
  'depotManager',
  'startTime',
  'endTime',
  'isNightService',
  'isOvernight',
  'requiredQualifications',
  'qualifications',
  'qualification',
  'maxDailyInstances',
  'maxResourcesPerInstance',
  'primaryRoute',
  'pool',
  'poolName',
  'poolId',
  'services',
  'serviceNames',
  'serviceIds',
  'homeStation',
  'availabilityStatus',
  'qualificationExpires',
  'isReserve',
  'vehicleNumber',
  'number',
  'typeId',
  'type',
  'typeLabel',
  'vehicleType',
  'depot',
];

const HOME_DEPOT_KEYS = [
  'id',
  'name',
  'description',
  'siteIds',
  'breakSiteIds',
  'shortBreakSiteIds',
  'overnightSiteIds',
];

const VEHICLE_TYPE_KEYS = [
  'id',
  'label',
  'category',
  'capacity',
  'maxSpeed',
  'energyType',
  'manufacturer',
  'trainTypeCode',
  'lengthMeters',
  'weightTons',
  'brakeType',
  'brakePercentage',
  'tiltingCapability',
  'powerSupplySystems',
  'trainProtectionSystems',
  'etcsLevel',
  'gaugeProfile',
  'maintenanceIntervalDays',
  'maxAxleLoad',
  'noiseCategory',
  'remarks',
];

const VEHICLE_COMPOSITION_KEYS = [
  'id',
  'name',
  'entries',
  'entriesSerialized',
  'turnaroundBuffer',
  'remark',
];

const TIMETABLE_YEAR_KEYS = ['id', 'label', 'startIso', 'endIso', 'description'];

const SIMULATION_KEYS = ['id', 'variantId', 'label', 'timetableYearLabel', 'description'];

const OPERATIONAL_POINT_KEYS = [
  'id',
  'opId',
  'uniqueOpId',
  'name',
  'countryCode',
  'opType',
  'lat',
  'lng',
  'position',
  'attributes',
];

const SECTION_OF_LINE_KEYS = [
  'id',
  'solId',
  'startUniqueOpId',
  'endUniqueOpId',
  'lengthKm',
  'nature',
  'attributes',
];

const PERSONNEL_SITE_KEYS = [
  'id',
  'siteId',
  'siteType',
  'name',
  'uniqueOpId',
  'lat',
  'lng',
  'position',
  'openingHoursJson',
  'attributes',
];

const REPLACEMENT_STOP_KEYS = [
  'id',
  'replacementStopId',
  'name',
  'stopCode',
  'nearestUniqueOpId',
  'lat',
  'lng',
  'position',
  'attributes',
];

const REPLACEMENT_ROUTE_KEYS = ['id', 'replacementRouteId', 'name', 'operator', 'attributes'];

const REPLACEMENT_EDGE_KEYS = [
  'id',
  'replacementEdgeId',
  'replacementRouteId',
  'fromStopId',
  'toStopId',
  'seq',
  'avgDurationSec',
  'distanceM',
  'attributes',
];

const OP_REPLACEMENT_STOP_LINK_KEYS = [
  'id',
  'linkId',
  'uniqueOpId',
  'replacementStopId',
  'relationType',
  'walkingTimeSec',
  'distanceM',
  'attributes',
];

const TRANSFER_EDGE_KEYS = [
  'id',
  'transferId',
  'from',
  'to',
  'mode',
  'avgDurationSec',
  'distanceM',
  'bidirectional',
  'attributes',
];

const PERSONNEL_SITE_TYPES = new Set(['MELDESTELLE', 'PAUSENRAUM', 'BEREITSCHAFT', 'BÜRO']);
const SECTION_OF_LINE_NATURES = new Set(['REGULAR', 'LINK']);
const OP_REPLACEMENT_RELATIONS = new Set(['PRIMARY_SEV_STOP', 'ALTERNATIVE', 'TEMPORARY']);
const TRANSFER_MODES = new Set(['WALK', 'SHUTTLE', 'INTERNAL']);

@Injectable()
export class AssistantActionService {
  private readonly logger = new Logger(AssistantActionService.name);

  constructor(
    @Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig,
    private readonly docs: AssistantDocumentationService,
    private readonly planning: PlanningService,
    private readonly timetableYears: TimetableYearService,
    private readonly ollama: OllamaOpenAiClient,
    private readonly previews: AssistantActionPreviewStore,
    private readonly clarifications: AssistantActionClarificationStore,
    private readonly audit: AssistantActionAuditService,
  ) {}

  async preview(
    request: AssistantActionPreviewRequestDto,
    role?: string | null,
  ): Promise<AssistantActionPreviewResponseDto> {
    const prompt = request.prompt?.trim() ?? '';
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }

    const uiContext = this.sanitizeUiContext(request.uiContext);
    const normalizedRole = this.normalizeRole(role);
    const contextMessages = this.buildContextMessages(uiContext);
    const messages = [
      { role: 'system' as const, content: COREPLANX_ASSISTANT_ACTION_SYSTEM_PROMPT },
      ...contextMessages,
      { role: 'user' as const, content: prompt },
    ];

    const firstAttempt = await this.requestActionPayload(messages);
    let payload = firstAttempt.payload;
    if (!payload && this.config.actionRetryInvalid) {
      const retryMessages = [
        ...messages,
        ...(firstAttempt.rawResponse
          ? [{ role: 'assistant' as const, content: firstAttempt.rawResponse }]
          : []),
        {
          role: 'system' as const,
          content: `Deine letzte Antwort war ungueltig (${firstAttempt.error ?? 'unbekannter Fehler'}). Antworte nur mit JSON gemaess Schema.`,
        },
      ];
      const secondAttempt = await this.requestActionPayload(retryMessages);
      payload = secondAttempt.payload;
      if (!payload) {
        return this.buildFeedbackResponse(
          secondAttempt.error ?? 'Keine erkennbare Aktion gefunden.',
        ).response;
      }
    }

    if (!payload?.action) {
      return this.buildFeedbackResponse('Keine erkennbare Aktion gefunden.').response;
    }
    if (payload.action === 'none') {
      return this.buildFeedbackResponse(
        this.cleanText(payload.reason) ?? 'Keine Aktion erkannt.',
      ).response;
    }

    const baseSnapshot = this.planning.getResourceSnapshot();
    const baseHash = this.hashSnapshot(baseSnapshot);
    const context: ActionContext = {
      clientId: request.clientId ?? null,
      role: normalizedRole,
      rootPayload: payload,
      baseSnapshot,
      baseHash,
      pathPrefix: [],
      topologyState: this.buildTopologyState(),
    };
    const outcome = this.applyAction(payload, baseSnapshot, context);
    const response = this.finalizePreviewOutcome(
      outcome,
      context.clientId,
      context.baseHash,
      context.role,
    );
    if (outcome.type === 'applied') {
      this.audit.recordPreview({
        previewId: response.previewId,
        clientId: context.clientId,
        role: context.role,
        summary: outcome.summary,
        changes: outcome.changes,
        payload: payload as Record<string, unknown>,
        baseSnapshot,
        nextSnapshot: outcome.snapshot,
      });
    }
    return response;
  }

  async commit(
    request: AssistantActionCommitRequestDto,
    role?: string | null,
  ): Promise<AssistantActionCommitResponseDto> {
    let preview: ReturnType<AssistantActionPreviewStore['get']>;
    try {
      preview = this.previews.get(
        request.previewId,
        request.clientId ?? null,
        this.normalizeRole(role),
      );
    } catch (error) {
      if ((error as Error)?.message?.includes('belongs to another client')) {
        throw new ForbiddenException('previewId is owned by another client');
      }
      if ((error as Error)?.message?.includes('belongs to another role')) {
        throw new ForbiddenException('previewId is owned by another role');
      }
      throw error;
    }

    if (!preview) {
      throw new BadRequestException('previewId not found or expired');
    }

    const currentSnapshot = this.planning.getResourceSnapshot();
    const currentHash = this.hashSnapshot(currentSnapshot);
    if (preview.baseHash && preview.baseHash !== currentHash) {
      this.audit.recordConflict({
        previewId: preview.id,
        clientId: preview.clientId ?? request.clientId ?? null,
        role: preview.role ?? null,
        reason: 'preview-stale',
      });
      throw new ConflictException(
        'Stammdaten wurden zwischenzeitlich aktualisiert. Bitte Vorschau erneut erzeugen.',
      );
    }

    const snapshot = await this.planning.replaceResourceSnapshot(preview.snapshot);
    if (preview.commitTasks && preview.commitTasks.length) {
      await this.applyCommitTasks(preview.commitTasks);
    }
    const refreshHints =
      preview.refreshHints?.length
        ? preview.refreshHints
        : this.collectRefreshHints(preview.commitTasks);
    this.audit.recordCommit({
      previewId: preview.id,
      clientId: preview.clientId ?? request.clientId ?? null,
      role: preview.role ?? null,
      summary: preview.summary,
      changes: preview.changes,
      baseSnapshot: currentSnapshot,
      nextSnapshot: snapshot,
    });
    this.previews.delete(preview.id);
    return {
      applied: true,
      snapshot,
      refresh: refreshHints.length ? refreshHints : undefined,
    };
  }

  private async applyCommitTasks(tasks: AssistantActionCommitTask[]): Promise<void> {
    for (const task of tasks) {
      switch (task.type) {
        case 'timetableYear': {
          const label = task.label?.trim();
          if (!label) {
            throw new BadRequestException('Fahrplanjahr-Label fehlt.');
          }
          if (task.action === 'create') {
            await this.timetableYears.createYear(label);
            break;
          }
          if (task.action === 'delete') {
            await this.timetableYears.deleteYear(label);
            break;
          }
          break;
        }
        case 'simulation': {
          if (task.action === 'create') {
            const yearLabel = task.timetableYearLabel?.trim();
            const label = task.label?.trim();
            if (!yearLabel) {
              throw new BadRequestException('Fahrplanjahr fuer Simulation fehlt.');
            }
            if (!label) {
              throw new BadRequestException('Simulationstitel fehlt.');
            }
            await this.timetableYears.createSimulationVariant({
              timetableYearLabel: yearLabel,
              label,
              description: task.description ?? null,
            });
            break;
          }
          const variantId =
            task.variantId?.trim() ||
            (await this.resolveSimulationVariantId({
              label: task.targetLabel ?? task.label,
              timetableYearLabel: task.targetTimetableYearLabel ?? task.timetableYearLabel,
            }));
          if (!variantId) {
            throw new BadRequestException('Simulation konnte nicht aufgeloest werden.');
          }
          if (task.action === 'update') {
            await this.timetableYears.updateSimulationVariant(variantId, {
              label: task.label,
              description: task.description ?? null,
            });
            break;
          }
          if (task.action === 'delete') {
            await this.timetableYears.deleteVariant(variantId);
            break;
          }
          break;
        }
        case 'topology': {
          await this.applyTopologyCommitTask(task);
          break;
        }
        default:
          break;
      }
    }
  }

  private async applyTopologyCommitTask(
    task: Extract<AssistantActionCommitTask, { type: 'topology' }>,
  ): Promise<void> {
    switch (task.scope) {
      case 'operationalPoints':
        await this.planning.saveOperationalPoints({ items: task.items as OperationalPoint[] });
        return;
      case 'sectionsOfLine':
        await this.planning.saveSectionsOfLine({ items: task.items as SectionOfLine[] });
        return;
      case 'personnelSites':
        await this.planning.savePersonnelSites({ items: task.items as PersonnelSite[] });
        return;
      case 'replacementStops':
        await this.planning.saveReplacementStops({ items: task.items as ReplacementStop[] });
        return;
      case 'replacementRoutes':
        await this.planning.saveReplacementRoutes({ items: task.items as ReplacementRoute[] });
        return;
      case 'replacementEdges':
        await this.planning.saveReplacementEdges({ items: task.items as ReplacementEdge[] });
        return;
      case 'opReplacementStopLinks':
        await this.planning.saveOpReplacementStopLinks({ items: task.items as OpReplacementStopLink[] });
        return;
      case 'transferEdges':
        await this.planning.saveTransferEdges({ items: task.items as TransferEdge[] });
        return;
      default:
        return;
    }
  }

  async resolve(
    request: AssistantActionResolveRequestDto,
    role?: string | null,
  ): Promise<AssistantActionPreviewResponseDto> {
    let clarification: ReturnType<AssistantActionClarificationStore['get']>;
    try {
      clarification = this.clarifications.get(
        request.resolutionId,
        request.clientId ?? null,
        this.normalizeRole(role),
      );
    } catch (error) {
      if ((error as Error)?.message?.includes('belongs to another client')) {
        throw new ForbiddenException('resolutionId is owned by another client');
      }
      if ((error as Error)?.message?.includes('belongs to another role')) {
        throw new ForbiddenException('resolutionId is owned by another role');
      }
      throw error;
    }

    if (!clarification) {
      throw new BadRequestException('resolutionId not found or expired');
    }

    const currentSnapshot = this.planning.getResourceSnapshot();
    const currentHash = this.hashSnapshot(currentSnapshot);
    if (clarification.baseHash && clarification.baseHash !== currentHash) {
      this.clarifications.delete(clarification.id);
      this.audit.recordConflict({
        previewId: clarification.id,
        clientId: clarification.clientId ?? request.clientId ?? null,
        role: clarification.role ?? null,
        reason: 'clarification-stale',
      });
      throw new ConflictException(
        'Stammdaten wurden zwischenzeitlich aktualisiert. Bitte erneut versuchen.',
      );
    }

    const selectedId = request.selectedId?.trim?.() ?? '';
    if (!selectedId) {
      throw new BadRequestException('selectedId is required');
    }
    if (!clarification.options.some((option) => option.id === selectedId)) {
      throw new BadRequestException('selectedId is not a valid option');
    }

    const payload = this.clonePayload(clarification.payload) as ActionPayload;
    this.applyResolution(payload, clarification.apply, selectedId);

    const baseSnapshot = clarification.snapshot;
    const context: ActionContext = {
      clientId: clarification.clientId ?? request.clientId ?? null,
      role: clarification.role ?? null,
      rootPayload: payload,
      baseSnapshot,
      baseHash: clarification.baseHash ?? this.hashSnapshot(baseSnapshot),
      pathPrefix: [],
      topologyState: this.buildTopologyState(),
    };

    this.clarifications.delete(clarification.id);
    const outcome = this.applyAction(payload, baseSnapshot, context);
    const response = this.finalizePreviewOutcome(
      outcome,
      context.clientId,
      context.baseHash,
      context.role,
    );
    if (outcome.type === 'applied') {
      this.audit.recordPreview({
        previewId: response.previewId,
        clientId: context.clientId,
        role: context.role,
        summary: outcome.summary,
        changes: outcome.changes,
        payload: payload as Record<string, unknown>,
        baseSnapshot,
        nextSnapshot: outcome.snapshot,
      });
    }
    return response;
  }

  private applyAction(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    if (!payload.action) {
      return this.buildFeedbackResponse('Aktion fehlt.');
    }
    if (payload.action === 'batch') {
      return this.applyBatch(payload, snapshot, context);
    }
    if (!this.isActionAllowed(payload.action, context.role)) {
      return this.buildFeedbackResponse('Aktion ist fuer diese Rolle nicht erlaubt.');
    }

    switch (payload.action) {
      case 'create_personnel_service_pool':
        return this.buildPersonnelServicePoolPreview(payload, snapshot, context);
      case 'create_vehicle_service_pool':
        return this.buildVehicleServicePoolPreview(payload, snapshot, context);
      case 'create_personnel_service':
        return this.buildPersonnelServicePreview(payload, snapshot, context);
      case 'create_vehicle_service':
        return this.buildVehicleServicePreview(payload, snapshot, context);
      case 'create_personnel_pool':
        return this.buildPersonnelPoolPreview(payload, snapshot, context);
      case 'create_vehicle_pool':
        return this.buildVehiclePoolPreview(payload, snapshot, context);
      case 'create_home_depot':
        return this.buildHomeDepotPreview(payload, snapshot, context);
      case 'create_personnel':
        return this.buildPersonnelPreview(payload, snapshot, context);
      case 'create_vehicle':
        return this.buildVehiclePreview(payload, snapshot, context);
      case 'create_vehicle_type':
        return this.buildVehicleTypePreview(payload, snapshot, context);
      case 'create_vehicle_composition':
        return this.buildVehicleCompositionPreview(payload, snapshot, context);
      case 'create_timetable_year':
        return this.buildTimetableYearPreview(payload, snapshot, context);
      case 'create_simulation':
        return this.buildSimulationPreview(payload, snapshot, context);
      case 'create_operational_point':
        return this.buildOperationalPointPreview(payload, snapshot, context);
      case 'create_section_of_line':
        return this.buildSectionOfLinePreview(payload, snapshot, context);
      case 'create_personnel_site':
        return this.buildPersonnelSitePreview(payload, snapshot, context);
      case 'create_replacement_stop':
        return this.buildReplacementStopPreview(payload, snapshot, context);
      case 'create_replacement_route':
        return this.buildReplacementRoutePreview(payload, snapshot, context);
      case 'create_replacement_edge':
        return this.buildReplacementEdgePreview(payload, snapshot, context);
      case 'create_op_replacement_stop_link':
        return this.buildOpReplacementStopLinkPreview(payload, snapshot, context);
      case 'create_transfer_edge':
        return this.buildTransferEdgePreview(payload, snapshot, context);
      case 'update_personnel_service_pool':
        return this.buildUpdatePersonnelServicePoolPreview(payload, snapshot, context);
      case 'update_vehicle_service_pool':
        return this.buildUpdateVehicleServicePoolPreview(payload, snapshot, context);
      case 'update_personnel_pool':
        return this.buildUpdatePersonnelPoolPreview(payload, snapshot, context);
      case 'update_vehicle_pool':
        return this.buildUpdateVehiclePoolPreview(payload, snapshot, context);
      case 'update_home_depot':
        return this.buildUpdateHomeDepotPreview(payload, snapshot, context);
      case 'update_personnel_service':
        return this.buildUpdatePersonnelServicePreview(payload, snapshot, context);
      case 'update_vehicle_service':
        return this.buildUpdateVehicleServicePreview(payload, snapshot, context);
      case 'update_personnel':
        return this.buildUpdatePersonnelPreview(payload, snapshot, context);
      case 'update_vehicle':
        return this.buildUpdateVehiclePreview(payload, snapshot, context);
      case 'update_vehicle_type':
        return this.buildUpdateVehicleTypePreview(payload, snapshot, context);
      case 'update_vehicle_composition':
        return this.buildUpdateVehicleCompositionPreview(payload, snapshot, context);
      case 'update_simulation':
        return this.buildUpdateSimulationPreview(payload, snapshot, context);
      case 'update_operational_point':
        return this.buildUpdateOperationalPointPreview(payload, snapshot, context);
      case 'update_section_of_line':
        return this.buildUpdateSectionOfLinePreview(payload, snapshot, context);
      case 'update_personnel_site':
        return this.buildUpdatePersonnelSitePreview(payload, snapshot, context);
      case 'update_replacement_stop':
        return this.buildUpdateReplacementStopPreview(payload, snapshot, context);
      case 'update_replacement_route':
        return this.buildUpdateReplacementRoutePreview(payload, snapshot, context);
      case 'update_replacement_edge':
        return this.buildUpdateReplacementEdgePreview(payload, snapshot, context);
      case 'update_op_replacement_stop_link':
        return this.buildUpdateOpReplacementStopLinkPreview(payload, snapshot, context);
      case 'update_transfer_edge':
        return this.buildUpdateTransferEdgePreview(payload, snapshot, context);
      case 'delete_personnel_service_pool':
        return this.buildDeletePersonnelServicePoolPreview(payload, snapshot, context);
      case 'delete_vehicle_service_pool':
        return this.buildDeleteVehicleServicePoolPreview(payload, snapshot, context);
      case 'delete_personnel_pool':
        return this.buildDeletePersonnelPoolPreview(payload, snapshot, context);
      case 'delete_vehicle_pool':
        return this.buildDeleteVehiclePoolPreview(payload, snapshot, context);
      case 'delete_home_depot':
        return this.buildDeleteHomeDepotPreview(payload, snapshot, context);
      case 'delete_personnel_service':
        return this.buildDeletePersonnelServicePreview(payload, snapshot, context);
      case 'delete_vehicle_service':
        return this.buildDeleteVehicleServicePreview(payload, snapshot, context);
      case 'delete_personnel':
        return this.buildDeletePersonnelPreview(payload, snapshot, context);
      case 'delete_vehicle':
        return this.buildDeleteVehiclePreview(payload, snapshot, context);
      case 'delete_vehicle_type':
        return this.buildDeleteVehicleTypePreview(payload, snapshot, context);
      case 'delete_vehicle_composition':
        return this.buildDeleteVehicleCompositionPreview(payload, snapshot, context);
      case 'delete_timetable_year':
        return this.buildDeleteTimetableYearPreview(payload, snapshot, context);
      case 'delete_simulation':
        return this.buildDeleteSimulationPreview(payload, snapshot, context);
      case 'delete_operational_point':
        return this.buildDeleteOperationalPointPreview(payload, snapshot, context);
      case 'delete_section_of_line':
        return this.buildDeleteSectionOfLinePreview(payload, snapshot, context);
      case 'delete_personnel_site':
        return this.buildDeletePersonnelSitePreview(payload, snapshot, context);
      case 'delete_replacement_stop':
        return this.buildDeleteReplacementStopPreview(payload, snapshot, context);
      case 'delete_replacement_route':
        return this.buildDeleteReplacementRoutePreview(payload, snapshot, context);
      case 'delete_replacement_edge':
        return this.buildDeleteReplacementEdgePreview(payload, snapshot, context);
      case 'delete_op_replacement_stop_link':
        return this.buildDeleteOpReplacementStopLinkPreview(payload, snapshot, context);
      case 'delete_transfer_edge':
        return this.buildDeleteTransferEdgePreview(payload, snapshot, context);
      default:
        return this.buildFeedbackResponse(
          `Aktion '${payload.action}' wird noch nicht unterstützt.`,
        );
    }
  }

  private applyBatch(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const rawActions = Array.isArray(payload.actions) ? payload.actions : [];
    if (!rawActions.length) {
      return this.buildFeedbackResponse('Batch ohne Aktionen.');
    }

    const actions: ActionPayload[] = [];
    for (let i = 0; i < rawActions.length; i += 1) {
      const record = this.asRecord(rawActions[i]);
      if (!record) {
        return this.buildFeedbackResponse(`Batch-Aktion ${i + 1} ist ungueltig.`);
      }
      const actionPayload = record as ActionPayload;
      if (!actionPayload.action || typeof actionPayload.action !== 'string') {
        return this.buildFeedbackResponse(`Batch-Aktion ${i + 1} fehlt "action".`);
      }
      actions.push(actionPayload);
    }

    let working = snapshot;
    const changes: AssistantActionChangeDto[] = [];
    const summaries: string[] = [];
    let commitTasks: AssistantActionCommitTask[] = [];
    let refreshHints: AssistantActionRefreshHint[] = [];

    for (let i = 0; i < actions.length; i += 1) {
      const actionPayload = actions[i];
      const outcome = this.applyAction(actionPayload, working, {
        ...context,
        pathPrefix: [...context.pathPrefix, 'actions', i],
      });
      if (outcome.type !== 'applied') {
        return outcome;
      }
      working = outcome.snapshot;
      summaries.push(outcome.summary);
      changes.push(...outcome.changes);
      if (outcome.commitTasks && outcome.commitTasks.length) {
        commitTasks = this.mergeCommitTasks(commitTasks, outcome.commitTasks);
      }
      if (outcome.refreshHints && outcome.refreshHints.length) {
        refreshHints = this.mergeRefreshHints(refreshHints, outcome.refreshHints);
      }
    }

    const summary = this.formatBatchSummary(summaries);
    return {
      type: 'applied',
      snapshot: working,
      summary,
      changes,
      commitTasks: commitTasks.length ? commitTasks : undefined,
      refreshHints: refreshHints.length ? refreshHints : undefined,
    };
  }

  private finalizePreviewOutcome(
    outcome: ActionApplyOutcome,
    clientId: string | null,
    baseHash: string,
    role: string | null,
  ): AssistantActionPreviewResponseDto {
    if (outcome.type !== 'applied') {
      return outcome.response;
    }
    const previewId = randomUUID();
    const refreshHints =
      outcome.refreshHints?.length ? outcome.refreshHints : this.collectRefreshHints(outcome.commitTasks);
    this.previews.create({
      id: previewId,
      clientId,
      role,
      summary: outcome.summary,
      changes: outcome.changes,
      snapshot: outcome.snapshot,
      baseHash,
      commitTasks: outcome.commitTasks,
      refreshHints: refreshHints.length ? refreshHints : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      actionable: true,
      previewId,
      summary: outcome.summary,
      changes: outcome.changes,
    };
  }

  private buildFeedbackResponse(message: string): ActionApplyFeedbackOutcome {
    return {
      type: 'feedback',
      response: {
        actionable: false,
        feedback: message,
      },
    };
  }

  private buildClarificationResponse(
    clarification: ClarificationRequest,
    context: ActionContext,
  ): ActionApplyClarificationOutcome {
    const resolutionId = randomUUID();
    const apply: AssistantActionClarificationApply = {
      ...clarification.apply,
      path: [...context.pathPrefix, ...clarification.apply.path],
    };
    this.clarifications.create({
      id: resolutionId,
      clientId: context.clientId,
      role: context.role,
      payload: context.rootPayload as Record<string, unknown>,
      snapshot: context.baseSnapshot,
      baseHash: context.baseHash,
      apply,
      options: clarification.options,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      type: 'clarification',
      response: {
        actionable: false,
        clarification: {
          resolutionId,
          title: clarification.title,
          options: clarification.options,
        },
      },
    };
  }

  private applyResolution(
    payload: Record<string, unknown>,
    apply: AssistantActionClarificationApply,
    selectedId: string,
  ): void {
    const value = apply.mode === 'target' ? { id: selectedId } : selectedId;
    this.setValueAtPath(payload, apply.path, value);
  }

  private clonePayload<T>(payload: T): T {
    return JSON.parse(JSON.stringify(payload)) as T;
  }

  private cloneList<T>(items: T[]): T[] {
    return items.map((item) => JSON.parse(JSON.stringify(item)) as T);
  }

  private buildTopologyState(): ActionTopologyState {
    return {
      operationalPoints: this.cloneList(this.planning.listOperationalPoints()),
      sectionsOfLine: this.cloneList(this.planning.listSectionsOfLine()),
      personnelSites: this.cloneList(this.planning.listPersonnelSites()),
      replacementStops: this.cloneList(this.planning.listReplacementStops()),
      replacementRoutes: this.cloneList(this.planning.listReplacementRoutes()),
      replacementEdges: this.cloneList(this.planning.listReplacementEdges()),
      opReplacementStopLinks: this.cloneList(this.planning.listOpReplacementStopLinks()),
      transferEdges: this.cloneList(this.planning.listTransferEdges()),
    };
  }

  private hashSnapshot(snapshot: ResourceSnapshot): string {
    const serialized = this.stableStringify(snapshot);
    return createHash('sha256').update(serialized).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }

  private setValueAtPath(
    root: Record<string, unknown>,
    path: Array<string | number>,
    value: unknown,
  ): void {
    if (!path.length) {
      return;
    }
    let current: unknown = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      const nextKey = path[index + 1];
      if (typeof key === 'number') {
        if (!Array.isArray(current)) {
          return;
        }
        if (
          current[key] === undefined ||
          current[key] === null ||
          typeof current[key] !== 'object'
        ) {
          current[key] = typeof nextKey === 'number' ? [] : {};
        }
        current = current[key];
        continue;
      }
      if (!current || typeof current !== 'object') {
        return;
      }
      const record = current as Record<string, unknown>;
      if (
        record[key] === undefined ||
        record[key] === null ||
        typeof record[key] !== 'object'
      ) {
        record[key] = typeof nextKey === 'number' ? [] : {};
      }
      current = record[key];
    }

    const lastKey = path[path.length - 1];
    if (typeof lastKey === 'number') {
      if (!Array.isArray(current)) {
        return;
      }
      current[lastKey] = value;
      return;
    }
    if (!current || typeof current !== 'object') {
      return;
    }
    (current as Record<string, unknown>)[lastKey] = value;
  }

  private formatBatchSummary(summaries: string[]): string {
    if (!summaries.length) {
      return 'Batch ohne Änderungen.';
    }
    if (summaries.length === 1) {
      return summaries[0];
    }
    const listed = summaries.slice(0, 3).join('; ');
    const suffix = summaries.length > 3 ? ' ...' : '';
    return `Batch (${summaries.length} Aktionen): ${listed}${suffix}`;
  }

  private mergeCommitTasks(
    base: AssistantActionCommitTask[],
    incoming: AssistantActionCommitTask[],
  ): AssistantActionCommitTask[] {
    const next = [...base];
    for (const task of incoming) {
      if (task.type === 'topology') {
        const index = next.findIndex(
          (existing) => existing.type === 'topology' && existing.scope === task.scope,
        );
        if (index >= 0) {
          next[index] = task;
        } else {
          next.push(task);
        }
        continue;
      }
      next.push(task);
    }
    return next;
  }

  private mergeRefreshHints(
    base: AssistantActionRefreshHint[],
    incoming: AssistantActionRefreshHint[],
  ): AssistantActionRefreshHint[] {
    const next = new Set(base);
    for (const hint of incoming) {
      next.add(hint);
    }
    return Array.from(next);
  }

  private collectRefreshHints(
    tasks?: AssistantActionCommitTask[],
  ): AssistantActionRefreshHint[] {
    if (!tasks || !tasks.length) {
      return [];
    }
    const hints = new Set<AssistantActionRefreshHint>();
    for (const task of tasks) {
      if (task.type === 'topology') {
        hints.add('topology');
      }
      if (task.type === 'simulation') {
        hints.add('simulations');
      }
      if (task.type === 'timetableYear') {
        hints.add('timetable-years');
      }
    }
    return Array.from(hints);
  }

  private findDuplicateNames(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const normalized = this.normalizeKey(value);
      if (seen.has(normalized)) {
        if (!duplicates.has(normalized)) {
          duplicates.add(normalized);
          result.push(value);
        }
        continue;
      }
      seen.add(normalized);
    }
    return result;
  }

  private buildPersonnelServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const poolRaw = payload.pool;
    const poolRecord = this.asRecord(poolRaw) ?? {};
    const payloadRecord = payload as Record<string, unknown>;
    const poolName =
      this.cleanText(typeof poolRaw === 'string' ? poolRaw : poolRecord['name']) ??
      this.cleanText(poolRecord['poolName']) ??
      this.cleanText(payloadRecord['poolName']);
    if (!poolName) {
      return this.buildFeedbackResponse('Poolname fehlt.');
    }

    const services = this.normalizePersonnelServices(
      Array.isArray(payload.services) ? payload.services : [],
    );
    if (!services.length) {
      return this.buildFeedbackResponse('Mindestens ein Dienst wird benötigt.');
    }

    if (this.hasNameCollision(snapshot.personnelServicePools, poolName)) {
      return this.buildFeedbackResponse(
        `Personaldienstpool "${poolName}" existiert bereits.`,
      );
    }
    const duplicateNames = this.findDuplicateNames(services.map((service) => service.name));
    if (duplicateNames.length) {
      return this.buildFeedbackResponse(
        `Dienste doppelt angegeben: ${duplicateNames.join(', ')}`,
      );
    }
    const depotRef = this.parsePoolReference(
      poolRecord['homeDepotId'] ?? poolRecord['homeDepot'] ?? poolRecord['homeDepotName'],
    );
    let homeDepotId: string | undefined;
    if (depotRef) {
      const resolved = this.resolveHomeDepotIdByReference(snapshot.homeDepots, depotRef, {
        title: `Mehrere Heimatdepots fuer "${depotRef}" gefunden. Welches meinst du?`,
        apply: { mode: 'value', path: ['pool', 'homeDepot'] },
      });
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      homeDepotId = resolved.id;
    }
    const poolId = this.generateId('PSP');
    const serviceEntries: PersonnelService[] = services.map((service) => ({
      id: this.generateId('PS'),
      name: service.name,
      description: service.description,
      poolId,
      startTime: service.startTime,
      endTime: service.endTime,
      isNightService: service.isNightService,
      requiredQualifications: service.requiredQualifications,
      maxDailyInstances: service.maxDailyInstances,
      maxResourcesPerInstance: service.maxResourcesPerInstance,
    }));

    const pool: PersonnelServicePool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord['description']),
      homeDepotId,
      shiftCoordinator: undefined,
      contactEmail: undefined,
      serviceIds: serviceEntries.map((service) => service.id),
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServicePools: [...snapshot.personnelServicePools, pool],
      personnelServices: [...snapshot.personnelServices, ...serviceEntries],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Personaldienstpool "${poolName}" mit ${serviceEntries.length} Diensten.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'create', entityType: 'personnelServicePool', id: poolId, label: poolName },
      ...serviceEntries.map((service): AssistantActionChangeDto => ({
        kind: 'create',
        entityType: 'personnelService',
        id: service.id,
        label: service.name,
        details: `Pool ${poolName}`,
      })),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildVehicleServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const poolRaw = payload.pool;
    const poolRecord = this.asRecord(poolRaw) ?? {};
    const payloadRecord = payload as Record<string, unknown>;
    const poolName =
      this.cleanText(typeof poolRaw === 'string' ? poolRaw : poolRecord['name']) ??
      this.cleanText(poolRecord['poolName']) ??
      this.cleanText(payloadRecord['poolName']);
    if (!poolName) {
      return this.buildFeedbackResponse('Poolname fehlt.');
    }

    const services = this.normalizeVehicleServices(
      Array.isArray(payload.services) ? payload.services : [],
    );
    if (!services.length) {
      return this.buildFeedbackResponse('Mindestens ein Dienst wird benötigt.');
    }

    if (this.hasNameCollision(snapshot.vehicleServicePools, poolName)) {
      return this.buildFeedbackResponse(
        `Fahrzeugdienstpool "${poolName}" existiert bereits.`,
      );
    }
    const duplicateNames = this.findDuplicateNames(services.map((service) => service.name));
    if (duplicateNames.length) {
      return this.buildFeedbackResponse(
        `Dienste doppelt angegeben: ${duplicateNames.join(', ')}`,
      );
    }
    const poolId = this.generateId('VSP');
    const serviceEntries: VehicleService[] = services.map((service) => ({
      id: this.generateId('VS'),
      name: service.name,
      description: service.description,
      poolId,
      startTime: service.startTime,
      endTime: service.endTime,
      isOvernight: service.isOvernight,
      primaryRoute: service.primaryRoute,
    }));

    const pool: VehicleServicePool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord['description']),
      dispatcher: this.cleanText(poolRecord['dispatcher']),
      serviceIds: serviceEntries.map((service) => service.id),
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServicePools: [...snapshot.vehicleServicePools, pool],
      vehicleServices: [...snapshot.vehicleServices, ...serviceEntries],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Fahrzeugdienstpool "${poolName}" mit ${serviceEntries.length} Diensten.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'create', entityType: 'vehicleServicePool', id: poolId, label: poolName },
      ...serviceEntries.map((service): AssistantActionChangeDto => ({
        kind: 'create',
        entityType: 'vehicleService',
        id: service.id,
        label: service.name,
        details: `Pool ${poolName}`,
      })),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildPersonnelServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.services ?? payloadRecord['service'] ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Dienst wird benötigt.');
    }

    const defaultPoolRef = this.parsePoolReference(
      payload.pool ?? payloadRecord['pool'] ?? payloadRecord['poolName'],
    );
    const services: PersonnelService[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const poolNames = new Set<string>();
    const seenServiceNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const name =
        this.cleanText(
          typeof raw === 'string' ? raw : record?.['name'] ?? record?.['serviceName'],
        ) ?? undefined;
      if (!name) {
        return this.buildFeedbackResponse('Dienstname fehlt.');
      }
      const normalizedName = this.normalizeKey(name);
      if (seenServiceNames.has(normalizedName)) {
        return this.buildFeedbackResponse(`Dienst "${name}" ist doppelt angegeben.`);
      }
      seenServiceNames.add(normalizedName);

      const recordPoolRef = this.parsePoolReference(
        record?.['pool'] ?? record?.['poolName'] ?? record?.['poolId'],
      );
      const poolRef = recordPoolRef ?? defaultPoolRef;
      if (!poolRef) {
        return this.buildFeedbackResponse(`Dienst "${name}": Pool fehlt.`);
      }

      const resolvedPool = this.resolvePoolIdByReference(
        snapshot.personnelServicePools,
        poolRef,
        'Dienst-Pool',
        { allowSystem: false, systemId: SYSTEM_POOL_IDS.personnelServicePool },
        {
          title: `Mehrere Dienst-Pools mit Namen "${poolRef}" gefunden. Welchen meinst du?`,
          apply: {
            mode: 'value',
            path: recordPoolRef ? ['services', index, 'pool'] : ['pool'],
          },
        },
      );
      if (resolvedPool.clarification) {
        return this.buildClarificationResponse(resolvedPool.clarification, context);
      }
      if (resolvedPool.feedback) {
        return this.buildFeedbackResponse(
          `Dienst "${name}": ${resolvedPool.feedback}`,
        );
      }
      const duplicateInPool = snapshot.personnelServices.find(
        (service) =>
          service.poolId === resolvedPool.id &&
          this.normalizeKey(service.name) === normalizedName,
      );
      if (duplicateInPool) {
        return this.buildFeedbackResponse(
          `Dienst "${name}" existiert bereits im Pool "${resolvedPool.label ?? poolRef}".`,
        );
      }

      const service: PersonnelService = {
        id: this.generateId('PS'),
        name,
        description: this.cleanText(record?.['description']),
        poolId: resolvedPool.id,
        startTime: this.cleanText(record?.['startTime']),
        endTime: this.cleanText(record?.['endTime']),
        isNightService: this.parseBoolean(record?.['isNightService']),
        requiredQualifications: this.parseStringArray(record?.['requiredQualifications']),
        maxDailyInstances: this.parseNumber(record?.['maxDailyInstances']),
        maxResourcesPerInstance: this.parseNumber(record?.['maxResourcesPerInstance']),
      };
      services.push(service);

      const poolLabel = resolvedPool.label ?? poolRef;
      poolNames.add(poolLabel);
      changes.push({
        kind: 'create',
        entityType: 'personnelService',
        id: service.id,
        label: service.name,
        details: `Pool ${poolLabel}`,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServices: [...snapshot.personnelServices, ...services],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      poolNames.size === 1
        ? `Neue Personaldienste (${services.length}) im Pool "${Array.from(poolNames)[0]}".`
        : `Neue Personaldienste (${services.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdatePersonnelServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'servicePool',
      'personnelServicePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServicePools, targetRecord, {
      label: 'Personaldienstpool',
      nameKeys: ['name', 'poolName', 'servicePoolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.personnelServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht geändert werden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: PersonnelServicePool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.personnelServicePools, name, pool.id)) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    const hasDepotPatch = this.hasAnyKey(patch, [
      'homeDepotId',
      'homeDepot',
      'homeDepotName',
    ]);
    if (hasDepotPatch) {
      const depotRef = this.extractReference(patch, [
        'homeDepotId',
        'homeDepot',
        'homeDepotName',
      ]);
      if (depotRef) {
        const resolved = this.resolveHomeDepotIdByReference(snapshot.homeDepots, depotRef, {
          apply: { mode: 'value', path: ['patch', 'homeDepot'] },
        });
        if (resolved.clarification) {
          return this.buildClarificationResponse(resolved.clarification, context);
        }
        if (resolved.feedback) {
          return this.buildFeedbackResponse(resolved.feedback);
        }
        updated.homeDepotId = resolved.id;
      } else {
        updated.homeDepotId = undefined;
      }
      changed = true;
    }

    if (this.hasOwn(patch, 'shiftCoordinator')) {
      updated.shiftCoordinator = this.cleanText(patch['shiftCoordinator']);
      changed = true;
    }

    if (this.hasOwn(patch, 'contactEmail')) {
      updated.contactEmail = this.cleanText(patch['contactEmail']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.personnelServicePools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServicePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? pool.name;
    const summary = `Personaldienstpool "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelServicePool', id: pool.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdateVehicleServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'servicePool',
      'vehicleServicePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServicePools, targetRecord, {
      label: 'Fahrzeugdienstpool',
      nameKeys: ['name', 'poolName', 'servicePoolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehicleServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht geändert werden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehicleServicePool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.vehicleServicePools, name, pool.id)) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'dispatcher')) {
      updated.dispatcher = this.cleanText(patch['dispatcher']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.vehicleServicePools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServicePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? pool.name;
    const summary = `Fahrzeugdienstpool "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicleServicePool', id: pool.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdatePersonnelPoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'personnelPool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personalpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelPools, targetRecord, {
      label: 'Personalpool',
      nameKeys: ['name', 'poolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.personnelPool) {
      return this.buildFeedbackResponse('System-Pool kann nicht geändert werden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: PersonnelPool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.personnelPools, name, pool.id)) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    const hasDepotPatch = this.hasAnyKey(patch, [
      'homeDepotId',
      'homeDepot',
      'homeDepotName',
    ]);
    if (hasDepotPatch) {
      const depotRef = this.extractReference(patch, [
        'homeDepotId',
        'homeDepot',
        'homeDepotName',
      ]);
      if (depotRef) {
        const resolved = this.resolveHomeDepotIdByReference(snapshot.homeDepots, depotRef, {
          apply: { mode: 'value', path: ['patch', 'homeDepot'] },
        });
        if (resolved.clarification) {
          return this.buildClarificationResponse(resolved.clarification, context);
        }
        if (resolved.feedback) {
          return this.buildFeedbackResponse(resolved.feedback);
        }
        updated.homeDepotId = resolved.id;
      } else {
        updated.homeDepotId = undefined;
      }
      changed = true;
    }

    if (this.hasOwn(patch, 'locationCode')) {
      updated.locationCode = this.cleanText(patch['locationCode']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.personnelPools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelPools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? pool.name;
    const summary = `Personalpool "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelPool', id: pool.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdateVehiclePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['pool', 'vehiclePool']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehiclePools, targetRecord, {
      label: 'Fahrzeugpool',
      nameKeys: ['name', 'poolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehiclePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht geändert werden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehiclePool = { ...pool };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.vehiclePools, name, pool.id)) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'depotManager')) {
      updated.depotManager = this.cleanText(patch['depotManager']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPools = snapshot.vehiclePools.map((entry) =>
      entry.id === pool.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehiclePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? pool.name;
    const summary = `Fahrzeugpool "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehiclePool', id: pool.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdatePersonnelServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'service',
      'personnelService',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServices, targetRecord, {
      label: 'Personaldienst',
      nameKeys: ['name', 'serviceName'],
      clarification: {
        apply: { mode: 'target', path: ['target'] },
        details: (service) => {
          const pool = snapshot.personnelServicePools.find(
            (entry) => entry.id === service.poolId,
          );
          return pool?.name ? `Pool ${pool.name}` : `Pool ${service.poolId}`;
        },
      },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const service = targetResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: PersonnelService = { ...service };
    let changed = false;
    let nameChanged = false;
    let poolChanged = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
      nameChanged = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'startTime')) {
      updated.startTime = this.cleanText(patch['startTime']);
      changed = true;
    }

    if (this.hasOwn(patch, 'endTime')) {
      updated.endTime = this.cleanText(patch['endTime']);
      changed = true;
    }

    if (this.hasOwn(patch, 'isNightService')) {
      updated.isNightService = this.parseBoolean(patch['isNightService']);
      changed = true;
    }

    if (this.hasAnyKey(patch, ['requiredQualifications', 'qualifications'])) {
      updated.requiredQualifications = this.parseStringArray(
        patch['requiredQualifications'] ?? patch['qualifications'],
      );
      changed = true;
    }

    if (this.hasOwn(patch, 'maxDailyInstances')) {
      updated.maxDailyInstances = this.parseNumber(patch['maxDailyInstances']);
      changed = true;
    }

    if (this.hasOwn(patch, 'maxResourcesPerInstance')) {
      updated.maxResourcesPerInstance = this.parseNumber(patch['maxResourcesPerInstance']);
      changed = true;
    }

    const hasPoolPatch = this.hasAnyKey(patch, ['poolId', 'pool', 'poolName']);
    if (hasPoolPatch) {
      const poolRef = this.extractReference(patch, ['poolId', 'pool', 'poolName']);
      if (!poolRef) {
        return this.buildFeedbackResponse('Dienst-Pool fehlt.');
      }
      const resolved = this.resolvePoolIdByReference(
        snapshot.personnelServicePools,
        poolRef,
        'Dienst-Pool',
        {
          allowSystem: false,
          systemId: SYSTEM_POOL_IDS.personnelServicePool,
          systemFeedback: 'System-Pool nur ueber delete nutzen.',
        },
        { apply: { mode: 'value', path: ['patch', 'pool'] } },
      );
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      updated.poolId = resolved.id;
      changed = true;
      poolChanged = true;
    }

    if (nameChanged || poolChanged) {
      if (
        updated.name &&
        snapshot.personnelServices.some(
          (entry) =>
            entry.id !== service.id &&
            entry.poolId === updated.poolId &&
            this.normalizeKey(entry.name) === this.normalizeKey(updated.name),
        )
      ) {
        return this.buildFeedbackResponse(
          `Dienst "${updated.name}" existiert bereits im Ziel-Pool.`,
        );
      }
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextServices = snapshot.personnelServices.map((entry) =>
      entry.id === service.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? service.name;
    const summary = `Personaldienst "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelService', id: service.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdateVehicleServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['service', 'vehicleService']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServices, targetRecord, {
      label: 'Fahrzeugdienst',
      nameKeys: ['name', 'serviceName'],
      clarification: {
        apply: { mode: 'target', path: ['target'] },
        details: (service) => {
          const pool = snapshot.vehicleServicePools.find(
            (entry) => entry.id === service.poolId,
          );
          return pool?.name ? `Pool ${pool.name}` : `Pool ${service.poolId}`;
        },
      },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const service = targetResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehicleService = { ...service };
    let changed = false;
    let nameChanged = false;
    let poolChanged = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
      nameChanged = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'startTime')) {
      updated.startTime = this.cleanText(patch['startTime']);
      changed = true;
    }

    if (this.hasOwn(patch, 'endTime')) {
      updated.endTime = this.cleanText(patch['endTime']);
      changed = true;
    }

    if (this.hasOwn(patch, 'isOvernight')) {
      updated.isOvernight = this.parseBoolean(patch['isOvernight']);
      changed = true;
    }

    if (this.hasOwn(patch, 'primaryRoute')) {
      updated.primaryRoute = this.cleanText(patch['primaryRoute']);
      changed = true;
    }

    const hasPoolPatch = this.hasAnyKey(patch, ['poolId', 'pool', 'poolName']);
    if (hasPoolPatch) {
      const poolRef = this.extractReference(patch, ['poolId', 'pool', 'poolName']);
      if (!poolRef) {
        return this.buildFeedbackResponse('Dienst-Pool fehlt.');
      }
      const resolved = this.resolvePoolIdByReference(
        snapshot.vehicleServicePools,
        poolRef,
        'Dienst-Pool',
        {
          allowSystem: false,
          systemId: SYSTEM_POOL_IDS.vehicleServicePool,
          systemFeedback: 'System-Pool nur ueber delete nutzen.',
        },
        { apply: { mode: 'value', path: ['patch', 'pool'] } },
      );
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      updated.poolId = resolved.id;
      changed = true;
      poolChanged = true;
    }

    if (nameChanged || poolChanged) {
      if (
        updated.name &&
        snapshot.vehicleServices.some(
          (entry) =>
            entry.id !== service.id &&
            entry.poolId === updated.poolId &&
            this.normalizeKey(entry.name) === this.normalizeKey(updated.name),
        )
      ) {
        return this.buildFeedbackResponse(
          `Dienst "${updated.name}" existiert bereits im Ziel-Pool.`,
        );
      }
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextServices = snapshot.vehicleServices.map((entry) =>
      entry.id === service.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? service.name;
    const summary = `Fahrzeugdienst "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicleService', id: service.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdatePersonnelPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnel', 'person']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personal fehlt.');
    }

    const poolLabels = new Map(
      snapshot.personnelPools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolvePersonnelTarget(snapshot.personnel, targetRecord, {
      clarification: { apply: { mode: 'target', path: ['target'] } },
      poolLabelById: poolLabels,
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Personal nicht gefunden.',
      );
    }

    const person = targetResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: Personnel = { ...person };
    let changed = false;
    const servicePoolLabels = new Map(
      snapshot.personnelServicePools.map((pool) => [pool.id, pool.name]),
    );

    if (this.hasAnyKey(patch, ['name', 'fullName'])) {
      const fullName = this.extractFirstText(patch, ['name', 'fullName']);
      if (!fullName) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      const parsed = this.splitFullName(fullName);
      if (!parsed.firstName || !parsed.lastName) {
        return this.buildFeedbackResponse('Vor- und Nachname fehlen.');
      }
      updated.firstName = parsed.firstName;
      updated.lastName = parsed.lastName;
      changed = true;
    }

    if (this.hasOwn(patch, 'firstName')) {
      const firstName = this.cleanText(patch['firstName']);
      if (!firstName) {
        return this.buildFeedbackResponse('Vorname darf nicht leer sein.');
      }
      updated.firstName = firstName;
      changed = true;
    }

    if (this.hasOwn(patch, 'lastName')) {
      const lastName = this.cleanText(patch['lastName']);
      if (!lastName) {
        return this.buildFeedbackResponse('Nachname darf nicht leer sein.');
      }
      updated.lastName = lastName;
      changed = true;
    }

    if (this.hasOwn(patch, 'preferredName')) {
      updated.preferredName = this.cleanText(patch['preferredName']);
      changed = true;
    }

    if (this.hasAnyKey(patch, ['qualifications', 'qualification'])) {
      updated.qualifications = this.parseStringArray(
        patch['qualifications'] ?? patch['qualification'],
      );
      changed = true;
    }

    const hasServicePatch = this.hasAnyKey(patch, [
      'services',
      'serviceNames',
      'serviceIds',
    ]);
    if (hasServicePatch) {
      const serviceNames = this.parseStringArray(
        patch['services'] ?? patch['serviceNames'] ?? patch['serviceIds'],
      );
      const serviceResult = this.resolvePersonnelServiceIds(
        snapshot.personnelServices,
        serviceNames,
        {
          applyPath: ['patch', 'services'],
          poolLabelById: servicePoolLabels,
        },
      );
      if (serviceResult.clarification) {
        return this.buildClarificationResponse(serviceResult.clarification, context);
      }
      if (serviceResult.feedback) {
        return this.buildFeedbackResponse(serviceResult.feedback);
      }
      updated.serviceIds = serviceNames?.length ? serviceResult.ids : [];
      changed = true;
    }

    const hasPoolPatch = this.hasAnyKey(patch, ['poolId', 'pool', 'poolName']);
    if (hasPoolPatch) {
      const poolRef = this.extractReference(patch, ['poolId', 'pool', 'poolName']);
      if (!poolRef) {
        return this.buildFeedbackResponse('Personalpool fehlt.');
      }
      const resolved = this.resolvePoolIdByReference(
        snapshot.personnelPools,
        poolRef,
        'Personalpool',
        {
          allowSystem: false,
          systemId: SYSTEM_POOL_IDS.personnelPool,
          systemFeedback: 'System-Pool nur ueber delete nutzen.',
        },
        { apply: { mode: 'value', path: ['patch', 'pool'] } },
      );
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      updated.poolId = resolved.id;
      changed = true;
    }

    if (this.hasOwn(patch, 'homeStation')) {
      updated.homeStation = this.cleanText(patch['homeStation']);
      changed = true;
    }

    if (this.hasOwn(patch, 'availabilityStatus')) {
      updated.availabilityStatus = this.cleanText(patch['availabilityStatus']);
      changed = true;
    }

    if (this.hasOwn(patch, 'qualificationExpires')) {
      updated.qualificationExpires = this.cleanText(patch['qualificationExpires']);
      changed = true;
    }

    if (this.hasOwn(patch, 'isReserve')) {
      updated.isReserve = this.parseBoolean(patch['isReserve']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextPersonnel = snapshot.personnel.map((entry) =>
      entry.id === person.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: nextPersonnel,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatPersonnelLabel(updated);
    const summary = `Personal "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnel', id: person.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdateVehiclePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicle', 'vehicles']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeug fehlt.');
    }

    const poolLabels = new Map(
      snapshot.vehiclePools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolveVehicleTarget(snapshot.vehicles, targetRecord, {
      clarification: { apply: { mode: 'target', path: ['target'] } },
      poolLabelById: poolLabels,
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Fahrzeug nicht gefunden.',
      );
    }

    const vehicle = targetResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: Vehicle = { ...vehicle };
    let changed = false;
    const servicePoolLabels = new Map(
      snapshot.vehicleServicePools.map((pool) => [pool.id, pool.name]),
    );

    if (this.hasOwn(patch, 'vehicleNumber')) {
      const number = this.cleanText(patch['vehicleNumber']);
      if (!number) {
        return this.buildFeedbackResponse('Fahrzeugnummer darf nicht leer sein.');
      }
      const normalized = this.normalizeKey(number);
      const existing = snapshot.vehicles.find(
        (entry) =>
          entry.id !== vehicle.id &&
          this.normalizeKey(
            entry.vehicleNumber ?? entry.name ?? entry.id ?? '',
          ) === normalized,
      );
      if (existing) {
        return this.buildFeedbackResponse(
          `Fahrzeugnummer "${number}" existiert bereits.`,
        );
      }
      updated.vehicleNumber = number;
      changed = true;
    }

    const hasTypePatch = this.hasAnyKey(patch, [
      'typeId',
      'type',
      'typeLabel',
      'vehicleType',
    ]);
    if (hasTypePatch) {
      const typeRef = this.extractFirstText(patch, [
        'typeId',
        'type',
        'typeLabel',
        'vehicleType',
      ]);
      if (!typeRef) {
        return this.buildFeedbackResponse('Fahrzeugtyp fehlt.');
      }
      const typeResult = this.resolveVehicleTypeIdByReference(
        snapshot.vehicleTypes,
        typeRef,
        { apply: { mode: 'value', path: ['patch', 'typeId'] } },
      );
      if (typeResult.clarification) {
        return this.buildClarificationResponse(typeResult.clarification, context);
      }
      if (typeResult.feedback) {
        return this.buildFeedbackResponse(typeResult.feedback);
      }
      updated.typeId = typeResult.id;
      changed = true;
    }

    const hasPoolPatch = this.hasAnyKey(patch, ['poolId', 'pool', 'poolName']);
    if (hasPoolPatch) {
      const poolRef = this.extractReference(patch, ['poolId', 'pool', 'poolName']);
      if (poolRef) {
        const resolved = this.resolvePoolIdByReference(
          snapshot.vehiclePools,
          poolRef,
          'Fahrzeugpool',
          {
            allowSystem: false,
            systemId: SYSTEM_POOL_IDS.vehiclePool,
            systemFeedback: 'System-Pool nur ueber delete nutzen.',
          },
          { apply: { mode: 'value', path: ['patch', 'pool'] } },
        );
        if (resolved.clarification) {
          return this.buildClarificationResponse(resolved.clarification, context);
        }
        if (resolved.feedback) {
          return this.buildFeedbackResponse(resolved.feedback);
        }
        updated.poolId = resolved.id;
      } else {
        updated.poolId = undefined;
      }
      changed = true;
    }

    const hasServicePatch = this.hasAnyKey(patch, [
      'services',
      'serviceNames',
      'serviceIds',
    ]);
    if (hasServicePatch) {
      const serviceNames = this.parseStringArray(
        patch['services'] ?? patch['serviceNames'] ?? patch['serviceIds'],
      );
      const serviceResult = this.resolveVehicleServiceIds(
        snapshot.vehicleServices,
        serviceNames,
        {
          applyPath: ['patch', 'services'],
          poolLabelById: servicePoolLabels,
        },
      );
      if (serviceResult.clarification) {
        return this.buildClarificationResponse(serviceResult.clarification, context);
      }
      if (serviceResult.feedback) {
        return this.buildFeedbackResponse(serviceResult.feedback);
      }
      updated.serviceIds = serviceNames?.length ? serviceResult.ids : [];
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    if (this.hasOwn(patch, 'depot')) {
      updated.depot = this.cleanText(patch['depot']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextVehicles = snapshot.vehicles.map((entry) =>
      entry.id === vehicle.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: nextVehicles,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatVehicleLabel(updated);
    const summary = `Fahrzeug "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicle', id: vehicle.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeletePersonnelServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'servicePool',
      'personnelServicePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServicePools, targetRecord, {
      label: 'Personaldienstpool',
      nameKeys: ['name', 'poolName', 'servicePoolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.personnelServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht gelöscht werden.');
    }

    const movedServices = snapshot.personnelServices.filter(
      (service) => service.poolId === pool.id,
    );
    const nextServices = snapshot.personnelServices.map((service) =>
      service.poolId === pool.id
        ? { ...service, poolId: SYSTEM_POOL_IDS.personnelServicePool }
        : service,
    );
    const nextPools = snapshot.personnelServicePools.filter(
      (entry) => entry.id !== pool.id,
    );

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServices: nextServices,
      personnelServicePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Personaldienstpool "${pool.name}" gelöscht (${movedServices.length} Dienste in System-Pool).`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'personnelServicePool',
        id: pool.id,
        label: pool.name,
        details: 'System-Pool',
      },
      ...movedServices.map(
        (service): AssistantActionChangeDto => ({
          kind: 'update',
          entityType: 'personnelService',
          id: service.id,
          label: service.name,
          details: 'System-Pool',
        }),
      ),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeleteVehicleServicePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, [
      'pool',
      'servicePool',
      'vehicleServicePool',
    ]);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienstpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServicePools, targetRecord, {
      label: 'Fahrzeugdienstpool',
      nameKeys: ['name', 'poolName', 'servicePoolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehicleServicePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht gelöscht werden.');
    }

    const movedServices = snapshot.vehicleServices.filter(
      (service) => service.poolId === pool.id,
    );
    const nextServices = snapshot.vehicleServices.map((service) =>
      service.poolId === pool.id
        ? { ...service, poolId: SYSTEM_POOL_IDS.vehicleServicePool }
        : service,
    );
    const nextPools = snapshot.vehicleServicePools.filter(
      (entry) => entry.id !== pool.id,
    );

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: nextServices,
      vehicleServicePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugdienstpool "${pool.name}" gelöscht (${movedServices.length} Dienste in System-Pool).`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicleServicePool',
        id: pool.id,
        label: pool.name,
        details: 'System-Pool',
      },
      ...movedServices.map(
        (service): AssistantActionChangeDto => ({
          kind: 'update',
          entityType: 'vehicleService',
          id: service.id,
          label: service.name,
          details: 'System-Pool',
        }),
      ),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeletePersonnelPoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['pool', 'personnelPool']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personalpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelPools, targetRecord, {
      label: 'Personalpool',
      nameKeys: ['name', 'poolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.personnelPool) {
      return this.buildFeedbackResponse('System-Pool kann nicht gelöscht werden.');
    }

    const movedPersonnel = snapshot.personnel.filter(
      (person) => person.poolId === pool.id,
    );
    const nextPersonnel = snapshot.personnel.map((person) =>
      person.poolId === pool.id
        ? { ...person, poolId: SYSTEM_POOL_IDS.personnelPool }
        : person,
    );
    const nextPools = snapshot.personnelPools.filter((entry) => entry.id !== pool.id);

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: nextPersonnel,
      personnelPools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Personalpool "${pool.name}" gelöscht (${movedPersonnel.length} Personen in System-Pool).`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'personnelPool',
        id: pool.id,
        label: pool.name,
        details: 'System-Pool',
      },
      ...movedPersonnel.map(
        (person): AssistantActionChangeDto => ({
          kind: 'update',
          entityType: 'personnel',
          id: person.id,
          label: this.formatPersonnelLabel(person),
          details: 'System-Pool',
        }),
      ),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeleteVehiclePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['pool', 'vehiclePool']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugpool fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehiclePools, targetRecord, {
      label: 'Fahrzeugpool',
      nameKeys: ['name', 'poolName'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Pool nicht gefunden.');
    }

    const pool = targetResult.item;
    if (pool.id === SYSTEM_POOL_IDS.vehiclePool) {
      return this.buildFeedbackResponse('System-Pool kann nicht gelöscht werden.');
    }

    const movedVehicles = snapshot.vehicles.filter((vehicle) => vehicle.poolId === pool.id);
    const nextVehicles = snapshot.vehicles.map((vehicle) =>
      vehicle.poolId === pool.id
        ? { ...vehicle, poolId: SYSTEM_POOL_IDS.vehiclePool }
        : vehicle,
    );
    const nextPools = snapshot.vehiclePools.filter((entry) => entry.id !== pool.id);

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: nextVehicles,
      vehiclePools: nextPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugpool "${pool.name}" gelöscht (${movedVehicles.length} Fahrzeuge in System-Pool).`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehiclePool',
        id: pool.id,
        label: pool.name,
        details: 'System-Pool',
      },
      ...movedVehicles.map(
        (vehicle): AssistantActionChangeDto => ({
          kind: 'update',
          entityType: 'vehicle',
          id: vehicle.id,
          label: this.formatVehicleLabel(vehicle),
          details: 'System-Pool',
        }),
      ),
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeletePersonnelServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['service', 'personnelService']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personaldienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.personnelServices, targetRecord, {
      label: 'Personaldienst',
      nameKeys: ['name', 'serviceName'],
      clarification: {
        apply: { mode: 'target', path: ['target'] },
        details: (service) => {
          const pool = snapshot.personnelServicePools.find(
            (entry) => entry.id === service.poolId,
          );
          return pool?.name ? `Pool ${pool.name}` : `Pool ${service.poolId}`;
        },
      },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const service = targetResult.item;
    if (service.poolId === SYSTEM_POOL_IDS.personnelServicePool) {
      return this.buildFeedbackResponse('Dienst befindet sich bereits im System-Pool.');
    }

    const updated = { ...service, poolId: SYSTEM_POOL_IDS.personnelServicePool };
    const nextServices = snapshot.personnelServices.map((entry) =>
      entry.id === service.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Personaldienst "${service.name}" in System-Pool verschoben.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'personnelService',
        id: service.id,
        label: service.name,
        details: 'System-Pool',
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeleteVehicleServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['service', 'vehicleService']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugdienst fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleServices, targetRecord, {
      label: 'Fahrzeugdienst',
      nameKeys: ['name', 'serviceName'],
      clarification: {
        apply: { mode: 'target', path: ['target'] },
        details: (service) => {
          const pool = snapshot.vehicleServicePools.find(
            (entry) => entry.id === service.poolId,
          );
          return pool?.name ? `Pool ${pool.name}` : `Pool ${service.poolId}`;
        },
      },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Dienst nicht gefunden.');
    }

    const service = targetResult.item;
    if (service.poolId === SYSTEM_POOL_IDS.vehicleServicePool) {
      return this.buildFeedbackResponse('Dienst befindet sich bereits im System-Pool.');
    }

    const updated = { ...service, poolId: SYSTEM_POOL_IDS.vehicleServicePool };
    const nextServices = snapshot.vehicleServices.map((entry) =>
      entry.id === service.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: nextServices,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugdienst "${service.name}" in System-Pool verschoben.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicleService',
        id: service.id,
        label: service.name,
        details: 'System-Pool',
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeletePersonnelPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnel', 'person']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personal fehlt.');
    }

    const poolLabels = new Map(
      snapshot.personnelPools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolvePersonnelTarget(snapshot.personnel, targetRecord, {
      clarification: { apply: { mode: 'target', path: ['target'] } },
      poolLabelById: poolLabels,
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Personal nicht gefunden.',
      );
    }

    const person = targetResult.item;
    if (person.poolId === SYSTEM_POOL_IDS.personnelPool) {
      return this.buildFeedbackResponse(
        'Personal befindet sich bereits im System-Pool.',
      );
    }

    const updated = { ...person, poolId: SYSTEM_POOL_IDS.personnelPool };
    const nextPersonnel = snapshot.personnel.map((entry) =>
      entry.id === person.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: nextPersonnel,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatPersonnelLabel(person);
    const summary = `Personal "${label}" in System-Pool verschoben.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'personnel',
        id: person.id,
        label,
        details: 'System-Pool',
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeleteVehiclePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicle', 'vehicles']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeug fehlt.');
    }

    const poolLabels = new Map(
      snapshot.vehiclePools.map((pool) => [pool.id, pool.name]),
    );
    const targetResult = this.resolveVehicleTarget(snapshot.vehicles, targetRecord, {
      clarification: { apply: { mode: 'target', path: ['target'] } },
      poolLabelById: poolLabels,
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Fahrzeug nicht gefunden.',
      );
    }

    const vehicle = targetResult.item;
    if (vehicle.poolId === SYSTEM_POOL_IDS.vehiclePool) {
      return this.buildFeedbackResponse(
        'Fahrzeug befindet sich bereits im System-Pool.',
      );
    }

    const updated = { ...vehicle, poolId: SYSTEM_POOL_IDS.vehiclePool };
    const nextVehicles = snapshot.vehicles.map((entry) =>
      entry.id === vehicle.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: nextVehicles,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = this.formatVehicleLabel(vehicle);
    const summary = `Fahrzeug "${label}" in System-Pool verschoben.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicle',
        id: vehicle.id,
        label,
        details: 'System-Pool',
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildVehicleServicePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.services ?? payloadRecord['service'] ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Dienst wird benötigt.');
    }

    const defaultPoolRef = this.parsePoolReference(
      payload.pool ?? payloadRecord['pool'] ?? payloadRecord['poolName'],
    );
    const services: VehicleService[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const poolNames = new Set<string>();
    const seenServiceNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const name =
        this.cleanText(
          typeof raw === 'string' ? raw : record?.['name'] ?? record?.['serviceName'],
        ) ?? undefined;
      if (!name) {
        return this.buildFeedbackResponse('Dienstname fehlt.');
      }
      const normalizedName = this.normalizeKey(name);
      if (seenServiceNames.has(normalizedName)) {
        return this.buildFeedbackResponse(`Dienst "${name}" ist doppelt angegeben.`);
      }
      seenServiceNames.add(normalizedName);

      const recordPoolRef = this.parsePoolReference(
        record?.['pool'] ?? record?.['poolName'] ?? record?.['poolId'],
      );
      const poolRef = recordPoolRef ?? defaultPoolRef;
      if (!poolRef) {
        return this.buildFeedbackResponse(`Dienst "${name}": Pool fehlt.`);
      }

      const resolvedPool = this.resolvePoolIdByReference(
        snapshot.vehicleServicePools,
        poolRef,
        'Dienst-Pool',
        { allowSystem: false, systemId: SYSTEM_POOL_IDS.vehicleServicePool },
        {
          title: `Mehrere Dienst-Pools mit Namen "${poolRef}" gefunden. Welchen meinst du?`,
          apply: {
            mode: 'value',
            path: recordPoolRef ? ['services', index, 'pool'] : ['pool'],
          },
        },
      );
      if (resolvedPool.clarification) {
        return this.buildClarificationResponse(resolvedPool.clarification, context);
      }
      if (resolvedPool.feedback) {
        return this.buildFeedbackResponse(
          `Dienst "${name}": ${resolvedPool.feedback}`,
        );
      }
      const duplicateInPool = snapshot.vehicleServices.find(
        (service) =>
          service.poolId === resolvedPool.id &&
          this.normalizeKey(service.name) === normalizedName,
      );
      if (duplicateInPool) {
        return this.buildFeedbackResponse(
          `Dienst "${name}" existiert bereits im Pool "${resolvedPool.label ?? poolRef}".`,
        );
      }

      const service: VehicleService = {
        id: this.generateId('VS'),
        name,
        description: this.cleanText(record?.['description']),
        poolId: resolvedPool.id,
        startTime: this.cleanText(record?.['startTime']),
        endTime: this.cleanText(record?.['endTime']),
        isOvernight: this.parseBoolean(record?.['isOvernight']),
        primaryRoute: this.cleanText(record?.['primaryRoute']),
      };
      services.push(service);

      const poolLabel = resolvedPool.label ?? poolRef;
      poolNames.add(poolLabel);
      changes.push({
        kind: 'create',
        entityType: 'vehicleService',
        id: service.id,
        label: service.name,
        details: `Pool ${poolLabel}`,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleServices: [...snapshot.vehicleServices, ...services],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      poolNames.size === 1
        ? `Neue Fahrzeugdienste (${services.length}) im Pool "${Array.from(poolNames)[0]}".`
        : `Neue Fahrzeugdienste (${services.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildPersonnelPoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const poolSource = payload.pool ?? payloadRecord['personnelPool'] ?? payloadRecord['pool'];
    const poolRecord = this.asRecord(poolSource);
    const poolName =
      this.cleanText(typeof poolSource === 'string' ? poolSource : poolRecord?.['name']) ??
      this.cleanText(poolRecord?.['poolName']) ??
      this.cleanText(payloadRecord['poolName']);
    if (!poolName) {
      return this.buildFeedbackResponse('Poolname fehlt.');
    }

    if (this.hasNameCollision(snapshot.personnelPools, poolName)) {
      return this.buildFeedbackResponse(
        `Personalpool "${poolName}" existiert bereits.`,
      );
    }

    const depotRef = this.parsePoolReference(
      poolRecord?.['homeDepotId'] ??
        poolRecord?.['homeDepot'] ??
        poolRecord?.['homeDepotName'],
    );
    let homeDepotId: string | undefined;
    if (depotRef) {
      const resolved = this.resolveHomeDepotIdByReference(snapshot.homeDepots, depotRef, {
        title: `Mehrere Heimatdepots fuer "${depotRef}" gefunden. Welches meinst du?`,
        apply: { mode: 'value', path: ['pool', 'homeDepot'] },
      });
      if (resolved.clarification) {
        return this.buildClarificationResponse(resolved.clarification, context);
      }
      if (resolved.feedback) {
        return this.buildFeedbackResponse(resolved.feedback);
      }
      homeDepotId = resolved.id;
    }

    const poolId = this.generateId('PP');
    const pool: PersonnelPool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord?.['description']),
      homeDepotId,
      locationCode: this.cleanText(poolRecord?.['locationCode']),
      personnelIds: [],
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnelPools: [...snapshot.personnelPools, pool],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Personalpool "${poolName}".`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'create', entityType: 'personnelPool', id: poolId, label: poolName },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildVehiclePoolPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const poolSource = payload.pool ?? payloadRecord['vehiclePool'] ?? payloadRecord['pool'];
    const poolRecord = this.asRecord(poolSource);
    const poolName =
      this.cleanText(typeof poolSource === 'string' ? poolSource : poolRecord?.['name']) ??
      this.cleanText(poolRecord?.['poolName']) ??
      this.cleanText(payloadRecord['poolName']);
    if (!poolName) {
      return this.buildFeedbackResponse('Poolname fehlt.');
    }

    if (this.hasNameCollision(snapshot.vehiclePools, poolName)) {
      return this.buildFeedbackResponse(
        `Fahrzeugpool "${poolName}" existiert bereits.`,
      );
    }

    const poolId = this.generateId('VP');
    const pool: VehiclePool = {
      id: poolId,
      name: poolName,
      description: this.cleanText(poolRecord?.['description']),
      depotManager: this.cleanText(poolRecord?.['depotManager']),
      vehicleIds: [],
    };

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehiclePools: [...snapshot.vehiclePools, pool],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Neuer Fahrzeugpool "${poolName}".`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'create', entityType: 'vehiclePool', id: poolId, label: poolName },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildPersonnelPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.personnel ??
        payloadRecord['person'] ??
        payloadRecord['people'] ??
        payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Person wird benötigt.');
    }

    const defaultPoolRef = this.parsePoolReference(
      payload.pool ?? payloadRecord['pool'] ?? payloadRecord['poolName'],
    );
    const servicePoolLabels = new Map(
      snapshot.personnelServicePools.map((pool) => [pool.id, pool.name]),
    );
    const personnel: Personnel[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const poolNames = new Set<string>();
    const seenPersonnelNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      let firstName = this.cleanText(record?.['firstName']);
      let lastName = this.cleanText(record?.['lastName']);

      if (!firstName || !lastName) {
        const fullName =
          this.cleanText(
            typeof raw === 'string'
              ? raw
              : record?.['name'] ?? record?.['fullName'] ?? record?.['label'],
          ) ?? undefined;
        if (fullName) {
          const parsed = this.splitFullName(fullName);
          firstName = firstName ?? parsed.firstName;
          lastName = lastName ?? parsed.lastName;
        }
      }

      if (!firstName || !lastName) {
        return this.buildFeedbackResponse('Vor- und Nachname fehlen.');
      }
      const fullName = `${firstName} ${lastName}`;
      const normalizedName = this.normalizeKey(fullName);
      if (seenPersonnelNames.has(normalizedName)) {
        return this.buildFeedbackResponse(`Personal "${fullName}" ist doppelt angegeben.`);
      }
      seenPersonnelNames.add(normalizedName);

      const recordPoolRef = this.parsePoolReference(
        record?.['pool'] ?? record?.['poolName'] ?? record?.['poolId'],
      );
      const poolRef = recordPoolRef ?? defaultPoolRef;
      if (!poolRef) {
        return this.buildFeedbackResponse(
          `Personal "${firstName} ${lastName}": Pool fehlt.`,
        );
      }

      const resolvedPool = this.resolvePoolIdByReference(
        snapshot.personnelPools,
        poolRef,
        'Personalpool',
        { allowSystem: false, systemId: SYSTEM_POOL_IDS.personnelPool },
        {
          title: `Mehrere Personalpools mit Namen "${poolRef}" gefunden. Welchen meinst du?`,
          apply: {
            mode: 'value',
            path: recordPoolRef ? ['personnel', index, 'pool'] : ['pool'],
          },
        },
      );
      if (resolvedPool.clarification) {
        return this.buildClarificationResponse(resolvedPool.clarification, context);
      }
      if (resolvedPool.feedback) {
        return this.buildFeedbackResponse(
          `Personal "${firstName} ${lastName}": ${resolvedPool.feedback}`,
        );
      }

      const serviceNames = this.parseStringArray(
        record?.['services'] ?? record?.['serviceNames'] ?? record?.['serviceIds'],
      );
      const serviceResult = this.resolvePersonnelServiceIds(
        snapshot.personnelServices,
        serviceNames,
        serviceNames?.length
          ? {
              applyPath: ['personnel', index, 'services'],
              poolLabelById: servicePoolLabels,
            }
          : undefined,
      );
      if (serviceResult.clarification) {
        return this.buildClarificationResponse(serviceResult.clarification, context);
      }
      if (serviceResult.feedback) {
        return this.buildFeedbackResponse(
          `Personal "${firstName} ${lastName}": ${serviceResult.feedback}`,
        );
      }

      const person: Personnel = {
        id: this.generateId('P'),
        firstName,
        lastName,
        preferredName: this.cleanText(record?.['preferredName']),
        qualifications: this.parseStringArray(record?.['qualifications']),
        serviceIds: serviceResult.ids,
        poolId: resolvedPool.id,
        homeStation: this.cleanText(record?.['homeStation']),
        availabilityStatus: this.cleanText(record?.['availabilityStatus']),
        qualificationExpires: this.cleanText(record?.['qualificationExpires']),
        isReserve: this.parseBoolean(record?.['isReserve']),
      };
      personnel.push(person);

      const label = `${firstName} ${lastName}`;
      const poolLabel = resolvedPool.label ?? poolRef;
      poolNames.add(poolLabel);
      changes.push({
        kind: 'create',
        entityType: 'personnel',
        id: person.id,
        label,
        details: `Pool ${poolLabel}`,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      personnel: [...snapshot.personnel, ...personnel],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      poolNames.size === 1
        ? `Neues Personal (${personnel.length}) im Pool "${Array.from(poolNames)[0]}".`
        : `Neues Personal (${personnel.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildVehiclePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.vehicles ?? payloadRecord['vehicle'] ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Fahrzeug wird benötigt.');
    }

    const defaultPoolRef = this.parsePoolReference(
      payload.pool ?? payloadRecord['pool'] ?? payloadRecord['poolName'],
    );
    const servicePoolLabels = new Map(
      snapshot.vehicleServicePools.map((pool) => [pool.id, pool.name]),
    );
    const vehicles: Vehicle[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const poolNames = new Set<string>();
    const usedNumbers = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const vehicleNumber =
        this.cleanText(
          typeof raw === 'string'
            ? raw
            : record?.['vehicleNumber'] ?? record?.['number'] ?? record?.['name'],
        ) ?? undefined;
      if (!vehicleNumber) {
        return this.buildFeedbackResponse('Fahrzeugnummer fehlt.');
      }

      const normalizedNumber = this.normalizeKey(vehicleNumber);
      if (usedNumbers.has(normalizedNumber)) {
        return this.buildFeedbackResponse(
          `Fahrzeugnummer "${vehicleNumber}" ist doppelt im Request.`,
        );
      }
      const existing = snapshot.vehicles.find(
        (entry) =>
          this.normalizeKey(
            entry.vehicleNumber ?? entry.name ?? entry.id ?? '',
          ) === normalizedNumber,
      );
      if (existing) {
        return this.buildFeedbackResponse(
          `Fahrzeugnummer "${vehicleNumber}" existiert bereits.`,
        );
      }
      usedNumbers.add(normalizedNumber);

      const typeRef = this.cleanText(
        record?.['typeId'] ??
          record?.['type'] ??
          record?.['typeLabel'] ??
          record?.['vehicleType'],
      );
      if (!typeRef) {
        return this.buildFeedbackResponse(
          `Fahrzeug "${vehicleNumber}": Typ fehlt.`,
        );
      }
      const typeResult = this.resolveVehicleTypeIdByReference(
        snapshot.vehicleTypes,
        typeRef,
        { apply: { mode: 'value', path: ['vehicles', index, 'typeId'] } },
      );
      if (typeResult.clarification) {
        return this.buildClarificationResponse(typeResult.clarification, context);
      }
      if (typeResult.feedback) {
        return this.buildFeedbackResponse(
          `Fahrzeug "${vehicleNumber}": ${typeResult.feedback}`,
        );
      }

      const recordPoolRef = this.parsePoolReference(
        record?.['pool'] ?? record?.['poolName'] ?? record?.['poolId'],
      );
      const poolRef = recordPoolRef ?? defaultPoolRef;
      let poolId: string | undefined;
      let poolLabel: string | undefined;
      if (poolRef) {
        const resolvedPool = this.resolvePoolIdByReference(
          snapshot.vehiclePools,
          poolRef,
          'Fahrzeugpool',
          { allowSystem: false, systemId: SYSTEM_POOL_IDS.vehiclePool },
          {
            apply: {
              mode: 'value',
              path: recordPoolRef ? ['vehicles', index, 'pool'] : ['pool'],
            },
          },
        );
        if (resolvedPool.clarification) {
          return this.buildClarificationResponse(resolvedPool.clarification, context);
        }
        if (resolvedPool.feedback) {
          return this.buildFeedbackResponse(
            `Fahrzeug "${vehicleNumber}": ${resolvedPool.feedback}`,
          );
        }
        poolId = resolvedPool.id;
        poolLabel = resolvedPool.label ?? poolRef;
        poolNames.add(poolLabel);
      }

      const serviceNames = this.parseStringArray(
        record?.['services'] ?? record?.['serviceNames'] ?? record?.['serviceIds'],
      );
      const serviceResult = this.resolveVehicleServiceIds(
        snapshot.vehicleServices,
        serviceNames,
        serviceNames?.length
          ? {
              applyPath: ['vehicles', index, 'services'],
              poolLabelById: servicePoolLabels,
            }
          : undefined,
      );
      if (serviceResult.clarification) {
        return this.buildClarificationResponse(serviceResult.clarification, context);
      }
      if (serviceResult.feedback) {
        return this.buildFeedbackResponse(
          `Fahrzeug "${vehicleNumber}": ${serviceResult.feedback}`,
        );
      }

      const vehicle: Vehicle = {
        id: this.generateId('V'),
        vehicleNumber,
        typeId: typeResult.id,
        poolId,
        serviceIds: serviceResult.ids,
        description: this.cleanText(record?.['description']),
        depot: this.cleanText(record?.['depot']),
      };
      vehicles.push(vehicle);

      changes.push({
        kind: 'create',
        entityType: 'vehicle',
        id: vehicle.id,
        label: vehicleNumber,
        details: poolLabel ? `Pool ${poolLabel}` : undefined,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicles: [...snapshot.vehicles, ...vehicles],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    let summary = `Neue Fahrzeuge (${vehicles.length}).`;
    if (poolNames.size === 1) {
      summary = `Neue Fahrzeuge (${vehicles.length}) im Pool "${Array.from(poolNames)[0]}".`;
    }

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildHomeDepotPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.homeDepots ?? payload.homeDepot ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Heimatdepot wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const depots: HomeDepot[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const name =
        this.cleanText(typeof raw === 'string' ? raw : record?.['name']) ??
        this.cleanText(record?.['label']);
      if (!name) {
        return this.buildFeedbackResponse('Depotname fehlt.');
      }
      const normalizedName = this.normalizeKey(name);
      if (seenNames.has(normalizedName)) {
        return this.buildFeedbackResponse(`Depot "${name}" ist doppelt angegeben.`);
      }
      if (this.hasNameCollision(snapshot.homeDepots, name)) {
        return this.buildFeedbackResponse(`Heimatdepot "${name}" existiert bereits.`);
      }
      seenNames.add(normalizedName);

      const siteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['siteIds']),
        { applyPath: ['homeDepots', index, 'siteIds'] },
      );
      if (siteIdsResult.clarification) {
        return this.buildClarificationResponse(siteIdsResult.clarification, context);
      }
      if (siteIdsResult.feedback) {
        return this.buildFeedbackResponse(siteIdsResult.feedback);
      }
      const breakSiteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['breakSiteIds']),
        { applyPath: ['homeDepots', index, 'breakSiteIds'] },
      );
      if (breakSiteIdsResult.clarification) {
        return this.buildClarificationResponse(breakSiteIdsResult.clarification, context);
      }
      if (breakSiteIdsResult.feedback) {
        return this.buildFeedbackResponse(breakSiteIdsResult.feedback);
      }
      const shortBreakSiteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['shortBreakSiteIds']),
        { applyPath: ['homeDepots', index, 'shortBreakSiteIds'] },
      );
      if (shortBreakSiteIdsResult.clarification) {
        return this.buildClarificationResponse(shortBreakSiteIdsResult.clarification, context);
      }
      if (shortBreakSiteIdsResult.feedback) {
        return this.buildFeedbackResponse(shortBreakSiteIdsResult.feedback);
      }
      const overnightSiteIdsResult = this.resolvePersonnelSiteIds(
        state.personnelSites,
        this.parseStringArray(record?.['overnightSiteIds']),
        { applyPath: ['homeDepots', index, 'overnightSiteIds'] },
      );
      if (overnightSiteIdsResult.clarification) {
        return this.buildClarificationResponse(overnightSiteIdsResult.clarification, context);
      }
      if (overnightSiteIdsResult.feedback) {
        return this.buildFeedbackResponse(overnightSiteIdsResult.feedback);
      }

      const depot: HomeDepot = {
        id: this.generateId('HD'),
        name,
        description: this.cleanText(record?.['description']),
        siteIds: siteIdsResult.ids ?? [],
        breakSiteIds: breakSiteIdsResult.ids ?? [],
        shortBreakSiteIds: shortBreakSiteIdsResult.ids ?? [],
        overnightSiteIds: overnightSiteIdsResult.ids ?? [],
      };
      depots.push(depot);
      changes.push({
        kind: 'create',
        entityType: 'homeDepot',
        id: depot.id,
        label: depot.name,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      homeDepots: [...snapshot.homeDepots, ...depots],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      depots.length === 1
        ? `Neues Heimatdepot "${depots[0].name}".`
        : `Neue Heimdepots (${depots.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdateHomeDepotPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['homeDepot']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Heimatdepot fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.homeDepots, targetRecord, {
      label: 'Heimatdepot',
      nameKeys: ['name', 'label'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Depot nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const depot = targetResult.item;
    const updated: HomeDepot = { ...depot };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (this.hasNameCollision(snapshot.homeDepots, name, depot.id)) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'description')) {
      updated.description = this.cleanText(patch['description']);
      changed = true;
    }

    const state = this.ensureTopologyState(context);
    if (this.hasOwn(patch, 'siteIds')) {
      const refs = this.parseStringArray(patch['siteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'siteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.siteIds = result.ids ?? [];
      changed = true;
    }

    if (this.hasOwn(patch, 'breakSiteIds')) {
      const refs = this.parseStringArray(patch['breakSiteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'breakSiteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.breakSiteIds = result.ids ?? [];
      changed = true;
    }

    if (this.hasOwn(patch, 'shortBreakSiteIds')) {
      const refs = this.parseStringArray(patch['shortBreakSiteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'shortBreakSiteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.shortBreakSiteIds = result.ids ?? [];
      changed = true;
    }

    if (this.hasOwn(patch, 'overnightSiteIds')) {
      const refs = this.parseStringArray(patch['overnightSiteIds']) ?? [];
      const result = this.resolvePersonnelSiteIds(state.personnelSites, refs, {
        applyPath: ['patch', 'overnightSiteIds'],
      });
      if (result.clarification) {
        return this.buildClarificationResponse(result.clarification, context);
      }
      if (result.feedback) {
        return this.buildFeedbackResponse(result.feedback);
      }
      updated.overnightSiteIds = result.ids ?? [];
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextDepots = snapshot.homeDepots.map((entry) =>
      entry.id === depot.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      homeDepots: nextDepots,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? depot.name;
    const summary = `Heimatdepot "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'homeDepot', id: depot.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeleteHomeDepotPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['homeDepot']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Heimatdepot fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.homeDepots, targetRecord, {
      label: 'Heimatdepot',
      nameKeys: ['name', 'label'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Depot nicht gefunden.');
    }

    const depot = targetResult.item;
    const nextDepots = snapshot.homeDepots.filter((entry) => entry.id !== depot.id);
    const nextPersonnelServicePools = snapshot.personnelServicePools.map((pool) =>
      pool.homeDepotId === depot.id ? { ...pool, homeDepotId: undefined } : pool,
    );
    const nextPersonnelPools = snapshot.personnelPools.map((pool) =>
      pool.homeDepotId === depot.id ? { ...pool, homeDepotId: undefined } : pool,
    );

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      homeDepots: nextDepots,
      personnelServicePools: nextPersonnelServicePools,
      personnelPools: nextPersonnelPools,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const affectedPools =
      snapshot.personnelServicePools.filter((pool) => pool.homeDepotId === depot.id).length +
      snapshot.personnelPools.filter((pool) => pool.homeDepotId === depot.id).length;
    const summary = affectedPools
      ? `Heimatdepot "${depot.name}" gelöscht (${affectedPools} Pools ohne Heimatdepot).`
      : `Heimatdepot "${depot.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'homeDepot', id: depot.id, label: depot.name },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildVehicleTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.vehicleTypes ?? payload.vehicleType ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Fahrzeugtyp wird benötigt.');
    }

    const types: VehicleType[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenLabels = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const label =
        this.cleanText(typeof raw === 'string' ? raw : record?.['label']) ??
        this.cleanText(record?.['name']);
      if (!label) {
        return this.buildFeedbackResponse('Bezeichnung fehlt.');
      }
      const normalizedLabel = this.normalizeKey(label);
      if (seenLabels.has(normalizedLabel)) {
        return this.buildFeedbackResponse(`Fahrzeugtyp "${label}" ist doppelt angegeben.`);
      }
      if (
        snapshot.vehicleTypes.some(
          (entry) => this.normalizeKey(entry.label) === normalizedLabel,
        )
      ) {
        return this.buildFeedbackResponse(`Fahrzeugtyp "${label}" existiert bereits.`);
      }
      seenLabels.add(normalizedLabel);

      const tiltingRaw = this.cleanText(record?.['tiltingCapability']);
      const tilting =
        tiltingRaw === 'none' || tiltingRaw === 'passive' || tiltingRaw === 'active'
          ? tiltingRaw
          : undefined;
      if (tiltingRaw && !tilting) {
        return this.buildFeedbackResponse(
          `Fahrzeugtyp "${label}": Neigetechnik ist ungültig.`,
        );
      }

      const powerSupplySystems = this.parseStringArray(record?.['powerSupplySystems']);
      const trainProtectionSystems = this.parseStringArray(record?.['trainProtectionSystems']);

      const type: VehicleType = {
        id: this.generateId('VT'),
        label,
        category: this.cleanText(record?.['category']),
        capacity: this.parseNumber(record?.['capacity']),
        maxSpeed: this.parseNumber(record?.['maxSpeed']),
        maintenanceIntervalDays: this.parseNumber(record?.['maintenanceIntervalDays']),
        energyType: this.cleanText(record?.['energyType']),
        manufacturer: this.cleanText(record?.['manufacturer']),
        trainTypeCode: this.cleanText(record?.['trainTypeCode']),
        lengthMeters: this.parseNumber(record?.['lengthMeters']),
        weightTons: this.parseNumber(record?.['weightTons']),
        brakeType: this.cleanText(record?.['brakeType']),
        brakePercentage: this.parseNumber(record?.['brakePercentage']),
        tiltingCapability: tilting ?? null,
        powerSupplySystems: powerSupplySystems?.length ? powerSupplySystems : undefined,
        trainProtectionSystems: trainProtectionSystems?.length
          ? trainProtectionSystems
          : undefined,
        etcsLevel: this.cleanText(record?.['etcsLevel']),
        gaugeProfile: this.cleanText(record?.['gaugeProfile']),
        maxAxleLoad: this.parseNumber(record?.['maxAxleLoad']),
        noiseCategory: this.cleanText(record?.['noiseCategory']),
        remarks: this.cleanText(record?.['remarks']),
      };
      types.push(type);
      changes.push({
        kind: 'create',
        entityType: 'vehicleType',
        id: type.id,
        label: type.label,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleTypes: [...snapshot.vehicleTypes, ...types],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      types.length === 1
        ? `Neuer Fahrzeugtyp "${types[0].label}".`
        : `Neue Fahrzeugtypen (${types.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdateVehicleTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicleType']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }

    const typeRef =
      this.extractFirstText(targetRecord, [
        'id',
        'typeId',
        'label',
        'name',
        'typeLabel',
        'vehicleType',
      ]) ?? '';
    if (!typeRef) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }
    const resolved = this.resolveVehicleTypeIdByReference(snapshot.vehicleTypes, typeRef, {
      apply: { mode: 'target', path: ['target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.id) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Fahrzeugtyp nicht gefunden.');
    }

    const type = snapshot.vehicleTypes.find((entry) => entry.id === resolved.id);
    if (!type) {
      return this.buildFeedbackResponse('Fahrzeugtyp nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: VehicleType = { ...type };
    let changed = false;

    if (this.hasOwn(patch, 'label')) {
      const label = this.cleanText(patch['label']);
      if (!label) {
        return this.buildFeedbackResponse('Bezeichnung darf nicht leer sein.');
      }
      if (
        snapshot.vehicleTypes.some(
          (entry) =>
            entry.id !== type.id && this.normalizeKey(entry.label) === this.normalizeKey(label),
        )
      ) {
        return this.buildFeedbackResponse(`Bezeichnung "${label}" ist bereits vergeben.`);
      }
      updated.label = label;
      changed = true;
    }

    if (this.hasOwn(patch, 'category')) {
      updated.category = this.cleanText(patch['category']);
      changed = true;
    }
    if (this.hasOwn(patch, 'capacity')) {
      updated.capacity = this.parseNumber(patch['capacity']);
      changed = true;
    }
    if (this.hasOwn(patch, 'maxSpeed')) {
      updated.maxSpeed = this.parseNumber(patch['maxSpeed']);
      changed = true;
    }
    if (this.hasOwn(patch, 'maintenanceIntervalDays')) {
      updated.maintenanceIntervalDays = this.parseNumber(patch['maintenanceIntervalDays']);
      changed = true;
    }
    if (this.hasOwn(patch, 'energyType')) {
      updated.energyType = this.cleanText(patch['energyType']);
      changed = true;
    }
    if (this.hasOwn(patch, 'manufacturer')) {
      updated.manufacturer = this.cleanText(patch['manufacturer']);
      changed = true;
    }
    if (this.hasOwn(patch, 'trainTypeCode')) {
      updated.trainTypeCode = this.cleanText(patch['trainTypeCode']);
      changed = true;
    }
    if (this.hasOwn(patch, 'lengthMeters')) {
      updated.lengthMeters = this.parseNumber(patch['lengthMeters']);
      changed = true;
    }
    if (this.hasOwn(patch, 'weightTons')) {
      updated.weightTons = this.parseNumber(patch['weightTons']);
      changed = true;
    }
    if (this.hasOwn(patch, 'brakeType')) {
      updated.brakeType = this.cleanText(patch['brakeType']);
      changed = true;
    }
    if (this.hasOwn(patch, 'brakePercentage')) {
      updated.brakePercentage = this.parseNumber(patch['brakePercentage']);
      changed = true;
    }
    if (this.hasOwn(patch, 'tiltingCapability')) {
      const tiltingRaw = this.cleanText(patch['tiltingCapability']);
      const tilting =
        tiltingRaw === 'none' || tiltingRaw === 'passive' || tiltingRaw === 'active'
          ? tiltingRaw
          : undefined;
      if (tiltingRaw && !tilting) {
        return this.buildFeedbackResponse('Neigetechnik ist ungültig.');
      }
      updated.tiltingCapability = tilting ?? null;
      changed = true;
    }
    if (this.hasOwn(patch, 'powerSupplySystems')) {
      const values = this.parseStringArray(patch['powerSupplySystems']);
      updated.powerSupplySystems = values?.length ? values : undefined;
      changed = true;
    }
    if (this.hasOwn(patch, 'trainProtectionSystems')) {
      const values = this.parseStringArray(patch['trainProtectionSystems']);
      updated.trainProtectionSystems = values?.length ? values : undefined;
      changed = true;
    }
    if (this.hasOwn(patch, 'etcsLevel')) {
      updated.etcsLevel = this.cleanText(patch['etcsLevel']);
      changed = true;
    }
    if (this.hasOwn(patch, 'gaugeProfile')) {
      updated.gaugeProfile = this.cleanText(patch['gaugeProfile']);
      changed = true;
    }
    if (this.hasOwn(patch, 'maxAxleLoad')) {
      updated.maxAxleLoad = this.parseNumber(patch['maxAxleLoad']);
      changed = true;
    }
    if (this.hasOwn(patch, 'noiseCategory')) {
      updated.noiseCategory = this.cleanText(patch['noiseCategory']);
      changed = true;
    }
    if (this.hasOwn(patch, 'remarks')) {
      updated.remarks = this.cleanText(patch['remarks']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextTypes = snapshot.vehicleTypes.map((entry) =>
      entry.id === type.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleTypes: nextTypes,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugtyp "${updated.label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicleType', id: type.id, label: updated.label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeleteVehicleTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicleType']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }

    const typeRef =
      this.extractFirstText(targetRecord, [
        'id',
        'typeId',
        'label',
        'name',
        'typeLabel',
        'vehicleType',
      ]) ?? '';
    if (!typeRef) {
      return this.buildFeedbackResponse('Ziel-Fahrzeugtyp fehlt.');
    }
    const resolved = this.resolveVehicleTypeIdByReference(snapshot.vehicleTypes, typeRef, {
      apply: { mode: 'target', path: ['target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.id) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Fahrzeugtyp nicht gefunden.');
    }

    const type = snapshot.vehicleTypes.find((entry) => entry.id === resolved.id);
    if (!type) {
      return this.buildFeedbackResponse('Fahrzeugtyp nicht gefunden.');
    }

    const nextTypes = snapshot.vehicleTypes.filter((entry) => entry.id !== type.id);
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleTypes: nextTypes,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Fahrzeugtyp "${type.label}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'vehicleType', id: type.id, label: type.label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildVehicleCompositionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.vehicleCompositions ?? payload.vehicleComposition ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Komposition wird benötigt.');
    }

    const compositions: VehicleComposition[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenNames = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name =
        this.cleanText(typeof raw === 'string' ? raw : record['name']) ??
        this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Kompositionsname fehlt.');
      }
      const normalizedName = this.normalizeKey(name);
      if (seenNames.has(normalizedName)) {
        return this.buildFeedbackResponse(`Komposition "${name}" ist doppelt angegeben.`);
      }
      if (
        snapshot.vehicleCompositions.some(
          (entry) => this.normalizeKey(entry.name) === normalizedName,
        )
      ) {
        return this.buildFeedbackResponse(`Komposition "${name}" existiert bereits.`);
      }
      seenNames.add(normalizedName);

      const entriesResult = this.resolveVehicleCompositionEntries(
        snapshot.vehicleTypes,
        record,
        ['vehicleCompositions', index, 'entries'],
      );
      if (entriesResult.clarification) {
        return this.buildClarificationResponse(entriesResult.clarification, context);
      }
      if (entriesResult.feedback) {
        return this.buildFeedbackResponse(entriesResult.feedback);
      }
      const entries = entriesResult.entries ?? [];
      if (!entries.length) {
        return this.buildFeedbackResponse(
          `Komposition "${name}": Mindestens ein Fahrzeugtyp ist erforderlich.`,
        );
      }

      const composition: VehicleComposition = {
        id: this.generateId('VC'),
        name,
        entries,
        turnaroundBuffer: this.cleanText(record['turnaroundBuffer']),
        remark: this.cleanText(record['remark']),
      };
      compositions.push(composition);
      changes.push({
        kind: 'create',
        entityType: 'vehicleComposition',
        id: composition.id,
        label: composition.name,
      });
    }

    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleCompositions: [...snapshot.vehicleCompositions, ...compositions],
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary =
      compositions.length === 1
        ? `Neue Komposition "${compositions[0].name}".`
        : `Neue Kompositionen (${compositions.length}).`;

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildUpdateVehicleCompositionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicleComposition']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Komposition fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleCompositions, targetRecord, {
      label: 'Komposition',
      nameKeys: ['name', 'label'],
      idKeys: ['id', 'compositionId'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Komposition nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const composition = targetResult.item;
    const updated: VehicleComposition = { ...composition };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      if (
        snapshot.vehicleCompositions.some(
          (entry) =>
            entry.id !== composition.id &&
            this.normalizeKey(entry.name) === this.normalizeKey(name),
        )
      ) {
        return this.buildFeedbackResponse(`Name "${name}" ist bereits vergeben.`);
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasAnyKey(patch, ['entries', 'entriesSerialized'])) {
      const entriesResult = this.resolveVehicleCompositionEntries(
        snapshot.vehicleTypes,
        patch,
        ['patch', 'entries'],
      );
      if (entriesResult.clarification) {
        return this.buildClarificationResponse(entriesResult.clarification, context);
      }
      if (entriesResult.feedback) {
        return this.buildFeedbackResponse(entriesResult.feedback);
      }
      const entries = entriesResult.entries ?? [];
      if (!entries.length) {
        return this.buildFeedbackResponse('Mindestens ein Fahrzeugtyp ist erforderlich.');
      }
      updated.entries = entries;
      changed = true;
    }

    if (this.hasOwn(patch, 'turnaroundBuffer')) {
      updated.turnaroundBuffer = this.cleanText(patch['turnaroundBuffer']);
      changed = true;
    }

    if (this.hasOwn(patch, 'remark')) {
      updated.remark = this.cleanText(patch['remark']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const nextCompositions = snapshot.vehicleCompositions.map((entry) =>
      entry.id === composition.id ? updated : entry,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleCompositions: nextCompositions,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const label = updated.name ?? composition.name;
    const summary = `Komposition "${label}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'vehicleComposition', id: composition.id, label },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildDeleteVehicleCompositionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['vehicleComposition']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Komposition fehlt.');
    }

    const targetResult = this.findByIdOrName(snapshot.vehicleCompositions, targetRecord, {
      label: 'Komposition',
      nameKeys: ['name', 'label'],
      idKeys: ['id', 'compositionId'],
      clarification: { apply: { mode: 'target', path: ['target'] } },
    });
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(targetResult.feedback ?? 'Komposition nicht gefunden.');
    }

    const composition = targetResult.item;
    const nextCompositions = snapshot.vehicleCompositions.filter(
      (entry) => entry.id !== composition.id,
    );
    const nextSnapshot: ResourceSnapshot = {
      ...snapshot,
      vehicleCompositions: nextCompositions,
    };
    const normalized = this.planning.normalizeResourceSnapshot(nextSnapshot);

    const summary = `Komposition "${composition.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'vehicleComposition',
        id: composition.id,
        label: composition.name,
      },
    ];

    return {
      type: 'applied',
      snapshot: normalized,
      summary,
      changes,
    };
  }

  private buildTimetableYearPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.timetableYears ?? payload.timetableYear ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Fahrplanjahr wird benötigt.');
    }

    const labels: string[] = [];
    for (const raw of rawEntries) {
      const record = this.asRecord(raw);
      const label =
        this.cleanText(typeof raw === 'string' ? raw : record?.['label']) ??
        this.cleanText(record?.['name']);
      if (!label) {
        return this.buildFeedbackResponse('Fahrplanjahr-Label fehlt.');
      }
      labels.push(label);
    }

    const duplicateLabels = this.findDuplicateNames(labels);
    if (duplicateLabels.length) {
      return this.buildFeedbackResponse(
        `Fahrplanjahre doppelt angegeben: ${duplicateLabels.join(', ')}`,
      );
    }

    const commitTasks: AssistantActionCommitTask[] = labels.map((label) => ({
      type: 'timetableYear',
      action: 'create',
      label,
    }));
    const changes: AssistantActionChangeDto[] = labels.map((label) => ({
      kind: 'create',
      entityType: 'timetableYear',
      id: label,
      label,
    }));

    const summary =
      labels.length === 1
        ? `Fahrplanjahr "${labels[0]}" anlegen.`
        : `Fahrplanjahre anlegen (${labels.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteTimetableYearPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['timetableYear']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Fahrplanjahr fehlt.');
    }

    const label =
      this.cleanText(targetRecord['label']) ??
      this.cleanText(targetRecord['timetableYearLabel']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['id']);
    if (!label) {
      return this.buildFeedbackResponse('Fahrplanjahr-Label fehlt.');
    }

    const commitTasks: AssistantActionCommitTask[] = [
      { type: 'timetableYear', action: 'delete', label },
    ];
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'timetableYear', id: label, label },
    ];
    const summary = `Fahrplanjahr "${label}" löschen.`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildSimulationPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.simulations ?? payload.simulation ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Simulation wird benötigt.');
    }

    const tasks: AssistantActionCommitTask[] = [];
    const labels: string[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const seenLabels = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw);
      const label =
        this.cleanText(typeof raw === 'string' ? raw : record?.['label']) ??
        this.cleanText(record?.['name']);
      if (!label) {
        return this.buildFeedbackResponse('Simulationstitel fehlt.');
      }
      const normalized = this.normalizeKey(label);
      if (seenLabels.has(normalized)) {
        return this.buildFeedbackResponse(`Simulation "${label}" ist doppelt angegeben.`);
      }
      seenLabels.add(normalized);

      const yearLabel =
        this.extractTimetableYearLabel(record?.['timetableYearLabel'] ?? record?.['timetableYear']) ??
        this.extractTimetableYearLabel(payload.timetableYear ?? payloadRecord['timetableYear']);
      if (!yearLabel) {
        return this.buildFeedbackResponse(
          `Simulation "${label}": Fahrplanjahr fehlt.`,
        );
      }

      tasks.push({
        type: 'simulation',
        action: 'create',
        label,
        timetableYearLabel: yearLabel,
        description: this.cleanText(record?.['description']) ?? undefined,
      });
      labels.push(label);
      changes.push({
        kind: 'create',
        entityType: 'simulation',
        id: label,
        label,
        details: `Fahrplanjahr ${yearLabel}`,
      });
    }

    const summary =
      tasks.length === 1
        ? `Simulation "${labels[0] ?? 'Simulation'}" anlegen.`
        : `Simulationen anlegen (${tasks.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks: tasks,
    };
  }

  private buildUpdateSimulationPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['simulation']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Simulation fehlt.');
    }

    const variantId =
      this.cleanText(targetRecord['variantId']) ??
      this.cleanText(targetRecord['simulationId']) ??
      this.cleanText(targetRecord['id']);
    const targetLabel =
      this.cleanText(targetRecord['label']) ??
      this.cleanText(targetRecord['name']);
    const targetYearLabel = this.cleanText(targetRecord['timetableYearLabel']);
    if (!variantId && !targetLabel) {
      return this.buildFeedbackResponse('Simulation-ID oder Name fehlt.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const newLabel =
      this.cleanText(patch['label']) ?? this.cleanText(patch['name']) ?? undefined;
    const description = this.cleanText(patch['description']);
    if (!newLabel && !description) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    const task: AssistantActionCommitTask = {
      type: 'simulation',
      action: 'update',
      variantId: variantId ?? undefined,
      targetLabel: targetLabel ?? undefined,
      targetTimetableYearLabel: targetYearLabel ?? undefined,
      label: newLabel ?? undefined,
      description: description ?? undefined,
    };
    const label = newLabel ?? targetLabel ?? variantId ?? 'Simulation';
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'simulation', id: variantId ?? label, label },
    ];
    const summary = `Simulation "${label}" aktualisieren.`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks: [task],
    };
  }

  private buildDeleteSimulationPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['simulation']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Simulation fehlt.');
    }

    const variantId =
      this.cleanText(targetRecord['variantId']) ??
      this.cleanText(targetRecord['simulationId']) ??
      this.cleanText(targetRecord['id']);
    const label =
      this.cleanText(targetRecord['label']) ??
      this.cleanText(targetRecord['name']);
    const yearLabel = this.cleanText(targetRecord['timetableYearLabel']);
    if (!variantId && !label) {
      return this.buildFeedbackResponse('Simulation-ID oder Name fehlt.');
    }

    const task: AssistantActionCommitTask = {
      type: 'simulation',
      action: 'delete',
      variantId: variantId ?? undefined,
      targetLabel: label ?? undefined,
      targetTimetableYearLabel: yearLabel ?? undefined,
      label: label ?? undefined,
    };

    const summary = `Simulation "${label ?? variantId}" löschen.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'simulation',
        id: variantId ?? label ?? 'simulation',
        label: label ?? variantId ?? 'Simulation',
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks: [task],
    };
  }

  private buildOperationalPointPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.operationalPoints ?? payload.operationalPoint ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Operational Point wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const ops: OperationalPoint[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedOpIds = new Set<string>();
    const usedUniqueIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const opId =
        this.cleanText(record['opId']) ??
        this.cleanText(record['id']) ??
        this.generateId('OP');
      const uniqueOpId = this.cleanText(record['uniqueOpId']);
      const name = this.cleanText(record['name']) ?? this.cleanText(record['label']);
      const countryCode = this.cleanText(record['countryCode']);
      const opType = this.cleanText(record['opType']);

      if (!uniqueOpId) {
        return this.buildFeedbackResponse('Operational Point: uniqueOpId fehlt.');
      }
      if (!name) {
        return this.buildFeedbackResponse('Operational Point: Name fehlt.');
      }
      if (!countryCode) {
        return this.buildFeedbackResponse('Operational Point: Country Code fehlt.');
      }
      if (!opType) {
        return this.buildFeedbackResponse('Operational Point: Typ fehlt.');
      }

      if (
        usedOpIds.has(opId) ||
        state.operationalPoints.some((entry) => entry.opId === opId)
      ) {
        return this.buildFeedbackResponse(
          `Operational Point "${name}": opId "${opId}" ist bereits vergeben.`,
        );
      }
      if (
        usedUniqueIds.has(uniqueOpId) ||
        state.operationalPoints.some((entry) => entry.uniqueOpId === uniqueOpId)
      ) {
        return this.buildFeedbackResponse(
          `Operational Point "${name}": uniqueOpId "${uniqueOpId}" ist bereits vergeben.`,
        );
      }

      const positionResult = this.parsePosition(record, 'Operational Point');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }

      const op: OperationalPoint = {
        opId,
        uniqueOpId,
        name,
        countryCode,
        opType,
        position: positionResult.position,
      };
      ops.push(op);
      usedOpIds.add(opId);
      usedUniqueIds.add(uniqueOpId);
      changes.push({
        kind: 'create',
        entityType: 'operationalPoint',
        id: op.opId,
        label: op.name,
        details: op.uniqueOpId,
      });
    }

    state.operationalPoints = [...state.operationalPoints, ...ops];
    const commitTasks = this.buildTopologyCommitTasksForState(
      ['operationalPoints'],
      state,
    );
    const summary =
      ops.length === 1
        ? `Operational Point "${ops[0].name}" angelegt.`
        : `Operational Points angelegt (${ops.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdateOperationalPointPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['operationalPoint']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Operational Point fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveOperationalPointTarget(
      state.operationalPoints,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Operational Point nicht gefunden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const op = targetResult.item;
    const updated: OperationalPoint = { ...op };
    let changed = false;
    let uniqueChanged = false;
    const oldOpId = op.opId;
    const oldUnique = op.uniqueOpId;

    if (this.hasOwn(patch, 'opId')) {
      const opId = this.cleanText(patch['opId']);
      if (!opId) {
        return this.buildFeedbackResponse('opId darf nicht leer sein.');
      }
      if (
        state.operationalPoints.some(
          (entry) => entry.opId === opId && entry.opId !== oldOpId,
        )
      ) {
        return this.buildFeedbackResponse(`opId "${opId}" ist bereits vergeben.`);
      }
      updated.opId = opId;
      changed = true;
    }

    if (this.hasOwn(patch, 'uniqueOpId')) {
      const uniqueOpId = this.cleanText(patch['uniqueOpId']);
      if (!uniqueOpId) {
        return this.buildFeedbackResponse('uniqueOpId darf nicht leer sein.');
      }
      if (
        state.operationalPoints.some(
          (entry) => entry.uniqueOpId === uniqueOpId && entry.opId !== oldOpId,
        )
      ) {
        return this.buildFeedbackResponse(
          `uniqueOpId "${uniqueOpId}" ist bereits vergeben.`,
        );
      }
      updated.uniqueOpId = uniqueOpId;
      changed = true;
      uniqueChanged = uniqueOpId !== oldUnique;
    }

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }
    if (this.hasOwn(patch, 'countryCode')) {
      updated.countryCode = this.cleanText(patch['countryCode']) ?? updated.countryCode;
      changed = true;
    }
    if (this.hasOwn(patch, 'opType')) {
      updated.opType = this.cleanText(patch['opType']) ?? updated.opType;
      changed = true;
    }
    if (this.hasAnyKey(patch, ['lat', 'lng', 'position'])) {
      const positionResult = this.parsePosition(patch, 'Operational Point');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }
      updated.position = positionResult.position;
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    if (uniqueChanged) {
      this.relinkUniqueOpId(state, oldUnique, updated.uniqueOpId);
    }

    state.operationalPoints = state.operationalPoints.map((entry) =>
      entry.opId === oldOpId ? updated : entry,
    );
    const scopes: AssistantActionTopologyScope[] = ['operationalPoints'];
    if (uniqueChanged) {
      scopes.push(
        'sectionsOfLine',
        'personnelSites',
        'replacementStops',
        'opReplacementStopLinks',
        'transferEdges',
      );
    }
    const commitTasks = this.buildTopologyCommitTasksForState(scopes, state);
    const summary = uniqueChanged
      ? `Operational Point "${updated.name}" aktualisiert (Referenzen angepasst).`
      : `Operational Point "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'operationalPoint',
        id: updated.opId,
        label: updated.name,
        details: uniqueChanged ? 'Referenzen aktualisiert' : undefined,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteOperationalPointPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['operationalPoint']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Operational Point fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveOperationalPointTarget(
      state.operationalPoints,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Operational Point nicht gefunden.',
      );
    }

    const op = targetResult.item;
    const uniqueOpId = op.uniqueOpId;
    state.operationalPoints = state.operationalPoints.filter(
      (entry) => entry.opId !== op.opId,
    );

    const removedSections = state.sectionsOfLine.filter(
      (section) =>
        section.startUniqueOpId === uniqueOpId ||
        section.endUniqueOpId === uniqueOpId,
    );
    state.sectionsOfLine = state.sectionsOfLine.filter(
      (section) =>
        section.startUniqueOpId !== uniqueOpId &&
        section.endUniqueOpId !== uniqueOpId,
    );

    let updatedSites = 0;
    state.personnelSites = state.personnelSites.map((site) => {
      if (site.uniqueOpId !== uniqueOpId) {
        return site;
      }
      updatedSites += 1;
      return { ...site, uniqueOpId: undefined };
    });

    let updatedStops = 0;
    state.replacementStops = state.replacementStops.map((stop) => {
      if (stop.nearestUniqueOpId !== uniqueOpId) {
        return stop;
      }
      updatedStops += 1;
      return { ...stop, nearestUniqueOpId: undefined };
    });

    const removedLinks = state.opReplacementStopLinks.filter(
      (link) => link.uniqueOpId === uniqueOpId,
    );
    state.opReplacementStopLinks = state.opReplacementStopLinks.filter(
      (link) => link.uniqueOpId !== uniqueOpId,
    );

    const removedTransfers = state.transferEdges.filter(
      (edge) =>
        this.transferNodeMatches(edge.from, { kind: 'OP', uniqueOpId }) ||
        this.transferNodeMatches(edge.to, { kind: 'OP', uniqueOpId }),
    );
    state.transferEdges = state.transferEdges.filter(
      (edge) =>
        !this.transferNodeMatches(edge.from, { kind: 'OP', uniqueOpId }) &&
        !this.transferNodeMatches(edge.to, { kind: 'OP', uniqueOpId }),
    );

    const scopes: AssistantActionTopologyScope[] = [
      'operationalPoints',
      'sectionsOfLine',
      'personnelSites',
      'replacementStops',
      'opReplacementStopLinks',
      'transferEdges',
    ];
    const commitTasks = this.buildTopologyCommitTasksForState(scopes, state);
    const details: string[] = [];
    if (removedSections.length) {
      details.push(`${removedSections.length} Sections of Line entfernt`);
    }
    if (updatedSites) {
      details.push(`${updatedSites} Personnel Sites angepasst`);
    }
    if (updatedStops) {
      details.push(`${updatedStops} Replacement Stops angepasst`);
    }
    if (removedLinks.length) {
      details.push(`${removedLinks.length} OP-Links entfernt`);
    }
    if (removedTransfers.length) {
      details.push(`${removedTransfers.length} Transfer Edges entfernt`);
    }

    const summary = details.length
      ? `Operational Point "${op.name}" gelöscht (${details.join(', ')}).`
      : `Operational Point "${op.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'operationalPoint',
        id: op.opId,
        label: op.name,
        details: op.uniqueOpId,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildSectionOfLinePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.sectionsOfLine ?? payload.sectionOfLine ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Section of Line wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const sections: SectionOfLine[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const solId =
        this.cleanText(record['solId']) ??
        this.cleanText(record['id']) ??
        this.generateId('SOL');
      if (
        usedIds.has(solId) ||
        state.sectionsOfLine.some((entry) => entry.solId === solId)
      ) {
        return this.buildFeedbackResponse(
          `Section of Line "${solId}" ist bereits vorhanden.`,
        );
      }

      const startRef = this.cleanText(record['startUniqueOpId']);
      const endRef = this.cleanText(record['endUniqueOpId']);
      if (!startRef || !endRef) {
        return this.buildFeedbackResponse('Section of Line: Start/End-OP fehlen.');
      }
      const startResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        startRef,
        { apply: { mode: 'value', path: ['sectionsOfLine', index, 'startUniqueOpId'] } },
      );
      if (startResult.clarification) {
        return this.buildClarificationResponse(startResult.clarification, context);
      }
      if (startResult.feedback) {
        return this.buildFeedbackResponse(startResult.feedback);
      }
      const endResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        endRef,
        { apply: { mode: 'value', path: ['sectionsOfLine', index, 'endUniqueOpId'] } },
      );
      if (endResult.clarification) {
        return this.buildClarificationResponse(endResult.clarification, context);
      }
      if (endResult.feedback) {
        return this.buildFeedbackResponse(endResult.feedback);
      }
      if (startResult.uniqueOpId === endResult.uniqueOpId) {
        return this.buildFeedbackResponse('Section of Line: Start und Ziel sind identisch.');
      }

      const natureRaw =
        this.cleanText(record['nature'])?.toUpperCase() ?? 'REGULAR';
      if (!SECTION_OF_LINE_NATURES.has(natureRaw)) {
        return this.buildFeedbackResponse('Section of Line: Nature ist ungültig.');
      }
      const lengthKm = this.parseNumber(record['lengthKm']);

      const section: SectionOfLine = {
        solId,
        startUniqueOpId: startResult.uniqueOpId ?? startRef,
        endUniqueOpId: endResult.uniqueOpId ?? endRef,
        lengthKm,
        nature: natureRaw as SectionOfLine['nature'],
      };
      sections.push(section);
      usedIds.add(solId);
      changes.push({
        kind: 'create',
        entityType: 'sectionOfLine',
        id: solId,
        label: `${section.startUniqueOpId} -> ${section.endUniqueOpId}`,
      });
    }

    state.sectionsOfLine = [...state.sectionsOfLine, ...sections];
    const commitTasks = this.buildTopologyCommitTasksForState(['sectionsOfLine'], state);
    const summary =
      sections.length === 1
        ? `Section of Line "${sections[0].solId}" angelegt.`
        : `Sections of Line angelegt (${sections.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdateSectionOfLinePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['sectionOfLine']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Section of Line fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveSectionOfLineTarget(
      state.sectionsOfLine,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Section of Line nicht gefunden.',
      );
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const section = targetResult.item;
    const updated: SectionOfLine = { ...section };
    let changed = false;

    let startUniqueOpId = section.startUniqueOpId;
    let endUniqueOpId = section.endUniqueOpId;

    if (this.hasOwn(patch, 'startUniqueOpId')) {
      const startRef = this.cleanText(patch['startUniqueOpId']);
      if (!startRef) {
        return this.buildFeedbackResponse('Start-OP fehlt.');
      }
      const startResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        startRef,
        { apply: { mode: 'value', path: ['patch', 'startUniqueOpId'] } },
      );
      if (startResult.clarification) {
        return this.buildClarificationResponse(startResult.clarification, context);
      }
      if (startResult.feedback) {
        return this.buildFeedbackResponse(startResult.feedback);
      }
      startUniqueOpId = startResult.uniqueOpId ?? startRef;
      changed = true;
    }

    if (this.hasOwn(patch, 'endUniqueOpId')) {
      const endRef = this.cleanText(patch['endUniqueOpId']);
      if (!endRef) {
        return this.buildFeedbackResponse('End-OP fehlt.');
      }
      const endResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        endRef,
        { apply: { mode: 'value', path: ['patch', 'endUniqueOpId'] } },
      );
      if (endResult.clarification) {
        return this.buildClarificationResponse(endResult.clarification, context);
      }
      if (endResult.feedback) {
        return this.buildFeedbackResponse(endResult.feedback);
      }
      endUniqueOpId = endResult.uniqueOpId ?? endRef;
      changed = true;
    }

    if (startUniqueOpId === endUniqueOpId) {
      return this.buildFeedbackResponse('Start- und End-OP dürfen nicht gleich sein.');
    }

    if (this.hasOwn(patch, 'nature')) {
      const natureRaw =
        this.cleanText(patch['nature'])?.toUpperCase() ?? '';
      if (!SECTION_OF_LINE_NATURES.has(natureRaw)) {
        return this.buildFeedbackResponse('Nature ist ungültig.');
      }
      updated.nature = natureRaw as SectionOfLine['nature'];
      changed = true;
    }

    if (this.hasOwn(patch, 'lengthKm')) {
      updated.lengthKm = this.parseNumber(patch['lengthKm']);
      changed = true;
    }

    updated.startUniqueOpId = startUniqueOpId;
    updated.endUniqueOpId = endUniqueOpId;

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.sectionsOfLine = state.sectionsOfLine.map((entry) =>
      entry.solId === section.solId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['sectionsOfLine'], state);
    const summary = `Section of Line "${updated.solId}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'sectionOfLine', id: updated.solId, label: updated.solId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteSectionOfLinePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['sectionOfLine']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Section of Line fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const targetResult = this.resolveSectionOfLineTarget(
      state.sectionsOfLine,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (targetResult.clarification) {
      return this.buildClarificationResponse(targetResult.clarification, context);
    }
    if (targetResult.feedback || !targetResult.item) {
      return this.buildFeedbackResponse(
        targetResult.feedback ?? 'Section of Line nicht gefunden.',
      );
    }

    const section = targetResult.item;
    state.sectionsOfLine = state.sectionsOfLine.filter(
      (entry) => entry.solId !== section.solId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(['sectionsOfLine'], state);
    const summary = `Section of Line "${section.solId}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'sectionOfLine', id: section.solId, label: section.solId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildPersonnelSitePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.personnelSites ?? payload.personnelSite ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Personnel Site wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const sites: PersonnelSite[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name = this.cleanText(record['name']) ?? this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Personnel Site: Name fehlt.');
      }
      const siteTypeRaw =
        this.cleanText(record['siteType'])?.toUpperCase() ?? '';
      if (!PERSONNEL_SITE_TYPES.has(siteTypeRaw)) {
        return this.buildFeedbackResponse('Personnel Site: Site-Typ ist ungültig.');
      }
      const siteId =
        this.cleanText(record['siteId']) ??
        this.cleanText(record['id']) ??
        this.generateId('SITE');
      if (
        usedIds.has(siteId) ||
        state.personnelSites.some((entry) => entry.siteId === siteId)
      ) {
        return this.buildFeedbackResponse(
          `Personnel Site "${name}": siteId "${siteId}" ist bereits vergeben.`,
        );
      }

      const positionResult = this.parsePosition(record, 'Personnel Site');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }

      let uniqueOpId: string | undefined;
      const opRef = this.cleanText(record['uniqueOpId']);
      if (opRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          opRef,
          { apply: { mode: 'value', path: ['personnelSites', index, 'uniqueOpId'] } },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(opResult.clarification, context);
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        uniqueOpId = opResult.uniqueOpId ?? opRef;
      }

      const site: PersonnelSite = {
        siteId,
        siteType: siteTypeRaw as PersonnelSite['siteType'],
        name,
        uniqueOpId,
        position: positionResult.position ?? { lat: 0, lng: 0 },
        openingHoursJson: this.cleanText(record['openingHoursJson']),
      };
      sites.push(site);
      usedIds.add(siteId);
      changes.push({
        kind: 'create',
        entityType: 'personnelSite',
        id: site.siteId,
        label: site.name,
      });
    }

    state.personnelSites = [...state.personnelSites, ...sites];
    const commitTasks = this.buildTopologyCommitTasksForState(['personnelSites'], state);
    const summary =
      sites.length === 1
        ? `Personnel Site "${sites[0].name}" angelegt.`
        : `Personnel Sites angelegt (${sites.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdatePersonnelSitePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnelSite']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personnel Site fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const siteRef =
      this.cleanText(targetRecord['siteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!siteRef) {
      return this.buildFeedbackResponse('Personnel Site fehlt.');
    }
    const siteResult = this.resolvePersonnelSiteIdByReference(
      state.personnelSites,
      siteRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (siteResult.clarification) {
      return this.buildClarificationResponse(siteResult.clarification, context);
    }
    if (siteResult.feedback || !siteResult.siteId) {
      return this.buildFeedbackResponse(siteResult.feedback ?? 'Personnel Site nicht gefunden.');
    }

    const site = state.personnelSites.find((entry) => entry.siteId === siteResult.siteId);
    if (!site) {
      return this.buildFeedbackResponse('Personnel Site nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: PersonnelSite = { ...site };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }

    if (this.hasOwn(patch, 'siteType')) {
      const siteTypeRaw =
        this.cleanText(patch['siteType'])?.toUpperCase() ?? '';
      if (!PERSONNEL_SITE_TYPES.has(siteTypeRaw)) {
        return this.buildFeedbackResponse('Site-Typ ist ungültig.');
      }
      updated.siteType = siteTypeRaw as PersonnelSite['siteType'];
      changed = true;
    }

    if (this.hasOwn(patch, 'uniqueOpId')) {
      const opRef = this.cleanText(patch['uniqueOpId']);
      if (opRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          opRef,
          { apply: { mode: 'value', path: ['patch', 'uniqueOpId'] } },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(opResult.clarification, context);
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        updated.uniqueOpId = opResult.uniqueOpId ?? opRef;
      } else {
        updated.uniqueOpId = undefined;
      }
      changed = true;
    }

    if (this.hasAnyKey(patch, ['lat', 'lng', 'position'])) {
      const positionResult = this.parsePosition(patch, 'Personnel Site');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }
      updated.position = positionResult.position ?? updated.position;
      changed = true;
    }

    if (this.hasOwn(patch, 'openingHoursJson')) {
      updated.openingHoursJson = this.cleanText(patch['openingHoursJson']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.personnelSites = state.personnelSites.map((entry) =>
      entry.siteId === site.siteId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['personnelSites'], state);
    const summary = `Personnel Site "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'personnelSite', id: updated.siteId, label: updated.name },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeletePersonnelSitePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['personnelSite']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Personnel Site fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const siteRef =
      this.cleanText(targetRecord['siteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!siteRef) {
      return this.buildFeedbackResponse('Personnel Site fehlt.');
    }
    const siteResult = this.resolvePersonnelSiteIdByReference(
      state.personnelSites,
      siteRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (siteResult.clarification) {
      return this.buildClarificationResponse(siteResult.clarification, context);
    }
    if (siteResult.feedback || !siteResult.siteId) {
      return this.buildFeedbackResponse(siteResult.feedback ?? 'Personnel Site nicht gefunden.');
    }

    const site = state.personnelSites.find((entry) => entry.siteId === siteResult.siteId);
    if (!site) {
      return this.buildFeedbackResponse('Personnel Site nicht gefunden.');
    }

    state.personnelSites = state.personnelSites.filter(
      (entry) => entry.siteId !== site.siteId,
    );
    const removedTransfers = state.transferEdges.filter(
      (edge) =>
        this.transferNodeMatches(edge.from, { kind: 'PERSONNEL_SITE', siteId: site.siteId }) ||
        this.transferNodeMatches(edge.to, { kind: 'PERSONNEL_SITE', siteId: site.siteId }),
    );
    state.transferEdges = state.transferEdges.filter(
      (edge) =>
        !this.transferNodeMatches(edge.from, { kind: 'PERSONNEL_SITE', siteId: site.siteId }) &&
        !this.transferNodeMatches(edge.to, { kind: 'PERSONNEL_SITE', siteId: site.siteId }),
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      ['personnelSites', 'transferEdges'],
      state,
    );
    const summary = removedTransfers.length
      ? `Personnel Site "${site.name}" gelöscht (${removedTransfers.length} Transfer Edges entfernt).`
      : `Personnel Site "${site.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'personnelSite', id: site.siteId, label: site.name },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildReplacementStopPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.replacementStops ?? payload.replacementStop ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein Replacement Stop wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const stops: ReplacementStop[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name = this.cleanText(record['name']) ?? this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Replacement Stop: Name fehlt.');
      }
      const stopId =
        this.cleanText(record['replacementStopId']) ??
        this.cleanText(record['id']) ??
        this.generateId('RSTOP');
      if (
        usedIds.has(stopId) ||
        state.replacementStops.some((entry) => entry.replacementStopId === stopId)
      ) {
        return this.buildFeedbackResponse(
          `Replacement Stop "${name}": ID "${stopId}" ist bereits vergeben.`,
        );
      }

      const positionResult = this.parsePosition(record, 'Replacement Stop');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }

      let nearestUniqueOpId: string | undefined;
      const nearestRef = this.cleanText(record['nearestUniqueOpId']);
      if (nearestRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          nearestRef,
          { apply: { mode: 'value', path: ['replacementStops', index, 'nearestUniqueOpId'] } },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(opResult.clarification, context);
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        nearestUniqueOpId = opResult.uniqueOpId ?? nearestRef;
      }

      const stop: ReplacementStop = {
        replacementStopId: stopId,
        name,
        stopCode: this.cleanText(record['stopCode']),
        nearestUniqueOpId,
        position: positionResult.position ?? { lat: 0, lng: 0 },
      };
      stops.push(stop);
      usedIds.add(stopId);
      changes.push({
        kind: 'create',
        entityType: 'replacementStop',
        id: stop.replacementStopId,
        label: stop.name,
      });
    }

    state.replacementStops = [...state.replacementStops, ...stops];
    const commitTasks = this.buildTopologyCommitTasksForState(['replacementStops'], state);
    const summary =
      stops.length === 1
        ? `Replacement Stop "${stops[0].name}" angelegt.`
        : `Replacement Stops angelegt (${stops.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdateReplacementStopPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementStop']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Stop fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const stopRef =
      this.cleanText(targetRecord['replacementStopId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!stopRef) {
      return this.buildFeedbackResponse('Replacement Stop fehlt.');
    }
    const stopResult = this.resolveReplacementStopIdByReference(
      state.replacementStops,
      stopRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (stopResult.clarification) {
      return this.buildClarificationResponse(stopResult.clarification, context);
    }
    if (stopResult.feedback || !stopResult.stopId) {
      return this.buildFeedbackResponse(stopResult.feedback ?? 'Replacement Stop nicht gefunden.');
    }

    const stop = state.replacementStops.find(
      (entry) => entry.replacementStopId === stopResult.stopId,
    );
    if (!stop) {
      return this.buildFeedbackResponse('Replacement Stop nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: ReplacementStop = { ...stop };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }
    if (this.hasOwn(patch, 'stopCode')) {
      updated.stopCode = this.cleanText(patch['stopCode']);
      changed = true;
    }
    if (this.hasOwn(patch, 'nearestUniqueOpId')) {
      const opRef = this.cleanText(patch['nearestUniqueOpId']);
      if (opRef) {
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          opRef,
          { apply: { mode: 'value', path: ['patch', 'nearestUniqueOpId'] } },
        );
        if (opResult.clarification) {
          return this.buildClarificationResponse(opResult.clarification, context);
        }
        if (opResult.feedback) {
          return this.buildFeedbackResponse(opResult.feedback);
        }
        updated.nearestUniqueOpId = opResult.uniqueOpId ?? opRef;
      } else {
        updated.nearestUniqueOpId = undefined;
      }
      changed = true;
    }
    if (this.hasAnyKey(patch, ['lat', 'lng', 'position'])) {
      const positionResult = this.parsePosition(patch, 'Replacement Stop');
      if (positionResult.feedback) {
        return this.buildFeedbackResponse(positionResult.feedback);
      }
      updated.position = positionResult.position ?? updated.position;
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.replacementStops = state.replacementStops.map((entry) =>
      entry.replacementStopId === stop.replacementStopId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['replacementStops'], state);
    const summary = `Replacement Stop "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'replacementStop',
        id: updated.replacementStopId,
        label: updated.name,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteReplacementStopPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementStop']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Stop fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const stopRef =
      this.cleanText(targetRecord['replacementStopId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!stopRef) {
      return this.buildFeedbackResponse('Replacement Stop fehlt.');
    }
    const stopResult = this.resolveReplacementStopIdByReference(
      state.replacementStops,
      stopRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (stopResult.clarification) {
      return this.buildClarificationResponse(stopResult.clarification, context);
    }
    if (stopResult.feedback || !stopResult.stopId) {
      return this.buildFeedbackResponse(stopResult.feedback ?? 'Replacement Stop nicht gefunden.');
    }

    const stop = state.replacementStops.find(
      (entry) => entry.replacementStopId === stopResult.stopId,
    );
    if (!stop) {
      return this.buildFeedbackResponse('Replacement Stop nicht gefunden.');
    }

    state.replacementStops = state.replacementStops.filter(
      (entry) => entry.replacementStopId !== stop.replacementStopId,
    );
    const removedEdges = state.replacementEdges.filter(
      (edge) =>
        edge.fromStopId === stop.replacementStopId ||
        edge.toStopId === stop.replacementStopId,
    );
    state.replacementEdges = state.replacementEdges.filter(
      (edge) =>
        edge.fromStopId !== stop.replacementStopId &&
        edge.toStopId !== stop.replacementStopId,
    );
    const removedLinks = state.opReplacementStopLinks.filter(
      (link) => link.replacementStopId === stop.replacementStopId,
    );
    state.opReplacementStopLinks = state.opReplacementStopLinks.filter(
      (link) => link.replacementStopId !== stop.replacementStopId,
    );
    const removedTransfers = state.transferEdges.filter(
      (edge) =>
        this.transferNodeMatches(edge.from, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }) ||
        this.transferNodeMatches(edge.to, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }),
    );
    state.transferEdges = state.transferEdges.filter(
      (edge) =>
        !this.transferNodeMatches(edge.from, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }) &&
        !this.transferNodeMatches(edge.to, {
          kind: 'REPLACEMENT_STOP',
          replacementStopId: stop.replacementStopId,
        }),
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementStops', 'replacementEdges', 'opReplacementStopLinks', 'transferEdges'],
      state,
    );
    const details: string[] = [];
    if (removedEdges.length) {
      details.push(`${removedEdges.length} Replacement Edges entfernt`);
    }
    if (removedLinks.length) {
      details.push(`${removedLinks.length} OP-Links entfernt`);
    }
    if (removedTransfers.length) {
      details.push(`${removedTransfers.length} Transfer Edges entfernt`);
    }
    const summary = details.length
      ? `Replacement Stop "${stop.name}" gelöscht (${details.join(', ')}).`
      : `Replacement Stop "${stop.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'replacementStop',
        id: stop.replacementStopId,
        label: stop.name,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildReplacementRoutePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.replacementRoutes ?? payload.replacementRoute ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Replacement Route wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const routes: ReplacementRoute[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const name = this.cleanText(record['name']) ?? this.cleanText(record['label']);
      if (!name) {
        return this.buildFeedbackResponse('Replacement Route: Name fehlt.');
      }
      const routeId =
        this.cleanText(record['replacementRouteId']) ??
        this.cleanText(record['id']) ??
        this.generateId('RROUTE');
      if (
        usedIds.has(routeId) ||
        state.replacementRoutes.some((entry) => entry.replacementRouteId === routeId)
      ) {
        return this.buildFeedbackResponse(
          `Replacement Route "${name}": ID "${routeId}" ist bereits vergeben.`,
        );
      }

      const route: ReplacementRoute = {
        replacementRouteId: routeId,
        name,
        operator: this.cleanText(record['operator']),
      };
      routes.push(route);
      usedIds.add(routeId);
      changes.push({
        kind: 'create',
        entityType: 'replacementRoute',
        id: route.replacementRouteId,
        label: route.name,
      });
    }

    state.replacementRoutes = [...state.replacementRoutes, ...routes];
    const commitTasks = this.buildTopologyCommitTasksForState(['replacementRoutes'], state);
    const summary =
      routes.length === 1
        ? `Replacement Route "${routes[0].name}" angelegt.`
        : `Replacement Routes angelegt (${routes.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdateReplacementRoutePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementRoute']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Route fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const routeRef =
      this.cleanText(targetRecord['replacementRouteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!routeRef) {
      return this.buildFeedbackResponse('Replacement Route fehlt.');
    }
    const routeResult = this.resolveReplacementRouteIdByReference(
      state.replacementRoutes,
      routeRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (routeResult.clarification) {
      return this.buildClarificationResponse(routeResult.clarification, context);
    }
    if (routeResult.feedback || !routeResult.routeId) {
      return this.buildFeedbackResponse(routeResult.feedback ?? 'Replacement Route nicht gefunden.');
    }

    const route = state.replacementRoutes.find(
      (entry) => entry.replacementRouteId === routeResult.routeId,
    );
    if (!route) {
      return this.buildFeedbackResponse('Replacement Route nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: ReplacementRoute = { ...route };
    let changed = false;

    if (this.hasOwn(patch, 'name')) {
      const name = this.cleanText(patch['name']);
      if (!name) {
        return this.buildFeedbackResponse('Name darf nicht leer sein.');
      }
      updated.name = name;
      changed = true;
    }
    if (this.hasOwn(patch, 'operator')) {
      updated.operator = this.cleanText(patch['operator']);
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.replacementRoutes = state.replacementRoutes.map((entry) =>
      entry.replacementRouteId === route.replacementRouteId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['replacementRoutes'], state);
    const summary = `Replacement Route "${updated.name}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'replacementRoute',
        id: updated.replacementRouteId,
        label: updated.name,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteReplacementRoutePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementRoute']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Route fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const routeRef =
      this.cleanText(targetRecord['replacementRouteId']) ??
      this.cleanText(targetRecord['id']) ??
      this.cleanText(targetRecord['name']) ??
      this.cleanText(targetRecord['label']);
    if (!routeRef) {
      return this.buildFeedbackResponse('Replacement Route fehlt.');
    }
    const routeResult = this.resolveReplacementRouteIdByReference(
      state.replacementRoutes,
      routeRef,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (routeResult.clarification) {
      return this.buildClarificationResponse(routeResult.clarification, context);
    }
    if (routeResult.feedback || !routeResult.routeId) {
      return this.buildFeedbackResponse(routeResult.feedback ?? 'Replacement Route nicht gefunden.');
    }

    const route = state.replacementRoutes.find(
      (entry) => entry.replacementRouteId === routeResult.routeId,
    );
    if (!route) {
      return this.buildFeedbackResponse('Replacement Route nicht gefunden.');
    }

    state.replacementRoutes = state.replacementRoutes.filter(
      (entry) => entry.replacementRouteId !== route.replacementRouteId,
    );
    const removedEdges = state.replacementEdges.filter(
      (edge) => edge.replacementRouteId === route.replacementRouteId,
    );
    state.replacementEdges = state.replacementEdges.filter(
      (edge) => edge.replacementRouteId !== route.replacementRouteId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(
      ['replacementRoutes', 'replacementEdges'],
      state,
    );
    const summary = removedEdges.length
      ? `Replacement Route "${route.name}" gelöscht (${removedEdges.length} Replacement Edges entfernt).`
      : `Replacement Route "${route.name}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'replacementRoute',
        id: route.replacementRouteId,
        label: route.name,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildReplacementEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.replacementEdges ?? payload.replacementEdge ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Replacement Edge wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const edges: ReplacementEdge[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};

      const routeRef = this.cleanText(record['replacementRouteId']);
      const fromRef = this.cleanText(record['fromStopId']);
      const toRef = this.cleanText(record['toStopId']);
      if (!routeRef || !fromRef || !toRef) {
        return this.buildFeedbackResponse('Replacement Edge: Route oder Stop fehlt.');
      }

      const routeResult = this.resolveReplacementRouteIdByReference(
        state.replacementRoutes,
        routeRef,
        { apply: { mode: 'value', path: ['replacementEdges', index, 'replacementRouteId'] } },
      );
      if (routeResult.clarification) {
        return this.buildClarificationResponse(routeResult.clarification, context);
      }
      if (routeResult.feedback || !routeResult.routeId) {
        return this.buildFeedbackResponse(routeResult.feedback ?? 'Replacement Route nicht gefunden.');
      }

      const fromResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        fromRef,
        { apply: { mode: 'value', path: ['replacementEdges', index, 'fromStopId'] } },
      );
      if (fromResult.clarification) {
        return this.buildClarificationResponse(fromResult.clarification, context);
      }
      if (fromResult.feedback || !fromResult.stopId) {
        return this.buildFeedbackResponse(fromResult.feedback ?? 'Replacement Stop nicht gefunden.');
      }
      const toResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        toRef,
        { apply: { mode: 'value', path: ['replacementEdges', index, 'toStopId'] } },
      );
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.stopId) {
        return this.buildFeedbackResponse(toResult.feedback ?? 'Replacement Stop nicht gefunden.');
      }

      if (fromResult.stopId === toResult.stopId) {
        return this.buildFeedbackResponse('Replacement Edge: Start und Ziel dürfen nicht gleich sein.');
      }

      const seqRaw = this.parseNumber(record['seq']);
      if (seqRaw === undefined || !Number.isInteger(seqRaw) || seqRaw <= 0) {
        return this.buildFeedbackResponse('Replacement Edge: Sequenz ist ungültig.');
      }

      const seqConflict = this.assertUniqueReplacementEdgeSeq(
        state.replacementEdges,
        routeResult.routeId,
        seqRaw,
      );
      if (seqConflict) {
        return this.buildFeedbackResponse(seqConflict);
      }

      const edgeId =
        this.cleanText(record['replacementEdgeId']) ??
        this.cleanText(record['id']) ??
        this.generateId('REDGE');
      if (
        usedIds.has(edgeId) ||
        state.replacementEdges.some((entry) => entry.replacementEdgeId === edgeId)
      ) {
        return this.buildFeedbackResponse(`Replacement Edge "${edgeId}" existiert bereits.`);
      }

      const avgDurationSec = this.parseNumber(record['avgDurationSec']);
      if (record['avgDurationSec'] !== undefined && avgDurationSec === undefined) {
        return this.buildFeedbackResponse('Replacement Edge: Dauer ist ungültig.');
      }
      const distanceM = this.parseNumber(record['distanceM']);
      if (record['distanceM'] !== undefined && distanceM === undefined) {
        return this.buildFeedbackResponse('Replacement Edge: Distanz ist ungültig.');
      }

      const edge: ReplacementEdge = {
        replacementEdgeId: edgeId,
        replacementRouteId: routeResult.routeId,
        fromStopId: fromResult.stopId,
        toStopId: toResult.stopId,
        seq: seqRaw,
        avgDurationSec,
        distanceM,
      };
      edges.push(edge);
      usedIds.add(edgeId);
      changes.push({
        kind: 'create',
        entityType: 'replacementEdge',
        id: edge.replacementEdgeId,
        label: `${edge.replacementRouteId} · Seq ${edge.seq}`,
      });
    }

    state.replacementEdges = [...state.replacementEdges, ...edges];
    const commitTasks = this.buildTopologyCommitTasksForState(['replacementEdges'], state);
    const summary =
      edges.length === 1
        ? `Replacement Edge "${edges[0].replacementEdgeId}" angelegt.`
        : `Replacement Edges angelegt (${edges.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdateReplacementEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const edgeResult = this.resolveReplacementEdgeTarget(
      state.replacementEdges,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (edgeResult.clarification) {
      return this.buildClarificationResponse(edgeResult.clarification, context);
    }
    if (edgeResult.feedback || !edgeResult.item) {
      return this.buildFeedbackResponse(edgeResult.feedback ?? 'Replacement Edge nicht gefunden.');
    }

    const edge = edgeResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: ReplacementEdge = { ...edge };
    let changed = false;

    let replacementRouteId = edge.replacementRouteId;
    let fromStopId = edge.fromStopId;
    let toStopId = edge.toStopId;
    let seq = edge.seq;

    if (this.hasOwn(patch, 'replacementRouteId')) {
      const routeRef = this.cleanText(patch['replacementRouteId']);
      if (!routeRef) {
        return this.buildFeedbackResponse('Replacement Route fehlt.');
      }
      const routeResult = this.resolveReplacementRouteIdByReference(
        state.replacementRoutes,
        routeRef,
        { apply: { mode: 'value', path: ['patch', 'replacementRouteId'] } },
      );
      if (routeResult.clarification) {
        return this.buildClarificationResponse(routeResult.clarification, context);
      }
      if (routeResult.feedback || !routeResult.routeId) {
        return this.buildFeedbackResponse(routeResult.feedback ?? 'Replacement Route nicht gefunden.');
      }
      replacementRouteId = routeResult.routeId;
      changed = true;
    }

    if (this.hasOwn(patch, 'fromStopId')) {
      const fromRef = this.cleanText(patch['fromStopId']);
      if (!fromRef) {
        return this.buildFeedbackResponse('Start-Stop fehlt.');
      }
      const fromResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        fromRef,
        { apply: { mode: 'value', path: ['patch', 'fromStopId'] } },
      );
      if (fromResult.clarification) {
        return this.buildClarificationResponse(fromResult.clarification, context);
      }
      if (fromResult.feedback || !fromResult.stopId) {
        return this.buildFeedbackResponse(fromResult.feedback ?? 'Replacement Stop nicht gefunden.');
      }
      fromStopId = fromResult.stopId;
      changed = true;
    }

    if (this.hasOwn(patch, 'toStopId')) {
      const toRef = this.cleanText(patch['toStopId']);
      if (!toRef) {
        return this.buildFeedbackResponse('Ziel-Stop fehlt.');
      }
      const toResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        toRef,
        { apply: { mode: 'value', path: ['patch', 'toStopId'] } },
      );
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.stopId) {
        return this.buildFeedbackResponse(toResult.feedback ?? 'Replacement Stop nicht gefunden.');
      }
      toStopId = toResult.stopId;
      changed = true;
    }

    if (fromStopId === toStopId) {
      return this.buildFeedbackResponse('Start und Ziel dürfen nicht gleich sein.');
    }

    if (this.hasOwn(patch, 'seq')) {
      const seqRaw = this.parseNumber(patch['seq']);
      if (seqRaw === undefined || !Number.isInteger(seqRaw) || seqRaw <= 0) {
        return this.buildFeedbackResponse('Sequenz ist ungültig.');
      }
      seq = seqRaw;
      changed = true;
    }

    const seqConflict = this.assertUniqueReplacementEdgeSeq(
      state.replacementEdges,
      replacementRouteId,
      seq,
      edge.replacementEdgeId,
    );
    if (seqConflict) {
      return this.buildFeedbackResponse(seqConflict);
    }

    if (this.hasOwn(patch, 'avgDurationSec')) {
      const duration = this.parseNumber(patch['avgDurationSec']);
      if (duration === undefined && patch['avgDurationSec'] !== null) {
        return this.buildFeedbackResponse('Dauer ist ungültig.');
      }
      updated.avgDurationSec = duration;
      changed = true;
    }
    if (this.hasOwn(patch, 'distanceM')) {
      const distance = this.parseNumber(patch['distanceM']);
      if (distance === undefined && patch['distanceM'] !== null) {
        return this.buildFeedbackResponse('Distanz ist ungültig.');
      }
      updated.distanceM = distance;
      changed = true;
    }

    updated.replacementRouteId = replacementRouteId;
    updated.fromStopId = fromStopId;
    updated.toStopId = toStopId;
    updated.seq = seq;

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.replacementEdges = state.replacementEdges.map((entry) =>
      entry.replacementEdgeId === edge.replacementEdgeId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['replacementEdges'], state);
    const summary = `Replacement Edge "${updated.replacementEdgeId}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'replacementEdge',
        id: updated.replacementEdgeId,
        label: updated.replacementEdgeId,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteReplacementEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['replacementEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Replacement Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const edgeResult = this.resolveReplacementEdgeTarget(
      state.replacementEdges,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (edgeResult.clarification) {
      return this.buildClarificationResponse(edgeResult.clarification, context);
    }
    if (edgeResult.feedback || !edgeResult.item) {
      return this.buildFeedbackResponse(edgeResult.feedback ?? 'Replacement Edge nicht gefunden.');
    }

    const edge = edgeResult.item;
    state.replacementEdges = state.replacementEdges.filter(
      (entry) => entry.replacementEdgeId !== edge.replacementEdgeId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(['replacementEdges'], state);
    const summary = `Replacement Edge "${edge.replacementEdgeId}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'replacementEdge',
        id: edge.replacementEdgeId,
        label: edge.replacementEdgeId,
      },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildOpReplacementStopLinkPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.opReplacementStopLinks ?? payload.opReplacementStopLink ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens ein OP-Link wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const links: OpReplacementStopLink[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};
      const opRef = this.cleanText(record['uniqueOpId']);
      const stopRef = this.cleanText(record['replacementStopId']);
      if (!opRef || !stopRef) {
        return this.buildFeedbackResponse('OP-Link: OP oder Stop fehlt.');
      }
      const opResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        opRef,
        { apply: { mode: 'value', path: ['opReplacementStopLinks', index, 'uniqueOpId'] } },
      );
      if (opResult.clarification) {
        return this.buildClarificationResponse(opResult.clarification, context);
      }
      if (opResult.feedback || !opResult.uniqueOpId) {
        return this.buildFeedbackResponse(opResult.feedback ?? 'Operational Point nicht gefunden.');
      }
      const stopResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        stopRef,
        { apply: { mode: 'value', path: ['opReplacementStopLinks', index, 'replacementStopId'] } },
      );
      if (stopResult.clarification) {
        return this.buildClarificationResponse(stopResult.clarification, context);
      }
      if (stopResult.feedback || !stopResult.stopId) {
        return this.buildFeedbackResponse(stopResult.feedback ?? 'Replacement Stop nicht gefunden.');
      }

      const relationRaw =
        this.cleanText(record['relationType'])?.toUpperCase() ?? '';
      if (!OP_REPLACEMENT_RELATIONS.has(relationRaw)) {
        return this.buildFeedbackResponse('OP-Link: Relation ist ungültig.');
      }

      const linkId =
        this.cleanText(record['linkId']) ??
        this.cleanText(record['id']) ??
        this.generateId('OPLINK');
      if (
        usedIds.has(linkId) ||
        state.opReplacementStopLinks.some((entry) => entry.linkId === linkId)
      ) {
        return this.buildFeedbackResponse(`OP-Link "${linkId}" existiert bereits.`);
      }

      const uniqueConflict = this.assertUniqueOpReplacementLink(
        state.opReplacementStopLinks,
        opResult.uniqueOpId,
        stopResult.stopId,
      );
      if (uniqueConflict) {
        return this.buildFeedbackResponse(uniqueConflict);
      }

      const walkingTimeSec = this.parseNumber(record['walkingTimeSec']);
      if (record['walkingTimeSec'] !== undefined && walkingTimeSec === undefined) {
        return this.buildFeedbackResponse('OP-Link: Fußweg ist ungültig.');
      }
      const distanceM = this.parseNumber(record['distanceM']);
      if (record['distanceM'] !== undefined && distanceM === undefined) {
        return this.buildFeedbackResponse('OP-Link: Distanz ist ungültig.');
      }

      const link: OpReplacementStopLink = {
        linkId,
        uniqueOpId: opResult.uniqueOpId,
        replacementStopId: stopResult.stopId,
        relationType: relationRaw as OpReplacementStopLink['relationType'],
        walkingTimeSec,
        distanceM,
      };
      links.push(link);
      usedIds.add(linkId);
      changes.push({
        kind: 'create',
        entityType: 'opReplacementStopLink',
        id: link.linkId,
        label: `${link.uniqueOpId} -> ${link.replacementStopId}`,
      });
    }

    state.opReplacementStopLinks = [...state.opReplacementStopLinks, ...links];
    const commitTasks = this.buildTopologyCommitTasksForState(['opReplacementStopLinks'], state);
    const summary =
      links.length === 1
        ? `OP-Link "${links[0].linkId}" angelegt.`
        : `OP-Links angelegt (${links.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdateOpReplacementStopLinkPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['opReplacementStopLink']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-OP-Link fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const linkResult = this.resolveOpReplacementStopLinkTarget(
      state.opReplacementStopLinks,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (linkResult.clarification) {
      return this.buildClarificationResponse(linkResult.clarification, context);
    }
    if (linkResult.feedback || !linkResult.item) {
      return this.buildFeedbackResponse(linkResult.feedback ?? 'OP-Link nicht gefunden.');
    }

    const link = linkResult.item;
    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: OpReplacementStopLink = { ...link };
    let changed = false;

    let uniqueOpId = link.uniqueOpId;
    let replacementStopId = link.replacementStopId;

    if (this.hasOwn(patch, 'uniqueOpId')) {
      const opRef = this.cleanText(patch['uniqueOpId']);
      if (!opRef) {
        return this.buildFeedbackResponse('OP fehlt.');
      }
      const opResult = this.resolveOperationalPointUniqueOpIdByReference(
        state.operationalPoints,
        opRef,
        { apply: { mode: 'value', path: ['patch', 'uniqueOpId'] } },
      );
      if (opResult.clarification) {
        return this.buildClarificationResponse(opResult.clarification, context);
      }
      if (opResult.feedback || !opResult.uniqueOpId) {
        return this.buildFeedbackResponse(opResult.feedback ?? 'Operational Point nicht gefunden.');
      }
      uniqueOpId = opResult.uniqueOpId;
      changed = true;
    }

    if (this.hasOwn(patch, 'replacementStopId')) {
      const stopRef = this.cleanText(patch['replacementStopId']);
      if (!stopRef) {
        return this.buildFeedbackResponse('Replacement Stop fehlt.');
      }
      const stopResult = this.resolveReplacementStopIdByReference(
        state.replacementStops,
        stopRef,
        { apply: { mode: 'value', path: ['patch', 'replacementStopId'] } },
      );
      if (stopResult.clarification) {
        return this.buildClarificationResponse(stopResult.clarification, context);
      }
      if (stopResult.feedback || !stopResult.stopId) {
        return this.buildFeedbackResponse(stopResult.feedback ?? 'Replacement Stop nicht gefunden.');
      }
      replacementStopId = stopResult.stopId;
      changed = true;
    }

    const uniqueConflict = this.assertUniqueOpReplacementLink(
      state.opReplacementStopLinks,
      uniqueOpId,
      replacementStopId,
      link.linkId,
    );
    if (uniqueConflict) {
      return this.buildFeedbackResponse(uniqueConflict);
    }

    if (this.hasOwn(patch, 'relationType')) {
      const relationRaw =
        this.cleanText(patch['relationType'])?.toUpperCase() ?? '';
      if (!OP_REPLACEMENT_RELATIONS.has(relationRaw)) {
        return this.buildFeedbackResponse('Relation ist ungültig.');
      }
      updated.relationType = relationRaw as OpReplacementStopLink['relationType'];
      changed = true;
    }

    if (this.hasOwn(patch, 'walkingTimeSec')) {
      const walking = this.parseNumber(patch['walkingTimeSec']);
      if (walking === undefined && patch['walkingTimeSec'] !== null) {
        return this.buildFeedbackResponse('Fußweg ist ungültig.');
      }
      updated.walkingTimeSec = walking;
      changed = true;
    }
    if (this.hasOwn(patch, 'distanceM')) {
      const distance = this.parseNumber(patch['distanceM']);
      if (distance === undefined && patch['distanceM'] !== null) {
        return this.buildFeedbackResponse('Distanz ist ungültig.');
      }
      updated.distanceM = distance;
      changed = true;
    }

    updated.uniqueOpId = uniqueOpId;
    updated.replacementStopId = replacementStopId;

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.opReplacementStopLinks = state.opReplacementStopLinks.map((entry) =>
      entry.linkId === link.linkId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['opReplacementStopLinks'], state);
    const summary = `OP-Link "${updated.linkId}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'opReplacementStopLink', id: updated.linkId, label: updated.linkId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteOpReplacementStopLinkPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['opReplacementStopLink']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-OP-Link fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const linkResult = this.resolveOpReplacementStopLinkTarget(
      state.opReplacementStopLinks,
      targetRecord,
      { apply: { mode: 'target', path: ['target'] } },
    );
    if (linkResult.clarification) {
      return this.buildClarificationResponse(linkResult.clarification, context);
    }
    if (linkResult.feedback || !linkResult.item) {
      return this.buildFeedbackResponse(linkResult.feedback ?? 'OP-Link nicht gefunden.');
    }

    const link = linkResult.item;
    state.opReplacementStopLinks = state.opReplacementStopLinks.filter(
      (entry) => entry.linkId !== link.linkId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(['opReplacementStopLinks'], state);
    const summary = `OP-Link "${link.linkId}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'opReplacementStopLink', id: link.linkId, label: link.linkId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildTransferEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const payloadRecord = payload as Record<string, unknown>;
    const rawEntries = this.asArray(
      payload.transferEdges ?? payload.transferEdge ?? payloadRecord['items'],
    );
    if (!rawEntries.length) {
      return this.buildFeedbackResponse('Mindestens eine Transfer Edge wird benötigt.');
    }

    const state = this.ensureTopologyState(context);
    const edges: TransferEdge[] = [];
    const changes: AssistantActionChangeDto[] = [];
    const usedIds = new Set<string>();

    for (let index = 0; index < rawEntries.length; index += 1) {
      const raw = rawEntries[index];
      const record = this.asRecord(raw) ?? {};

      const fromResult = this.parseTransferNode(record['from'], state, {
        applyPath: ['transferEdges', index, 'from'],
      });
      if (fromResult.clarification) {
        return this.buildClarificationResponse(fromResult.clarification, context);
      }
      if (fromResult.feedback || !fromResult.node) {
        return this.buildFeedbackResponse(fromResult.feedback ?? 'Transfer-Knoten fehlt.');
      }
      const toResult = this.parseTransferNode(record['to'], state, {
        applyPath: ['transferEdges', index, 'to'],
      });
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.node) {
        return this.buildFeedbackResponse(toResult.feedback ?? 'Transfer-Knoten fehlt.');
      }

      if (this.transferNodesEqual(fromResult.node, toResult.node)) {
        return this.buildFeedbackResponse('Transfer Edge darf keinen Selbst-Loop haben.');
      }

      const modeRaw = this.cleanText(record['mode'])?.toUpperCase() ?? '';
      if (!TRANSFER_MODES.has(modeRaw)) {
        return this.buildFeedbackResponse('Transfer Edge: Modus ist ungültig.');
      }

      const transferId =
        this.cleanText(record['transferId']) ??
        this.cleanText(record['id']) ??
        this.generateId('TR');
      if (
        usedIds.has(transferId) ||
        state.transferEdges.some((entry) => entry.transferId === transferId)
      ) {
        return this.buildFeedbackResponse(`Transfer Edge "${transferId}" existiert bereits.`);
      }

      const avgDurationSec = this.parseNumber(record['avgDurationSec']);
      if (record['avgDurationSec'] !== undefined && avgDurationSec === undefined) {
        return this.buildFeedbackResponse('Transfer Edge: Dauer ist ungültig.');
      }
      const distanceM = this.parseNumber(record['distanceM']);
      if (record['distanceM'] !== undefined && distanceM === undefined) {
        return this.buildFeedbackResponse('Transfer Edge: Distanz ist ungültig.');
      }
      const bidirectional = this.parseBoolean(record['bidirectional']) ?? false;

      const edge: TransferEdge = {
        transferId,
        from: fromResult.node,
        to: toResult.node,
        mode: modeRaw as TransferEdge['mode'],
        avgDurationSec,
        distanceM,
        bidirectional,
      };
      edges.push(edge);
      usedIds.add(transferId);
      changes.push({
        kind: 'create',
        entityType: 'transferEdge',
        id: edge.transferId,
        label: edge.transferId,
      });
    }

    state.transferEdges = [...state.transferEdges, ...edges];
    const commitTasks = this.buildTopologyCommitTasksForState(['transferEdges'], state);
    const summary =
      edges.length === 1
        ? `Transfer Edge "${edges[0].transferId}" angelegt.`
        : `Transfer Edges angelegt (${edges.length}).`;

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildUpdateTransferEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['transferEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Transfer Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const transferId =
      this.cleanText(targetRecord['transferId']) ??
      this.cleanText(targetRecord['id']);
    if (!transferId) {
      return this.buildFeedbackResponse('Transfer Edge ID fehlt.');
    }
    const edge = state.transferEdges.find((entry) => entry.transferId === transferId);
    if (!edge) {
      return this.buildFeedbackResponse('Transfer Edge nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch);
    if (!patch) {
      return this.buildFeedbackResponse('Änderungen fehlen.');
    }

    const updated: TransferEdge = { ...edge };
    let changed = false;

    if (this.hasOwn(patch, 'from')) {
      const fromResult = this.parseTransferNode(patch['from'], state, {
        applyPath: ['patch', 'from'],
      });
      if (fromResult.clarification) {
        return this.buildClarificationResponse(fromResult.clarification, context);
      }
      if (fromResult.feedback || !fromResult.node) {
        return this.buildFeedbackResponse(fromResult.feedback ?? 'Transfer-Knoten fehlt.');
      }
      updated.from = fromResult.node;
      changed = true;
    }
    if (this.hasOwn(patch, 'to')) {
      const toResult = this.parseTransferNode(patch['to'], state, {
        applyPath: ['patch', 'to'],
      });
      if (toResult.clarification) {
        return this.buildClarificationResponse(toResult.clarification, context);
      }
      if (toResult.feedback || !toResult.node) {
        return this.buildFeedbackResponse(toResult.feedback ?? 'Transfer-Knoten fehlt.');
      }
      updated.to = toResult.node;
      changed = true;
    }
    if (this.transferNodesEqual(updated.from, updated.to)) {
      return this.buildFeedbackResponse('Transfer Edge darf keinen Selbst-Loop haben.');
    }

    if (this.hasOwn(patch, 'mode')) {
      const modeRaw = this.cleanText(patch['mode'])?.toUpperCase() ?? '';
      if (!TRANSFER_MODES.has(modeRaw)) {
        return this.buildFeedbackResponse('Modus ist ungültig.');
      }
      updated.mode = modeRaw as TransferEdge['mode'];
      changed = true;
    }
    if (this.hasOwn(patch, 'avgDurationSec')) {
      const duration = this.parseNumber(patch['avgDurationSec']);
      if (duration === undefined && patch['avgDurationSec'] !== null) {
        return this.buildFeedbackResponse('Dauer ist ungültig.');
      }
      updated.avgDurationSec = duration;
      changed = true;
    }
    if (this.hasOwn(patch, 'distanceM')) {
      const distance = this.parseNumber(patch['distanceM']);
      if (distance === undefined && patch['distanceM'] !== null) {
        return this.buildFeedbackResponse('Distanz ist ungültig.');
      }
      updated.distanceM = distance;
      changed = true;
    }
    if (this.hasOwn(patch, 'bidirectional')) {
      updated.bidirectional = this.parseBoolean(patch['bidirectional']) ?? false;
      changed = true;
    }

    if (!changed) {
      return this.buildFeedbackResponse('Keine Änderungen erkannt.');
    }

    state.transferEdges = state.transferEdges.map((entry) =>
      entry.transferId === edge.transferId ? updated : entry,
    );
    const commitTasks = this.buildTopologyCommitTasksForState(['transferEdges'], state);
    const summary = `Transfer Edge "${updated.transferId}" aktualisiert.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'update', entityType: 'transferEdge', id: updated.transferId, label: updated.transferId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private buildDeleteTransferEdgePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const targetRecord = this.resolveTargetRecord(payload, ['transferEdge']);
    if (!targetRecord) {
      return this.buildFeedbackResponse('Ziel-Transfer Edge fehlt.');
    }

    const state = this.ensureTopologyState(context);
    const transferId =
      this.cleanText(targetRecord['transferId']) ??
      this.cleanText(targetRecord['id']);
    if (!transferId) {
      return this.buildFeedbackResponse('Transfer Edge ID fehlt.');
    }
    const edge = state.transferEdges.find((entry) => entry.transferId === transferId);
    if (!edge) {
      return this.buildFeedbackResponse('Transfer Edge nicht gefunden.');
    }

    state.transferEdges = state.transferEdges.filter(
      (entry) => entry.transferId !== edge.transferId,
    );

    const commitTasks = this.buildTopologyCommitTasksForState(['transferEdges'], state);
    const summary = `Transfer Edge "${edge.transferId}" gelöscht.`;
    const changes: AssistantActionChangeDto[] = [
      { kind: 'delete', entityType: 'transferEdge', id: edge.transferId, label: edge.transferId },
    ];

    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks,
    };
  }

  private normalizePersonnelServices(values: unknown[]): Array<{
    name: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    isNightService?: boolean;
    requiredQualifications?: string[];
    maxDailyInstances?: number;
    maxResourcesPerInstance?: number;
  }> {
    return values
      .map((entry) => {
        if (typeof entry === 'string') {
          const name = this.cleanText(entry);
          return name ? ({ name } as const) : null;
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const name =
            this.cleanText(record['name']) ?? this.cleanText(record['serviceName']);
          if (!name) {
            return null;
          }
          return {
            name,
            description: this.cleanText(record['description']),
            startTime: this.cleanText(record['startTime']),
            endTime: this.cleanText(record['endTime']),
            isNightService: this.parseBoolean(record['isNightService']),
            requiredQualifications: this.parseStringArray(record['requiredQualifications']),
            maxDailyInstances: this.parseNumber(record['maxDailyInstances']),
            maxResourcesPerInstance: this.parseNumber(record['maxResourcesPerInstance']),
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  }

  private normalizeVehicleServices(values: unknown[]): Array<{
    name: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    isOvernight?: boolean;
    primaryRoute?: string;
  }> {
    return values
      .map((entry) => {
        if (typeof entry === 'string') {
          const name = this.cleanText(entry);
          return name ? ({ name } as const) : null;
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const name =
            this.cleanText(record['name']) ?? this.cleanText(record['serviceName']);
          if (!name) {
            return null;
          }
          return {
            name,
            description: this.cleanText(record['description']),
            startTime: this.cleanText(record['startTime']),
            endTime: this.cleanText(record['endTime']),
            isOvernight: this.parseBoolean(record['isOvernight']),
            primaryRoute: this.cleanText(record['primaryRoute']),
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  }

  private parseActionPayload(content: string): ActionPayload | null {
    const cleaned = content.replace(/```json/gi, '```').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    const json = cleaned.slice(start, end + 1);
    const firstAttempt = this.tryParseJson<ActionPayload>(json);
    if (firstAttempt.value) {
      return firstAttempt.value;
    }
    const repaired = this.repairJson(json);
    if (repaired !== json) {
      const secondAttempt = this.tryParseJson<ActionPayload>(repaired);
      if (secondAttempt.value) {
        this.logger.log('Assistant action JSON parse repaired.');
        return secondAttempt.value;
      }
      if (secondAttempt.error) {
        this.logger.warn(
          `Assistant action JSON parse failed after repair: ${secondAttempt.error.message}`,
        );
        return null;
      }
    }
    if (firstAttempt.error) {
      this.logger.warn(
        `Assistant action JSON parse failed: ${firstAttempt.error.message}`,
      );
    }
    return null;
  }

  private tryParseJson<T>(value: string): { value?: T; error?: Error } {
    try {
      return { value: JSON.parse(value) as T };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private repairJson(value: string): string {
    let repaired = value.trim();
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    repaired = repaired.replace(/}\s*{/g, '},{');
    repaired = repaired.replace(/]\s*{/g, '],{');
    repaired = repaired.replace(/}\s*\[/g, '},[');
    repaired = repaired.replace(/]\s*\[/g, '],[');
    repaired = repaired.replace(/"\s+(?=")/g, '",');
    repaired = repaired.replace(/"\s+(?=[{\[\d-])/g, '",');
    repaired = repaired.replace(/(\d|\btrue\b|\bfalse\b|\bnull\b)\s+(?=["{\[])/g, '$1,');
    return repaired;
  }

  private async requestActionPayload(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<{
    payload: ActionPayload | null;
    error?: string;
    rawResponse?: string;
  }> {
    let rawResponse: string;
    try {
      rawResponse = await this.ollama.createChatCompletion(messages, {
        responseFormat: { type: 'json_object' },
        allowResponseFormatFallback: true,
      });
    } catch (error) {
      this.logger.error(
        `Assistant action preview failed (model=${this.config.ollamaModel})`,
        (error as Error)?.stack ?? String(error),
      );
      throw new BadGatewayException(this.describeOllamaError(error));
    }

    const parsed = this.parseActionPayload(rawResponse);
    if (!parsed) {
      return { payload: null, error: 'Antwort ist kein JSON-Objekt.', rawResponse };
    }
    const sanitized = this.sanitizeActionPayload(parsed);
    if (!sanitized) {
      return { payload: null, error: 'Antwort ist kein JSON-Objekt.', rawResponse };
    }
    const validation = this.validateActionPayload(sanitized);
    if (!validation.payload) {
      return { payload: null, error: validation.error ?? 'Aktion ungueltig.', rawResponse };
    }
    return { payload: validation.payload, rawResponse };
  }

  private validateActionPayload(payload: ActionPayload): {
    payload?: ActionPayload;
    error?: string;
  } {
    const migrated = this.migrateActionPayload(payload);
    if (!migrated.payload) {
      return { error: migrated.error ?? 'Schema-Version ungueltig.' };
    }
    payload = migrated.payload;

    const action = this.cleanText(payload.action);
    if (!action) {
      return { error: 'Aktion fehlt.' };
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return { error: `Aktion "${action}" wird nicht unterstuetzt.` };
    }
    if (action === 'batch') {
      if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
        return { error: 'Batch ohne Aktionen.' };
      }
      for (const entry of payload.actions) {
        const record = this.asRecord(entry);
        if (!record || typeof record['action'] !== 'string') {
          return { error: 'Batch-Aktion ist ungueltig.' };
        }
        if (record['action'] === 'none') {
          return { error: 'Batch darf keine "none"-Aktionen enthalten.' };
        }
        if (!ALLOWED_ACTIONS.has(record['action'])) {
          return { error: `Batch-Aktion "${record['action']}" wird nicht unterstuetzt.` };
        }
      }
    }
    return { payload: { ...payload, action } };
  }

  private migrateActionPayload(payload: ActionPayload): {
    payload?: ActionPayload;
    error?: string;
  } {
    const hasVersion =
      payload.schemaVersion !== undefined && payload.schemaVersion !== null;
    const parsed = this.parseSchemaVersion(payload.schemaVersion);
    if (hasVersion && parsed === null) {
      return { error: 'Schema-Version ungueltig.' };
    }
    const normalized = parsed ?? 1;
    if (normalized !== 1) {
      return { error: `Schema-Version ${normalized} wird nicht unterstuetzt.` };
    }
    if (payload.schemaVersion === normalized) {
      return { payload };
    }
    return { payload: { ...payload, schemaVersion: normalized } };
  }

  private sanitizeActionPayload(raw: unknown): ActionPayload | null {
    const record = this.asRecord(raw);
    if (!record) {
      return null;
    }
    const action = this.cleanText(record['action']);
    if (!action) {
      return null;
    }
    const allowedKeys = new Set<string>(DEFAULT_ROOT_FIELDS);
    const actionKeys = ROOT_FIELDS_BY_ACTION[action];
    if (actionKeys) {
      for (const key of actionKeys) {
        allowedKeys.add(key);
      }
    }
    const sanitized: ActionPayload = { action };
    for (const key of allowedKeys) {
      if (!this.hasOwn(record, key)) {
        continue;
      }
      switch (key) {
        case 'reason':
          sanitized.reason = this.cleanText(record[key]);
          break;
        case 'schemaVersion':
          sanitized.schemaVersion = this.parseSchemaVersion(record[key]) ?? Number.NaN;
          break;
        case 'pool':
          sanitized.pool = this.sanitizePool(record[key]);
          break;
        case 'poolName':
          sanitized.poolName = this.cleanText(record[key]);
          break;
        case 'servicePool':
          sanitized.servicePool = this.sanitizePool(record[key]);
          break;
        case 'personnelServicePool':
          sanitized.personnelServicePool = this.sanitizePool(record[key]);
          break;
        case 'vehicleServicePool':
          sanitized.vehicleServicePool = this.sanitizePool(record[key]);
          break;
        case 'personnelPool':
          sanitized.personnelPool = this.sanitizePool(record[key]);
          break;
        case 'vehiclePool':
          sanitized.vehiclePool = this.sanitizePool(record[key]);
          break;
        case 'homeDepot':
          sanitized.homeDepot = this.sanitizeEntity(record[key], HOME_DEPOT_KEYS);
          break;
        case 'homeDepots':
          sanitized.homeDepots = this.sanitizeEntity(record[key], HOME_DEPOT_KEYS);
          break;
        case 'vehicleType':
          sanitized.vehicleType = this.sanitizeEntity(record[key], VEHICLE_TYPE_KEYS);
          break;
        case 'vehicleTypes':
          sanitized.vehicleTypes = this.sanitizeEntity(record[key], VEHICLE_TYPE_KEYS);
          break;
        case 'vehicleComposition':
          sanitized.vehicleComposition = this.sanitizeEntity(record[key], VEHICLE_COMPOSITION_KEYS);
          break;
        case 'vehicleCompositions':
          sanitized.vehicleCompositions = this.sanitizeEntity(record[key], VEHICLE_COMPOSITION_KEYS);
          break;
        case 'timetableYear':
          sanitized.timetableYear = this.sanitizeEntity(record[key], TIMETABLE_YEAR_KEYS);
          break;
        case 'timetableYears':
          sanitized.timetableYears = this.sanitizeEntity(record[key], TIMETABLE_YEAR_KEYS);
          break;
        case 'simulation':
          sanitized.simulation = this.sanitizeEntity(record[key], SIMULATION_KEYS);
          break;
        case 'simulations':
          sanitized.simulations = this.sanitizeEntity(record[key], SIMULATION_KEYS);
          break;
        case 'operationalPoint':
          sanitized.operationalPoint = this.sanitizeEntity(record[key], OPERATIONAL_POINT_KEYS);
          break;
        case 'operationalPoints':
          sanitized.operationalPoints = this.sanitizeEntity(record[key], OPERATIONAL_POINT_KEYS);
          break;
        case 'sectionOfLine':
          sanitized.sectionOfLine = this.sanitizeEntity(record[key], SECTION_OF_LINE_KEYS);
          break;
        case 'sectionsOfLine':
          sanitized.sectionsOfLine = this.sanitizeEntity(record[key], SECTION_OF_LINE_KEYS);
          break;
        case 'personnelSite':
          sanitized.personnelSite = this.sanitizeEntity(record[key], PERSONNEL_SITE_KEYS);
          break;
        case 'personnelSites':
          sanitized.personnelSites = this.sanitizeEntity(record[key], PERSONNEL_SITE_KEYS);
          break;
        case 'replacementStop':
          sanitized.replacementStop = this.sanitizeEntity(record[key], REPLACEMENT_STOP_KEYS);
          break;
        case 'replacementStops':
          sanitized.replacementStops = this.sanitizeEntity(record[key], REPLACEMENT_STOP_KEYS);
          break;
        case 'replacementRoute':
          sanitized.replacementRoute = this.sanitizeEntity(record[key], REPLACEMENT_ROUTE_KEYS);
          break;
        case 'replacementRoutes':
          sanitized.replacementRoutes = this.sanitizeEntity(record[key], REPLACEMENT_ROUTE_KEYS);
          break;
        case 'replacementEdge':
          sanitized.replacementEdge = this.sanitizeEntity(record[key], REPLACEMENT_EDGE_KEYS);
          break;
        case 'replacementEdges':
          sanitized.replacementEdges = this.sanitizeEntity(record[key], REPLACEMENT_EDGE_KEYS);
          break;
        case 'opReplacementStopLink':
          sanitized.opReplacementStopLink = this.sanitizeEntity(record[key], OP_REPLACEMENT_STOP_LINK_KEYS);
          break;
        case 'opReplacementStopLinks':
          sanitized.opReplacementStopLinks = this.sanitizeEntity(record[key], OP_REPLACEMENT_STOP_LINK_KEYS);
          break;
        case 'transferEdge':
          sanitized.transferEdge = this.sanitizeEntity(record[key], TRANSFER_EDGE_KEYS);
          break;
        case 'transferEdges':
          sanitized.transferEdges = this.sanitizeEntity(record[key], TRANSFER_EDGE_KEYS);
          break;
        case 'service':
          sanitized.service = this.sanitizeServices(record[key]);
          break;
        case 'services':
          sanitized.services = this.sanitizeServices(record[key]);
          break;
        case 'personnelService':
          sanitized.personnelService = this.sanitizeServices(record[key]);
          break;
        case 'vehicleService':
          sanitized.vehicleService = this.sanitizeServices(record[key]);
          break;
        case 'personnel':
          sanitized.personnel = this.sanitizePersonnel(record[key]);
          break;
        case 'person':
          sanitized.person = this.sanitizePersonnel(record[key]);
          break;
        case 'people':
          sanitized.people = this.sanitizePersonnel(record[key]);
          break;
        case 'vehicles':
          sanitized.vehicles = this.sanitizeVehicles(record[key]);
          break;
        case 'vehicle':
          sanitized.vehicle = this.sanitizeVehicles(record[key]);
          break;
        case 'target':
          sanitized.target = this.sanitizeTarget(record[key]);
          break;
        case 'patch':
          sanitized.patch = this.sanitizePatch(record[key]);
          break;
        case 'actions':
          sanitized.actions = this.sanitizeBatchActions(record[key]);
          break;
        case 'items':
          sanitized.items = record[key];
          break;
        default:
          break;
      }
    }
    return sanitized;
  }

  private sanitizeBatchActions(value: unknown): ActionPayload[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const actions: ActionPayload[] = [];
    for (const entry of value) {
      const sanitized = this.sanitizeActionPayload(entry);
      if (sanitized) {
        actions.push(sanitized);
      }
    }
    return actions.length ? actions : undefined;
  }

  private sanitizePool(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return this.sanitizeRecord(record, POOL_KEYS);
  }

  private sanitizeServices(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (!Array.isArray(value)) {
      const record = this.asRecord(value);
      return record ? this.sanitizeRecord(record, SERVICE_KEYS) : undefined;
    }
    const items = value
      .map((entry) => {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          return trimmed ? trimmed : undefined;
        }
        const record = this.asRecord(entry);
        return record ? this.sanitizeRecord(record, SERVICE_KEYS) : undefined;
      })
      .filter((entry) => entry !== undefined);
    return items.length ? items : undefined;
  }

  private sanitizeEntity(value: unknown, allowedKeys: string[]): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (!Array.isArray(value)) {
      const record = this.asRecord(value);
      return record ? this.sanitizeRecord(record, allowedKeys) : undefined;
    }
    const items = value
      .map((entry) => {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          return trimmed ? trimmed : undefined;
        }
        const record = this.asRecord(entry);
        return record ? this.sanitizeRecord(record, allowedKeys) : undefined;
      })
      .filter((entry) => entry !== undefined);
    return items.length ? items : undefined;
  }

  private sanitizePersonnel(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (!Array.isArray(value)) {
      const record = this.asRecord(value);
      return record ? this.sanitizeRecord(record, PERSONNEL_KEYS) : undefined;
    }
    const items = value
      .map((entry) => {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          return trimmed ? trimmed : undefined;
        }
        const record = this.asRecord(entry);
        return record ? this.sanitizeRecord(record, PERSONNEL_KEYS) : undefined;
      })
      .filter((entry) => entry !== undefined);
    return items.length ? items : undefined;
  }

  private sanitizeVehicles(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (!Array.isArray(value)) {
      const record = this.asRecord(value);
      return record ? this.sanitizeRecord(record, VEHICLE_KEYS) : undefined;
    }
    const items = value
      .map((entry) => {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          return trimmed ? trimmed : undefined;
        }
        const record = this.asRecord(entry);
        return record ? this.sanitizeRecord(record, VEHICLE_KEYS) : undefined;
      })
      .filter((entry) => entry !== undefined);
    return items.length ? items : undefined;
  }

  private sanitizeTarget(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return this.sanitizeRecord(record, TARGET_KEYS);
  }

  private sanitizePatch(value: unknown): Record<string, unknown> | undefined {
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return this.sanitizeRecord(record, PATCH_KEYS);
  }

  private sanitizeRecord(
    record: Record<string, unknown>,
    allowedKeys: string[],
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (this.hasOwn(record, key)) {
        sanitized[key] = record[key];
      }
    }
    return sanitized;
  }

  private isActionAllowed(action: string, role: string | null): boolean {
    const roleMap = this.config.actionRoleMap;
    if (!roleMap) {
      return true;
    }
    const normalizedRole = role?.trim() || 'default';
    const allowed = roleMap[normalizedRole] ?? roleMap['default'];
    if (!allowed || allowed.length === 0) {
      return true;
    }
    return allowed.includes('*') || allowed.includes(action);
  }

  private normalizeRole(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private buildContextMessages(
    uiContext: AssistantActionPreviewRequestDto['uiContext'],
  ): Array<{ role: 'system'; content: string }> {
    const maxContextChars = Math.max(0, this.config.maxContextChars);
    if (maxContextChars <= 0) {
      return [];
    }

    const uiMessages = this.buildUiContextMessages(uiContext);
    const uiBudget = Math.min(this.config.maxUiDataChars, maxContextChars);
    const limitedUi = applyMessageBudget(uiMessages, uiBudget);
    const remaining = maxContextChars - this.countMessageChars(limitedUi);
    if (remaining <= 0) {
      return limitedUi;
    }

    const docMessages = this.buildDocMessages(uiContext, remaining);
    const limitedDocs = applyMessageBudget(docMessages, remaining);
    return [...limitedUi, ...limitedDocs];
  }

  private buildDocMessages(
    uiContext: AssistantActionPreviewRequestDto['uiContext'],
    maxChars: number,
  ): Array<{ role: 'system'; content: string }> {
    if (this.config.docInjectionMode === 'never' || maxChars <= 0) {
      return [];
    }
    const docBudget = Math.min(maxChars, this.config.maxDocChars);
    return this.docs.buildDocumentationMessages(uiContext, { maxChars: docBudget });
  }

  private buildUiContextMessages(
    uiContext: AssistantActionPreviewRequestDto['uiContext'],
  ): Array<{ role: 'system'; content: string }> {
    const content = buildUiContextMessage(uiContext, {
      maxDataChars: this.config.maxUiDataChars,
    });
    if (!content) {
      return [];
    }
    return [{ role: 'system', content }];
  }

  private countMessageChars(messages: Array<{ role: 'system'; content: string }>): number {
    return messages.reduce((total, message) => total + message.content.length, 0);
  }

  private sanitizeUiContext(
    uiContext: AssistantActionPreviewRequestDto['uiContext'],
  ): AssistantActionPreviewRequestDto['uiContext'] {
    if (!uiContext) {
      return uiContext;
    }
    const breadcrumbs = (uiContext.breadcrumbs ?? [])
      .map((entry) => this.sanitizeUiText(entry))
      .filter((entry) => entry.length > 0)
      .slice(0, 20);
    const route = this.sanitizeUiText(uiContext.route ?? '');
    const docKey = this.sanitizeUiText(uiContext.docKey ?? '');
    const docSubtopic = this.sanitizeUiText(uiContext.docSubtopic ?? '');
    const dataSummary = this.sanitizeUiText(uiContext.dataSummary ?? '');
    return {
      ...(breadcrumbs.length ? { breadcrumbs } : {}),
      ...(route ? { route } : {}),
      ...(docKey ? { docKey } : {}),
      ...(docSubtopic ? { docSubtopic } : {}),
      ...(dataSummary ? { dataSummary } : {}),
    };
  }

  private cleanText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private sanitizeUiText(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const withoutEmails = trimmed.replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      '[redacted-email]',
    );
    const withoutUuids = withoutEmails.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '[redacted-id]',
    );
    return withoutUuids.replace(/\b\d{6,}\b/g, '[redacted]');
  }

  private parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'ja', 'yes'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'nein', 'no'].includes(normalized)) {
        return false;
      }
    }
    return undefined;
  }

  private parseNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private parseSchemaVersion(value: unknown): number | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      const normalized = Math.trunc(value);
      return normalized > 0 && normalized === value ? normalized : null;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (!Number.isFinite(parsed)) {
        return null;
      }
      const normalized = Math.trunc(parsed);
      return normalized > 0 && normalized === parsed ? normalized : null;
    }
    return null;
  }

  private parseStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      const items = value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
      return items.length ? items : undefined;
    }
    if (typeof value === 'string') {
      const items = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return items.length ? items : undefined;
    }
    return undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === undefined || value === null) {
      return [];
    }
    return [value];
  }

  private hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
  }

  private hasAnyKey(record: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((key) => this.hasOwn(record, key));
  }

  private normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private extractFirstText(
    record: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      if (this.hasOwn(record, key)) {
        return this.cleanText(record[key]);
      }
    }
    return undefined;
  }

  private extractReference(
    record: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      if (this.hasOwn(record, key)) {
        return this.parsePoolReference(record[key]);
      }
    }
    return undefined;
  }

  private parsePoolReference(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return this.cleanText(value);
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return (
      this.cleanText(record['name']) ??
      this.cleanText(record['poolName']) ??
      this.cleanText(record['id']) ??
      this.cleanText(record['poolId'])
    );
  }

  private hasNameCollision<T extends { id: string; name?: string }>(
    entries: T[],
    name: string,
    excludeId?: string,
  ): boolean {
    const normalized = this.normalizeKey(name);
    return entries.some(
      (entry) =>
        entry.id !== excludeId && this.normalizeKey(entry.name ?? '') === normalized,
    );
  }

  private resolveTargetRecord(
    payload: ActionPayload,
    fallbackKeys: string[],
  ): Record<string, unknown> | null {
    if (typeof payload.target === 'string') {
      return { name: payload.target };
    }
    const target = this.asRecord(payload.target);
    if (target) {
      return target;
    }
    const record = payload as Record<string, unknown>;
    for (const key of fallbackKeys) {
      const value = record[key];
      if (typeof value === 'string') {
        return { name: value };
      }
      const candidate = this.asRecord(value);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  private findByIdOrName<T extends { id: string; name?: string }>(
    list: T[],
    target: Record<string, unknown>,
    options: {
      label: string;
      nameKeys?: string[];
      idKeys?: string[];
      clarification?: {
        title?: string;
        apply: AssistantActionClarificationApply;
        label?: (item: T) => string;
        details?: (item: T) => string | undefined;
      };
    },
  ): { item?: T; feedback?: string; clarification?: ClarificationRequest } {
    const idKeys = options.idKeys ?? ['id'];
    const nameKeys = options.nameKeys ?? ['name'];
    const id = this.extractFirstText(target, idKeys);
    if (id) {
      const item = list.find((entry) => entry.id === id);
      if (!item) {
        return { feedback: `${options.label} mit ID "${id}" nicht gefunden.` };
      }
      return { item };
    }

    const name = this.extractFirstText(target, nameKeys);
    if (!name) {
      return { feedback: `${options.label} fehlt.` };
    }

    const normalized = this.normalizeKey(name);
    const matches = list.filter(
      (entry) => this.normalizeKey(entry.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `${options.label} "${name}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (options.clarification) {
        const title =
          options.clarification.title ??
          `${options.label} "${name}" ist nicht eindeutig. Welchen meinst du?`;
        const labelBuilder =
          options.clarification.label ?? ((item: T) => item.name ?? item.id);
        const detailsBuilder = options.clarification.details;
        return {
          clarification: {
            title,
            options: matches.map((item) => ({
              id: item.id,
              label: labelBuilder(item),
              details: detailsBuilder?.(item),
            })),
            apply: options.clarification.apply,
          },
        };
      }
      const labels = matches.map((entry) => entry.name ?? entry.id);
      return {
        feedback: `${options.label} "${name}" ist nicht eindeutig. ${this.describeCandidates(labels)}`,
      };
    }
    return { item: matches[0] };
  }

  private resolvePoolIdByReference(
    pools: Array<{ id: string; name: string }>,
    poolRef: string,
    label: string,
    options: { allowSystem: boolean; systemId: string; systemFeedback?: string },
    clarification?: { title?: string; apply: AssistantActionClarificationApply },
  ): {
    id?: string;
    label?: string;
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const ref = poolRef.trim();
    const byId = pools.find((pool) => pool.id === ref);
    if (byId) {
      if (!options.allowSystem && byId.id === options.systemId) {
        return { feedback: options.systemFeedback ?? 'System-Pool ist nicht erlaubt.' };
      }
      return { id: byId.id, label: byId.name };
    }
    const normalized = this.normalizeKey(ref);
    const matches = pools.filter(
      (pool) => this.normalizeKey(pool.name) === normalized,
    );
    if (!matches.length) {
      return { feedback: `${label} "${poolRef}" nicht gefunden.` };
    }
    const filteredMatches = options.allowSystem
      ? matches
      : matches.filter((pool) => pool.id !== options.systemId);
    if (!filteredMatches.length) {
      return { feedback: options.systemFeedback ?? 'System-Pool ist nicht erlaubt.' };
    }
    if (filteredMatches.length > 1) {
      if (clarification) {
        const title =
          clarification.title ??
          `${label} "${poolRef}" ist nicht eindeutig. Welchen meinst du?`;
        return {
          clarification: {
            title,
            options: filteredMatches.map((pool) => ({
              id: pool.id,
              label: pool.name,
              details: `ID ${pool.id}`,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `${label} "${poolRef}" ist nicht eindeutig. ${this.describeCandidates(
          filteredMatches.map((pool) => pool.name),
        )}`,
      };
    }
    const match = filteredMatches[0];
    return { id: match.id, label: match.name };
  }

  private resolveHomeDepotIdByReference(
    depots: HomeDepot[],
    depotRef: string,
    clarification?: { title?: string; apply: AssistantActionClarificationApply },
  ): { id?: string; feedback?: string; clarification?: ClarificationRequest } {
    const ref = depotRef.trim();
    const byId = depots.find((depot) => depot.id === ref);
    if (byId) {
      return { id: byId.id };
    }
    const normalized = this.normalizeKey(ref);
    const matches = depots.filter(
      (depot) => this.normalizeKey(depot.name) === normalized,
    );
    if (!matches.length) {
      return { feedback: `Heimatdepot "${depotRef}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        const title =
          clarification.title ??
          `Heimatdepot "${depotRef}" ist nicht eindeutig. Welches meinst du?`;
        return {
          clarification: {
            title,
            options: matches.map((depot) => ({
              id: depot.id,
              label: depot.name,
              details: `ID ${depot.id}`,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Heimatdepot "${depotRef}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((depot) => depot.name),
        )}`,
      };
    }
    return { id: matches[0].id };
  }

  private resolveVehicleTypeIdByReference(
    types: VehicleType[],
    typeRef: string,
    clarification?: { title?: string; apply: AssistantActionClarificationApply },
  ): { id?: string; feedback?: string; clarification?: ClarificationRequest } {
    const ref = typeRef.trim();
    const byId = types.find((entry) => entry.id === ref);
    if (byId) {
      return { id: byId.id };
    }
    const normalized = this.normalizeKey(ref);
    const matches = types.filter(
      (entry) => this.normalizeKey(entry.label) === normalized,
    );
    if (!matches.length) {
      return { feedback: `Fahrzeugtyp "${typeRef}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        const title =
          clarification.title ??
          `Fahrzeugtyp "${typeRef}" ist nicht eindeutig. Welchen meinst du?`;
        return {
          clarification: {
            title,
            options: matches.map((entry) => ({
              id: entry.id,
              label: entry.label,
              details: `ID ${entry.id}`,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Fahrzeugtyp "${typeRef}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => entry.label),
        )}`,
      };
    }
    return { id: matches[0].id };
  }

  private async resolveSimulationVariantId(options: {
    label?: string;
    timetableYearLabel?: string;
  }): Promise<string | null> {
    const label = this.cleanText(options.label);
    if (!label) {
      return null;
    }
    const yearFilter = this.cleanText(options.timetableYearLabel);
    const variants = await this.timetableYears.listVariants(yearFilter);
    const byId = variants.find((variant) => variant.id === label);
    if (byId) {
      return byId.id;
    }
    const normalized = this.normalizeKey(label);
    const matches = variants.filter(
      (variant) =>
        variant.kind === 'simulation' &&
        this.normalizeKey(variant.label ?? '') === normalized,
    );
    if (!matches.length) {
      throw new BadRequestException(`Simulation "${label}" nicht gefunden.`);
    }
    if (matches.length > 1) {
      const years = Array.from(
        new Set(matches.map((variant) => variant.timetableYearLabel)),
      ).join(', ');
      throw new BadRequestException(
        `Simulation "${label}" ist nicht eindeutig. Bitte Fahrplanjahr angeben. (${years})`,
      );
    }
    return matches[0].id;
  }

  private extractTimetableYearLabel(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return this.cleanText(value);
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return (
      this.cleanText(record['label']) ??
      this.cleanText(record['name']) ??
      this.cleanText(record['timetableYearLabel'])
    );
  }

  private ensureTopologyState(context: ActionContext): ActionTopologyState {
    if (!context.topologyState) {
      context.topologyState = this.buildTopologyState();
    }
    return context.topologyState;
  }

  private buildTopologyCommitTasksForState(
    scopes: AssistantActionTopologyScope[],
    state: ActionTopologyState,
  ): AssistantActionCommitTask[] {
    const uniqueScopes = Array.from(new Set(scopes));
    return uniqueScopes.map((scope) => this.buildTopologyCommitTask(scope, state));
  }

  private buildTopologyCommitTask(
    scope: AssistantActionTopologyScope,
    state: ActionTopologyState,
  ): AssistantActionCommitTask {
    switch (scope) {
      case 'operationalPoints':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.operationalPoints),
        };
      case 'sectionsOfLine':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.sectionsOfLine),
        };
      case 'personnelSites':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.personnelSites),
        };
      case 'replacementStops':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.replacementStops),
        };
      case 'replacementRoutes':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.replacementRoutes),
        };
      case 'replacementEdges':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.replacementEdges),
        };
      case 'opReplacementStopLinks':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.opReplacementStopLinks),
        };
      case 'transferEdges':
        return {
          type: 'topology',
          scope,
          items: this.cloneList(state.transferEdges),
        };
      default:
        return { type: 'topology', scope, items: [] };
    }
  }

  private resolvePersonnelSiteIds(
    sites: PersonnelSite[],
    siteRefs?: string[],
    clarification?: { applyPath: Array<string | number>; title?: (name: string) => string },
  ): { ids?: string[]; feedback?: string; clarification?: ClarificationRequest } {
    if (!siteRefs || !siteRefs.length) {
      return { ids: undefined };
    }
    const ids: string[] = [];
    const missing: string[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (let index = 0; index < siteRefs.length; index += 1) {
      const raw = siteRefs[index];
      const ref = this.cleanText(raw);
      if (!ref) {
        continue;
      }
      const direct = sites.find((site) => site.siteId === ref);
      if (direct) {
        if (!seenIds.has(direct.siteId)) {
          ids.push(direct.siteId);
          seenIds.add(direct.siteId);
        }
        continue;
      }
      const normalized = this.normalizeKey(ref);
      if (seenNames.has(normalized)) {
        continue;
      }
      const matches = sites.filter(
        (site) => this.normalizeKey(site.name ?? '') === normalized,
      );
      if (!matches.length) {
        missing.push(ref);
        continue;
      }
      if (matches.length > 1) {
        if (clarification) {
          const title =
            clarification.title?.(ref) ??
            `Personnel Site "${ref}" ist nicht eindeutig. Welches meinst du?`;
          return {
            clarification: {
              title,
              options: matches.map((site) => ({
                id: site.siteId,
                label: site.name ?? site.siteId,
                details: site.siteType ?? undefined,
              })),
              apply: {
                mode: 'value',
                path: [...clarification.applyPath, index],
              },
            },
          };
        }
        return {
          feedback: `Personnel Site "${ref}" ist nicht eindeutig. ${this.describeCandidates(
            matches.map((site) => site.name ?? site.siteId),
          )}`,
        };
      }
      const match = matches[0];
      seenNames.add(normalized);
      if (!seenIds.has(match.siteId)) {
        ids.push(match.siteId);
        seenIds.add(match.siteId);
      }
    }

    if (missing.length) {
      return { feedback: `Personnel Site(s) nicht gefunden: ${missing.join(', ')}` };
    }
    return { ids };
  }

  private resolveVehicleCompositionEntries(
    types: VehicleType[],
    record: Record<string, unknown>,
    basePath: Array<string | number>,
  ): {
    entries?: VehicleComposition['entries'];
    feedback?: string;
    clarification?: ClarificationRequest;
  } {
    const entriesRaw = Array.isArray(record['entries']) ? record['entries'] : [];
    const serialized = this.cleanText(record['entriesSerialized']) ?? '';
    const parsedEntries: Array<{ typeRef: string; quantity: number }> = [];

    if (entriesRaw.length) {
      entriesRaw.forEach((entry) => {
        if (typeof entry === 'string') {
          const ref = this.cleanText(entry);
          if (ref) {
            parsedEntries.push({ typeRef: ref, quantity: 1 });
          }
          return;
        }
        const entryRecord = this.asRecord(entry);
        if (!entryRecord) {
          return;
        }
        const typeRef =
          this.cleanText(
            entryRecord['typeId'] ??
              entryRecord['type'] ??
              entryRecord['typeLabel'] ??
              entryRecord['vehicleType'],
          ) ?? '';
        const quantityRaw = this.parseNumber(entryRecord['quantity'] ?? entryRecord['count']);
        const quantity =
          quantityRaw && Number.isFinite(quantityRaw)
            ? Math.max(1, Math.trunc(quantityRaw))
            : 1;
        if (typeRef) {
          parsedEntries.push({ typeRef, quantity });
        }
      });
    } else if (serialized) {
      const lines = serialized
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      lines.forEach((line) => {
        const [typePart, quantityPart] = line.split(':').map((part) => part.trim());
        const typeRef = typePart ?? '';
        const quantity = Math.max(1, Number.parseInt(quantityPart ?? '1', 10) || 1);
        if (typeRef) {
          parsedEntries.push({ typeRef, quantity });
        }
      });
    }

    const entries: VehicleComposition['entries'] = [];
    for (let index = 0; index < parsedEntries.length; index += 1) {
      const entry = parsedEntries[index];
      if (!entry.typeRef) {
        return { feedback: 'Fahrzeugtyp fehlt.' };
      }
      const resolved = this.resolveVehicleTypeIdByReference(types, entry.typeRef, {
        apply: {
          mode: 'value',
          path: [...basePath, index, 'typeId'],
        },
      });
      if (resolved.clarification) {
        return { clarification: resolved.clarification };
      }
      if (resolved.feedback || !resolved.id) {
        return { feedback: resolved.feedback ?? 'Fahrzeugtyp nicht gefunden.' };
      }
      entries.push({ typeId: resolved.id, quantity: entry.quantity });
    }

    return { entries };
  }

  private resolveOperationalPointTarget(
    operationalPoints: OperationalPoint[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { item?: OperationalPoint; feedback?: string; clarification?: ClarificationRequest } {
    const opId = this.cleanText(target['opId']) ?? this.cleanText(target['id']);
    if (opId) {
      const match = operationalPoints.find((entry) => entry.opId === opId);
      if (!match) {
        return { feedback: `Operational Point "${opId}" nicht gefunden.` };
      }
      return { item: match };
    }

    const uniqueOpId = this.cleanText(target['uniqueOpId']);
    if (uniqueOpId) {
      const match = operationalPoints.find((entry) => entry.uniqueOpId === uniqueOpId);
      if (!match) {
        return { feedback: `Operational Point "${uniqueOpId}" nicht gefunden.` };
      }
      return { item: match };
    }

    const name = this.cleanText(target['name']) ?? this.cleanText(target['label']);
    if (!name) {
      return { feedback: 'Operational Point fehlt.' };
    }
    const normalized = this.normalizeKey(name);
    const matches = operationalPoints.filter(
      (entry) => this.normalizeKey(entry.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Operational Point "${name}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Operational Point "${name}" ist nicht eindeutig. Welchen meinst du?`,
            options: matches.map((entry) => ({
              id: entry.opId,
              label: entry.name ?? entry.opId,
              details: entry.uniqueOpId,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Operational Point "${name}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => entry.name ?? entry.opId),
        )}`,
      };
    }
    return { item: matches[0] };
  }

  private resolveOperationalPointUniqueOpIdByReference(
    operationalPoints: OperationalPoint[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { uniqueOpId?: string; feedback?: string; clarification?: ClarificationRequest } {
    const trimmed = ref.trim();
    const byUnique = operationalPoints.find((entry) => entry.uniqueOpId === trimmed);
    if (byUnique) {
      return { uniqueOpId: byUnique.uniqueOpId };
    }
    const byId = operationalPoints.find((entry) => entry.opId === trimmed);
    if (byId) {
      return { uniqueOpId: byId.uniqueOpId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = operationalPoints.filter(
      (entry) => this.normalizeKey(entry.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Operational Point "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Operational Point "${ref}" ist nicht eindeutig. Welchen meinst du?`,
            options: matches.map((entry) => ({
              id: entry.uniqueOpId,
              label: entry.name ?? entry.uniqueOpId,
              details: entry.uniqueOpId,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Operational Point "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => entry.name ?? entry.uniqueOpId),
        )}`,
      };
    }
    return { uniqueOpId: matches[0].uniqueOpId };
  }

  private resolveSectionOfLineTarget(
    sections: SectionOfLine[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { item?: SectionOfLine; feedback?: string; clarification?: ClarificationRequest } {
    const solId = this.cleanText(target['solId']) ?? this.cleanText(target['id']);
    if (solId) {
      const match = sections.find((entry) => entry.solId === solId);
      if (!match) {
        return { feedback: `Section of Line "${solId}" nicht gefunden.` };
      }
      return { item: match };
    }
    const start = this.cleanText(target['startUniqueOpId']);
    const end = this.cleanText(target['endUniqueOpId']);
    if (!start || !end) {
      return { feedback: 'Section of Line ID fehlt.' };
    }
    const matches = sections.filter(
      (entry) =>
        entry.startUniqueOpId === start && entry.endUniqueOpId === end,
    );
    if (!matches.length) {
      return { feedback: 'Section of Line nicht gefunden.' };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: 'Section of Line ist nicht eindeutig. Welche meinst du?',
            options: matches.map((entry) => ({
              id: entry.solId,
              label: `${entry.startUniqueOpId} -> ${entry.endUniqueOpId}`,
              details: entry.solId,
            })),
            apply: clarification.apply,
          },
        };
      }
      return { feedback: 'Section of Line ist nicht eindeutig.' };
    }
    return { item: matches[0] };
  }

  private resolvePersonnelSiteIdByReference(
    sites: PersonnelSite[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { siteId?: string; feedback?: string; clarification?: ClarificationRequest } {
    const trimmed = ref.trim();
    const direct = sites.find((site) => site.siteId === trimmed);
    if (direct) {
      return { siteId: direct.siteId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = sites.filter(
      (site) => this.normalizeKey(site.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Personnel Site "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Personnel Site "${ref}" ist nicht eindeutig. Welches meinst du?`,
            options: matches.map((site) => ({
              id: site.siteId,
              label: site.name ?? site.siteId,
              details: site.siteType ?? undefined,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Personnel Site "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((site) => site.name ?? site.siteId),
        )}`,
      };
    }
    return { siteId: matches[0].siteId };
  }

  private resolveReplacementStopIdByReference(
    stops: ReplacementStop[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { stopId?: string; feedback?: string; clarification?: ClarificationRequest } {
    const trimmed = ref.trim();
    const direct = stops.find((stop) => stop.replacementStopId === trimmed);
    if (direct) {
      return { stopId: direct.replacementStopId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = stops.filter(
      (stop) => this.normalizeKey(stop.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Replacement Stop "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Replacement Stop "${ref}" ist nicht eindeutig. Welchen meinst du?`,
            options: matches.map((stop) => ({
              id: stop.replacementStopId,
              label: stop.name ?? stop.replacementStopId,
              details: stop.stopCode ?? undefined,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Replacement Stop "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((stop) => stop.name ?? stop.replacementStopId),
        )}`,
      };
    }
    return { stopId: matches[0].replacementStopId };
  }

  private resolveReplacementRouteIdByReference(
    routes: ReplacementRoute[],
    ref: string,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { routeId?: string; feedback?: string; clarification?: ClarificationRequest } {
    const trimmed = ref.trim();
    const direct = routes.find((route) => route.replacementRouteId === trimmed);
    if (direct) {
      return { routeId: direct.replacementRouteId };
    }
    const normalized = this.normalizeKey(trimmed);
    const matches = routes.filter(
      (route) => this.normalizeKey(route.name ?? '') === normalized,
    );
    if (!matches.length) {
      return { feedback: `Replacement Route "${ref}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (clarification) {
        return {
          clarification: {
            title: `Replacement Route "${ref}" ist nicht eindeutig. Welche meinst du?`,
            options: matches.map((route) => ({
              id: route.replacementRouteId,
              label: route.name ?? route.replacementRouteId,
              details: route.operator ?? undefined,
            })),
            apply: clarification.apply,
          },
        };
      }
      return {
        feedback: `Replacement Route "${ref}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((route) => route.name ?? route.replacementRouteId),
        )}`,
      };
    }
    return { routeId: matches[0].replacementRouteId };
  }

  private resolveReplacementEdgeTarget(
    edges: ReplacementEdge[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { item?: ReplacementEdge; feedback?: string; clarification?: ClarificationRequest } {
    const edgeId =
      this.cleanText(target['replacementEdgeId']) ?? this.cleanText(target['id']);
    if (edgeId) {
      const match = edges.find((entry) => entry.replacementEdgeId === edgeId);
      if (!match) {
        return { feedback: `Replacement Edge "${edgeId}" nicht gefunden.` };
      }
      return { item: match };
    }
    const routeId = this.cleanText(target['replacementRouteId']);
    const seq = this.parseNumber(target['seq']);
    if (!routeId || seq === undefined) {
      return { feedback: 'Replacement Edge ID fehlt.' };
    }
    const matches = edges.filter(
      (entry) => entry.replacementRouteId === routeId && entry.seq === seq,
    );
    if (!matches.length) {
      return { feedback: 'Replacement Edge nicht gefunden.' };
    }
    if (matches.length > 1 && clarification) {
      return {
        clarification: {
          title: 'Replacement Edge ist nicht eindeutig. Welche meinst du?',
          options: matches.map((entry) => ({
            id: entry.replacementEdgeId,
            label: `${entry.replacementRouteId} · Seq ${entry.seq}`,
            details: entry.replacementEdgeId,
          })),
          apply: clarification.apply,
        },
      };
    }
    return { item: matches[0] };
  }

  private resolveOpReplacementStopLinkTarget(
    links: OpReplacementStopLink[],
    target: Record<string, unknown>,
    clarification?: { apply: AssistantActionClarificationApply },
  ): { item?: OpReplacementStopLink; feedback?: string; clarification?: ClarificationRequest } {
    const linkId = this.cleanText(target['linkId']) ?? this.cleanText(target['id']);
    if (linkId) {
      const match = links.find((entry) => entry.linkId === linkId);
      if (!match) {
        return { feedback: `OP-Link "${linkId}" nicht gefunden.` };
      }
      return { item: match };
    }
    const uniqueOpId = this.cleanText(target['uniqueOpId']);
    const replacementStopId = this.cleanText(target['replacementStopId']);
    if (!uniqueOpId || !replacementStopId) {
      return { feedback: 'OP-Link ID fehlt.' };
    }
    const matches = links.filter(
      (entry) =>
        entry.uniqueOpId === uniqueOpId &&
        entry.replacementStopId === replacementStopId,
    );
    if (!matches.length) {
      return { feedback: 'OP-Link nicht gefunden.' };
    }
    if (matches.length > 1 && clarification) {
      return {
        clarification: {
          title: 'OP-Link ist nicht eindeutig. Welchen meinst du?',
          options: matches.map((entry) => ({
            id: entry.linkId,
            label: entry.linkId,
            details: `${entry.uniqueOpId} -> ${entry.replacementStopId}`,
          })),
          apply: clarification.apply,
        },
      };
    }
    return { item: matches[0] };
  }

  private parsePosition(
    record: Record<string, unknown>,
    label: string,
  ): { position?: { lat: number; lng: number }; feedback?: string } {
    const positionRecord = this.asRecord(record['position']) ?? {};
    const lat = this.parseNumber(record['lat'] ?? positionRecord['lat']);
    const lng = this.parseNumber(record['lng'] ?? positionRecord['lng']);
    if (lat === undefined || lng === undefined) {
      return {
        feedback: `${label}: Latitude und Longitude fehlen oder sind ungültig.`,
      };
    }
    return { position: { lat, lng } };
  }

  private parseTransferNode(
    value: unknown,
    state: ActionTopologyState,
    clarification?: { applyPath: Array<string | number> },
  ): { node?: TransferNode; feedback?: string; clarification?: ClarificationRequest } {
    const record = this.asRecord(value);
    if (!record) {
      return { feedback: 'Transfer-Knoten fehlt.' };
    }
    const kindRaw = this.cleanText(record['kind']);
    if (!kindRaw) {
      return { feedback: 'Transfer-Knoten: kind fehlt.' };
    }
    const kind = kindRaw.toUpperCase();
    switch (kind) {
      case 'OP': {
        const ref =
          this.cleanText(record['uniqueOpId']) ??
          this.cleanText(record['opId']) ??
          this.cleanText(record['name']);
        if (!ref) {
          return { feedback: 'Transfer-Knoten (OP) fehlt.' };
        }
        const opResult = this.resolveOperationalPointUniqueOpIdByReference(
          state.operationalPoints,
          ref,
          clarification
            ? {
                apply: {
                  mode: 'value',
                  path: [...clarification.applyPath, 'uniqueOpId'],
                },
              }
            : undefined,
        );
        if (opResult.clarification) {
          return { clarification: opResult.clarification };
        }
        if (opResult.feedback || !opResult.uniqueOpId) {
          return { feedback: opResult.feedback ?? 'Operational Point nicht gefunden.' };
        }
        return { node: { kind: 'OP', uniqueOpId: opResult.uniqueOpId } };
      }
      case 'PERSONNEL_SITE': {
        const ref =
          this.cleanText(record['siteId']) ?? this.cleanText(record['name']);
        if (!ref) {
          return { feedback: 'Transfer-Knoten (Personnel Site) fehlt.' };
        }
        const siteResult = this.resolvePersonnelSiteIdByReference(
          state.personnelSites,
          ref,
          clarification
            ? {
                apply: {
                  mode: 'value',
                  path: [...clarification.applyPath, 'siteId'],
                },
              }
            : undefined,
        );
        if (siteResult.clarification) {
          return { clarification: siteResult.clarification };
        }
        if (siteResult.feedback || !siteResult.siteId) {
          return { feedback: siteResult.feedback ?? 'Personnel Site nicht gefunden.' };
        }
        return { node: { kind: 'PERSONNEL_SITE', siteId: siteResult.siteId } };
      }
      case 'REPLACEMENT_STOP': {
        const ref =
          this.cleanText(record['replacementStopId']) ??
          this.cleanText(record['name']);
        if (!ref) {
          return { feedback: 'Transfer-Knoten (Replacement Stop) fehlt.' };
        }
        const stopResult = this.resolveReplacementStopIdByReference(
          state.replacementStops,
          ref,
          clarification
            ? {
                apply: {
                  mode: 'value',
                  path: [...clarification.applyPath, 'replacementStopId'],
                },
              }
            : undefined,
        );
        if (stopResult.clarification) {
          return { clarification: stopResult.clarification };
        }
        if (stopResult.feedback || !stopResult.stopId) {
          return { feedback: stopResult.feedback ?? 'Replacement Stop nicht gefunden.' };
        }
        return { node: { kind: 'REPLACEMENT_STOP', replacementStopId: stopResult.stopId } };
      }
      default:
        return { feedback: `Transfer-Knoten: Unbekannter Typ "${kindRaw}".` };
    }
  }

  private transferNodeMatches(node: TransferNode, target: TransferNode): boolean {
    if (node.kind !== target.kind) {
      return false;
    }
    switch (node.kind) {
      case 'OP':
        return node.uniqueOpId === (target as { uniqueOpId: string }).uniqueOpId;
      case 'PERSONNEL_SITE':
        return node.siteId === (target as { siteId: string }).siteId;
      case 'REPLACEMENT_STOP':
        return (
          node.replacementStopId ===
          (target as { replacementStopId: string }).replacementStopId
        );
    }
  }

  private transferNodesEqual(a: TransferNode, b: TransferNode): boolean {
    return this.transferNodeMatches(a, b);
  }

  private assertUniqueReplacementEdgeSeq(
    edges: ReplacementEdge[],
    routeId: string,
    seq: number,
    ignoreEdgeId?: string,
  ): string | null {
    const conflict = edges.find(
      (edge) =>
        edge.replacementRouteId === routeId &&
        edge.seq === seq &&
        edge.replacementEdgeId !== ignoreEdgeId,
    );
    if (conflict) {
      return `Sequenz ${seq} ist bereits für Route "${routeId}" vergeben.`;
    }
    return null;
  }

  private assertUniqueOpReplacementLink(
    links: OpReplacementStopLink[],
    uniqueOpId: string,
    replacementStopId: string,
    ignoreLinkId?: string,
  ): string | null {
    const conflict = links.find(
      (link) =>
        link.uniqueOpId === uniqueOpId &&
        link.replacementStopId === replacementStopId &&
        link.linkId !== ignoreLinkId,
    );
    if (conflict) {
      return `OP-Link zwischen "${uniqueOpId}" und "${replacementStopId}" existiert bereits.`;
    }
    return null;
  }

  private relinkUniqueOpId(
    state: ActionTopologyState,
    oldId: string,
    newId: string,
  ): void {
    state.sectionsOfLine = state.sectionsOfLine.map((section) => ({
      ...section,
      startUniqueOpId:
        section.startUniqueOpId === oldId ? newId : section.startUniqueOpId,
      endUniqueOpId:
        section.endUniqueOpId === oldId ? newId : section.endUniqueOpId,
    }));
    state.personnelSites = state.personnelSites.map((site) =>
      site.uniqueOpId === oldId ? { ...site, uniqueOpId: newId } : site,
    );
    state.replacementStops = state.replacementStops.map((stop) =>
      stop.nearestUniqueOpId === oldId
        ? { ...stop, nearestUniqueOpId: newId }
        : stop,
    );
    state.opReplacementStopLinks = state.opReplacementStopLinks.map((link) =>
      link.uniqueOpId === oldId ? { ...link, uniqueOpId: newId } : link,
    );
    state.transferEdges = state.transferEdges.map((edge) => ({
      ...edge,
      from: this.remapTransferNode(edge.from, oldId, newId),
      to: this.remapTransferNode(edge.to, oldId, newId),
    }));
  }

  private remapTransferNode(
    node: TransferNode,
    oldId: string,
    newId: string,
  ): TransferNode {
    if (node.kind === 'OP' && node.uniqueOpId === oldId) {
      return { ...node, uniqueOpId: newId };
    }
    return node;
  }

  private resolvePersonnelServiceIds(
    services: PersonnelService[],
    serviceNames?: string[],
    clarification?: {
      applyPath: Array<string | number>;
      title?: (name: string) => string;
      poolLabelById?: Map<string, string>;
    },
  ): { ids?: string[]; feedback?: string; clarification?: ClarificationRequest } {
    if (!serviceNames || !serviceNames.length) {
      return { ids: undefined };
    }
    const poolFiltered = services.filter(
      (service) => service.poolId !== SYSTEM_POOL_IDS.personnelServicePool,
    );
    const ids: string[] = [];
    const missing: string[] = [];
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();

    for (let index = 0; index < serviceNames.length; index += 1) {
      const rawName = serviceNames[index];
      const name = this.cleanText(rawName) ?? '';
      if (!name) {
        continue;
      }
      const direct = poolFiltered.find((service) => service.id === name);
      if (direct) {
        if (!seenIds.has(direct.id)) {
          ids.push(direct.id);
          seenIds.add(direct.id);
        }
        continue;
      }

      const normalized = this.normalizeKey(name);
      if (seenNames.has(normalized)) {
        continue;
      }
      const matches = poolFiltered.filter(
        (service) => this.normalizeKey(service.name) === normalized,
      );
      if (!matches.length) {
        missing.push(name);
        continue;
      }
      if (matches.length > 1) {
        if (clarification) {
          const title =
            clarification.title?.(name) ??
            `Personaldienst "${name}" ist nicht eindeutig. Welchen meinst du?`;
          return {
            clarification: {
              title,
              options: matches.map((service) => ({
                id: service.id,
                label: service.name,
                details: service.poolId
                  ? `Pool ${clarification.poolLabelById?.get(service.poolId) ?? service.poolId}`
                  : undefined,
              })),
              apply: {
                mode: 'value',
                path: [...clarification.applyPath, index],
              },
            },
          };
        }
        return {
          feedback: `Personaldienst "${name}" ist nicht eindeutig. ${this.describeCandidates(
            matches.map((service) => service.name),
          )}`,
        };
      }
      const match = matches[0];
      seenNames.add(normalized);
      if (!seenIds.has(match.id)) {
        ids.push(match.id);
        seenIds.add(match.id);
      }
    }

    if (missing.length) {
      return { feedback: `Personaldienst(e) nicht gefunden: ${missing.join(', ')}` };
    }
    return { ids };
  }

  private resolveVehicleServiceIds(
    services: VehicleService[],
    serviceNames?: string[],
    clarification?: {
      applyPath: Array<string | number>;
      title?: (name: string) => string;
      poolLabelById?: Map<string, string>;
    },
  ): { ids?: string[]; feedback?: string; clarification?: ClarificationRequest } {
    if (!serviceNames || !serviceNames.length) {
      return { ids: undefined };
    }
    const poolFiltered = services.filter(
      (service) => service.poolId !== SYSTEM_POOL_IDS.vehicleServicePool,
    );
    const ids: string[] = [];
    const missing: string[] = [];
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();

    for (let index = 0; index < serviceNames.length; index += 1) {
      const rawName = serviceNames[index];
      const name = this.cleanText(rawName) ?? '';
      if (!name) {
        continue;
      }
      const direct = poolFiltered.find((service) => service.id === name);
      if (direct) {
        if (!seenIds.has(direct.id)) {
          ids.push(direct.id);
          seenIds.add(direct.id);
        }
        continue;
      }

      const normalized = this.normalizeKey(name);
      if (seenNames.has(normalized)) {
        continue;
      }
      const matches = poolFiltered.filter(
        (service) => this.normalizeKey(service.name) === normalized,
      );
      if (!matches.length) {
        missing.push(name);
        continue;
      }
      if (matches.length > 1) {
        if (clarification) {
          const title =
            clarification.title?.(name) ??
            `Fahrzeugdienst "${name}" ist nicht eindeutig. Welchen meinst du?`;
          return {
            clarification: {
              title,
              options: matches.map((service) => ({
                id: service.id,
                label: service.name,
                details: service.poolId
                  ? `Pool ${clarification.poolLabelById?.get(service.poolId) ?? service.poolId}`
                  : undefined,
              })),
              apply: {
                mode: 'value',
                path: [...clarification.applyPath, index],
              },
            },
          };
        }
        return {
          feedback: `Fahrzeugdienst "${name}" ist nicht eindeutig. ${this.describeCandidates(
            matches.map((service) => service.name),
          )}`,
        };
      }
      const match = matches[0];
      seenNames.add(normalized);
      if (!seenIds.has(match.id)) {
        ids.push(match.id);
        seenIds.add(match.id);
      }
    }

    if (missing.length) {
      return { feedback: `Fahrzeugdienst(e) nicht gefunden: ${missing.join(', ')}` };
    }
    return { ids };
  }

  private resolveTemporalString(
    value?: string | TemporalValue<string>[],
  ): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value) && value.length) {
      const last = value[value.length - 1];
      return typeof last?.value === 'string' ? last.value : undefined;
    }
    return undefined;
  }

  private splitFullName(value: string): { firstName?: string; lastName?: string } {
    const parts = value.trim().split(/\s+/).filter((part) => part.length > 0);
    if (!parts.length) {
      return {};
    }
    if (parts.length === 1) {
      return { firstName: parts[0] };
    }
    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: parts[parts.length - 1],
    };
  }

  private formatPersonnelLabel(person: Personnel): string {
    const firstName = this.resolveTemporalString(person.firstName) ?? '';
    const lastName = person.lastName ?? '';
    const label = `${firstName} ${lastName}`.trim();
    const preferred = this.resolveTemporalString(person.preferredName);
    return (
      label ||
      preferred ||
      this.cleanText(person.name) ||
      person.id
    );
  }

  private formatVehicleLabel(vehicle: Vehicle): string {
    return (
      this.cleanText(vehicle.vehicleNumber) ||
      this.cleanText(vehicle.name) ||
      vehicle.id
    );
  }

  private resolvePersonnelTarget(
    personnel: Personnel[],
    target: Record<string, unknown>,
    options?: {
      clarification?: { title?: string; apply: AssistantActionClarificationApply };
      poolLabelById?: Map<string, string>;
    },
  ): { item?: Personnel; feedback?: string; clarification?: ClarificationRequest } {
    const id = this.extractFirstText(target, ['id', 'personnelId']);
    if (id) {
      const match = personnel.find((entry) => entry.id === id);
      if (!match) {
        return { feedback: `Personal mit ID "${id}" nicht gefunden.` };
      }
      return { item: match };
    }

    const firstName = this.cleanText(target['firstName']);
    const lastName = this.cleanText(target['lastName']);
    let name =
      this.cleanText(target['name']) ??
      this.cleanText(target['fullName']) ??
      this.cleanText(target['label']);
    if (!name && firstName && lastName) {
      name = `${firstName} ${lastName}`;
    }
    if (!name) {
      return { feedback: 'Personalname fehlt.' };
    }

    const normalized = this.normalizeKey(name);
    const matches = personnel.filter(
      (entry) => this.normalizeKey(this.formatPersonnelLabel(entry)) === normalized,
    );
    if (!matches.length) {
      return { feedback: `Personal "${name}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (options?.clarification) {
        const title =
          options.clarification.title ??
          `Personal "${name}" ist nicht eindeutig. Welches meinst du?`;
        return {
          clarification: {
            title,
            options: matches.map((entry) => ({
              id: entry.id,
              label: this.formatPersonnelLabel(entry),
              details: entry.poolId
                ? `Pool ${options.poolLabelById?.get(entry.poolId) ?? entry.poolId}`
                : undefined,
            })),
            apply: options.clarification.apply,
          },
        };
      }
      return {
        feedback: `Personal "${name}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => this.formatPersonnelLabel(entry)),
        )}`,
      };
    }
    return { item: matches[0] };
  }

  private resolveVehicleTarget(
    vehicles: Vehicle[],
    target: Record<string, unknown>,
    options?: {
      clarification?: { title?: string; apply: AssistantActionClarificationApply };
      poolLabelById?: Map<string, string>;
    },
  ): { item?: Vehicle; feedback?: string; clarification?: ClarificationRequest } {
    const id = this.extractFirstText(target, ['id', 'vehicleId']);
    if (id) {
      const match = vehicles.find((entry) => entry.id === id);
      if (!match) {
        return { feedback: `Fahrzeug mit ID "${id}" nicht gefunden.` };
      }
      return { item: match };
    }

    const number =
      this.cleanText(target['vehicleNumber']) ?? this.cleanText(target['number']);
    let name = number ?? this.cleanText(target['name']) ?? this.cleanText(target['label']);
    if (!name) {
      return { feedback: 'Fahrzeugname fehlt.' };
    }
    const normalized = this.normalizeKey(name);
    const matches = vehicles.filter(
      (entry) =>
        this.normalizeKey(
          entry.vehicleNumber ?? entry.name ?? entry.id ?? '',
        ) === normalized,
    );
    if (!matches.length) {
      return { feedback: `Fahrzeug "${name}" nicht gefunden.` };
    }
    if (matches.length > 1) {
      if (options?.clarification) {
        const title =
          options.clarification.title ??
          `Fahrzeug "${name}" ist nicht eindeutig. Welches meinst du?`;
        return {
          clarification: {
            title,
            options: matches.map((entry) => ({
              id: entry.id,
              label: this.formatVehicleLabel(entry),
              details: entry.poolId
                ? `Pool ${options.poolLabelById?.get(entry.poolId) ?? entry.poolId}`
                : undefined,
            })),
            apply: options.clarification.apply,
          },
        };
      }
      return {
        feedback: `Fahrzeug "${name}" ist nicht eindeutig. ${this.describeCandidates(
          matches.map((entry) => this.formatVehicleLabel(entry)),
        )}`,
      };
    }
    return { item: matches[0] };
  }

  private describeCandidates(values: string[]): string {
    const candidates = values.filter((value) => value && value.trim().length > 0);
    if (!candidates.length) {
      return '';
    }
    const listed = candidates.slice(0, 5).join(', ');
    return `Mögliche Treffer: ${listed}${candidates.length > 5 ? '…' : ''}.`;
  }

  private generateId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  private describeOllamaError(error: unknown): string {
    if (error instanceof OllamaOpenAiTimeoutError) {
      return `Ollama hat zu lange nicht geantwortet (Timeout nach ${error.timeoutMs}ms). Prüfe OLLAMA_TIMEOUT_MS oder die Modelllast.`;
    }
    if (error instanceof OllamaOpenAiNetworkError) {
      return `Ollama ist nicht erreichbar (${this.config.ollamaBaseUrl}). Läuft Ollama und ist OLLAMA_BASE_URL korrekt?`;
    }
    if (error instanceof OllamaOpenAiHttpError) {
      const upstreamMessage = this.extractOllamaErrorMessage(error.body);
      if (error.status === 404 && upstreamMessage?.toLowerCase().includes('model')) {
        return `Ollama: Modell '${this.config.ollamaModel}' nicht gefunden. Installiere es z. B. mit: ollama pull ${this.config.ollamaModel}`;
      }
      if (error.status === 401 || error.status === 403) {
        return `Ollama: Zugriff verweigert (${error.status}). Prüfe OLLAMA_API_KEY und die Ollama-Konfiguration.`;
      }
      return `Ollama: Upstream-Fehler (${error.status} ${error.statusText})${upstreamMessage ? `: ${upstreamMessage}` : ''}`;
    }

    return 'LLM backend (Ollama) request failed.';
  }

  private extractOllamaErrorMessage(body: string): string | null {
    const text = body?.trim?.() ?? '';
    if (!text) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } };
      const message = parsed?.error?.message;
      return typeof message === 'string' && message.trim() ? message.trim() : null;
    } catch {
      return null;
    }
  }
}
