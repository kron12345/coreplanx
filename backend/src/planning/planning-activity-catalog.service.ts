import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type {
  ActivityAttributeValue,
  ActivityCatalogSnapshot,
  ActivityCategoryDefinition,
  ActivityDefinition,
  ActivityFieldKey,
  ActivityTemplate,
  ActivityTimeMode,
  CustomAttributeDefinition,
  CustomAttributeState,
  LayerGroup,
  ResourceKind,
  TranslationState,
} from './planning.types';
import { PlanningRepository } from './planning.repository';

type ActivityCatalogDefaultsFile = {
  activities?: ActivityDefinition | ActivityDefinition[];
  activityDefinitions?: ActivityDefinition | ActivityDefinition[];
  definitions?: ActivityDefinition | ActivityDefinition[];
  templates?: ActivityTemplate | ActivityTemplate[];
  activityTemplates?: ActivityTemplate | ActivityTemplate[];
  layerGroups?: LayerGroup | LayerGroup[];
  activityCategories?:
    | ActivityCategoryDefinition
    | ActivityCategoryDefinition[];
  translations?: TranslationState;
  customAttributes?: CustomAttributeState;
};

@Injectable()
export class PlanningActivityCatalogService implements OnModuleInit {
  private readonly logger = new Logger(PlanningActivityCatalogService.name);
  private activityTemplates: ActivityTemplate[] = [];
  private activityDefinitions: ActivityDefinition[] = [];
  private activityLayerGroups: LayerGroup[] = [];
  private activityCategories: ActivityCategoryDefinition[] = [];
  private activityTranslations: TranslationState = {};
  private customAttributes: CustomAttributeState = {};
  private defaultsLoaded = false;
  private defaultCatalog: ActivityCatalogSnapshot | null = null;

  private readonly usingDatabase: boolean;

  constructor(private readonly repository: PlanningRepository) {
    this.usingDatabase = this.repository.isEnabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    await this.initializeActivityCatalogFromDatabase();
    await this.seedDefaultsIfEmpty();
  }

  getActivityCatalog(): ActivityCatalogSnapshot {
    return this.buildActivityCatalogSnapshot();
  }

  async replaceActivityCatalog(
    snapshot: ActivityCatalogSnapshot,
  ): Promise<ActivityCatalogSnapshot> {
    const normalized = this.normalizeCatalogSnapshot(snapshot);
    this.assertSystemDefinitionsPreserved(normalized.definitions);
    this.applyCatalogState(normalized);
    await this.persistActivityCatalog();
    return this.buildActivityCatalogSnapshot();
  }

  getActivityCatalogDefaults(): ActivityCatalogSnapshot {
    const defaults = this.getDefaultCatalogSnapshot();
    if (!defaults) {
      throw new NotFoundException(
        'Activity-Katalog Defaults sind nicht konfiguriert.',
      );
    }
    return defaults;
  }

  async resetActivityCatalogToDefaults(): Promise<ActivityCatalogSnapshot> {
    const defaults = this.getDefaultCatalogSnapshot();
    if (!defaults) {
      throw new BadRequestException(
        'Activity-Katalog Defaults sind nicht konfiguriert.',
      );
    }
    return this.replaceActivityCatalog(defaults);
  }

  listActivityTemplates(): ActivityTemplate[] {
    return this.activityTemplates.map((template) =>
      this.cloneActivityTemplate(template),
    );
  }

