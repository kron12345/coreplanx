import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ScheduleTemplate,
  ScheduleTemplateCategory,
  ScheduleTemplateDay,
  ScheduleTemplateStatus,
  ScheduleTemplateStop,
} from '../models/schedule-template.model';
import { ScheduleTemplateApiService } from '../api/schedule-template-api.service';
import { OrderManagementRealtimeEvent, OrderManagementRealtimeService } from './order-management-realtime.service';
import { ClientIdentityService } from './client-identity.service';

export interface ScheduleTemplateFilters {
  search: string;
  status: ScheduleTemplateStatus | 'all';
  category: ScheduleTemplateCategory | 'all';
  day: ScheduleTemplateDay | 'all';
  tag: 'all' | string;
}

export type ScheduleTemplateSortField =
  | 'updatedAt'
  | 'title'
  | 'trainNumber'
  | 'status';

export interface ScheduleTemplateSort {
  field: ScheduleTemplateSortField;
  direction: 'asc' | 'desc';
}

export interface CreateScheduleTemplateStopPayload {
  type: 'origin' | 'intermediate' | 'destination';
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrivalEarliest?: string;
  arrivalLatest?: string;
  departureEarliest?: string;
  departureLatest?: string;
  offsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platformWish?: string;
  notes?: string;
}

export interface CreateScheduleTemplatePayload {
  title: string;
  description?: string;
  trainNumber: string;
  responsibleRu: string;
  category: ScheduleTemplateCategory;
  status: ScheduleTemplateStatus;
  startDate: string | Date;
  endDate?: string | Date | null;
  tags?: string[];
  recurrence?: {
    startTime: string;
    endTime: string;
    intervalMinutes: number;
    days: ScheduleTemplateDay[];
  };
  stops: CreateScheduleTemplateStopPayload[];
  composition?: ScheduleTemplate['composition'];
}

@Injectable({ providedIn: 'root' })
export class ScheduleTemplateService {
  private readonly api = inject(ScheduleTemplateApiService);
  private readonly realtime = inject(OrderManagementRealtimeService);
  private readonly identity = inject(ClientIdentityService);
  private readonly _templates = signal<ScheduleTemplate[]>([]);
  private readonly loading = signal(false);
  private readonly _filters = signal<ScheduleTemplateFilters>({
    search: '',
    status: 'all',
    category: 'all',
    day: 'all',
    tag: 'all',
  });
  private readonly _sort = signal<ScheduleTemplateSort>({
    field: 'updatedAt',
    direction: 'desc',
  });
  private readonly templateIndex = computed(() => {
    const entries = this._templates().map((template) => [template.id, template] as const);
    return new Map<string, ScheduleTemplate>(entries);
  });

  readonly templates = computed(() => this._templates());
  readonly filters = computed(() => this._filters());
  readonly sort = computed(() => this._sort());

  readonly tags = computed(() => {
    const set = new Set<string>();
    this._templates().forEach((template) =>
      template.tags?.forEach((tag) => set.add(tag)),
    );
    return Array.from(set.values()).sort((a, b) =>
      a.localeCompare(b, 'de', { sensitivity: 'base' }),
    );
  });

