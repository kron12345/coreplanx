import { FormGroup } from '@angular/forms';
import { Activity, ActivityParticipantRole, ServiceRole } from '../../models/activity';
import { ActivityParticipantCategory } from '../../models/activity-ownership';
import { Resource } from '../../models/resource';
import { PlanningStageId } from './planning-stage.model';
import type { ActivityFieldKey } from '../../core/models/activity-definition';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { fromLocalDateTime, toLocalDateTime } from './planning-dashboard-time.utils';

export interface PendingActivityState {
  stage: PlanningStageId;
  activity: Activity;
}

export class PlanningDashboardActivityFacade {
  constructor(
    private readonly deps: {
      activityOwnerId: (activity: Activity) => string | null;
      addParticipantToActivity: (
        activity: Activity,
        owner: Resource,
        partner?: Resource | null,
        partnerRole?: ActivityParticipantRole,
        opts?: { retainPreviousOwner?: boolean; ownerCategory?: ActivityParticipantCategory },
      ) => Activity;
      moveParticipantToResource: (activity: Activity, participantId: string, target: Resource) => Activity;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      definitionHasField: (definition: ActivityCatalogOption | null, field: ActivityFieldKey) => boolean;
      resolveServiceCategory: (resource: Resource) => Activity['serviceCategory'];
      resourceParticipantCategory: (resource: Resource | null) => ActivityParticipantCategory;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      replaceActivity: (activity: Activity) => void;
      saveTemplateActivity: (activity: Activity) => void;
      buildAttributesFromCatalog: (option: ActivityCatalogOption | null) => Record<string, unknown> | undefined;
      resolveServiceRole: (option: ActivityCatalogOption | null) => ServiceRole | null;
      buildActivityTitle: (label?: string | null) => string;
      generateActivityId: (seed: string) => string;
      findCatalogOptionByTypeId: (typeId: string | null | undefined) => ActivityCatalogOption | null;
    },
  ) {}

  createDraft(
    _stage: PlanningStageId,
    event: { resource: Resource; start: Date },
    definition: ActivityCatalogOption,
    option: ActivityCatalogOption | null,
  ): Activity {
    const durationMinutes = option?.defaultDurationMinutes ?? definition.defaultDurationMinutes ?? null;
    const endDate =
      (definition.timeMode ?? option?.timeMode) === 'duration' && typeof durationMinutes === 'number'
        ? new Date(event.start.getTime() + durationMinutes * 60 * 1000)
        : null;
    const labelSource = option?.label ?? definition.label;
    const typeId = option?.activityTypeId ?? definition.activityTypeId;
    const draft: Activity = {
      id: this.deps.generateActivityId(option?.id ?? definition.id),
      title: this.deps.buildActivityTitle(labelSource),
      start: event.start.toISOString(),
      end: endDate ? endDate.toISOString() : null,
      type: typeId,
      serviceCategory: this.deps.resolveServiceCategory(event.resource),
      serviceRole: this.deps.resolveServiceRole(option),
      attributes: this.deps.buildAttributesFromCatalog(option),
    };
    if (this.deps.definitionHasField(definition, 'from')) {
      draft.from = '';
    }
    if (this.deps.definitionHasField(definition, 'to')) {
      draft.to = '';
    }
    if (this.deps.definitionHasField(definition, 'remark')) {
      draft.remark = '';
    }
    return this.deps.addParticipantToActivity(draft, event.resource, undefined, undefined, {
      retainPreviousOwner: false,
      ownerCategory: this.deps.resourceParticipantCategory(event.resource),
    });
  }

