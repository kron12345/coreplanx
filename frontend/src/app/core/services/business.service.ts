import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  Business,
  BusinessAssignment,
  BusinessDocument,
  BusinessStatus,
} from '../models/business.model';
import { OrderService } from './order.service';
import { BusinessApiService } from '../api/business-api.service';
import { OrderManagementRealtimeEvent, OrderManagementRealtimeService } from './order-management-realtime.service';
import { ClientIdentityService } from './client-identity.service';

export type BusinessDueDateFilter =
  | 'all'
  | 'overdue'
  | 'today'
  | 'this_week'
  | 'next_week';

export interface BusinessFilters {
  search: string;
  status: BusinessStatus | 'all';
  dueDate: BusinessDueDateFilter;
  assignment: 'all' | string;
  tags: string[];
}

const DEFAULT_BUSINESS_FILTERS: BusinessFilters = {
  search: '',
  status: 'all',
  dueDate: 'all',
  assignment: 'all',
  tags: [],
};

const DEFAULT_BUSINESS_SORT: BusinessSort = {
  field: 'dueDate',
  direction: 'asc',
};

const BUSINESS_FILTERS_STORAGE_KEY = 'business.filters.v1';
const BUSINESS_SORT_STORAGE_KEY = 'business.sort.v1';

type ParsedSearchTokens = {
  textTerms: string[];
  tags: string[];
  assignment?: string;
  status?: BusinessStatus;
};

type BusinessPatch = Partial<Omit<Business, 'id' | 'dueDate'>> & {
  dueDate?: string | Date | null;
};

export type BusinessSortField = 'dueDate' | 'createdAt' | 'status' | 'title';

export interface BusinessSort {
  field: BusinessSortField;
  direction: 'asc' | 'desc';
}

export interface CreateBusinessPayload {
  title: string;
  description: string;
  dueDate?: Date | null;
  assignment: BusinessAssignment;
  documents?: BusinessDocument[];
  linkedOrderItemIds?: string[];
  tags?: string[];
}

@Injectable({ providedIn: 'root' })
export class BusinessService {
  private readonly api = inject(BusinessApiService);
  private readonly realtime = inject(OrderManagementRealtimeService);
  private readonly identity = inject(ClientIdentityService);
  private readonly _businesses = signal<Business[]>([]);
  private readonly _filters = signal<BusinessFilters>({ ...DEFAULT_BUSINESS_FILTERS });
  private readonly _sort = signal<BusinessSort>({ ...DEFAULT_BUSINESS_SORT });
  private readonly loading = signal(false);
  private readonly hasMore = signal(true);
  private readonly total = signal(0);
  private readonly pageSize = 30;
  private currentPage = 1;
  private fetchToken = 0;
  private readonly browserStorage = this.detectStorage();
  private readonly businessIndex = computed(() => {
    const entries = this._businesses().map((business) => [business.id, business] as const);
    return new Map<string, Business>(entries);
  });

  readonly businesses = computed(() => this._businesses());
  readonly totalCount = computed(() => this.total());
  readonly hasMoreBusinesses = computed(() => this.hasMore());
  readonly isLoading = computed(() => this.loading());
  readonly filters = computed(() => this._filters());
  readonly sort = computed(() => this._sort());
  readonly filteredBusinesses = computed(() => this._businesses());
  readonly assignments = computed(() =>
    Array.from(
      new Map(
        this._businesses().map((b) => [
          b.assignment.name.toLowerCase(),
          b.assignment,
        ]),
      ).values(),
    ),
  );

  constructor(private readonly orderService: OrderService) {
    const restoredFilters = this.restoreFilters();
    if (restoredFilters) {
      this._filters.set(restoredFilters);
    }
    const restoredSort = this.restoreSort();
    if (restoredSort) {
      this._sort.set(restoredSort);
    }
    void this.refreshBusinesses();
    this.realtime.events().subscribe((event) => this.handleRealtimeEvent(event));
  }

  private handleRealtimeEvent(event: OrderManagementRealtimeEvent): void {
    if (event.scope !== 'business' || event.entityType !== 'business') {
      return;
    }
    if (
      event.sourceConnectionId &&
      event.sourceConnectionId === this.identity.connectionId()
    ) {
      return;
    }
    if (event.action === 'delete') {
      this.removeBusinessFromStore(event.entityId);
      return;
    }
    if (event.action === 'upsert' && event.payload) {
      this.applyRealtimeBusiness(event.payload as Business);
    }
  }

