import { Injectable, computed, effect, signal } from '@angular/core';
import { BusinessService, CreateBusinessPayload } from './business.service';
import {
  AutomationCondition,
  BusinessTemplate,
  BusinessTemplateAutomation,
  BusinessTemplateContext,
  BusinessAutomationExecution,
  CreateBusinessTemplatePayload,
} from '../models/business-template.model';
import {
  PhaseTemplateDefinition,
  PhaseWindowConfig,
  TTR_PHASE_TEMPLATE_DEFINITIONS,
} from '../config/ttr-phase-template.config';
import { OrderTimelineReference, OrderTtrPhase } from './order.service';
import { BusinessAssignment } from '../models/business.model';

const PHASE_AUTOMATION_STORAGE_KEY = 'business.phaseAutomation.v1';
const TEMPLATE_STORAGE_KEY = 'business.templates.store.v1';
const PHASE_WINDOW_STORAGE_KEY = 'business.phaseWindows.v1';
const CUSTOM_PHASE_STORAGE_KEY = 'business.customPhases.v1';
const PHASE_CONDITION_STORAGE_KEY = 'business.phaseConditions.v1';
const TEMPLATE_TAG_PREFIX = 'template:';

@Injectable({ providedIn: 'root' })
export class BusinessTemplateService {
  private readonly browserStorage = this.detectStorage();
  private readonly _phaseConditionOverrides = signal<Record<string, AutomationCondition[]>>(
    this.restorePhaseConditions(),
  );
  private readonly _phaseWindowOverrides = signal<Record<
    string,
    { window: PhaseWindowConfig; timelineReference?: OrderTimelineReference | 'fpYear' }
  >>(
    this.restorePhaseWindows(),
  );
  private readonly _customPhases = signal<PhaseTemplateDefinition[]>(this.restoreCustomPhases());
  private readonly _templates = signal<BusinessTemplate[]>(this.restoreTemplates());
  private readonly _phaseAutomation = signal<Record<string, boolean>>(
    this.restorePhaseAutomation(),
  );
  private readonly _executions = signal<BusinessAutomationExecution[]>([]);

  readonly templates = computed(() => this._templates());
  readonly automationRules = computed(() => this.buildAutomationRules());
  readonly phaseTemplates = computed(() => this.buildPhaseTemplateView());
  readonly automationExecutions = computed(() => this._executions());

  constructor(private readonly businessService: BusinessService) {
    effect(() => {
      const state = this._phaseAutomation();
      this.persistPhaseAutomation(state);
    });
    effect(() => {
      const templates = this._templates();
      this.persistTemplates(templates);
    });
    effect(() => {
      const windows = this._phaseWindowOverrides();
      this.persistPhaseWindows(windows);
    });
    effect(() => {
      const custom = this._customPhases();
      this.persistCustomPhases(custom);
    });
    effect(() => {
      const conditions = this._phaseConditionOverrides();
      this.persistPhaseConditions(conditions);
    });
  }

  getTemplateById(id: string): BusinessTemplate | undefined {
    return this._templates().find((tpl) => tpl.id === id);
  }

  definitionForPhase(phase: OrderTtrPhase): PhaseTemplateDefinition | undefined {
    return this.getPhaseDefinitions().find((entry) => entry.sourcePhase === phase);
  }

  templateTag(templateId: string): string {
    return `${TEMPLATE_TAG_PREFIX}${templateId}`;
  }

  phaseTag(phaseId: string): string {
    return `phase:${phaseId}`;
  }

  phaseBucketTag(phaseId: string, bucket: string): string {
    return `phase-bucket:${phaseId}:${bucket}`;
  }

  isPhaseAutomationEnabled(phaseId: string): boolean {
    const state = this._phaseAutomation();
    const current = state[phaseId];
    if (typeof current === 'boolean') {
      return current;
    }
    const defaults = this.defaultPhaseAutomation();
    return defaults[phaseId] ?? false;
  }

  setPhaseAutomation(phaseId: string, enabled: boolean): void {
    this._phaseAutomation.update((state) => ({ ...state, [phaseId]: enabled }));
  }

