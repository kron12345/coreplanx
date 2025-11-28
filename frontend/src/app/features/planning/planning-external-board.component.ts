import { Component, Signal, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { GanttComponent } from '../../gantt/gantt.component';
import { PlanningDataService } from './planning-data.service';
import { PlanningStageId } from './planning-stage.model';
import { Resource } from '../../models/resource';
import { Activity, ServiceRole } from '../../models/activity';
import { getActivityOwnerId } from '../../models/activity-ownership';
import { ActivityTypeDefinition, ActivityTypeService } from '../../core/services/activity-type.service';
import { TranslationService } from '../../core/services/translation.service';

@Component({
  selector: 'app-planning-external-board',
  standalone: true,
  imports: [CommonModule, GanttComponent],
  template: `
    <div class="external-board">
      <app-gantt
        [resources]="boardResources()"
        [activities]="boardActivities()"
        [timelineRange]="timelineRange()"
        [resourceViewModes]="resourceViewModes()"
        [selectedActivityIds]="selectedActivityIds()"
        [activityTypeInfo]="activityTypeInfo()"
        (activitySelectionToggle)="noop()"
      ></app-gantt>
    </div>
  `,
  styles: [
    `
      .external-board {
        width: 100%;
        height: 100vh;
        overflow: hidden;
        display: flex;
      }
    `,
  ],
})
export class PlanningExternalBoardComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(PlanningDataService);
  private readonly activityTypes = inject(ActivityTypeService);
  private readonly translationService = inject(TranslationService);

  private readonly stageId = signal<PlanningStageId>('base');
  private readonly resourceFilter = signal<Set<string> | null>(null);

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
    this.route.queryParamMap.subscribe((params) => {
      const rawStage = params.get('stage');
      const stage = rawStage === 'operations' ? 'operations' : 'base';
      const resources = params.get('resources');
      const resourceIds = resources
        ? resources
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : [];
      this.stageId.set(stage);
      this.resourceFilter.set(resourceIds.length > 0 ? new Set(resourceIds) : null);
    });
  }

  noop(): void {}

  private buildActivityTypeInfo(): Record<string, { label: string; showRoute: boolean; serviceRole: ServiceRole | null }> {
    const record: Record<string, { label: string; showRoute: boolean; serviceRole: ServiceRole | null }> = {};
    const definitions: ActivityTypeDefinition[] = this.activityTypes.definitions();
    // Touch translations for reactivity
    this.translationService.translations();
    definitions.forEach((definition) => {
      const translated = this.translationService.translate(
        `activityType:${definition.id}`,
        definition.label,
      );
      record[definition.id] = {
        label: translated && translated.trim().length ? translated.trim() : definition.label,
        showRoute: definition.fields.includes('from') || definition.fields.includes('to'),
        serviceRole: null,
      };
    });
    return record;
  }
}
