import type {
  ActivityAttributeValue,
  ActivityDefinition,
  CustomAttributeDefinition,
  CustomAttributeState,
  LayerGroup,
} from '../planning/planning.types';
import type { ResourceSnapshot } from '../planning/planning.types';
import type {
  ActionApplyOutcome,
  ActionContext,
  ActionPayload,
} from './assistant-action.engine.types';
import type { AssistantActionChangeDto } from './assistant.dto';
import {
  AssistantActionSettingsBase,
  type TranslationEntry,
} from './assistant-action.settings.base';
import type { AssistantActionCommitTask } from './assistant-action.types';

const DRAW_AS_OPTIONS = [
  'line-above',
  'line-below',
  'shift-up',
  'shift-down',
  'dot',
  'square',
  'triangle-up',
  'triangle-down',
  'thick',
  'background',
];

export class AssistantActionSettings extends AssistantActionSettingsBase {
  buildCreateActivityTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const entries = this.extractEntries(payload, ['activityTypes', 'activityType', 'items']);
    if (!entries.length) {
      return this.buildFeedbackResponse('Mindestens ein Activity Type fehlt.');
    }

    const existing = this.planning.listActivityTypes();
    const next = [...existing];
    const changes: AssistantActionChangeDto[] = [];
    const summaries: string[] = [];
    const newIds = new Set<string>();

    for (const entry of entries) {
      const normalized = this.normalizeActivityTypeInput(entry);
      if (normalized.error || !normalized.value) {
        return this.buildFeedbackResponse(normalized.error ?? 'Activity Type ist ungueltig.');
      }
      const candidate = normalized.value;
      if (existing.some((item) => item.id === candidate.id) || newIds.has(candidate.id)) {
        return this.buildFeedbackResponse(`Activity Type ID "${candidate.id}" existiert bereits.`);
      }
      if (this.findByLabel(existing, candidate.label)) {
        return this.buildFeedbackResponse(`Activity Type "${candidate.label}" existiert bereits.`);
      }
      newIds.add(candidate.id);
      next.push(candidate);
      changes.push({
        kind: 'create',
        entityType: 'activityType',
        id: candidate.id,
        label: candidate.label,
      });
      summaries.push(`Activity Type "${candidate.label}" anlegen.`);
    }

