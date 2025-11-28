import { Injectable, Signal, computed, signal, inject } from '@angular/core';
import { ActivityTypeDefinition, ActivityTypeService } from './activity-type.service';
import { ResourceKind } from '../../models/resource';

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

const STORAGE_KEY = 'activity-catalog.v1';

interface PersistedCatalog {
  definitions: ActivityDefinition[];
  templates: ActivityTemplate[];
}

const DEFAULT_TEMPLATES: ActivityTemplate[] = [
  {
    id: 'pause-30-template',
    label: 'Pause 30 min',
    description: 'Standardpause mit 30 Minuten',
    activityType: 'break',
    defaultDurationMinutes: 30,
    attributes: [
      { key: 'category', meta: { value: 'pause' } },
      { key: 'is_break', meta: { value: 'true' } },
      { key: 'is_short_break', meta: { value: 'true' } },
      { key: 'consider_capacity_conflicts', meta: { value: 'true' } },
    ],
  },
  {
    id: 'pause-60-template',
    label: 'Pause 60 min',
    description: 'Längere Pause mit 60 Minuten',
    activityType: 'break',
    defaultDurationMinutes: 60,
    attributes: [
      { key: 'category', meta: { value: 'pause' } },
      { key: 'is_break', meta: { value: 'true' } },
      { key: 'consider_capacity_conflicts', meta: { value: 'true' } },
    ],
  },
];

