import { BadGatewayException } from '@nestjs/common';
import type { ActionPayload } from './assistant-action.engine.types';
import {
  OllamaOpenAiHttpError,
  OllamaOpenAiNetworkError,
  OllamaOpenAiTimeoutError,
} from './ollama-openai.client';
import { AssistantActionBase } from './assistant-action.base';
import {
  ACTIVITY_DEFINITION_KEYS,
  ACTIVITY_TEMPLATE_KEYS,
  ALLOWED_ACTIONS,
  CUSTOM_ATTRIBUTE_KEYS,
  DEFAULT_ROOT_FIELDS,
  HOME_DEPOT_KEYS,
  LAYER_GROUP_KEYS,
  OPERATIONAL_POINT_KEYS,
  OP_REPLACEMENT_STOP_LINK_KEYS,
  PATCH_KEYS,
  PERSONNEL_KEYS,
  PERSONNEL_SITE_KEYS,
  POOL_KEYS,
  REPLACEMENT_EDGE_KEYS,
  REPLACEMENT_ROUTE_KEYS,
  REPLACEMENT_STOP_KEYS,
  ROOT_FIELDS_BY_ACTION,
  SECTION_OF_LINE_KEYS,
  SERVICE_KEYS,
  SIMULATION_KEYS,
  TARGET_KEYS,
  TIMETABLE_YEAR_KEYS,
  TRANSFER_EDGE_KEYS,
  TRANSLATION_KEYS,
  VEHICLE_COMPOSITION_KEYS,
  VEHICLE_KEYS,
  VEHICLE_TYPE_KEYS,
} from './assistant-action.payload-schema';

export class AssistantActionPayloadParser extends AssistantActionBase {
  parseActionPayload(content: string): ActionPayload | null {
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
      this.logger.warn(`Assistant action JSON parse failed: ${firstAttempt.error.message}`);
    }
    return null;
  }

  tryParseJson<T>(value: string): { value?: T; error?: Error } {
    try {
      return { value: JSON.parse(value) as T };
    } catch (error) {
      return {
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  repairJson(value: string): string {
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

  async requestActionPayload(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ): Promise<{ payload: ActionPayload | null; error?: string; rawResponse?: string }> {
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

  validateActionPayload(payload: ActionPayload): { payload?: ActionPayload; error?: string } {
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

  migrateActionPayload(payload: ActionPayload): { payload?: ActionPayload; error?: string } {
    const hasVersion = payload.schemaVersion !== undefined && payload.schemaVersion !== null;
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

  sanitizeActionPayload(raw: unknown): ActionPayload | null {
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
        case 'activityTemplate':
          sanitized.activityTemplate = this.sanitizeEntity(record[key], ACTIVITY_TEMPLATE_KEYS);
          break;
        case 'activityTemplates':
          sanitized.activityTemplates = this.sanitizeEntity(record[key], ACTIVITY_TEMPLATE_KEYS);
          break;
        case 'activityDefinition':
          sanitized.activityDefinition = this.sanitizeEntity(record[key], ACTIVITY_DEFINITION_KEYS);
          break;
        case 'activityDefinitions':
          sanitized.activityDefinitions = this.sanitizeEntity(record[key], ACTIVITY_DEFINITION_KEYS);
          break;
        case 'layerGroup':
          sanitized.layerGroup = this.sanitizeEntity(record[key], LAYER_GROUP_KEYS);
          break;
        case 'layerGroups':
          sanitized.layerGroups = this.sanitizeEntity(record[key], LAYER_GROUP_KEYS);
          break;
        case 'translations':
          sanitized.translations = this.sanitizeEntity(record[key], TRANSLATION_KEYS);
          break;
        case 'translation':
          sanitized.translation = this.sanitizeEntity(record[key], TRANSLATION_KEYS);
          break;
        case 'locale':
          sanitized.locale = this.cleanText(record[key]);
          break;
        case 'customAttribute':
          sanitized.customAttribute = this.sanitizeEntity(record[key], CUSTOM_ATTRIBUTE_KEYS);
          break;
        case 'customAttributes':
          sanitized.customAttributes = this.sanitizeEntity(record[key], CUSTOM_ATTRIBUTE_KEYS);
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

  sanitizeBatchActions(value: unknown): ActionPayload[] | undefined {
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

  sanitizePool(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return this.sanitizeRecord(record, POOL_KEYS);
  }

  sanitizeServices(value: unknown): unknown {
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

  sanitizeEntity(value: unknown, allowedKeys: string[]): unknown {
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

  sanitizePersonnel(value: unknown): unknown {
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

  sanitizeVehicles(value: unknown): unknown {
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

  sanitizeTarget(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.trim();
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return this.sanitizeRecord(record, TARGET_KEYS);
  }

  sanitizePatch(value: unknown): Record<string, unknown> | undefined {
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return this.sanitizeRecord(record, PATCH_KEYS);
  }

  sanitizeRecord(record: Record<string, unknown>, allowedKeys: string[]): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (this.hasOwn(record, key)) {
        sanitized[key] = record[key];
      }
    }
    return sanitized;
  }

  describeOllamaError(error: unknown): string {
    if (error instanceof OllamaOpenAiTimeoutError) {
      return 'Ollama-Request hat das Timeout überschritten.';
    }
    if (error instanceof OllamaOpenAiNetworkError) {
      return 'Ollama konnte nicht erreicht werden.';
    }
    if (error instanceof OllamaOpenAiHttpError) {
      const message = this.extractOllamaErrorMessage(error.body ?? '');
      return message ? `Ollama-Fehler: ${message}` : `Ollama-Fehler: ${error.status}`;
    }
    return (error as Error)?.message ?? 'Unbekannter Fehler bei der Ollama-Anfrage.';
  }

  extractOllamaErrorMessage(body: string): string | null {
    if (!body) {
      return null;
    }
    const payloadResult = this.tryParseJson<{ error?: { message?: string } }>(body);
    return payloadResult.value?.error?.message ?? null;
  }
}
