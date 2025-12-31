import { Signal } from '@angular/core';
import { PlanningStageId, PlanningStageMeta, PlanningResourceCategory } from './planning-stage.model';
import { PlanningStageStore, StageRuntimeState, PlanningBoard } from './stores/planning-stage.store';
import { Resource } from '../../models/resource';
import { Activity } from '../../models/activity';

export interface StageResourceGroupConfig {
  category: PlanningResourceCategory;
  label: string;
  description: string;
  icon: string;
}

export interface BoardFacadeDeps {
  stageStore: PlanningStageStore;
  stageMetaMap: Record<PlanningStageId, PlanningStageMeta>;
  stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
  normalizedStageActivitySignals: Record<PlanningStageId, Signal<Activity[]>>;
  activityOwnerId: (activity: Activity) => string | null;
  resourceGroups: Record<PlanningStageId, StageResourceGroupConfig[]>;
}

export class PlanningDashboardBoardFacade {
  private readonly boardCounters: Record<PlanningStageId, number> = {
    base: 1,
    operations: 1,
  };

  constructor(private readonly deps: BoardFacadeDeps) {}

  ensureStageInitialized(stage: PlanningStageId): void {
    const resources = this.filterResourcesForStage(stage, this.deps.stageResourceSignals[stage]());
    if (resources.length === 0) {
      return;
    }
    const current = this.deps.stageStore.stageState(stage)();
    const state: StageRuntimeState = {
      boards: current.boards.map((board) => ({
        ...board,
        resourceIds: [...board.resourceIds],
      })),
      selectedResourceIds: new Set(current.selectedResourceIds),
      activeBoardId: current.activeBoardId,
    };
    const orderMap = this.buildResourceOrderMap(resources);
    let mutated = false;

    if (state.boards.length === 0) {
      const defaultBoards = this.createDefaultBoardsForStage(stage, resources, orderMap);
      if (defaultBoards.length === 0) {
        const fallback = this.createBoardState(
          stage,
          this.nextBoardTitle(stage, 'Grundlage'),
          resources.map((resource) => resource.id),
          orderMap,
        );
        state.boards = [fallback];
        state.activeBoardId = fallback.id;
      } else {
        state.boards = defaultBoards;
        state.activeBoardId = defaultBoards[0]?.id ?? '';
      }
      mutated = true;
    } else {
      const normalizedBoards = state.boards.map((board) => {
        const normalizedIds = this.normalizeResourceIds(board.resourceIds, stage, orderMap);
        if (!this.areIdsEqual(normalizedIds, board.resourceIds)) {
          mutated = true;
          return {
            ...board,
            resourceIds: normalizedIds,
          };
        }
        return board;
      });
      if (mutated) {
        state.boards = normalizedBoards;
      }
    }

    const filteredSelection = new Set(
      [...state.selectedResourceIds].filter((id) => orderMap.has(id)),
    );
    if (filteredSelection.size !== state.selectedResourceIds.size) {
      state.selectedResourceIds = filteredSelection;
      mutated = true;
    }

    if (!state.activeBoardId || !state.boards.some((board) => board.id === state.activeBoardId)) {
      state.activeBoardId = state.boards[0]?.id ?? '';
      mutated = true;
    }

    if (!mutated) {
      return;
    }

    this.deps.stageStore.updateStage(stage, () => state);
  }

  createBoardFromSelection(stage: PlanningStageId, selection: string[], fallbackResources: Resource[]): void {
    const resources = this.filterResourcesForStage(stage, fallbackResources);
    const resourceIds = selection.length > 0 ? selection : resources.map((resource) => resource.id);
    const board = this.createBoardState(stage, this.nextBoardTitle(stage), resourceIds);

    this.deps.stageStore.updateStage(stage, (state) => {
      state.boards.push(board);
      state.activeBoardId = board.id;
      return state;
    });
  }

  addSelectionToBoard(stage: PlanningStageId, boardId: string, selection: string[]): void {
    this.updateBoard(stage, boardId, (resourceIds) =>
      this.normalizeResourceIds([...resourceIds, ...selection], stage),
    );
  }

  replaceBoardWithSelection(stage: PlanningStageId, boardId: string, selection: string[]): void {
    this.updateBoard(stage, boardId, () => this.normalizeResourceIds(selection, stage));
  }

  setSelectionFromBoard(stage: PlanningStageId, boardId: string): void {
    const board = this.deps.stageStore.stageState(stage)().boards.find((entry) => entry.id === boardId);
    if (!board) {
      return;
    }
    this.deps.stageStore.setSelection(stage, board.resourceIds);
  }

  removeBoard(stage: PlanningStageId, boardId: string): void {
    const state = this.deps.stageStore.stageState(stage)();
    if (state.boards.length <= 1) {
      return;
    }
    this.deps.stageStore.updateStage(stage, (nextState) => {
      const index = nextState.boards.findIndex((board) => board.id === boardId);
      if (index === -1) {
        return nextState;
      }
      nextState.boards.splice(index, 1);
      if (nextState.activeBoardId === boardId) {
        const fallback = nextState.boards[Math.max(0, Math.min(index, nextState.boards.length - 1))];
        nextState.activeBoardId = fallback?.id ?? '';
      }
      return nextState;
    });
  }

  removeResourceFromBoard(stage: PlanningStageId, boardId: string, resourceId: string): void {
    this.updateBoard(stage, boardId, (resourceIds) => resourceIds.filter((id) => id !== resourceId));
  }

  handleBoardIndexChange(stage: PlanningStageId, index: number): void {
    const board = this.deps.stageStore.stageState(stage)().boards[index];
    if (!board) {
      return;
    }
    this.deps.stageStore.setActiveBoard(stage, board.id);
  }