    return this.buildCatalogOutcome(snapshot, summaries, changes, [
      { type: 'activityTypes', items: next },
    ]);
  }

  buildUpdateActivityTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listActivityTypes();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Activity Type (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Activity Types passen zu "${targetRef}". Welchen meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Activity Type nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch) ?? {};
    const updated = this.applyActivityTypePatch(resolved.item, patch);
    const next = existing.map((item) => (item.id === resolved.item!.id ? updated : item));
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'activityType',
        id: updated.id,
        label: updated.label,
      },
    ];
    const summary = `Activity Type "${updated.label}" aktualisieren.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'activityTypes', items: next },
    ]);
  }

  buildDeleteActivityTypePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listActivityTypes();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Activity Type (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Activity Types passen zu "${targetRef}". Welchen meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Activity Type nicht gefunden.');
    }

    const next = existing.filter((item) => item.id !== resolved.item!.id);
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'activityType',
        id: resolved.item.id,
        label: resolved.item.label,
      },
    ];
    const summary = `Activity Type "${resolved.item.label}" löschen.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'activityTypes', items: next },
    ]);
  }

  buildCreateActivityTemplatePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const entries = this.extractEntries(payload, ['activityTemplates', 'activityTemplate', 'items']);
    if (!entries.length) {
      return this.buildFeedbackResponse('Mindestens ein Activity Template fehlt.');
    }

    const existing = this.planning.listActivityTemplates();
    const types = this.planning.listActivityTypes();
    const next = [...existing];
    const changes: AssistantActionChangeDto[] = [];
    const summaries: string[] = [];
    const newIds = new Set<string>();

    for (const entry of entries) {
      const normalized = this.normalizeTemplateInput(entry, types, context);
      if (normalized.clarification) {
        return this.buildClarificationResponse(normalized.clarification, context);
      }
      if (normalized.error || !normalized.value) {
        return this.buildFeedbackResponse(normalized.error ?? 'Activity Template ist ungueltig.');
      }
      const candidate = normalized.value;
      if (existing.some((item) => item.id === candidate.id) || newIds.has(candidate.id)) {
        return this.buildFeedbackResponse(`Activity Template ID "${candidate.id}" existiert bereits.`);
      }
      newIds.add(candidate.id);
      next.push(candidate);
      changes.push({
        kind: 'create',
        entityType: 'activityTemplate',
        id: candidate.id,
        label: candidate.label,
      });
      summaries.push(`Activity Template "${candidate.label}" anlegen.`);
    }

    return this.buildCatalogOutcome(snapshot, summaries, changes, [
      { type: 'activityTemplates', items: next },
    ]);
  }

  buildUpdateActivityTemplatePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listActivityTemplates();
    const types = this.planning.listActivityTypes();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Activity Template (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Activity Templates passen zu "${targetRef}". Welches meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Activity Template nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch) ?? {};
    const updated = this.applyTemplatePatch(resolved.item, patch, types, context);
    if (updated.clarification) {
      return this.buildClarificationResponse(updated.clarification, context);
    }
    if (!updated.value) {
      return this.buildFeedbackResponse(updated.error ?? 'Activity Template Patch ungueltig.');
    }
    const next = existing.map((item) => (item.id === resolved.item!.id ? updated.value! : item));
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'activityTemplate',
        id: updated.value.id,
        label: updated.value.label,
      },
    ];
    const summary = `Activity Template "${updated.value.label}" aktualisieren.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'activityTemplates', items: next },
    ]);
  }

  buildDeleteActivityTemplatePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listActivityTemplates();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Activity Template (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Activity Templates passen zu "${targetRef}". Welches meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Activity Template nicht gefunden.');
    }

    const next = existing.filter((item) => item.id !== resolved.item!.id);
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'activityTemplate',
        id: resolved.item.id,
        label: resolved.item.label,
      },
    ];
    const summary = `Activity Template "${resolved.item.label}" löschen.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'activityTemplates', items: next },
    ]);
  }

  buildCreateActivityDefinitionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const entries = this.extractEntries(payload, ['activityDefinitions', 'activityDefinition', 'items']);
    if (!entries.length) {
      return this.buildFeedbackResponse('Mindestens eine Activity Definition fehlt.');
    }

    const existing = this.planning.listActivityDefinitions();
    const types = this.planning.listActivityTypes();
    const templates = this.planning.listActivityTemplates();
    const next = [...existing];
    const changes: AssistantActionChangeDto[] = [];
    const summaries: string[] = [];
    const newIds = new Set<string>();
    const entryPaths = this.resolveDefinitionEntryPaths(payload, entries);

    for (const [index, entry] of entries.entries()) {
      const entryPath = entryPaths[index] ?? [];
      const normalized = this.normalizeDefinitionInput(entry, types, templates, context);
      if (normalized.clarification) {
        return this.buildClarificationResponse(normalized.clarification, context);
      }
      if (normalized.error || !normalized.value) {
        return this.buildFeedbackResponse(normalized.error ?? 'Activity Definition ist ungueltig.');
      }
      const candidate = normalized.value;
      if (existing.some((item) => item.id === candidate.id) || newIds.has(candidate.id)) {
        return this.buildFeedbackResponse(`Activity Definition ID "${candidate.id}" existiert bereits.`);
      }
      const interview = this.ensureDefinitionInterview(candidate, context, entryPath);
      if (interview) {
        return interview;
      }
      newIds.add(candidate.id);
      next.push(candidate);
      changes.push({
        kind: 'create',
        entityType: 'activityDefinition',
        id: candidate.id,
        label: candidate.label,
      });
      summaries.push(`Activity Definition "${candidate.label}" anlegen.`);
    }

    return this.buildCatalogOutcome(snapshot, summaries, changes, [
      { type: 'activityDefinitions', items: next },
    ]);
  }

  buildUpdateActivityDefinitionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listActivityDefinitions();
    const types = this.planning.listActivityTypes();
    const templates = this.planning.listActivityTemplates();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Activity Definition (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Activity Definitions passen zu "${targetRef}". Welche meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Activity Definition nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch) ?? {};
    const updated = this.applyDefinitionPatch(resolved.item, patch, types, templates, context);
    if (updated.clarification) {
      return this.buildClarificationResponse(updated.clarification, context);
    }
    if (!updated.value) {
      return this.buildFeedbackResponse(updated.error ?? 'Activity Definition Patch ungueltig.');
    }
    const next = existing.map((item) => (item.id === resolved.item!.id ? updated.value! : item));
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'activityDefinition',
        id: updated.value.id,
        label: updated.value.label,
      },
    ];
    const summary = `Activity Definition "${updated.value.label}" aktualisieren.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'activityDefinitions', items: next },
    ]);
  }

  buildDeleteActivityDefinitionPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listActivityDefinitions();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Activity Definition (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Activity Definitions passen zu "${targetRef}". Welche meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Activity Definition nicht gefunden.');
    }

    const next = existing.filter((item) => item.id !== resolved.item!.id);
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'activityDefinition',
        id: resolved.item.id,
        label: resolved.item.label,
      },
    ];
    const summary = `Activity Definition "${resolved.item.label}" löschen.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'activityDefinitions', items: next },
    ]);
  }

  buildCreateLayerGroupPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const entries = this.extractEntries(payload, ['layerGroups', 'layerGroup', 'items']);
    if (!entries.length) {
      return this.buildFeedbackResponse('Mindestens eine Layer-Gruppe fehlt.');
    }

    const existing = this.planning.listLayerGroups();
    const next = [...existing];
    const changes: AssistantActionChangeDto[] = [];
    const summaries: string[] = [];
    const newIds = new Set<string>();

    for (const entry of entries) {
      const normalized = this.normalizeLayerGroupInput(entry, next);
      if (normalized.error || !normalized.value) {
        return this.buildFeedbackResponse(normalized.error ?? 'Layer-Gruppe ist ungueltig.');
      }
      const candidate = normalized.value;
      if (existing.some((item) => item.id === candidate.id) || newIds.has(candidate.id)) {
        return this.buildFeedbackResponse(`Layer-Gruppe ID "${candidate.id}" existiert bereits.`);
      }
      newIds.add(candidate.id);
      next.push(candidate);
      changes.push({
        kind: 'create',
        entityType: 'layerGroup',
        id: candidate.id,
        label: candidate.label,
      });
      summaries.push(`Layer-Gruppe "${candidate.label}" anlegen.`);
    }

    return this.buildCatalogOutcome(snapshot, summaries, changes, [
      { type: 'layerGroups', items: next },
    ]);
  }

  buildUpdateLayerGroupPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listLayerGroups();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Layer-Gruppe (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Layer-Gruppen passen zu "${targetRef}". Welche meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Layer-Gruppe nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch) ?? {};
    const updated = this.applyLayerGroupPatch(resolved.item, patch);
    const next = existing.map((item) => (item.id === resolved.item!.id ? updated : item));
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'layerGroup',
        id: updated.id,
        label: updated.label,
      },
    ];
    const summary = `Layer-Gruppe "${updated.label}" aktualisieren.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'layerGroups', items: next },
    ]);
  }

  buildDeleteLayerGroupPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const existing = this.planning.listLayerGroups();
    const targetRef = this.extractTargetReference(payload);
    if (!targetRef) {
      return this.buildFeedbackResponse('Layer-Gruppe (target) fehlt.');
    }
    const resolved = this.resolveByIdOrLabel(existing, targetRef, {
      title: `Mehrere Layer-Gruppen passen zu "${targetRef}". Welche meinst du?`,
      apply: { mode: 'value', path: [...context.pathPrefix, 'target'] },
    });
    if (resolved.clarification) {
      return this.buildClarificationResponse(resolved.clarification, context);
    }
    if (resolved.feedback || !resolved.item) {
      return this.buildFeedbackResponse(resolved.feedback ?? 'Layer-Gruppe nicht gefunden.');
    }

    const next = existing.filter((item) => item.id !== resolved.item!.id);
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'layerGroup',
        id: resolved.item.id,
        label: resolved.item.label,
      },
    ];
    const summary = `Layer-Gruppe "${resolved.item.label}" löschen.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'layerGroups', items: next },
    ]);
  }

  buildUpdateTranslationsPreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const entries = this.extractTranslationEntries(payload);
    if (!entries.length) {
      return this.buildFeedbackResponse('Mindestens eine Übersetzung fehlt.');
    }

    const changes: AssistantActionChangeDto[] = [];
    const summaries: string[] = [];
    const commitTasks: AssistantActionCommitTask[] = [];

    const grouped = new Map<string, TranslationEntry[]>();
    entries.forEach((entry) => {
      const list = grouped.get(entry.locale) ?? [];
      list.push(entry);
      grouped.set(entry.locale, list);
    });

    grouped.forEach((localeEntries, locale) => {
      const current = this.planning.getTranslationsForLocale(locale);
      const nextLocale = { ...current };
      localeEntries.forEach((entry) => {
        const label = entry.label ?? null;
        const abbreviation = entry.abbreviation ?? null;
        const shouldDelete =
          entry.delete === true ||
          (!label && !abbreviation) ||
          (typeof label === 'string' && !label.trim() && !abbreviation);
        if (shouldDelete) {
          if (nextLocale[entry.key]) {
            delete nextLocale[entry.key];
            changes.push({
              kind: 'delete',
              entityType: 'translation',
              id: `${locale}:${entry.key}`,
              label: entry.key,
              details: locale,
            });
          }
          return;
        }
        const exists = !!nextLocale[entry.key];
        nextLocale[entry.key] = {
          label: label && typeof label === 'string' ? label.trim() : label,
          abbreviation:
            abbreviation && typeof abbreviation === 'string'
              ? abbreviation.trim()
              : abbreviation,
        };
        changes.push({
          kind: exists ? 'update' : 'create',
          entityType: 'translation',
          id: `${locale}:${entry.key}`,
          label: entry.key,
          details: locale,
        });
      });

      summaries.push(
        `Übersetzungen für "${locale}" aktualisieren (${localeEntries.length}).`,
      );
      commitTasks.push({
        type: 'translations',
        action: 'replace-locale',
        locale,
        entries: nextLocale,
      });
    });

    return this.buildCatalogOutcome(snapshot, summaries, changes, commitTasks);
  }

  buildDeleteTranslationLocalePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
  ): ActionApplyOutcome {
    const locale =
      this.cleanText(payload.locale) ??
      this.cleanText(this.asRecord(payload.target)?.['locale']);
    if (!locale) {
      return this.buildFeedbackResponse('Locale fehlt.');
    }
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'translationLocale',
        id: locale,
        label: locale,
      },
    ];
    const summary = `Übersetzungen für "${locale}" löschen.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'translations', action: 'delete-locale', locale },
    ]);
  }

  buildCreateCustomAttributePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
  ): ActionApplyOutcome {
    const entries = this.extractEntries(payload, ['customAttributes', 'customAttribute', 'items']);
    if (!entries.length) {
      return this.buildFeedbackResponse('Mindestens ein Custom Attribute fehlt.');
    }

    const state = this.clonePayload(this.planning.getCustomAttributes()) as CustomAttributeState;
    const changes: AssistantActionChangeDto[] = [];
    const summaries: string[] = [];
    const now = new Date().toISOString();

    for (const entry of entries) {
      const record = this.asRecord(entry);
      const label = this.cleanText(record?.['label'] ?? record?.['name']);
      const entityId = this.cleanText(record?.['entityId'] ?? record?.['entity_id']);
      if (!entityId) {
        return this.buildFeedbackResponse('Custom Attribute: entityId fehlt.');
      }
      if (!label) {
        return this.buildFeedbackResponse('Custom Attribute: label fehlt.');
      }
      const key = this.cleanText(record?.['key']) ?? this.slugify(label);
      if (!key) {
        return this.buildFeedbackResponse('Custom Attribute: key fehlt.');
      }
      const type = this.cleanText(record?.['type']) ?? 'string';
      if (!this.isCustomAttributeType(type)) {
        return this.buildFeedbackResponse(`Custom Attribute Typ "${type}" ist ungueltig.`);
      }

      const list = state[entityId] ? [...state[entityId]] : [];
      if (list.some((attr) => attr.key === key)) {
        return this.buildFeedbackResponse(
          `Custom Attribute "${key}" existiert in ${entityId} bereits.`,
        );
      }
      const definition: CustomAttributeDefinition = {
        id: this.cleanText(record?.['id']) ?? this.generateId('CA'),
        key,
        label,
        type: type as CustomAttributeDefinition['type'],
        description: this.cleanText(record?.['description']),
        entityId,
        createdAt: this.cleanText(record?.['createdAt']) ?? now,
        updatedAt: now,
        temporal: this.parseBoolean(record?.['temporal']) ?? false,
        required: this.parseBoolean(record?.['required']) ?? false,
      };
      list.push(definition);
      state[entityId] = list;
      changes.push({
        kind: 'create',
        entityType: 'customAttribute',
        id: definition.id,
        label: definition.label,
        details: entityId,
      });
      summaries.push(`Custom Attribute "${definition.label}" anlegen.`);
    }

    return this.buildCatalogOutcome(snapshot, summaries, changes, [
      { type: 'customAttributes', items: state },
    ]);
  }

  buildUpdateCustomAttributePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
    context: ActionContext,
  ): ActionApplyOutcome {
    const target = this.asRecord(payload.target);
    if (!target) {
      return this.buildFeedbackResponse('Custom Attribute target fehlt.');
    }
    const entityId = this.cleanText(target['entityId'] ?? target['entity_id']);
    const id = this.cleanText(target['id']);
    const key = this.cleanText(target['key']);
    if (!entityId) {
      return this.buildFeedbackResponse('Custom Attribute target.entityId fehlt.');
    }
    if (!id && !key) {
      return this.buildFeedbackResponse('Custom Attribute target.id oder target.key fehlt.');
    }

    const state = this.clonePayload(this.planning.getCustomAttributes()) as CustomAttributeState;
    const list = state[entityId] ? [...state[entityId]] : [];
    const match = list.find((entry) => (id ? entry.id === id : entry.key === key));
    if (!match) {
      return this.buildFeedbackResponse('Custom Attribute nicht gefunden.');
    }

    const patch = this.asRecord(payload.patch) ?? {};
    let patchType: CustomAttributeDefinition['type'] | undefined;
    const patchTypeRaw = this.cleanText(patch['type']);
    if (patchTypeRaw) {
      if (!this.isCustomAttributeType(patchTypeRaw)) {
        return this.buildFeedbackResponse(
          `Custom Attribute Typ "${patchTypeRaw}" ist ungueltig.`,
        );
      }
      patchType = patchTypeRaw;
    }
    const updated: CustomAttributeDefinition = {
      ...match,
      label: this.cleanText(patch['label'] ?? match.label) ?? match.label,
      description: this.cleanText(patch['description'] ?? match.description) ?? match.description,
      key: this.cleanText(patch['key'] ?? match.key) ?? match.key,
      type: patchType ?? match.type,
      temporal: this.parseBoolean(patch['temporal'] ?? match.temporal) ?? match.temporal ?? false,
      required: this.parseBoolean(patch['required'] ?? match.required) ?? match.required ?? false,
      updatedAt: new Date().toISOString(),
    };
    if (updated.key !== match.key && list.some((entry) => entry.key === updated.key)) {
      return this.buildFeedbackResponse(`Custom Attribute key "${updated.key}" existiert bereits.`);
    }

    const nextList = list.map((entry) => (entry.id === match.id ? updated : entry));
    state[entityId] = nextList;
    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'update',
        entityType: 'customAttribute',
        id: updated.id,
        label: updated.label,
        details: entityId,
      },
    ];
    const summary = `Custom Attribute "${updated.label}" aktualisieren.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'customAttributes', items: state },
    ]);
  }

  buildDeleteCustomAttributePreview(
    payload: ActionPayload,
    snapshot: ResourceSnapshot,
  ): ActionApplyOutcome {
    const target = this.asRecord(payload.target);
    if (!target) {
      return this.buildFeedbackResponse('Custom Attribute target fehlt.');
    }
    const entityId = this.cleanText(target['entityId'] ?? target['entity_id']);
    const id = this.cleanText(target['id']);
    const key = this.cleanText(target['key']);
    if (!entityId) {
      return this.buildFeedbackResponse('Custom Attribute target.entityId fehlt.');
    }
    if (!id && !key) {
      return this.buildFeedbackResponse('Custom Attribute target.id oder target.key fehlt.');
    }

    const state = this.clonePayload(this.planning.getCustomAttributes()) as CustomAttributeState;
    const list = state[entityId] ? [...state[entityId]] : [];
    const matchIndex = list.findIndex((entry) => (id ? entry.id === id : entry.key === key));
    if (matchIndex < 0) {
      return this.buildFeedbackResponse('Custom Attribute nicht gefunden.');
    }
    const removed = list[matchIndex];
    list.splice(matchIndex, 1);
    if (list.length) {
      state[entityId] = list;
    } else {
      delete state[entityId];
    }

    const changes: AssistantActionChangeDto[] = [
      {
        kind: 'delete',
        entityType: 'customAttribute',
        id: removed.id,
        label: removed.label,
        details: entityId,
      },
    ];
    const summary = `Custom Attribute "${removed.label}" löschen.`;
    return this.buildCatalogOutcome(snapshot, [summary], changes, [
      { type: 'customAttributes', items: state },
    ]);
  }

  private resolveDefinitionEntryPaths(
    payload: ActionPayload,
    entries: unknown[],
  ): Array<Array<string | number>> {
    const paths: Array<Array<string | number>> = [];
    const definitions = payload.activityDefinitions;
    if (Array.isArray(definitions)) {
      return definitions.map((_, index) => ['activityDefinitions', index]);
    }
    const items = payload.items;
    if (Array.isArray(items)) {
      return items.map((_, index) => ['items', index]);
    }
    if (payload.activityDefinition && entries.length === 1) {
      return [['activityDefinition']];
    }
    for (let index = 0; index < entries.length; index += 1) {
      paths.push(['activityDefinition']);
    }
    return paths;
  }

  private ensureDefinitionInterview(
    definition: ActivityDefinition,
    context: ActionContext,
    entryPath: Array<string | number>,
  ): ActionApplyOutcome | null {
    const attributes = definition.attributes ?? [];
    if (!this.hasAttributeValue(this.readAttributeValue(attributes, 'is_within_service'))) {
      return this.buildClarificationResponse(
        {
          title: 'Soll die Activity innerhalb eines Dienstes liegen?',
          options: [
            { id: 'yes', label: 'Ja, innerhalb' },
            { id: 'no', label: 'Nein, ausserhalb' },
            { id: 'both', label: 'Beides' },
          ],
          apply: { mode: 'value', path: [...entryPath, 'presets', 'withinService'] },
        },
        context,
      );
    }

    if (!this.hasLocationPreset(attributes)) {
      return this.buildClarificationResponse(
        {
          title: 'Wie soll der Ort behandelt werden?',
          options: [
            { id: 'manuell', label: 'Manuell (Start und Ziel bearbeiten)' },
            { id: 'ortsunveraenderlich', label: 'Ortsunveraenderlich (Ziel verborgen, Ort vom vorherigen)' },
            { id: 'vorher', label: 'Start vom vorherigen Ort, Ziel manuell' },
            { id: 'nachher', label: 'Ziel vom naechsten Ort, Start manuell' },
          ],
          apply: { mode: 'value', path: [...entryPath, 'presets', 'locationBehavior'] },
        },
        context,
      );
    }

    if (!this.hasAttributeValue(this.readAttributeValue(attributes, 'color'))) {
      return this.buildClarificationResponse(
        {
          title: 'Welche Farbe soll die Activity haben?',
          options: [],
          input: {
            label: 'Farbe',
            placeholder: 'z.B. rot oder #ff0000',
            minLength: 2,
            maxLength: 30,
          },
          apply: { mode: 'value', path: [...entryPath, 'presets', 'color'] },
        },
        context,
      );
    }

    if (!this.hasAttributeValue(this.readAttributeValue(attributes, 'draw_as'))) {
      return this.buildClarificationResponse(
        {
          title: 'Wie soll die Activity im Gantt gezeichnet werden?',
          options: DRAW_AS_OPTIONS.map((value) => ({ id: value, label: value })),
          apply: { mode: 'value', path: [...entryPath, 'presets', 'drawAs'] },
        },
        context,
      );
    }

    if (!this.hasAttributeValue(this.readAttributeValue(attributes, 'layer_group'))) {
      const layerOptions = this.buildLayerGroupOptions();
      if (!layerOptions.length) {
        return this.buildFeedbackResponse(
          'Es gibt noch keine Layer-Gruppen. Bitte zuerst eine Layer-Gruppe anlegen.',
        );
      }
      return this.buildClarificationResponse(
        {
          title: 'In welche Layer-Gruppe soll die Activity?',
          options: layerOptions,
          apply: { mode: 'value', path: [...entryPath, 'presets', 'layerGroup'] },
        },
        context,
      );
    }

    return null;
  }

  private buildLayerGroupOptions(): Array<{ id: string; label: string; details?: string }> {
    return this.planning.listLayerGroups().map((group: LayerGroup) => ({
      id: group.id,
      label: group.label,
      details: group.order !== undefined ? `Order ${group.order}` : undefined,
    }));
  }

  private readAttributeValue(
    attributes: ActivityAttributeValue[] | undefined,
    key: string,
  ): unknown {
    const entry = attributes?.find((attr) => attr.key === key);
    if (!entry?.meta || typeof entry.meta !== 'object') {
      return undefined;
    }
    const meta = entry.meta as Record<string, unknown>;
    if (!this.hasOwn(meta, 'value')) {
      return undefined;
    }
    const raw = meta['value'];
    if (raw === null || raw === undefined) {
      return undefined;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed.length ? trimmed : undefined;
    }
    return raw;
  }

  private hasAttributeValue(value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return true;
  }

  private hasLocationPreset(attributes: ActivityAttributeValue[] | undefined): boolean {
    return (
      this.hasAttributeValue(this.readAttributeValue(attributes, 'from_location_mode')) ||
      this.hasAttributeValue(this.readAttributeValue(attributes, 'to_location_mode')) ||
      this.hasAttributeValue(this.readAttributeValue(attributes, 'from_hidden')) ||
      this.hasAttributeValue(this.readAttributeValue(attributes, 'to_hidden'))
    );
  }
}
