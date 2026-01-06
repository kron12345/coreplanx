import {
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
    return this.repository.upsertActivity(set.tableName, activity);
  }

  async deleteTemplateActivity(
    templateId: string,
    activityId: string,
    variantId?: string,
  ): Promise<void> {
    this.ensureDbForWrites();
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
