import { Activity } from '../../models/activity';
import { Resource, ResourceKind } from '../../models/resource';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { buildAttributesFromCatalog } from './planning-dashboard-activity.utils';
import {
  addParticipantToActivity,
  expandRelevantParticipantKinds,
  filterParticipantsByKind,
  isPersonnelKind,
  isVehicleKind,
  resolveSuggestedParticipantRole,
} from './planning-dashboard-participant.utils';
import { readAttributeBoolean } from '../../core/utils/activity-definition.utils';
import { fromLocalDateTime } from './planning-dashboard-time.utils';
import { resolveLinkedServiceFieldState } from './planning-dashboard-linked-service.utils';

export interface BuildActivityFromFormDeps {
  findCatalogOptionByTypeId: (typeId: string | null | undefined) => ActivityCatalogOption | null;
  selectedCatalogOption: () => ActivityCatalogOption | null;
  buildActivityTitle: (label?: string | null) => string;
  definitionHasField: (definition: ActivityCatalogOption, field: string) => boolean;
  applyActivityTypeConstraints: (activity: Activity) => Activity;
  resolveResourceById?: (resourceId: string) => Resource | null;
}

export function buildActivityFromForm(
  selection: { activity: Activity; resource: Resource } | null,
  formValue: {
    start?: string | null;
    end?: string | null;
    durationMinutes?: string | number | null;
    type?: string | null;
    from?: string | null;
    to?: string | null;
    remark?: string | null;
    linkedServiceId?: string | null;
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
  const definition =
    deps.findCatalogOptionByTypeId(desiredType) ??
    deps.findCatalogOptionByTypeId(selection.activity.type ?? null);
  const catalogOption = deps.selectedCatalogOption();
  const attrs = selection.activity.attributes as Record<string, unknown> | undefined;
  const activityKey = typeof attrs?.['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
  const matchesKey = !!activityKey && catalogOption?.id === activityKey;
  const matchesType = !!desiredType && catalogOption?.activityTypeId === desiredType;
  const catalog = matchesKey || matchesType ? catalogOption : null;
  const isPoint = definition?.timeMode === 'point';
  const breakAttrs = (catalog?.attributes ?? definition?.attributes) ?? null;
  const isBreakType =
    readAttributeBoolean(breakAttrs, 'is_break') || readAttributeBoolean(breakAttrs, 'is_short_break');
  const parseDuration = () => {
    const raw = formValue.durationMinutes;
    const val = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
    if (!Number.isFinite(val)) {
      return null;
    }
    const minutes = Math.trunc(val);
    return minutes > 0 ? minutes : null;
  };
  const durationMinutes = parseDuration();

  const endDateRaw = !isPoint && formValue.end ? fromLocalDateTime(formValue.end) : null;
  const endFromDuration =
    !isPoint && durationMinutes ? new Date(startDate.getTime() + durationMinutes * 60_000) : null;
  const endCandidate = endDateRaw ?? endFromDuration;
  const endDateValid = endCandidate && endCandidate.getTime() > startDate.getTime() ? endCandidate : null;
  const mergedAttributes = catalog
    ? { ...(selection.activity.attributes ?? {}), ...(buildAttributesFromCatalog(catalog) ?? {}) }
    : selection.activity.attributes;
  const cleanedAttributes =
    isBreakType && mergedAttributes && typeof mergedAttributes === 'object' && !Array.isArray(mergedAttributes)
      ? (() => {
          const attrs = { ...(mergedAttributes as Record<string, unknown>) };
          delete attrs['is_service_start'];
          delete attrs['is_service_end'];
          if (attrs['activityKey'] && typeof attrs['activityKey'] === 'string' && attrs['activityKey'] !== desiredType) {
            delete attrs['activityKey'];
            delete attrs['templateId'];
          }
          return attrs;
        })()
      : mergedAttributes;
  const relevantFor = catalog?.relevantFor ?? definition?.relevantFor ?? null;
  const allowedKinds = expandRelevantParticipantKinds(relevantFor);
  const linkState = resolveLinkedServiceFieldState({
    anchor: selection.resource,
    definition,
    catalogOption: catalog,
  });
  const rawLinkedServiceId = (formValue.linkedServiceId ?? '').toString().trim();
  const linkedServiceId = rawLinkedServiceId.length ? rawLinkedServiceId : null;

  const updated: Activity = {
    ...selection.activity,
    title: deps.buildActivityTitle(catalog?.label ?? definition?.label ?? null),
    start: startDate.toISOString(),
    end: endDateValid ? endDateValid.toISOString() : null,
    type: desiredType || selection.activity.type || '',
    attributes: cleanedAttributes,
  };
  if (isBreakType) {
    updated.serviceRole = null;
  }

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

  const withLinkedService = (() => {
    if (!linkState.kind || !linkState.visible) {
      return updated;
    }
    const participants = updated.participants ?? [];
    const removeByCategory = (kind: ResourceKind) =>
      participants.filter((participant) =>
        isVehicleKind(kind) ? !isVehicleKind(participant.kind) : !isPersonnelKind(participant.kind),
      );
    if (!linkedServiceId) {
      const cleaned = removeByCategory(linkState.kind);
      return cleaned.length === participants.length ? updated : { ...updated, participants: cleaned };
    }
    if (!deps.resolveResourceById) {
      return updated;
    }
    const linkedResource = deps.resolveResourceById(linkedServiceId);
    if (!linkedResource || linkedResource.kind !== linkState.kind) {
      return updated;
    }
    const cleaned = removeByCategory(linkState.kind);
    let next = cleaned.length === participants.length ? updated : { ...updated, participants: cleaned };
    return addParticipantToActivity(
      next,
      selection.resource,
      linkedResource,
      resolveSuggestedParticipantRole(next, linkedResource),
      { retainPreviousOwner: true },
    );
  })();

  const filtered = filterParticipantsByKind(withLinkedService, allowedKinds);
  return deps.applyActivityTypeConstraints(filtered);
}

export function areActivitiesEquivalent(a: Activity, b: Activity): boolean {
  const norm = (value: string | null | undefined) => value ?? '';
  const participantsKey = (activity: Activity) => {
    const participants = activity.participants ?? [];
    if (!participants.length) {
      return '';
    }
    return participants
      .map((participant) => `${participant.resourceId}|${participant.kind}|${participant.role ?? ''}`)
      .sort()
      .join(';');
  };
  return (
    a.start === b.start &&
    (a.end ?? null) === (b.end ?? null) &&
    norm(a.type) === norm(b.type) &&
    norm(a.title) === norm(b.title) &&
    norm(a.from) === norm(b.from) &&
    norm(a.to) === norm(b.to) &&
    norm(a.remark) === norm(b.remark) &&
    participantsKey(a) === participantsKey(b)
  );
}
