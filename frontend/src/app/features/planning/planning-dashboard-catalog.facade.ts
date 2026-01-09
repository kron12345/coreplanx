import { Signal, computed } from '@angular/core';
import { ActivityCatalogService } from '../../core/services/activity-catalog.service';
import { TranslationService } from '../../core/services/translation.service';
import { ActivityCatalogOption, ActivityTypePickerGroup } from './planning-dashboard.types';
import { ResourceKind } from '../../models/resource';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import type { ActivityCategory } from '../../core/models/activity-definition';
import {
  isSystemDefinition,
  readDefinitionCategory,
  readDefinitionDefaultDuration,
  readDefinitionFields,
  readDefinitionRelevantFor,
  readDefinitionTimeMode,
} from '../../core/utils/activity-definition.utils';

export class PlanningDashboardCatalogFacade {
  private readonly activityCatalogOptions = computed<ActivityCatalogOption[]>(() => {
    this.translationService.translations();
    return this.activityCatalog
      .definitions()
      .map((entry) => {
        const attributes = entry.attributes ?? [];
        const translated = this.translationService.translate(
          `activityType:${entry.activityType}`,
          entry.label,
        );
        const label = translated?.trim().length ? translated.trim() : entry.label;
        return {
          id: entry.id,
          label,
          description: entry.description ?? undefined,
          defaultDurationMinutes: readDefinitionDefaultDuration(attributes),
          attributes,
          templateId: entry.templateId ?? null,
          activityTypeId: entry.activityType,
          relevantFor: readDefinitionRelevantFor(attributes),
          category: readDefinitionCategory(attributes),
          timeMode: readDefinitionTimeMode(attributes),
          fields: readDefinitionFields(attributes),
          isSystem: isSystemDefinition(attributes),
        } as ActivityCatalogOption;
      })
      .filter((entry) => !!entry.activityTypeId);
  });

  readonly activityCatalogOptionMap = computed(() =>
    new Map<string, ActivityCatalogOption>(
      this.activityCatalogOptions().map((option) => [option.id, option] as const),
    ),
  );

  readonly activityCatalogOptionTypeMap = computed(() => {
    const map = new Map<string, ActivityCatalogOption>();
    this.activityCatalogOptions().forEach((option) => {
      if (!map.has(option.activityTypeId)) {
        map.set(option.activityTypeId, option);
      }
    });
    return map;
  });

  readonly activityTypeDisplayLabelMap = computed(() => {
    const map = new Map<string, string>();
    this.activityCatalogOptions().forEach((option) => {
      if (!map.has(option.activityTypeId)) {
        map.set(option.activityTypeId, option.label);
      }
    });
    return map;
  });

  readonly activityCreationOptions = this.activityCatalogOptions;

  readonly activityTypeCandidates = computed(() => {
    const options = this.activityCatalogOptions();
    const selection = this.selection?.selectedActivityState();
    const resourceKind = selection?.resource.kind ?? null;
    if (!resourceKind) {
      return options;
    }
    return options.filter((option) => {
      const relevant = option.relevantFor ?? null;
      if (!relevant || !relevant.length) {
        return true;
      }
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
      const targetId = option.category ?? 'other';
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
    private readonly activityCatalog: ActivityCatalogService,
    private readonly translationService: TranslationService,
    private readonly typePickerMeta: Array<{ id: ActivityCategory; label: string; icon: string }>,
    private readonly selection?: PlanningDashboardActivitySelectionFacade,
    private readonly activityCreationToolSignal?: () => string,
    private readonly activityTypeMenuSelection?: () => string | null,
  ) {}
}
