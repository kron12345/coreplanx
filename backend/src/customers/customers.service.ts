import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomersRepository } from './customers.repository';
import {
  CreateCustomerPayload,
  CustomerContact,
  CustomerDto,
  CustomerSearchRequest,
  CustomerSearchResponse,
} from './customers.types';

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  async searchCustomers(
    payload: CustomerSearchRequest,
  ): Promise<CustomerSearchResponse> {
    const page = this.normalizePage(payload.page);
    const pageSize = this.normalizePageSize(payload.pageSize);
    const term = payload.search?.trim().toLowerCase() ?? '';

    const records = await this.repository.listCustomers();
    const filtered = records
      .map((record) => this.mapCustomer(record))
      .filter((customer) => this.matchesSearch(customer, term));

    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    return {
      customers: filtered.slice(startIndex, startIndex + pageSize),
      total,
      page,
      pageSize,
      hasMore: startIndex + pageSize < total,
    };
  }

  async getCustomerById(customerId: string): Promise<CustomerDto> {
    const record = await this.repository.getCustomerById(customerId);
    if (!record) {
      throw new NotFoundException(`Customer ${customerId} not found.`);
    }
    return this.mapCustomer(record);
  }

  async createCustomer(payload: CreateCustomerPayload): Promise<CustomerDto> {
    const customerId = this.generateCustomerId(
      payload.name,
      payload.customerNumber,
    );
    const contacts = this.normalizeContacts(payload.contacts ?? []);

    const record = await this.repository.createCustomer({
      id: customerId,
      name: payload.name.trim(),
      customerNumber: payload.customerNumber.trim(),
      projectNumber: payload.projectNumber?.trim() || null,
      address: payload.address?.trim() || null,
      notes: payload.notes?.trim() || null,
      contacts: contacts as unknown as Prisma.JsonArray,
      updatedAt: new Date(),
    });
    return this.mapCustomer(record);
  }

  async deleteCustomer(customerId: string): Promise<void> {
    const deleted = await this.repository.deleteCustomer(customerId);
    if (!deleted) {
      throw new NotFoundException(`Customer ${customerId} not found.`);
    }
  }

  private mapCustomer(
    record: Awaited<ReturnType<CustomersRepository['listCustomers']>>[number],
  ): CustomerDto {
    const contacts = Array.isArray(record.contacts)
      ? (record.contacts as unknown as CustomerContact[])
      : [];
    return {
      id: record.id,
      name: record.name,
      customerNumber: record.customerNumber,
      projectNumber: record.projectNumber ?? undefined,
      address: record.address ?? undefined,
      notes: record.notes ?? undefined,
      contacts,
      createdAt: record.createdAt?.toISOString(),
      updatedAt: record.updatedAt?.toISOString(),
    };
  }

  private matchesSearch(customer: CustomerDto, term: string): boolean {
    if (!term) {
      return true;
    }
    const fields: Array<string | undefined> = [
      customer.id,
      customer.name,
      customer.customerNumber,
      customer.projectNumber,
      customer.address,
      customer.notes,
    ];
    const contactFields = customer.contacts.flatMap((contact) => [
      contact.name,
      contact.role,
      contact.email,
      contact.phone,
    ]);
    return [...fields, ...contactFields]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(term));
  }

  private normalizeContacts(contacts: CustomerContact[]): CustomerContact[] {
    return contacts
      .map((contact) => ({
        ...contact,
        id: contact.id || this.generateContactId(),
        name: contact.name?.trim() ?? '',
        role: contact.role?.trim() || undefined,
        email: contact.email?.trim() || undefined,
        phone: contact.phone?.trim() || undefined,
      }))
      .filter((contact) => contact.name.length || contact.email || contact.phone);
  }

  private generateCustomerId(name: string, customerNumber: string): string {
    const slug = `${name}-${customerNumber}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 32);
    const random = Math.random().toString(36).slice(2, 6);
    return `cust-${slug || 'new'}-${random}`;
  }

  private generateContactId(): string {
    const random = Math.random().toString(36).slice(2, 6);
    return `contact-${random}`;
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
