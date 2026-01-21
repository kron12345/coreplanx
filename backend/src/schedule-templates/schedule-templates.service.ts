import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ScheduleTemplatesRepository } from './schedule-templates.repository';
import {
  CreateScheduleTemplatePayload,
  CreateScheduleTemplateStopPayload,
  ScheduleTemplateDto,
  ScheduleTemplateSearchRequest,
  ScheduleTemplateSearchResponse,
  UpdateScheduleTemplatePayload,
} from './schedule-templates.types';
import {
  matchesTemplate,
  normalizeFilters,
  normalizeSort,
  sortTemplates,
} from './schedule-templates.filters';

@Injectable()
export class ScheduleTemplatesService {
  constructor(private readonly repository: ScheduleTemplatesRepository) {}

  async searchTemplates(
    payload: ScheduleTemplateSearchRequest,
  ): Promise<ScheduleTemplateSearchResponse> {
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

  async getTemplateById(templateId: string): Promise<ScheduleTemplateDto> {
    const record = await this.repository.getTemplateById(templateId);
    if (!record) {
      throw new NotFoundException(
        `Schedule template ${templateId} not found.`,
      );
    }
    return this.mapTemplate(record);
  }

  async createTemplate(
    payload: CreateScheduleTemplatePayload,
  ): Promise<ScheduleTemplateDto> {
    const templateId = this.generateTemplateId();
    const validityStart = this.parseDateInput(payload.startDate, 'startDate');
    const validityEnd = this.parseOptionalDateInput(payload.endDate, 'endDate');
    const tags = this.normalizeTags(payload.tags);

    const recurrence =
      payload.recurrence === undefined
        ? undefined
        : (payload.recurrence as unknown as Prisma.InputJsonValue);
    const composition =
      payload.composition === undefined
        ? undefined
        : (payload.composition as unknown as Prisma.InputJsonValue);

    const stopData = payload.stops.map((stop, index) =>
      this.buildStopData(templateId, index, stop),
    );
    const stops = stopData.map(({ templateId: _, ...rest }) => rest);

    const record = await this.repository.createTemplate(
      {
        id: templateId,
        title: payload.title,
        description: payload.description ?? null,
        trainNumber: payload.trainNumber,
        responsibleRu: payload.responsibleRu,
        status: payload.status,
        category: payload.category,
        tags,
        validityStart,
        validityEnd,
        recurrence,
        composition,
        updatedAt: new Date(),
      },
      stops,
    );

    return this.mapTemplate(record);
  }

  async updateTemplate(
    templateId: string,
    payload: UpdateScheduleTemplatePayload,
  ): Promise<ScheduleTemplateDto> {
    const update: Prisma.ScheduleTemplateUpdateInput = {
      updatedAt: new Date(),
    };

    if (payload.title !== undefined) {
      update.title = payload.title;
    }
    if (payload.description !== undefined) {
      update.description = payload.description ?? null;
    }
    if (payload.trainNumber !== undefined) {
      update.trainNumber = payload.trainNumber;
    }
    if (payload.responsibleRu !== undefined) {
      update.responsibleRu = payload.responsibleRu;
    }
    if (payload.status !== undefined) {
      update.status = payload.status;
    }
    if (payload.category !== undefined) {
      update.category = payload.category;
    }
    if (payload.tags !== undefined) {
      update.tags = this.normalizeTags(payload.tags);
    }
    if (payload.startDate !== undefined) {
      update.validityStart = this.parseDateInput(
        payload.startDate,
        'startDate',
      );
    }
    if (payload.endDate !== undefined) {
      update.validityEnd = this.parseOptionalDateInput(
        payload.endDate,
        'endDate',
      );
    }
    if (payload.recurrence !== undefined) {
      update.recurrence = payload.recurrence as unknown as Prisma.InputJsonValue;
    }
    if (payload.composition !== undefined) {
      update.composition = payload.composition as unknown as Prisma.InputJsonValue;
    }

    const stops =
      payload.stops === undefined
        ? undefined
        : payload.stops.map((stop, index) =>
            this.buildStopData(templateId, index, stop),
          );

    const record = await this.repository.updateTemplate(
      templateId,
      update,
      stops,
    );
    if (!record) {
      throw new NotFoundException(
        `Schedule template ${templateId} not found.`,
      );
    }
    return this.mapTemplate(record);
  }

  async deleteTemplate(templateId: string): Promise<void> {
    const deleted = await this.repository.deleteTemplate(templateId);
    if (!deleted) {
      throw new NotFoundException(
        `Schedule template ${templateId} not found.`,
      );
    }
  }

  private mapTemplate(
    record: Awaited<ReturnType<ScheduleTemplatesRepository['listTemplates']>>[number],
  ): ScheduleTemplateDto {
    return {
      id: record.id,
      title: record.title,
      description: record.description ?? undefined,
      trainNumber: record.trainNumber,
      responsibleRu: record.responsibleRu,
      status: record.status as ScheduleTemplateDto['status'],
      category: record.category as ScheduleTemplateDto['category'],
      tags: record.tags?.length ? record.tags : undefined,
      validity: {
        startDate: record.validityStart.toISOString().slice(0, 10),
        endDate: record.validityEnd
          ? record.validityEnd.toISOString().slice(0, 10)
          : undefined,
      },
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      stops: record.stops.map((stop) => ({
        id: stop.id,
        sequence: stop.sequence,
        type: stop.type as ScheduleTemplateDto['stops'][number]['type'],
        locationCode: stop.locationCode,
        locationName: stop.locationName,
        countryCode: stop.countryCode ?? undefined,
        arrival:
          stop.arrivalEarliest || stop.arrivalLatest
            ? {
                earliest: stop.arrivalEarliest ?? undefined,
                latest: stop.arrivalLatest ?? undefined,
              }
            : undefined,
        departure:
          stop.departureEarliest || stop.departureLatest
            ? {
                earliest: stop.departureEarliest ?? undefined,
                latest: stop.departureLatest ?? undefined,
              }
            : undefined,
        offsetDays: stop.offsetDays ?? undefined,
        dwellMinutes: stop.dwellMinutes ?? undefined,
        activities: stop.activities ?? [],
        platformWish: stop.platformWish ?? undefined,
        notes: stop.notes ?? undefined,
      })),
      recurrence: record.recurrence
        ? (record.recurrence as unknown as ScheduleTemplateDto['recurrence'])
        : undefined,
      composition: record.composition
        ? (record.composition as unknown as ScheduleTemplateDto['composition'])
        : undefined,
    };
  }

  private buildStopData(
    templateId: string,
    index: number,
    payload: CreateScheduleTemplateStopPayload,
  ): Prisma.ScheduleTemplateStopCreateManyInput {
    return {
      id: `${templateId}-ST-${String(index + 1).padStart(3, '0')}`,
      templateId,
      sequence: index + 1,
      type: payload.type,
      locationCode: payload.locationCode,
      locationName: payload.locationName,
      countryCode: payload.countryCode ?? null,
      arrivalEarliest: payload.arrivalEarliest ?? null,
      arrivalLatest: payload.arrivalLatest ?? null,
      departureEarliest: payload.departureEarliest ?? null,
      departureLatest: payload.departureLatest ?? null,
      offsetDays: payload.offsetDays ?? null,
      dwellMinutes: payload.dwellMinutes ?? null,
      activities: payload.activities ?? [],
      platformWish: payload.platformWish ?? null,
      notes: payload.notes ?? null,
    };
  }

  private parseDateInput(input: string | Date, field: string): Date {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return date;
  }

  private parseOptionalDateInput(
    input: string | Date | null | undefined,
    field: string,
  ): Date | null {
    if (input === null) {
      return null;
    }
    if (input === undefined) {
      return null;
    }
    return this.parseDateInput(input, field);
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags?.length) {
      return [];
    }
    const cleaned = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length);
    return Array.from(new Set(cleaned));
  }

  private generateTemplateId(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    return `TPL-${timestamp}`;
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
