import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ResourceKind } from '../../models/resource';
import { PlanningCatalogApiService } from '../api/planning-catalog-api.service';

export interface ActivityAttributeValue {
  key: string;
  meta?: Record<string, string>;
}

const FIELD_META: Record<string, Record<string, string>> = {
  start: { datatype: 'timepoint', oncreate: 'edit', onupdate: 'edit' },
  end: { datatype: 'timepoint', oncreate: 'edit', onupdate: 'edit' },
  from: { datatype: 'string', oncreate: 'edit', onupdate: 'edit' },
  to: { datatype: 'string', oncreate: 'edit', onupdate: 'edit' },
  remark: { datatype: 'string', oncreate: 'edit', onupdate: 'edit' },
};

export interface ActivityTemplate {
  id: string;
  label: string;
  description?: string;
  activityType?: string;
  defaultDurationMinutes?: number | null;
  attributes: ActivityAttributeValue[];
}

export interface ActivityTemplateInput {
  id: string;
  label: string;
  description?: string;
  activityType?: string;
  defaultDurationMinutes?: number | null;
  attributes?: ActivityAttributeValue[];
}

export interface ActivityDefinition {
  id: string; // activity key
  label: string;
  description?: string;
  activityType: string;
  templateId?: string | null;
  defaultDurationMinutes?: number | null;
  relevantFor?: ResourceKind[];
  attributes: ActivityAttributeValue[];
}

export interface ActivityDefinitionInput {
  id: string;
  label: string;
  description?: string;
  activityType: string;
  templateId?: string | null;
  defaultDurationMinutes?: number | null;
  relevantFor?: ResourceKind[];
  attributes?: ActivityAttributeValue[];
}

@Injectable({ providedIn: 'root' })
export class ActivityCatalogService {
  private readonly api = inject(PlanningCatalogApiService);
  private readonly definitionsSignal = signal<ActivityDefinition[]>([]);
  private readonly templatesSignal = signal<ActivityTemplate[]>([]);
  private loadingPromise: Promise<void> | null = null;

  readonly definitions: Signal<ActivityDefinition[]> = computed(() => this.definitionsSignal());
  readonly templates: Signal<ActivityTemplate[]> = computed(() => this.templatesSignal());

  constructor() {
    void this.init();
  }

  async init(): Promise<void> {
    await this.loadFromApi();
  }

  async refresh(): Promise<void> {
    await this.loadFromApi(true);
  }

  private async loadFromApi(force = false): Promise<void> {
    if (this.loadingPromise) {
      const pending = this.loadingPromise;
      await pending;
      if (!force) {
        return;
      }
    }
    this.loadingPromise = (async () => {
      try {
        const [definitions, templates] = await Promise.all([
          this.api.listDefinitions(),
          this.api.listTemplates(),
        ]);
        const normalizedDefinitions = (definitions ?? []).map((entry) =>
          this.normalizeDefinition(entry),
        );
        const normalizedTemplates = (templates ?? []).map((entry) =>
          this.normalizeTemplate(entry),
        );
        this.definitionsSignal.set(normalizedDefinitions);
        this.templatesSignal.set(normalizedTemplates);
      } catch {
        if (!this.definitionsSignal().length && !this.templatesSignal().length) {
          this.definitionsSignal.set([]);
          this.templatesSignal.set([]);
        }
      } finally {
        this.loadingPromise = null;
      }
    })();
    await this.loadingPromise;
  }

  addDefinition(input: ActivityDefinitionInput): void {
    const next = this.normalizeDefinition(input);
    this.definitionsSignal.set([...this.definitionsSignal(), next]);
    void this.persistDefinitions();
  }

  updateDefinition(id: string, patch: Partial<ActivityDefinitionInput>): void {
    this.definitionsSignal.set(
      this.definitionsSignal().map((item) => {
        if (item.id !== id) {
          return item;
        }
        return this.normalizeDefinition({ ...item, ...patch });
      }),
    );
    void this.persistDefinitions();
  }

  removeDefinition(id: string): void {
    this.definitionsSignal.set(this.definitionsSignal().filter((item) => item.id !== id));
    void this.persistDefinitions();
  }

  addTemplate(input: ActivityTemplateInput): void {
    const next = this.normalizeTemplate(input);
    this.templatesSignal.set([...this.templatesSignal(), next]);
    void this.persistTemplates();
  }

  updateTemplate(id: string, patch: Partial<ActivityTemplateInput>): void {
    this.templatesSignal.set(
      this.templatesSignal().map((item) => {
        if (item.id !== id) {
          return item;
        }
        return this.normalizeTemplate({ ...item, ...patch });
      }),
    );
    void this.persistTemplates();
  }