  async replaceActivityTemplates(
    payload: ActivityTemplate[],
  ): Promise<ActivityTemplate[]> {
    this.activityTemplates = (payload ?? []).map((template) =>
      this.normalizeActivityTemplate(template),
    );
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.listActivityTemplates();
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

  async replaceActivityDefinitions(
    payload: ActivityDefinition[],
  ): Promise<ActivityDefinition[]> {
    const normalized = (payload ?? []).map((definition) =>
      this.normalizeActivityDefinition(definition),
    );
    this.assertSystemDefinitionsPreserved(normalized);
    this.activityDefinitions = normalized;
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.listActivityDefinitions();
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
      const existing = this.activityDefinitions[index];
      if (
        this.isSystemDefinition(existing) &&
        !this.isSystemDefinition(normalized)
      ) {
        this.throwManagedDeleteForbidden([definitionId]);
      }
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
    const definition = this.activityDefinitions[index];
    if (this.isSystemDefinition(definition)) {
      this.throwManagedDeleteForbidden([definitionId]);
    }
    this.activityDefinitions.splice(index, 1);
    await this.persistActivityCatalog();
  }

  listActivityCategories(): ActivityCategoryDefinition[] {
    return this.activityCategories.map((category) =>
      this.cloneActivityCategory(category),
    );
  }

  async replaceActivityCategories(
    payload: ActivityCategoryDefinition[],
  ): Promise<ActivityCategoryDefinition[]> {
    this.activityCategories = (payload ?? []).map((category) =>
      this.normalizeActivityCategory(category),
    );
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.listActivityCategories();
  }

  getActivityCategory(categoryId: string): ActivityCategoryDefinition {
    const found = this.activityCategories.find(
      (category) => category.id === categoryId,
    );
    if (!found) {
      throw new NotFoundException(
        `Activity Kategorie ${categoryId} ist nicht vorhanden.`,
      );
    }
    return this.cloneActivityCategory(found);
  }

  async createActivityCategory(
    payload: ActivityCategoryDefinition,
  ): Promise<ActivityCategoryDefinition> {
    const normalized = this.normalizeActivityCategory(payload);
    if (
      this.activityCategories.some((category) => category.id === normalized.id)
    ) {
      throw new ConflictException(
        `Activity Kategorie ${normalized.id} existiert bereits.`,
      );
    }
    this.activityCategories.push(normalized);
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityCategory(normalized);
  }

  async upsertActivityCategory(
    categoryId: string,
    payload: ActivityCategoryDefinition,
  ): Promise<ActivityCategoryDefinition> {
    const normalized = this.normalizeActivityCategory(payload, categoryId);
    const index = this.activityCategories.findIndex(
      (category) => category.id === categoryId,
    );
    if (index >= 0) {
      this.activityCategories[index] = normalized;
    } else {
      this.activityCategories.push(normalized);
    }
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.cloneActivityCategory(normalized);
  }

  async deleteActivityCategory(categoryId: string): Promise<void> {
    const index = this.activityCategories.findIndex(
      (category) => category.id === categoryId,
    );
    if (index < 0) {
      throw new NotFoundException(
        `Activity Kategorie ${categoryId} ist nicht vorhanden.`,
      );
    }
    this.activityCategories.splice(index, 1);
    await this.persistActivityCatalog();
  }

  listLayerGroups(): LayerGroup[] {
    return this.activityLayerGroups.map((layer) => this.cloneLayerGroup(layer));
  }

  async replaceLayerGroups(payload: LayerGroup[]): Promise<LayerGroup[]> {
    this.activityLayerGroups = (payload ?? []).map((layer) =>
      this.normalizeLayerGroup(layer),
    );
    this.sortActivityCatalog();
    await this.persistActivityCatalog();
    return this.listLayerGroups();
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

  getCustomAttributes(): CustomAttributeState {
    return this.cloneCustomAttributeState(this.customAttributes);
  }

  async replaceCustomAttributes(
    payload: CustomAttributeState,
  ): Promise<CustomAttributeState> {
    this.customAttributes = this.normalizeCustomAttributes(payload);
    await this.persistActivityCatalog();
    return this.cloneCustomAttributeState(this.customAttributes);
  }

  private getDefaultCatalogSnapshot(): ActivityCatalogSnapshot | null {
    this.loadDefaultsOnce();
    if (!this.defaultCatalog) {
      return null;
    }
    return this.cloneActivityCatalogSnapshot(this.defaultCatalog);
  }

  private loadDefaultsOnce(): void {
    if (this.defaultsLoaded) {
      return;
    }
    this.defaultsLoaded = true;
    const defaultsLocation = this.resolveDefaultsLocation();
    if (!defaultsLocation) {
      this.logger.warn(
        'Activity-Katalog Defaults nicht gefunden; ueberspringe Seeding.',
      );
      return;
    }
    const doc = this.loadDefaultsDocument(defaultsLocation);
    if (!doc) {
      return;
    }
    this.defaultCatalog = this.materializeDefaultsSnapshot(doc);
  }

  private async seedDefaultsIfEmpty(): Promise<void> {
    if (!this.usingDatabase) {
      return;
    }
    const hasAny =
      this.activityTemplates.length > 0 ||
      this.activityDefinitions.length > 0 ||
      this.activityLayerGroups.length > 0 ||
      this.activityCategories.length > 0 ||
      Object.keys(this.activityTranslations).length > 0 ||
      Object.keys(this.customAttributes).length > 0;
    if (hasAny) {
      return;
    }
    const defaults = this.getDefaultCatalogSnapshot();
    if (!defaults) {
      return;
    }
    this.applyCatalogState(this.normalizeCatalogSnapshot(defaults));
    await this.persistActivityCatalog();
    this.logger.log('Seeded activity catalog with factory defaults.');
  }

  private async initializeActivityCatalogFromDatabase(): Promise<void> {
    try {
      const catalog = await this.repository.loadActivityCatalog();
      const normalized = this.normalizeCatalogSnapshot(catalog);
      this.applyCatalogState(normalized);
      if (!this.activityCategories.length) {
        const defaults = this.getDefaultCatalogSnapshot();
        if (defaults?.categories?.length) {
          const patched = this.normalizeCatalogSnapshot({
            ...normalized,
            categories: defaults.categories,
          });
          this.applyCatalogState(patched);
          await this.persistActivityCatalog();
        }
      }
    } catch (error) {
      this.logger.error(
        'Activity-Katalog konnte nicht aus der Datenbank geladen werden – verwende leeren Katalog.',
        (error as Error).stack ?? String(error),
      );
      this.applyCatalogState(
        this.normalizeCatalogSnapshot({
          templates: [],
          definitions: [],
          layerGroups: [],
          categories: [],
          translations: {},
          customAttributes: {},
        }),
      );
    }
  }

  private resolveDefaultsLocation(): string | null {
    const candidates = [
      join(process.cwd(), 'catalog', 'activity-catalog', 'defaults'),
      join(process.cwd(), 'backend', 'catalog', 'activity-catalog', 'defaults'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'catalog',
        'activity-catalog',
        'defaults',
      ),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'backend',
        'catalog',
        'activity-catalog',
        'defaults',
      ),
      join(process.cwd(), 'catalog', 'activity-catalog'),
      join(process.cwd(), 'backend', 'catalog', 'activity-catalog'),
      join(__dirname, '..', '..', '..', 'catalog', 'activity-catalog'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'backend',
        'catalog',
        'activity-catalog',
      ),
      join(process.cwd(), 'catalog', 'activity-catalog', 'defaults.yaml'),
      join(
        process.cwd(),
        'backend',
        'catalog',
        'activity-catalog',
        'defaults.yaml',
      ),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'catalog',
        'activity-catalog',
        'defaults.yaml',
      ),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'backend',
        'catalog',
        'activity-catalog',
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

  private loadDefaultsDocument(
    location: string,
  ): ActivityCatalogDefaultsFile | null {
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

  private loadDefaultsFromFile(
    path: string,
  ): ActivityCatalogDefaultsFile | null {
    const raw = readFileSync(path, 'utf-8');
    try {
      const parsed = path.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
      return (parsed ?? {}) as ActivityCatalogDefaultsFile;
    } catch (error) {
      this.logger.error(
        `Failed to parse activity catalog defaults file ${path}`,
        (error as Error).stack ?? String(error),
      );
      return null;
    }
  }

  private loadDefaultsFromDirectory(
    dir: string,
  ): ActivityCatalogDefaultsFile | null {
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
        `Failed to read activity catalog defaults directory ${dir}`,
        (error as Error).stack ?? String(error),
      );
      return null;
    }
    const merged: ActivityCatalogDefaultsFile = {};
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
          `Failed to parse activity catalog defaults file ${fullPath}`,
          (error as Error).stack ?? String(error),
        );
        continue;
      }
      this.deepMergeDefaults(
        merged,
        (parsed ?? {}) as ActivityCatalogDefaultsFile,
      );
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

