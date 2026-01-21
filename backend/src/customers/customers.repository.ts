import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const customerSelect = {
  id: true,
  name: true,
  customerNumber: true,
  projectNumber: true,
  address: true,
  contacts: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

export type CustomerRecord = Prisma.CustomerGetPayload<{
  select: typeof customerSelect;
}>;

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  listCustomers(): Promise<CustomerRecord[]> {
    return this.prisma.customer.findMany({
      select: customerSelect,
      orderBy: { updatedAt: 'desc' },
    });
  }

  getCustomerById(id: string): Promise<CustomerRecord | null> {
    return this.prisma.customer.findUnique({
      where: { id },
      select: customerSelect,
    });
  }

  async createCustomer(
    data: Prisma.CustomerCreateInput,
  ): Promise<CustomerRecord> {
    await this.prisma.customer.create({ data });
    const created = await this.getCustomerById(data.id as string);
    if (!created) {
      throw new Error('Created customer not found.');
    }
    return created;
  }

  async deleteCustomer(customerId: string): Promise<boolean> {
    const result = await this.prisma.customer.deleteMany({
      where: { id: customerId },
    });
    return result.count > 0;
  }
}