  recommendationsForContext(context: BusinessTemplateContext): BusinessTemplate[] {
    const tags = context.tags ?? [];
    const templates = this._templates();
    if (!tags.length) {
      return templates.slice(0, 5);
    }
    return templates
      .filter((template) => tags.some((tag) => template.tags?.includes(tag)))
      .slice(0, 5);
  }

  instantiateTemplate(templateId: string, context: BusinessTemplateContext = {}) {
    const template = this.getTemplateById(templateId);
    if (!template) {
      throw new Error('Vorlage nicht gefunden.');
    }
    const anchor = context.targetDate ?? new Date();
    const dueDate = this.applyOffset(anchor, template.dueRule.offsetDays);
    const description = this.composeDescription(template.description, context.note);
    const tags = new Set<string>(template.tags ?? []);
    if (context.tags?.length) {
      context.tags.forEach((tag) => tags.add(tag));
    }
    tags.add(this.templateTag(templateId));

    const payload: CreateBusinessPayload = {
      title: context.customTitle?.trim().length ? context.customTitle.trim() : template.title,
      description,
      dueDate,
      assignment: template.recommendedAssignment,
      tags: Array.from(tags),
      linkedOrderItemIds: context.linkedOrderItemIds,
    };

    return this.businessService.createBusiness(payload);
  }

  createTemplate(payload: CreateBusinessTemplatePayload) {
    const template: BusinessTemplate = {
      id: this.generateTemplateId(),
      title: payload.title,
      description: payload.description,
      instructions: payload.instructions,
      tags: this.normalizeTags(payload.tags ?? []),
      category: payload.category ?? 'Custom',
      recommendedAssignment: payload.assignment,
      dueRule: {
        ...payload.dueRule,
        label:
          payload.dueRule.label ??
          this.formatOffsetLabel(payload.dueRule.anchor, payload.dueRule.offsetDays),
      },
      defaultLeadTimeDays: payload.defaultLeadTimeDays,
      automationHint: payload.automationHint,
      steps: payload.steps,
      parameterHints: payload.parameterHints,
    };
    this._templates.update((entries) => [template, ...entries]);
    return template;
  }

  updateTemplate(
    templateId: string,
    patch: Partial<
      Pick<
        BusinessTemplate,
        'title' | 'description' | 'instructions' | 'recommendedAssignment' | 'tags'
      >
    >,
  ) {
    let hasChanges = false;
    this._templates.update((templates) =>
      templates.map((template) => {
        if (template.id !== templateId) {
          return template;
        }
        hasChanges = true;
        const nextAssignment = patch.recommendedAssignment
          ? { ...template.recommendedAssignment, ...patch.recommendedAssignment }
          : template.recommendedAssignment;
        return {
          ...template,
          title: patch.title ?? template.title,
          description: patch.description ?? template.description,
          instructions: patch.instructions ?? template.instructions,
          recommendedAssignment: nextAssignment,
          tags: patch.tags ? this.normalizeTags(patch.tags) : template.tags,
        };
      }),
    );
    return hasChanges;
  }

  createCustomPhaseTemplate(payload: {
    label: string;
    summary: string;
    timelineReference: OrderTimelineReference | 'fpYear';
    window: PhaseWindowConfig;
    autoCreate?: boolean;
    template: CreateBusinessTemplatePayload;
    conditions?: AutomationCondition[];
  }): PhaseTemplateDefinition {
    const template = this.createTemplate(payload.template);
    const baseId = this.slugify(payload.label);
    const uniqueId = this.ensureUniquePhaseId(baseId);
    const conditions = this.normalizeConditions(payload.conditions ?? []);
    const definition: PhaseTemplateDefinition = {
      id: uniqueId,
      label: payload.label.trim(),
      summary: payload.summary.trim(),
      timelineReference: payload.timelineReference,
      autoCreate: payload.autoCreate ?? false,
      window: payload.window,
      template,
      conditions,
    };
    this._customPhases.update((phases) => [...phases, definition]);
    return definition;
  }

