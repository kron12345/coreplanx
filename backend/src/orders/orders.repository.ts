import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

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
        await tx.orderItem.deleteMany({
          where: {
            orderId: order.id,
            id: { notIn: ids },
          },
        });

        for (const item of items) {
          const { data, linkedBusinessIds } = item;
          await tx.orderItem.upsert({
            where: { id: data.id },
            create: {
              ...data,
              updatedAt: data.updatedAt,
            },
            update: {
              ...data,
              updatedAt: data.updatedAt,
            },
          });

          await tx.businessOrderItem.deleteMany({
            where: { orderItemId: data.id },
          });
          if (linkedBusinessIds.length) {
            await tx.businessOrderItem.createMany({
              data: linkedBusinessIds.map((businessId) => ({
                businessId,
                orderItemId: data.id,
              })),
            });
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
    });
    return record;
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