  readonly filteredTemplates = computed(() => {
    const filters = this._filters();
    const sort = this._sort();
    const search = filters.search.trim().toLowerCase();
    return this._templates()
      .filter((template) => {
        if (search) {
          const haystack = `${template.title} ${template.description ?? ''} ${
            template.trainNumber
          } ${template.tags?.join(' ') ?? ''}`.toLowerCase();
          if (!haystack.includes(search)) {
            return false;
          }
        }
        if (filters.status !== 'all' && template.status !== filters.status) {
          return false;
        }
        if (
          filters.category !== 'all' &&
          template.category !== filters.category
        ) {
          return false;
        }
        if (filters.tag !== 'all') {
          if (!template.tags?.includes(filters.tag)) {
            return false;
          }
        }
        if (filters.day !== 'all') {
          if (!template.recurrence?.days.includes(filters.day)) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => this.sortTemplates(a, b, sort));
  });

  constructor() {
    void this.loadFromApi();
    this.realtime.events().subscribe((event) => this.handleRealtimeEvent(event));
  }

  private handleRealtimeEvent(event: OrderManagementRealtimeEvent): void {
    if (event.scope !== 'templates' || event.entityType !== 'scheduleTemplate') {
      return;
    }
    if (
      event.sourceConnectionId &&
      event.sourceConnectionId === this.identity.connectionId()
    ) {
      return;
    }
    if (event.action === 'delete') {
      this.removeTemplateFromStore(event.entityId);
      return;
    }
    if (event.action === 'upsert' && event.payload) {
      this.applyRealtimeTemplate(event.payload as ScheduleTemplate);
    }
  }

  private applyRealtimeTemplate(template: ScheduleTemplate): void {
    const exists = this.templateIndex().has(template.id);
    if (!exists) {
      void this.loadFromApi(true);
      return;
    }
    this.replaceTemplate(template);
  }

  private removeTemplateFromStore(templateId: string): void {
    this._templates.update((entries) =>
      entries.filter((entry) => entry.id !== templateId),
    );
  }

  setFilters(patch: Partial<ScheduleTemplateFilters>) {
    this._filters.update((current) => ({ ...current, ...patch }));
  }

  resetFilters() {
    this._filters.set({
      search: '',
      status: 'all',
      category: 'all',
      day: 'all',
      tag: 'all',
    });
  }

  setSort(sort: ScheduleTemplateSort) {
    this._sort.set(sort);
  }

  getById(id: string): ScheduleTemplate | undefined {
    return this.templateIndex().get(id);
  }

  async loadFromApi(force = false): Promise<void> {
    if (this.loading() && !force) {
      return;
    }
    this.loading.set(true);
    try {
      const templates = await this.fetchAllTemplates();
      this._templates.set(templates);
    } catch (error) {
      console.warn(
        '[ScheduleTemplateService] Failed to load templates from backend',
        error,
      );
    } finally {
      this.loading.set(false);
    }
  }

  async createTemplate(
    payload: CreateScheduleTemplatePayload,
  ): Promise<ScheduleTemplate> {
    const created = await firstValueFrom(this.api.createTemplate(payload));
    this.replaceTemplate(created, true);
    return created;
  }

  async updateTemplateFromPayload(
    templateId: string,
    payload: CreateScheduleTemplatePayload,
  ): Promise<ScheduleTemplate | undefined> {
    const updated = await firstValueFrom(
      this.api.updateTemplate(templateId, payload),
    );
    this.replaceTemplate(updated);
    return updated;
  }

  async updateTemplate(
    templateId: string,
    patch: Partial<Omit<ScheduleTemplate, 'id' | 'createdAt'>>,
  ): Promise<void> {
    const payload = this.toUpdatePayload(patch);
    if (!Object.keys(payload).length) {
      return;
    }
    this._templates.update((templates) =>
      templates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : template,
      ),
    );
    try {
      const updated = await firstValueFrom(
        this.api.updateTemplate(templateId, payload),
      );
      this.replaceTemplate(updated);
    } catch (error) {
      console.warn('[ScheduleTemplateService] Failed to update template', error);
    }
  }

  stopsWithTimeline(template: ScheduleTemplate) {
    return template.stops.map((stop) => ({
      ...stop,
      arrivalLabel: this.windowLabel(stop.arrival),
      departureLabel: this.windowLabel(stop.departure),
    }));
  }

  private async fetchAllTemplates(): Promise<ScheduleTemplate[]> {
    const templates: ScheduleTemplate[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await firstValueFrom(
        this.api.searchTemplates({ page, pageSize: 200 }),
      );
      templates.push(...(response.templates ?? []));
      hasMore = response.hasMore;
      page += 1;
      if (!response.pageSize) {
        break;
      }
    }
    return templates;
  }

  private replaceTemplate(template: ScheduleTemplate, prepend = false): void {
    this._templates.update((templates) => {
      const index = templates.findIndex((entry) => entry.id === template.id);
      if (index === -1) {
        return prepend ? [template, ...templates] : [...templates, template];
      }
      const next = [...templates];
      next[index] = template;
      return next;
    });
  }

  private toUpdatePayload(
    patch: Partial<Omit<ScheduleTemplate, 'id' | 'createdAt'>>,
  ): Partial<CreateScheduleTemplatePayload> {
    const payload: Partial<CreateScheduleTemplatePayload> = {};
    if (patch.title !== undefined) {
      payload.title = patch.title;
    }
    if (patch.description !== undefined) {
      payload.description = patch.description;
    }
    if (patch.trainNumber !== undefined) {
      payload.trainNumber = patch.trainNumber;
    }
    if (patch.responsibleRu !== undefined) {
      payload.responsibleRu = patch.responsibleRu;
    }
    if (patch.status !== undefined) {
      payload.status = patch.status;
    }
    if (patch.category !== undefined) {
      payload.category = patch.category;
    }
    if (patch.tags !== undefined) {
      payload.tags = this.normalizeTags(patch.tags);
    }
    if (patch.validity) {
      payload.startDate = patch.validity.startDate;
      payload.endDate = patch.validity.endDate ?? null;
    }
    if (patch.recurrence !== undefined) {
      payload.recurrence = patch.recurrence;
    }
    if (patch.stops !== undefined) {
      payload.stops = patch.stops.map((stop) => this.toStopPayload(stop));
    }
    if (patch.composition !== undefined) {
      payload.composition = patch.composition;
    }
    return payload;
  }

  private toStopPayload(
    stop: ScheduleTemplateStop,
  ): CreateScheduleTemplateStopPayload {
    return {
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode,
      arrivalEarliest: stop.arrival?.earliest,
      arrivalLatest: stop.arrival?.latest,
      departureEarliest: stop.departure?.earliest,
      departureLatest: stop.departure?.latest,
      offsetDays: stop.offsetDays,
      dwellMinutes: stop.dwellMinutes,
      activities: stop.activities ?? [],
      platformWish: stop.platformWish,
      notes: stop.notes,
    };
  }

  private normalizeTags(tags?: string[]): string[] | undefined {
    if (!tags?.length) {
      return undefined;
    }
    const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
    return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
  }

  private windowLabel(
    window: ScheduleTemplateStop['arrival'],
  ): string | undefined {
    if (!window || (!window.earliest && !window.latest)) {
      return undefined;
    }
    if (window.earliest && window.latest) {
      if (window.earliest === window.latest) {
        return window.earliest;
      }
      return `${window.earliest} – ${window.latest}`;
    }
    return window.earliest ?? window.latest;
  }

  private sortTemplates(
    a: ScheduleTemplate,
    b: ScheduleTemplate,
    sort: ScheduleTemplateSort,
  ): number {
    const direction = sort.direction === 'asc' ? 1 : -1;
    switch (sort.field) {
      case 'updatedAt':
        return (
          (new Date(a.updatedAt).getTime() -
            new Date(b.updatedAt).getTime()) *
          direction
        );
      case 'title':
        return (
          a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }) *
          direction
        );
      case 'trainNumber':
        return (
          a.trainNumber.localeCompare(b.trainNumber, 'de', {
            sensitivity: 'base',
          }) * direction
        );
      case 'status': {
        const order: Record<ScheduleTemplateStatus, number> = {
          active: 0,
          draft: 1,
          archived: 2,
        };
        return (order[a.status] - order[b.status]) * direction;
      }
    }
  }

  private createStopFromPayload(
    templateId: string,
    index: number,
    payload: CreateScheduleTemplateStopPayload,
  ): ScheduleTemplateStop {
    return {
      id: `${templateId}-ST-${String(index + 1).padStart(3, '0')}`,
      sequence: index + 1,
      type: payload.type,
      locationCode: payload.locationCode,
      locationName: payload.locationName,
      countryCode: payload.countryCode,
      arrival:
        payload.arrivalEarliest || payload.arrivalLatest
          ? {
              earliest: payload.arrivalEarliest,
              latest: payload.arrivalLatest,
            }
          : undefined,
      departure:
        payload.departureEarliest || payload.departureLatest
          ? {
              earliest: payload.departureEarliest,
              latest: payload.departureLatest,
            }
          : undefined,
      offsetDays: payload.offsetDays,
      dwellMinutes: payload.dwellMinutes,
      activities: payload.activities,
      platformWish: payload.platformWish,
      notes: payload.notes,
    };
  }

  private toMinutes(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const [h, m] = value.split(':').map((part) => Number.parseInt(part, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) {
      return undefined;
    }
    return h * 60 + m;
  }

  private fromMinutes(value: number): string {
    const h = Math.floor(value / 60)
      .toString()
      .padStart(2, '0');
    const m = Math.floor(value % 60)
      .toString()
      .padStart(2, '0');
    return `${h}:${m}`;
  }

}
