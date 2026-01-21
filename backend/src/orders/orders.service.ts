import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderItemRecord, OrdersRepository } from './orders.repository';
import {
  DEFAULT_ORDER_FILTERS,
  OrderDto,
  OrderFilters,
  OrderItemDto,
  OrderItemsSearchRequest,
  OrderItemsSearchResponse,
  OrderItemUpsertPayload,
  OrderUpsertPayload,
  OrdersSearchRequest,
  OrdersSearchResponse,
} from './orders.types';
import {
  OrderItemFilterContext,
  matchesBusinessStatus,
  matchesItem,
  matchesOrder,
  normalizeFilters,
  parseSearchTokens,
} from './orders.filters';

@Injectable()
export class OrdersService {
  constructor(private readonly repository: OrdersRepository) {}

  async searchOrders(
    payload: OrdersSearchRequest,
  ): Promise<OrdersSearchResponse> {
    const page = this.normalizePage(payload.page);
    const pageSize = this.normalizePageSize(payload.pageSize);
    const filters = normalizeFilters(payload.filters);
    const tokens = parseSearchTokens(filters.search);

    const records = await this.repository.listOrders();
    const filtered = records
      .map((record) =>
        this.buildOrderSearchResult(record, filters, tokens),
      )
      .filter((entry): entry is { order: OrderDto; items: OrderItemDto[] } =>
        Boolean(entry),
      );

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const orders = filtered
      .slice(startIndex, startIndex + pageSize)
      .map((entry) => ({
        ...entry.order,
        items: entry.items.map((item) => this.mapSearchItem(item)),
      }));

    return {
      orders,
      total,
      page,
      pageSize,
      hasMore: startIndex + pageSize < total,
    };
  }

