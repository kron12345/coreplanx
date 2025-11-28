import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  CreateCustomerPayload,
  CustomerService,
} from '../../core/services/customer.service';
import { Customer } from '../../core/models/customer.model';
import { OrderService } from '../../core/services/order.service';
import { Order } from '../../core/models/order.model';

interface CustomerHeroMetrics {
  totalCustomers: number;
  totalContacts: number;
  activeProjects: number;
  linkedOrders: number;
}

interface InsightContext {
  title: string;
  message: string;
  hint: string;
  icon: string;
}

interface CustomerFilterPreset {
  id: string;
  name: string;
  search: string;
}

const CUSTOMER_SEARCH_STORAGE_KEY = 'customers.search.v1';
const CUSTOMER_INSIGHTS_STORAGE_KEY = 'customers.insightsCollapsed.v1';
const CUSTOMER_PRESETS_STORAGE_KEY = 'customers.presets.v1';

@Component({
  selector: 'app-customer-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './customer-list.component.html',
  styleUrl: './customer-list.component.scss',
})
export class CustomerListComponent {
  private readonly customerService = inject(CustomerService);
  private readonly orderService = inject(OrderService);
  private readonly fb = inject(FormBuilder);

  readonly customers = this.customerService.customers;
  readonly orders = this.orderService.orders;
  readonly hasCustomers = computed(() => this.customers().length > 0);
  readonly searchControl = new FormControl('', { nonNullable: true });
  private readonly searchTerm = signal('');
  readonly filteredCustomers = computed(() => this.filterCustomers(this.searchTerm()));
  readonly insightsCollapsed = signal(this.loadInsightsCollapsed());
  readonly heroMetrics = computed(() => this.computeHeroMetrics());
  readonly heroMetricList = computed(() => [
    {
      key: 'customers',
      label: 'Kunden',
      value: this.heroMetrics().totalCustomers,
      hint: 'im CRM erfasst',
      icon: 'groups',
      action: () => this.clearSearch(),
    },
    {
      key: 'contacts',
      label: 'Kontakte',
      value: this.heroMetrics().totalContacts,
      hint: 'aktive Ansprechpartner',
      icon: 'badge',
      action: () => {},
    },
    {
      key: 'projects',
      label: 'Projekte',
      value: this.heroMetrics().activeProjects,
      hint: 'mit Projektnummer',
      icon: 'workspaces',
      action: () => {},
    },
    {
      key: 'orders',
      label: 'Verknüpfte Aufträge',
      value: this.heroMetrics().linkedOrders,
      hint: 'mit Zuordnung',
      icon: 'assignment',
      action: () => {},
    },
  ]);
  readonly topContactRoles = computed(() => this.computeTopContactRoles());
  readonly topProjects = computed(() => this.computeTopProjects());
  readonly topAccountsByOrders = computed(() => this.computeTopAccountsByOrders());
  readonly insightContext = computed(() => this.computeInsightContext());
  private readonly savedPresets = signal<CustomerFilterPreset[]>([]);
  readonly savedFilterPresets = computed(() => this.savedPresets());
  private readonly activePresetId = signal<string | null>(null);
  readonly activePreset = computed(() => this.activePresetId());