  private applyRealtimeBusiness(business: Business): void {
    const exists = this.getById(business.id);
    if (!exists) {
      void this.refreshBusinesses();
      return;
    }
    this.replaceBusiness(business);
  }

  private removeBusinessFromStore(businessId: string): void {
    this._businesses.update((entries) =>
      entries.filter((entry) => entry.id !== businessId),
    );
  }

  getById(id: string): Business | undefined {
    return this.businessIndex().get(id);
  }

  getByIds(ids: readonly string[]): Business[] {
    if (!ids.length) {
      return [];
    }

    const businessById = this.businessIndex();
    return ids.reduce<Business[]>((acc, id) => {
      const business = businessById.get(id);
      if (business) {
        acc.push(business);
      }
      return acc;
    }, []);
  }

  setFilters(patch: Partial<BusinessFilters>) {
    this._filters.update((current) => {
      const next = { ...current, ...patch };
      this.persistFilters(next);
      return next;
    });
    void this.refreshBusinesses();
  }

  resetFilters() {
    this._filters.set({ ...DEFAULT_BUSINESS_FILTERS });
    this.persistFilters(this._filters());
    void this.refreshBusinesses();
  }

  setSort(sort: BusinessSort) {
    this._sort.set(sort);
    this.persistSort(sort);
    void this.refreshBusinesses();
  }

  async createBusiness(payload: CreateBusinessPayload): Promise<Business> {
    const linkedIds = payload.linkedOrderItemIds ?? [];
    const normalizedTags = this.normalizeTagList(payload.tags);
    const created = await firstValueFrom(
      this.api.createBusiness({
        title: payload.title,
        description: payload.description,
        dueDate: payload.dueDate ? payload.dueDate.toISOString() : null,
        status: 'neu',
        assignment: payload.assignment,
        documents: payload.documents,
        linkedOrderItemIds: linkedIds.length ? linkedIds : undefined,
        tags: normalizedTags,
      }),
    );
    this.replaceBusiness(created, true);
    linkedIds.forEach((itemId) =>
      this.orderService.linkBusinessToItem(created.id, itemId),
    );
    return created;
  }

  async updateBusiness(
    businessId: string,
    patch: BusinessPatch,
  ): Promise<void> {
    const payload = this.toUpdatePayload(patch);
    if (!Object.keys(payload).length) {
      return;
    }
    const { dueDate, ...rest } = patch;
    const localPatch: Partial<Omit<Business, 'id'>> = { ...rest };
    if (dueDate !== undefined) {
      const normalized = dueDate instanceof Date ? dueDate.toISOString() : dueDate;
      if (normalized === null) {
        delete localPatch.dueDate;
      } else {
        localPatch.dueDate = normalized;
      }
    }
    this._businesses.update((businesses) =>
      businesses.map((business) =>
        business.id === businessId ? { ...business, ...localPatch } : business,
      ),
    );
    try {
      const updated = await firstValueFrom(
        this.api.updateBusiness(businessId, payload),
      );
      this.replaceBusiness(updated);
    } catch (error) {
      console.warn('[BusinessService] Failed to update business', error);
    }
  }

  async updateStatus(businessId: string, status: BusinessStatus): Promise<void> {
    await this.updateBusiness(businessId, { status });
  }

  async updateTags(businessId: string, tags: string[]): Promise<void> {
    const normalized = this.normalizeTagList(tags);
    await this.updateBusiness(businessId, {
      tags: normalized?.length ? normalized : undefined,
    });
  }

  async setLinkedOrderItems(businessId: string, itemIds: string[]): Promise<void> {
    const business = this._businesses().find((b) => b.id === businessId);
    if (!business) {
      return;
    }

    const nextIds = Array.from(new Set(itemIds));
    const previousIds = new Set(business.linkedOrderItemIds ?? []);

    const toLink = nextIds.filter((id) => !previousIds.has(id));
    const toUnlink = Array.from(previousIds).filter(
      (id) => !nextIds.includes(id),
    );

    this._businesses.update((businesses) =>
      businesses.map((b) =>
        b.id === businessId
          ? {
              ...b,
              linkedOrderItemIds: nextIds.length ? nextIds : undefined,
            }
          : b,
      ),
    );

    toLink.forEach((itemId) =>
      this.orderService.linkBusinessToItem(businessId, itemId),
    );
    toUnlink.forEach((itemId) =>
      this.orderService.unlinkBusinessFromItem(businessId, itemId),
    );

    try {
      await firstValueFrom(
        this.api.updateBusiness(businessId, {
          linkedOrderItemIds: nextIds.length ? nextIds : [],
        }),
      );
    } catch (error) {
      console.warn('[BusinessService] Failed to update linked order items', error);
    }
  }