  async searchOrderItems(
    orderId: string,
    payload: OrderItemsSearchRequest,
  ): Promise<OrderItemsSearchResponse> {
    const page = this.normalizePage(payload.page);
    const pageSize = this.normalizePageSize(payload.pageSize);
    const filters = normalizeFilters(payload.filters);

    const records = await this.repository.listOrderItems(orderId);
    const order = await this.repository.getOrderById(orderId);
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found.`);
    }

    const itemContexts = records.map((record) =>
      this.mapItemContext(record, order),
    );
    const filteredItems = this.filterItems(
      itemContexts,
      filters,
      order.timetableYearLabel ?? null,
    ).map((ctx) => ctx.item);

    const total = filteredItems.length;
    const startIndex = (page - 1) * pageSize;
    return {
      items: filteredItems.slice(startIndex, startIndex + pageSize),
      total,
      page,
      pageSize,
      hasMore: startIndex + pageSize < total,
    };
  }

  async getOrderById(orderId: string): Promise<OrderDto> {
    const record = await this.repository.getOrderById(orderId);
    if (!record) {
      throw new NotFoundException(`Order ${orderId} not found.`);
    }
    return this.mapOrder(record, record.items);
  }

  async createOrder(payload: OrderUpsertPayload): Promise<OrderDto> {
    const orderId = payload.order.id?.trim() || this.generateOrderId();
    return this.upsertOrder(orderId, payload);
  }

  async upsertOrder(
    orderId: string,
    payload: OrderUpsertPayload,
  ): Promise<OrderDto> {
    if (!payload.order?.name?.trim()) {
      throw new BadRequestException('order.name is required.');
    }

    const orderData = {
      id: orderId,
      name: payload.order.name.trim(),
      customerId: payload.order.customerId ?? null,
      customerLabel: payload.order.customer ?? null,
      comment: payload.order.comment ?? null,
      tags: this.normalizeTags(payload.order.tags),
      timetableYearLabel: payload.order.timetableYearLabel ?? null,
      processStatus: payload.order.processStatus ?? null,
      updatedAt: new Date(),
    };

    const items = payload.items
      ? payload.items.map((item) => this.buildItemUpsert(orderId, item))
      : null;

    const record = await this.repository.upsertOrder(orderData, items);
    return this.mapOrder(record, record.items);
  }

  async deleteOrder(orderId: string): Promise<void> {
    const deleted = await this.repository.deleteOrder(orderId);
    if (!deleted) {
      throw new NotFoundException(`Order ${orderId} not found.`);
    }
  }

  private buildOrderSearchResult(
    record: Awaited<ReturnType<OrdersRepository['listOrders']>>[number],
    filters: OrderFilters,
    tokens: ReturnType<typeof parseSearchTokens>,
  ): { order: OrderDto; items: OrderItemDto[] } | null {
    const itemContexts = record.items.map((item) =>
      this.mapItemContext(item, record),
    );

    const orderDto = this.mapOrder(record, []);
    const matches = matchesOrder(
      orderDto,
      itemContexts,
      filters,
      tokens,
      (ctx) => this.getItemTimetableYear(ctx, orderDto.timetableYearLabel),
    );
    if (!matches) {
      return null;
    }

    const filteredItems = this.filterItems(
      itemContexts,
      filters,
      orderDto.timetableYearLabel ?? null,
    ).map((ctx) => ctx.item);
    const itemFiltersActive = this.hasActiveItemFilters(filters);
    if (itemFiltersActive && filteredItems.length === 0) {
      return null;
    }

    return {
      order: orderDto,
      items: filteredItems,
    };
  }

  private filterItems(
    itemContexts: OrderItemFilterContext[],
    filters: OrderFilters,
    orderYearLabel: string | null,
  ): OrderItemFilterContext[] {
    const base = itemContexts.filter((ctx) =>
      matchesItem(ctx, filters, (item) =>
        this.getItemTimetableYear(item, orderYearLabel),
      ),
    );
    if (filters.businessStatus === 'all') {
      return base;
    }
    return base.filter((ctx) =>
      matchesBusinessStatus(ctx, filters.businessStatus),
    );
  }

  private getItemTimetableYear(
    ctx: OrderItemFilterContext,
    orderYearLabel?: string | null,
  ): string | null {
    if (ctx.item.timetableYearLabel) {
      return ctx.item.timetableYearLabel;
    }
    if (ctx.trafficPeriodYearLabel) {
      return ctx.trafficPeriodYearLabel;
    }
    if (orderYearLabel) {
      return orderYearLabel;
    }
    return null;
  }

  private mapOrder(
    record: Awaited<ReturnType<OrdersRepository['getOrderById']>>,
    items: Awaited<ReturnType<OrdersRepository['listOrders']>>[number]['items'],
  ): OrderDto {
    if (!record) {
      throw new Error('Order record is required.');
    }
    return {
      id: record.id,
      name: record.name,
      customerId: record.customerId ?? undefined,
      customer: record.customer?.name ?? record.customerLabel ?? undefined,
      tags: record.tags ?? undefined,
      comment: record.comment ?? undefined,
      timetableYearLabel: record.timetableYearLabel ?? undefined,
      processStatus: record.processStatus ?? undefined,
      createdAt: record.createdAt?.toISOString(),
      updatedAt: record.updatedAt?.toISOString(),
      items: items.map((item) => this.mapItem(item)),
    };
  }

  private mapItem(item: OrderItemRecord): OrderItemDto {
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      tags: item.tags ?? undefined,
      start: item.start?.toISOString(),
      end: item.end?.toISOString(),
      responsible: item.responsible ?? undefined,
      deviation: item.deviation ?? undefined,
      linkedBusinessIds: item.businessLinks.map((link) => link.businessId),
      linkedTemplateId: item.linkedTemplateId ?? undefined,
      linkedTrainPlanId: item.linkedTrainPlanId ?? undefined,
      trafficPeriodId: item.trafficPeriodId ?? undefined,
      timetableYearLabel: item.timetableYearLabel ?? undefined,
      serviceType: item.serviceType ?? undefined,
      fromLocation: item.fromLocation ?? undefined,
      toLocation: item.toLocation ?? undefined,
      validity: item.validity ?? undefined,
      parentItemId: item.parentItemId ?? undefined,
      versionPath: item.versionPath ?? undefined,
      generatedTimetableRefId: item.generatedTimetableRefId ?? undefined,
      timetablePhase: item.timetablePhase ?? undefined,
      variantType: item.variantType ?? undefined,
      variantOfItemId: item.variantOfItemId ?? undefined,
      variantGroupId: item.variantGroupId ?? undefined,
      variantLabel: item.variantLabel ?? undefined,
      simulationId: item.simulationId ?? undefined,
      simulationLabel: item.simulationLabel ?? undefined,
      mergeStatus: item.mergeStatus ?? undefined,
      mergeTargetId: item.mergeTargetId ?? undefined,
      originalTimetable: item.originalTimetable ?? undefined,
      internalStatus: item.internalStatus ?? undefined,
      createdAt: item.createdAt?.toISOString(),
      updatedAt: item.updatedAt?.toISOString(),
    };
  }

  private mapSearchItem(item: OrderItemDto): OrderItemDto {
    if (item.originalTimetable === undefined) {
      return item;
    }
    return { ...item, originalTimetable: undefined };
  }

  private mapItemContext(
    record: OrderItemRecord,
    order: Awaited<ReturnType<OrdersRepository['getOrderById']>>,
  ): OrderItemFilterContext {
    const item = this.mapItem(record);
    return {
      item,
      linkedTrainNumber: record.linkedTrainPlan?.trainNumber ?? null,
      trafficPeriodYearLabel: record.trafficPeriod?.timetableYearLabel ?? null,
      businessStatuses: record.businessLinks
        .map((link) => link.business?.status)
        .filter((value): value is string => Boolean(value)),
    };
  }

  private buildItemUpsert(
    orderId: string,
    payload: OrderItemUpsertPayload,
  ): {
    data: {
      id: string;
      orderId: string;
      name: string;
      type: string;
      tags: string[];
      start: Date | null;
      end: Date | null;
      responsible: string | null;
      deviation: string | null;
      serviceType: string | null;
      fromLocation: string | null;
      toLocation: string | null;
      validity:
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput
        | undefined;
      parentItemId: string | null;
      versionPath: number[];
      generatedTimetableRefId: string | null;
      timetablePhase: string | null;
      internalStatus: string | null;
      timetableYearLabel: string | null;
      trafficPeriodId: string | null;
      linkedTemplateId: string | null;
      linkedTrainPlanId: string | null;
      variantType: string | null;
      variantOfItemId: string | null;
      variantGroupId: string | null;
      variantLabel: string | null;
      simulationId: string | null;
      simulationLabel: string | null;
      mergeStatus: string | null;
      mergeTargetId: string | null;
      originalTimetable:
        | Prisma.InputJsonValue
        | Prisma.NullableJsonNullValueInput
        | undefined;
      updatedAt: Date;
    };
    linkedBusinessIds: string[];
  } {
    if (!payload.id?.trim()) {
      throw new BadRequestException('order item id is required.');
    }
    if (!payload.name?.trim()) {
      throw new BadRequestException(`order item ${payload.id} name is required.`);
    }
    if (!payload.type?.trim()) {
      throw new BadRequestException(`order item ${payload.id} type is required.`);
    }

    return {
      data: {
        id: payload.id,
        orderId,
        name: payload.name.trim(),
        type: payload.type,
        tags: this.normalizeTags(payload.tags),
        start: this.parseOptionalDateInput(payload.start, 'start'),
        end: this.parseOptionalDateInput(payload.end, 'end'),
        responsible: payload.responsible ?? null,
        deviation: payload.deviation ?? null,
        serviceType: payload.serviceType ?? null,
        fromLocation: payload.fromLocation ?? null,
        toLocation: payload.toLocation ?? null,
        validity: this.normalizeJsonInput(payload.validity),
        parentItemId: payload.parentItemId ?? null,
        versionPath: payload.versionPath ?? [],
        generatedTimetableRefId: payload.generatedTimetableRefId ?? null,
        timetablePhase: payload.timetablePhase ?? null,
        internalStatus: payload.internalStatus ?? null,
        timetableYearLabel: payload.timetableYearLabel ?? null,
        trafficPeriodId: payload.trafficPeriodId ?? null,
        linkedTemplateId: payload.linkedTemplateId ?? null,
        linkedTrainPlanId: payload.linkedTrainPlanId ?? null,
        variantType: payload.variantType ?? null,
        variantOfItemId: payload.variantOfItemId ?? null,
        variantGroupId: payload.variantGroupId ?? null,
        variantLabel: payload.variantLabel ?? null,
        simulationId: payload.simulationId ?? null,
        simulationLabel: payload.simulationLabel ?? null,
        mergeStatus: payload.mergeStatus ?? null,
        mergeTargetId: payload.mergeTargetId ?? null,
        originalTimetable: this.normalizeJsonInput(payload.originalTimetable),
        updatedAt: new Date(),
      },
      linkedBusinessIds: payload.linkedBusinessIds ?? [],
    };
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags?.length) {
      return [];
    }
    return Array.from(
      new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length)),
    );
  }

  private parseOptionalDateInput(
    value: string | undefined,
    field: string,
  ): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} is invalid.`);
    }
    return parsed;
  }

  private normalizeJsonInput(
    value: unknown | null | undefined,
  ):
    | Prisma.InputJsonValue
    | Prisma.NullableJsonNullValueInput
    | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return Prisma.DbNull;
    }
    return value as Prisma.InputJsonValue;
  }

  private generateOrderId(): string {
    const stamp = Date.now().toString(36).toUpperCase();
    return `A-${stamp}`;
  }

  private normalizePage(value?: number): number {
    const page = Number.isFinite(value) ? Math.floor(value as number) : 1;
    return Math.max(page, 1);
  }

  private normalizePageSize(value?: number): number {
    const pageSize = Number.isFinite(value) ? Math.floor(value as number) : 30;
    return Math.min(Math.max(pageSize, 1), 200);
  }

  private hasActiveItemFilters(filters: OrderFilters): boolean {
    return (
      filters.timeRange !== DEFAULT_ORDER_FILTERS.timeRange ||
      filters.trainStatus !== DEFAULT_ORDER_FILTERS.trainStatus ||
      filters.businessStatus !== DEFAULT_ORDER_FILTERS.businessStatus ||
      filters.internalStatus !== DEFAULT_ORDER_FILTERS.internalStatus ||
      filters.trainNumber.trim() !== '' ||
      filters.timetableYearLabel !== DEFAULT_ORDER_FILTERS.timetableYearLabel ||
      filters.ttrPhase !== DEFAULT_ORDER_FILTERS.ttrPhase ||
      Boolean(filters.fpRangeStart) ||
      Boolean(filters.fpRangeEnd) ||
      Boolean(filters.linkedBusinessId)
    );
  }
}
