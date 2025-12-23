import { DestroyRef, effect } from '@angular/core';
import { FormGroup, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SimulationRecord } from '../../core/models/simulation.model';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningDashboardFilterFacade } from './planning-dashboard-filter.facade';
import { PlanningDashboardActivityFacade } from './planning-dashboard-activity.facade';
import { PlanningStageId } from './planning-stage.model';
import { ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { fromLocalDateTime, toLocalDateTime } from './planning-dashboard-time.utils';

export interface PlanningDashboardFormEffectsDeps {
  destroyRef: DestroyRef;
  activityForm: FormGroup;
  activityFormTypeSignal: (value?: string) => string;
  setActivityFormType: (value: string) => void;
  setActivityFormPristine: () => void;
  findActivityType: (typeId: string | null | undefined) => ActivityTypeDefinition | null;
  selectedCatalogOption: () => { activityTypeId?: string; label?: string; defaultDurationMinutes?: number | null } | null;
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
  timeSyncSource: () => 'end' | 'duration';
  setTimeSyncSource: (value: 'end' | 'duration') => void;
}

export function initFormEffects(deps: PlanningDashboardFormEffectsDeps): void {
  let syncInProgress = false;
  const syncDurationAndEnd = () => {
    if (syncInProgress) {
      return;
    }
    syncInProgress = true;
    try {
      const typeId = deps.activityFormTypeSignal();
      const definition = deps.findActivityType(typeId);
      const endControl = deps.activityForm.controls['end'];
      const durationControl = deps.activityForm.controls['durationMinutes'];
      const syncSource = deps.timeSyncSource();

      if (definition?.timeMode === 'point') {
        if (endControl.value) {
          endControl.setValue('', { emitEvent: false });
          endControl.markAsPristine();
        }
        if (durationControl?.value) {
          durationControl.setValue('', { emitEvent: false });
          durationControl.markAsPristine();
        }
        return;
      }

      const rawStart = deps.activityForm.controls['start'].value as string | null | undefined;
      const startDate = typeof rawStart === 'string' ? fromLocalDateTime(rawStart) : null;
      if (!startDate) {
        return;
      }

      const parseDuration = (raw: unknown) => {
        const val = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
        if (!Number.isFinite(val)) {
          return null;
        }
        const minutes = Math.trunc(val);
        return minutes > 0 ? minutes : null;
      };

      const rawEnd = endControl.value as string | null | undefined;
      const endDate = typeof rawEnd === 'string' ? fromLocalDateTime(rawEnd) : null;
      let durationMinutes = parseDuration(durationControl?.value);

      const hasEnd = !!endDate && endDate.getTime() > startDate.getTime();
      const hasDuration = !!durationMinutes;

      const syncFromEnd = () => {
        if (!hasEnd) {
          return;
        }
        const minutes = Math.max(1, Math.round((endDate!.getTime() - startDate.getTime()) / 60_000));
        const desiredDuration = minutes.toString();
        if ((durationControl?.value ?? '') !== desiredDuration) {
          durationControl?.setValue(desiredDuration, { emitEvent: false });
        }
      };

      const syncFromDuration = () => {
        if (!hasDuration) {
          return;
        }
        const desiredEnd = new Date(startDate.getTime() + durationMinutes! * 60_000);
        const desiredEndLocal = toLocalDateTime(desiredEnd.toISOString());
        if (endControl.value !== desiredEndLocal) {
          endControl.setValue(desiredEndLocal, { emitEvent: false });
        }
      };

      if (syncSource === 'duration') {
        if (hasDuration) {
          syncFromDuration();
        } else {
          syncFromEnd();
        }
      } else {
        if (hasEnd) {
          syncFromEnd();
        } else {
          syncFromDuration();
        }
      }
    } finally {
      syncInProgress = false;
    }
  };

  deps.activityForm.valueChanges.pipe(takeUntilDestroyed(deps.destroyRef)).subscribe(() => {
    syncDurationAndEnd();
    deps.updatePendingActivityFromForm();
    deps.updateEditingPreviewFromForm();
  });

  effect(() => {
    const selection = deps.activitySelection.selectedActivityState();
    const defaultCatalog = deps.selectedCatalogOption();
    const defaultTypeId = defaultCatalog?.activityTypeId ?? '';
    if (!selection) {
      deps.setTimeSyncSource('duration');
      deps.activityForm.reset({
        start: '',
        end: '',
        durationMinutes: '',
        type: defaultTypeId,
        from: '',
        to: '',
        remark: '',
      });
      deps.setActivityFormType(defaultTypeId);
      deps.clearEditingPreview();
      return;
    }
    deps.setTimeSyncSource(deps.isPendingSelection(selection.activity.id) ? 'duration' : 'end');
    deps.activityForm.setValue({
      start: toLocalDateTime(selection.activity.start),
      end: selection.activity.end ? toLocalDateTime(selection.activity.end) : '',
      durationMinutes: selection.activity.end
        ? Math.max(
            1,
            Math.round((new Date(selection.activity.end).getTime() - new Date(selection.activity.start).getTime()) / 60_000),
          ).toString()
        : '',
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
      const duration = deps.activityForm.controls['durationMinutes'];
      if (duration?.value) {
        duration.setValue('', { emitEvent: false });
        duration.markAsPristine();
      }
    }
  });

  let lastPendingActivityId: string | null = null;
  let lastPendingTypeId: string | null = null;
  effect(() => {
    const selection = deps.activitySelection.selectedActivityState();
    const typeId = deps.activityFormTypeSignal();
    const definition = deps.findActivityType(typeId);

    const activityId = selection?.activity.id ?? null;
    if (!activityId || !deps.isPendingSelection(activityId)) {
      lastPendingActivityId = null;
      lastPendingTypeId = null;
      return;
    }

    if (activityId !== lastPendingActivityId) {
      lastPendingActivityId = activityId;
      lastPendingTypeId = null;
    }
    if (!typeId || typeId === lastPendingTypeId) {
      return;
    }
    lastPendingTypeId = typeId;

    if (!definition || definition.timeMode !== 'duration') {
      return;
    }
    const durationControl = deps.activityForm.controls['durationMinutes'];
    if (!durationControl.pristine) {
      return;
    }
    const rawStart = deps.activityForm.controls['start'].value as string | null | undefined;
    const startDate = typeof rawStart === 'string' ? fromLocalDateTime(rawStart) : null;
    if (!startDate) {
      return;
    }
    const option = deps.selectedCatalogOption();
    const durationMinutes = option?.defaultDurationMinutes ?? definition.defaultDurationMinutes ?? null;
    if (!durationMinutes || durationMinutes <= 0) {
      return;
    }
    durationControl.setValue(Math.trunc(durationMinutes).toString());
    durationControl.markAsPristine();
    deps.setTimeSyncSource('duration');
  });

  effect(() => {
    const typeId = deps.activityFormTypeSignal();
    const definition = deps.findActivityType(typeId);

    const attrs = definition?.attributes as Record<string, unknown> | null | undefined;
    const rawConsiderLocation = attrs?.['consider_location_conflicts'];
    const considerLocation =
      typeof rawConsiderLocation === 'boolean'
        ? rawConsiderLocation
        : typeof rawConsiderLocation === 'string'
          ? ['true', 'yes', '1'].includes(rawConsiderLocation.trim().toLowerCase())
          : false;
    const requiresRoute = !!definition && (definition.category === 'movement' || considerLocation);

    const fromRequired = !!definition && requiresRoute && definition.fields.includes('from');
    const toRequired = !!definition && requiresRoute && definition.fields.includes('to');

    const fromControl = deps.activityForm.controls['from'];
    const toControl = deps.activityForm.controls['to'];

    fromControl.setValidators(fromRequired ? [Validators.required] : []);
    fromControl.updateValueAndValidity({ emitEvent: false });
    toControl.setValidators(toRequired ? [Validators.required] : []);
    toControl.updateValueAndValidity({ emitEvent: false });
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
