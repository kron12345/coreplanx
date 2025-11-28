import { Injectable, computed, signal } from '@angular/core';
import {
  ScheduleTemplate,
  ScheduleTemplateCategory,
  ScheduleTemplateDay,
  ScheduleTemplateStatus,
  ScheduleTemplateStop,
} from '../models/schedule-template.model';
import { MOCK_SCHEDULE_TEMPLATES } from '../mock/mock-schedule-templates.mock';

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
  startDate: Date;
  endDate?: Date | null;
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
  private readonly _templates = signal<ScheduleTemplate[]>(
    MOCK_SCHEDULE_TEMPLATES,
  );
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

  constructor() {}

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

  createTemplate(payload: CreateScheduleTemplatePayload): ScheduleTemplate {
    const id = this.generateTemplateId();
    const now = new Date().toISOString();
    const stops = payload.stops.map((stop, index) =>
      this.createStopFromPayload(id, index, stop),
    );
    const template: ScheduleTemplate = {
      id,
      title: payload.title,
      description: payload.description,
      trainNumber: payload.trainNumber,
      responsibleRu: payload.responsibleRu,
      category: payload.category,
      status: payload.status,
      tags: payload.tags?.length ? Array.from(new Set(payload.tags)) : undefined,
      validity: {
        startDate: payload.startDate.toISOString().slice(0, 10),
        endDate: payload.endDate
          ? payload.endDate.toISOString().slice(0, 10)
          : undefined,
      },
      createdAt: now,
      updatedAt: now,
      recurrence: undefined,
      stops,
      composition: payload.composition,
    };

    this._templates.update((templates) => [template, ...templates]);
    return template;
  }

  updateTemplateFromPayload(templateId: string, payload: CreateScheduleTemplatePayload): void {
    const stops = payload.stops.map((stop, index) =>
      this.createStopFromPayload(templateId, index, stop),
    );
    this.updateTemplate(templateId, {
      title: payload.title,
      description: payload.description,
      trainNumber: payload.trainNumber,
      responsibleRu: payload.responsibleRu,
      category: payload.category,
      status: payload.status,
      tags: payload.tags?.length ? Array.from(new Set(payload.tags)) : undefined,
      validity: {
        startDate: payload.startDate.toISOString().slice(0, 10),
        endDate: payload.endDate ? payload.endDate.toISOString().slice(0, 10) : undefined,
      },
      recurrence: undefined,
      stops,
      composition: payload.composition,
    });
  }

  updateTemplate(
    templateId: string,
    patch: Partial<Omit<ScheduleTemplate, 'id' | 'createdAt'>>,
  ) {
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
  }

  stopsWithTimeline(template: ScheduleTemplate) {
    return template.stops.map((stop) => ({
      ...stop,
      arrivalLabel: this.windowLabel(stop.arrival),
      departureLabel: this.windowLabel(stop.departure),
    }));
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

  private generateTemplateId(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    return `TPL-${timestamp}`;
  }
}