  deleteCustomPhaseTemplate(phaseId: string): void {
    const current = this._customPhases();
    const target = current.find((entry) => entry.id === phaseId);
    if (!target) {
      return;
    }
    this._customPhases.update((phases) => phases.filter((entry) => entry.id !== phaseId));
    this._phaseWindowOverrides.update((overrides) => {
      if (!(phaseId in overrides)) {
        return overrides;
      }
      const next = { ...overrides };
      delete next[phaseId];
      return next;
    });
    this._phaseConditionOverrides.update((conditions) => {
      if (!(phaseId in conditions)) {
        return conditions;
      }
      const next = { ...conditions };
      delete next[phaseId];
      return next;
    });
    this._phaseAutomation.update((state) => {
      if (!(phaseId in state)) {
        return state;
      }
      const next = { ...state };
      delete next[phaseId];
      return next;
    });
    this.removeTemplate(target.template.id);
  }

  triggerAutomationsForTemplate(
    templateId: string,
    businessId: string,
    options?: { automationIds?: string[]; linkedOrderItemIds?: string[] },
  ): void {
    const allowedIds = options?.automationIds?.length ? new Set(options.automationIds) : null;
    const rules = this.automationRules().filter(
      (rule) => rule.templateId === templateId && rule.active && (!allowedIds || allowedIds.has(rule.id)),
    );
    if (!rules.length) {
      return;
    }
    const timestamp = new Date().toISOString();
    rules.forEach((rule) => {
      this.logAutomationExecution({
        id: this.generateExecutionId(),
        ruleId: rule.id,
        templateId: rule.templateId,
        status: 'success',
        timestamp,
        message: this.composeAutomationMessage(rule, businessId, options?.linkedOrderItemIds),
      });
    });
  }

  logAutomationRun(
    ruleId: string,
    templateId: string,
    status: BusinessAutomationExecution['status'],
    message: string,
  ): void {
    this.logAutomationExecution({
      id: this.generateExecutionId(),
      ruleId,
      templateId,
      status,
      timestamp: new Date().toISOString(),
      message,
    });
  }

  private buildConfigTemplates(): BusinessTemplate[] {
    return TTR_PHASE_TEMPLATE_DEFINITIONS.map((definition) => ({
      ...definition.template,
      tags: definition.template.tags ?? [],
    }));
  }

  private restoreTemplates(): BusinessTemplate[] {
    const base = this.buildConfigTemplates();
    if (!this.browserStorage) {
      return base;
    }
    try {
      const raw = this.browserStorage.getItem(TEMPLATE_STORAGE_KEY);
      if (!raw) {
        return base;
      }
      const parsed = JSON.parse(raw) as BusinessTemplate[];
      const map = new Map<string, BusinessTemplate>();
      base.forEach((tpl) => map.set(tpl.id, tpl));
      parsed.forEach((tpl) => map.set(tpl.id, tpl));
      return Array.from(map.values());
    } catch {
      return base;
    }
  }

  private getPhaseDefinitions(): PhaseTemplateDefinition[] {
    const windowOverrides = this._phaseWindowOverrides();
    const conditionOverrides = this._phaseConditionOverrides();
    const merged = [...TTR_PHASE_TEMPLATE_DEFINITIONS, ...this._customPhases()];
    return merged.map((definition) => {
      const override = windowOverrides[definition.id];
      const conditionOverride = conditionOverrides[definition.id];
      const conditions = conditionOverride ?? definition.conditions ?? [];
      const normalizedConditions = conditions.map((condition) => ({ ...condition }));
      return {
        ...definition,
        timelineReference: override?.timelineReference ?? definition.timelineReference,
        window: override?.window ?? definition.window,
        conditions: normalizedConditions,
      };
    });
  }

  private buildAutomationRules(): BusinessTemplateAutomation[] {
    const state = this._phaseAutomation();
    return this.getPhaseDefinitions().map((definition) => ({
      id: `phase-${definition.id}`,
      templateId: definition.template.id,
      title: `${definition.label} Automatisierung`,
      trigger: `${definition.label} erreicht`,
      condition: definition.summary,
      leadTimeDays: Math.abs(definition.template.dueRule.offsetDays),
      nextRun: undefined,
      active: definition.sourcePhase
        ? state[definition.sourcePhase] ?? definition.autoCreate
        : definition.autoCreate,
      nextTemplateId: undefined,
      testMode: false,
    }));
  }

