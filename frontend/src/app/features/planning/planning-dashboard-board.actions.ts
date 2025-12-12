import { PlanningBoard } from './stores/planning-stage.store';
import { PlanningDashboardBoardFacade } from './planning-dashboard-board.facade';
import { Resource } from '../../models/resource';
import { Activity } from '../../models/activity';
import { PlanningStageId } from './planning-stage.model';

export class PlanningDashboardBoardActionsFacade {
  constructor(
    private readonly deps: {
      boardFacade: PlanningDashboardBoardFacade;
      activeStage: () => PlanningStageId;
      selectedResourceIds: () => string[];
      stageResourceSignals: Record<PlanningStageId, () => Resource[]>;
      stageStore: { stageState: (stage: PlanningStageId) => () => { boards: PlanningBoard[]; activeBoardId?: string | null } };
      pendingActivityForStage: (stage: PlanningStageId) => Activity | null;
      previewActivityForStage: (stage: PlanningStageId) => Activity | null;
      activityOwnerId: (activity: Activity) => string | null;
    },
  ) {}

  createBoardFromSelection(): void {
    const stage = this.deps.activeStage();
    const selection = this.deps.selectedResourceIds();
    const resources = this.deps.stageResourceSignals[stage]();
    this.deps.boardFacade.createBoardFromSelection(stage, selection, resources);
  }

  addSelectionToBoard(boardId: string): void {
    const stage = this.deps.activeStage();
    const selection = this.deps.selectedResourceIds();
    this.deps.boardFacade.addSelectionToBoard(stage, boardId, selection);
  }

  replaceBoardWithSelection(boardId: string): void {
    const stage = this.deps.activeStage();
    const selection = this.deps.selectedResourceIds();
    this.deps.boardFacade.replaceBoardWithSelection(stage, boardId, selection);
  }

  setSelectionFromBoard(boardId: string): void {
    const stage = this.deps.activeStage();
    this.deps.boardFacade.setSelectionFromBoard(stage, boardId);
  }

  removeBoard(boardId: string): void {
    const stage = this.deps.activeStage();
    this.deps.boardFacade.removeBoard(stage, boardId);
  }

  removeResourceFromBoard(boardId: string, resourceId: string): void {
    const stage = this.deps.activeStage();
    this.deps.boardFacade.removeResourceFromBoard(stage, boardId, resourceId);
  }

  handleBoardIndexChange(index: number): void {
    const stage = this.deps.activeStage();
    this.deps.boardFacade.handleBoardIndexChange(stage, index);
  }

  boardResources(board: PlanningBoard): Resource[] {
    const stage = this.deps.activeStage();
    return this.deps.boardFacade.boardResources(stage, board);
  }

  boardActivities(board: PlanningBoard): Activity[] {
    const stage = this.deps.activeStage();
    return this.deps.boardFacade.boardActivities(stage, board);
  }

  boardPendingActivity(board: PlanningBoard): Activity | null {
    const stage = this.deps.activeStage();
    const pending = this.deps.pendingActivityForStage(stage);
    if (pending) {
      const ownerId = this.deps.activityOwnerId(pending);
      if (ownerId && board.resourceIds.includes(ownerId)) {
        return pending;
      }
    }
    const preview = this.deps.previewActivityForStage(stage);
    if (preview) {
      const ownerId = this.deps.activityOwnerId(preview);
      if (ownerId && board.resourceIds.includes(ownerId)) {
        return preview;
      }
    }
    return null;
  }

  selectedBoardIndex(): number {
    const stage = this.deps.activeStage();
    const state = this.deps.stageStore.stageState(stage)();
    return Math.max(0, state.boards.findIndex((board) => board.id === state.activeBoardId));
  }
}
