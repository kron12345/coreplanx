import { Injectable, computed, signal } from '@angular/core';
import {
  Business,
  BusinessAssignment,
  BusinessDocument,
  BusinessStatus,
} from '../models/business.model';
import { MOCK_BUSINESSES } from '../mock/mock-businesses.mock';
import { OrderService } from './order.service';

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
  private readonly _businesses = signal<Business[]>(MOCK_BUSINESSES);
  private readonly _filters = signal<BusinessFilters>({ ...DEFAULT_BUSINESS_FILTERS });
  private readonly _sort = signal<BusinessSort>({ ...DEFAULT_BUSINESS_SORT });
  private readonly browserStorage = this.detectStorage();
  private readonly businessIndex = computed(() => {
    const entries = this._businesses().map((business) => [business.id, business] as const);
    return new Map<string, Business>(entries);
  });

  readonly businesses = computed(() => this._businesses());
  readonly filters = computed(() => this._filters());
  readonly sort = computed(() => this._sort());
  readonly filteredBusinesses = computed(() => {
    const filters = this._filters();
    const sort = this._sort();
    const now = new Date();
    const searchTokens = this.parseSearchTokens(filters.search);
    return this._businesses()
      .filter((business) => this.matchesFilters(business, filters, now, searchTokens))
      .sort((a, b) => this.sortBusinesses(a, b, sort));
  });
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
  }

  resetFilters() {
    this._filters.set({ ...DEFAULT_BUSINESS_FILTERS });
    this.persistFilters(this._filters());
  }

  setSort(sort: BusinessSort) {
    this._sort.set(sort);
    this.persistSort(sort);
  }

  createBusiness(payload: CreateBusinessPayload): Business {
    const id = this.generateBusinessId();
    const linkedIds = payload.linkedOrderItemIds ?? [];
    const newBusiness: Business = {
      id,
      title: payload.title,
      description: payload.description,
      createdAt: new Date().toISOString(),
      dueDate: payload.dueDate ? payload.dueDate.toISOString() : undefined,
      status: 'neu',
      assignment: payload.assignment,
      documents: payload.documents,
      linkedOrderItemIds: linkedIds.length ? [...new Set(linkedIds)] : undefined,
      tags: payload.tags?.length ? [...new Set(payload.tags)] : undefined,
    };

    this._businesses.update((businesses) => [newBusiness, ...businesses]);
    linkedIds.forEach((itemId) =>
      this.orderService.linkBusinessToItem(id, itemId),
    );
    return newBusiness;
  }

  updateBusiness(businessId: string, patch: Partial<Omit<Business, 'id'>>) {
    this._businesses.update((businesses) =>
      businesses.map((business) =>
        business.id === businessId ? { ...business, ...patch } : business,
      ),
    );
  }

  updateStatus(businessId: string, status: BusinessStatus) {
    this.updateBusiness(businessId, { status });
  }

  updateTags(businessId: string, tags: string[]) {
    const cleaned = tags
      .map((tag) => tag.trim())
      .filter((tag) => !!tag);
    const unique = Array.from(new Set(cleaned));
    this.updateBusiness(businessId, {
      tags: unique.length ? unique : undefined,
    });
  }

  setLinkedOrderItems(businessId: string, itemIds: string[]) {
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
  }

  deleteBusiness(businessId: string): void {
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

  private generateBusinessId(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    return `G-${timestamp}`;
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