  mapActivityToReferenceWeek(
    activity: Activity,
    periods: { validFrom: string; validTo?: string | null }[],
    defaultYearEnd: Date,
  ): Activity {
    if (!periods.length) {
      return activity;
    }
    const startDate = new Date(activity.start);
    const targetPeriod = periods.find((period) => {
      const from = new Date(period.validFrom);
      const to = period.validTo ? new Date(period.validTo) : defaultYearEnd;
      return startDate >= from && startDate <= to;
    });
    const period = targetPeriod ?? periods[0];
    const refStart = new Date(period.validFrom);
    const weekday = startDate.getUTCDay();
    const mappedStart = new Date(refStart);
    mappedStart.setUTCDate(refStart.getUTCDate() + weekday);
    const startTime =
      startDate.getUTCHours() * 3600_000 +
      startDate.getUTCMinutes() * 60_000 +
      startDate.getUTCSeconds() * 1000 +
      startDate.getUTCMilliseconds();
    mappedStart.setUTCMilliseconds(mappedStart.getUTCMilliseconds() + startTime);
    let mappedEnd: Date | null = null;
    if (activity.end) {
      const endDate = new Date(activity.end);
      const endTime =
        endDate.getUTCHours() * 3600_000 +
        endDate.getUTCMinutes() * 60_000 +
        endDate.getUTCSeconds() * 1000 +
        endDate.getUTCMilliseconds();
      mappedEnd = new Date(refStart);
      mappedEnd.setUTCDate(refStart.getUTCDate() + weekday);
      mappedEnd.setUTCMilliseconds(mappedEnd.getUTCMilliseconds() + endTime);
    }
    return {
      ...activity,
      start: mappedStart.toISOString(),
      end: mappedEnd ? mappedEnd.toISOString() : null,
    };
  }

  updatePendingFromForm(
    stage: PlanningStageId,
    selection: { activity: Activity; resource: Resource } | null,
    pending: PendingActivityState | null,
    buildActivityFromForm: (selection: { activity: Activity; resource: Resource }) => Activity | null,
    areActivitiesEquivalent: (a: Activity, b: Activity) => boolean,
    commitPending: (activity: Activity) => void,
  ): void {
    if (!selection || !pending) {
      return;
    }
    if (pending.stage !== stage || pending.activity.id !== selection.activity.id) {
      return;
    }

    const normalized = buildActivityFromForm(selection);
    if (!normalized) {
      return;
    }
    if (areActivitiesEquivalent(pending.activity, normalized)) {
      return;
    }
    commitPending(normalized);
  }

  shiftFormBy(form: FormGroup, deltaMinutes: number): void {
    const value = form.getRawValue();
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
    form.controls['start'].setValue(toLocalDateTime(nextStart.toISOString()));
    form.controls['start'].markAsDirty();
    if (end) {
      const nextEnd = new Date(end.getTime() + deltaMs);
      form.controls['end'].setValue(toLocalDateTime(nextEnd.toISOString()));
      form.controls['end'].markAsDirty();
    }
  }

  shiftSelectedActivityBy(
    deltaMinutes: number,
    selectedActivities: { activity: Activity; resource: Resource }[],
    selectedActivityState: { activity: Activity; resource: Resource } | null,
    findCatalogOptionByTypeId: (typeId: string | null | undefined) => ActivityCatalogOption | null,
    isPendingSelection: (activityId: string | null | undefined) => boolean,
    applyActivityTypeConstraints: (activity: Activity) => Activity,
    commitPendingActivityUpdate: (activity: Activity) => void,
    replaceActivity: (activity: Activity) => void,
  ): void {
    const target =
      selectedActivities.length === 1 ? selectedActivities[0] : selectedActivityState;
    if (!target) {
      return;
    }
    const { activity } = target;
    const deltaMs = deltaMinutes * 60 * 1000;
    const start = new Date(activity.start).getTime() + deltaMs;
    const definition = findCatalogOptionByTypeId(activity.type ?? null);
    const end =
      definition?.timeMode === 'point' || !activity.end
        ? null
        : new Date(activity.end).getTime() + deltaMs;
    const updated: Activity = {
      ...activity,
      start: new Date(start).toISOString(),
      end: end ? new Date(end).toISOString() : null,
    };
    const normalized = applyActivityTypeConstraints(updated);
    if (isPendingSelection(activity.id)) {
      commitPendingActivityUpdate(normalized);
      return;
    }
    replaceActivity(normalized);
  }

