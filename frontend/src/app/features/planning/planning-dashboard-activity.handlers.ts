import { Activity } from '../../models/activity';
import { ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { buildAttributesFromCatalog } from './planning-dashboard-activity.utils';
import { fromLocalDateTime } from './planning-dashboard-time.utils';

export interface BuildActivityFromFormDeps {
  findActivityType: (typeId: string | null | undefined) => ActivityTypeDefinition | null;
  selectedCatalogOption: () => ActivityCatalogOption | null;
  buildActivityTitle: (definition: ActivityTypeDefinition | null) => string;
  definitionHasField: (definition: ActivityTypeDefinition, field: string) => boolean;
  applyActivityTypeConstraints: (activity: Activity) => Activity;
}

export function buildActivityFromForm(
  selection: { activity: Activity; resource: any } | null,
  formValue: {
    start?: string | null;
    end?: string | null;
    type?: string | null;
    from?: string | null;
    to?: string | null;
    remark?: string | null;
  },
  deps: BuildActivityFromFormDeps,
): Activity | null {
  if (!selection) {
    return null;
  }
  const startDate = formValue.start ? fromLocalDateTime(formValue.start) : null;
  if (!startDate) {
    return null;
  }
  const desiredType = formValue.type && formValue.type.length > 0 ? formValue.type : selection.activity.type ?? '';
  const definition = deps.findActivityType(desiredType) ?? deps.findActivityType(selection.activity.type ?? null);
  const catalog = deps.selectedCatalogOption();
  const isPoint = definition?.timeMode === 'point';
  const endDateRaw = !isPoint && formValue.end ? fromLocalDateTime(formValue.end) : null;
  const endDateValid = endDateRaw && endDateRaw.getTime() > startDate.getTime() ? endDateRaw : null;
  const mergedAttributes = catalog
    ? { ...(selection.activity.attributes ?? {}), ...(buildAttributesFromCatalog(catalog) ?? {}) }
    : selection.activity.attributes;

  const updated: Activity = {
    ...selection.activity,
    title: catalog?.label ?? deps.buildActivityTitle(definition ?? null),
    start: startDate.toISOString(),
    end: endDateValid ? endDateValid.toISOString() : null,
    type: desiredType || selection.activity.type || '',
    attributes: mergedAttributes,
  };

  if (definition) {
    if (deps.definitionHasField(definition, 'from')) {
      updated.from = formValue.from ?? '';
    } else {
      updated.from = undefined;
    }
    if (deps.definitionHasField(definition, 'to')) {
      updated.to = formValue.to ?? '';
    } else {
      updated.to = undefined;
    }
    if (deps.definitionHasField(definition, 'remark')) {
      updated.remark = formValue.remark ?? '';
    } else {
      updated.remark = undefined;
    }
  }

  return deps.applyActivityTypeConstraints(updated);
}

export function areActivitiesEquivalent(a: Activity, b: Activity): boolean {
  const norm = (value: string | null | undefined) => value ?? '';
  return (
    a.start === b.start &&
    (a.end ?? null) === (b.end ?? null) &&
    norm(a.type) === norm(b.type) &&
    norm(a.title) === norm(b.title) &&
    norm(a.from) === norm(b.from) &&
    norm(a.to) === norm(b.to) &&
    norm(a.remark) === norm(b.remark)
  );
}
