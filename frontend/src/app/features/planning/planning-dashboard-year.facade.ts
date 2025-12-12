import { Signal, computed } from '@angular/core';
import { TimetableYearBounds, TimetableYearRecord } from '../../core/models/timetable-year.model';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { computeStageYearRange } from './planning-dashboard-timeline.utils';

export class PlanningDashboardYearFacade {
  readonly timetableYearOptions: Signal<TimetableYearBounds[]>;
  readonly timetableYearSummary: Signal<string>;
  readonly basePlanningYearRange: Signal<{ startIso: string; endIso: string } | null>;

  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      filterFacade: PlanningDashboardFilterFacade;
      timetableYearService: TimetableYearService;
      managedYearBounds: Signal<TimetableYearBounds[]>;
      stageYearSelectionState: Signal<Record<PlanningStageId, Set<string>>>;
    },
  ) {
    this.timetableYearOptions = computed<TimetableYearBounds[]>(() => {
      const managed = this.deps.managedYearBounds();
      if (managed.length) {
        return managed;
      }
      return [this.deps.timetableYearService.defaultYearBounds()];
    });

    this.timetableYearSummary = computed(() =>
      this.deps.filterFacade.formatTimetableYearSummary(this.deps.activeStage()),
    );

    this.basePlanningYearRange = computed(() =>
      computeStageYearRange(
        this.selectedYearBounds('base'),
        this.deps.timetableYearService.defaultYearBounds(),
      ),
    );
  }

  selectedYearBounds(stage: PlanningStageId): TimetableYearBounds[] {
    return this.deps.filterFacade.selectedYearBounds(stage, this.timetableYearOptions());
  }

  isTimetableYearSelected(label: string): boolean {
    const stage = this.deps.activeStage();
    return this.deps.stageYearSelectionState()[stage]?.has(label) ?? false;
  }

  onTimetableYearToggle(label: string, checked: boolean): void {
    const stage = this.deps.activeStage();
    this.deps.filterFacade.updateStageYearSelection(stage, this.timetableYearOptions(), (current, options) => {
      const next = new Set(current);
      if (checked) {
        next.add(label);
      } else {
        if (next.size <= 1) {
          return current;
        }
        next.delete(label);
      }
      if (next.size === 0 && options.length) {
        next.add(this.deps.filterFacade.preferredYearLabel(options));
      }
      return next;
    });
  }

  selectDefaultTimetableYear(): void {
    const stage = this.deps.activeStage();
    this.deps.filterFacade.updateStageYearSelection(stage, this.timetableYearOptions(), (_current, options) => {
      if (!options.length) {
        return _current;
      }
      return new Set([this.deps.filterFacade.preferredYearLabel(options)]);
    });
  }

  selectAllTimetableYears(): void {
    const stage = this.deps.activeStage();
    this.deps.filterFacade.updateStageYearSelection(stage, this.timetableYearOptions(), (_current, options) => {
      if (!options.length) {
        return _current;
      }
      return new Set(options.map((year) => year.label));
    });
  }
}
