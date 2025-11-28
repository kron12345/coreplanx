import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  PlanWeekRepository,
  UpsertPlanWeekTemplateInput,
} from './plan-week.repository';
import {
  PlanWeekRealtimeEvent,
  PlanWeekRolloutRequest,
  PlanWeekRolloutResponse,
  PlanWeekTemplate,
  PlanWeekTemplateListResponse,
  PlanWeekActivity,
  PlanWeekActivityListResponse,
  PlanWeekValidity,
  PlanWeekValidityListResponse,
  PlanWeekRealtimeScope,
  WeekInstance,
  WeekInstanceListResponse,
  WeekInstanceSummary,
  PlanWeekValidityStatus,
} from './planning.types';

@Injectable()
export class PlanWeekService {
  private readonly templateEvents = new Subject<PlanWeekRealtimeEvent>();
  private readonly heartbeatIntervalMs = 30000;

  constructor(private readonly repository: PlanWeekRepository) {}

  async listTemplates(): Promise<PlanWeekTemplateListResponse> {
    this.assertDatabaseEnabled();
    const items = await this.repository.listTemplates();
    return { items };
  }

  async upsertTemplate(
    templateId: string,
    payload: PlanWeekTemplate,
  ): Promise<PlanWeekTemplate> {
    this.assertDatabaseEnabled();
    const normalized = this.normalizeTemplatePayload(templateId, payload);
    if (!normalized.label) {
      throw new BadRequestException('Template label must not be empty.');
    }
    const existing = await this.repository.getTemplate(templateId);
    if (existing && payload.version && existing.version !== payload.version) {
      throw new ConflictException(
        `Template ${templateId} was updated concurrently. Reload to get version ${existing.version}.`,
      );
    }
    const persisted = await this.repository.upsertTemplate({
      ...normalized,
      version: new Date(),
    });
    this.emitEvent('template', persisted.id, {
      upserts: [persisted],
      version: persisted.version,
    });
    return persisted;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    this.assertDatabaseEnabled();
    const removed = await this.repository.deleteTemplate(templateId);
    if (!removed) {
      throw new NotFoundException(`Template ${templateId} does not exist.`);
    }
    this.emitEvent('template', templateId, { deleteIds: [templateId] });
  }

  async listValidities(
    templateId: string,
  ): Promise<PlanWeekValidityListResponse> {
    const template = await this.getTemplateOrThrow(templateId);
    const items = await this.repository.listValidities(template.id);
    return { items };
  }

  async upsertValidity(
    templateId: string,
    validityId: string,
    payload: PlanWeekValidity,
  ): Promise<PlanWeekValidity> {
    await this.getTemplateOrThrow(templateId);
    const normalized = this.normalizeValidity(templateId, validityId, payload);
    const persisted = await this.repository.upsertValidity(normalized);
    this.emitEvent('validity', templateId, { upserts: [persisted] });
    return persisted;
  }

  async deleteValidity(templateId: string, validityId: string): Promise<void> {
    await this.getTemplateOrThrow(templateId);
    const removed = await this.repository.deleteValidity(
      templateId,
      validityId,
    );
    if (!removed) {
      throw new NotFoundException(
        `Validity ${validityId} does not exist for template ${templateId}.`,
      );
    }
    this.emitEvent('validity', templateId, { deleteIds: [validityId] });
  }

  async listTemplateActivities(
    templateId: string,
  ): Promise<PlanWeekActivityListResponse> {
    await this.getTemplateOrThrow(templateId);
    const items = await this.repository.listTemplateActivities(templateId);
    return { items };
  }

  async upsertTemplateActivity(
    templateId: string,
    activityId: string,
    payload: PlanWeekActivity,
  ): Promise<PlanWeekActivity> {
    await this.getTemplateOrThrow(templateId);
    const normalized = this.normalizeActivity(templateId, activityId, payload);
    const saved = await this.repository.upsertTemplateActivity(normalized);
    this.emitEvent('service', templateId, { upserts: [saved] });
    return saved;
  }

  async deleteTemplateActivity(
    templateId: string,
    activityId: string,
  ): Promise<void> {
    await this.getTemplateOrThrow(templateId);
    const removed = await this.repository.deleteTemplateActivity(
      templateId,
      activityId,
    );
    if (!removed) {
      throw new NotFoundException(
        `Activity ${activityId} does not exist for template ${templateId}.`,
      );
    }
    this.emitEvent('service', templateId, { deleteIds: [activityId] });
  }

