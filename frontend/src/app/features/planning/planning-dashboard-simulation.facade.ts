import { Signal, computed } from '@angular/core';
import { SimulationService } from '../../core/services/simulation.service';
import { SimulationRecord } from '../../core/models/simulation.model';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';

export class PlanningDashboardSimulationFacade {
  readonly simulationOptions: Signal<SimulationRecord[]>;
  readonly selectedSimulationId: Signal<string | null>;
  readonly selectedSimulationLabel: Signal<string>;

  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      stageYearSelectionState: Signal<Record<PlanningStageId, Set<string>>>;
      filterFacade: PlanningDashboardFilterFacade;
      timetableYearOptions: Signal<TimetableYearBounds[]>;
      simulationService: SimulationService;
      selectedSimulationSignal: Signal<SimulationRecord | null> & { set: (val: SimulationRecord | null) => void };
    },
  ) {
    this.simulationOptions = computed<SimulationRecord[]>(() => {
      const stage = this.deps.activeStage();
      const years = Array.from(this.deps.stageYearSelectionState()[stage] ?? []);
      const fallbackYear = this.deps.filterFacade.preferredYearLabel(this.deps.timetableYearOptions());
      const targetYears = years.length ? years : [fallbackYear];
      const entries: SimulationRecord[] = [];
      targetYears.forEach((label) => {
        this.deps.simulationService.byTimetableYear(label).forEach((sim) => entries.push(sim));
      });
      const filtered = stage === 'operations' ? entries.filter((entry) => entry.productive) : entries;
      return filtered.sort((a, b) => {
        if (!!a.productive !== !!b.productive) {
          return a.productive ? -1 : 1;
        }
        return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
      });
    });

    this.selectedSimulationId = computed(() => this.deps.selectedSimulationSignal()?.id ?? null);

    this.selectedSimulationLabel = computed(() => {
      const sim = this.deps.selectedSimulationSignal();
      if (!sim) {
        return 'Variante wählen';
      }
      const prefix = sim.productive ? 'Produktiv' : 'Simulation';
      return `${prefix}: ${sim.label}`;
    });
  }

  onSimulationSelect(simulationId: string): void {
    const sim = this.simulationOptions().find((entry) => entry.id === simulationId);
    if (!sim) {
      return;
    }
    this.deps.selectedSimulationSignal.set(sim);
    this.deps.filterFacade.applySimulationSelection(sim);
  }
}