const DEFAULT_DEFINITIONS: ActivityDefinition[] = [
  {
    id: 'pause-30',
    label: 'Pause 30',
    activityType: 'break',
    templateId: 'pause-30-template',
    defaultDurationMinutes: 30,
    attributes: [
      { key: 'default-duration', meta: { datatype: 'number', value: '30' } },
      { key: 'kind', meta: { value: 'pause' } },
      { key: 'is_break', meta: { value: 'true' } },
      { key: 'is_short_break', meta: { value: 'true' } },
      { key: 'consider_capacity_conflicts', meta: { value: 'true' } },
    ],
  },
  {
    id: 'pause-60',
    label: 'Pause 60',
    activityType: 'break',
    templateId: 'pause-60-template',
    defaultDurationMinutes: 60,
    attributes: [
      { key: 'default-duration', meta: { datatype: 'number', value: '60' } },
      { key: 'kind', meta: { value: 'pause' } },
      { key: 'is_break', meta: { value: 'true' } },
      { key: 'consider_capacity_conflicts', meta: { value: 'true' } },
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class ActivityCatalogService {
  private readonly activityTypes = inject(ActivityTypeService, { optional: true });
  private readonly definitionsSignal = signal<ActivityDefinition[]>([]);
  private readonly templatesSignal = signal<ActivityTemplate[]>([]);

  readonly definitions: Signal<ActivityDefinition[]> = computed(() => this.definitionsSignal());
  readonly templates: Signal<ActivityTemplate[]> = computed(() => this.templatesSignal());

  constructor() {
    const loaded = this.load();
    this.definitionsSignal.set(loaded.definitions);
    this.templatesSignal.set(loaded.templates);
    this.mergeMissingFromActivityTypes();
  }

  addDefinition(input: ActivityDefinitionInput): void {
    const next = this.normalizeDefinition(input);
    this.definitionsSignal.set([...this.definitionsSignal(), next]);
    this.persist();
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
    this.persist();
  }

  removeDefinition(id: string): void {
    this.definitionsSignal.set(this.definitionsSignal().filter((item) => item.id !== id));
    this.persist();
  }

  addTemplate(input: ActivityTemplateInput): void {
    const next = this.normalizeTemplate(input);
    this.templatesSignal.set([...this.templatesSignal(), next]);
    this.persist();
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
    this.persist();
  }

  removeTemplate(id: string): void {
    this.templatesSignal.set(this.templatesSignal().filter((item) => item.id !== id));
    this.definitionsSignal.set(
      this.definitionsSignal().map((def) =>
        def.templateId === id ? { ...def, templateId: null } : def,
      ),
    );
    this.persist();
  }

  private normalizeDefinition(input: ActivityDefinitionInput): ActivityDefinition {
    const id = this.slugify(input.id || input.label);
    const attributes = this.normalizeAttributes(input.attributes);
    const relevantFor = this.normalizeRelevantFor(input.relevantFor);
    const enhancedAttributes = this.ensureBehaviorAttributes(
      attributes,
      input.defaultDurationMinutes,
      relevantFor,
    );

    return {
      id,
      label: (input.label ?? id).trim(),
      description: input.description?.trim(),
      activityType: (input.activityType ?? 'other').trim(),
      templateId: input.templateId ?? null,
      defaultDurationMinutes: this.normalizeDuration(input.defaultDurationMinutes),
      relevantFor,
      attributes: enhancedAttributes,
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

  private load(): PersistedCatalog {
    if (typeof window === 'undefined') {
      return { definitions: DEFAULT_DEFINITIONS, templates: DEFAULT_TEMPLATES };
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { definitions: DEFAULT_DEFINITIONS, templates: DEFAULT_TEMPLATES };
      }
      const parsed = JSON.parse(raw) as PersistedCatalog;
      if (!parsed || typeof parsed !== 'object') {
        return { definitions: DEFAULT_DEFINITIONS, templates: DEFAULT_TEMPLATES };
      }
      return {
        definitions: Array.isArray(parsed.definitions)
          ? parsed.definitions.map((d) => this.normalizeDefinition(d))
          : DEFAULT_DEFINITIONS,
        templates: Array.isArray(parsed.templates)
          ? parsed.templates.map((t) => this.normalizeTemplate(t))
          : DEFAULT_TEMPLATES,
      };
    } catch {
      return { definitions: DEFAULT_DEFINITIONS, templates: DEFAULT_TEMPLATES };
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const payload: PersistedCatalog = {
        definitions: this.definitionsSignal(),
        templates: this.templatesSignal(),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
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

  private mergeMissingFromActivityTypes(): void {
    const typeDefinitions = this.activityTypes?.definitions() ?? [];
    if (!typeDefinitions.length) {
      return;
    }
    const existing = this.definitionsSignal();
    const toAdd: ActivityDefinition[] = [];
    typeDefinitions.forEach((type) => {
      if (existing.some((def) => def.id === type.id)) {
        return;
      }
      toAdd.push(this.mapTypeToActivityDefinition(type));
    });
    if (toAdd.length) {
      this.definitionsSignal.set([...existing, ...toAdd]);
      this.persist();
    }
  }

  private mapTypeToActivityDefinition(type: ActivityTypeDefinition): ActivityDefinition {
    const baseAttrs: ActivityAttributeValue[] = [
      { key: 'category', meta: { value: type.category } },
      { key: 'timeMode', meta: { value: type.timeMode } },
      ...type.fields.map((field) => ({
        key: `field:${field}`,
        meta: FIELD_META[field] ?? {},
      })),
    ];
    const attrs = this.ensureBehaviorAttributes(
      baseAttrs,
      type.defaultDurationMinutes,
      type.relevantFor,
    );
    return {
      id: type.id,
      label: type.label,
      description: type.description ?? '',
      activityType: type.id,
      templateId: null,
      defaultDurationMinutes: type.defaultDurationMinutes,
      relevantFor: type.relevantFor,
      attributes: attrs,
    };
  }

  private normalizeRelevantFor(values: ResourceKind[] | undefined): ResourceKind[] | undefined {
    if (!values || values.length === 0) {
      return undefined;
    }
    const allowed: ResourceKind[] = ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'];
    const list = Array.from(new Set(values)).filter((v): v is ResourceKind => allowed.includes(v));
    return list.length ? list : undefined;
  }

  private ensureBehaviorAttributes(
    attributes: ActivityAttributeValue[],
    defaultDurationMinutes: number | null | undefined,
    relevantFor: ResourceKind[] | undefined,
  ): ActivityAttributeValue[] {
    const result = [...attributes];
    const byKey = new Map<string, ActivityAttributeValue>();
    result.forEach((attr) => {
      byKey.set(attr.key, attr);
    });

    if (defaultDurationMinutes !== null && defaultDurationMinutes !== undefined) {
      const key = 'default_duration';
      const existing = byKey.get(key);
      const minutes = Math.max(1, Math.trunc(defaultDurationMinutes));
      const meta: Record<string, string> = {
        datatype: 'number',
        unit: 'minutes',
        value: minutes.toString(),
        ...(existing?.meta ?? {}),
      };
      const updated: ActivityAttributeValue = { key, meta };
      if (existing) {
        Object.assign(existing, updated);
      } else {
        result.push(updated);
      }
    }

    if (relevantFor && relevantFor.length) {
      const key = 'relevant_for';
      const existing = byKey.get(key);
      const value = relevantFor.join(',');
      const meta: Record<string, string> = {
        datatype: 'list',
        options: 'personnel,vehicle,personnel-service,vehicle-service',
        value,
        ...(existing?.meta ?? {}),
      };
      const updated: ActivityAttributeValue = { key, meta };
      if (existing) {
        Object.assign(existing, updated);
      } else {
        result.push(updated);
      }
    }

    return result;
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