  removeTemplate(id: string): void {
    this.templatesSignal.set(this.templatesSignal().filter((item) => item.id !== id));
    this.definitionsSignal.set(
      this.definitionsSignal().map((def) =>
        def.templateId === id ? { ...def, templateId: null } : def,
      ),
    );
    void this.persistTemplates();
    void this.persistDefinitions();
  }

  async resetToDefaults(): Promise<void> {
    try {
      const snapshot = await this.api.resetCatalog();
      this.definitionsSignal.set(
        (snapshot.definitions ?? []).map((def) => this.normalizeDefinition(def)),
      );
      this.templatesSignal.set(
        (snapshot.templates ?? []).map((tpl) => this.normalizeTemplate(tpl)),
      );
    } catch {
      // Reset-Fehler wird ignoriert, aktueller State bleibt bestehen.
    }
  }

  private normalizeDefinition(input: ActivityDefinitionInput): ActivityDefinition {
    const id = this.slugify(input.id || input.label);
    const attributes = this.normalizeAttributes(input.attributes);
    const relevantFor = this.normalizeRelevantFor(input.relevantFor);
    return {
      id,
      label: (input.label ?? id).trim(),
      description: input.description?.trim(),
      activityType: (input.activityType ?? 'other').trim(),
      templateId: input.templateId ?? null,
      defaultDurationMinutes: this.normalizeDuration(input.defaultDurationMinutes),
      relevantFor,
      attributes,
    };
  }

  private normalizeTemplate(input: ActivityTemplateInput): ActivityTemplate {
    const id = this.slugify(input.id || input.label);
    return {
      id,
      label: (input.label ?? id).trim(),
      description: input.description?.trim(),
      activityType: input.activityType?.trim(),
      defaultDurationMinutes: this.normalizeDuration(input.defaultDurationMinutes),
      attributes: this.normalizeAttributes(input.attributes),
    };
  }

  private normalizeAttributes(attributes: ActivityAttributeValue[] | undefined | null): ActivityAttributeValue[] {
    if (!attributes || attributes.length === 0) {
      return [];
    }
    const seen = new Set<string>();
    const list: ActivityAttributeValue[] = [];
    const pushAttribute = (key: string, meta?: Record<string, string>) => {
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      let normalizedMeta = this.normalizeMeta(meta);
      if (!normalizedMeta || Object.keys(normalizedMeta).length === 0) {
        normalizedMeta = { value: '' };
      }
      list.push({ key, meta: normalizedMeta });
    };

    attributes.forEach((attr) => {
      const key = (attr.key ?? '').trim();
      if (!key) {
        return;
      }
      if (key === 'fields') {
        const raw = ((attr as any).value ?? attr.meta?.['fields'] ?? '').toString();
        raw
          .split(',')
          .map((part: string) => part.trim())
          .filter((part: string) => !!part)
          .forEach((fieldKey: string) => {
            pushAttribute(`field:${fieldKey}`, FIELD_META[fieldKey] ?? {});
          });
        return;
      }
      pushAttribute(key, this.normalizeMeta(attr.meta, (attr as any).value));
    });
    return list;
  }

  private normalizeDuration(value: number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = Math.max(1, Math.trunc(value));
    return Number.isFinite(normalized) ? normalized : null;
  }

  private async persistDefinitions(): Promise<void> {
    try {
      await this.api.replaceDefinitions(this.definitionsSignal());
    } catch {
      // API-Fehler werden ignoriert, in-memory State bleibt bestehen.
    }
  }

  private async persistTemplates(): Promise<void> {
    try {
      await this.api.replaceTemplates(this.templatesSignal());
    } catch {
      // API-Fehler werden ignoriert, in-memory State bleibt bestehen.
    }
  }

  private slugify(value: string): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private normalizeRelevantFor(values: ResourceKind[] | undefined): ResourceKind[] | undefined {
    if (!values || values.length === 0) {
      return undefined;
    }
    const allowed: ResourceKind[] = ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'];
    const list = Array.from(new Set(values)).filter((v): v is ResourceKind => allowed.includes(v));
    return list.length ? list : undefined;
  }

  private normalizeMeta(
    meta: Record<string, string> | undefined | null,
    valueOverride?: string | null | undefined,
  ): Record<string, string> | undefined {
    const normalized: Record<string, string> = {};
    if (meta && typeof meta === 'object') {
      Object.entries(meta).forEach(([mk, mv]) => {
        const mkey = (mk ?? '').trim();
        if (!mkey) {
          return;
        }
        normalized[mkey] = (mv ?? '').toString().trim();
      });
    }
    const rawValue =
      valueOverride !== undefined && valueOverride !== null ? valueOverride.toString().trim() : '';
    if (rawValue && normalized['value'] === undefined) {
      normalized['value'] = rawValue;
    }
    return Object.keys(normalized).length ? normalized : undefined;
  }
}
