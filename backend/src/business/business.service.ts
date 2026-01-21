import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessRepository } from './business.repository';
import {
  BusinessDto,
  BusinessSearchRequest,
  BusinessSearchResponse,
  CreateBusinessPayload,
  DEFAULT_BUSINESS_SORT,
  UpdateBusinessPayload,
} from './business.types';
import {
  matchesBusiness,
  normalizeFilters,
  normalizeSort,
  parseSearchTokens,
  sortBusinesses,
} from './business.filters';

@Injectable()
export class BusinessService {
  constructor(private readonly repository: BusinessRepository) {}

  async searchBusinesses(
    payload: BusinessSearchRequest,
  ): Promise<BusinessSearchResponse> {
    const page = this.normalizePage(payload.page);
    const pageSize = this.normalizePageSize(payload.pageSize);
    const filters = normalizeFilters(payload.filters);
    const sort = normalizeSort(payload.sort ?? DEFAULT_BUSINESS_SORT);
    const tokens = parseSearchTokens(filters.search);
    const now = new Date();

    const records = await this.repository.listBusinesses();
    const filtered = records
      .map((record) => this.mapBusiness(record))
      .filter((business) => matchesBusiness(business, filters, now, tokens))
      .sort((a, b) => sortBusinesses(a, b, sort));

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const businesses = filtered.slice(startIndex, startIndex + pageSize);
    return {
      businesses,
      total,
      page,
      pageSize,
      hasMore: startIndex + pageSize < total,
    };
  }

  async getBusinessById(businessId: string): Promise<BusinessDto> {
    const record = await this.repository.getBusinessById(businessId);
    if (!record) {
      throw new NotFoundException(`Business ${businessId} not found.`);
    }
    return this.mapBusiness(record);
  }

  async createBusiness(payload: CreateBusinessPayload): Promise<BusinessDto> {
    const businessId = this.generateBusinessId();
    const tags = this.normalizeTags(payload.tags ?? []);
    const dueDate = this.normalizeDueDate(payload.dueDate);
    const status = payload.status ?? 'neu';

    const record = await this.repository.createBusiness(
      {
        id: businessId,
        title: payload.title,
        description: payload.description,
        status,
        assignmentType: payload.assignment.type,
        assignmentName: payload.assignment.name,
        dueDate,
        documents: payload.documents as Prisma.InputJsonValue,
        tags,
        updatedAt: new Date(),
      },
      payload.linkedOrderItemIds ?? [],
    );

    return this.mapBusiness(record);
  }

  async updateBusiness(
    businessId: string,
    payload: UpdateBusinessPayload,
  ): Promise<BusinessDto> {
    const update: Prisma.BusinessUpdateInput = {
      updatedAt: new Date(),
    };

    if (payload.title !== undefined) {
      update.title = payload.title;
    }
    if (payload.description !== undefined) {
      update.description = payload.description;
    }
    if (payload.status !== undefined) {
      update.status = payload.status;
    }
    if (payload.assignment !== undefined) {
      update.assignmentType = payload.assignment.type;
      update.assignmentName = payload.assignment.name;
    }
    if (payload.dueDate !== undefined) {
      update.dueDate = this.normalizeDueDate(payload.dueDate);
    }
    if (payload.documents !== undefined) {
      update.documents = payload.documents as Prisma.InputJsonValue;
    }
    if (payload.tags !== undefined) {
      update.tags = this.normalizeTags(payload.tags);
    }

    const record = await this.repository.updateBusiness(
      businessId,
      update,
      payload.linkedOrderItemIds,
    );
    if (!record) {
      throw new NotFoundException(`Business ${businessId} not found.`);
    }
    return this.mapBusiness(record);
  }

  async deleteBusiness(businessId: string): Promise<void> {
    const deleted = await this.repository.deleteBusiness(businessId);
    if (!deleted) {
      throw new NotFoundException(`Business ${businessId} not found.`);
    }
  }

  private mapBusiness(
    record: Awaited<ReturnType<BusinessRepository['listBusinesses']>>[number],
  ): BusinessDto {
    return {
      id: record.id,
      title: record.title,
      description: record.description,
      createdAt: record.createdAt.toISOString(),
      dueDate: record.dueDate?.toISOString(),
      status: record.status as BusinessDto['status'],
      assignment: {
        type: record.assignmentType as BusinessDto['assignment']['type'],
        name: record.assignmentName,
      },
      documents: record.documents ?? undefined,
      linkedOrderItemIds: record.orderLinks.map((link) => link.orderItemId),
      tags: record.tags ?? undefined,
    };
  }

  private normalizeTags(tags: string[]): string[] {
    const cleaned = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
    return Array.from(new Set(cleaned));
  }

  private normalizeDueDate(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) {
      throw new BadRequestException('dueDate is invalid.');
    }
    return parsed;
  }

  private generateBusinessId(): string {
    return `biz-${Math.random().toString(36).slice(2, 8)}`;
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