  isActiveBoard(stage: PlanningStageId, boardId: string): boolean {
    return this.deps.stageStore.stageState(stage)().activeBoardId === boardId;
  }

  boardResources(stage: PlanningStageId, board: PlanningBoard): Resource[] {
    const resourceSet = new Set(board.resourceIds);
    return this.filterResourcesForStage(stage, this.deps.stageResourceSignals[stage]()).filter(
      (resource) => resourceSet.has(resource.id),
    );
  }

  boardActivities(stage: PlanningStageId, board: PlanningBoard): Activity[] {
    const resourceSet = new Set(board.resourceIds);
    return this.deps.normalizedStageActivitySignals[stage]().filter((activity) => {
      const participants = activity.participants ?? [];
      if (participants.some((participant) => !!participant?.resourceId && resourceSet.has(participant.resourceId))) {
        return true;
      }
      const ownerId = this.deps.activityOwnerId(activity);
      return ownerId ? resourceSet.has(ownerId) : false;
    });
  }

  normalizeResourceIds(
    resourceIds: string[],
    stage: PlanningStageId,
    order?: Map<string, number>,
  ): string[] {
    const orderMap =
      order ??
      this.buildResourceOrderMap(
        this.filterResourcesForStage(stage, this.deps.stageResourceSignals[stage]()),
      );
    const seen = new Set<string>();
    const known: Array<{ id: string; order: number }> = [];
    const unmapped: string[] = [];

    resourceIds.forEach((id) => {
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      const position = orderMap.get(id);
      if (position === undefined) {
        unmapped.push(id);
      } else {
        known.push({ id, order: position });
      }
    });

    known.sort((a, b) => a.order - b.order);
    return [...known.map((entry) => entry.id), ...unmapped];
  }

  filterResourcesForStage(stage: PlanningStageId, resources: Resource[]): Resource[] {
    if (stage === 'base') {
      const serviceResources = resources.filter((resource) => this.isServiceResource(resource));
      if (serviceResources.length > 0) {
        return serviceResources;
      }
      return resources;
    }
    return resources;
  }

  private updateBoard(
    stage: PlanningStageId,
    boardId: string,
    updater: (resourceIds: string[]) => string[],
  ): void {
    this.deps.stageStore.updateStage(stage, (state) => {
      const index = state.boards.findIndex((board) => board.id === boardId);
      if (index === -1) {
        return state;
      }
      const target = state.boards[index];
      const updatedIds = updater([...target.resourceIds]);
      state.boards.splice(index, 1, {
        ...target,
        resourceIds: this.normalizeResourceIds(updatedIds, stage),
      });
      return state;
    });
  }

  private nextBoardTitle(stage: PlanningStageId, suffix?: string): string {
    const meta = this.deps.stageMetaMap[stage];
    const counter = this.boardCounters[stage]++;
    if (suffix) {
      return `${meta.shortLabel} · Plantafel ${counter} (${suffix})`;
    }
    return `${meta.shortLabel} · Plantafel ${counter}`;
  }

  private buildResourceOrderMap(resources: Resource[]): Map<string, number> {
    const map = new Map<string, number>();
    resources.forEach((resource, index) => map.set(resource.id, index));
    return map;
  }

  private areIdsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((id, index) => id === b[index]);
  }

  private createBoardState(
    stage: PlanningStageId,
    title: string,
    resourceIds: string[],
    order?: Map<string, number>,
  ): PlanningBoard {
    return {
      id: `board-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      title,
      resourceIds: this.normalizeResourceIds(resourceIds, stage, order),
      createdAt: Date.now(),
    };
  }

  private createDefaultBoardsForStage(
    stage: PlanningStageId,
    resources: Resource[],
    orderMap: Map<string, number>,
  ): PlanningBoard[] {
    const configs = this.deps.resourceGroups[stage] ?? [];
    const boards: PlanningBoard[] = [];
    const categorized = new Set<PlanningResourceCategory>();

    configs.forEach((config) => {
      const ids = resources
        .filter((resource) => this.getResourceCategory(resource) === config.category)
        .map((resource) => resource.id);
      if (ids.length === 0) {
        return;
      }
      boards.push(
        this.createBoardState(
          stage,
          `${this.deps.stageMetaMap[stage].shortLabel} · ${config.label}`,
          ids,
          orderMap,
        ),
      );
      categorized.add(config.category);
    });

    const remaining = resources.filter((resource) => {
      const category = this.getResourceCategory(resource);
      if (!category) {
        return true;
      }
      return !categorized.has(category);
    });
    if (remaining.length > 0) {
      boards.push(
        this.createBoardState(
          stage,
          `${this.deps.stageMetaMap[stage].shortLabel} · Weitere Ressourcen`,
          remaining.map((resource) => resource.id),
          orderMap,
        ),
      );
    }

    return boards;
  }

  private getResourceCategory(resource: Resource): PlanningResourceCategory | null {
    const attributes = resource.attributes as Record<string, unknown> | undefined;
    const category = (attributes?.['category'] ?? null) as string | null;
    if (this.isPlanningResourceCategory(category)) {
      return category;
    }
    if (this.isPlanningResourceCategory(resource.kind)) {
      return resource.kind;
    }
    return null;
  }

  private isPlanningResourceCategory(
    value: string | null | undefined,
  ): value is PlanningResourceCategory {
    return (
      value === 'vehicle-service' ||
      value === 'personnel-service' ||
      value === 'vehicle' ||
      value === 'personnel'
    );
  }

  private isServiceResource(resource: Resource): boolean {
    const attrs = resource.attributes as Record<string, unknown> | undefined;
    const category = (attrs?.['category'] ?? null) as string | null;
    return category === 'vehicle-service' || category === 'personnel-service';
  }
}