  async deleteBusiness(businessId: string): Promise<void> {
    const business = this._businesses().find((b) => b.id === businessId);
    if (!business) {
      return;
    }
    const linked = business.linkedOrderItemIds ?? [];
    this._businesses.update((businesses) =>
      businesses.filter((entry) => entry.id !== businessId),
    );
    linked.forEach((itemId) =>
      this.orderService.unlinkBusinessFromItem(businessId, itemId),
    );
    try {
      await firstValueFrom(this.api.deleteBusiness(businessId));
    } catch (error) {
      console.warn('[BusinessService] Failed to delete business', error);
    }
  }

  async refreshBusinesses(force = false): Promise<void> {
    if (this.loading() && !force) {
      return;
    }
    this.currentPage = 1;
    await this.fetchBusinesses(this.currentPage, false);
  }

  async loadMoreBusinesses(): Promise<void> {
    if (this.loading() || !this.hasMore()) {
      return;
    }
    await this.fetchBusinesses(this.currentPage + 1, true);
  }

  private async fetchBusinesses(page: number, append: boolean): Promise<void> {
    if (this.loading()) {
      return;
    }
    this.loading.set(true);
    const requestId = (this.fetchToken += 1);
    try {
      const response = await firstValueFrom(
        this.api.searchBusinesses({
          filters: this._filters(),
          sort: this._sort(),
          page,
          pageSize: this.pageSize,
        }),
      );
      if (requestId !== this.fetchToken) {
        return;
      }
      const businesses = response.businesses ?? [];
      this.total.set(response.total ?? businesses.length);
      this.hasMore.set(Boolean(response.hasMore));
      this.currentPage = response.page ?? page;
      this._businesses.update((current) =>
        append ? this.appendBusinesses(current, businesses) : businesses,
      );
    } catch (error) {
      console.warn('[BusinessService] Failed to load businesses', error);
    } finally {
      if (requestId === this.fetchToken) {
        this.loading.set(false);
      }
    }
  }

  private appendBusinesses(current: Business[], next: Business[]): Business[] {
    if (!next.length) {
      return current;
    }
    const existingIds = new Set(current.map((business) => business.id));
    const additions = next.filter((business) => !existingIds.has(business.id));
    return [...current, ...additions];
  }

  private replaceBusiness(business: Business, prepend = false): void {
    this._businesses.update((businesses) => {
      const index = businesses.findIndex((entry) => entry.id === business.id);
      if (index === -1) {
        return prepend ? [business, ...businesses] : [...businesses, business];
      }
      const next = [...businesses];
      next[index] = business;
      return next;
    });
  }

  private toUpdatePayload(
    patch: BusinessPatch,
  ): {
    title?: string;
    description?: string;
    dueDate?: string | null;
    status?: BusinessStatus;
    assignment?: BusinessAssignment;
    documents?: BusinessDocument[];
    linkedOrderItemIds?: string[];
    tags?: string[];
  } {
    const payload: {
      title?: string;
      description?: string;
      dueDate?: string | null;
      status?: BusinessStatus;
      assignment?: BusinessAssignment;
      documents?: BusinessDocument[];
      linkedOrderItemIds?: string[];
      tags?: string[];
    } = {};

    if (patch.title !== undefined) {
      payload.title = patch.title;
    }
    if (patch.description !== undefined) {
      payload.description = patch.description;
    }
    if (patch.dueDate !== undefined) {
      payload.dueDate =
        patch.dueDate instanceof Date
          ? patch.dueDate.toISOString()
          : patch.dueDate ?? null;
    }
    if (patch.status !== undefined) {
      payload.status = patch.status;
    }
    if (patch.assignment !== undefined) {
      payload.assignment = patch.assignment;
    }
    if (patch.documents !== undefined) {
      payload.documents = patch.documents;
    }
    if (patch.linkedOrderItemIds !== undefined) {
      payload.linkedOrderItemIds = patch.linkedOrderItemIds;
    }
    if (patch.tags !== undefined) {
      payload.tags = this.normalizeTagList(patch.tags);
    }
    return payload;
  }

