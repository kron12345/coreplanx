import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessTemplatesRepository } from './business-templates.repository';
import {
  BusinessTemplateDto,
  BusinessTemplateSearchRequest,
  BusinessTemplateSearchResponse,
  BusinessTemplateDueAnchor,
  CreateBusinessTemplatePayload,
  UpdateBusinessTemplatePayload,
} from './business-templates.types';
import {
  matchesTemplate,
  normalizeFilters,
  normalizeSort,
  sortTemplates,
} from './business-templates.filters';

@Injectable()
export class BusinessTemplatesService {
  constructor(private readonly repository: BusinessTemplatesRepository) {}

  async searchTemplates(
    payload: BusinessTemplateSearchRequest,
  ): Promise<BusinessTemplateSearchResponse> {
    const page = this.normalizePage(payload.page);
    const pageSize = this.normalizePageSize(payload.pageSize);
    const filters = normalizeFilters(payload.filters);
    const sort = normalizeSort(payload.sort);

    const records = await this.repository.listTemplates();
    const filtered = records
      .map((record) => this.mapTemplate(record))
      .filter((template) => matchesTemplate(template, filters))
      .sort((a, b) => sortTemplates(a, b, sort));

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const templates = filtered.slice(startIndex, startIndex + pageSize);

    return {
      templates,
      total,
      page,
      pageSize,
      hasMore: startIndex + pageSize < total,
    };
  }

  async getTemplateById(templateId: string): Promise<BusinessTemplateDto> {
    const record = await this.repository.getTemplateById(templateId);
    if (!record) {
      throw new NotFoundException(
        `Business template ${templateId} not found.`,
      );
    }
    return this.mapTemplate(record);
  }

  async createTemplate(
    payload: CreateBusinessTemplatePayload,
  ): Promise<BusinessTemplateDto> {
    const templateId = this.generateTemplateId();
    const tags = this.normalizeTags(payload.tags ?? []);
    const dueRuleLabel =
      payload.dueRule.label?.trim() ||
      this.formatOffsetLabel(payload.dueRule.anchor, payload.dueRule.offsetDays);

    const record = await this.repository.createTemplate({
      id: templateId,
      title: payload.title,
      description: payload.description,
      instructions: payload.instructions ?? null,
      tags,
      category: payload.category ?? 'Custom',
      recommendedAssignmentType: payload.assignment.type,
      recommendedAssignmentName: payload.assignment.name,
      dueRuleAnchor: payload.dueRule.anchor,
      dueRuleOffsetDays: payload.dueRule.offsetDays,
      dueRuleLabel: dueRuleLabel,
      defaultLeadTimeDays: payload.defaultLeadTimeDays,
      automationHint: payload.automationHint ?? null,
      steps: payload.steps as unknown as Prisma.InputJsonValue,
      parameterHints: payload.parameterHints ?? [],
      updatedAt: new Date(),
    });

    return this.mapTemplate(record);
  }

  async updateTemplate(
    templateId: string,
    payload: UpdateBusinessTemplatePayload,
  ): Promise<BusinessTemplateDto> {
    const update: Prisma.BusinessTemplateUpdateInput = {
      updatedAt: new Date(),
    };

    if (payload.title !== undefined) {
      update.title = payload.title;
    }
    if (payload.description !== undefined) {
      update.description = payload.description;
    }
    if (payload.instructions !== undefined) {
      update.instructions = payload.instructions ?? null;
    }
    if (payload.tags !== undefined) {
      update.tags = this.normalizeTags(payload.tags);
    }
    if (payload.category !== undefined) {
      update.category = payload.category;
    }
    if (payload.assignment !== undefined) {
      update.recommendedAssignmentType = payload.assignment.type;
      update.recommendedAssignmentName = payload.assignment.name;
    }
    if (payload.dueRule !== undefined) {
      const label =
        payload.dueRule.label?.trim() ||
        this.formatOffsetLabel(
          payload.dueRule.anchor,
          payload.dueRule.offsetDays,
        );
      update.dueRuleAnchor = payload.dueRule.anchor;
      update.dueRuleOffsetDays = payload.dueRule.offsetDays;
      update.dueRuleLabel = label;
    }
    if (payload.defaultLeadTimeDays !== undefined) {
      update.defaultLeadTimeDays = payload.defaultLeadTimeDays;
    }
    if (payload.automationHint !== undefined) {
      update.automationHint = payload.automationHint ?? null;
    }
    if (payload.steps !== undefined) {
      update.steps = payload.steps as unknown as Prisma.InputJsonValue;
    }
    if (payload.parameterHints !== undefined) {
      update.parameterHints = payload.parameterHints ?? [];
    }

    const record = await this.repository.updateTemplate(templateId, update);
    if (!record) {
      throw new NotFoundException(
        `Business template ${templateId} not found.`,
      );
    }
    return this.mapTemplate(record);
  }

  async deleteTemplate(templateId: string): Promise<void> {
    const deleted = await this.repository.deleteTemplate(templateId);
    if (!deleted) {
      throw new NotFoundException(
        `Business template ${templateId} not found.`,
      );
    }
  }

  private mapTemplate(
    record: Awaited<ReturnType<BusinessTemplatesRepository['listTemplates']>>[number],
  ): BusinessTemplateDto {
    return {
      id: record.id,
      title: record.title,
      description: record.description,
      instructions: record.instructions ?? undefined,
      tags: record.tags ?? [],
      category: record.category as BusinessTemplateDto['category'],
      recommendedAssignment: {
        type: record.recommendedAssignmentType as BusinessTemplateDto['recommendedAssignment']['type'],
        name: record.recommendedAssignmentName,
      },
      dueRule: {
        anchor: record.dueRuleAnchor as BusinessTemplateDto['dueRule']['anchor'],
        offsetDays: record.dueRuleOffsetDays,
        label: record.dueRuleLabel,
      },
      defaultLeadTimeDays: record.defaultLeadTimeDays,
      automationHint: record.automationHint ?? undefined,
      steps: record.steps
        ? (record.steps as unknown as BusinessTemplateDto['steps'])
        : undefined,
      parameterHints: record.parameterHints ?? undefined,
      createdAt: record.createdAt?.toISOString(),
      updatedAt: record.updatedAt?.toISOString(),
    };
  }

  private normalizeTags(tags: string[]): string[] {
    const cleaned = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
    return Array.from(new Set(cleaned));
  }

  private formatOffsetLabel(
    anchor: BusinessTemplateDueAnchor,
    offsetDays: number,
  ): string {
    if (!Number.isFinite(offsetDays)) {
      throw new BadRequestException('dueRule.offsetDays is invalid.');
    }
    const abs = Math.abs(offsetDays);
    const direction = offsetDays < 0 ? 'vor' : 'nach';
    const anchorLabel =
      anchor === 'order_creation'
        ? 'Auftragserstellung'
        : anchor === 'go_live'
          ? 'Go-Live'
          : 'Produktion';
    return `${abs} Tage ${direction} ${anchorLabel}`;
  }

  private generateTemplateId(): string {
    return `tpl-${Math.random().toString(36).slice(2, 8)}`;
  }

  private normalizePage(value?: number): number {
    const page = Number.isFinite(value) ? Math.floor(value as number) : 1;
    return Math.max(page, 1);
  }

  private normalizePageSize(value?: number): number {
    const pageSize = Number.isFinite(value) ? Math.floor(value as number) : 30;
    return Math.min(Math.max(pageSize, 1), 200);
  }
}
