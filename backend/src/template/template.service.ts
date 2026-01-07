import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TemplateRepository } from './template.repository';
import { TemplateTableUtil } from './template.util';
import {
  ActivityTemplateSet,
  CreateTemplateSetPayload,
  UpdateTemplateSetPayload,
} from './template.types';
import {
  ActivityDto,
  Lod,
  TimelineResponse,
  TimelineServiceDto,
} from '../timeline/timeline.types';
import type { Activity, ActivityParticipant, StageId } from '../planning/planning.types';
import { DutyAutopilotService } from '../planning/duty-autopilot.service';

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private readonly dbEnabled: boolean;
  private loggedDbWarning = false;

  constructor(
    private readonly repository: TemplateRepository,
    private readonly tableUtil: TemplateTableUtil,
    private readonly dutyAutopilot: DutyAutopilotService,
  ) {
    this.dbEnabled = this.repository.isEnabled;
    if (!this.dbEnabled) {
      this.logger.warn(
        'Template endpoints are running without a database. Returning empty data for reads; writes are disabled.',
      );
      this.loggedDbWarning = true;
    }
  }

  private ensureDbForWrites(): void {
    if (!this.dbEnabled) {
      throw new ServiceUnavailableException(
        'Database connection is required for templates.',
      );
    }
  }

  async listTemplateSets(variantId?: string, includeArchived = false): Promise<ActivityTemplateSet[]> {
    if (!this.dbEnabled) {
      return [];
    }
    return this.repository.listTemplateSets(variantId, includeArchived);
  }

  async getTemplateSet(id: string, variantId?: string): Promise<ActivityTemplateSet> {
    if (!this.dbEnabled) {
      throw new NotFoundException(
        `Template ${id} not found (database disabled).`,
      );
    }
    const set = await this.repository.getTemplateSet(id, variantId);
    if (!set) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return set;
  }

  async createTemplateSet(
    payload: CreateTemplateSetPayload,
    variantId?: string,
    timetableYearLabel?: string | null,
  ): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const now = new Date().toISOString();
    const tableName = this.tableUtil.sanitize(`template_${payload.id}`);
    const normalizedVariantId = variantId?.trim().length ? variantId.trim() : 'default';
    const set: ActivityTemplateSet = {
      id: payload.id || randomUUID(),
      name: payload.name,
      description: payload.description ?? undefined,
      tableName,
      variantId: normalizedVariantId,
      timetableYearLabel: timetableYearLabel ?? null,
      createdAt: now,
      updatedAt: now,
      periods: payload.periods ?? [],
      specialDays: payload.specialDays ?? [],
      attributes: payload.attributes,
    };
    try {
      await this.repository.createTemplateSet(set);
      return set;
    } catch (error) {
      const code = error?.code;
      if (code === '23505') {
        this.logger.warn(
          `Template ${set.id} existiert bereits – vorhandenen Datensatz verwenden.`,
        );
        const existing = await this.repository.getTemplateSet(set.id, normalizedVariantId);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async updateTemplateSet(
    id: string,
    payload: UpdateTemplateSetPayload,
    variantId?: string,
  ): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const existing = await this.getTemplateSet(id, variantId);
    const updated: ActivityTemplateSet = {
      ...existing,
      name: payload.name ?? existing.name,
      description: payload.description ?? existing.description,
      periods: payload.periods ?? existing.periods ?? [],
      specialDays: payload.specialDays ?? existing.specialDays ?? [],
      attributes: payload.attributes ?? existing.attributes,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.updateTemplateSet(updated);
    return updated;
  }

  async deleteTemplateSet(id: string, variantId?: string): Promise<void> {
    this.ensureDbForWrites();
    await this.repository.deleteTemplateSet(id, variantId);
  }

  async publishTemplateSet(options: {
    templateId: string;
    sourceVariantId?: string;
    targetVariantId?: string;
    timetableYearLabel?: string | null;
  }): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const sourceVariantId =
      options.sourceVariantId?.trim().length ? options.sourceVariantId.trim() : 'default';
    let targetVariantId =
      options.targetVariantId?.trim().length ? options.targetVariantId.trim() : '';
    const yearLabel =
      options.timetableYearLabel?.trim().length ? options.timetableYearLabel.trim() : '';
    if (!targetVariantId) {
      if (!yearLabel) {
        throw new Error(
          'Either targetVariantId or timetableYearLabel must be provided.',
        );
      }
      targetVariantId = `PROD-${yearLabel}`;
    }
    if (targetVariantId === sourceVariantId) {
      throw new Error('Source and target variants must be different.');
    }

    const source = await this.getTemplateSet(options.templateId, sourceVariantId);
    const now = new Date().toISOString();
    const newId = randomUUID();
    const tableName = this.tableUtil.sanitize(`template_${newId}`);
    const sourceAttributes =
      source.attributes && typeof source.attributes === 'object' && !Array.isArray(source.attributes)
        ? (source.attributes as Record<string, unknown>)
        : {};
    const target: ActivityTemplateSet = {
      ...source,
      id: newId,
      tableName,
      variantId: targetVariantId,
      timetableYearLabel: yearLabel || source.timetableYearLabel || null,
      createdAt: now,
      updatedAt: now,
      publishedFromVariantId: sourceVariantId,
      publishedFromTemplateId: source.id,
      publishedAt: now,
      attributes: {
        ...sourceAttributes,
        publishedFrom: {
          variantId: sourceVariantId,
          templateId: source.id,
          publishedAt: now,
        },
      },
      isArchived: false,
      archivedAt: null,
      archivedReason: null,
    };

    await this.repository.publishTemplateSet({
      sourceTableName: source.tableName,
      target,
      archiveReason: `published from ${sourceVariantId}`,
    });

    return target;
  }

  async upsertTemplateActivity(
    templateId: string,
    activity: ActivityDto,
    variantId?: string,
  ): Promise<ActivityDto> {
    this.ensureDbForWrites();
    const set = await this.getTemplateSet(templateId, variantId);
    const normalized = this.normalizeManagedTemplateActivity(activity);
    const saved = await this.repository.upsertActivity(set.tableName, normalized.activity);
    if (normalized.deletedId) {
      await this.repository.deleteActivity(set.tableName, normalized.deletedId);
    }
    return saved;
  }

  async deleteTemplateActivity(
    templateId: string,
    activityId: string,
    variantId?: string,
  ): Promise<void> {
    this.ensureDbForWrites();
    if (this.isManagedServiceActivityId(activityId)) {
      throw new BadRequestException({
        message: 'Systemvorgaben können nicht gelöscht werden.',
        error: 'ValidationError',
        statusCode: 400,
        violations: [
          {
            activityId,
            code: 'MANAGED_DELETE_FORBIDDEN',
            message: 'Systemvorgaben dürfen nicht gelöscht werden.',
          },
        ],
      });
    }
    const set = await this.getTemplateSet(templateId, variantId);
    await this.repository.deleteActivity(set.tableName, activityId);
  }

  async getTemplateTimeline(
    templateId: string,
    from: string,
    to: string,
    lod: Lod,
    stage: 'base' | 'operations',
    variantId?: string,
  ): Promise<TimelineResponse> {
    if (!this.dbEnabled) {
      if (!this.loggedDbWarning) {
        this.logger.warn(
          `Template timeline requested without database connection. Returning empty ${lod}.`,
        );
        this.loggedDbWarning = true;
      }
      return lod === 'activity'
        ? { lod, activities: [] }
        : { lod, services: [] };
    }
    const set = await this.getTemplateSet(templateId, variantId);
    if (lod === 'activity') {
      const activities = await this.repository.listActivities(
        set.tableName,
        from,
        to,
        stage,
      );
      const enriched = await this.applyTemplateWorktimeCompliance(
        stage,
        set.variantId,
        activities,
      );
      return { lod, activities: enriched };
    }
    const services = await this.repository.listAggregatedServices(
      set.tableName,
      from,
      to,
      stage,
    );
    return { lod, services };
  }

  private async applyTemplateWorktimeCompliance(
    stageId: StageId,
    variantId: string,
    activities: ActivityDto[],
  ): Promise<ActivityDto[]> {
    if (!activities.length) {
      return activities;
    }
    const mapped = activities.map((activity) => this.mapTimelineActivity(activity));
    const updates = await this.dutyAutopilot.applyWorktimeCompliance(stageId, variantId, mapped);
    if (!updates.length) {
      return activities;
    }
    const updatedById = new Map(updates.map((activity) => [activity.id, activity]));
    return activities.map((dto) => {
      const updated = updatedById.get(dto.id);
      if (!updated) {
        return dto;
      }
      const nextServiceId =
        dto.serviceId && dto.serviceId.trim().length ? dto.serviceId : (updated.serviceId ?? null);
      return {
        ...dto,
        serviceId: nextServiceId,
        attributes: (updated.attributes ?? null) as ActivityDto['attributes'],
      };
    });
  }

  private mapTimelineActivity(activity: ActivityDto): Activity {
    const participants: ActivityParticipant[] = (activity.resourceAssignments ?? [])
      .filter((assignment) => !!assignment?.resourceId)
      .map((assignment) => ({
        resourceId: assignment.resourceId,
        kind: assignment.resourceType,
        role: assignment.role ?? null,
      }));
    return {
      id: activity.id,
      title:
        typeof activity.label === 'string' && activity.label.trim().length ? activity.label : activity.type,
      start: activity.start,
      end: activity.end ?? null,
      type: activity.type,
      from: activity.from ?? null,
      to: activity.to ?? null,
      remark: activity.remark ?? null,
      serviceId: activity.serviceId ?? null,
      serviceRole: activity.serviceRole ?? null,
      participants: participants.length ? participants : undefined,
      attributes: (activity.attributes ?? undefined) as Activity['attributes'],
    };
  }

  private normalizeManagedTemplateActivity(
    activity: ActivityDto,
  ): { activity: ActivityDto; deletedId: string | null } {
    const role = this.resolveServiceRole(activity);
    const isShortBreak = this.isShortBreakActivity(activity);
    const isBreak = this.isBreakActivity(activity);
    if (!role && !isBreak && !isShortBreak) {
      return { activity, deletedId: null };
    }

    const owners = this.resolveServiceOwners(activity);
    if (owners.length === 0) {
      throw new BadRequestException({
        message: 'Dienstgrenzen/Pausen benötigen genau einen Dienst.',
        error: 'ValidationError',
        statusCode: 400,
        violations: [
          {
            activityId: activity.id,
            code: 'MISSING_SERVICE_OWNER',
            message: 'Dienstgrenzen und Pausen benötigen einen Personaldienst oder Fahrzeugdienst.',
          },
        ],
      });
    }
    if (owners.length > 1) {
      throw new BadRequestException({
        message: 'Dienstgrenzen/Pausen benötigen genau einen Dienst.',
        error: 'ValidationError',
        statusCode: 400,
        violations: [
          {
            activityId: activity.id,
            code: 'MULTIPLE_SERVICE_OWNERS',
            message: 'Dienstgrenzen und Pausen dürfen nur einem Dienst zugeordnet sein.',
          },
        ],
      });
    }
    const ownerId = owners[0];
    const serviceId = this.computeServiceId(activity.stage, ownerId, activity.start);
    let targetId = activity.id;
    if (role) {
      targetId = `${role === 'start' ? 'svcstart' : 'svcend'}:${serviceId}`;
    } else {
      const prefix = isShortBreak ? 'svcshortbreak' : 'svcbreak';
      const suffix = this.sanitizeManagedSuffix(activity.id);
      targetId = `${prefix}:${serviceId}:${suffix || 'auto'}`;
    }

    const next: ActivityDto = {
      ...activity,
      id: targetId,
      serviceId,
      serviceRole: role ?? activity.serviceRole ?? null,
    };
    if (targetId === activity.id) {
      return { activity: next, deletedId: null };
    }
    return { activity: next, deletedId: activity.id };
  }

  private resolveServiceOwners(activity: ActivityDto): string[] {
    const assignments = activity.resourceAssignments ?? [];
    const owners = assignments
      .filter((assignment) => assignment?.resourceId && assignment?.resourceType)
      .filter(
        (assignment) =>
          assignment.resourceType === 'personnel-service' ||
          assignment.resourceType === 'vehicle-service',
      )
      .map((assignment) => assignment.resourceId);
    return Array.from(new Set(owners));
  }

  private resolveServiceRole(activity: ActivityDto): 'start' | 'end' | null {
    if (activity.serviceRole === 'start' || activity.serviceRole === 'end') {
      return activity.serviceRole;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (val: unknown) =>
      typeof val === 'boolean'
        ? val
        : typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : false;
    if (attrs) {
      if (toBool((attrs as any)['is_service_start'])) {
        return 'start';
      }
      if (toBool((attrs as any)['is_service_end'])) {
        return 'end';
      }
    }
    const type = (activity.type ?? '').toString().trim();
    if (type === 'service-start') {
      return 'start';
    }
    if (type === 'service-end') {
      return 'end';
    }
    return null;
  }

  private isBreakActivity(activity: ActivityDto): boolean {
    const id = (activity.id ?? '').toString();
    if (id.startsWith('svcbreak:') || id.startsWith('svcshortbreak:')) {
      return true;
    }
    const type = (activity.type ?? '').toString().trim().toLowerCase();
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const toBool = (val: unknown) =>
      typeof val === 'boolean'
        ? val
        : typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : false;
    const isBreak = toBool(attrs?.['is_break']) || type === 'break';
    const isShort = toBool(attrs?.['is_short_break']) || type === 'short-break';
    return isBreak && !isShort;
  }

  private isShortBreakActivity(activity: ActivityDto): boolean {
    const id = (activity.id ?? '').toString();
    if (id.startsWith('svcshortbreak:')) {
      return true;
    }
    const type = (activity.type ?? '').toString().trim().toLowerCase();
    if (type === 'short-break') {
      return true;
    }
    const attrs = activity.attributes as Record<string, unknown> | undefined;
    const raw = attrs?.['is_short_break'];
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'ja';
    }
    return false;
  }

  private sanitizeManagedSuffix(value: string): string {
    return (value ?? '').toString().replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private computeServiceId(stage: 'base' | 'operations', ownerId: string, startIso: string): string {
    const date = new Date(startIso);
    const y = date.getUTCFullYear();
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${date.getUTCDate()}`.padStart(2, '0');
    return `svc:${stage}:${ownerId}:${y}-${m}-${d}`;
  }

  private isManagedServiceActivityId(id: string): boolean {
    return (
      id.startsWith('svcstart:') ||
      id.startsWith('svcend:') ||
      id.startsWith('svcbreak:') ||
      id.startsWith('svcshortbreak:') ||
      id.startsWith('svccommute:')
    );
  }

  async rolloutTemplate(
    templateId: string,
    targetStage: 'base' | 'operations',
    anchorStart?: string,
    variantId?: string,
  ): Promise<ActivityDto[]> {
    this.ensureDbForWrites();
    const set = await this.getTemplateSet(templateId, variantId);
    const created = await this.repository.rolloutToPlanning(
      set.tableName,
      targetStage,
      anchorStart,
      variantId,
    );
    this.logger.log(
      `Rolled out template ${templateId} to stage ${targetStage} with ${created.length} activities.`,
    );
    return created;
  }
}
