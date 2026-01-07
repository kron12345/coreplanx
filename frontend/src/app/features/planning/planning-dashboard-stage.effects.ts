import { effect, Signal } from '@angular/core';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { Activity } from '../../models/activity';
import { PlanningDashboardBoardFacade } from './planning-dashboard-board.facade';
import { TemplateTimelineStoreService } from './template-timeline-store.service';
import { PlanningDataService } from './planning-data.service';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { Resource } from '../../models/resource';

export function initTemplateTimelineEffects(deps: {
  templateStore: TemplateTimelineStoreService;
  computeBaseTimelineRange: () => any;
  data: PlanningDataService;
  currentVariantId: () => string;
}): void {
  effect(() => {
    const template = deps.templateStore.selectedTemplateWithFallback();
    const currentVariantId = (deps.currentVariantId() ?? '').trim() || 'default';
    const rawTemplateVariantId = (template?.variantId ?? '').trim();
    const templateVariantId = rawTemplateVariantId.length ? rawTemplateVariantId : currentVariantId;
    const effectiveTemplate =
      template?.id && templateVariantId === currentVariantId ? template : null;
    const templateId = effectiveTemplate?.id ?? null;
    const range = deps.computeBaseTimelineRange();
    deps.data.setBaseTimelineRange(range);
    deps.data.setBaseTemplateContext(templateId, {
      periods: effectiveTemplate?.periods ?? null,
      specialDays: effectiveTemplate?.specialDays ?? null,
    });
    if (templateId) {
      deps.data.reloadBaseTimeline();
    }
  });
}

export function initStageResourceEffects(deps: {
  stageOrder: PlanningStageId[];
  stageResourceSignals: Record<PlanningStageId, Signal<Resource[]>>;
  boardFacade: PlanningDashboardBoardFacade;
}): void {
  deps.stageOrder.forEach((stage) => {
    effect(() => {
      deps.stageResourceSignals[stage]();
      deps.boardFacade.ensureStageInitialized(stage);
    });
    const snapshot = deps.stageResourceSignals[stage]();
    if (snapshot.length > 0) {
      deps.boardFacade.ensureStageInitialized(stage);
    }
  });
}

export function initStageCleanupEffects(deps: {
  pendingActivitySignal: { set: (val: any) => void; (): { stage: PlanningStageId; activity: Activity } | null };
  activeStageSignal: () => PlanningStageId;
  activitySelection: PlanningDashboardActivitySelectionFacade;
  activityEditPreviewSignal: { set: (val: any) => void; (): { stage: PlanningStageId } | null };
  clearEditingPreview: () => void;
}): void {
  effect(() => {
    const pending = deps.pendingActivitySignal();
    const activeStage = deps.activeStageSignal();
    if (pending && pending.stage !== activeStage) {
      if (deps.activitySelection.selectedActivityState()?.activity.id === pending.activity.id) {
        deps.activitySelection.selectedActivityState.set(null);
      }
      deps.pendingActivitySignal.set(null);
    }
  });

  effect(() => {
    const preview = deps.activityEditPreviewSignal();
    const activeStage = deps.activeStageSignal();
    if (preview && preview.stage !== activeStage) {
      deps.clearEditingPreview();
    }
  });
}

export function initTimetableYearEffects(deps: {
  stageOrder: PlanningStageId[];
  timetableYearOptions: () => TimetableYearBounds[];
  filterFacade: PlanningDashboardFilterFacade;
}): void {
  effect(() => {
    const options = deps.timetableYearOptions();
    deps.stageOrder.forEach((stage) => deps.filterFacade.ensureStageYearSelection(stage, options));
  });
}

export function initSelectionMaintenanceEffects(deps: {
  activeStageSignal: () => PlanningStageId;
  normalizedStageActivitySignals: Record<PlanningStageId, Signal<Activity[]>>;
  activitySelection: PlanningDashboardActivitySelectionFacade;
  pendingActivitySignal: { (): { stage: PlanningStageId; activity: Activity } | null };
  moveTargetOptions: () => Resource[];
  activityMoveTargetSignal: { set: (val: string) => void; (): string };
}): void {
  effect(() => {
    const stage = deps.activeStageSignal();
    const activities = deps.normalizedStageActivitySignals[stage]();
    const validIds = new Set(activities.map((activity) => activity.id));
    const currentSelection = deps.activitySelection.selectedActivityIds();
    if (currentSelection.size === 0) {
      return;
    }
    const filtered = Array.from(currentSelection).filter((id) => validIds.has(id));
    if (filtered.length !== currentSelection.size) {
      deps.activitySelection.selectedActivityIds.set(new Set(filtered));
    }
  });

  effect(() => {
    const stage = deps.activeStageSignal();
    const activities = deps.normalizedStageActivitySignals[stage]();
    const selected = deps.activitySelection.selectedActivityState();
    if (!selected) {
      return;
    }
    const pending = deps.pendingActivitySignal();
    if (pending && deps.activitySelection.isPendingSelection(selected.activity.id, pending, stage)) {
      return;
    }
    if (activities.some((activity) => activity.id === selected.activity.id)) {
      return;
    }
    deps.activitySelection.selectedActivityState.set(null);
    const slot = deps.activitySelection.selectedActivitySlot();
    if (slot?.activityId === selected.activity.id) {
      deps.activitySelection.selectedActivitySlot.set(null);
    }
  });

  effect(() => {
    const options = deps.moveTargetOptions();
    const current = deps.activityMoveTargetSignal();
    if (options.length === 0) {
      if (current) {
        deps.activityMoveTargetSignal.set('');
      }
      return;
    }
    if (!current || !options.some((resource) => resource.id === current)) {
      deps.activityMoveTargetSignal.set(options[0].id);
    }
  });
}
