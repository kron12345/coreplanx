import { Signal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { Activity } from '../../models/activity';
import { ActivityFieldKey, ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { PlanningStageId } from './planning-stage.model';
import { PlanningDashboardActivityFacade, PendingActivityState } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningDashboardPendingFacade } from './planning-dashboard-pending.facade';
import { buildActivityFromForm, areActivitiesEquivalent } from './planning-dashboard-activity.handlers';
import { fromLocalDateTime, toLocalDateTime } from './planning-dashboard-time.utils';

export class PlanningDashboardFormFacade {
  constructor(
    private readonly deps: {
      activityForm: FormGroup;
      activityFacade: PlanningDashboardActivityFacade;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      pendingFacade: PlanningDashboardPendingFacade;
      pendingActivitySignal: Signal<PendingActivityState | null>;
      activeStage: () => PlanningStageId;
      selectedCatalogOption: () => ActivityCatalogOption | null;
      findActivityType: (typeId: string | null | undefined) => ActivityTypeDefinition | null;
      buildActivityTitle: (definition: ActivityTypeDefinition | null) => string;
      definitionHasField: (definition: ActivityTypeDefinition | null, field: ActivityFieldKey) => boolean;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      setEditPreview: (state: { stage: PlanningStageId; activity: Activity } | null) => void;
      clearEditPreview: () => void;
    },
  ) {}

  updatePendingActivityFromForm(): void {
    this.deps.activityFacade.updatePendingFromForm(
      this.deps.activeStage(),
      this.deps.activitySelection.selectedActivityState(),
      this.deps.pendingActivitySignal(),
      (selection) =>
        buildActivityFromForm(selection, this.deps.activityForm.getRawValue(), {
          findActivityType: (id) => this.deps.findActivityType(id),
          selectedCatalogOption: this.deps.selectedCatalogOption,
          buildActivityTitle: (definition) => this.deps.buildActivityTitle(definition),
          definitionHasField: (definition, field) => this.deps.definitionHasField(definition, field as ActivityFieldKey),
          applyActivityTypeConstraints: (activity) => this.deps.applyActivityTypeConstraints(activity),
        }),
      (a, b) => areActivitiesEquivalent(a, b),
      (activity) => this.deps.pendingFacade.commitPendingActivityUpdate(activity),
    );
  }

  updateEditingPreviewFromForm(): void {
    const selection = this.deps.activitySelection.selectedActivityState();
    if (!selection) {
      this.deps.clearEditPreview();
      return;
    }
    if (this.deps.pendingFacade.isPendingSelection(selection.activity.id)) {
      this.deps.clearEditPreview();
      return;
    }
    const normalized = buildActivityFromForm(selection, this.deps.activityForm.getRawValue(), {
      findActivityType: (id) => this.deps.findActivityType(id),
      selectedCatalogOption: this.deps.selectedCatalogOption,
      buildActivityTitle: (definition) => this.deps.buildActivityTitle(definition),
      definitionHasField: (definition, field) => this.deps.definitionHasField(definition, field as ActivityFieldKey),
      applyActivityTypeConstraints: (activity) => this.deps.applyActivityTypeConstraints(activity),
    });
    if (!normalized) {
      this.deps.clearEditPreview();
      return;
    }
    if (areActivitiesEquivalent(selection.activity, normalized)) {
      this.deps.clearEditPreview();
      return;
    }
    this.deps.setEditPreview({ stage: this.deps.activeStage(), activity: normalized });
  }

  adjustFormEndBy(deltaMinutes: number): void {
    const value = this.deps.activityForm.getRawValue();
    if (!value.start) {
      return;
    }
    const start = fromLocalDateTime(value.start);
    if (!start) {
      return;
    }
    const baseEnd = value.end ? fromLocalDateTime(value.end) : new Date(start);
    if (!baseEnd) {
      return;
    }
    const nextEndMs = baseEnd.getTime() + deltaMinutes * 60 * 1000;
    const minEndMs = start.getTime() + 60 * 1000;
    const safeEnd = new Date(Math.max(nextEndMs, minEndMs));
    const nextEndLocal = toLocalDateTime(safeEnd.toISOString());
    this.deps.activityForm.controls['end'].setValue(nextEndLocal);
    this.deps.activityForm.controls['end'].markAsDirty();
  }

  shiftFormBy(deltaMinutes: number): void {
    const value = this.deps.activityForm.getRawValue();
    if (!value.start) {
      return;
    }
    const start = fromLocalDateTime(value.start);
    if (!start) {
      return;
    }
    const end = value.end ? fromLocalDateTime(value.end) : null;
    const deltaMs = deltaMinutes * 60 * 1000;
    const nextStart = new Date(start.getTime() + deltaMs);
    this.deps.activityForm.controls['start'].setValue(toLocalDateTime(nextStart.toISOString()));
    this.deps.activityForm.controls['start'].markAsDirty();
    if (end) {
      const nextEnd = new Date(end.getTime() + deltaMs);
      this.deps.activityForm.controls['end'].setValue(toLocalDateTime(nextEnd.toISOString()));
      this.deps.activityForm.controls['end'].markAsDirty();
    }
  }
}
