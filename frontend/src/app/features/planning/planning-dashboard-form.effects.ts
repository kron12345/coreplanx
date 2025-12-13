import { DestroyRef, effect } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SimulationRecord } from '../../core/models/simulation.model';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningStageId } from './planning-stage.model';
import { toLocalDateTime } from './planning-dashboard-time.utils';

export interface PlanningDashboardFormEffectsDeps {
  destroyRef: DestroyRef;
  activityForm: FormGroup;
  activityFormTypeSignal: (value?: string) => string;
  setActivityFormType: (value: string) => void;
  setActivityFormPristine: () => void;
  findActivityType: (typeId: string | null | undefined) => { timeMode?: string } | null;
  selectedCatalogOption: () => { activityTypeId?: string; label?: string } | null;
  selectedActivityState: PlanningDashboardActivitySelectionFacade['selectedActivityState'];
  activitySelection: PlanningDashboardActivitySelectionFacade;
  isPendingSelection: (activityId: string | null | undefined) => boolean;
  clearEditingPreview: () => void;
  updatePendingActivityFromForm: () => void;
  updateEditingPreviewFromForm: () => void;
  activityCreationOptions: () => Array<{ id: string }>;
  activityCreationToolSignal: (value?: string) => string;
  setActivityCreationTool: (value: string) => void;
  selectedCatalogOptionMapHas: (key: string) => boolean;
  activityCreationToolSetter: (value: string) => void;
  activityTypeCandidates: () => any[];
  quickActivityTypes: () => any[];
  activityTypeMenuSelection: { set: (val: any) => void; (): any };
  typePickerOpenSignal: { set: (val: boolean) => void };
}

export function initFormEffects(deps: PlanningDashboardFormEffectsDeps): void {
  deps.activityForm.valueChanges
    .pipe(takeUntilDestroyed(deps.destroyRef))
    .subscribe(() => {
      deps.updatePendingActivityFromForm();
      deps.updateEditingPreviewFromForm();
    });

  effect(() => {
    const selection = deps.activitySelection.selectedActivityState();
    const defaultCatalog = deps.selectedCatalogOption();
    const defaultTypeId = defaultCatalog?.activityTypeId ?? '';
    if (!selection) {
      deps.activityForm.reset({
        start: '',
        end: '',
        type: defaultTypeId,
        from: '',
        to: '',
        remark: '',
      });
      deps.setActivityFormType(defaultTypeId);
      deps.clearEditingPreview();
      return;
    }
    deps.activityForm.setValue({
      start: toLocalDateTime(selection.activity.start),
      end: selection.activity.end ? toLocalDateTime(selection.activity.end) : '',
      type: selection.activity.type ?? '',
      from: selection.activity.from ?? '',
      to: selection.activity.to ?? '',
      remark: selection.activity.remark ?? '',
    });
    deps.setActivityFormType(selection.activity.type ?? '');
    deps.clearEditingPreview();
    if (!deps.isPendingSelection(selection.activity.id)) {
      deps.setActivityFormPristine();
    }
  });

  effect(() => {
    const selection = deps.activitySelection.selectedActivityState();
    if (selection) {
      return;
    }
    const option = deps.selectedCatalogOption();
    const typeId = option?.activityTypeId ?? '';
    deps.activityForm.controls['type'].setValue(typeId);
    deps.setActivityFormType(typeId);
  });

  effect(() => {
    const options = deps.activityCreationOptions();
    if (options.length === 0) {
      deps.activityCreationToolSetter('');
      return;
    }
    const current = deps.activityCreationToolSignal();
    if (!current || !options.some((option) => option.id === current)) {
      deps.activityCreationToolSetter(options[0].id);
    }
  });

  effect(() => {
    const selection = deps.activitySelection.selectedActivityState();
    const attrs = selection?.activity.attributes as Record<string, unknown> | undefined;
    const activityKey = attrs && typeof attrs['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
    if (activityKey && deps.selectedCatalogOptionMapHas(activityKey)) {
      deps.activityCreationToolSetter(activityKey);
    }
  });

  effect(() => {
    const groups = deps.activityTypeCandidates();
    const selection = deps.activityTypeMenuSelection();
    if (!groups.length) {
      deps.activityTypeMenuSelection.set(null);
      return;
    }
    if (!selection || !groups.some((group: any) => group.id === selection)) {
      deps.activityTypeMenuSelection.set(groups[0].id);
    }
  });

  effect(() => {
    const typeId = deps.activityFormTypeSignal();
    const definition = deps.findActivityType(typeId);
    if (definition?.timeMode === 'point') {
      const control = deps.activityForm.controls['end'];
      if (control.value) {
        control.setValue('', { emitEvent: false });
        control.markAsPristine();
      }
    }
  });
}

export interface PlanningDashboardSimulationEffectsDeps {
  simulationOptions: () => SimulationRecord[];
  selectedSimulationSignal: { set: (val: SimulationRecord | null) => void; (): SimulationRecord | null };
  filterFacade: PlanningDashboardFilterFacade;
  dataSetPlanningVariant: (variant: any) => void;
}

export function initSimulationSelectionEffects(deps: PlanningDashboardSimulationEffectsDeps): void {
  effect(() => {
    const options = deps.simulationOptions();
    if (!options.length) {
      deps.selectedSimulationSignal.set(null);
      deps.filterFacade.applySimulationSelection(null);
      return;
    }
    const current = deps.selectedSimulationSignal();
    const next =
      (current && options.find((sim) => sim.id === current.id)) ??
      options.find((sim) => sim.productive) ??
      options[0];
    if (!current || current.id !== next.id) {
      deps.selectedSimulationSignal.set(next);
      deps.filterFacade.applySimulationSelection(next);
    } else {
      deps.filterFacade.applySimulationSelection(current);
    }
  });
}
