import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Customer, CustomerContact } from '../models/customer.model';
import { CustomerApiService } from '../api/customer-api.service';

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
  private readonly api = inject(CustomerApiService);
  private readonly _customers = signal<Customer[]>([]);
  private readonly loading = signal(false);

  readonly customers = computed(() => this._customers());
  readonly isLoading = computed(() => this.loading());

  constructor() {
    void this.loadFromApi();
  }

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

  async createCustomer(payload: CreateCustomerPayload): Promise<Customer> {
    const customer = await firstValueFrom(
      this.api.createCustomer({
        name: payload.name.trim(),
        customerNumber: payload.customerNumber.trim(),
        projectNumber: payload.projectNumber?.trim() || undefined,
        address: payload.address?.trim() || undefined,
        notes: payload.notes?.trim() || undefined,
        contacts: this.normalizeContacts(payload.contacts),
      }),
    );
    this.replaceCustomer(customer, true);
    return customer;
  }

  async deleteCustomer(id: string): Promise<void> {
    if (!this._customers().some((customer) => customer.id === id)) {
      return;
    }
    this._customers.update((customers) =>
      customers.filter((customer) => customer.id !== id),
    );
    try {
      await firstValueFrom(this.api.deleteCustomer(id));
    } catch (error) {
      console.warn('[CustomerService] Failed to delete customer', error);
    }
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

  private generateContactId(index: number): string {
    const random = Math.random().toString(36).slice(2, 6);
    return `contact-${index}-${random}`;
  }

  private async loadFromApi(force = false): Promise<void> {
    if (this.loading() && !force) {
      return;
    }
    this.loading.set(true);
    try {
      const customers = await this.fetchAllCustomers();
      this._customers.set(customers);
    } catch (error) {
      console.warn('[CustomerService] Failed to load customers', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchAllCustomers(): Promise<Customer[]> {
    const customers: Customer[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await firstValueFrom(
        this.api.searchCustomers({ page, pageSize: 200 }),
      );
      customers.push(...(response.customers ?? []));
      hasMore = response.hasMore;
      page += 1;
      if (!response.pageSize) {
        break;
      }
    }
    return customers;
  }

  private replaceCustomer(customer: Customer, prepend = false): void {
    this._customers.update((customers) => {
      const index = customers.findIndex((entry) => entry.id === customer.id);
      if (index === -1) {
        return prepend ? [customer, ...customers] : [...customers, customer];
      }
      const next = [...customers];
      next[index] = customer;
      return next;
    });
  }
}
