import { PlanningDashboardYearFacade } from './planning-dashboard-year.facade';
import { PlanningDashboardSimulationFacade } from './planning-dashboard-simulation.facade';

export class PlanningDashboardFilterHandlers {
  constructor(
    private readonly deps: {
      yearFacade: PlanningDashboardYearFacade;
      simulationFacade: PlanningDashboardSimulationFacade;
    },
  ) {}

  isTimetableYearSelected(label: string): boolean {
    return this.deps.yearFacade.isTimetableYearSelected(label);
  }

  onTimetableYearToggle(label: string, checked: boolean): void {
    this.deps.yearFacade.onTimetableYearToggle(label, checked);
  }

  selectDefaultTimetableYear(): void {
    this.deps.yearFacade.selectDefaultTimetableYear();
  }

  selectAllTimetableYears(): void {
    this.deps.yearFacade.selectAllTimetableYears();
  }

  onSimulationSelect(simulationId: string): void {
    this.deps.simulationFacade.onSimulationSelect(simulationId);
  }
}
