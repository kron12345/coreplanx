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
  private readonly dbEnabled: boolean;
  private loggedDbWarning = false;

  constructor(
    private readonly repository: TemplateRepository,
    private readonly tableUtil: TemplateTableUtil,
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

  async listTemplateSets(): Promise<ActivityTemplateSet[]> {
    if (!this.dbEnabled) {
      return [];
    }
    return this.repository.listTemplateSets();
  }

  async getTemplateSet(id: string): Promise<ActivityTemplateSet> {
    if (!this.dbEnabled) {
      throw new NotFoundException(`Template ${id} not found (database disabled).`);
    }
    const set = await this.repository.getTemplateSet(id);
    if (!set) {
      throw new NotFoundException(`Template ${id} not found`);
    }
    return set;
  }

  async createTemplateSet(payload: CreateTemplateSetPayload): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const now = new Date().toISOString();
    const tableName = this.tableUtil.sanitize(`template_${payload.id}`);
    const set: ActivityTemplateSet = {
      id: payload.id || randomUUID(),
      name: payload.name,
      description: payload.description ?? undefined,
      tableName,
      createdAt: now,
      updatedAt: now,
      periods: [],
      specialDays: [],
    };
    await this.repository.createTemplateSet(set);
    return set;
  }

  async updateTemplateSet(id: string, payload: UpdateTemplateSetPayload): Promise<ActivityTemplateSet> {
    this.ensureDbForWrites();
    const existing = await this.getTemplateSet(id);
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

  async deleteTemplateSet(id: string): Promise<void> {
    this.ensureDbForWrites();
    await this.repository.deleteTemplateSet(id);
  }

  async upsertTemplateActivity(
    templateId: string,
    activity: ActivityDto,
  ): Promise<ActivityDto> {
    this.ensureDbForWrites();
    const set = await this.getTemplateSet(templateId);
    return this.repository.upsertActivity(set.tableName, activity);
  }

  async deleteTemplateActivity(templateId: string, activityId: string): Promise<void> {
    this.ensureDbForWrites();
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
    this.ensureDbForWrites();
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
