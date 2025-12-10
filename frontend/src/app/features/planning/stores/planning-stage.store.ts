import { Signal, computed, signal } from '@angular/core';
import { PlanningStageId } from '../planning-stage.model';
import { Resource } from '../../../models/resource';

export interface PlanningBoard {
  id: string;
  title: string;
  resourceIds: string[];
  createdAt: number;
}

export interface StageRuntimeState {
  boards: PlanningBoard[];
  selectedResourceIds: Set<string>;
  activeBoardId: string;
}

export interface StageResourceGroupConfig {
  category: string;
  label: string;
  description: string;
  icon: string;
}

export interface ResourceGroupView extends StageResourceGroupConfig {
  resources: Resource[];
}

export class PlanningStageStore {
  private readonly state = signal<Record<PlanningStageId, StageRuntimeState>>({
    base: { boards: [], selectedResourceIds: new Set(), activeBoardId: '' },
    operations: { boards: [], selectedResourceIds: new Set(), activeBoardId: '' },
  });

  readonly stages = computed(() => this.state());

  snapshot(): Record<PlanningStageId, StageRuntimeState> {
    return this.state();
  }

  stageState(stage: PlanningStageId): Signal<StageRuntimeState> {
    return computed(() => this.state()[stage]);
  }

  ensureInitialized(stage: PlanningStageId, boards: PlanningBoard[]): void {
    this.state.update((state) => {
      const current = state[stage];
      if (current.boards.length || !boards.length) {
        return state;
      }
      return {
        ...state,
        [stage]: { ...current, boards, activeBoardId: boards[0]?.id ?? '' },
      };
    });
  }

  setBoards(stage: PlanningStageId, boards: PlanningBoard[], activeBoardId?: string): void {
    this.state.update((state) => ({
      ...state,
      [stage]: {
        ...state[stage],
        boards,
        activeBoardId:
          activeBoardId ??
          boards.find((b) => b.id === state[stage].activeBoardId)?.id ??
          boards[0]?.id ??
          '',
      },
    }));
  }

  setActiveBoard(stage: PlanningStageId, boardId: string): void {
    this.state.update((state) => ({
      ...state,
      [stage]: { ...state[stage], activeBoardId: boardId },
    }));
  }

  updateStage(
    stage: PlanningStageId,
    reducer: (state: StageRuntimeState) => StageRuntimeState,
  ): void {
    this.state.update((state) => ({
      ...state,
      [stage]: reducer({
        boards: state[stage].boards.map((board) => ({
          ...board,
          resourceIds: [...board.resourceIds],
        })),
        selectedResourceIds: new Set(state[stage].selectedResourceIds),
        activeBoardId: state[stage].activeBoardId,
      }),
    }));
  }

  toggleResourceSelection(stage: PlanningStageId, resourceId: string): void {
    this.state.update((state) => {
      const current = new Set(state[stage].selectedResourceIds);
      if (current.has(resourceId)) {
        current.delete(resourceId);
      } else {
        current.add(resourceId);
      }
      return { ...state, [stage]: { ...state[stage], selectedResourceIds: current } };
    });
  }

  setSelection(stage: PlanningStageId, resourceIds: string[]): void {
    this.state.update((state) => ({
      ...state,
      [stage]: { ...state[stage], selectedResourceIds: new Set(resourceIds) },
    }));
  }

  clearSelection(stage: PlanningStageId): void {
    this.state.update((state) => ({
      ...state,
      [stage]: { ...state[stage], selectedResourceIds: new Set() },
    }));
  }
}
