import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { PrismaService } from '../prisma/prisma.service';
import type {
  OrderManagementAdminClearResponse,
  OrderManagementAdminSeedResponse,
  OrderManagementAdminSummary,
  OrderManagementSeedMode,
} from './order-management-admin.types';

type SeedCustomer = {
  id?: string;
  name?: string;
  customerNumber?: string;
  projectNumber?: string;
  address?: string;
  notes?: string;
  contacts?: Array<Record<string, unknown>>;
  createdAt?: string;
  updatedAt?: string;
};

type SeedBusiness = {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  assignment?: {
    type?: string;
    name?: string;
  };
  dueDate?: string | null;
  documents?: Array<Record<string, unknown>>;
  linkedOrderItemIds?: string[];
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type SeedScheduleTemplateStop = {
  id?: string;
  sequence?: number;
  type?: string;
  locationCode?: string;
  locationName?: string;
  countryCode?: string;
  arrival?: {
    earliest?: string;
    latest?: string;
  };
  departure?: {
    earliest?: string;
    latest?: string;
  };
  offsetDays?: number;
  dwellMinutes?: number;
  activities?: string[];
  platformWish?: string;
  notes?: string;
};

type SeedScheduleTemplate = {
  id?: string;
  title?: string;
  description?: string;
  trainNumber?: string;
  responsibleRu?: string;
  status?: string;
  category?: string;
  tags?: string[];
  validity?: {
    startDate?: string;
    endDate?: string | null;
  };
  recurrence?: Record<string, unknown> | null;
  composition?: Record<string, unknown> | null;
  stops?: SeedScheduleTemplateStop[];
  createdAt?: string;
  updatedAt?: string;
};

type SeedOrder = {
  id?: string;
  name?: string;
  customerId?: string;
  customerLabel?: string;
  customer?: string;
  comment?: string;
  tags?: string[];
  timetableYearLabel?: string;
  processStatus?: string;
  createdAt?: string;
  updatedAt?: string;
};

type SeedOrderItem = {
  id?: string;
  orderId?: string;
  name?: string;
  type?: string;
  tags?: string[];
  start?: string;
  end?: string;
  responsible?: string;
  deviation?: string;
  serviceType?: string;
  fromLocation?: string;
  toLocation?: string;
  validity?: unknown;
  parentItemId?: string;
  versionPath?: number[];
  generatedTimetableRefId?: string;
  timetablePhase?: string;
  internalStatus?: string;
  timetableYearLabel?: string;
  trafficPeriodId?: string;
  linkedTemplateId?: string;
  linkedTrainPlanId?: string;
  variantType?: string;
  variantOfItemId?: string;
  variantGroupId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
  mergeStatus?: string;
  mergeTargetId?: string;
  originalTimetable?: unknown;
  linkedBusinessIds?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type SeedFile = {
  customers?: SeedCustomer[];
  businesses?: SeedBusiness[];
  scheduleTemplates?: SeedScheduleTemplate[];
  orders?: SeedOrder[];
  orderItems?: SeedOrderItem[];
};

@Injectable()
export class OrderManagementAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<OrderManagementAdminSummary> {
    const [customers, businesses, orders, orderItems, scheduleTemplates] =
      await this.prisma.$transaction([
        this.prisma.customer.count(),
        this.prisma.business.count(),
        this.prisma.order.count(),
        this.prisma.orderItem.count(),
        this.prisma.scheduleTemplate.count(),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        customers,
        businesses,
        orders,
        orderItems,
        scheduleTemplates,
      },
    };
  }

  async clearData(
    confirmation: string,
  ): Promise<OrderManagementAdminClearResponse> {
    this.ensureDevMode();
    this.ensureConfirmation(confirmation);

    const deleted = await this.prisma.$transaction(async (tx) => {
      const businessLinks = await tx.businessOrderItem.deleteMany();
      const orderItems = await tx.orderItem.deleteMany();
      const orders = await tx.order.deleteMany();
      const scheduleTemplateStops = await tx.scheduleTemplateStop.deleteMany();
      const scheduleTemplates = await tx.scheduleTemplate.deleteMany();
      const businesses = await tx.business.deleteMany();
      const customers = await tx.customer.deleteMany();

      return {
        businessLinks: businessLinks.count,
        orderItems: orderItems.count,
        orders: orders.count,
        scheduleTemplateStops: scheduleTemplateStops.count,
        scheduleTemplates: scheduleTemplates.count,
        businesses: businesses.count,
        customers: customers.count,
      };
    });

    return {
      clearedAt: new Date().toISOString(),
      deleted,
    };
  }

  async seedData(
    confirmation: string,
    mode: OrderManagementSeedMode,
  ): Promise<OrderManagementAdminSeedResponse> {
    this.ensureDevMode();
    this.ensureConfirmation(confirmation);

    if (mode === 'replace') {
      await this.clearData(confirmation);
    }

    const seed = this.loadSeedFile();
    const warnings: string[] = [];
    const now = new Date();

    const customerRows = (seed.customers ?? [])
      .map((entry, index) =>
        this.toCustomerCreateInput(entry, index, now, warnings),
      )
      .filter(
        (
          entry,
        ): entry is Prisma.CustomerCreateManyInput => Boolean(entry),
      );

    const businessRows = (seed.businesses ?? [])
      .map((entry, index) =>
        this.toBusinessCreateInput(entry, index, now, warnings),
      )
      .filter(
        (
          entry,
        ): entry is {
          data: Prisma.BusinessCreateManyInput;
          linkIds: string[];
        } => Boolean(entry),
      );

    const scheduleTemplateRows = (seed.scheduleTemplates ?? [])
      .map((entry, index) =>
        this.toScheduleTemplateCreateInput(entry, index, now, warnings),
      )
      .filter(
        (
          entry,
        ): entry is {
          data: Prisma.ScheduleTemplateCreateManyInput;
          stops: Prisma.ScheduleTemplateStopCreateManyInput[];
        } => Boolean(entry),
      );

    const customersResult = customerRows.length
      ? await this.prisma.customer.createMany({
          data: customerRows,
          skipDuplicates: true,
        })
      : { count: 0 };

    const businessesResult = businessRows.length
      ? await this.prisma.business.createMany({
          data: businessRows.map((entry) => entry.data),
          skipDuplicates: true,
        })
      : { count: 0 };

    const scheduleTemplatesResult = scheduleTemplateRows.length
      ? await this.prisma.scheduleTemplate.createMany({
          data: scheduleTemplateRows.map((entry) => entry.data),
          skipDuplicates: true,
        })
      : { count: 0 };

    const scheduleTemplateStops = scheduleTemplateRows.flatMap(
      (entry) => entry.stops,
    );
    const scheduleTemplateStopsResult = scheduleTemplateStops.length
      ? await this.prisma.scheduleTemplateStop.createMany({
          data: scheduleTemplateStops,
          skipDuplicates: true,
        })
      : { count: 0 };

    const [customerIds, businessIds, templateIds, trafficPeriodIds, trainPlanIds] =
      await Promise.all([
        this.loadIdSet(
          this.prisma.customer.findMany({ select: { id: true } }),
        ),
        this.loadIdSet(
          this.prisma.business.findMany({ select: { id: true } }),
        ),
        this.loadIdSet(
          this.prisma.scheduleTemplate.findMany({ select: { id: true } }),
        ),
        this.loadIdSet(
          this.prisma.trafficPeriod.findMany({ select: { id: true } }),
        ),
        this.loadIdSet(
          this.prisma.trainPlan.findMany({ select: { id: true } }),
        ),
      ]);

    const orderRows = (seed.orders ?? [])
      .map((entry, index) =>
        this.toOrderCreateInput(entry, index, now, warnings, customerIds),
      )
      .filter(
        (entry): entry is Prisma.OrderCreateManyInput => Boolean(entry),
      );

    const ordersResult = orderRows.length
      ? await this.prisma.order.createMany({
          data: orderRows,
          skipDuplicates: true,
        })
      : { count: 0 };

    const orderIds = await this.loadIdSet(
      this.prisma.order.findMany({ select: { id: true } }),
    );

    const orderItemRows = (seed.orderItems ?? [])
      .map((entry, index) =>
        this.toOrderItemCreateInput(
          entry,
          index,
          now,
          warnings,
          orderIds,
          templateIds,
          trafficPeriodIds,
          trainPlanIds,
          businessIds,
        ),
      )
      .filter(
        (
          entry,
        ): entry is {
          data: Prisma.OrderItemCreateManyInput;
          linkedBusinessIds: string[];
          relations: { id: string; parentItemId?: string | null; variantOfItemId?: string | null };
        } => Boolean(entry),
      );

    const orderItemsResult = orderItemRows.length
      ? await this.prisma.orderItem.createMany({
          data: orderItemRows.map((entry) => entry.data),
          skipDuplicates: true,
        })
      : { count: 0 };

    const orderItemIds = await this.loadIdSet(
      this.prisma.orderItem.findMany({ select: { id: true } }),
    );
    await this.updateOrderItemRelations(
      orderItemRows.map((entry) => entry.relations),
      orderItemIds,
      warnings,
    );

    const linkCandidates = [
      ...businessRows.flatMap((entry) =>
        entry.linkIds.map((orderItemId) => ({
          businessId: entry.data.id as string,
          orderItemId,
        })),
      ),
      ...orderItemRows.flatMap((entry) =>
        entry.linkedBusinessIds.map((businessId) => ({
          businessId,
          orderItemId: entry.data.id,
        })),
      ),
    ];

    const linkResult = await this.createBusinessLinks(linkCandidates, warnings);

    return {
      seededAt: new Date().toISOString(),
      inserted: {
        customers: customersResult.count,
        businesses: businessesResult.count,
        scheduleTemplates: scheduleTemplatesResult.count,
        scheduleTemplateStops: scheduleTemplateStopsResult.count,
        orders: ordersResult.count,
        orderItems: orderItemsResult.count,
        businessLinks: linkResult,
      },
      warnings,
    };
  }

  private createBusinessLinks(
    candidates: Array<{ businessId: string; orderItemId: string }>,
    warnings: string[],
  ): Promise<number> {
    if (!candidates.length) {
      return Promise.resolve(0);
    }
    const uniqueCandidates = Array.from(
      new Map(
        candidates.map((entry) => [
          `${entry.businessId}::${entry.orderItemId}`,
          entry,
        ]),
      ).values(),
    );
    const uniqueItemIds = Array.from(
      new Set(uniqueCandidates.map((entry) => entry.orderItemId)),
    );
    const uniqueBusinessIds = Array.from(
      new Set(uniqueCandidates.map((entry) => entry.businessId)),
    );
    return this.prisma
      .$transaction([
        this.prisma.orderItem.findMany({
          where: { id: { in: uniqueItemIds } },
          select: { id: true },
        }),
        this.prisma.business.findMany({
          where: { id: { in: uniqueBusinessIds } },
          select: { id: true },
        }),
      ])
      .then(([items, businesses]) => {
        const existingItems = new Set(items.map((item) => item.id));
        const existingBusinesses = new Set(
          businesses.map((business) => business.id),
        );
        const validLinks = uniqueCandidates.filter(
          (entry) =>
            existingItems.has(entry.orderItemId) &&
            existingBusinesses.has(entry.businessId),
        );
        const missingItems = uniqueCandidates.filter(
          (entry) => !existingItems.has(entry.orderItemId),
        );
        const missingBusinesses = uniqueCandidates.filter(
          (entry) => !existingBusinesses.has(entry.businessId),
        );
        if (missingItems.length) {
          warnings.push(
            `Skipped ${missingItems.length} business links because order items were missing.`,
          );
        }
        if (missingBusinesses.length) {
          warnings.push(
            `Skipped ${missingBusinesses.length} business links because businesses were missing.`,
          );
        }
        if (!validLinks.length) {
          return 0;
        }
        return this.prisma.businessOrderItem
          .createMany({
            data: validLinks,
            skipDuplicates: true,
          })
          .then((result) => result.count);
      });
  }

  private toCustomerCreateInput(
    entry: SeedCustomer,
    index: number,
    now: Date,
    warnings: string[],
  ): Prisma.CustomerCreateManyInput | null {
    const name = entry.name?.trim();
    const customerNumber = entry.customerNumber?.trim();
    if (!name || !customerNumber) {
      warnings.push(`Skipped customer entry ${index + 1} due to missing name.`);
      return null;
    }
    return {
      id: entry.id ?? this.generateSeedId('cust', index),
      name,
      customerNumber,
      projectNumber: entry.projectNumber?.trim() || null,
      address: entry.address?.trim() || null,
      notes: entry.notes?.trim() || null,
      contacts: (entry.contacts ?? []) as Prisma.InputJsonValue,
      createdAt: this.parseOptionalDate(entry.createdAt) ?? now,
      updatedAt: this.parseOptionalDate(entry.updatedAt) ?? now,
    };
  }

  private toBusinessCreateInput(
    entry: SeedBusiness,
    index: number,
    now: Date,
    warnings: string[],
  ): { data: Prisma.BusinessCreateManyInput; linkIds: string[] } | null {
    const title = entry.title?.trim();
    const description = entry.description?.trim();
    const assignmentType = entry.assignment?.type?.trim();
    const assignmentName = entry.assignment?.name?.trim();
    if (!title || !description || !assignmentType || !assignmentName) {
      warnings.push(`Skipped business entry ${index + 1} due to missing fields.`);
      return null;
    }

    return {
      data: {
        id: entry.id ?? this.generateSeedId('biz', index),
        title,
        description,
        status: entry.status?.trim() || 'neu',
        assignmentType,
        assignmentName,
        dueDate: this.parseOptionalDate(entry.dueDate),
        documents: entry.documents
          ? (entry.documents as Prisma.InputJsonValue)
          : undefined,
        tags: this.normalizeTags(entry.tags ?? []),
        createdAt: this.parseOptionalDate(entry.createdAt) ?? now,
        updatedAt: this.parseOptionalDate(entry.updatedAt) ?? now,
      },
      linkIds: entry.linkedOrderItemIds ?? [],
    };
  }

  private toScheduleTemplateCreateInput(
    entry: SeedScheduleTemplate,
    index: number,
    now: Date,
    warnings: string[],
  ): {
    data: Prisma.ScheduleTemplateCreateManyInput;
    stops: Prisma.ScheduleTemplateStopCreateManyInput[];
  } | null {
    const title = entry.title?.trim();
    const trainNumber = entry.trainNumber?.trim();
    const responsibleRu = entry.responsibleRu?.trim();
    const status = entry.status?.trim();
    const category = entry.category?.trim();
    const validityStartRaw = entry.validity?.startDate;
    if (!title || !trainNumber || !responsibleRu || !status || !category) {
      warnings.push(
        `Skipped schedule template entry ${index + 1} due to missing fields.`,
      );
      return null;
    }
    const validityStart = this.parseRequiredDate(
      validityStartRaw,
      `schedule template ${entry.id ?? title}`,
      warnings,
    );
    if (!validityStart) {
      return null;
    }

    const templateId = entry.id ?? this.generateSeedId('tpl', index);
    const stops = (entry.stops ?? [])
      .map((stop, stopIndex) =>
        this.toScheduleTemplateStopInput(
          templateId,
          stop,
          stopIndex,
          warnings,
        ),
      )
      .filter(
        (stop): stop is Prisma.ScheduleTemplateStopCreateManyInput =>
          Boolean(stop),
      );

    return {
      data: {
        id: templateId,
        title,
        description: entry.description?.trim() || null,
        trainNumber,
        responsibleRu,
        status,
        category,
        tags: this.normalizeTags(entry.tags ?? []),
        validityStart,
        validityEnd: this.parseOptionalDate(entry.validity?.endDate) ?? null,
        recurrence: this.normalizeJsonInput(entry.recurrence),
        composition: this.normalizeJsonInput(entry.composition),
        createdAt: this.parseOptionalDate(entry.createdAt) ?? now,
        updatedAt: this.parseOptionalDate(entry.updatedAt) ?? now,
      },
      stops,
    };
  }

  private toScheduleTemplateStopInput(
    templateId: string,
    entry: SeedScheduleTemplateStop,
    index: number,
    warnings: string[],
  ): Prisma.ScheduleTemplateStopCreateManyInput | null {
    const type = entry.type?.trim();
    const locationCode = entry.locationCode?.trim();
    const locationName = entry.locationName?.trim();
    if (!type || !locationCode || !locationName) {
      warnings.push(
        `Skipped schedule template stop ${index + 1} for ${templateId} due to missing fields.`,
      );
      return null;
    }
    const sequence = entry.sequence ?? index + 1;
    return {
      id:
        entry.id ??
        `${templateId}-ST-${String(sequence).padStart(3, '0')}`,
      templateId,
      sequence,
      type,
      locationCode,
      locationName,
      countryCode: entry.countryCode?.trim() || null,
      arrivalEarliest: entry.arrival?.earliest ?? null,
      arrivalLatest: entry.arrival?.latest ?? null,
      departureEarliest: entry.departure?.earliest ?? null,
      departureLatest: entry.departure?.latest ?? null,
      offsetDays: entry.offsetDays ?? null,
      dwellMinutes: entry.dwellMinutes ?? null,
      activities: entry.activities ?? [],
      platformWish: entry.platformWish?.trim() || null,
      notes: entry.notes?.trim() || null,
    };
  }

  private toOrderCreateInput(
    entry: SeedOrder,
    index: number,
    now: Date,
    warnings: string[],
    customerIds: Set<string>,
  ): Prisma.OrderCreateManyInput | null {
    const name = entry.name?.trim();
    if (!name) {
      warnings.push(`Skipped order entry ${index + 1} due to missing name.`);
      return null;
    }
    const orderId = entry.id ?? this.generateSeedId('ord', index);
    const customerLabel =
      entry.customerLabel?.trim() || entry.customer?.trim() || null;
    let customerId = entry.customerId?.trim() || null;
    if (customerId && !customerIds.has(customerId)) {
      warnings.push(
        `Order ${orderId} references missing customer ${customerId}.`,
      );
      customerId = null;
    }
    return {
      id: orderId,
      name,
      customerId,
      customerLabel,
      comment: entry.comment?.trim() || null,
      tags: this.normalizeTags(entry.tags ?? []),
      timetableYearLabel: entry.timetableYearLabel?.trim() || null,
      processStatus: entry.processStatus?.trim() || null,
      createdAt: this.parseOptionalDate(entry.createdAt) ?? now,
      updatedAt: this.parseOptionalDate(entry.updatedAt) ?? now,
    };
  }

  private toOrderItemCreateInput(
    entry: SeedOrderItem,
    index: number,
    now: Date,
    warnings: string[],
    orderIds: Set<string>,
    templateIds: Set<string>,
    trafficPeriodIds: Set<string>,
    trainPlanIds: Set<string>,
    businessIds: Set<string>,
  ): {
    data: Prisma.OrderItemCreateManyInput;
    linkedBusinessIds: string[];
    relations: { id: string; parentItemId?: string | null; variantOfItemId?: string | null };
  } | null {
    const itemId = entry.id?.trim() || this.generateSeedId('item', index);
    const orderId = entry.orderId?.trim();
    const name = entry.name?.trim();
    const type = entry.type?.trim();
    if (!orderId || !orderIds.has(orderId)) {
      warnings.push(`Order item ${itemId} references missing order.`);
      return null;
    }
    if (!name || !type) {
      warnings.push(`Skipped order item ${itemId} due to missing fields.`);
      return null;
    }

    const linkedTemplateId = this.sanitizeReference(
      entry.linkedTemplateId,
      templateIds,
      'linkedTemplateId',
      itemId,
      warnings,
    );
    const linkedTrainPlanId = this.sanitizeReference(
      entry.linkedTrainPlanId,
      trainPlanIds,
      'linkedTrainPlanId',
      itemId,
      warnings,
    );
    const trafficPeriodId = this.sanitizeReference(
      entry.trafficPeriodId,
      trafficPeriodIds,
      'trafficPeriodId',
      itemId,
      warnings,
    );

    const rawLinkedBusinesses = entry.linkedBusinessIds ?? [];
    const linkedBusinessIds = rawLinkedBusinesses.filter((id) =>
      businessIds.has(id),
    );
    if (linkedBusinessIds.length !== rawLinkedBusinesses.length) {
      warnings.push(
        `Order item ${itemId} references unknown businesses.`,
      );
    }

    return {
      data: {
        id: itemId,
        orderId,
        name,
        type,
        tags: this.normalizeTags(entry.tags ?? []),
        start: this.parseOptionalDate(entry.start),
        end: this.parseOptionalDate(entry.end),
        responsible: entry.responsible?.trim() || null,
        deviation: entry.deviation?.trim() || null,
        serviceType: entry.serviceType?.trim() || null,
        fromLocation: entry.fromLocation?.trim() || null,
        toLocation: entry.toLocation?.trim() || null,
        validity: this.normalizeJsonInput(entry.validity),
        parentItemId: null,
        versionPath: entry.versionPath ?? [],
        generatedTimetableRefId: entry.generatedTimetableRefId?.trim() || null,
        timetablePhase: entry.timetablePhase?.trim() || null,
        internalStatus: entry.internalStatus?.trim() || null,
        timetableYearLabel: entry.timetableYearLabel?.trim() || null,
        trafficPeriodId,
        linkedTemplateId,
        linkedTrainPlanId,
        variantType: entry.variantType?.trim() || null,
        variantOfItemId: null,
        variantGroupId: entry.variantGroupId?.trim() || null,
        variantLabel: entry.variantLabel?.trim() || null,
        simulationId: entry.simulationId?.trim() || null,
        simulationLabel: entry.simulationLabel?.trim() || null,
        mergeStatus: entry.mergeStatus?.trim() || null,
        mergeTargetId: entry.mergeTargetId?.trim() || null,
        originalTimetable: this.normalizeJsonInput(entry.originalTimetable),
        createdAt: this.parseOptionalDate(entry.createdAt) ?? now,
        updatedAt: this.parseOptionalDate(entry.updatedAt) ?? now,
      },
      linkedBusinessIds,
      relations: {
        id: itemId,
        parentItemId: entry.parentItemId ?? null,
        variantOfItemId: entry.variantOfItemId ?? null,
      },
    };
  }

  private async updateOrderItemRelations(
    relations: Array<{
      id: string;
      parentItemId?: string | null;
      variantOfItemId?: string | null;
    }>,
    existingIds: Set<string>,
    warnings: string[],
  ): Promise<void> {
    const updates = relations
      .map((entry) => {
        if (!existingIds.has(entry.id)) {
          return null;
        }
        const parentItemId =
          entry.parentItemId && existingIds.has(entry.parentItemId)
            ? entry.parentItemId
            : null;
        const variantOfItemId =
          entry.variantOfItemId && existingIds.has(entry.variantOfItemId)
            ? entry.variantOfItemId
            : null;
        if (entry.parentItemId && !parentItemId) {
          warnings.push(
            `Order item ${entry.id} parent ${entry.parentItemId} was missing.`,
          );
        }
        if (entry.variantOfItemId && !variantOfItemId) {
          warnings.push(
            `Order item ${entry.id} variant ${entry.variantOfItemId} was missing.`,
          );
        }
        if (!parentItemId && !variantOfItemId) {
          return null;
        }
        return { id: entry.id, parentItemId, variantOfItemId };
      })
      .filter(
        (entry): entry is { id: string; parentItemId: string | null; variantOfItemId: string | null } =>
          Boolean(entry),
      );

    if (!updates.length) {
      return;
    }
    await Promise.all(
      updates.map((entry) =>
        this.prisma.orderItem.update({
          where: { id: entry.id },
          data: {
            parentItemId: entry.parentItemId,
            variantOfItemId: entry.variantOfItemId,
          },
        }),
      ),
    );
  }

  private async loadIdSet(
    query: Promise<Array<{ id: string }>>,
  ): Promise<Set<string>> {
    const rows = await query;
    return new Set(rows.map((row) => row.id));
  }

  private sanitizeReference(
    value: string | undefined,
    existingIds: Set<string>,
    field: string,
    context: string,
    warnings: string[],
  ): string | null {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (!existingIds.has(trimmed)) {
      warnings.push(`${context} has unknown ${field} ${trimmed}.`);
      return null;
    }
    return trimmed;
  }

  private normalizeTags(tags: string[]): string[] {
    if (!tags.length) {
      return [];
    }
    return Array.from(
      new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length)),
    );
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

  private parseOptionalDate(value?: string | null): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) {
      return null;
    }
    return parsed;
  }

  private parseRequiredDate(
    value: string | undefined,
    context: string,
    warnings: string[],
  ): Date | null {
    if (!value) {
      warnings.push(`Missing date for ${context}.`);
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) {
      warnings.push(`Invalid date for ${context}.`);
      return null;
    }
    return parsed;
  }

  private loadSeedFile(): SeedFile {
    const location = this.resolveSeedLocation();
    const raw = readFileSync(location, 'utf-8');
    const parsed = yaml.load(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('Seed file is empty or invalid.');
    }
    return parsed as SeedFile;
  }

  private resolveSeedLocation(): string {
    const candidates = [
      join(process.cwd(), 'catalog', 'order-management', 'dev-seed.yaml'),
      join(process.cwd(), 'backend', 'catalog', 'order-management', 'dev-seed.yaml'),
      join(__dirname, '..', '..', 'catalog', 'order-management', 'dev-seed.yaml'),
      join(__dirname, '..', '..', '..', 'catalog', 'order-management', 'dev-seed.yaml'),
      join(__dirname, '..', '..', '..', 'backend', 'catalog', 'order-management', 'dev-seed.yaml'),
    ];

    for (const candidate of candidates) {
      try {
        const stat = statSync(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    throw new BadRequestException('Order management seed file not found.');
  }

  private generateSeedId(prefix: string, index: number): string {
    const random = Math.random().toString(36).slice(2, 6);
    return `${prefix}-${index + 1}-${random}`;
  }

  private ensureDevMode(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Admin seeding is disabled in production.');
    }
  }

  private ensureConfirmation(confirmation: string): void {
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      throw new BadRequestException('Confirmation token is invalid.');
    }
  }
}
