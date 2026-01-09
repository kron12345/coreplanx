import type {
  ActivityAttributeValue,
  ActivityDefinition,
  ActivityFieldKey,
  ActivityTemplate,
  CustomAttributeDefinition,
  LayerGroup,
  ResourceKind,
} from '../planning/planning.types';
import type { ResourceSnapshot } from '../planning/planning.types';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
  ClarificationRequest,
} from './assistant-action.engine.types';
import type { AssistantActionChangeDto } from './assistant.dto';
import { AssistantActionBase } from './assistant-action.base';
import type { AssistantActionCommitTask } from './assistant-action.types';

export type TranslationEntry = {
  locale: string;
  key: string;
  label?: string | null;
  abbreviation?: string | null;
  delete?: boolean;
};

export class AssistantActionSettingsBase extends AssistantActionBase {
  protected buildCatalogOutcome(
    snapshot: ResourceSnapshot,
    summaries: string[],
    changes: AssistantActionChangeDto[],
    commitTasks: AssistantActionCommitTask[],
  ): ActionApplyOutcome {
    const summary =
      summaries.length === 1 ? summaries[0] : `Einstellungen: ${summaries.length} Aktionen.`;
    return {
      type: 'applied',
      snapshot,
      summary,
      changes,
      commitTasks: commitTasks.length ? commitTasks : undefined,
    };
  }

