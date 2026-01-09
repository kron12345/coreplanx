import { FormGroup } from '@angular/forms';
import type { ActivityCategory } from '../../core/models/activity-definition';
import { ActivityCatalogOption } from './planning-dashboard.types';

export class PlanningDashboardUiFacade {
  constructor(
    private readonly deps: {
      activityCreationOptions: () => ActivityCatalogOption[];
      activityCatalogOptionMap: () => Map<string, ActivityCatalogOption>;
      activityCreationToolSignal: { (): string; set: (val: string) => void };
      activityFormTypeSignal: { set: (val: string) => void };
      activityTypeMenuSelection: { (): ActivityCategory | null; set: (val: ActivityCategory | null) => void };
      activityForm: FormGroup;
    },
  ) {}

  setActivityCreationTool(tool: string): void {
    const options = this.deps.activityCreationOptions();
    const next = options.some((option) => option.id === tool) ? tool : options[0]?.id ?? '';
    this.deps.activityCreationToolSignal.set(next);
  }

  isActivityOptionSelected(optionId: string): boolean {
    return this.deps.activityCreationToolSignal() === optionId;
  }

  selectCatalogActivity(optionId: string): void {
    const option = this.deps.activityCatalogOptionMap().get(optionId);
    if (!option) {
      return;
    }
    this.deps.activityCreationToolSignal.set(option.id);
    this.deps.activityForm.controls['type'].setValue(option.activityTypeId);
    this.deps.activityForm.controls['type'].markAsDirty();
    this.deps.activityFormTypeSignal.set(option.activityTypeId);
  }

  setActivityTypePickerGroup(groupId: ActivityCategory): void {
    if (!groupId || this.deps.activityTypeMenuSelection() === groupId) {
      return;
    }
    this.deps.activityTypeMenuSelection.set(groupId);
  }
}
