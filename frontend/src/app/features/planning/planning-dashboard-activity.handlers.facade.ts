import { FormGroup } from '@angular/forms';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityFieldKey, ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { PlanningDashboardActivityFacade, PendingActivityState } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningStageId } from './planning-stage.model';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { buildActivityFromForm } from './planning-dashboard-activity.handlers';
import { toLocalDateTime } from './planning-dashboard-time.utils';

export class PlanningDashboardActivityHandlersFacade {
  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      activityFacade: PlanningDashboardActivityFacade;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      templateSelected: () => boolean;
      selectedTemplateId: () => string | null;
      activityCreationTool: () => string;
      catalogOptionById: (id: string) => ActivityCatalogOption | undefined;
      resolveActivityTypeForResource: (
        resource: Resource,
        typeId: string | null | undefined,
      ) => ActivityTypeDefinition | null;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      pendingActivityOriginal: {
        (): Activity | null;
        set: (val: Activity | null) => void;
      };
      pendingActivitySignal: {
        (): PendingActivityState | null;
        set: (val: PendingActivityState | null) => void;
      };
      startPendingActivity: (stage: PlanningStageId, resource: Resource, activity: Activity) => void;
      activityForm: FormGroup;
      selectedCatalogOption: () => ActivityCatalogOption | null;
      findActivityType: (typeId: string | null | undefined) => ActivityTypeDefinition | null;
      buildActivityTitle: (definition: ActivityTypeDefinition | null) => string;
      definitionHasField: (definition: ActivityTypeDefinition | null, field: ActivityFieldKey) => boolean;
      isPendingSelection: (id: string | null | undefined) => boolean;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      saveTemplateActivity: (activity: Activity) => void;
      replaceActivity: (activity: Activity) => void;
      clearEditingPreview: () => void;
      deleteTemplateActivity: (templateId: string, baseId: string) => void;
    },
  ) {}

  handleActivityCreate(event: { resource: Resource; start: Date }): void {
    const stage = this.deps.activeStage();
    if (stage === 'base' && !this.deps.templateSelected()) {
      return;
    }
    const toolId = this.deps.activityCreationTool();
    const option = this.deps.catalogOptionById(toolId) ?? null;
    const typeId = option?.activityTypeId ?? option?.typeDefinition.id ?? null;
    const definition = this.deps.resolveActivityTypeForResource(event.resource, typeId);
    if (!definition) {
      return;
    }
    const draft = this.deps.activityFacade.createDraft(stage, event, definition, option);
    const normalized = this.deps.applyActivityTypeConstraints(draft);
    this.deps.pendingActivityOriginal.set(normalized);
    this.deps.startPendingActivity(stage, event.resource, normalized);
  }

  handleActivityEdit(event: { resource: Resource; activity: Activity }): void {
    if (!this.deps.isPendingSelection(event.activity.id)) {
      this.deps.pendingActivitySignal.set(null);
    }
    this.deps.activitySelection.selectedActivityState.set({
      resource: event.resource,
      activity: this.deps.applyActivityTypeConstraints(event.activity),
    });
    this.deps.clearEditingPreview();
  }

  resetPendingActivityEdits(): void {
    const pendingState = this.deps.pendingActivitySignal();
    const original = this.deps.pendingActivityOriginal();
    const selection = this.deps.activitySelection.selectedActivityState();
    if (!pendingState || !original || !selection) {
      return;
    }
    const stage = this.deps.activeStage();
    if (pendingState.stage !== stage || pendingState.activity.id !== original.id) {
      return;
    }
    this.deps.pendingActivitySignal.set({ stage: pendingState.stage, activity: original });
    this.deps.activitySelection.selectedActivityState.set({ activity: original, resource: selection.resource });
    this.deps.activityForm.setValue({
      start: toLocalDateTime(original.start),
      end: original.end ? toLocalDateTime(original.end) : '',
      type: original.type ?? '',
      from: original.from ?? '',
      to: original.to ?? '',
      remark: original.remark ?? '',
    });
    this.deps.activityForm.markAsPristine();
    this.deps.clearEditingPreview();
  }

  saveSelectedActivityEdits(): void {
    const selection = this.deps.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.deps.activityForm.invalid) {
      this.deps.activityForm.markAllAsTouched();
      return;
    }
    const stage = this.deps.activeStage();
    const pending = this.deps.pendingActivitySignal();
    const isPendingDraft = pending && pending.stage === stage && pending.activity.id === selection.activity.id;
    const normalized = buildActivityFromForm(selection, this.deps.activityForm.getRawValue(), {
      findActivityType: (id) => this.deps.findActivityType(id),
      selectedCatalogOption: this.deps.selectedCatalogOption,
      buildActivityTitle: (definition) => this.deps.buildActivityTitle(definition),
      definitionHasField: (definition, field) => this.deps.definitionHasField(definition, field as ActivityFieldKey),
      applyActivityTypeConstraints: (activity) => this.deps.applyActivityTypeConstraints(activity),
    });
    if (!normalized) {
      return;
    }
    if (isPendingDraft) {
      if (stage === 'base') {
        this.deps.saveTemplateActivity(normalized);
      } else {
        this.deps.updateStageActivities(stage, (activities) => [...activities, normalized]);
      }
      this.deps.pendingActivitySignal.set(null);
      this.deps.pendingActivityOriginal.set(null);
      this.deps.activitySelection.selectedActivityState.set({ activity: normalized, resource: selection.resource });
      this.deps.clearEditingPreview();
      return;
    }
    if (stage === 'base') {
      this.deps.saveTemplateActivity(normalized);
      this.deps.activitySelection.selectedActivityState.set({ activity: normalized, resource: selection.resource });
      this.deps.clearEditingPreview();
      return;
    }
    this.deps.replaceActivity(normalized);
  }

  deleteSelectedActivity(): void {
    const selection = this.deps.activitySelection.selectedActivityState();
    if (!selection) {
      return;
    }
    if (this.deps.isPendingSelection(selection.activity.id)) {
      this.deps.pendingActivitySignal.set(null);
      this.deps.activitySelection.selectedActivityState.set(null);
      this.deps.clearEditingPreview();
      return;
    }
    const stage = this.deps.activeStage();
    if (stage === 'base') {
      const templateId = this.deps.selectedTemplateId();
      if (templateId) {
        const baseId = selection.activity.id.split('@')[0] ?? selection.activity.id;
        this.deps.deleteTemplateActivity(templateId, baseId);
      }
      this.deps.activitySelection.selectedActivityState.set(null);
      this.deps.clearEditingPreview();
      return;
    }
    this.deps.updateStageActivities(stage, (activities) =>
      activities.filter((activity) => activity.id !== selection.activity.id),
    );
    this.deps.activitySelection.selectedActivityState.set(null);
    this.deps.clearEditingPreview();
  }
}