  async rolloutTemplate(
    request: PlanWeekRolloutRequest,
  ): Promise<PlanWeekRolloutResponse> {
    const template = await this.getTemplateOrThrow(request.templateId);
    if (template.version !== request.version) {
      throw new ConflictException(
        `Template ${template.id} version mismatch. Expected ${template.version} but received ${request.version}.`,
      );
    }
    if (!Number.isInteger(request.weekCount) || request.weekCount <= 0) {
      throw new BadRequestException('weekCount must be a positive integer.');
    }
    const startDate = this.ensureDateOnly(request.weekStartIso, 'weekStartIso');
    const weekStarts: string[] = [];
    const skipCodes = new Set(
      (request.skipWeekCodes ?? [])
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    );

    for (let i = 0; i < request.weekCount; i += 1) {
      const currentDate = new Date(startDate.getTime());
      currentDate.setUTCDate(startDate.getUTCDate() + i * 7);
      const iso = currentDate.toISOString().slice(0, 10);
      const weekCode = this.computeIsoWeekCode(currentDate).toUpperCase();
      if (skipCodes.has(weekCode)) {
        continue;
      }
      weekStarts.push(iso);
    }

    if (!weekStarts.length) {
      return { createdInstances: [] };
    }

    const conflicts = await this.repository.findExistingWeekStartConflicts(
      template.id,
      weekStarts,
    );
    if (conflicts.length) {
      throw new ConflictException(
        `Week instances already exist for ${conflicts.join(', ')}. Delete them before rolling out again.`,
      );
    }

    const instances: WeekInstance[] = weekStarts.map((weekStartIso) => {
      const instanceId = randomUUID();
      return {
        id: instanceId,
        templateId: template.id,
        weekStartIso,
        templateVersion: template.version,
        services: this.createScheduledServices(
          template,
          weekStartIso,
          instanceId,
        ),
        assignments: [],
        status: 'planned',
      };
    });

    await this.repository.saveWeekInstances(instances);
    const summaries: WeekInstanceSummary[] = instances.map((instance) =>
      this.toWeekInstanceSummary(instance),
    );

    if (summaries.length) {
      this.emitEvent('rollout', template.id, { upserts: summaries });
    }
    return { createdInstances: summaries };
  }

