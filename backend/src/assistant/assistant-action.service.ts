import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
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
import { OllamaOpenAiClient } from './ollama-openai.client';
import { AssistantDocumentationService } from './assistant.documentation.service';
import { COREPLANX_ASSISTANT_ACTION_SYSTEM_PROMPT } from './assistant.action.system-prompt';
import { AssistantActionPreviewStore } from './assistant-action-preview.store';
import { AssistantActionClarificationStore } from './assistant-action-clarification.store';
import { AssistantActionAuditService } from './assistant-action-audit.service';
import type {
  AssistantActionCommitTask,
  AssistantActionRefreshHint,
} from './assistant-action.types';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
} from './assistant-action.engine.types';
import { AssistantActionBase } from './assistant-action.base';
import { AssistantActionPayloadParser } from './assistant-action.payload-parser';
import { AssistantActionPersonnelServices } from './assistant-action.personnel-services';
import { AssistantActionVehicleServices } from './assistant-action.vehicle-services';
import { AssistantActionPersonnel } from './assistant-action.personnel';
import { AssistantActionVehicle } from './assistant-action.vehicle';
import { AssistantActionHomeDepot } from './assistant-action.home-depot';
import { AssistantActionVehicleMeta } from './assistant-action.vehicle-meta';
import { AssistantActionTimetableSimulation } from './assistant-action.timetable-simulation';
import { AssistantActionTopologyOperations } from './assistant-action.topology.operations';
import { AssistantActionTopologySites } from './assistant-action.topology.sites';
import { AssistantActionTopologyReplacements } from './assistant-action.topology.replacements';
import { AssistantActionTopologyReplacementEdges } from './assistant-action.topology.replacement-edges';
import { AssistantActionTopologyTransfers } from './assistant-action.topology.transfers';
import { AssistantActionSettings } from './assistant-action.settings';
import { PlanningService } from '../planning/planning.service';
import { TimetableYearService } from '../variants/timetable-year.service';
import type {
  OperationalPoint,
  OpReplacementStopLink,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  ResourceSnapshot,
  SectionOfLine,
  TransferEdge,
} from '../planning/planning.types';

type BaseOptions = ConstructorParameters<typeof AssistantActionBase>[0];

@Injectable()
export class AssistantActionService extends AssistantActionBase {
  private readonly payloadParser: AssistantActionPayloadParser;
  private readonly personnelServices: AssistantActionPersonnelServices;
  private readonly vehicleServices: AssistantActionVehicleServices;
  private readonly personnel: AssistantActionPersonnel;
  private readonly vehicle: AssistantActionVehicle;
  private readonly homeDepots: AssistantActionHomeDepot;
  private readonly vehicleMeta: AssistantActionVehicleMeta;
  private readonly timetableSimulation: AssistantActionTimetableSimulation;
  private readonly topologyOperations: AssistantActionTopologyOperations;
  private readonly topologySites: AssistantActionTopologySites;
  private readonly topologyReplacements: AssistantActionTopologyReplacements;
  private readonly topologyReplacementEdges: AssistantActionTopologyReplacementEdges;
  private readonly topologyTransfers: AssistantActionTopologyTransfers;
  private readonly settings: AssistantActionSettings;