  protected extractEntries(payload: ActionPayload, keys: string[]): unknown[] {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value;
      }
      if (value !== undefined && value !== null) {
        return [value];
      }
    }
    return [];
  }

  protected extractTargetReference(payload: ActionPayload): string | undefined {
    if (typeof payload.target === 'string') {
      return this.cleanText(payload.target);
    }
    const target = this.asRecord(payload.target);
    if (!target) {
      return undefined;
    }
    return (
      this.cleanText(target['id']) ??
      this.cleanText(target['label']) ??
      this.cleanText(target['name']) ??
      this.cleanText(target['key'])
    );
  }

  protected resolveByIdOrLabel<T extends { id: string; label?: string }>(
    items: T[],
    ref: string,
    clarification: Omit<ClarificationRequest, 'options'>,
  ): { item?: T; feedback?: string; clarification?: ClarificationRequest } {
    const idMatch = items.find((item) => item.id === ref);
    if (idMatch) {
      return { item: idMatch };
    }
    const normalized = this.normalizeKey(ref);
    const matches = items.filter(
      (item) => this.normalizeKey(item.label ?? item.id) === normalized,
    );
    if (matches.length === 1) {
      return { item: matches[0] };
    }
    if (matches.length > 1) {
      return {
        clarification: {
          ...clarification,
          options: matches.map((item) => ({
            id: item.id,
            label: item.label ?? item.id,
            details: item.id,
          })),
        },
      };
    }
    return { feedback: `Eintrag "${ref}" nicht gefunden.` };
  }

  protected findByLabel<T extends { label?: string }>(
    items: T[],
    label: string,
  ): T | undefined {
    const normalized = this.normalizeKey(label);
    return items.find(
      (item) => this.normalizeKey(item.label ?? '') === normalized,
    );
  }

  protected buildActivityTypeChoices(
    definitions: ActivityDefinition[],
  ): Array<{ id: string; label?: string }> {
    const map = new Map<string, { id: string; label?: string }>();
    definitions.forEach((definition) => {
      const id = (definition.activityType ?? '').trim();
      if (!id || map.has(id)) {
        return;
      }
      map.set(id, { id, label: definition.label ?? id });
    });
    return Array.from(map.values());
  }

  protected resolveActivityTypeRef(options: {
    ref: string;
    choices: Array<{ id: string; label?: string }>;
    context: ActionContext;
    path: Array<string | number>;
    allowNew: boolean;
  }): { id?: string; error?: string; clarification?: ClarificationRequest } {
    const cleaned = this.cleanText(options.ref);
    if (!cleaned) {
      return { error: 'Activity Type fehlt.' };
    }
    if (options.choices.length) {
      const resolved = this.resolveByIdOrLabel(options.choices, cleaned, {
        title: `Mehrere Activity Types passen zu "${cleaned}". Welchen meinst du?`,
        apply: { mode: 'value', path: options.path },
      });
      if (resolved.clarification) {
        return { clarification: resolved.clarification };
      }
      if (resolved.item) {
        return { id: resolved.item.id };
      }
      if (!options.allowNew) {
        return { error: resolved.feedback ?? 'Activity Type nicht gefunden.' };
      }
    } else if (!options.allowNew) {
      return { error: 'Keine Activity Definitions vorhanden.' };
    }
    const normalized = /^[a-zA-Z0-9_-]+$/.test(cleaned) ? cleaned : this.slugify(cleaned);
    return { id: normalized };
  }

  protected normalizeTemplateInput(
    entry: unknown,
    definitions: ActivityDefinition[],
    context: ActionContext,
  ): { value?: ActivityTemplate; error?: string; clarification?: ClarificationRequest } {
    const record = this.asRecord(entry);
    const label =
      this.cleanText(record?.['label'] ?? record?.['name']) ??
      (typeof entry === 'string' ? this.cleanText(entry) : undefined);
    const id =
      this.cleanText(record?.['id'] ?? record?.['templateId']) ??
      (label ? this.slugify(label) : undefined);
    if (!id) {
      return { error: 'Activity Template ID fehlt.' };
    }
    const activityTypeRef = this.cleanText(record?.['activityType'] ?? record?.['activity_type']);
    let activityType: string | undefined;
    if (activityTypeRef) {
      const resolved = this.resolveActivityTypeRef({
        ref: activityTypeRef,
        choices: this.buildActivityTypeChoices(definitions),
        context,
        path: [...context.pathPrefix, 'activityTemplate', 'activityType'],
        allowNew: false,
      });
      if (resolved.clarification) {
        return { clarification: resolved.clarification };
      }
      if (!resolved.id) {
        return { error: resolved.error ?? 'Activity Type nicht gefunden.' };
      }
      activityType = resolved.id;
    }
    const defaultDuration = this.parseNumber(
      record?.['defaultDurationMinutes'] ?? record?.['default_duration_minutes'],
    );

    return {
      value: {
        id,
        label: label ?? id,
        description: this.cleanText(record?.['description']),
        activityType: activityType ?? undefined,
        defaultDurationMinutes:
          defaultDuration !== undefined ? Math.max(0, Math.trunc(defaultDuration)) : undefined,
        attributes: this.normalizeAttributeList(record?.['attributes']),
      },
    };
  }

  protected applyTemplatePatch(
    existing: ActivityTemplate,
    patch: Record<string, unknown>,
    definitions: ActivityDefinition[],
    context: ActionContext,
  ): { value?: ActivityTemplate; error?: string; clarification?: ClarificationRequest } {
    const activityTypeRef = this.cleanText(patch['activityType'] ?? patch['activity_type']);
    let activityType = existing.activityType;
    if (activityTypeRef) {
      const resolved = this.resolveActivityTypeRef({
        ref: activityTypeRef,
        choices: this.buildActivityTypeChoices(definitions),
        context,
        path: [...context.pathPrefix, 'patch', 'activityType'],
        allowNew: false,
      });
      if (resolved.clarification) {
        return { clarification: resolved.clarification };
      }
      if (!resolved.id) {
        return { error: resolved.error ?? 'Activity Type nicht gefunden.' };
      }
      activityType = resolved.id;
    }
    const defaultDuration = this.parseNumber(
      patch['defaultDurationMinutes'] ?? patch['default_duration_minutes'],
    );
    return {
      value: {
        ...existing,
        label: this.cleanText(patch['label']) ?? existing.label,
        description: this.cleanText(patch['description']) ?? existing.description,
        activityType,
        defaultDurationMinutes:
          defaultDuration !== undefined
            ? Math.max(0, Math.trunc(defaultDuration))
            : existing.defaultDurationMinutes,
        attributes: this.normalizeAttributeList(patch['attributes']) ?? existing.attributes,
      },
    };
  }

  protected normalizeDefinitionInput(
    entry: unknown,
    definitions: ActivityDefinition[],
    templates: ActivityTemplate[],
    context: ActionContext,
  ): { value?: ActivityDefinition; error?: string; clarification?: ClarificationRequest } {
    const record = this.asRecord(entry);
    const label =
      this.cleanText(record?.['label'] ?? record?.['name']) ??
      (typeof entry === 'string' ? this.cleanText(entry) : undefined);
    const id =
      this.cleanText(record?.['id'] ?? record?.['definitionId']) ??
      (label ? this.slugify(label) : undefined);
    if (!id) {
      return { error: 'Activity Definition ID fehlt.' };
    }
    const activityTypeRef = this.cleanText(record?.['activityType'] ?? record?.['activity_type']);
    if (!activityTypeRef) {
      return { error: 'Activity Definition activityType fehlt.' };
    }
    const typeResolved = this.resolveActivityTypeRef({
      ref: activityTypeRef,
      choices: this.buildActivityTypeChoices(definitions),
      context,
      path: [...context.pathPrefix, 'activityDefinition', 'activityType'],
      allowNew: true,
    });
    if (typeResolved.clarification) {
      return { clarification: typeResolved.clarification };
    }
    if (!typeResolved.id) {
      return { error: typeResolved.error ?? 'Activity Type nicht gefunden.' };
    }
    const templateRef = this.cleanText(record?.['templateId'] ?? record?.['template_id']);
    let templateId: string | undefined;
    if (templateRef) {
      const templateResolved = this.resolveByIdOrLabel(templates, templateRef, {
        title: `Mehrere Activity Templates passen zu "${templateRef}". Welches meinst du?`,
        apply: { mode: 'value', path: [...context.pathPrefix, 'activityDefinition', 'templateId'] },
      });
      if (templateResolved.clarification) {
        return { clarification: templateResolved.clarification };
      }
      if (templateResolved.item) {
        templateId = templateResolved.item.id;
      } else if (templateResolved.feedback) {
        return { error: templateResolved.feedback };
      }
    }
    const defaultDuration = this.parseNumber(
      record?.['defaultDurationMinutes'] ?? record?.['default_duration_minutes'],
    );
    const relevantFor = this.normalizeResourceKinds(
      record?.['relevantFor'] ?? record?.['relevant_for'],
    );
    const rawAttributes = this.normalizeAttributeList(record?.['attributes']);
    const presetAttributes = this.normalizeDefinitionPresets(record ?? {});
    const mergedAttributes = this.mergeAttributeLists(rawAttributes, presetAttributes);

    return {
      value: {
        id,
        label: label ?? id,
        description: this.cleanText(record?.['description']),
        activityType: typeResolved.id,
        templateId: templateId ?? undefined,
        defaultDurationMinutes:
          defaultDuration !== undefined ? Math.max(0, Math.trunc(defaultDuration)) : undefined,
        relevantFor: relevantFor.length ? relevantFor : undefined,
        attributes: mergedAttributes?.length ? mergedAttributes : undefined,
      },
    };
  }

  protected applyDefinitionPatch(
    existing: ActivityDefinition,
    patch: Record<string, unknown>,
    definitions: ActivityDefinition[],
    templates: ActivityTemplate[],
    context: ActionContext,
  ): { value?: ActivityDefinition; error?: string; clarification?: ClarificationRequest } {
    let activityType = existing.activityType;
    const activityTypeRef = this.cleanText(patch['activityType'] ?? patch['activity_type']);
    if (activityTypeRef) {
      const resolved = this.resolveActivityTypeRef({
        ref: activityTypeRef,
        choices: this.buildActivityTypeChoices(definitions),
        context,
        path: [...context.pathPrefix, 'patch', 'activityType'],
        allowNew: true,
      });
      if (resolved.clarification) {
        return { clarification: resolved.clarification };
      }
      if (!resolved.id) {
        return { error: resolved.error ?? 'Activity Type nicht gefunden.' };
      }
      activityType = resolved.id;
    }

    let templateId = existing.templateId;
    const templateRef = this.cleanText(patch['templateId'] ?? patch['template_id']);
    if (templateRef) {
      const resolved = this.resolveByIdOrLabel(templates, templateRef, {
        title: `Mehrere Activity Templates passen zu "${templateRef}". Welches meinst du?`,
        apply: { mode: 'value', path: [...context.pathPrefix, 'patch', 'templateId'] },
      });
      if (resolved.clarification) {
        return { clarification: resolved.clarification };
      }
      if (!resolved.item) {
        return { error: resolved.feedback ?? 'Activity Template nicht gefunden.' };
      }
      templateId = resolved.item.id;
    }

    const defaultDuration = this.parseNumber(
      patch['defaultDurationMinutes'] ?? patch['default_duration_minutes'],
    );
    const relevantFor = this.normalizeResourceKinds(
      patch['relevantFor'] ?? patch['relevant_for'],
    );
    const rawAttributes = this.normalizeAttributeList(patch['attributes']);
    const presetAttributes = this.normalizeDefinitionPresets(patch);
    const mergedAttributes = this.mergeAttributeLists(
      rawAttributes ?? existing.attributes,
      presetAttributes,
    );
    return {
      value: {
        ...existing,
        label: this.cleanText(patch['label']) ?? existing.label,
        description: this.cleanText(patch['description']) ?? existing.description,
        activityType,
        templateId,
        defaultDurationMinutes:
          defaultDuration !== undefined
          ? Math.max(0, Math.trunc(defaultDuration))
          : existing.defaultDurationMinutes,
        relevantFor: relevantFor.length ? relevantFor : existing.relevantFor,
        attributes: mergedAttributes?.length ? mergedAttributes : undefined,
      },
    };
  }

  protected normalizeLayerGroupInput(
    entry: unknown,
    existing: LayerGroup[],
  ): { value?: LayerGroup; error?: string } {
    const record = this.asRecord(entry);
    const label =
      this.cleanText(record?.['label'] ?? record?.['name']) ??
      (typeof entry === 'string' ? this.cleanText(entry) : undefined);
    if (!label) {
      return { error: 'Layer-Gruppe label fehlt.' };
    }
    const id = this.cleanText(record?.['id']) ?? this.slugify(label);
    if (!id) {
      return { error: 'Layer-Gruppe ID fehlt.' };
    }
    const orderRaw = this.parseNumber(record?.['order'] ?? record?.['sort_order']);
    const order =
      orderRaw !== undefined ? Math.trunc(orderRaw) : this.nextLayerOrder(existing);
    return {
      value: {
        id,
        label,
        description: this.cleanText(record?.['description']),
        order,
      },
    };
  }

  protected applyLayerGroupPatch(
    existing: LayerGroup,
    patch: Record<string, unknown>,
  ): LayerGroup {
    const orderRaw = this.parseNumber(patch['order'] ?? patch['sort_order']);
    return {
      ...existing,
      label: this.cleanText(patch['label']) ?? existing.label,
      description: this.cleanText(patch['description']) ?? existing.description,
      order: orderRaw !== undefined ? Math.trunc(orderRaw) : existing.order,
    };
  }

  protected nextLayerOrder(existing: LayerGroup[]): number {
    if (!existing.length) {
      return 50;
    }
    return Math.max(...existing.map((item) => item.order ?? 50)) + 10;
  }

  protected normalizeResourceKinds(value: unknown): ResourceKind[] {
    const allowed: ResourceKind[] = [
      'personnel',
      'vehicle',
      'personnel-service',
      'vehicle-service',
    ];
    const allowedSet = new Set<ResourceKind>(allowed);
    return (this.parseStringArray(value) ?? [])
      .map((entry) => entry.trim())
      .filter((entry): entry is ResourceKind => allowedSet.has(entry as ResourceKind));
  }

  protected normalizeActivityFields(value: unknown): ActivityFieldKey[] {
    const allowed: ActivityFieldKey[] = ['start', 'end', 'from', 'to', 'remark'];
    const allowedSet = new Set<ActivityFieldKey>(allowed);
    const list = (this.parseStringArray(value) ?? [])
      .map((entry) => entry.trim())
      .filter((entry): entry is ActivityFieldKey => allowedSet.has(entry as ActivityFieldKey));
    return Array.from(new Set(list));
  }

  protected normalizeMetaRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return { ...(value as Record<string, unknown>) };
  }

  protected normalizeAttributeList(value: unknown): ActivityAttributeValue[] | undefined {
    if (!value) {
      return undefined;
    }
    if (Array.isArray(value)) {
      const list: ActivityAttributeValue[] = [];
      value.forEach((entry) => {
        const record = this.asRecord(entry);
        if (!record) {
          return;
        }
        const key = this.cleanText(record['key']);
        if (!key) {
          return;
        }
        const meta = this.normalizeMetaRecord(record['meta']);
        list.push({ key, meta });
      });
      return list;
    }
    if (typeof value === 'object') {
      const list: ActivityAttributeValue[] = [];
      Object.entries(value as Record<string, unknown>).forEach(([key, metaValue]) => {
        const trimmed = key.trim();
        if (!trimmed) {
          return;
        }
        if (metaValue && typeof metaValue === 'object' && !Array.isArray(metaValue)) {
          list.push({ key: trimmed, meta: { ...(metaValue as Record<string, unknown>) } });
        } else {
          list.push({
            key: trimmed,
            meta:
              metaValue === undefined || metaValue === null
                ? undefined
                : { value: String(metaValue) },
          });
        }
      });
      return list;
    }
    return undefined;
  }

  protected mergeAttributeLists(
    base: ActivityAttributeValue[] | undefined,
    overrides: ActivityAttributeValue[] | undefined,
  ): ActivityAttributeValue[] | undefined {
    if (!base?.length && !overrides?.length) {
      return undefined;
    }
    const map = new Map<string, ActivityAttributeValue>();
    const push = (entry: ActivityAttributeValue) => {
      if (!entry?.key) {
        return;
      }
      map.set(entry.key, {
        key: entry.key,
        meta: entry.meta ? { ...(entry.meta as Record<string, unknown>) } : undefined,
      });
    };
    (base ?? []).forEach(push);
    (overrides ?? []).forEach(push);
    return Array.from(map.values());
  }

  protected normalizeDefinitionPresets(
    record: Record<string, unknown>,
  ): ActivityAttributeValue[] | undefined {
    const presets = this.asRecord(record['presets'] ?? record['preset']);
    const readRaw = (keys: string[]): unknown => {
      for (const key of keys) {
        if (presets && this.hasOwn(presets, key)) {
          return presets[key];
        }
        if (this.hasOwn(record, key)) {
          return record[key];
        }
      }
      return undefined;
    };
    const readText = (keys: string[]): string | undefined => {
      const value = readRaw(keys);
      return value === undefined ? undefined : this.cleanText(value);
    };
    const readBool = (keys: string[]): boolean | undefined => {
      const value = readRaw(keys);
      return value === undefined ? undefined : this.parseBoolean(value);
    };
    const attributes: ActivityAttributeValue[] = [];
    const write = (key: string, value: unknown) => {
      if (value === undefined || value === null) {
        return;
      }
      const text = typeof value === 'string' ? value.trim() : String(value);
      if (!text) {
        return;
      }
      attributes.push({ key, meta: { value: text } });
    };

    const within = this.normalizeWithinServicePreset(
      readRaw([
        'withinService',
        'within_service',
        'isWithinService',
        'is_within_service',
        'serviceScope',
      ]),
    );
    if (within) {
      write('is_within_service', within);
    }

    const color = readText(['color', 'farbe', 'displayColor', 'display_color']);
    if (color) {
      write('color', color);
    }

    const drawAs = readText(['drawAs', 'draw_as', 'drawMode', 'draw_mode']);
    if (drawAs) {
      write('draw_as', drawAs);
    }

    const layerGroup = readText(['layerGroup', 'layer_group', 'layer']);
    if (layerGroup) {
      write('layer_group', layerGroup);
    }

    const considerLocation = readBool([
      'considerLocationConflicts',
      'consider_location_conflicts',
    ]);
    if (considerLocation !== undefined) {
      write('consider_location_conflicts', considerLocation ? 'true' : 'false');
    }

    const considerCapacity = readBool([
      'considerCapacityConflicts',
      'consider_capacity_conflicts',
    ]);
    if (considerCapacity !== undefined) {
      write('consider_capacity_conflicts', considerCapacity ? 'true' : 'false');
    }

    const booleanFlags: Array<{ key: string; aliases: string[] }> = [
      { key: 'is_break', aliases: ['isBreak', 'is_break'] },
      { key: 'is_short_break', aliases: ['isShortBreak', 'is_short_break'] },
      { key: 'is_service_start', aliases: ['isServiceStart', 'is_service_start'] },
      { key: 'is_service_end', aliases: ['isServiceEnd', 'is_service_end'] },
      { key: 'is_absence', aliases: ['isAbsence', 'is_absence'] },
      { key: 'is_reserve', aliases: ['isReserve', 'is_reserve'] },
    ];
    booleanFlags.forEach((flag) => {
      const value = readBool(flag.aliases);
      if (value !== undefined) {
        write(flag.key, value ? 'true' : 'false');
      }
    });

    const locationPreset = this.resolveLocationPreset(presets, record);
    if (locationPreset) {
      if (locationPreset.fromMode) {
        write('from_location_mode', locationPreset.fromMode);
      }
      if (locationPreset.toMode) {
        write('to_location_mode', locationPreset.toMode);
      }
      if (locationPreset.fromHidden !== undefined) {
        write('from_hidden', locationPreset.fromHidden ? 'true' : 'false');
      }
      if (locationPreset.toHidden !== undefined) {
        write('to_hidden', locationPreset.toHidden ? 'true' : 'false');
      }
    }

    return attributes.length ? attributes : undefined;
  }

  protected normalizeWithinServicePreset(
    value: unknown,
  ): 'yes' | 'no' | 'both' | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'boolean') {
      return value ? 'yes' : 'no';
    }
    if (typeof value === 'string') {
      const normalized = this.normalizeKey(value);
      if (
        normalized === 'yes' ||
        normalized === 'ja' ||
        normalized === 'true' ||
        normalized === 'within' ||
        normalized === 'inside' ||
        normalized === 'in'
      ) {
        return 'yes';
      }
      if (
        normalized === 'no' ||
        normalized === 'nein' ||
        normalized === 'false' ||
        normalized === 'outside' ||
        normalized === 'out'
      ) {
        return 'no';
      }
      if (normalized === 'both') {
        return 'both';
      }
    }
    return undefined;
  }

  protected normalizeLocationModePreset(
    value: unknown,
  ): 'fix' | 'previous' | 'next' | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const normalized = typeof value === 'string' ? this.normalizeKey(value) : '';
    if (
      normalized === 'fix' ||
      normalized === 'fixed' ||
      normalized === 'manual' ||
      normalized === 'manuell' ||
      normalized === 'frei'
    ) {
      return 'fix';
    }
    if (
      normalized === 'previous' ||
      normalized === 'prev' ||
      normalized === 'before' ||
      normalized === 'vorher' ||
      normalized === 'vorheriger'
    ) {
      return 'previous';
    }
    if (
      normalized === 'next' ||
      normalized === 'nachher' ||
      normalized === 'naechster' ||
      normalized === 'naechste'
    ) {
      return 'next';
    }
    return undefined;
  }

  protected resolveLocationPreset(
    presets: Record<string, unknown> | null,
    record: Record<string, unknown>,
  ):
    | {
        fromMode?: 'fix' | 'previous' | 'next';
        toMode?: 'fix' | 'previous' | 'next';
        fromHidden?: boolean;
        toHidden?: boolean;
      }
    | null {
    const readRaw = (keys: string[]): unknown => {
      for (const key of keys) {
        if (presets && this.hasOwn(presets, key)) {
          return presets[key];
        }
        if (this.hasOwn(record, key)) {
          return record[key];
        }
      }
      return undefined;
    };
    const readMode = (keys: string[]): 'fix' | 'previous' | 'next' | undefined =>
      this.normalizeLocationModePreset(readRaw(keys));
    const readBool = (keys: string[]): boolean | undefined => {
      const raw = readRaw(keys);
      return raw === undefined ? undefined : this.parseBoolean(raw);
    };
    const locationRaw = readRaw([
      'locationBehavior',
      'location_behavior',
      'locationMode',
      'location_mode',
      'location',
    ]);
    const locationRecord = this.asRecord(locationRaw ?? undefined);
    const fromMode =
      readMode(['fromLocationMode', 'from_location_mode', 'fromMode', 'from_mode']) ??
      this.normalizeLocationModePreset(
        locationRecord?.['from'] ??
          locationRecord?.['fromMode'] ??
          locationRecord?.['from_location_mode'],
      );
    const toMode =
      readMode(['toLocationMode', 'to_location_mode', 'toMode', 'to_mode']) ??
      this.normalizeLocationModePreset(
        locationRecord?.['to'] ??
          locationRecord?.['toMode'] ??
          locationRecord?.['to_location_mode'],
      );
    const fromHidden =
      readBool(['fromHidden', 'from_hidden']) ??
      this.parseBoolean(locationRecord?.['fromHidden'] ?? locationRecord?.['from_hidden']);
    const toHidden =
      readBool(['toHidden', 'to_hidden']) ??
      this.parseBoolean(locationRecord?.['toHidden'] ?? locationRecord?.['to_hidden']);

    let resolved: {
      fromMode?: 'fix' | 'previous' | 'next';
      toMode?: 'fix' | 'previous' | 'next';
      fromHidden?: boolean;
      toHidden?: boolean;
    } = {};

    if (fromMode !== undefined) {
      resolved.fromMode = fromMode;
    }
    if (toMode !== undefined) {
      resolved.toMode = toMode;
    }
    if (fromHidden !== undefined) {
      resolved.fromHidden = fromHidden;
    }
    if (toHidden !== undefined) {
      resolved.toHidden = toHidden;
    }

    if (locationRaw && typeof locationRaw === 'string') {
      const normalized = this.normalizeKey(locationRaw);
      if (normalized.includes('unveraenderlich') || normalized.includes('gleich') || normalized.includes('same')) {
        resolved = {
          ...resolved,
          fromMode: resolved.fromMode ?? 'previous',
          toMode: resolved.toMode ?? 'previous',
          toHidden: resolved.toHidden ?? true,
        };
      } else if (normalized.includes('vorher') || normalized.includes('previous')) {
        resolved = {
          ...resolved,
          fromMode: resolved.fromMode ?? 'previous',
          toMode: resolved.toMode ?? 'fix',
        };
      } else if (normalized.includes('nach') || normalized.includes('next')) {
        resolved = {
          ...resolved,
          fromMode: resolved.fromMode ?? 'fix',
          toMode: resolved.toMode ?? 'next',
        };
      } else if (normalized.includes('manuell') || normalized.includes('manual') || normalized.includes('fix')) {
        resolved = {
          ...resolved,
          fromMode: resolved.fromMode ?? 'fix',
          toMode: resolved.toMode ?? 'fix',
          fromHidden: resolved.fromHidden ?? false,
          toHidden: resolved.toHidden ?? false,
        };
      }
    }

    if (
      resolved.fromMode === undefined &&
      resolved.toMode === undefined &&
      resolved.fromHidden === undefined &&
      resolved.toHidden === undefined
    ) {
      return null;
    }
    return resolved;
  }

  protected extractTranslationEntries(payload: ActionPayload): TranslationEntry[] {
    const rawEntries = this.extractEntries(payload, ['translations', 'translation', 'items']);
    const baseLocale = this.cleanText(payload.locale);
    const entries: TranslationEntry[] = [];
    for (const raw of rawEntries) {
      const record = this.asRecord(raw);
      if (!record) {
        continue;
      }
      const locale = this.cleanText(record['locale']) ?? baseLocale;
      const key = this.cleanText(record['key']);
      if (!locale || !key) {
        continue;
      }
      const deleteFlag = this.parseBoolean(record['delete'] ?? record['remove']);
      const label = this.cleanText(record['label']);
      const abbreviation = this.cleanText(record['abbreviation']);
      entries.push({
        locale,
        key,
        label: label ?? null,
        abbreviation: abbreviation ?? null,
        delete: deleteFlag ?? false,
      });
    }
    return entries;
  }

  protected isCustomAttributeType(
    value: string,
  ): value is CustomAttributeDefinition['type'] {
    return ['string', 'number', 'boolean', 'date', 'time'].includes(value);
  }

  protected slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
