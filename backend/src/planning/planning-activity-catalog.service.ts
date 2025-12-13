import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type {
  ActivityAttributes,
  ActivityCatalogSnapshot,
  ActivityDefinition,
  ActivityFieldKey,
  ActivityTemplate,
  ActivityTypeDefinition,
  LayerGroup,
  ResourceKind,
  TranslationState,
} from './planning.types';
import { PlanningRepository } from './planning.repository';

@Injectable()
export class PlanningActivityCatalogService implements OnModuleInit {
  private readonly logger = new Logger(PlanningActivityCatalogService.name);
  private activityTypes: ActivityTypeDefinition[] = [];
  private activityTemplates: ActivityTemplate[] = [];
  private activityDefinitions: ActivityDefinition[] = [];
  private activityLayerGroups: LayerGroup[] = [];
  private activityTranslations: TranslationState = {};

  private readonly usingDatabase: boolean;

  constructor(private readonly repository: PlanningRepository) {
    this.usingDatabase = this.repository.isEnabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    await this.initializeActivityCatalogFromDatabase();
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
      throw new NotFoundException(`Activity Type ${typeId} ist nicht vorhanden.`);
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
      throw new NotFoundException(`Activity Type ${typeId} ist nicht vorhanden.`);
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
    const found = this.activityLayerGroups.find((layer) => layer.id === layerId);
    if (!found) {
      throw new NotFoundException(`Layer-Gruppe ${layerId} ist nicht vorhanden.`);
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

  async upsertLayerGroup(layerId: string, payload: LayerGroup): Promise<LayerGroup> {
    const normalized = this.normalizeLayerGroup(payload, layerId);
    const index = this.activityLayerGroups.findIndex((layer) => layer.id === layerId);
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
    const index = this.activityLayerGroups.findIndex((layer) => layer.id === layerId);
    if (index < 0) {
      throw new NotFoundException(`Layer-Gruppe ${layerId} ist nicht vorhanden.`);
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

  private cloneActivityType(type: ActivityTypeDefinition): ActivityTypeDefinition {
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

  private cloneActivityDefinition(definition: ActivityDefinition): ActivityDefinition {
    return {
      ...definition,
      description: definition.description ?? undefined,
      templateId: definition.templateId ?? undefined,
      defaultDurationMinutes: definition.defaultDurationMinutes ?? undefined,
      relevantFor: definition.relevantFor ? [...definition.relevantFor] : undefined,
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
    this.activityTypes = snapshot.types.map((type) => this.cloneActivityType(type));
    this.activityTemplates = snapshot.templates.map((template) =>
      this.cloneActivityTemplate(template),
    );
    this.activityDefinitions = snapshot.definitions.map((definition) =>
      this.cloneActivityDefinition(definition),
    );
    this.activityLayerGroups = snapshot.layerGroups.map((layer) =>
      this.cloneLayerGroup(layer),
    );
    this.activityTranslations = this.cloneTranslationState(snapshot.translations);
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
    await this.repository.replaceActivityCatalog(this.buildActivityCatalogSnapshot());
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
    const defaultDuration = this.normalizeOptionalNumber(payload.defaultDurationMinutes);
    if (defaultDuration === undefined) {
      throw new BadRequestException('Activity Type defaultDurationMinutes muss gesetzt sein.');
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
    const defaultDuration = this.normalizeOptionalNumber(payload.defaultDurationMinutes);
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
    const defaultDuration = this.normalizeOptionalNumber(payload.defaultDurationMinutes);
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

  private normalizeLayerGroup(payload: LayerGroup, overrideId?: string): LayerGroup {
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

  private normalizeTranslations(translations?: TranslationState): TranslationState {
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
          throw new BadRequestException('Translation-Key darf nicht leer sein.');
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

  private normalizeIdentifier(value: string | undefined, context: string): string {
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

  private normalizeResourceKinds(values?: (string | ResourceKind)[]): ResourceKind[] {
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

  private normalizeActivityFields(values?: (string | ActivityFieldKey)[]): ActivityFieldKey[] {
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

  private applyActivityAttributeDefaults(attributes?: ActivityAttributes): ActivityAttributes {
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
}

