import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DebugStreamService } from '../debug/debug-stream.service';

const orderSelect = {
  id: true,
  name: true,
  customerId: true,
  customerLabel: true,
  comment: true,
  tags: true,
  timetableYearLabel: true,
  processStatus: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: {
      name: true,
    },
  },
  items: {
    select: {
      id: true,
      name: true,
      type: true,
      tags: true,
      start: true,
      end: true,
      responsible: true,
      deviation: true,
      serviceType: true,
      fromLocation: true,
      toLocation: true,
      validity: true,
      parentItemId: true,
      versionPath: true,
      generatedTimetableRefId: true,
      timetablePhase: true,
      internalStatus: true,
      timetableYearLabel: true,
      trafficPeriodId: true,
      linkedTemplateId: true,
      linkedTrainPlanId: true,
      variantType: true,
      variantOfItemId: true,
      variantGroupId: true,
      variantLabel: true,
      simulationId: true,
      simulationLabel: true,
      mergeStatus: true,
      mergeTargetId: true,
      originalTimetable: true,
      createdAt: true,
      updatedAt: true,
      linkedTrainPlan: {
        select: {
          trainNumber: true,
        },
      },
      trafficPeriod: {
        select: {
          timetableYearLabel: true,
        },
      },
      businessLinks: {
        select: {
          businessId: true,
          business: {
            select: {
              status: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{
  select: typeof orderSelect;
}>;

export type OrderItemRecord = OrderRecord['items'][number];

export interface OrderUpsertData {
  id: string;
  name: string;
  customerId: string | null;
  customerLabel: string | null;
  comment: string | null;
  tags: string[];
  timetableYearLabel: string | null;
  processStatus: string | null;
  updatedAt: Date;
}

export interface OrderItemUpsertData {
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
}

type TimetableSnapshot = {
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

type ValiditySegment = {
  startDate: string;
  endDate?: string | null;
};

@Injectable()
export class OrdersRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(DebugStreamService)
    private readonly debugStream?: DebugStreamService,
  ) {}

  listOrders(): Promise<OrderRecord[]> {
    return this.prisma.order.findMany({
      select: orderSelect,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getOrderById(id: string): Promise<OrderRecord | null> {
    return this.prisma.order.findUnique({
      where: { id },
      select: orderSelect,
    });
  }

  async listOrderItems(orderId: string): Promise<OrderItemRecord[]> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        items: {
          select: orderSelect.items.select,
          orderBy: { start: 'asc' },
        },
      },
    });
    return order?.items ?? [];
  }

  async upsertOrder(
    order: OrderUpsertData,
    items: OrderItemUpsertData[] | null,
  ): Promise<OrderRecord> {
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        await tx.order.upsert({
          where: { id: order.id },
          create: {
            id: order.id,
            name: order.name,
            customerId: order.customerId,
            customerLabel: order.customerLabel,
            comment: order.comment,
            tags: order.tags,
            timetableYearLabel: order.timetableYearLabel,
            processStatus: order.processStatus,
            updatedAt: order.updatedAt,
          },
          update: {
            name: order.name,
            customerId: order.customerId,
            customerLabel: order.customerLabel,
            comment: order.comment,
            tags: order.tags,
            timetableYearLabel: order.timetableYearLabel,
            processStatus: order.processStatus,
            updatedAt: order.updatedAt,
          },
        });

        if (items) {
          if (items.length === 0) {
            await tx.businessOrderItem.deleteMany({
              where: { orderItem: { orderId: order.id } },
            });
            await tx.orderItem.deleteMany({
              where: { orderId: order.id },
            });
          } else {
            const ids = items.map((item) => item.data.id);
            await tx.businessOrderItem.deleteMany({
              where: { orderItem: { orderId: order.id } },
            });
            await tx.orderItem.deleteMany({
              where: {
                orderId: order.id,
                id: { notIn: ids },
              },
            });

            const collectIds = (values: Array<string | null | undefined>): string[] =>
              Array.from(new Set(values.filter((value): value is string => Boolean(value))));

            const referencedItemIds = collectIds(
              items.flatMap((item) => [
                item.data.parentItemId,
                item.data.variantOfItemId,
              ]),
            );
            const referencedTrafficPeriodIds = collectIds(
              items.map((item) => item.data.trafficPeriodId),
            );
            const referencedTemplateIds = collectIds(
              items.map((item) => item.data.linkedTemplateId),
            );
            const referencedTrainPlanIds = collectIds(
              items.map((item) => item.data.linkedTrainPlanId),
            );
            const referencedBusinessIds = collectIds(
              items.flatMap((item) => item.linkedBusinessIds),
            );

            const [
              existingItems,
              existingTrafficPeriods,
              existingTemplates,
              existingTrainPlans,
              existingBusinesses,
            ] = await Promise.all([
              referencedItemIds.length
                ? tx.orderItem.findMany({
                    where: { id: { in: referencedItemIds } },
                    select: { id: true },
                  })
                : Promise.resolve([]),
              referencedTrafficPeriodIds.length
                ? tx.trafficPeriod.findMany({
                    where: { id: { in: referencedTrafficPeriodIds } },
                    select: { id: true },
                  })
                : Promise.resolve([]),
              referencedTemplateIds.length
                ? tx.scheduleTemplate.findMany({
                    where: { id: { in: referencedTemplateIds } },
                    select: { id: true },
                  })
                : Promise.resolve([]),
              referencedTrainPlanIds.length
                ? tx.trainPlan.findMany({
                    where: { id: { in: referencedTrainPlanIds } },
                    select: { id: true },
                  })
                : Promise.resolve([]),
              referencedBusinessIds.length
                ? tx.business.findMany({
                    where: { id: { in: referencedBusinessIds } },
                    select: { id: true },
                  })
                : Promise.resolve([]),
            ]);

            const validItemIds = new Set([
              ...ids,
              ...existingItems.map((item) => item.id),
            ]);
            const validTrafficPeriods = new Set(
              existingTrafficPeriods.map((entry) => entry.id),
            );
            const validTemplates = new Set(
              existingTemplates.map((entry) => entry.id),
            );
            const validTrainPlans = new Set(
              existingTrainPlans.map((entry) => entry.id),
            );
            const validBusinesses = new Set(
              existingBusinesses.map((entry) => entry.id),
            );

            const missingTrafficPeriods = referencedTrafficPeriodIds.filter(
              (id) => !validTrafficPeriods.has(id),
            );
            const missingTemplates = referencedTemplateIds.filter(
              (id) => !validTemplates.has(id),
            );
            const missingTrainPlans = referencedTrainPlanIds.filter(
              (id) => !validTrainPlans.has(id),
            );
            const missingBusinessIds = referencedBusinessIds.filter(
              (id) => !validBusinesses.has(id),
            );
            const missingParentIds = referencedItemIds.filter(
              (id) => !validItemIds.has(id),
            );

            const createdTrafficPeriods = await this.ensureTrafficPeriods(
              tx,
              order.id,
              items,
              missingTrafficPeriods,
            );
            createdTrafficPeriods.forEach((id) => validTrafficPeriods.add(id));

            const createdTrainPlans = await this.ensureTrainPlans(
              tx,
              order.id,
              items,
              missingTrainPlans,
              validTrafficPeriods,
            );
            createdTrainPlans.forEach((id) => validTrainPlans.add(id));

            const unresolvedTrafficPeriods = referencedTrafficPeriodIds.filter(
              (id) => !validTrafficPeriods.has(id),
            );
            const unresolvedTrainPlans = referencedTrainPlanIds.filter(
              (id) => !validTrainPlans.has(id),
            );

            if (
              unresolvedTrafficPeriods.length ||
              missingTemplates.length ||
              unresolvedTrainPlans.length ||
              missingBusinessIds.length ||
              missingParentIds.length ||
              createdTrafficPeriods.length ||
              createdTrainPlans.length
            ) {
              this.debugStream?.log(
                'warn',
                'orders',
                'Order-Import: Referenzen geprüft/erstellt',
                {
                  orderId: order.id,
                  createdTrafficPeriods: createdTrafficPeriods.slice(0, 12),
                  createdTrainPlans: createdTrainPlans.slice(0, 12),
                  unresolvedTrafficPeriods: unresolvedTrafficPeriods.slice(0, 12),
                  missingTemplates: missingTemplates.slice(0, 12),
                  unresolvedTrainPlans: unresolvedTrainPlans.slice(0, 12),
                  missingBusinesses: missingBusinessIds.slice(0, 12),
                  missingParentItems: missingParentIds.slice(0, 12),
                  counts: {
                    createdTrafficPeriods: createdTrafficPeriods.length,
                    createdTrainPlans: createdTrainPlans.length,
                    unresolvedTrafficPeriods: unresolvedTrafficPeriods.length,
                    missingTemplates: missingTemplates.length,
                    unresolvedTrainPlans: unresolvedTrainPlans.length,
                    missingBusinesses: missingBusinessIds.length,
                    missingParentItems: missingParentIds.length,
                  },
                },
              );
            }

            const deferredRelations = new Map<
              string,
              { parentItemId: string | null; variantOfItemId: string | null }
            >();
            const businessLinks: Array<{ businessId: string; orderItemId: string }> = [];

            for (const item of items) {
              const { data, linkedBusinessIds } = item;
              const parentItemId = data.parentItemId ?? null;
              const variantOfItemId = data.variantOfItemId ?? null;
              if (parentItemId || variantOfItemId) {
                deferredRelations.set(data.id, {
                  parentItemId,
                  variantOfItemId,
                });
              }

              const sanitizedData = {
                ...data,
                orderId: order.id,
                parentItemId: null,
                variantOfItemId: null,
                trafficPeriodId:
                  data.trafficPeriodId && validTrafficPeriods.has(data.trafficPeriodId)
                    ? data.trafficPeriodId
                    : null,
                linkedTemplateId:
                  data.linkedTemplateId && validTemplates.has(data.linkedTemplateId)
                    ? data.linkedTemplateId
                    : null,
                linkedTrainPlanId:
                  data.linkedTrainPlanId && validTrainPlans.has(data.linkedTrainPlanId)
                    ? data.linkedTrainPlanId
                    : null,
              };
              await tx.orderItem.upsert({
                where: { id: data.id },
                create: {
                  ...sanitizedData,
                  updatedAt: data.updatedAt,
                },
                update: {
                  ...sanitizedData,
                  updatedAt: data.updatedAt,
                },
              });
              const validBusinessIds = linkedBusinessIds.filter((id) =>
                validBusinesses.has(id),
              );
              if (validBusinessIds.length) {
                for (const businessId of validBusinessIds) {
                  businessLinks.push({
                    businessId,
                    orderItemId: data.id,
                  });
                }
              }
            }

            if (businessLinks.length) {
              const batchSize = 500;
              for (let i = 0; i < businessLinks.length; i += batchSize) {
                const batch = businessLinks.slice(i, i + batchSize);
                await tx.businessOrderItem.createMany({
                  data: batch,
                  skipDuplicates: true,
                });
              }
            }

            if (deferredRelations.size) {
              for (const [itemId, refs] of deferredRelations.entries()) {
                const update: Prisma.OrderItemUpdateInput = {};
                if (refs.parentItemId && validItemIds.has(refs.parentItemId)) {
                  update.parentItem = { connect: { id: refs.parentItemId } };
                }
                if (refs.variantOfItemId && validItemIds.has(refs.variantOfItemId)) {
                  update.variantOfItem = { connect: { id: refs.variantOfItemId } };
                }
                if (Object.keys(update).length) {
                  await tx.orderItem.update({
                    where: { id: itemId },
                    data: update,
                  });
                }
              }
            }
          }
        }

        const updated = await tx.order.findUnique({
          where: { id: order.id },
          select: orderSelect,
        });

        if (!updated) {
          throw new Error(`Order ${order.id} not found after upsert.`);
        }
        return updated;
      }, { maxWait: 10000, timeout: 120000 });
      return record;
    } catch (error) {
      this.debugStream?.log('error', 'orders', 'Order-Import fehlgeschlagen', {
        orderId: order.id,
        itemCount: items?.length ?? 0,
        error: this.serializeError(error),
      });
      throw error;
    }
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (!error) {
      return { message: 'unknown' };
    }
    if (error instanceof Error) {
      return { name: error.name, message: error.message };
    }
    if (typeof error === 'object') {
      const err = error as { message?: string; code?: string; meta?: unknown };
      return {
        message: err.message ?? 'error',
        code: err.code,
        meta: err.meta,
      };
    }
    return { message: String(error) };
  }

  private async ensureTrafficPeriods(
    tx: Prisma.TransactionClient,
    orderId: string,
    items: OrderItemUpsertData[],
    missingIds: string[],
  ): Promise<string[]> {
    if (!missingIds.length) {
      return [];
    }
    const itemByPeriodId = new Map<string, OrderItemUpsertData['data']>();
    items.forEach((item) => {
      const periodId = item.data.trafficPeriodId ?? null;
      if (!periodId) {
        return;
      }
      if (!missingIds.includes(periodId)) {
        return;
      }
      if (!itemByPeriodId.has(periodId)) {
        itemByPeriodId.set(periodId, item.data);
      }
    });

    const created: string[] = [];
    const now = new Date();

    for (const periodId of missingIds) {
      const source = itemByPeriodId.get(periodId);
      if (!source) {
        continue;
      }
      const definition = this.buildTrafficPeriodDefinition(orderId, periodId, source);
      if (!definition) {
        continue;
      }
      await tx.trafficPeriod.create({ data: definition.period });
      if (definition.rules.length) {
        await tx.trafficPeriodRule.createMany({ data: definition.rules });
      }
      created.push(periodId);
    }

    return created;
  }

  private buildTrafficPeriodDefinition(
    orderId: string,
    periodId: string,
    source: OrderItemUpsertData['data'],
  ): { period: Prisma.TrafficPeriodCreateInput; rules: Prisma.TrafficPeriodRuleCreateManyInput[] } | null {
    const validitySegments = this.parseValiditySegments(source.validity);
    const timetable = this.readJsonObject<TimetableSnapshot>(source.originalTimetable);
    const calendar = timetable?.calendar ?? null;
    const daysBitmap = this.normalizeDaysBitmap(calendar?.daysBitmap);

    const rules: Prisma.TrafficPeriodRuleCreateManyInput[] = [];
    const segmentDates = validitySegments.length
      ? validitySegments
      : this.calendarToValidity(calendar);

    segmentDates.forEach((segment, index) => {
      const start = this.parseDateOnly(segment.startDate);
      const end = this.parseDateOnly(segment.endDate ?? segment.startDate);
      if (!start) {
        return;
      }
      rules.push({
        id: `${periodId}-R${String(index + 1).padStart(2, '0')}`,
        periodId,
        name: `${source.name} ${index + 1}`,
        daysBitmap,
        validityStart: start,
        validityEnd: end ?? start,
        variantType: 'series',
        appliesTo: 'commercial',
        variantNumber: '00',
        isPrimary: index === 0,
      });
    });

    if (!rules.length) {
      const fallbackStart = this.parseDateOnly(source.start ?? undefined);
      const start = fallbackStart ?? new Date();
      rules.push({
        id: `${periodId}-R01`,
        periodId,
        name: source.name,
        daysBitmap,
        validityStart: start,
        validityEnd: start,
        variantType: 'series',
        appliesTo: 'commercial',
        variantNumber: '00',
        isPrimary: true,
      });
    }

    const referenceDate =
      this.parseDateOnly(rules[0]?.validityStart ?? undefined) ?? new Date();
    const timetableYearLabel =
      source.timetableYearLabel ??
      this.deriveTimetableYearLabelFromDate(referenceDate);
    const tags = [
      `order:${orderId}`,
      timetableYearLabel ? `timetable-year:${timetableYearLabel}` : null,
    ].filter((tag): tag is string => Boolean(tag));

    return {
      period: {
        id: periodId,
        name: `${source.name} Referenzkalender`,
        type: 'standard',
        description: `Auto-importiert aus Auftrag ${orderId}`,
        responsible: source.responsible ?? null,
        timetableYearLabel,
        tags,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      rules,
    };
  }

  private async ensureTrainPlans(
    tx: Prisma.TransactionClient,
    orderId: string,
    items: OrderItemUpsertData[],
    missingIds: string[],
    validTrafficPeriods: Set<string>,
  ): Promise<string[]> {
    if (!missingIds.length) {
      return [];
    }
    const itemByPlanId = new Map<string, OrderItemUpsertData['data']>();
    items.forEach((item) => {
      const planId = item.data.linkedTrainPlanId ?? null;
      if (!planId) {
        return;
      }
      if (!missingIds.includes(planId)) {
        return;
      }
      if (!itemByPlanId.has(planId)) {
        itemByPlanId.set(planId, item.data);
      }
    });

    const created: string[] = [];
    for (const planId of missingIds) {
      const source = itemByPlanId.get(planId);
      if (!source) {
        continue;
      }
      const createInput = this.buildTrainPlanDefinition(
        orderId,
        planId,
        source,
        validTrafficPeriods,
      );
      if (!createInput) {
        continue;
      }
      await tx.trainPlan.create({ data: createInput });
      created.push(planId);
    }
    return created;
  }

  private buildTrainPlanDefinition(
    orderId: string,
    planId: string,
    source: OrderItemUpsertData['data'],
    validTrafficPeriods: Set<string>,
  ): Prisma.TrainPlanCreateInput | null {
    const timetable = this.readJsonObject<TimetableSnapshot>(source.originalTimetable);
    const calendar = timetable?.calendar ?? null;
    const validitySegments = this.parseValiditySegments(source.validity);

    const calendarStart =
      this.parseDateOnly(calendar?.validFrom) ??
      this.parseDateOnly(validitySegments[0]?.startDate) ??
      this.parseDateOnly(source.start ?? undefined) ??
      new Date();
    const calendarEnd =
      this.parseDateOnly(calendar?.validTo) ??
      this.parseDateOnly(validitySegments[0]?.endDate) ??
      calendarStart;
    const daysBitmap = this.normalizeDaysBitmap(calendar?.daysBitmap);

    const stops = Array.isArray(timetable?.stops)
      ? timetable?.stops.map((stop, index) => ({
          sequence: stop.sequence ?? index + 1,
          locationName: stop.locationName ?? null,
          arrivalTime: stop.arrivalTime ?? null,
          departureTime: stop.departureTime ?? null,
        }))
      : [];

    const trafficPeriodId =
      source.trafficPeriodId && validTrafficPeriods.has(source.trafficPeriodId)
        ? source.trafficPeriodId
        : null;

    return {
      id: planId,
      title: timetable?.title ?? source.name,
      trainNumber: timetable?.trainNumber ?? source.name,
      status: source.timetablePhase ?? 'not_ordered',
      responsibleRu: source.responsible ?? 'RailML Import',
      calendarValidFrom: calendarStart,
      calendarValidTo: calendarEnd ?? calendarStart,
      calendarDaysBitmap: daysBitmap,
      trafficPeriod: trafficPeriodId ? { connect: { id: trafficPeriodId } } : undefined,
      stops,
      sourceType: 'import',
      sourceName: 'RailML',
      sourceTemplateId: source.linkedTemplateId ?? null,
      sourceSystemId: orderId,
      notes: null,
      rollingStock: Prisma.JsonNull,
      planVariantType: source.variantType ?? 'productive',
      variantOfPlanId: null,
      variantLabel: source.variantLabel ?? null,
      simulationId: source.simulationId ?? null,
      simulationLabel: source.simulationLabel ?? null,
    };
  }

  private parseValiditySegments(
    value:
      | Prisma.InputJsonValue
      | Prisma.NullableJsonNullValueInput
      | undefined,
  ): ValiditySegment[] {
    const normalized = this.readJsonObject<unknown>(value);
    if (!Array.isArray(normalized)) {
      return [];
    }
    const segments: ValiditySegment[] = [];
    normalized.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const segment = entry as { startDate?: string; endDate?: string | null };
      if (!segment.startDate) {
        return;
      }
      segments.push({
        startDate: segment.startDate,
        endDate: segment.endDate ?? segment.startDate,
      });
    });
    return segments;
  }

  private calendarToValidity(
    calendar: TimetableSnapshot['calendar'] | null,
  ): ValiditySegment[] {
    if (!calendar?.validFrom) {
      return [];
    }
    return [
      {
        startDate: calendar.validFrom,
        endDate: calendar.validTo ?? calendar.validFrom,
      },
    ];
  }

  private readJsonObject<T>(value: unknown): T | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (
      value === Prisma.DbNull ||
      value === Prisma.JsonNull ||
      value === Prisma.AnyNull
    ) {
      return null;
    }
    if (typeof value === 'object') {
      return value as T;
    }
    return null;
  }

  private normalizeDaysBitmap(value?: string | null): string {
    if (!value) {
      return '1111111';
    }
    const normalized = value.trim();
    if (/^[01]{7}$/.test(normalized)) {
      return normalized;
    }
    return '1111111';
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

  async deleteOrder(orderId: string): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.businessOrderItem.deleteMany({
        where: { orderItem: { orderId } },
      });
      await tx.orderItem.deleteMany({
        where: { orderId },
      });
      const deleted = await tx.order.deleteMany({
        where: { id: orderId },
      });
      return deleted.count > 0;
    });
    return result;
  }
}
