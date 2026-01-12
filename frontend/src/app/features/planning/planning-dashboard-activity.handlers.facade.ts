import { MatDialog } from '@angular/material/dialog';
import { FormGroup } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import type { ActivityFieldKey } from '../../core/models/activity-definition';
import { PlanningDashboardActivityFacade, PendingActivityState } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningStageId } from './planning-stage.model';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { buildActivityFromForm } from './planning-dashboard-activity.handlers';
import { toLocalDateTime } from './planning-dashboard-time.utils';
import {
  addParticipantToActivity,
  expandRelevantParticipantKinds,
  filterParticipantsByKind,
  isPersonnelKind,
  isVehicleKind,
  resolveSuggestedParticipantRole,
} from './planning-dashboard-participant.utils';
import { serviceIdForOwner } from './planning-dashboard-activity.utils';
import {
  ActivityRequiredParticipantDialogComponent,
  ActivityRequiredParticipantDialogResult,
} from './activity-required-participant-dialog.component';
import { readActivityGroupMetaFromAttributes, writeActivityGroupMetaToAttributes } from './planning-activity-group.utils';
import { readAttributeBoolean } from '../../core/utils/activity-definition.utils';
import {
  extractLinkedServiceParticipantId,
  resolveLinkedServiceFieldState,
} from './planning-dashboard-linked-service.utils';

export class PlanningDashboardActivityHandlersFacade {
  constructor(
    private readonly deps: {
      activeStage: () => PlanningStageId;
      activityFacade: PlanningDashboardActivityFacade;
      activitySelection: PlanningDashboardActivitySelectionFacade;
      dialog: MatDialog;
      stageResources: (stage: PlanningStageId) => Resource[];
      templateSelected: () => boolean;
      selectedTemplateId: () => string | null;
      activityCreationTool: () => string;
      catalogOptionById: (id: string) => ActivityCatalogOption | undefined;
      resolveActivityTypeForResource: (
        resource: Resource,
        typeId: string | null | undefined,
      ) => ActivityCatalogOption | null;
      applyActivityTypeConstraints: (activity: Activity) => Activity;
      stageActivities: (stage: PlanningStageId) => Activity[];
      applyLocationDefaults: (activity: Activity, activities: Activity[]) => Activity;
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
      findCatalogOptionByTypeId: (typeId: string | null | undefined) => ActivityCatalogOption | null;
      buildActivityTitle: (label?: string | null) => string;
      definitionHasField: (definition: ActivityCatalogOption | null, field: ActivityFieldKey) => boolean;
      isPendingSelection: (id: string | null | undefined) => boolean;
      updateStageActivities: (stage: PlanningStageId, updater: (activities: Activity[]) => Activity[]) => void;
      saveTemplateActivity: (activity: Activity) => void;
      replaceActivity: (activity: Activity) => void;
      clearEditingPreview: () => void;
      deleteTemplateActivity: (templateId: string, baseId: string) => void;
      onActivityMutated?: (activity: Activity, stage: PlanningStageId) => void;
    },
  ) {}