  private buildPhaseTemplateView() {
    const templates = this._templates();
    const automations = this._phaseAutomation();
    return this.getPhaseDefinitions().map((definition) => {
      const template = templates.find((tpl) => tpl.id === definition.template.id) ?? definition.template;
      const sourcePhase = definition.sourcePhase ?? null;
      const toggleKey = sourcePhase ?? definition.id;
      const autoEnabled = this.isPhaseAutomationEnabled(toggleKey);
      return {
        id: definition.id,
        label: definition.label,
        summary: definition.summary,
        template,
        window: definition.window,
        timelineReference: definition.timelineReference,
        autoEnabled,
        canToggle: true,
        sourcePhase,
        toggleKey,
        isCustom: !sourcePhase,
        conditions: definition.conditions ?? [],
      };
    });
  }

  phaseAutomationDefinitions(): PhaseTemplateDefinition[] {
    return this.getPhaseDefinitions();
  }

  updatePhaseWindow(
    phaseId: string,
    override: { window: PhaseWindowConfig; timelineReference?: OrderTimelineReference | 'fpYear' },
  ): void {
    this._phaseWindowOverrides.update((current) => ({
      ...current,
      [phaseId]: { window: { ...override.window }, timelineReference: override.timelineReference },
    }));
  }

  updatePhaseConditions(phaseId: string, conditions: AutomationCondition[]): void {
    const normalized = this.normalizeConditions(conditions);
    if (this.isCustomPhase(phaseId)) {
      this._customPhases.update((phases) =>
        phases.map((phase) =>
          phase.id === phaseId
            ? {
                ...phase,
                conditions: normalized,
              }
            : phase,
        ),
      );
      this._phaseConditionOverrides.update((current) => {
        if (!current[phaseId]) {
          return current;
        }
        const next = { ...current };
        delete next[phaseId];
        return next;
      });
      return;
    }
    this._phaseConditionOverrides.update((current) => ({
      ...current,
      [phaseId]: normalized,
    }));
  }

  phaseConditionsFor(phaseId: string): AutomationCondition[] {
    return this.getPhaseDefinitions().find((entry) => entry.id === phaseId)?.conditions ?? [];
  }

  private applyOffset(anchor: Date, offset: number): Date {
    const result = new Date(anchor);
    result.setDate(result.getDate() + offset);
    return result;
  }

  private composeDescription(base: string, note?: string) {
    if (!note?.trim()) {
      return base;
    }
    return `${base}\n\nHinweis: ${note.trim()}`;
  }