  private materializeDefaultsSnapshot(
    doc: ActivityCatalogDefaultsFile,
  ): ActivityCatalogSnapshot {
    const definitions = [
      ...this.collectDefaultsList<ActivityDefinition>(doc.activities),
      ...this.collectDefaultsList<ActivityDefinition>(doc.activityDefinitions),
      ...this.collectDefaultsList<ActivityDefinition>(doc.definitions),
    ];
    const templates = [
      ...this.collectDefaultsList<ActivityTemplate>(doc.templates),
      ...this.collectDefaultsList<ActivityTemplate>(doc.activityTemplates),
    ];
    const layerGroups = this.collectDefaultsList<LayerGroup>(doc.layerGroups);
    const categories = this.collectDefaultsList<ActivityCategoryDefinition>(
      doc.activityCategories,
    );
    const translations = doc.translations ?? {};
    const customAttributes = doc.customAttributes ?? {};

    const snapshot: ActivityCatalogSnapshot = {
      templates,
      definitions,
      layerGroups,
      categories,
      translations,
      customAttributes,
    };

    return this.normalizeCatalogSnapshot(snapshot);
  }

  private collectDefaultsList<T>(value: T | T[] | undefined): T[] {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  private cloneActivityCatalogSnapshot(
    snapshot: ActivityCatalogSnapshot,
  ): ActivityCatalogSnapshot {
    return {
      templates: snapshot.templates.map((template) =>
        this.cloneActivityTemplate(template),
      ),
      definitions: snapshot.definitions.map((definition) =>
        this.cloneActivityDefinition(definition),
      ),
      layerGroups: snapshot.layerGroups.map((layer) =>
        this.cloneLayerGroup(layer),
      ),
      categories: snapshot.categories.map((category) =>
        this.cloneActivityCategory(category),
      ),
      translations: this.cloneTranslationState(snapshot.translations),
      customAttributes: this.cloneCustomAttributeState(
        snapshot.customAttributes,
      ),
    };
  }

  private cloneActivityTemplate(template: ActivityTemplate): ActivityTemplate {
    return {
      ...template,
      description: template.description ?? undefined,
      activityType: template.activityType ?? undefined,
      defaultDurationMinutes: template.defaultDurationMinutes ?? undefined,
      attributes: this.cloneAttributeList(template.attributes),
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
      attributes: this.cloneAttributeList(definition.attributes),
    };
  }

  private cloneLayerGroup(layer: LayerGroup): LayerGroup {
    return {
      ...layer,
      order: layer.order ?? undefined,
      description: layer.description ?? undefined,
    };
  }

  private cloneActivityCategory(
    category: ActivityCategoryDefinition,
  ): ActivityCategoryDefinition {
    return {
      ...category,
      order: category.order ?? undefined,
      icon: category.icon ?? undefined,
      description: category.description ?? undefined,
    };
  }

  private cloneAttributeList(
    attributes?: ActivityAttributeValue[],
  ): ActivityAttributeValue[] | undefined {
    if (!attributes?.length) {
      return attributes ? [] : undefined;
    }
    return attributes.map((attr) => ({
      key: attr.key,
      meta: attr.meta ? { ...attr.meta } : undefined,
    }));
  }

  private cloneTranslationState(state: TranslationState): TranslationState {
    const clone: TranslationState = {};
    Object.entries(state ?? {}).forEach(([locale, entries]) => {
      clone[locale] = { ...(entries ?? {}) };
    });
    return clone;
  }

  private cloneCustomAttributeState(
    state: CustomAttributeState,
  ): CustomAttributeState {
    const clone: CustomAttributeState = {};
    Object.entries(state ?? {}).forEach(([entityId, entries]) => {
      clone[entityId] = (entries ?? []).map((entry) => ({ ...entry }));
    });
    return clone;
  }

  private buildActivityCatalogSnapshot(): ActivityCatalogSnapshot {
    this.sortActivityCatalog();
    return {
      templates: this.activityTemplates.map((template) =>
        this.cloneActivityTemplate(template),
      ),
      definitions: this.activityDefinitions.map((definition) =>
        this.cloneActivityDefinition(definition),
      ),
      layerGroups: this.activityLayerGroups.map((layer) =>
        this.cloneLayerGroup(layer),
      ),
      categories: this.activityCategories.map((category) =>
        this.cloneActivityCategory(category),
      ),
      translations: this.cloneTranslationState(this.activityTranslations),
      customAttributes: this.cloneCustomAttributeState(this.customAttributes),
    };
  }

  private applyCatalogState(snapshot: ActivityCatalogSnapshot): void {
    this.activityTemplates = snapshot.templates.map((template) =>
      this.cloneActivityTemplate(template),
    );
    this.activityDefinitions = snapshot.definitions.map((definition) =>
      this.cloneActivityDefinition(definition),
    );
    this.activityLayerGroups = snapshot.layerGroups.map((layer) =>
      this.cloneLayerGroup(layer),
    );
    this.activityCategories = snapshot.categories.map((category) =>
      this.cloneActivityCategory(category),
    );
    this.activityTranslations = this.cloneTranslationState(
      snapshot.translations,
    );
    this.customAttributes = this.cloneCustomAttributeState(
      snapshot.customAttributes,
    );
    this.sortActivityCatalog();
  }

  private sortActivityCatalog(): void {
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
    this.activityCategories.sort((a, b) => {
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
    const categories = (snapshot.categories ?? []).map((category) =>
      this.normalizeActivityCategory(category),
    );
    const allowedCategories = new Set(
      categories.map((category) => category.id),
    );
    return {
      templates: (snapshot.templates ?? []).map((template) =>
        this.normalizeActivityTemplate(template),
      ),
      definitions: (snapshot.definitions ?? []).map((definition) =>
        this.normalizeActivityDefinition(
          definition,
          undefined,
          allowedCategories,
        ),
      ),
      layerGroups: (snapshot.layerGroups ?? []).map((layer) =>
        this.normalizeLayerGroup(layer),
      ),
      categories,
      translations: this.normalizeTranslations(snapshot.translations),
      customAttributes: this.normalizeCustomAttributes(
        snapshot.customAttributes,
      ),
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
      attributes: this.normalizeAttributeList(payload.attributes),
    };
  }

  private normalizeActivityDefinition(
    payload: ActivityDefinition,
    overrideId?: string,
    allowedCategories?: Set<string>,
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

    const normalized: ActivityDefinition = {
      id,
      label,
      description: payload.description?.trim() || undefined,
      activityType,
      templateId: payload.templateId ?? undefined,
      defaultDurationMinutes: defaultDuration,
      relevantFor: relevantFor.length ? relevantFor : undefined,
      attributes: this.normalizeAttributeList(payload.attributes),
    };
    this.assertSystemDefinitionAttributes(normalized, allowedCategories);
    return normalized;
  }

  private normalizeActivityCategory(
    payload: ActivityCategoryDefinition,
    overrideId?: string,
  ): ActivityCategoryDefinition {
    const id = this.normalizeIdentifier(
      overrideId ?? payload.id,
      'Activity Kategorie ID',
    );
    const label = this.normalizeIdentifier(
      payload.label,
      'Activity Kategorie Label',
    );
    const order = this.normalizeOptionalNumber(payload.order) ?? 50;
    return {
      id,
      label,
      order,
      icon: payload.icon?.trim() || undefined,
      description: payload.description?.trim() || undefined,
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

  private normalizeCustomAttributes(
    state?: CustomAttributeState,
  ): CustomAttributeState {
    const normalized: CustomAttributeState = {};
    const allowedTypes: CustomAttributeDefinition['type'][] = [
      'string',
      'number',
      'boolean',
      'date',
      'time',
    ];
    Object.entries(state ?? {}).forEach(([entityId, entries]) => {
      const normalizedEntityId = (entityId ?? '').trim();
      if (!normalizedEntityId) {
        return;
      }
      const seenKeys = new Set<string>();
      const normalizedEntries = (entries ?? []).map((entry) => {
        const id = this.normalizeIdentifier(entry?.id, 'Custom Attribute ID');
        const key = this.normalizeIdentifier(
          entry?.key,
          'Custom Attribute Key',
        );
        if (seenKeys.has(key)) {
          throw new BadRequestException(
            `Custom Attribute Key ${key} ist in ${normalizedEntityId} doppelt.`,
          );
        }
        seenKeys.add(key);
        const label = this.normalizeIdentifier(
          entry?.label,
          'Custom Attribute Label',
        );
        const type = entry?.type;
        if (!type || !allowedTypes.includes(type)) {
          throw new BadRequestException(
            `Custom Attribute Type ${type ?? ''} ist ungültig.`,
          );
        }
        return {
          id,
          key,
          label,
          type,
          description: entry?.description?.trim() || undefined,
          entityId: normalizedEntityId,
          createdAt: entry?.createdAt ?? undefined,
          updatedAt: entry?.updatedAt ?? undefined,
          temporal: entry?.temporal ?? false,
          required: entry?.required ?? false,
        } satisfies CustomAttributeDefinition;
      });
      normalized[normalizedEntityId] = normalizedEntries;
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
      .filter((entry) =>
        allowedSet.has(entry as ResourceKind),
      ) as ResourceKind[];
    return Array.from(new Set(cleaned));
  }

  private normalizeLocale(locale: string): string {
    const normalized = (locale ?? '').trim();
    if (!normalized) {
      throw new BadRequestException('Locale darf nicht leer sein.');
    }
    return normalized;
  }

  private normalizeAttributeList(
    attributes?: ActivityAttributeValue[] | null,
  ): ActivityAttributeValue[] {
    const list: ActivityAttributeValue[] = [];
    (attributes ?? []).forEach((attr) => {
      const key = (attr?.key ?? '').trim();
      if (!key) {
        return;
      }
      const meta =
        attr?.meta && typeof attr.meta === 'object' && !Array.isArray(attr.meta)
          ? { ...attr.meta }
          : undefined;
      list.push({ key, meta });
    });
    return list;
  }

  private readAttributeValue(
    attributes: ActivityAttributeValue[] | undefined,
    key: string,
  ): string | null {
    const entry = (attributes ?? []).find((attr) => attr.key === key);
    const meta = entry?.meta;
    if (!meta || typeof meta !== 'object') {
      return null;
    }
    const raw = meta['value'];
    if (raw === undefined || raw === null) {
      return null;
    }
    const normalized = String(raw).trim();
    return normalized.length ? normalized : null;
  }

  private readAttributeBoolean(
    attributes: ActivityAttributeValue[] | undefined,
    key: string,
  ): boolean {
    const raw = this.readAttributeValue(attributes, key);
    if (!raw) {
      return false;
    }
    const normalized = raw.trim().toLowerCase();
    return (
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'ja' ||
      normalized === '1'
    );
  }

  private readAttributeNumber(
    attributes: ActivityAttributeValue[] | undefined,
    key: string,
  ): number | null {
    const raw = this.readAttributeValue(attributes, key);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const normalized = Math.trunc(parsed);
    return normalized > 0 ? normalized : null;
  }

  private readAttributeList(
    attributes: ActivityAttributeValue[] | undefined,
    key: string,
  ): string[] {
    const raw = this.readAttributeValue(attributes, key);
    if (!raw) {
      return [];
    }
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private readAttributeFields(
    attributes: ActivityAttributeValue[] | undefined,
  ): Set<ActivityFieldKey> {
    const allowed: ActivityFieldKey[] = [
      'start',
      'end',
      'from',
      'to',
      'remark',
    ];
    const allowedSet = new Set<ActivityFieldKey>(allowed);
    const fields = new Set<ActivityFieldKey>();
    (attributes ?? []).forEach((attr) => {
      const key = (attr?.key ?? '').trim();
      if (!key.startsWith('field:')) {
        return;
      }
      const field = key.slice('field:'.length).trim();
      if (allowedSet.has(field as ActivityFieldKey)) {
        fields.add(field as ActivityFieldKey);
      }
    });
    return fields;
  }

  private isSystemDefinition(definition: ActivityDefinition): boolean {
    const attributes = definition.attributes ?? [];
    if (this.readAttributeBoolean(attributes, 'is_system')) {
      return true;
    }
    const flags = [
      'is_service_start',
      'is_service_end',
      'is_break',
      'is_short_break',
      'is_vehicle_on',
      'is_vehicle_off',
      'is_commute',
    ];
    return flags.some((key) => this.readAttributeBoolean(attributes, key));
  }

  private assertSystemDefinitionsPreserved(next: ActivityDefinition[]): void {
    const protectedIds = this.activityDefinitions
      .filter((definition) => this.isSystemDefinition(definition))
      .map((definition) => definition.id);
    if (!protectedIds.length) {
      return;
    }
    const nextMap = new Map(
      next.map((definition) => [definition.id, definition] as const),
    );
    const missing = protectedIds.filter((id) => !nextMap.has(id));
    if (missing.length) {
      this.throwManagedDeleteForbidden(missing);
    }
    const downgraded = protectedIds.filter((id) => {
      const candidate = nextMap.get(id);
      return candidate ? !this.isSystemDefinition(candidate) : false;
    });
    if (downgraded.length) {
      this.throwManagedDeleteForbidden(downgraded);
    }
  }

  private assertSystemDefinitionAttributes(
    definition: ActivityDefinition,
    allowedCategories?: Set<string>,
  ): void {
    if (!this.isSystemDefinition(definition)) {
      return;
    }
    const attributes = definition.attributes ?? [];

    const category = this.readAttributeValue(attributes, 'category');
    const timeMode = this.readAttributeValue(attributes, 'time_mode');
    const defaultDuration = this.readAttributeNumber(
      attributes,
      'default_duration',
    );
    const relevantFor = this.readAttributeList(attributes, 'relevant_for');
    const fields = this.readAttributeFields(attributes);
    const color = this.readAttributeValue(attributes, 'color');

    const allowedCategoryIds =
      allowedCategories ??
      new Set(
        this.activityCategories.map((entry) => entry.id).filter((id) => id),
      );
    const allowedTimeModes = new Set<ActivityTimeMode>([
      'duration',
      'range',
      'point',
    ]);
    const allowedRelevant = new Set<ResourceKind>([
      'personnel',
      'vehicle',
      'personnel-service',
      'vehicle-service',
    ]);

    if (
      allowedCategoryIds.size &&
      (!category || !allowedCategoryIds.has(category))
    ) {
      throw new BadRequestException(
        `System-Activity ${definition.id} benötigt ein gültiges category-Attribut.`,
      );
    }
    if (!timeMode || !allowedTimeModes.has(timeMode as ActivityTimeMode)) {
      throw new BadRequestException(
        `System-Activity ${definition.id} benötigt ein gültiges time_mode-Attribut.`,
      );
    }
    if (!defaultDuration) {
      throw new BadRequestException(
        `System-Activity ${definition.id} benötigt default_duration in Minuten.`,
      );
    }
    if (
      !relevantFor.length ||
      relevantFor.some((entry) => !allowedRelevant.has(entry as ResourceKind))
    ) {
      throw new BadRequestException(
        `System-Activity ${definition.id} benötigt ein gültiges relevant_for-Attribut.`,
      );
    }
    if (!fields.has('start')) {
      throw new BadRequestException(
        `System-Activity ${definition.id} benötigt das Feld start.`,
      );
    }
    if ((timeMode as ActivityTimeMode) !== 'point' && !fields.has('end')) {
      throw new BadRequestException(
        `System-Activity ${definition.id} benötigt das Feld end.`,
      );
    }
    if (!color) {
      throw new BadRequestException(
        `System-Activity ${definition.id} benötigt ein color-Attribut.`,
      );
    }
  }

  private throwManagedDeleteForbidden(definitionIds: string[]): never {
    throw new BadRequestException({
      message: 'Systemvorgaben dürfen nicht gelöscht werden.',
      error: 'ValidationError',
      statusCode: 400,
      violations: definitionIds.map((id) => ({
        activityId: id,
        code: 'MANAGED_DELETE_FORBIDDEN',
        message: 'Systemvorgaben dürfen nicht gelöscht werden.',
      })),
    });
  }
}