  fillGapForSelectedActivity(
    selection: { activity: Activity; resource: Resource } | null,
    form: FormGroup,
    findNeighborActivities: (activity: Activity) => { previous: Activity | null; next: Activity | null },
    findCatalogOptionByTypeId: (typeId: string | null | undefined) => ActivityCatalogOption | null,
  ): void {
    if (!selection) {
      return;
    }
    const formValue = form.getRawValue();
    if (!formValue.start) {
      return;
    }
    const base = selection.activity;
    const startDate = fromLocalDateTime(formValue.start);
    const endDate = formValue.end ? fromLocalDateTime(formValue.end) : null;
    if (!startDate) {
      return;
    }
    const reference: Activity = {
      ...base,
      start: startDate.toISOString(),
      end: endDate ? endDate.toISOString() : null,
    };
    const neighbors = findNeighborActivities(reference);
    const previous = neighbors.previous;
    const next = neighbors.next;
    const definition = findCatalogOptionByTypeId(base.type ?? null);
    const isPoint = definition?.timeMode === 'point';
    if (!previous || !next || isPoint) {
      return;
    }
    const prevTerminalIso = previous.end ?? previous.start;
    const nextStartIso = next.start;
    if (!prevTerminalIso || !nextStartIso) {
      return;
    }
    const prevEnd = new Date(prevTerminalIso).getTime();
    const nextStart = new Date(nextStartIso).getTime();
    if (!(Number.isFinite(prevEnd) && Number.isFinite(nextStart)) || nextStart <= prevEnd + 60_000) {
      return;
    }
    const gapDuration = nextStart - prevEnd;
    const adjustedEnd = endDate
      ? new Date(prevEnd + Math.min(gapDuration - 60_000, endDate.getTime() - startDate.getTime()))
      : null;
    form.controls['start'].setValue(toLocalDateTime(new Date(prevEnd + 60_000).toISOString()));
    form.controls['end'].setValue(adjustedEnd ? toLocalDateTime(adjustedEnd.toISOString()) : '');
    form.controls['start'].markAsDirty();
    form.controls['end'].markAsDirty();
  }

  snapToNeighbor(
    direction: 'previous' | 'next',
    selection: { activity: Activity; resource: Resource } | null,
    form: FormGroup,
    findNeighborActivities: (activity: Activity) => { previous: Activity | null; next: Activity | null },
    findCatalogOptionByTypeId: (typeId: string | null | undefined) => ActivityCatalogOption | null,
  ): void {
    if (!selection) {
      return;
    }
    const formValue = form.getRawValue();
    if (!formValue.start) {
      return;
    }
    const base = selection.activity;
    const startDate = fromLocalDateTime(formValue.start);
    const endDate = formValue.end ? fromLocalDateTime(formValue.end) : null;
    if (!startDate) {
      return;
    }
    const reference: Activity = {
      ...base,
      start: startDate.toISOString(),
      end: endDate ? endDate.toISOString() : null,
    };
    const neighbors = findNeighborActivities(reference);
    const neighbor = direction === 'previous' ? neighbors.previous : neighbors.next;
    if (!neighbor) {
      return;
    }
    const definition = findCatalogOptionByTypeId(base.type ?? null);
    const isPoint = definition?.timeMode === 'point';

    if (direction === 'previous') {
      const prevTerminalIso = neighbor.end ?? neighbor.start;
      if (!prevTerminalIso) {
        return;
      }
      const prevEndDate = new Date(prevTerminalIso);
      const prevEndMs = prevEndDate.getTime();
      if (!Number.isFinite(prevEndMs)) {
        return;
      }
      let updated: Activity;
      if (isPoint || !base.end) {
        updated = {
          ...base,
          start: prevEndDate.toISOString(),
        };
      } else {
        const currentStartMs = startDate.getTime();
        const currentEndMs = (endDate ?? startDate).getTime();
        const durationMs = Math.max(60_000, currentEndMs - currentStartMs);
        const newStartMs = prevEndMs;
        const newEndMs = newStartMs + durationMs;
        updated = {
          ...base,
          start: new Date(newStartMs).toISOString(),
          end: new Date(newEndMs).toISOString(),
        };
      }
      form.controls['start'].setValue(toLocalDateTime(updated.start));
      if (!isPoint && updated.end) {
        form.controls['end'].setValue(toLocalDateTime(updated.end));
      } else {
        form.controls['end'].setValue('');
      }
      form.controls['start'].markAsDirty();
      form.controls['end'].markAsDirty();
    } else {
      const nextStartDate = new Date(neighbor.start);
      const nextStartMs = nextStartDate.getTime();
      let updated: Activity;
      if (isPoint || !endDate) {
        updated = {
          ...base,
          start: nextStartDate.toISOString(),
        };
      } else {
        const currentStartMs = startDate.getTime();
        const currentEndMs = endDate.getTime();
        const durationMs = Math.max(60_000, currentEndMs - currentStartMs);
        const newEndMs = nextStartMs;
        const newStartMs = newEndMs - durationMs;
        updated = {
          ...base,
          start: new Date(newStartMs).toISOString(),
          end: new Date(newEndMs).toISOString(),
        };
      }
      form.controls['start'].setValue(toLocalDateTime(updated.start));
      if (!isPoint && updated.end) {
        form.controls['end'].setValue(toLocalDateTime(updated.end));
      } else {
        form.controls['end'].setValue('');
      }
      form.controls['start'].markAsDirty();
      form.controls['end'].markAsDirty();
    }
  }

