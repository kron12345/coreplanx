import { MatDialog } from '@angular/material/dialog';
import { FormGroup } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Activity } from '../../models/activity';
import { Resource } from '../../models/resource';
import { ActivityFieldKey, ActivityTypeDefinition } from '../../core/services/activity-type.service';
import { PlanningDashboardActivityFacade, PendingActivityState } from './planning-dashboard-activity.facade';
import { PlanningDashboardActivitySelectionFacade } from './planning-dashboard-activity-selection.facade';
import { PlanningStageId } from './planning-stage.model';
import { ActivityCatalogOption } from './planning-dashboard.types';
import { buildActivityFromForm } from './planning-dashboard-activity.handlers';
import { toLocalDateTime } from './planning-dashboard-time.utils';
import {
  addParticipantToActivity,
  resolveSuggestedParticipantRole,
} from './planning-dashboard-participant.utils';
import { serviceIdForOwner } from './planning-dashboard-activity.utils';
import {
  ActivityRequiredParticipantDialogComponent,
  ActivityRequiredParticipantDialogResult,
} from './activity-required-participant-dialog.component';
import { readActivityGroupMetaFromAttributes, writeActivityGroupMetaToAttributes } from './planning-activity-group.utils';

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
      ) => ActivityTypeDefinition | null;
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

  async handleActivityCreate(event: { resource: Resource; start: Date }): Promise<void> {
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
    const withDefaults = this.deps.applyLocationDefaults(normalized, this.deps.stageActivities(stage));
    const ensured = await this.ensureRequiredParticipants(stage, event.resource, withDefaults);
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

  async saveSelectedActivityEdits(): Promise<void> {
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
    const ensured = await this.ensureRequiredParticipants(stage, selection.resource, normalized);
    if (!ensured) {
      return;
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
      return;
    }
    if (stage === 'base') {
      const previousActivityId = selection.activity.id;
      const previousStartMs = Date.parse(selection.activity.start);
      const nextStartMs = Date.parse(withDefaults.start);
      const shiftDeltaMs =
        Number.isFinite(previousStartMs) && Number.isFinite(nextStartMs) ? nextStartMs - previousStartMs : 0;
      const nextMainId = Number.isFinite(nextStartMs)
        ? this.rewriteDayScopedId(previousActivityId, new Date(nextStartMs))
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
        const baseId = previousActivityId.split('@')[0] ?? previousActivityId;
        this.deps.saveTemplateActivity({ ...normalizedMain, id: baseId });
        shiftedAttachments.forEach(({ activity }) => {
          if (!this.shouldPersistToTemplate(activity.id)) {
            return;
          }
          const id = activity.id.split('@')[0] ?? activity.id;
          this.deps.saveTemplateActivity({ ...activity, id });
        });
      }

      this.deps.activitySelection.selectedActivityState.set({ activity: normalizedMain, resource: selection.resource });
      this.deps.clearEditingPreview();
      return;
    }
    this.deps.replaceActivity(withDefaults);
  }

  private shouldPersistToTemplate(activityId: string): boolean {
    const id = (activityId ?? '').toString();
    if (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    ) {
      return false;
    }
    return true;
  }

  private rewriteDayScopedId(activityId: string, start: Date): string {
    const match = activityId.match(/^(.+)@(\d{4}-\d{2}-\d{2})$/);
    if (!match) {
      return activityId;
    }
    const baseId = match[1];
    const currentDay = match[2];
    const nextDay = start.toISOString().slice(0, 10);
    if (!nextDay || nextDay === currentDay) {
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
        id: this.rewriteDayScopedId(activity.id, new Date(nextStartMs)),
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
  ): Promise<Activity | null> {
    const typeId = (activity.type ?? '').toString().trim();
    const typeDefinition = typeId ? this.deps.findActivityType(typeId) : null;
    const requiresVehicleFromType = this.toBool((typeDefinition?.attributes as any)?.['requires_vehicle']);
    const requiresVehicleFromAttributes = this.toBool((activity.attributes as any)?.['requires_vehicle']);
    const requiresVehicle = requiresVehicleFromType || requiresVehicleFromAttributes;
    const participants = activity.participants ?? [];
    const hasVehicle = participants.some((p) => p.kind === 'vehicle-service' || p.kind === 'vehicle');
    const realm = anchorResource.kind === 'personnel-service' || anchorResource.kind === 'vehicle-service' ? 'service' : 'resource';
    const desiredVehicleKind: Resource['kind'] = realm === 'service' ? 'vehicle-service' : 'vehicle';

    let updated = activity;

    if (requiresVehicle && !hasVehicle) {
      const inferred = this.inferRequiredVehicleParticipant(stage, anchorResource, updated, desiredVehicleKind);
      if (inferred) {
        updated = this.attachParticipant(stage, updated, inferred, anchorResource);
      } else {
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
        updated = this.attachParticipant(stage, updated, selected, anchorResource);
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

  private attachParticipant(stage: PlanningStageId, activity: Activity, participant: Resource, anchorResource: Resource): Activity {
    const resources = this.deps.stageResources(stage);
    const ownerResource =
      this.resolveOwnerResource(activity, resources) ??
      resources.find((res) => res.id === (activity.participants?.[0]?.resourceId ?? '')) ??
      anchorResource;
    return addParticipantToActivity(activity, ownerResource, participant, resolveSuggestedParticipantRole(activity, participant), {
      retainPreviousOwner: true,
    });
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

  private inferRequiredVehicleParticipant(
    stage: PlanningStageId,
    anchorResource: Resource,
    activity: Activity,
    kind: Resource['kind'],
  ): Resource | null {
    if (kind !== 'vehicle-service' && kind !== 'vehicle') {
      return null;
    }
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
