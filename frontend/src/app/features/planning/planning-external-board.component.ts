import { Component, Signal, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { GanttComponent } from '../../gantt/gantt.component';
import { PlanningDataService } from './planning-data.service';
import { PlanningStageId } from './planning-stage.model';
import { Resource } from '../../models/resource';
import { Activity, ServiceRole } from '../../models/activity';
import { getActivityOwnerId } from '../../models/activity-ownership';
import type { PlanningTimelineRange } from './planning-data.types';
import { ActivityCatalogService } from '../../core/services/activity-catalog.service';
import { TranslationService } from '../../core/services/translation.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { readDefinitionFields } from '../../core/utils/activity-definition.utils';

function deriveYearLabelFromVariantId(variantId: string): string | undefined {
  const trimmed = variantId?.trim();
  if (!trimmed) {
    return undefined;
  }
  const upper = trimmed.toUpperCase();
  if (upper.startsWith('PROD-')) {
    return trimmed.slice('PROD-'.length).trim() || undefined;
  }
  if (upper.startsWith('SIM-')) {
    const rest = trimmed.slice('SIM-'.length).trim();
    const match = /^(\d{4}[/-]\d{2})(?:-|$)/.exec(rest);
    return match?.[1] ?? undefined;
  }
  return undefined;
}

function deriveVariantType(variantId: string): 'productive' | 'simulation' {
  return variantId.trim().toUpperCase().startsWith('PROD-') ? 'productive' : 'simulation';
}

@Component({
    selector: 'app-planning-external-board',
    imports: [CommonModule, GanttComponent],
    templateUrl: './planning-external-board.component.html',
    styleUrl: './planning-external-board.component.scss',
})
export class PlanningExternalBoardComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(PlanningDataService);
  private readonly activityCatalog = inject(ActivityCatalogService);
  private readonly translationService = inject(TranslationService);

  private readonly stageId = signal<PlanningStageId>('base');
  private readonly resourceFilter = signal<Set<string> | null>(null);
  private readonly lastViewportRange = signal<PlanningTimelineRange | null>(null);

  private readonly stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>> = {
    base: this.data.stageResources('base'),
    operations: this.data.stageResources('operations'),
  };

  private readonly stageActivitySignals: Record<PlanningStageId, Signal<Activity[]>> = {
    base: this.data.stageActivities('base'),
    operations: this.data.stageActivities('operations'),
  };

  private readonly stageTimelineSignals = {
    base: this.data.stageTimelineRange('base'),
    operations: this.data.stageTimelineRange('operations'),
  } as const;

  readonly boardResources = computed<Resource[]>(() => {
    const stage = this.stageId();
    const resources = this.stageResourceSignals[stage]();
    const filter = this.resourceFilter();
    if (!filter || filter.size === 0) {
      return resources;
    }
    return resources.filter((resource) => filter.has(resource.id));
  });

  readonly boardActivities = computed<Activity[]>(() => {
    const stage = this.stageId();
    const activities = this.stageActivitySignals[stage]();
    const filter = this.resourceFilter();
    if (!filter || filter.size === 0) {
      return activities;
    }
    return activities.filter((activity) => {
      const ownerId = getActivityOwnerId(activity);
      return ownerId ? filter.has(ownerId) : false;
    });
  });

  readonly timelineRange = computed(() => {
    const stage = this.stageId();
    return this.stageTimelineSignals[stage]();
  });

  readonly resourceViewModes = signal<Record<string, 'block' | 'detail'>>({});
  readonly selectedActivityIds = signal<string[]>([]);
  readonly activityTypeInfo = computed(() => this.buildActivityTypeInfo());

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const rawStage = params.get('stage');
      const stage = rawStage === 'operations' ? 'operations' : 'base';
      const resources = params.get('resources');
      const variantId = params.get('variantId');
      const yearLabel = params.get('timetableYearLabel') ?? undefined;
      if (variantId) {
        const inferredYear =
          yearLabel ?? deriveYearLabelFromVariantId(variantId);
        this.data.setPlanningVariant({
          id: variantId,
          label: variantId,
          type: deriveVariantType(variantId),
          timetableYearLabel: inferredYear,
        });
      }
      const resourceIds = resources
        ? resources
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : [];
      this.stageId.set(stage);
      this.resourceFilter.set(resourceIds.length > 0 ? new Set(resourceIds) : null);
    });

    effect(() => {
      const range = this.lastViewportRange();
      if (!range) {
        return;
      }
      const stage = this.stageId();
      const filter = this.resourceFilter();
      const resourceIds = filter ? Array.from(filter.values()) : [];
      this.data.setStageViewport(stage, range, resourceIds);
    });
  }

  noop(): void {}

  handleViewportChange(range: PlanningTimelineRange): void {
    this.lastViewportRange.set(range);
    const filter = this.resourceFilter();
    const resourceIds = filter ? Array.from(filter.values()) : [];
    this.data.setStageViewport(this.stageId(), range, resourceIds);
  }

  private buildActivityTypeInfo(): Record<string, { label: string; showRoute: boolean; serviceRole: ServiceRole | null }> {
    const record: Record<string, { label: string; showRoute: boolean; serviceRole: ServiceRole | null }> = {};
    const definitions = this.activityCatalog.definitions();
    // Touch translations for reactivity
    this.translationService.translations();
    definitions.forEach((definition) => {
      const typeId = definition.activityType;
      if (!typeId || record[typeId]) {
        return;
      }
      const translated = this.translationService.translate(
        `activityType:${typeId}`,
        definition.label,
      );
      const fields = readDefinitionFields(definition.attributes ?? []);
      record[typeId] = {
        label: translated && translated.trim().length ? translated.trim() : definition.label,
        showRoute: fields.includes('from') || fields.includes('to'),
        serviceRole: null,
      };
    });
    return record;
  }
}
