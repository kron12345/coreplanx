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
import { ActivityDto, Lod, TimelineResponse, TimelineServiceDto } from '../timeline/timeline.types';

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    private readonly repository: TemplateRepository,
    private readonly tableUtil: TemplateTableUtil,
  ) {}

  private ensureDb(): void {
    if (!this.repository.isEnabled) {
      throw new ServiceUnavailableException(
        'Database connection is required for templates.',
      );
    }
  }

  async listTemplateSets(): Promise<ActivityTemplateSet[]> {
    this.ensureDb();
    return this.repository.listTemplateSets();
  }

  async getTemplateSet(id: string): Promise<ActivityTemplateSet> {
    this.ensureDb();
    const set = await this.repository.getTemplateSet(id);
    if (!set) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return set;
  }

  async createTemplateSet(payload: CreateTemplateSetPayload): Promise<ActivityTemplateSet> {
    this.ensureDb();
    const now = new Date().toISOString();
    const tableName = this.tableUtil.sanitize(`template_${payload.id}`);
    const set: ActivityTemplateSet = {
      id: payload.id || randomUUID(),
      name: payload.name,
      description: payload.description ?? undefined,
      tableName,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.createTemplateSet(set);
    return set;
  }

  async updateTemplateSet(id: string, payload: UpdateTemplateSetPayload): Promise<ActivityTemplateSet> {
    this.ensureDb();
    const existing = await this.getTemplateSet(id);
    const updated: ActivityTemplateSet = {
      ...existing,
      name: payload.name ?? existing.name,
      description: payload.description ?? existing.description,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.updateTemplateSet(updated);
    return updated;
  }

  async deleteTemplateSet(id: string): Promise<void> {
    this.ensureDb();
    await this.repository.deleteTemplateSet(id);
  }

  async upsertTemplateActivity(
    templateId: string,
    activity: ActivityDto,
  ): Promise<ActivityDto> {
    this.ensureDb();
    const set = await this.getTemplateSet(templateId);
    return this.repository.upsertActivity(set.tableName, activity);
  }

  async deleteTemplateActivity(templateId: string, activityId: string): Promise<void> {
    this.ensureDb();
    const set = await this.getTemplateSet(templateId);
    await this.repository.deleteActivity(set.tableName, activityId);
  }

  async getTemplateTimeline(
    templateId: string,
    from: string,
    to: string,
    lod: Lod,
    stage: 'base' | 'operations',
  ): Promise<TimelineResponse> {
    this.ensureDb();
    const set = await this.getTemplateSet(templateId);
    if (lod === 'activity') {
      const activities = await this.repository.listActivities(set.tableName, from, to, stage);
      return { lod, activities };
    }
    const services = await this.repository.listAggregatedServices(set.tableName, from, to, stage);
    return { lod, services };
  }

  async rolloutTemplate(
    templateId: string,
    targetStage: 'base' | 'operations',
    anchorStart?: string,
  ): Promise<ActivityDto[]> {
    this.ensureDb();
    const set = await this.getTemplateSet(templateId);
    const created = await this.repository.rolloutToPlanning(
      set.tableName,
      targetStage,
      anchorStart,
    );
    this.logger.log(
      `Rolled out template ${templateId} to stage ${targetStage} with ${created.length} activities.`,
    );
    return created;
  }
}