  private normalizeTagList(tags?: string[]): string[] | undefined {
    if (!tags?.length) {
      return undefined;
    }
    const cleaned = tags
      .map((tag) => tag.trim())
      .filter((tag) => tag.length);
    return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
  }

  private matchesFilters(
    business: Business,
    filters: BusinessFilters,
    now: Date,
    searchTokens: ParsedSearchTokens,
  ): boolean {

    if (filters.status !== 'all' && business.status !== filters.status) {
      return false;
    }

    if (filters.assignment !== 'all') {
      if (business.assignment.name !== filters.assignment) {
        return false;
      }
    }

    if (filters.tags.length) {
      if (!this.hasAllTags(business.tags ?? [], filters.tags)) {
        return false;
      }
    }

    if (searchTokens.assignment) {
      if (business.assignment.name.toLowerCase() !== searchTokens.assignment) {
        return false;
      }
    }

    if (searchTokens.status) {
      if (business.status !== searchTokens.status) {
        return false;
      }
    }

    if (searchTokens.tags.length) {
      if (!this.hasAllTags(business.tags ?? [], searchTokens.tags)) {
        return false;
      }
    }

    if (filters.dueDate !== 'all') {
      const due = business.dueDate ? new Date(business.dueDate) : undefined;
      if (!due) {
        return false;
      }
      switch (filters.dueDate) {
        case 'overdue':
          if (!this.isBeforeDay(due, now)) {
            return false;
          }
          break;
        case 'today':
          if (!this.isSameDay(due, now)) {
            return false;
          }
          break;
        case 'this_week':
          if (!this.isWithinWeek(due, now, 0)) {
            return false;
          }
          break;
        case 'next_week':
          if (!this.isWithinWeek(due, now, 1)) {
            return false;
          }
          break;
      }
    }

    if (searchTokens.textTerms.length) {
      const haystack =
        `${business.title} ${business.description} ${business.assignment.name} ${
          business.tags?.join(' ') ?? ''
        } ${business.status}`.toLowerCase();
      const hasAllTerms = searchTokens.textTerms.every((term) =>
        haystack.includes(term),
      );
      if (!hasAllTerms) {
        return false;
      }
    }

    return true;
  }

  private hasAllTags(source: string[], required: string[]): boolean {
    if (!required.length) {
      return true;
    }
    return required.every((tag) =>
      source.some((existing) => existing.toLowerCase() === tag.toLowerCase()),
    );
  }

  private sortBusinesses(a: Business, b: Business, sort: BusinessSort): number {
    const direction = sort.direction === 'asc' ? 1 : -1;
    switch (sort.field) {
      case 'dueDate': {
        const dueA = a.dueDate ? new Date(a.dueDate).getTime() : undefined;
        const dueB = b.dueDate ? new Date(b.dueDate).getTime() : undefined;
        if (dueA === dueB) {
          return this.compareStrings(a.title, b.title) * direction;
        }
        if (dueA === undefined) {
          return 1;
        }
        if (dueB === undefined) {
          return -1;
        }
        return (dueA - dueB) * direction;
      }
      case 'createdAt': {
        return (
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
          direction
        );
      }
      case 'status': {
        const order: Record<BusinessStatus, number> = {
          neu: 0,
          in_arbeit: 1,
          pausiert: 2,
          erledigt: 3,
        };
        return (order[a.status] - order[b.status]) * direction;
      }
      case 'title':
      default:
        return this.compareStrings(a.title, b.title) * direction;
    }
  }