  constructor(
    @Inject(ASSISTANT_CONFIG) config: AssistantConfig,
    docs: AssistantDocumentationService,
    planning: PlanningService,
    timetableYears: TimetableYearService,
    ollama: OllamaOpenAiClient,
    previews: AssistantActionPreviewStore,
    clarifications: AssistantActionClarificationStore,
    audit: AssistantActionAuditService,
  ) {
    const logger = new Logger(AssistantActionService.name);
    const baseOptions: BaseOptions = {
      logger,
      config,
      docs,
      planning,
      timetableYears,
      ollama,
      previews,
      clarifications,
      audit,
    };
    super(baseOptions);
    this.payloadParser = new AssistantActionPayloadParser(baseOptions);
    this.personnelServices = new AssistantActionPersonnelServices(baseOptions);
    this.vehicleServices = new AssistantActionVehicleServices(baseOptions);
    this.personnel = new AssistantActionPersonnel(baseOptions);
    this.vehicle = new AssistantActionVehicle(baseOptions);
    this.homeDepots = new AssistantActionHomeDepot(baseOptions);
    this.vehicleMeta = new AssistantActionVehicleMeta(baseOptions);
    this.timetableSimulation = new AssistantActionTimetableSimulation(
      baseOptions,
    );
    this.topologyOperations = new AssistantActionTopologyOperations(
      baseOptions,
    );
    this.topologySites = new AssistantActionTopologySites(baseOptions);
    this.topologyReplacements = new AssistantActionTopologyReplacements(
      baseOptions,
    );
    this.topologyReplacementEdges = new AssistantActionTopologyReplacementEdges(
      baseOptions,
    );
    this.topologyTransfers = new AssistantActionTopologyTransfers(baseOptions);
    this.settings = new AssistantActionSettings(baseOptions);
  }

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
      {
        role: 'system' as const,
        content: COREPLANX_ASSISTANT_ACTION_SYSTEM_PROMPT,
      },
      ...contextMessages,
      { role: 'user' as const, content: prompt },
    ];

    const firstAttempt =
      await this.payloadParser.requestActionPayload(messages);
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
      const secondAttempt =
        await this.payloadParser.requestActionPayload(retryMessages);
      payload = secondAttempt.payload;
      if (!payload) {
        return this.buildFeedbackResponse(
          secondAttempt.error ?? 'Keine erkennbare Aktion gefunden.',
        ).response;
      }
    }

    if (!payload?.action) {
      return this.buildFeedbackResponse('Keine erkennbare Aktion gefunden.')
        .response;
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

    const snapshot = await this.planning.replaceResourceSnapshot(
      preview.snapshot,
    );
    if (preview.commitTasks && preview.commitTasks.length) {
      await this.applyCommitTasks(preview.commitTasks);
    }
    const refreshHints = preview.refreshHints?.length
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

  private async applyCommitTasks(
    tasks: AssistantActionCommitTask[],
  ): Promise<void> {
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
              throw new BadRequestException(
                'Fahrplanjahr fuer Simulation fehlt.',
              );
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
              timetableYearLabel:
                task.targetTimetableYearLabel ?? task.timetableYearLabel,
            }));
          if (!variantId) {
            throw new BadRequestException(
              'Simulation konnte nicht aufgeloest werden.',
            );
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
        case 'activityTemplates': {
          await this.planning.replaceActivityTemplates(task.items);
          break;
        }
        case 'activityDefinitions': {
          await this.planning.replaceActivityDefinitions(task.items);
          break;
        }
        case 'layerGroups': {
          await this.planning.replaceLayerGroups(task.items);
          break;
        }
        case 'translations': {
          const locale = task.locale?.trim();
          if (!locale) {
            throw new BadRequestException('Locale fuer Übersetzungen fehlt.');
          }
          if (task.action === 'delete-locale') {
            await this.planning.deleteTranslationsForLocale(locale);
            break;
          }
          await this.planning.replaceTranslationsForLocale(
            locale,
            task.entries ?? {},
          );
          break;
        }
        case 'customAttributes': {
          await this.planning.replaceCustomAttributes(task.items);
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
        await this.planning.saveOperationalPoints({
          items: task.items as OperationalPoint[],
        });
        return;
      case 'sectionsOfLine':
        await this.planning.saveSectionsOfLine({
          items: task.items as SectionOfLine[],
        });
        return;
      case 'personnelSites':
        await this.planning.savePersonnelSites({
          items: task.items as PersonnelSite[],
        });
        return;
      case 'replacementStops':
        await this.planning.saveReplacementStops({
          items: task.items as ReplacementStop[],
        });
        return;
      case 'replacementRoutes':
        await this.planning.saveReplacementRoutes({
          items: task.items as ReplacementRoute[],
        });
        return;
      case 'replacementEdges':
        await this.planning.saveReplacementEdges({
          items: task.items as ReplacementEdge[],
        });
        return;
      case 'opReplacementStopLinks':
        await this.planning.saveOpReplacementStopLinks({
          items: task.items as OpReplacementStopLink[],
        });
        return;
      case 'transferEdges':
        await this.planning.saveTransferEdges({
          items: task.items as TransferEdge[],
        });
        return;
      default:
        return;
    }
  }

  async resolve(
    request: AssistantActionResolveRequestDto,
    role?: string | null,
  ): Promise<AssistantActionPreviewResponseDto> {
    const clarification = this.clarifications.get(
      request.resolutionId,
      request.clientId ?? null,
      this.normalizeRole(role),
    );
    if (!clarification) {
      throw new BadRequestException('resolutionId not found or expired');
    }
    const selectedId = request.selectedId?.trim();
    if (!selectedId) {
      throw new BadRequestException('selectedId is required');
    }
    const isOption = clarification.options.some(
      (option) => option.id === selectedId,
    );
    const inputSpec = clarification.input;
    if (!isOption && !inputSpec) {
      throw new BadRequestException('selectedId is not a valid option');
    }
    if (inputSpec) {
      const minLength = inputSpec.minLength ?? 1;
      const maxLength = inputSpec.maxLength ?? 200;
      if (selectedId.length < minLength) {
        throw new BadRequestException('selectedId is too short');
      }
      if (selectedId.length > maxLength) {
        throw new BadRequestException('selectedId is too long');
      }
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
      return this.buildFeedbackResponse(
        'Aktion ist fuer diese Rolle nicht erlaubt.',
      );
    }

    switch (payload.action) {
      case 'create_personnel_service_pool':
        return this.personnelServices.buildPersonnelServicePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_vehicle_service_pool':
        return this.vehicleServices.buildVehicleServicePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_personnel_service':
        return this.personnelServices.buildPersonnelServicePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_vehicle_service':
        return this.vehicleServices.buildVehicleServicePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_personnel_pool':
        return this.personnel.buildPersonnelPoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_vehicle_pool':
        return this.vehicle.buildVehiclePoolPreview(payload, snapshot, context);
      case 'create_home_depot':
        return this.homeDepots.buildHomeDepotPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_personnel':
        return this.personnel.buildPersonnelPreview(payload, snapshot, context);
      case 'create_vehicle':
        return this.vehicle.buildVehiclePreview(payload, snapshot, context);
      case 'create_vehicle_type':
        return this.vehicleMeta.buildVehicleTypePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_vehicle_composition':
        return this.vehicleMeta.buildVehicleCompositionPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_timetable_year':
        return this.timetableSimulation.buildTimetableYearPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_simulation':
        return this.timetableSimulation.buildSimulationPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_operational_point':
        return this.topologyOperations.buildOperationalPointPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_section_of_line':
        return this.topologyOperations.buildSectionOfLinePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_personnel_site':
        return this.topologySites.buildPersonnelSitePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_replacement_stop':
        return this.topologyReplacements.buildReplacementStopPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_replacement_route':
        return this.topologyReplacements.buildReplacementRoutePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_replacement_edge':
        return this.topologyReplacementEdges.buildReplacementEdgePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_op_replacement_stop_link':
        return this.topologyReplacementEdges.buildOpReplacementStopLinkPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_transfer_edge':
        return this.topologyTransfers.buildTransferEdgePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_personnel_service_pool':
        return this.personnelServices.buildUpdatePersonnelServicePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_vehicle_service_pool':
        return this.vehicleServices.buildUpdateVehicleServicePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_personnel_pool':
        return this.personnel.buildUpdatePersonnelPoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_vehicle_pool':
        return this.vehicle.buildUpdateVehiclePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_home_depot':
        return this.homeDepots.buildUpdateHomeDepotPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_personnel_service':
        return this.personnelServices.buildUpdatePersonnelServicePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_vehicle_service':
        return this.vehicleServices.buildUpdateVehicleServicePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_personnel':
        return this.personnel.buildUpdatePersonnelPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_vehicle':
        return this.vehicle.buildUpdateVehiclePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_vehicle_type':
        return this.vehicleMeta.buildUpdateVehicleTypePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_vehicle_composition':
        return this.vehicleMeta.buildUpdateVehicleCompositionPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_simulation':
        return this.timetableSimulation.buildUpdateSimulationPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_operational_point':
        return this.topologyOperations.buildUpdateOperationalPointPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_section_of_line':
        return this.topologyOperations.buildUpdateSectionOfLinePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_personnel_site':
        return this.topologySites.buildUpdatePersonnelSitePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_replacement_stop':
        return this.topologyReplacements.buildUpdateReplacementStopPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_replacement_route':
        return this.topologyReplacements.buildUpdateReplacementRoutePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_replacement_edge':
        return this.topologyReplacementEdges.buildUpdateReplacementEdgePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_op_replacement_stop_link':
        return this.topologyReplacementEdges.buildUpdateOpReplacementStopLinkPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_transfer_edge':
        return this.topologyTransfers.buildUpdateTransferEdgePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_personnel_service_pool':
        return this.personnelServices.buildDeletePersonnelServicePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_vehicle_service_pool':
        return this.vehicleServices.buildDeleteVehicleServicePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_personnel_pool':
        return this.personnel.buildDeletePersonnelPoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_vehicle_pool':
        return this.vehicle.buildDeleteVehiclePoolPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_home_depot':
        return this.homeDepots.buildDeleteHomeDepotPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_personnel_service':
        return this.personnelServices.buildDeletePersonnelServicePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_vehicle_service':
        return this.vehicleServices.buildDeleteVehicleServicePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_personnel':
        return this.personnel.buildDeletePersonnelPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_vehicle':
        return this.vehicle.buildDeleteVehiclePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_vehicle_type':
        return this.vehicleMeta.buildDeleteVehicleTypePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_vehicle_composition':
        return this.vehicleMeta.buildDeleteVehicleCompositionPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_timetable_year':
        return this.timetableSimulation.buildDeleteTimetableYearPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_simulation':
        return this.timetableSimulation.buildDeleteSimulationPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_operational_point':
        return this.topologyOperations.buildDeleteOperationalPointPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_section_of_line':
        return this.topologyOperations.buildDeleteSectionOfLinePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_personnel_site':
        return this.topologySites.buildDeletePersonnelSitePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_replacement_stop':
        return this.topologyReplacements.buildDeleteReplacementStopPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_replacement_route':
        return this.topologyReplacements.buildDeleteReplacementRoutePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_replacement_edge':
        return this.topologyReplacementEdges.buildDeleteReplacementEdgePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_op_replacement_stop_link':
        return this.topologyReplacementEdges.buildDeleteOpReplacementStopLinkPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_transfer_edge':
        return this.topologyTransfers.buildDeleteTransferEdgePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_activity_template':
        return this.settings.buildCreateActivityTemplatePreview(
          payload,
          snapshot,
          context,
        );
      case 'create_activity_definition':
        return this.settings.buildCreateActivityDefinitionPreview(
          payload,
          snapshot,
          context,
        );
      case 'create_layer_group':
        return this.settings.buildCreateLayerGroupPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_activity_template':
        return this.settings.buildUpdateActivityTemplatePreview(
          payload,
          snapshot,
          context,
        );
      case 'update_activity_definition':
        return this.settings.buildUpdateActivityDefinitionPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_layer_group':
        return this.settings.buildUpdateLayerGroupPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_activity_template':
        return this.settings.buildDeleteActivityTemplatePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_activity_definition':
        return this.settings.buildDeleteActivityDefinitionPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_layer_group':
        return this.settings.buildDeleteLayerGroupPreview(
          payload,
          snapshot,
          context,
        );
      case 'update_translations':
        return this.settings.buildUpdateTranslationsPreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_translation_locale':
        return this.settings.buildDeleteTranslationLocalePreview(
          payload,
          snapshot,
        );
      case 'create_custom_attribute':
        return this.settings.buildCreateCustomAttributePreview(
          payload,
          snapshot,
        );
      case 'update_custom_attribute':
        return this.settings.buildUpdateCustomAttributePreview(
          payload,
          snapshot,
          context,
        );
      case 'delete_custom_attribute':
        return this.settings.buildDeleteCustomAttributePreview(
          payload,
          snapshot,
        );
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
        return this.buildFeedbackResponse(
          `Batch-Aktion ${i + 1} ist ungueltig.`,
        );
      }
      const actionPayload = record as ActionPayload;
      if (!actionPayload.action || typeof actionPayload.action !== 'string') {
        return this.buildFeedbackResponse(
          `Batch-Aktion ${i + 1} fehlt "action".`,
        );
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
        refreshHints = this.mergeRefreshHints(
          refreshHints,
          outcome.refreshHints,
        );
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
    const refreshHints = outcome.refreshHints?.length
      ? outcome.refreshHints
      : this.collectRefreshHints(outcome.commitTasks);
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
}
