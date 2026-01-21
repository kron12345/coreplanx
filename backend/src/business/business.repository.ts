import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const businessSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  assignmentType: true,
  assignmentName: true,
  dueDate: true,
  documents: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  orderLinks: {
    select: {
      orderItemId: true,
    },
  },
} satisfies Prisma.BusinessSelect;

export type BusinessRecord = Prisma.BusinessGetPayload<{
  select: typeof businessSelect;
}>;

@Injectable()
export class BusinessRepository {
  constructor(private readonly prisma: PrismaService) {}

  listBusinesses(): Promise<BusinessRecord[]> {
    return this.prisma.business.findMany({
      select: businessSelect,
    });
  }

  getBusinessById(id: string): Promise<BusinessRecord | null> {
    return this.prisma.business.findUnique({
      where: { id },
      select: businessSelect,
    });
  }

  async createBusiness(
    data: Prisma.BusinessCreateInput,
    linkedOrderItemIds: string[],
  ): Promise<BusinessRecord> {
    await this.prisma.business.create({
      data: {
        ...data,
        orderLinks: linkedOrderItemIds.length
          ? {
              createMany: {
                data: linkedOrderItemIds.map((orderItemId) => ({
                  orderItemId,
                })),
              },
            }
          : undefined,
      },
    });
    const created = await this.getBusinessById(data.id as string);
    if (!created) {
      throw new Error('Created business not found.');
    }
    return created;
  }

  async updateBusiness(
    businessId: string,
    data: Prisma.BusinessUpdateInput,
    linkedOrderItemIds?: string[],
  ): Promise<BusinessRecord | null> {
    const updated = await this.prisma.$transaction(async (tx) => {
      if (linkedOrderItemIds) {
        await tx.businessOrderItem.deleteMany({
          where: { businessId },
        });
        if (linkedOrderItemIds.length) {
          await tx.businessOrderItem.createMany({
            data: linkedOrderItemIds.map((orderItemId) => ({
              businessId,
              orderItemId,
            })),
          });
        }
      }
      const result = await tx.business.updateMany({
        where: { id: businessId },
        data,
      });
      if (!result.count) {
        return null;
      }
      return tx.business.findUnique({
        where: { id: businessId },
        select: businessSelect,
      });
    });
    return updated;
  }

  async deleteBusiness(businessId: string): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.businessOrderItem.deleteMany({
        where: { businessId },
      });
      const deleted = await tx.business.deleteMany({
        where: { id: businessId },
      });
      return deleted.count > 0;
    });
    return result;
  }
}