  async handleActivityCreate(event: { resource: Resource; start: Date }): Promise<void> {
    const stage = this.deps.activeStage();
    if (stage === 'base' && !this.deps.templateSelected()) {
      return;
    }
    const toolId = this.deps.activityCreationTool();
    const option = this.deps.catalogOptionById(toolId) ?? null;
    const typeId = option?.activityTypeId ?? null;
    const definition = this.deps.resolveActivityTypeForResource(event.resource, typeId);
    if (!definition) {
      return;
    }
    const draft = this.deps.activityFacade.createDraft(stage, event, definition, option);
    const normalized = this.deps.applyActivityTypeConstraints(draft);
    const withDefaults = this.deps.applyLocationDefaults(normalized, this.deps.stageActivities(stage));
    const ensured = await this.ensureRequiredParticipants(stage, event.resource, withDefaults, { prompt: false });
    if (!ensured) {
      return;
    }
    this.deps.pendingActivityOriginal.set(ensured);
    this.deps.startPendingActivity(stage, event.resource, ensured);
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
    const definition = (original.type ?? '').toString().trim()
      ? this.deps.findCatalogOptionByTypeId(original.type ?? null)
      : null;
    const option = this.deps.selectedCatalogOption();
    const attrs = original.attributes as Record<string, unknown> | undefined;
    const activityKey = typeof attrs?.['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
    const matchesKey = !!activityKey && option?.id === activityKey;
    const matchesType = !!original.type && option?.activityTypeId === original.type;
    const catalogOption = matchesKey || matchesType ? option : null;
    const linkState = resolveLinkedServiceFieldState({
      anchor: selection.resource,
      definition,
      catalogOption,
    });
    const linkedServiceId = linkState.visible
      ? extractLinkedServiceParticipantId(original, linkState.kind) ?? ''
      : '';
    this.deps.activityForm.setValue({
      start: toLocalDateTime(original.start),
      end: original.end ? toLocalDateTime(original.end) : '',
      type: original.type ?? '',
      from: original.from ?? '',
      to: original.to ?? '',
      remark: original.remark ?? '',
      linkedServiceId,
    });
    this.deps.activityForm.markAsPristine();
    this.deps.clearEditingPreview();
  }

  async saveSelectedActivityEdits(): Promise<boolean> {
    const selection = this.deps.activitySelection.selectedActivityState();
    if (!selection) {
      return false;
    }
    if (this.deps.activityForm.invalid) {
      this.deps.activityForm.markAllAsTouched();
      return false;
    }
    const stage = this.deps.activeStage();
    const pending = this.deps.pendingActivitySignal();
    const isPendingDraft = pending && pending.stage === stage && pending.activity.id === selection.activity.id;
    const normalized = buildActivityFromForm(selection, this.deps.activityForm.getRawValue(), {
      findCatalogOptionByTypeId: (id) => this.deps.findCatalogOptionByTypeId(id),
      selectedCatalogOption: this.deps.selectedCatalogOption,
      buildActivityTitle: (label) => this.deps.buildActivityTitle(label),
      definitionHasField: (definition, field) => this.deps.definitionHasField(definition, field as ActivityFieldKey),
      applyActivityTypeConstraints: (activity) => this.deps.applyActivityTypeConstraints(activity),
      resolveResourceById: (id) =>
        this.deps.stageResources(stage).find((resource) => resource.id === id) ?? null,
    });
    if (!normalized) {
      return false;
    }
    const ensured = await this.ensureRequiredParticipants(stage, selection.resource, normalized);
    if (!ensured) {
      return false;
    }
    const withDefaults = this.deps.applyLocationDefaults(ensured, this.deps.stageActivities(stage));
    if (isPendingDraft) {
      if (stage === 'base') {
        this.deps.saveTemplateActivity(withDefaults);
      } else {
        this.deps.updateStageActivities(stage, (activities) => [...activities, withDefaults]);
      }
      this.deps.pendingActivitySignal.set(null);
      this.deps.pendingActivityOriginal.set(null);
      this.deps.activitySelection.selectedActivityState.set({ activity: withDefaults, resource: selection.resource });
      this.deps.clearEditingPreview();
      this.deps.onActivityMutated?.(withDefaults, stage);
      return true;
    }
    if (stage === 'base') {
      const previousActivityId = selection.activity.id;
      const previousStartMs = Date.parse(selection.activity.start);
      const nextStartMs = Date.parse(withDefaults.start);
      const shiftDeltaMs =
        Number.isFinite(previousStartMs) && Number.isFinite(nextStartMs) ? nextStartMs - previousStartMs : 0;
      const nextMainId = Number.isFinite(nextStartMs)
        ? this.shiftDayScopedId(previousActivityId, shiftDeltaMs)
        : previousActivityId;

      const normalizedMain = this.deps.applyActivityTypeConstraints({
        ...withDefaults,
        id: nextMainId,
      });

      let shiftedAttachments: Array<{ originalId: string; activity: Activity }> = [];
      this.deps.updateStageActivities('base', (activities) => {
        const result = this.applyGroupAttachmentShift({
          activities,
          previousActivityId,
          nextMainId: normalizedMain.id,
          normalizedMain,
          shiftDeltaMs,
        });
        shiftedAttachments = result.shiftedAttachments;
        return result.activities;
      });

      if (this.shouldPersistToTemplate(previousActivityId)) {
        this.deps.saveTemplateActivity(normalizedMain);
        shiftedAttachments.forEach(({ activity }) => {
          if (!this.shouldPersistToTemplate(activity.id)) {
            return;
          }
          this.deps.saveTemplateActivity(activity);
        });
      }

      this.deps.activitySelection.selectedActivityState.set({ activity: normalizedMain, resource: selection.resource });
      this.deps.clearEditingPreview();
      this.deps.onActivityMutated?.(normalizedMain, stage);
      return true;
    }
    this.deps.replaceActivity(withDefaults);
    this.deps.onActivityMutated?.(withDefaults, stage);
    return true;
  }

  private shouldPersistToTemplate(activityId: string): boolean {
    return true;
  }

  private shiftDayScopedId(activityId: string, shiftDeltaMs: number): string {
    const match = activityId.match(/^(.+)@(\d{4}-\d{2}-\d{2})$/);
    if (!match) {
      return activityId;
    }
    const baseId = match[1];
    const currentDay = match[2];
    if (!Number.isFinite(shiftDeltaMs) || shiftDeltaMs === 0) {
      return activityId;
    }
    const deltaDays = Math.round(shiftDeltaMs / (24 * 3600_000));
    if (!deltaDays) {
      return activityId;
    }
    const currentDate = new Date(`${currentDay}T00:00:00.000Z`);
    if (!Number.isFinite(currentDate.getTime())) {
      return activityId;
    }
    currentDate.setUTCDate(currentDate.getUTCDate() + deltaDays);
    const nextDay = currentDate.toISOString().slice(0, 10);
    if (!nextDay) {
      return activityId;
    }
    return `${baseId}@${nextDay}`;
  }

  private applyGroupAttachmentShift(options: {
    activities: Activity[];
    previousActivityId: string;
    nextMainId: string;
    normalizedMain: Activity;
    shiftDeltaMs: number;
  }): { activities: Activity[]; shiftedAttachments: Array<{ originalId: string; activity: Activity }> } {
    const { activities, previousActivityId, nextMainId, normalizedMain, shiftDeltaMs } = options;

    const attachments = shiftDeltaMs
      ? this.shiftedGroupAttachmentActivitiesFromList(activities, previousActivityId, nextMainId, shiftDeltaMs)
      : [];

    const idsToRemove = new Set<string>();
    if (normalizedMain.id !== previousActivityId) {
      idsToRemove.add(normalizedMain.id);
    }
    attachments.forEach((entry) => {
      if (entry.activity.id !== entry.originalId) {
        idsToRemove.add(entry.activity.id);
      }
    });

    const filtered = idsToRemove.size ? activities.filter((activity) => !idsToRemove.has(activity.id)) : activities;
    const attachmentMap = new Map(attachments.map((entry) => [entry.originalId, entry.activity]));

    const nextActivities = filtered.map((activity) => {
      if (activity.id === previousActivityId) {
        return {
          ...activity,
          id: normalizedMain.id,
          start: normalizedMain.start,
          end: normalizedMain.end,
          participants: normalizedMain.participants,
          attributes: normalizedMain.attributes,
          type: normalizedMain.type,
          title: normalizedMain.title,
          from: normalizedMain.from,
          to: normalizedMain.to,
          remark: normalizedMain.remark,
        };
      }
      const shifted = attachmentMap.get(activity.id);
      return shifted ?? activity;
    });
    return { activities: nextActivities, shiftedAttachments: attachments };
  }

  private shiftedGroupAttachmentActivitiesFromList(
    activities: Activity[],
    previousActivityId: string,
    nextMainId: string,
    shiftDeltaMs: number,
  ): Array<{ originalId: string; activity: Activity }> {
    const shifted: Array<{ originalId: string; activity: Activity }> = [];
    for (const activity of activities) {
      if (activity.id === previousActivityId) {
        continue;
      }
      const meta = readActivityGroupMetaFromAttributes(activity.attributes ?? undefined);
      const attachedTo = (meta?.attachedToActivityId ?? '').toString().trim();
      if (!attachedTo || attachedTo !== previousActivityId) {
        continue;
      }
      const startMs = Date.parse(activity.start);
      if (!Number.isFinite(startMs)) {
        continue;
      }
      const endIso = activity.end ?? null;
      const endMs = endIso ? Date.parse(endIso) : null;
      const nextStartMs = startMs + shiftDeltaMs;
      const nextEndMs = endMs !== null && Number.isFinite(endMs) ? endMs + shiftDeltaMs : null;
      const updatedMeta = {
        ...(meta ?? { id: (activity.groupId ?? '').toString().trim() || 'grp' }),
        attachedToActivityId: nextMainId,
      };
      const nextAttributes = writeActivityGroupMetaToAttributes(activity.attributes ?? undefined, updatedMeta);
      const updated: Activity = this.deps.applyActivityTypeConstraints({
        ...activity,
        id: this.shiftDayScopedId(activity.id, shiftDeltaMs),
        start: new Date(nextStartMs).toISOString(),
        end: nextEndMs !== null ? new Date(nextEndMs).toISOString() : null,
        attributes: nextAttributes,
      });
      shifted.push({ originalId: activity.id, activity: updated });
    }
    return shifted;
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

  private async ensureRequiredParticipants(
    stage: PlanningStageId,
    anchorResource: Resource,
    activity: Activity,
    options?: { prompt?: boolean },
  ): Promise<Activity | null> {
    const typeId = (activity.type ?? '').toString().trim();
    const definition = typeId ? this.deps.findCatalogOptionByTypeId(typeId) : null;
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const activityKey = typeof attrs?.['activityKey'] === 'string' ? (attrs['activityKey'] as string) : null;
    const catalog = activityKey ? this.deps.catalogOptionById(activityKey) ?? null : null;
    const typeAttributes = catalog?.attributes ?? definition?.attributes ?? null;
    const relevantFor = catalog?.relevantFor ?? definition?.relevantFor ?? null;
    const allowedKinds = expandRelevantParticipantKinds(relevantFor);
    const prompt = options?.prompt !== false;
    const allowsVehicle = !relevantFor || relevantFor.length === 0 ? true : relevantFor.some((kind) => isVehicleKind(kind));
    const allowsPersonnel = !relevantFor || relevantFor.length === 0 ? true : relevantFor.some((kind) => isPersonnelKind(kind));

    let updated = filterParticipantsByKind(activity, allowedKinds);
    const requiresVehicleFromType = readAttributeBoolean(typeAttributes ?? null, 'requires_vehicle');
    const requiresPersonnelFromType = readAttributeBoolean(typeAttributes ?? null, 'requires_personnel');
    const requiresVehicleFromAttributes = this.toBool((updated.attributes as any)?.['requires_vehicle']);
    const requiresPersonnelFromAttributes = this.toBool((updated.attributes as any)?.['requires_personnel']);
    const requiresVehicle = (requiresVehicleFromType || requiresVehicleFromAttributes || (allowsVehicle && !allowsPersonnel)) && allowsVehicle;
    const requiresPersonnel =
      (requiresPersonnelFromType || requiresPersonnelFromAttributes || (allowsPersonnel && !allowsVehicle)) && allowsPersonnel;
    const participants = updated.participants ?? [];
    const hasVehicle = participants.some((p) => isVehicleKind(p.kind));
    const hasPersonnel = participants.some((p) => isPersonnelKind(p.kind));
    const realm = anchorResource.kind === 'personnel-service' || anchorResource.kind === 'vehicle-service' ? 'service' : 'resource';
    const desiredVehicleKind: Resource['kind'] = realm === 'service' ? 'vehicle-service' : 'vehicle';
    const desiredPersonnelKind: Resource['kind'] = realm === 'service' ? 'personnel-service' : 'personnel';

    if (requiresVehicle && !hasVehicle) {
      const inferred = this.inferRequiredParticipant(stage, anchorResource, updated, desiredVehicleKind);
      if (inferred) {
        updated = this.attachParticipant(stage, updated, inferred, anchorResource, { allowedKinds });
      } else if (prompt) {
        const selected = await this.promptForRequiredParticipant({
          stage,
          anchorResource,
          activity: updated,
          kind: desiredVehicleKind,
          label: realm === 'service' ? 'Fahrzeugdienst' : 'Fahrzeug',
        });
        if (!selected) {
          return null;
        }
        updated = this.attachParticipant(stage, updated, selected, anchorResource, { allowedKinds });
      }
    }

    if (requiresPersonnel && !hasPersonnel) {
      const inferred = this.inferRequiredParticipant(stage, anchorResource, updated, desiredPersonnelKind);
      if (inferred) {
        updated = this.attachParticipant(stage, updated, inferred, anchorResource, { allowedKinds });
      } else if (prompt) {
        const selected = await this.promptForRequiredParticipant({
          stage,
          anchorResource,
          activity: updated,
          kind: desiredPersonnelKind,
          label: realm === 'service' ? 'Personaldienst' : 'Personal',
        });
        if (!selected) {
          return null;
        }
        updated = this.attachParticipant(stage, updated, selected, anchorResource, { allowedKinds });
      }
    }

    return updated;
  }

  async ensureRequiredParticipantsForActivity(
    stage: PlanningStageId,
    anchorResource: Resource,
    activity: Activity,
  ): Promise<Activity | null> {
    return this.ensureRequiredParticipants(stage, anchorResource, activity);
  }

  private attachParticipant(
    stage: PlanningStageId,
    activity: Activity,
    participant: Resource,
    anchorResource: Resource,
    options?: { allowedKinds?: Array<Resource['kind']> | null },
  ): Activity {
    const resources = this.deps.stageResources(stage);
    const allowedKinds = options?.allowedKinds ?? null;
    const allowedSet = allowedKinds ? new Set(allowedKinds) : null;
    const ownerResource =
      this.resolveOwnerResource(activity, resources) ??
      resources.find((res) => res.id === (activity.participants?.[0]?.resourceId ?? '')) ??
      (allowedSet && !allowedSet.has(anchorResource.kind) ? null : anchorResource);
    const resolvedOwner = ownerResource ?? participant;
    return addParticipantToActivity(
      activity,
      resolvedOwner,
      participant,
      resolveSuggestedParticipantRole(activity, participant),
      {
        retainPreviousOwner: true,
      },
    );
  }

  private resolveOwnerResource(activity: Activity, resources: Resource[]): Resource | null {
    const participants = activity.participants ?? [];
    const owner =
      participants.find((p) => p.role === 'primary-personnel' || p.role === 'primary-vehicle') ??
      participants[0] ??
      null;
    if (!owner?.resourceId) {
      return null;
    }
    return resources.find((res) => res.id === owner.resourceId) ?? null;
  }

  private inferRequiredParticipant(
    stage: PlanningStageId,
    anchorResource: Resource,
    activity: Activity,
    kind: Resource['kind'],
  ): Resource | null {
    const anchorKind = anchorResource.kind;
    const ownerId =
      anchorKind === 'personnel-service' || anchorKind === 'vehicle-service'
        ? anchorResource.id
        : this.resolveOwnerResource(activity, this.deps.stageResources(stage))?.id ?? null;
    if (!ownerId) {
      return null;
    }
    const serviceId = serviceIdForOwner(activity, ownerId);
    if (!serviceId) {
      return null;
    }

    const candidates = new Set<string>();
    for (const other of this.deps.stageActivities(stage)) {
      if (other.id === activity.id) {
        continue;
      }
      const participants = other.participants ?? [];
      if (!participants.some((participant) => participant.resourceId === ownerId)) {
        continue;
      }
      if (serviceIdForOwner(other, ownerId) !== serviceId) {
        continue;
      }
      participants.forEach((participant) => {
        if (participant.kind === kind) {
          candidates.add(participant.resourceId);
        }
      });
      if (candidates.size > 1) {
        return null;
      }
    }
    if (candidates.size !== 1) {
      return null;
    }

    const candidateId = Array.from(candidates)[0]!;
    return this.deps.stageResources(stage).find((resource) => resource.id === candidateId) ?? null;
  }

  private async promptForRequiredParticipant(options: {
    stage: PlanningStageId;
    anchorResource: Resource;
    activity: Activity;
    kind: Resource['kind'];
    label: string;
  }): Promise<Resource | null> {
    const candidates = this.deps.stageResources(options.stage).filter((res) => res.kind === options.kind);
    if (!candidates.length) {
      return null;
    }
    const dialogRef = this.deps.dialog.open<
      ActivityRequiredParticipantDialogComponent,
      {
        title: string;
        message?: string | null;
        requiredLabel: string;
        candidates: Array<{ id: string; name: string }>;
        initialSelectionId?: string | null;
      },
      ActivityRequiredParticipantDialogResult | undefined
    >(ActivityRequiredParticipantDialogComponent, {
      width: '520px',
      data: {
        title: 'Verknüpfung erforderlich',
        message: `Diese Leistung benötigt einen verknüpften ${options.label}.`,
        requiredLabel: options.label,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
        initialSelectionId: candidates.length === 1 ? candidates[0].id : null,
      },
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    const id = result?.resourceId ?? null;
    if (!id) {
      return null;
    }
    return candidates.find((c) => c.id === id) ?? null;
  }

  private toBool(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === 'yes' || normalized === '1';
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && value !== 0;
    }
    return false;
  }
}