  startPendingActivity(
    stage: PlanningStageId,
    resource: Resource,
    activity: Activity,
    selectedActivityState: (state: { activity: Activity; resource: Resource } | null) => void,
    setPending: (state: PendingActivityState) => void,
  ): void {
    setPending({ stage, activity });
    selectedActivityState({ activity, resource });
  }

  commitPendingActivityUpdate(
    stage: PlanningStageId,
    activity: Activity,
    pending: PendingActivityState | null,
    stageResources: Resource[],
    selectedActivityState: (state: { activity: Activity; resource: Resource } | null) => void,
    setPending: (state: PendingActivityState) => void,
  ): void {
    if (!pending) {
      return;
    }
    setPending({ stage: pending.stage, activity });
    const ownerId = this.deps.activityOwnerId(activity);
    const resource =
      (ownerId ? stageResources.find((entry) => entry.id === ownerId) : null) ?? null;
    if (resource) {
      selectedActivityState({ activity, resource });
    } else {
      selectedActivityState(null);
    }
  }

  pendingActivityForStage(stage: PlanningStageId, pending: PendingActivityState | null): Activity | null {
    if (!pending || pending.stage !== stage) {
      return null;
    }
    return pending.activity;
  }

  updatePendingActivityPosition(
    event: {
      activity: Activity;
      targetResourceId: string;
      start: Date;
      end: Date | null;
      participantResourceId?: string | null;
      participantCategory?: ActivityParticipantCategory | null;
      sourceResourceId?: string | null;
      isOwnerSlot?: boolean;
    },
    stageResources: Resource[],
    resourceParticipantCategory: (resource: Resource | null) => ActivityParticipantCategory,
    moveParticipantToResource: (activity: Activity, participantId: string, target: Resource) => Activity,
    addParticipantToActivity: (
      activity: Activity,
      owner: Resource,
      partner?: Resource | null,
      partnerRole?: ActivityParticipantRole,
      opts?: { retainPreviousOwner?: boolean; ownerCategory?: ActivityParticipantCategory },
    ) => Activity,
    applyActivityTypeConstraints: (activity: Activity) => Activity,
    commitPendingActivityUpdate: (activity: Activity) => void,
  ): void {
    const targetResource = stageResources.find((res) => res.id === event.targetResourceId) ?? null;
    const base: Activity = {
      ...event.activity,
      start: event.start.toISOString(),
      end: event.end ? event.end.toISOString() : null,
    };
    const isOwnerSlot = event.isOwnerSlot ?? true;
    const participantResourceId = event.participantResourceId ?? event.sourceResourceId ?? null;
    const category = event.participantCategory ?? resourceParticipantCategory(targetResource);
    const updated = targetResource
      ? !isOwnerSlot && participantResourceId
        ? moveParticipantToResource(base, participantResourceId, targetResource)
        : addParticipantToActivity(base, targetResource, undefined, undefined, {
            retainPreviousOwner: false,
            ownerCategory: category,
          })
      : base;
    commitPendingActivityUpdate(applyActivityTypeConstraints(updated));
  }
}
