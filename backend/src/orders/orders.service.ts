import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { TimetableService } from '../timetable/timetable.service';
import { buildProductiveVariantId } from '../shared/variant-scope';
import type { TrainRun, TrainSegment } from '../planning/planning.types';

type OrderTimetableSnapshot = {
  refTrainId?: string;
  title?: string;
  trainNumber?: string;
  calendar?: {
    validFrom?: string;
    validTo?: string;
    daysBitmap?: string;
  };
  stops?: Array<{
    sequence?: number;
    locationName?: string;
    arrivalTime?: string;
    departureTime?: string;
  }>;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly repository: OrdersRepository,
    private readonly timetableService: TimetableService,
  ) {}

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
    await this.syncPlanningTimetables(record, orderData.timetableYearLabel);
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

    const generatedRef =
      payload.generatedTimetableRefId?.trim() || null;
    const linkedPlanId =
      payload.linkedTrainPlanId?.trim() ||
      (payload.type === 'Fahrplan' ? generatedRef : null);

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
        generatedTimetableRefId: generatedRef,
        timetablePhase: payload.timetablePhase ?? null,
        internalStatus: payload.internalStatus ?? null,
        timetableYearLabel: payload.timetableYearLabel ?? null,
        trafficPeriodId: payload.trafficPeriodId ?? null,
        linkedTemplateId: payload.linkedTemplateId ?? null,
        linkedTrainPlanId: linkedPlanId,
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

  private async syncPlanningTimetables(
    record: { items: OrderItemRecord[] },
    orderYearLabel: string | null,
  ): Promise<void> {
    const items = record.items.filter((item) => item.type === 'Fahrplan');
    if (!items.length) {
      return;
    }

    const updates = new Map<
      string,
      { runs: Map<string, TrainRun>; segmentsByRun: Map<string, TrainSegment[]> }
    >();

    items.forEach((item) => {
      const snapshot = this.readTimetableSnapshot(item.originalTimetable);
      const refId =
        item.generatedTimetableRefId?.trim() ||
        snapshot?.refTrainId?.trim() ||
        '';
      if (!refId) {
        return;
      }

      const yearLabel =
        item.timetableYearLabel?.trim() ||
        orderYearLabel?.trim() ||
        this.deriveTimetableYearLabelFromDate(
          this.resolveReferenceDate(item, snapshot),
        );
      const variantId =
        item.variantType === 'simulation' && item.simulationId?.trim()
          ? item.simulationId.trim()
          : yearLabel
            ? buildProductiveVariantId(yearLabel)
            : 'default';

      const run = this.buildTrainRun(item, snapshot, refId);
      const segments = this.buildTrainSegments(item, snapshot, refId);

      const entry =
        updates.get(variantId) ?? {
          runs: new Map<string, TrainRun>(),
          segmentsByRun: new Map<string, TrainSegment[]>(),
        };
      entry.runs.set(run.id, run);
      if (segments.length) {
        entry.segmentsByRun.set(run.id, segments);
      }
      updates.set(variantId, entry);
    });

    for (const [variantId, entry] of updates.entries()) {
      const snapshot = await this.timetableService.getSnapshot(variantId, 'base');
      const runsMap = new Map(
        (snapshot.trainRuns ?? []).map((run) => [run.id, run] as const),
      );
      entry.runs.forEach((run, id) => runsMap.set(id, run));

      let segments = snapshot.trainSegments ?? [];
      if (entry.segmentsByRun.size) {
        const updatedRunIds = new Set(entry.segmentsByRun.keys());
        segments = segments.filter((seg) => !updatedRunIds.has(seg.trainRunId));
        entry.segmentsByRun.forEach((list) => segments.push(...list));
      }

      try {
        await this.timetableService.replaceSnapshot({
          variantId,
          stageId: 'base',
          trainRuns: Array.from(runsMap.values()),
          trainSegments: segments,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to sync planning timetable for variant ${variantId}`,
          (error as Error).stack ?? String(error),
        );
      }
    }
  }

  private readTimetableSnapshot(
    value: unknown,
  ): OrderTimetableSnapshot | null {
    if (
      value === null ||
      value === undefined ||
      value === Prisma.DbNull ||
      value === Prisma.JsonNull
    ) {
      return null;
    }
    if (typeof value !== 'object') {
      return null;
    }
    return value as OrderTimetableSnapshot;
  }

  private buildTrainRun(
    item: OrderItemRecord,
    snapshot: OrderTimetableSnapshot | null,
    refId: string,
  ): TrainRun {
    const trainNumber =
      snapshot?.trainNumber?.trim() || item.name || refId;
    return {
      id: refId,
      trainNumber,
      timetableId: refId,
      attributes: {
        orderItemId: item.id,
        title: snapshot?.title ?? item.name,
      },
    };
  }

  private buildTrainSegments(
    item: OrderItemRecord,
    snapshot: OrderTimetableSnapshot | null,
    refId: string,
  ): TrainSegment[] {
    const stops = this.normalizeStops(snapshot?.stops);
    if (stops.length < 2) {
      return [];
    }

    const baseDate = this.resolveReferenceDate(item, snapshot);
    const stopTimes = this.buildStopTimes(stops, item, baseDate);
    const locationIds = stops.map((stop, index) =>
      this.normalizeLocationId(stop.locationName, index),
    );

    return stops.slice(0, -1).map((_, index) => {
      const start = stopTimes[index];
      const end = stopTimes[index + 1] ?? start;
      return {
        id: `${refId}-SEG-${String(index + 1).padStart(3, '0')}`,
        trainRunId: refId,
        sectionIndex: index + 1,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        fromLocationId: locationIds[index],
        toLocationId: locationIds[index + 1] ?? locationIds[index],
      };
    });
  }

  private normalizeStops(
    stops: OrderTimetableSnapshot['stops'] | undefined,
  ): NonNullable<OrderTimetableSnapshot['stops']> {
    if (!stops?.length) {
      return [];
    }
    return [...stops].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }

  private normalizeLocationId(
    value: string | undefined,
    index: number,
  ): string {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
    return `LOC-${String(index + 1).padStart(3, '0')}`;
  }

  private buildStopTimes(
    stops: NonNullable<OrderTimetableSnapshot['stops']>,
    item: OrderItemRecord,
    baseDate: Date,
  ): Date[] {
    const firstFallback = item.start ? new Date(item.start) : null;
    const lastFallback = item.end ? new Date(item.end) : null;

    let dayOffset = 0;
    let previousMinutes: number | null = null;
    const result: Date[] = [];
    const lastIndex = stops.length - 1;

    stops.forEach((stop, index) => {
      const timeStr = stop.departureTime ?? stop.arrivalTime ?? null;
      const minutes = this.parseTimeToMinutes(timeStr);
      if (minutes !== null) {
        if (previousMinutes !== null && minutes < previousMinutes) {
          dayOffset += 1;
        }
        previousMinutes = minutes;
        result.push(this.buildUtcDate(baseDate, dayOffset, minutes));
        return;
      }

      if (index === 0 && firstFallback) {
        result.push(firstFallback);
        previousMinutes = this.minutesFromDate(firstFallback);
        return;
      }
      if (index === lastIndex && lastFallback) {
        result.push(lastFallback);
        previousMinutes = this.minutesFromDate(lastFallback);
        return;
      }
      const fallback = result[result.length - 1] ?? baseDate;
      result.push(fallback);
    });

    return result;
  }

  private parseTimeToMinutes(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) {
      return null;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }
    if (hours < 0 || hours > 47 || minutes < 0 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  }

  private minutesFromDate(date: Date): number {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  private buildUtcDate(baseDate: Date, dayOffset: number, minutes: number): Date {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return new Date(
      Date.UTC(
        baseDate.getUTCFullYear(),
        baseDate.getUTCMonth(),
        baseDate.getUTCDate() + dayOffset,
        hours,
        mins,
        0,
      ),
    );
  }

  private resolveReferenceDate(
    item: OrderItemRecord,
    snapshot: OrderTimetableSnapshot | null,
  ): Date {
    return (
      this.parseDateOnly(snapshot?.calendar?.validFrom) ??
      this.parseDateOnly(item.start) ??
      this.parseDateOnly(item.end) ??
      new Date()
    );
  }

  private parseDateOnly(value?: string | Date | null): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        return null;
      }
      const iso = value.toISOString().slice(0, 10);
      return new Date(`${iso}T00:00:00Z`);
    }
    if (typeof value !== 'string') {
      return null;
    }
    const iso = value.trim().slice(0, 10);
    if (!iso) {
      return null;
    }
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  private deriveTimetableYearLabelFromDate(date: Date): string {
    const year = date.getUTCFullYear();
    const startThis = this.buildYearStart(year);
    if (date >= startThis) {
      return this.formatYearLabel(year);
    }
    return this.formatYearLabel(year - 1);
  }

  private formatYearLabel(startYear: number): string {
    const next = (startYear + 1) % 100;
    return `${startYear}/${String(next).padStart(2, '0')}`;
  }

  private buildYearStart(decemberYear: number): Date {
    const date = new Date(Date.UTC(decemberYear, 11, 10, 0, 0, 0, 0));
    while (date.getUTCDay() !== 0) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return date;
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
