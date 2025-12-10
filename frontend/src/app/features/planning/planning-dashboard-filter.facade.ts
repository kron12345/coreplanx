import { signal, WritableSignal } from '@angular/core';
import { PlanningStageId } from './planning-stage.model';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';
import { SimulationRecord } from '../../core/models/simulation.model';
import { PlanningDataService } from './planning-data.service';

export class PlanningDashboardFilterFacade {
  readonly stageYearSelectionState: WritableSignal<Record<PlanningStageId, Set<string>>>;

  constructor(
    private readonly deps: {
      stageOrder: PlanningStageId[];
      timetableYearService: TimetableYearService;
      data: PlanningDataService;
    },
  ) {
    this.stageYearSelectionState = signal(this.createEmptyYearSelection());
  }

  ensureStageYearSelection(stage: PlanningStageId, options: TimetableYearBounds[]): void {
    this.stageYearSelectionState.update((state) => {
      const current = state[stage] ?? new Set<string>();
      const validLabels = new Set(options.map((year) => year.label));
      const next = new Set(Array.from(current).filter((label) => validLabels.has(label)));
      if (next.size === 0 && options.length > 0) {
        next.add(this.preferredYearLabel(options));
      }
      if (this.areSetsEqual(next, current)) {
        return state;
      }
      return {
        ...state,
        [stage]: next,
      };
    });
  }

  updateStageYearSelection(
    stage: PlanningStageId,
    options: TimetableYearBounds[],
    updater: (current: Set<string>, options: TimetableYearBounds[]) => Set<string>,
  ): void {
    this.stageYearSelectionState.update((state) => {
      const current = state[stage] ?? new Set<string>();
      const next = updater(new Set(current), options);
      if (this.areSetsEqual(next, current)) {
        return state;
      }
      return {
        ...state,
        [stage]: next,
      };
    });
  }

  preferredYearLabel(options: TimetableYearBounds[]): string {
    if (!options.length) {
      return '';
    }
    const today = new Date();
    const active =
      options.find((year) => today >= year.start && today <= year.end) ?? options[0];
    return active.label;
  }

  formatTimetableYearSummary(stage: PlanningStageId): string {
    const selection = Array.from(this.stageYearSelectionState()[stage] ?? []);
    if (selection.length === 0) {
      return 'Fahrplanjahr wählen';
    }
    if (selection.length === 1) {
      return `Fahrplanjahr ${selection[0]}`;
    }
    return `${selection.length} Fahrplanjahre`;
  }

  selectedYearLabels(stage: PlanningStageId): string[] {
    return Array.from(this.stageYearSelectionState()[stage] ?? []);
  }

  selectedYearBounds(stage: PlanningStageId, options: TimetableYearBounds[]): TimetableYearBounds[] {
    const selection = Array.from(this.stageYearSelectionState()[stage] ?? []);
    if (!selection.length) {
      return [];
    }
    const optionMap = new Map(options.map((year) => [year.label, year] as const));
    return selection
      .map((label) => optionMap.get(label))
      .filter((year): year is TimetableYearBounds => !!year);
  }

  applySimulationSelection(sim: SimulationRecord | null): void {
    if (!sim) {
      this.deps.data.setPlanningVariant(null);
      return;
    }
    this.deps.data.setPlanningVariant({
      id: sim.id,
      label: sim.label,
      type: sim.productive ? 'productive' : 'simulation',
      timetableYearLabel: sim.timetableYearLabel,
    });
  }

  private createEmptyYearSelection(): Record<PlanningStageId, Set<string>> {
    return this.deps.stageOrder.reduce((record, stage) => {
      record[stage] = new Set<string>();
      return record;
    }, {} as Record<PlanningStageId, Set<string>>);
  }

  private areSetsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) {
      return false;
    }
    for (const value of a) {
      if (!b.has(value)) {
        return false;
      }
    }
    return true;
  }
}
