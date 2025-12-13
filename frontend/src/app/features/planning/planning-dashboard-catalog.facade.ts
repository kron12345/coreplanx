import { Signal, computed } from '@angular/core';
import { ActivityCategory, ActivityTypeDefinition, ActivityTypeService } from '../../core/services/activity-type.service';
import { ActivityCatalogService } from '../../core/services/activity-catalog.service';
import { TranslationService } from '../../core/services/translation.service';
import { ActivityCatalogOption, ActivityTypePickerGroup } from './planning-dashboard.types';
import { ResourceKind } from '../../models/resource';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';

export class PlanningDashboardCatalogFacade {
  readonly activityTypeDefinitions: Signal<ActivityTypeDefinition[]>;
  readonly activityTypeDisplayLabelMap = computed(() => {
    this.translationService.translations();
    const map = new Map<string, string>();
    this.activityTypeDefinitions().forEach((definition) => {
      const translated = this.translationService.translate(
        `activityType:${definition.id}`,
        definition.label,
      );
      map.set(definition.id, translated || definition.label);
    });
    return map;
  });

  readonly activityTypeMap = computed(() => {
    const map = new Map<string, ActivityTypeDefinition>();
    this.activityTypeDefinitions().forEach((definition) => map.set(definition.id, definition));
    return map;
  });

  private readonly activityCatalogOptions = computed<ActivityCatalogOption[]>(() => {
    const typeMap = this.activityTypeMap();
    const displayLabelMap = this.activityTypeDisplayLabelMap();
    return this.activityCatalog
      .definitions()
      .map((entry) => {
        const type = typeMap.get(entry.activityType ?? '');
        if (!type) {
          return null;
        }
        const attrList = entry.attributes ?? [];
        const attrByKey = new Map(attrList.map((a) => [a.key, a] as const));
        const durationAttr = attrByKey.get('default_duration');
        const relevantAttr = attrByKey.get('relevant_for');
        const durationFromAttr = durationAttr?.meta?.['value'] ? Number(durationAttr.meta['value']) : null;
        const relevantFromAttr = relevantAttr?.meta?.['value']
          ? (relevantAttr.meta['value'] as string).split(',').map((v) => v.trim()).filter(Boolean)
          : null;
        const effectiveDuration =
          Number.isFinite(durationFromAttr ?? NaN) && (durationFromAttr ?? 0) > 0
            ? (durationFromAttr as number)
            : entry.defaultDurationMinutes ?? type.defaultDurationMinutes;
        const effectiveRelevantFor =
          (relevantFromAttr && relevantFromAttr.length
            ? (relevantFromAttr as ResourceKind[])
            : entry.relevantFor && entry.relevantFor.length
              ? entry.relevantFor
              : type.relevantFor) ?? type.appliesTo;
        const translatedTypeLabel = displayLabelMap.get(type.id) ?? type.label;

        return {
          id: entry.id,
          label: translatedTypeLabel,
          description: entry.description ?? type.description,
          defaultDurationMinutes: effectiveDuration ?? null,
          attributes: attrList,
          templateId: entry.templateId ?? null,
          activityTypeId: entry.activityType ?? type.id,
          typeDefinition: type,
          relevantFor: effectiveRelevantFor,
        } as ActivityCatalogOption;
      })
      .filter((entry): entry is ActivityCatalogOption => !!entry);
  });

  readonly activityCatalogOptionMap = computed(() =>
    new Map<string, ActivityCatalogOption>(this.activityCatalogOptions().map((option) => [option.id, option])),
  );

  readonly activityCreationOptions = this.activityCatalogOptions;

  readonly activityTypeCandidates = computed(() => {
    const options = this.activityCatalogOptions();
    const selection = this.selection?.selectedActivityState();
    const resourceKind = selection?.resource.kind ?? null;
    if (!resourceKind) {
      return options;
    }
    return options.filter((option) => {
      const relevant = option.relevantFor ?? option.typeDefinition.relevantFor ?? option.typeDefinition.appliesTo;
      return relevant.includes(resourceKind);
    });
  });

  readonly quickActivityTypes = computed<ActivityCatalogOption[]>(() => {
    const candidates = this.activityTypeCandidates();
    if (!candidates.length) {
      return [];
    }
    const MAX_QUICK_TYPES = 6;
    return candidates.slice(0, MAX_QUICK_TYPES);
  });

  readonly activityTypePickerGroups = computed<ActivityTypePickerGroup[]>(() => {
    const options = this.activityTypeCandidates();
    if (!options.length) {
      return [];
    }
    const groups = this.typePickerMeta.map((meta) => ({
      id: meta.id,
      label: meta.label,
      icon: meta.icon,
      items: [] as ActivityCatalogOption[],
    }));
    options.forEach((option) => {
      const targetId = option.typeDefinition.category ?? 'other';
      const target =
        groups.find((group) => group.id === targetId) ??
        groups.find((group) => group.id === 'other') ??
        groups[0];
      target.items.push(option);
    });
    return groups
      .filter((group) => group.items.length > 0)
      .map((group) => ({
        id: group.id,
        label: group.label,
        icon: group.icon,
        items: [...group.items].sort((a, b) => a.label.localeCompare(b.label, 'de')),
      }));
  });

  readonly selectedCatalogOption = computed<ActivityCatalogOption | null>(() => {
    const id = this.activityCreationToolSignal?.() ?? '';
    return id ? this.activityCatalogOptionMap().get(id) ?? null : null;
  });

  readonly activeTypePickerGroup = computed(() => {
    const groups = this.activityTypePickerGroups();
    if (!groups.length) {
      return null;
    }
    const current = this.activityTypeMenuSelection?.() ?? null;
    return groups.find((group) => group.id === current) ?? groups[0];
  });

  constructor(
    private readonly activityTypeService: ActivityTypeService,
    private readonly activityCatalog: ActivityCatalogService,
    private readonly translationService: TranslationService,
    private readonly typePickerMeta: Array<{ id: ActivityCategory; label: string; icon: string }>,
    private readonly selection?: PlanningDashboardActivitySelectionFacade,
    private readonly activityCreationToolSignal?: () => string,
    private readonly activityTypeMenuSelection?: () => string | null,
  ) {
    this.activityTypeDefinitions = this.activityTypeService.definitions;
  }
}
