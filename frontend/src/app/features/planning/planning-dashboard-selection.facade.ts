import { Signal, computed } from '@angular/core';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import { PlanningStageStore, StageRuntimeState } from './stores/planning-stage.store';

type ViewMode = 'block' | 'detail';

export class PlanningDashboardSelectionFacade {
  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      stageStore: PlanningStageStore;
      resourceViewModeState: Signal<Record<PlanningStageId, Record<string, ViewMode>>>;
      setResourceViewModeState: (
        updater: (current: Record<PlanningStageId, Record<string, ViewMode>>) => Record<
          PlanningStageId,
          Record<string, ViewMode>
        >,
      ) => void;
      stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
    },
  ) {}

  resourceViewModes(): Signal<Record<string, ViewMode>> {
    return computed(() => this.deps.resourceViewModeState()[this.deps.activeStage()] ?? {});
  }

  handleResourceViewModeChange(event: { resourceId: string; mode: ViewMode }): void {
    this.deps.setResourceViewModeState((current) => {
      const stage = this.deps.activeStage();
      const stageModes = { ...(current[stage] ?? {}), [event.resourceId]: event.mode };
      return { ...current, [stage]: stageModes };
    });
  }

  onSelectionToggle(resourceId: string, selected: boolean): void {
    const stage = this.deps.activeStage();
    this.deps.stageStore.updateStage(stage, (state: StageRuntimeState) => {
      const next = new Set(state.selectedResourceIds);
      if (selected) {
        next.add(resourceId);
      } else {
        next.delete(resourceId);
      }
      return { ...state, selectedResourceIds: next };
    });
  }

  isResourceSelected(resourceId: string): boolean {
    return this.deps.stageStore.stageState(this.deps.activeStage())().selectedResourceIds.has(resourceId);
  }

  clearSelection(): void {
    const stage = this.deps.activeStage();
    this.deps.stageStore.updateStage(stage, (state: StageRuntimeState) => ({
      ...state,
      selectedResourceIds: new Set(),
    }));
  }

  selectAllResources(): void {
    const stage = this.deps.activeStage();
    const resources = this.deps.stageResourceSignals[stage]();
    this.deps.stageStore.updateStage(stage, (state: StageRuntimeState) => ({
      ...state,
      selectedResourceIds: new Set(resources.map((res) => res.id)),
    }));
  }
}