  streamTemplateEvents(templateId?: string): Observable<PlanWeekRealtimeEvent> {
    this.assertDatabaseEnabled();
    return new Observable<PlanWeekRealtimeEvent>((subscriber) => {
      const subscription = this.templateEvents.subscribe({
        next: (event) => {
          if (
            templateId &&
            event.templateId &&
            event.templateId !== templateId
          ) {
            return;
          }
          subscriber.next(event);
        },
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      subscriber.next({
        scope: 'template',
        templateId,
        timestamp: new Date().toISOString(),
      });
      const heartbeat = setInterval(() => {
        subscriber.next({
          scope: 'template',
          templateId,
          timestamp: new Date().toISOString(),
        });
      }, this.heartbeatIntervalMs);
      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }

  async listWeekInstances(
    from: string,
    to: string,
  ): Promise<WeekInstanceListResponse> {
    this.assertDatabaseEnabled();
    const fromDate = this.ensureDateOnly(from, 'from');
    const toDate = this.ensureDateOnly(to, 'to');
    if (fromDate > toDate) {
      throw new BadRequestException('Parameter from must be before to.');
    }
    const items = await this.repository.listWeekInstances({
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
    });
    return { items };
  }

  async getWeekInstance(weekInstanceId: string): Promise<WeekInstance> {
    this.assertDatabaseEnabled();
    const instance = await this.repository.getWeekInstance(weekInstanceId);
    if (!instance) {
      throw new NotFoundException(
        `Week instance ${weekInstanceId} does not exist.`,
      );
    }
    return instance;
  }

  async saveWeekInstance(
    weekInstanceId: string,
    payload: WeekInstance,
  ): Promise<WeekInstance> {
    const template = await this.getTemplateOrThrow(payload.templateId);
    if (!payload.templateVersion) {
      throw new BadRequestException('templateVersion is required.');
    }
    const normalized: WeekInstance = {
      ...payload,
      id: weekInstanceId,
      templateId: template.id,
      weekStartIso: this.ensureDateOnly(payload.weekStartIso, 'weekStartIso')
        .toISOString()
        .slice(0, 10),
      status: payload.status ?? 'planned',
      services: (payload.services ?? []).map((service) => ({
        id: service.id ?? randomUUID(),
        instanceId: weekInstanceId,
        sliceId: this.assertSliceId(service.sliceId),
        startIso: service.startIso,
        endIso: service.endIso,
        attributes: service.attributes,
      })),
      assignments: (payload.assignments ?? []).map((assignment) => ({
        id: assignment.id ?? randomUUID(),
        scheduledServiceId: assignment.scheduledServiceId,
        resourceId: assignment.resourceId,
        resourceKind: assignment.resourceKind,
        assignedAtIso: assignment.assignedAtIso,
        assignedBy: assignment.assignedBy,
      })),
    };
    await this.repository.saveWeekInstance(normalized);
    const stored = await this.getWeekInstance(weekInstanceId);
    this.emitEvent('rollout', template.id, {
      upserts: [this.toWeekInstanceSummary(stored)],
    });
    return stored;
  }

  async deleteWeekInstance(weekInstanceId: string): Promise<void> {
    this.assertDatabaseEnabled();
    const instance = await this.repository.getWeekInstance(weekInstanceId);
    if (!instance) {
      throw new NotFoundException(
        `Week instance ${weekInstanceId} does not exist.`,
      );
    }
    const removed = await this.repository.deleteWeekInstance(weekInstanceId);
    if (!removed) {
      throw new NotFoundException(
        `Week instance ${weekInstanceId} does not exist.`,
      );
    }
    this.emitEvent('rollout', instance.templateId, {
      deleteIds: [weekInstanceId],
    });
  }

  private normalizeTemplatePayload(
    templateId: string,
    payload: PlanWeekTemplate,
  ): Omit<UpsertPlanWeekTemplateInput, 'version'> {
    const normalizedBaseWeekStart = this.ensureDateOnly(
      payload.baseWeekStartIso,
      'baseWeekStartIso',
    )
      .toISOString()
      .slice(0, 10);

    const normalizedSlices = (payload.slices ?? []).map((slice, index) => {
      const start = this.ensureDateOnly(
        slice.startIso,
        `slices[${index}].startIso`,
      );
      const end = this.ensureDateOnly(slice.endIso, `slices[${index}].endIso`);
      if (start > end) {
        throw new BadRequestException(
          'slice startIso must be on or before endIso.',
        );
      }
      return {
        id: slice.id ?? randomUUID(),
        templateId,
        label: slice.label ?? null,
        startIso: start.toISOString().slice(0, 10),
        endIso: end.toISOString().slice(0, 10),
      };
    });

    return {
      id: templateId,
      label: payload.label,
      description: payload.description ?? null,
      baseWeekStartIso: normalizedBaseWeekStart,
      variant: payload.variant ?? null,
      slices: normalizedSlices,
    };
  }

  private assertSliceId(value?: string): string {
    if (!value) {
      throw new BadRequestException(
        'sliceId is required for every scheduled service.',
      );
    }
    return value;
  }

  private normalizeValidity(
    templateId: string,
    validityId: string,
    payload: PlanWeekValidity,
  ): PlanWeekValidity {
    const normalizedStatus = payload.status ?? 'draft';
    const validFrom = this.ensureDateOnly(payload.validFromIso, 'validFromIso');
    const validTo = this.ensureDateOnly(payload.validToIso, 'validToIso');
    if (validFrom > validTo) {
      throw new BadRequestException(
        'validFromIso must be on or before validToIso.',
      );
    }
    return {
      id: validityId,
      templateId,
      validFromIso: validFrom.toISOString().slice(0, 10),
      validToIso: validTo.toISOString().slice(0, 10),
      includeWeekNumbers: payload.includeWeekNumbers ?? undefined,
      excludeWeekNumbers: payload.excludeWeekNumbers ?? undefined,
      status: normalizedStatus,
    };
  }

  private normalizeActivity(
    templateId: string,
    activityId: string,
    payload: PlanWeekActivity,
  ): PlanWeekActivity {
    const start = this.ensureDateTime(payload.startIso, 'startIso');
    const end =
      payload.endIso == null
        ? undefined
        : this.ensureDateTime(payload.endIso, 'endIso');
    if (end && start > end) {
      throw new BadRequestException('endIso must be on or after startIso.');
    }
    if (!payload.title) {
      throw new BadRequestException('title is required.');
    }
    if (!payload.participants || payload.participants.length === 0) {
      throw new BadRequestException(
        'participants must contain at least one entry.',
      );
    }
    return {
      id: activityId,
      templateId,
      title: payload.title,
      startIso: start.toISOString(),
      endIso: end?.toISOString(),
      type: payload.type ?? undefined,
      remark: payload.remark ?? undefined,
      attributes: payload.attributes ?? undefined,
      participants: payload.participants.map((participant) => ({
        resourceId: participant.resourceId,
        role: participant.role ?? undefined,
      })),
    };
  }

  private createScheduledServices(
    template: PlanWeekTemplate,
    weekStartIso: string,
    instanceId: string,
  ): WeekInstance['services'] {
    const rolloutStart = this.ensureDateOnly(weekStartIso, 'weekStartIso');
    const baseWeekStart = this.ensureDateOnly(
      template.baseWeekStartIso,
      'baseWeekStartIso',
    );
    return (template.slices ?? []).map((slice, index) => {
      const sliceStart = this.ensureDateOnly(
        slice.startIso,
        `template.slices[${index}].startIso`,
      );
      const sliceEnd = this.ensureDateOnly(
        slice.endIso,
        `template.slices[${index}].endIso`,
      );
      const startOffset = this.diffInDays(baseWeekStart, sliceStart);
      const endOffset = this.diffInDays(baseWeekStart, sliceEnd);
      const startDate = this.addDays(rolloutStart, startOffset);
      const endDate = this.addDays(rolloutStart, endOffset);
      return {
        id: randomUUID(),
        instanceId,
        sliceId: slice.id,
        startIso: this.startOfDayIso(startDate),
        endIso: this.endOfDayIso(endDate),
        attributes: undefined,
      };
    });
  }

  private diffInDays(base: Date, target: Date): number {
    const diff = target.getTime() - base.getTime();
    return Math.round(diff / 86400000);
  }

  private addDays(base: Date, days: number): Date {
    const clone = new Date(base.getTime());
    clone.setUTCDate(clone.getUTCDate() + days);
    return clone;
  }

  private startOfDayIso(date: Date): string {
    const clone = new Date(date.getTime());
    clone.setUTCHours(0, 0, 0, 0);
    return clone.toISOString();
  }

  private endOfDayIso(date: Date): string {
    const clone = new Date(date.getTime());
    clone.setUTCHours(23, 59, 59, 999);
    return clone.toISOString();
  }

  private computeIsoWeekCode(date: Date): string {
    const clone = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const day = clone.getUTCDay() || 7;
    clone.setUTCDate(clone.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(clone.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil(
      ((clone.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    return `${clone.getUTCFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
  }

  private ensureDateOnly(value: string, label: string): Date {
    if (!value) {
      throw new BadRequestException(`${label} is required.`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `${label} must be an ISO date (YYYY-MM-DD).`,
      );
    }
    return new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
  }

  private ensureDateTime(value: string, label: string): Date {
    if (!value) {
      throw new BadRequestException(`${label} is required.`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${label} must be an ISO timestamp.`);
    }
    return parsed;
  }

  private toWeekInstanceSummary(instance: WeekInstance): WeekInstanceSummary {
    return {
      id: instance.id,
      weekStartIso: instance.weekStartIso,
      status: instance.status,
    };
  }

  private emitEvent(
    scope: PlanWeekRealtimeScope,
    templateId: string,
    payload: Pick<PlanWeekRealtimeEvent, 'upserts' | 'deleteIds' | 'version'>,
  ): void {
    this.templateEvents.next({
      scope,
      templateId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  private assertDatabaseEnabled(): void {
    if (!this.repository.isEnabled) {
      throw new ServiceUnavailableException(
        'Plan week endpoints require a configured database connection.',
      );
    }
  }

  private async getTemplateOrThrow(
    templateId: string,
  ): Promise<PlanWeekTemplate> {
    this.assertDatabaseEnabled();
    const template = await this.repository.getTemplate(templateId);
    if (!template) {
      throw new NotFoundException(`Template ${templateId} does not exist.`);
    }
    return template;
  }
}