  private compareStrings(a: string, b: string): number {
    return a.localeCompare(b, 'de', { sensitivity: 'base' });
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private isBeforeDay(a: Date, b: Date): boolean {
    const aDate = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const bDate = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return aDate.getTime() < bDate.getTime();
  }

  private isWithinWeek(date: Date, reference: Date, offsetWeeks: number) {
    const start = this.getStartOfWeek(reference, offsetWeeks);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return date >= start && date < end;
  }

  private getStartOfWeek(reference: Date, offsetWeeks: number) {
    const start = new Date(reference);
    const day = start.getDay() || 7;
    if (day !== 1) {
      start.setHours(-24 * (day - 1));
    } else {
      start.setHours(0, 0, 0, 0);
    }
    if (offsetWeeks) {
      start.setDate(start.getDate() + offsetWeeks * 7);
    }
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private parseSearchTokens(search: string): ParsedSearchTokens {
    const tokens: ParsedSearchTokens = {
      textTerms: [],
      tags: [],
    };
    if (!search.trim()) {
      return tokens;
    }
    const segments = this.tokenizeSearch(search);

    segments.forEach((segment) => {
      const lower = segment.toLowerCase();
      if (lower.startsWith('tag:')) {
        const value = this.stripQuotes(segment.slice(4).trim());
        if (value) {
          tokens.tags.push(value);
        }
        return;
      }
      if (segment.startsWith('#')) {
        const value = this.stripQuotes(segment.slice(1).trim());
        if (value) {
          tokens.tags.push(value);
        }
        return;
      }

      if (lower.startsWith('status:')) {
        const value = this.stripQuotes(lower.slice(7).trim());
        const status = this.findStatusByToken(value);
        if (status) {
          tokens.status = status;
        }
        return;
      }

      if (
        lower.startsWith('assign:') ||
        lower.startsWith('zuständig:') ||
        lower.startsWith('zustaendig:') ||
        lower.startsWith('owner:')
      ) {
        const separatorIndex = segment.indexOf(':');
        const value = this.stripQuotes(
          segment.slice(separatorIndex + 1).trim(),
        ).toLowerCase();
        if (value) {
          tokens.assignment = value;
        }
        return;
      }

      tokens.textTerms.push(this.stripQuotes(segment).toLowerCase());
    });

    if (
      !tokens.textTerms.length &&
      !tokens.tags.length &&
      !tokens.assignment &&
      !tokens.status
    ) {
      tokens.textTerms.push(search.trim().toLowerCase());
    }

    return tokens;
  }

  private findStatusByToken(token: string): BusinessStatus | undefined {
    switch (token) {
      case 'neu':
        return 'neu';
      case 'in_arbeit':
      case 'inarbeit':
      case 'arbeit':
        return 'in_arbeit';
      case 'pausiert':
        return 'pausiert';
      case 'erledigt':
      case 'done':
        return 'erledigt';
      default:
        return undefined;
    }
  }

  private tokenizeSearch(search: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < search.length; i += 1) {
      const char = search[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (/\s/.test(char) && !inQuotes) {
        if (current.trim().length) {
          tokens.push(current.trim());
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (current.trim().length) {
      tokens.push(current.trim());
    }
    return tokens;
  }

  private stripQuotes(value: string): string {
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      return value.slice(1, -1);
    }
    return value;
  }

  private detectStorage(): Storage | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return null;
      }
      return window.localStorage;
    } catch {
      return null;
    }
  }

  private restoreFilters(): BusinessFilters | null {
    if (!this.browserStorage) {
      return null;
    }
    try {
      const raw = this.browserStorage.getItem(BUSINESS_FILTERS_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<BusinessFilters>;
      return { ...DEFAULT_BUSINESS_FILTERS, ...parsed };
    } catch {
      return null;
    }
  }

  private persistFilters(filters: BusinessFilters): void {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(BUSINESS_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // ignore
    }
  }

  private restoreSort(): BusinessSort | null {
    if (!this.browserStorage) {
      return null;
    }
    try {
      const raw = this.browserStorage.getItem(BUSINESS_SORT_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<BusinessSort>;
      return {
        field: (parsed.field as BusinessSortField) ?? DEFAULT_BUSINESS_SORT.field,
        direction: parsed.direction ?? DEFAULT_BUSINESS_SORT.direction,
      };
    } catch {
      return null;
    }
  }

  private persistSort(sort: BusinessSort): void {
    if (!this.browserStorage) {
      return;
    }
    try {
      this.browserStorage.setItem(BUSINESS_SORT_STORAGE_KEY, JSON.stringify(sort));
    } catch {
      // ignore
    }
  }

  findByTags(requiredTags: string[]): Business | undefined {
    if (!requiredTags.length) {
      return undefined;
    }
    return this._businesses().find((business) => {
      const tags = business.tags ?? [];
      return requiredTags.every((tag) => tags.includes(tag));
    });
  }
}
