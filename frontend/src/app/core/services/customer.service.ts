import { Injectable, computed, signal } from '@angular/core';
import { Customer, CustomerContact } from '../models/customer.model';
import { MOCK_CUSTOMERS } from '../mock/mock-customers.mock';

export interface CreateCustomerPayload {
  name: string;
  customerNumber: string;
  projectNumber?: string;
  address?: string;
  notes?: string;
  contacts?: CustomerContact[];
}

@Injectable({ providedIn: 'root' })
export class CustomerService {
  private readonly _customers = signal<Customer[]>(MOCK_CUSTOMERS);

  readonly customers = computed(() => this._customers());

  getById(id: string | undefined): Customer | undefined {
    if (!id) {
      return undefined;
    }
    return this._customers().find((customer) => customer.id === id);
  }

  search(term: string): Customer[] {
    const normalized = term.trim().toLowerCase();
    if (!normalized.length) {
      return this._customers();
    }
    return this._customers().filter((customer) =>
      [
        customer.name,
        customer.customerNumber,
        customer.projectNumber,
        customer.contacts.map((contact) => contact.name).join(' '),
      ]
        .filter((value): value is string => !!value)
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }

  createCustomer(payload: CreateCustomerPayload): Customer {
    const customer: Customer = {
      id: this.generateId(payload.name, payload.customerNumber),
      name: payload.name.trim(),
      customerNumber: payload.customerNumber.trim(),
      projectNumber: payload.projectNumber?.trim() || undefined,
      address: payload.address?.trim() || undefined,
      notes: payload.notes?.trim() || undefined,
      contacts: this.normalizeContacts(payload.contacts),
    };
    this._customers.update((customers) => [customer, ...customers]);
    return customer;
  }

  deleteCustomer(id: string) {
    this._customers.update((customers) =>
      customers.filter((customer) => customer.id !== id),
    );
  }

  private normalizeContacts(
    contacts: CustomerContact[] | undefined,
  ): CustomerContact[] {
    if (!contacts?.length) {
      return [];
    }
    return contacts
      .map((contact, index) => ({
        ...contact,
        id: contact.id || this.generateContactId(index),
        name: contact.name?.trim() ?? '',
        role: contact.role?.trim() || undefined,
        email: contact.email?.trim() || undefined,
        phone: contact.phone?.trim() || undefined,
      }))
      .filter((contact) => contact.name.length || contact.email || contact.phone);
  }

  private generateId(name: string, customerNumber: string): string {
    const slug = `${name}-${customerNumber}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 32);
    const random = Math.random().toString(36).slice(2, 6);
    return `cust-${slug || 'new'}-${random}`;
  }

  private generateContactId(index: number): string {
    const random = Math.random().toString(36).slice(2, 6);
    return `contact-${index}-${random}`;
  }
}