  private detectStorage(): Storage | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return null;
      }
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private restorePhaseAutomation(): Record<string, boolean> {
    const defaults = this.defaultPhaseAutomation();
    if (!this.browserStorage) {
      return defaults;
    }
    try {
      const raw = this.browserStorage.getItem(PHASE_AUTOMATION_STORAGE_KEY);
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      return {
        ...defaults,
        ...parsed,
      };
    } catch {
      return defaults;
    }
  }

  private persistPhaseAutomation(state: Record<string, boolean>) {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(PHASE_AUTOMATION_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  private defaultPhaseAutomation(): Record<string, boolean> {
    const defaults: Record<string, boolean> = {};
    this.getPhaseDefinitions().forEach((definition) => {
      const key = definition.sourcePhase ?? definition.id;
      defaults[key] = definition.autoCreate;
    });
    return defaults;
  }

  private logAutomationExecution(execution: BusinessAutomationExecution) {
    this._executions.update((entries) => [execution, ...entries].slice(0, 50));
  }

  private persistTemplates(templates: BusinessTemplate[]) {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    } catch {
      // ignore persistence errors
    }
  }

  private restorePhaseWindows(): Record<
    string,
    { window: PhaseWindowConfig; timelineReference?: OrderTimelineReference | 'fpYear' }
  > {
    if (!this.browserStorage) {
      return {};
    }
    try {
      const raw = this.browserStorage.getItem(PHASE_WINDOW_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<
        string,
        { window: PhaseWindowConfig; timelineReference?: OrderTimelineReference | 'fpYear' }
      >;
      return parsed ?? {};
    } catch {
      return {};
    }
  }

  private persistPhaseWindows(
    overrides: Record<
      string,
      { window: PhaseWindowConfig; timelineReference?: OrderTimelineReference | 'fpYear' }
    >,
  ): void {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(PHASE_WINDOW_STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // ignore
    }
  }

  private restorePhaseConditions(): Record<string, AutomationCondition[]> {
    if (!this.browserStorage) {
      return {};
    }
    try {
      const raw = this.browserStorage.getItem(PHASE_CONDITION_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, AutomationCondition[]>;
      return parsed ?? {};
    } catch {
      return {};
    }
  }

  private persistPhaseConditions(overrides: Record<string, AutomationCondition[]>): void {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(PHASE_CONDITION_STORAGE_KEY, JSON.stringify(overrides));
    } catch {
      // ignore
    }
  }

  private composeAutomationMessage(
    rule: BusinessTemplateAutomation,
    businessId: string,
    linkedItems: string[] | undefined,
  ): string {
    const parts = [`Regel "${rule.title}" für Geschäft ${businessId} ausgeführt`];
    if (linkedItems?.length) {
      parts.push(`Positionen: ${linkedItems.join(', ')}`);
    }
    return parts.join(' · ');
  }

  private formatOffsetLabel(
    anchor: BusinessTemplate['dueRule']['anchor'],
    offsetDays: number,
  ): string {
    const abs = Math.abs(offsetDays);
    const direction = offsetDays < 0 ? 'vor' : 'nach';
    const anchorLabel =
      anchor === 'order_creation'
        ? 'Auftragserstellung'
        : anchor === 'go_live'
          ? 'Go-Live'
          : 'Produktion';
    return `${abs} Tage ${direction} ${anchorLabel}`;
  }

  private generateTemplateId(): string {
    return `tpl-${Math.random().toString(36).slice(2, 8)}`;
  }

  private generateExecutionId(): string {
    return `exec-${Math.random().toString(36).slice(2, 10)}`;
  }

  private generateConditionId(): string {
    return `cond-${Math.random().toString(36).slice(2, 10)}`;
  }

  private normalizeTags(tags: string[]): string[] {
    const cleaned = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
    return Array.from(new Set(cleaned));
  }

  private normalizeConditions(conditions?: AutomationCondition[]): AutomationCondition[] {
    if (!conditions?.length) {
      return [];
    }
    return conditions
      .map((condition) => ({
        ...condition,
        id: condition.id ?? this.generateConditionId(),
        value: condition.value?.trim() ?? '',
      }))
      .filter((condition) => condition.value.length);
  }

  private removeTemplate(templateId: string): void {
    this._templates.update((templates) => templates.filter((template) => template.id !== templateId));
  }

  private ensureUniquePhaseId(baseId: string): string {
    const existing = new Set(this.getPhaseDefinitions().map((definition) => definition.id));
    if (!existing.has(baseId)) {
      return baseId;
    }
    let counter = 1;
    let candidate = `${baseId}-${counter}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `${baseId}-${counter}`;
    }
    return candidate;
  }

  private slugify(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return normalized || `phase-${Date.now().toString(36)}`;
  }

  private restoreCustomPhases(): PhaseTemplateDefinition[] {
    if (!this.browserStorage) {
      return [];
    }
    try {
      const raw = this.browserStorage.getItem(CUSTOM_PHASE_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as PhaseTemplateDefinition[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persistCustomPhases(phases: PhaseTemplateDefinition[]) {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(CUSTOM_PHASE_STORAGE_KEY, JSON.stringify(phases));
    } catch {
      // ignore
    }
  }

  private isCustomPhase(phaseId: string): boolean {
    return this._customPhases().some((phase) => phase.id === phaseId);
  }
}
