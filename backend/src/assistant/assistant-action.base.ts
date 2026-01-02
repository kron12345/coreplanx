import { Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import type { AssistantConfig } from './assistant.config';
import type { AssistantDocumentationService } from './assistant.documentation.service';
import type { AssistantActionPreviewStore } from './assistant-action-preview.store';
import type { AssistantActionClarificationStore } from './assistant-action-clarification.store';
import type { AssistantActionAuditService } from './assistant-action-audit.service';
import type { AssistantActionClarificationApply } from './assistant-action-clarification.store';
import type {
  AssistantActionCommitTask,
  AssistantActionRefreshHint,
  AssistantActionTopologyScope,
} from './assistant-action.types';
import type {
  ActionApplyClarificationOutcome,
  ActionApplyFeedbackOutcome,
  ActionContext,
  ActionPayload,
  ActionTopologyState,
  ClarificationRequest,
} from './assistant-action.engine.types';
import type { AssistantActionPreviewResponseDto, AssistantUiContextDto } from './assistant.dto';
import type {
  HomeDepot,
  OperationalPoint,
  OpReplacementStopLink,
  PersonnelPool,
  PersonnelServicePool,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  ResourceSnapshot,
  SectionOfLine,
  TransferEdge,
  VehiclePool,
  VehicleServicePool,
  VehicleType,
} from '../planning/planning.types';
import type { PlanningService } from '../planning/planning.service';
import type { TimetableYearService } from '../variants/timetable-year.service';
import type { OllamaOpenAiClient } from './ollama-openai.client';
import { applyMessageBudget, buildUiContextMessage } from './assistant-context-budget';

export class AssistantActionBase {
  protected readonly logger: Logger;
  protected readonly config: AssistantConfig;
  protected readonly docs: AssistantDocumentationService;
  protected readonly planning: PlanningService;
  protected readonly timetableYears: TimetableYearService;
  protected readonly ollama: OllamaOpenAiClient;
  protected readonly previews: AssistantActionPreviewStore;
  protected readonly clarifications: AssistantActionClarificationStore;
  protected readonly audit: AssistantActionAuditService;

  constructor(options: {
    logger: Logger;
    config: AssistantConfig;
    docs: AssistantDocumentationService;
    planning: PlanningService;
    timetableYears: TimetableYearService;
    ollama: OllamaOpenAiClient;
    previews: AssistantActionPreviewStore;
    clarifications: AssistantActionClarificationStore;
    audit: AssistantActionAuditService;
  }) {
    this.logger = options.logger;
    this.config = options.config;
    this.docs = options.docs;
    this.planning = options.planning;
    this.timetableYears = options.timetableYears;
    this.ollama = options.ollama;
    this.previews = options.previews;
    this.clarifications = options.clarifications;
    this.audit = options.audit;
  }

  protected buildFeedbackResponse(message: string): ActionApplyFeedbackOutcome {
    return {
      type: 'feedback',
      response: {
        actionable: false,
        feedback: message,
      },
    };
  }

  protected buildClarificationResponse(
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
      input: clarification.input,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const response: AssistantActionPreviewResponseDto = {
      actionable: false,
      clarification: {
        resolutionId,
        title: clarification.title,
        options: clarification.options,
        input: clarification.input,
      },
    };
    return { type: 'clarification', response };
  }

  protected applyResolution(
    payload: Record<string, unknown>,
    apply: AssistantActionClarificationApply,
    selectedId: string,
  ): void {
    const value = apply.mode === 'target' ? { id: selectedId } : selectedId;
    this.setValueAtPath(payload, apply.path, value);
  }

  protected clonePayload<T>(payload: T): T {
    return JSON.parse(JSON.stringify(payload)) as T;
  }

  protected cloneList<T>(items: T[]): T[] {
    return items.map((item) => this.clonePayload(item));
  }

  protected buildTopologyState(): ActionTopologyState {
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

  protected hashSnapshot(snapshot: ResourceSnapshot): string {
    return createHash('sha256').update(this.stableStringify(snapshot)).digest('hex');
  }

  protected stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${this.stableStringify(entry)}`);
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
  }

  protected setValueAtPath(
    payload: Record<string, unknown>,
    path: Array<string | number>,
    value: unknown,
  ): void {
    let cursor: Record<string, unknown> | unknown[] = payload;
    for (let i = 0; i < path.length; i += 1) {
      const segment = path[i];
      if (i === path.length - 1) {
        if (Array.isArray(cursor) && typeof segment === 'number') {
          cursor[segment] = value;
          return;
        }
        if (!Array.isArray(cursor) && typeof segment === 'string') {
          (cursor as Record<string, unknown>)[segment] = value;
          return;
        }
        return;
      }

      const nextSegment = path[i + 1];
      if (Array.isArray(cursor) && typeof segment === 'number') {
        if (!cursor[segment]) {
          cursor[segment] = typeof nextSegment === 'number' ? [] : {};
        }
        cursor = cursor[segment] as Record<string, unknown> | unknown[];
        continue;
      }
      if (!Array.isArray(cursor) && typeof segment === 'string') {
        const record = cursor as Record<string, unknown>;
        if (!record[segment]) {
          record[segment] = typeof nextSegment === 'number' ? [] : {};
        }
        cursor = record[segment] as Record<string, unknown> | unknown[];
      }
    }
  }

  protected formatBatchSummary(summaries: string[]): string {
    if (!summaries.length) {
      return 'Batch (0 Aktionen)';
    }
    const listed = summaries.slice(0, 3).join('; ');
    const suffix = summaries.length > 3 ? ' ...' : '';
    return `Batch (${summaries.length} Aktionen): ${listed}${suffix}`;
  }

  protected mergeCommitTasks(
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
      if (
        task.type === 'activityTypes' ||
        task.type === 'activityTemplates' ||
        task.type === 'activityDefinitions' ||
        task.type === 'layerGroups' ||
        task.type === 'customAttributes'
      ) {
        const index = next.findIndex((existing) => existing.type === task.type);
        if (index >= 0) {
          next[index] = task;
        } else {
          next.push(task);
        }
        continue;
      }
      if (task.type === 'translations') {
        const index = next.findIndex(
          (existing) => existing.type === 'translations' && existing.locale === task.locale,
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

  protected mergeRefreshHints(
    base: AssistantActionRefreshHint[],
    incoming: AssistantActionRefreshHint[],
  ): AssistantActionRefreshHint[] {
    const next = new Set(base);
    for (const hint of incoming) {
      next.add(hint);
    }
    return Array.from(next);
  }

  protected collectRefreshHints(
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
      if (task.type === 'activityTypes') {
        hints.add('activity-types');
      }
      if (task.type === 'activityTemplates') {
        hints.add('activity-templates');
      }
      if (task.type === 'activityDefinitions') {
        hints.add('activity-definitions');
      }
      if (task.type === 'layerGroups') {
        hints.add('layer-groups');
      }
      if (task.type === 'translations') {
        hints.add('translations');
      }
      if (task.type === 'customAttributes') {
        hints.add('custom-attributes');
      }
    }
    return Array.from(hints);
  }

  protected findDuplicateNames(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const value of values) {
      const normalized = this.normalizeKey(value);
      if (seen.has(normalized)) {
        duplicates.push(value);
      } else {
        seen.add(normalized);
      }
    }
    return duplicates;
  }

  protected buildContextMessages(
    uiContext?: AssistantUiContextDto,
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

  protected buildDocMessages(
    uiContext: AssistantUiContextDto | undefined,
    maxChars: number,
  ): Array<{ role: 'system'; content: string }> {
    if (this.config.docInjectionMode === 'never' || maxChars <= 0) {
      return [];
    }
    const docBudget = Math.min(maxChars, this.config.maxDocChars);
    return this.docs.buildDocumentationMessages(uiContext, { maxChars: docBudget });
  }

  protected buildUiContextMessages(
    uiContext?: AssistantUiContextDto,
  ): Array<{ role: 'system'; content: string }> {
    const content = buildUiContextMessage(uiContext, { maxDataChars: this.config.maxUiDataChars });
    if (!content) {
      return [];
    }
    return [{ role: 'system', content }];
  }

  protected countMessageChars(messages: Array<{ role: 'system'; content: string }>): number {
    return messages.reduce((total, message) => total + message.content.length, 0);
  }

  protected sanitizeUiContext(value?: AssistantUiContextDto): AssistantUiContextDto | undefined {
    if (!value) {
      return value;
    }
    const breadcrumbs = (value.breadcrumbs ?? [])
      .map((entry) => this.sanitizeUiText(entry))
      .filter((entry) => entry.length > 0)
      .slice(0, 20);
    const route = this.sanitizeUiText(value.route ?? '');
    const docKey = this.sanitizeUiText(value.docKey ?? '');
    const docSubtopic = this.sanitizeUiText(value.docSubtopic ?? '');
    const dataSummary = this.sanitizeUiText(value.dataSummary ?? '');
    return {
      ...(breadcrumbs.length ? { breadcrumbs } : {}),
      ...(route ? { route } : {}),
      ...(docKey ? { docKey } : {}),
      ...(docSubtopic ? { docSubtopic } : {}),
      ...(dataSummary ? { dataSummary } : {}),
    };
  }

  protected cleanText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  protected sanitizeUiText(value: string): string {
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

  protected parseBoolean(value: unknown): boolean | undefined {
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

  protected parseNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  protected parseSchemaVersion(value: unknown): number | null {
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

  protected parseStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value.map((entry) => this.cleanText(entry)).filter(Boolean) as string[];
    }
    if (typeof value === 'string') {
      const parsed = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return parsed.length ? parsed : undefined;
    }
    return undefined;
  }

  protected asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  protected asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  protected hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
  }

  protected hasAnyKey(record: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((key) => this.hasOwn(record, key));
  }

  protected normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  protected extractFirstText(
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

  protected extractReference(
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

  protected parsePoolReference(value: unknown): string | undefined {
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

  protected hasNameCollision<T extends { id: string; name?: string }>(
    list: T[],
    name: string,
    excludeId?: string,
  ): boolean {
    const normalized = this.normalizeKey(name);
    return list.some(
      (entry) =>
        entry.id !== excludeId &&
        this.normalizeKey(entry.name ?? '') === normalized,
    );
  }

  protected resolveTargetRecord(
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

  protected findByIdOrName<T extends { id: string; name?: string }>(
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

  protected resolvePoolIdByReference(
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
    const matches = pools.filter((pool) => this.normalizeKey(pool.name) === normalized);
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

  protected resolveHomeDepotIdByReference(
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
    const matches = depots.filter((depot) => this.normalizeKey(depot.name) === normalized);
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

  protected resolveVehicleTypeIdByReference(
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
    const matches = types.filter((entry) => this.normalizeKey(entry.label) === normalized);
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

  protected extractTimetableYearLabel(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : undefined;
    }
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    return (
      this.cleanText(record['label']) ??
      this.cleanText(record['timetableYearLabel']) ??
      this.cleanText(record['name'])
    );
  }

  protected ensureTopologyState(context: ActionContext): ActionTopologyState {
    if (!context.topologyState) {
      context.topologyState = this.buildTopologyState();
    }
    return context.topologyState;
  }

  protected buildTopologyCommitTasksForState(
    scopes: AssistantActionTopologyScope[],
    state: ActionTopologyState,
  ): AssistantActionCommitTask[] {
    const uniqueScopes = Array.from(new Set(scopes));
    return uniqueScopes.map((scope) => this.buildTopologyCommitTask(scope, state));
  }

  protected buildTopologyCommitTask(
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

  protected describeCandidates(values: string[]): string {
    if (values.length === 1) {
      return `Verfuegbar: ${values[0]}.`;
    }
    if (values.length === 2) {
      return `Verfuegbar: ${values[0]} oder ${values[1]}.`;
    }
    const listed = values.slice(0, 3).join(', ');
    const suffix = values.length > 3 ? ', ...' : '';
    return `Verfuegbar: ${listed}${suffix}.`;
  }

  protected generateId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }
}