  constructor() {
    this.restorePresetsFromStorage();
    const initialSearch = this.loadSearchTerm();
    this.searchControl.setValue(initialSearch, { emitEvent: false });
    this.searchTerm.set(initialSearch);
    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.clearActivePreset();
        this.searchTerm.set(value);
        this.persistSearchTerm(value);
      });

    effect(() => {
      this.persistPresets(this.savedPresets());
    });

    effect(
      () => {
        const activeId = this.activePresetId();
        if (!activeId) {
          return;
        }
        const preset = this.savedPresets().find((entry) => entry.id === activeId);
        if (!preset || preset.search !== this.searchTerm()) {
          this.activePresetId.set(null);
        }
      },
      { allowSignalWrites: true },
    );
  }

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    customerNumber: ['', [Validators.required, Validators.maxLength(40)]],
    projectNumber: ['', Validators.maxLength(80)],
    address: ['', Validators.maxLength(200)],
    notes: ['', Validators.maxLength(500)],
    contacts: this.fb.array<FormGroup>([]),
  });

  get contacts(): FormArray<FormGroup> {
    return this.form.controls.contacts as FormArray<FormGroup>;
  }

  addContact() {
    this.contacts.push(
      this.fb.group({
        name: ['', Validators.maxLength(120)],
        role: ['', Validators.maxLength(80)],
        email: ['', Validators.email],
        phone: ['', Validators.maxLength(40)],
      }),
    );
  }

  removeContact(index: number) {
    this.contacts.removeAt(index);
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const contacts = this.contacts.controls
      .map((group) => group.getRawValue())
      .filter((contact) =>
        (contact.name ?? '').trim().length > 0 ||
        (contact.email ?? '').trim().length > 0 ||
        (contact.phone ?? '').trim().length > 0,
      )
      .map((contact, index) => ({
        id: `contact-form-${index}`,
        name: contact.name?.trim() ?? '',
        role: contact.role?.trim() || undefined,
        email: contact.email?.trim() || undefined,
        phone: contact.phone?.trim() || undefined,
      }));

    const payload: CreateCustomerPayload = {
      name: value.name!.trim(),
      customerNumber: value.customerNumber!.trim(),
      projectNumber: value.projectNumber?.trim() || undefined,
      address: value.address?.trim() || undefined,
      notes: value.notes?.trim() || undefined,
      contacts,
    };

    this.customerService.createCustomer(payload);
    this.resetForm();
  }

  deleteCustomer(customer: Customer) {
    const confirmDeletion = window.confirm(
      `Soll der Kunde "${customer.name}" wirklich gelöscht werden? Verknüpfte Aufträge verlieren die Zuordnung.`,
    );
    if (!confirmDeletion) {
      return;
    }
    this.customerService.deleteCustomer(customer.id);
    this.orderService.removeCustomerAssignments(customer.id);
  }

  linkedOrders(customerId: string): Order[] {
    return this.orders().filter((order) => order.customerId === customerId);
  }

  resetForm() {
    this.form.reset({
      name: '',
      customerNumber: '',
      projectNumber: '',
      address: '',
      notes: '',
    });
    this.contacts.clear();
  }

  clearSearch() {
    if (!this.searchControl.value) {
      return;
    }
    this.searchControl.setValue('');
  }

  saveCurrentFilterPreset(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const name = window
      .prompt('Filteransicht benennen', this.defaultPresetName())
      ?.trim();
    if (!name) {
      return;
    }
    const preset: CustomerFilterPreset = {
      id: this.generatePresetId(),
      name,
      search: this.searchControl.value.trim(),
    };
    this.savedPresets.update((current) => [...current, preset]);
    this.activePresetId.set(preset.id);
  }

  applyFilterPreset(preset: CustomerFilterPreset): void {
    this.searchControl.setValue(preset.search, { emitEvent: false });
    this.searchTerm.set(preset.search);
    this.persistSearchTerm(preset.search);
    this.activePresetId.set(preset.id);
  }

  removeFilterPreset(id: string): void {
    this.savedPresets.update((current) =>
      current.filter((preset) => preset.id !== id),
    );
    if (this.activePresetId() === id) {
      this.activePresetId.set(null);
    }
  }

  duplicateFilterPreset(preset: CustomerFilterPreset): void {
    const copy: CustomerFilterPreset = {
      id: this.generatePresetId(),
      name: `${preset.name} (Kopie)`,
      search: preset.search,
    };
    this.savedPresets.update((current) => [...current, copy]);
  }

  renameFilterPreset(preset: CustomerFilterPreset): void {
    if (typeof window === 'undefined') {
      return;
    }
    const nextName = window
      .prompt('Neuen Namen vergeben', preset.name)
      ?.trim();
    if (!nextName || nextName === preset.name) {
      return;
    }
    this.savedPresets.update((current) =>
      current.map((entry) =>
        entry.id === preset.id ? { ...entry, name: nextName } : entry,
      ),
    );
  }

  toggleInsightsCollapsed(): void {
    this.insightsCollapsed.update((current) => {
      const next = !current;
      this.persistInsightsCollapsed(next);
      return next;
    });
  }

  private filterCustomers(term: string): Customer[] {
    const normalized = term.trim().toLowerCase();
    if (!normalized.length) {
      return this.customers();
    }
    return this.customers().filter((customer) => this.matchesCustomer(customer, normalized));
  }

  private matchesCustomer(customer: Customer, term: string): boolean {
    const fields = [
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
    const linkedOrderFields = this.orders()
      .filter((order) => order.customerId === customer.id)
      .flatMap((order) => [order.id, order.name]);
    return [...fields, ...contactFields, ...linkedOrderFields]
      .filter((value): value is string => !!value)
      .some((value) => value.toLowerCase().includes(term));
  }

  private computeHeroMetrics(): CustomerHeroMetrics {
    const customers = this.customers();
    const orders = this.orders();
    const totalContacts = customers.reduce((total, customer) => total + customer.contacts.length, 0);
    const activeProjects = customers.filter((customer) => (customer.projectNumber ?? '').trim().length > 0).length;
    const linkedOrders = orders.filter((order) => !!order.customerId).length;
    return {
      totalCustomers: customers.length,
      totalContacts,
      activeProjects,
      linkedOrders,
    };
  }

  private computeTopContactRoles(): [string, number][] {
    const stats = new Map<string, number>();
    this.customers().forEach((customer) =>
      customer.contacts.forEach((contact) => {
        const role = contact.role?.trim();
        if (!role) {
          return;
        }
        stats.set(role, (stats.get(role) ?? 0) + 1);
      }),
    );
    return Array.from(stats.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }))
      .slice(0, 3);
  }

  private computeTopProjects(): [string, number][] {
    const stats = new Map<string, number>();
    this.customers()
      .map((customer) => customer.projectNumber?.trim())
      .filter((project): project is string => !!project)
      .forEach((project) => stats.set(project, (stats.get(project) ?? 0) + 1));
    return Array.from(stats.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }))
      .slice(0, 3);
  }

  private computeTopAccountsByOrders(): { customer: Customer; count: number }[] {
    const orderCounts = new Map<string, number>();
    this.orders().forEach((order) => {
      if (!order.customerId) {
        return;
      }
      orderCounts.set(order.customerId, (orderCounts.get(order.customerId) ?? 0) + 1);
    });
    return this.customers()
      .map((customer) => ({
        customer,
        count: orderCounts.get(customer.id) ?? 0,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.customer.name.localeCompare(b.customer.name, 'de', { sensitivity: 'base' }))
      .slice(0, 3);
  }

  private computeInsightContext(): InsightContext {
    const search = this.searchTerm().trim();
    const metrics = this.heroMetrics();
    if (search.length) {
      return {
        title: 'Suche aktiv',
        message: `Gefiltert nach "${search}" · ${this.filteredCustomers().length} Treffer.`,
        hint: 'Suche leeren, um alle Kunden zu sehen.',
        icon: 'search',
      };
    }
    if (!metrics.totalCustomers) {
      return {
        title: 'Noch keine Kunden',
        message: 'Lege deinen ersten Kunden mit dem Formular an.',
        hint: 'Kontakte helfen später bei der Zuordnung von Aufträgen.',
        icon: 'sentiment_satisfied',
      };
    }
    return {
      title: 'CRM Überblick',
      message: `${metrics.totalCustomers} Kunden · ${metrics.totalContacts} Kontakte · ${metrics.linkedOrders} Aufträge zugeordnet.`,
      hint: 'Insights unten zeigen Rollen, Projekte und Accounts mit hoher Aktivität.',
      icon: 'group_work',
    };
  }

  private loadSearchTerm(): string {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return '';
      }
      return window.localStorage.getItem(CUSTOMER_SEARCH_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }

  private persistSearchTerm(value: string): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }
      window.localStorage.setItem(CUSTOMER_SEARCH_STORAGE_KEY, value ?? '');
    } catch {
      // ignore storage issues
    }
  }

  private loadInsightsCollapsed(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return false;
      }
      return window.localStorage.getItem(CUSTOMER_INSIGHTS_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private persistInsightsCollapsed(value: boolean): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return;
      }
      window.localStorage.setItem(CUSTOMER_INSIGHTS_STORAGE_KEY, String(value));
    } catch {
      // ignore storage issues
    }
  }

  private restorePresetsFromStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(CUSTOMER_PRESETS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<CustomerFilterPreset>[] | undefined;
      if (!Array.isArray(parsed)) {
        return;
      }
      const normalized = parsed
        .map((entry) =>
          entry?.id && entry.name
            ? { id: entry.id, name: entry.name, search: entry.search ?? '' }
            : null,
        )
        .filter((entry): entry is CustomerFilterPreset => !!entry);
      this.savedPresets.set(normalized);
    } catch (error) {
      console.warn('Kunden-Presets konnten nicht geladen werden', error);
    }
  }

  private persistPresets(presets: CustomerFilterPreset[]): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(CUSTOMER_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch (error) {
      console.warn('Kunden-Presets konnten nicht gespeichert werden', error);
    }
  }

  private clearActivePreset(): void {
    if (this.activePresetId()) {
      this.activePresetId.set(null);
    }
  }

  private defaultPresetName(): string {
    return `Ansicht ${this.savedPresets().length + 1}`;
  }

  private generatePresetId(): string {
    return `customer-preset-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }
}
