import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  TrafficPeriod,
  TrafficPeriodType,
  TrafficPeriodVariantType,
  TrafficPeriodVariantScope,
} from '../models/traffic-period.model';
import { TrafficPeriodApiService } from '../api/traffic-period-api.service';

export interface TrafficPeriodFilters {
  search: string;
  type: TrafficPeriodType | 'all';
  tag: string | 'all';
}

export interface TrafficPeriodSort {
  field: 'updatedAt' | 'name';
  direction: 'asc' | 'desc';
}

export interface TrafficPeriodCreatePayload {
  name: string;
  type: TrafficPeriodType;
  description?: string;
  responsible?: string;
  tags?: string[];
  year: number;
  rules: TrafficPeriodRulePayload[];
  timetableYearLabel?: string;
}

export interface TrafficPeriodRulePayload {
  id?: string;
  name: string;
  year: number;
  selectedDates: string[];
  excludedDates?: string[];
  variantType?: TrafficPeriodVariantType;
  variantNumber?: string;
  appliesTo?: TrafficPeriodVariantScope;
  reason?: string;
  primary?: boolean;
}

export interface TrafficPeriodVariantPayload {
  name?: string;
  dates: string[];
  variantType?: TrafficPeriodVariantType;
  appliesTo?: TrafficPeriodVariantScope;
  reason?: string;
}

export interface RailMlTrafficPeriodPayload {
  sourceId: string;
  name: string;
  description?: string;
  daysBitmap: string;
  validityStart: string;
  validityEnd: string;
  type?: TrafficPeriodType;
  scope?: TrafficPeriodVariantScope;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class TrafficPeriodService {
  private readonly api = inject(TrafficPeriodApiService);
  private readonly _periods = signal<TrafficPeriod[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly _filters = signal<TrafficPeriodFilters>({
    search: '',
    type: 'all',
    tag: 'all',
  });
  private readonly _sort = signal<TrafficPeriodSort>({
    field: 'updatedAt',
    direction: 'desc',
  });
  private readonly periodIndex = computed(() => {
    const entries = this._periods().map((period) => [period.id, period] as const);
    return new Map<string, TrafficPeriod>(entries);
  });
  readonly periods = computed(() => this._periods());
  readonly filters = computed(() => this._filters());
  readonly sort = computed(() => this._sort());
  readonly loading = computed(() => this.loadingSignal());
  readonly error = computed(() => this.errorSignal());

  readonly tags = computed(() =>
    Array.from(
      new Set(
        this._periods().flatMap((period) => period.tags ?? []),
      ),
    ).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })),
  );

  readonly filteredPeriods = computed(() => {
    const filters = this._filters();
    const sort = this._sort();
    const search = filters.search.toLowerCase();

    return this._periods()
      .filter((period) => {
        if (search) {
          const haystack = `${period.name} ${period.description ?? ''} ${
            period.responsible ?? ''
          } ${period.tags?.join(' ') ?? ''}`.toLowerCase();
          if (!haystack.includes(search)) {
            return false;
          }
        }
        if (filters.type !== 'all' && period.type !== filters.type) {
          return false;
        }
        if (filters.tag !== 'all' && !(period.tags?.includes(filters.tag) ?? false)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => this.sortPeriods(a, b, sort));
  });

  constructor() {
    void this.loadFromApi();
  }

  async refresh(): Promise<void> {
    await this.loadFromApi(true);
  }

  private async loadFromApi(force = false): Promise<void> {
    if (this.loadingSignal() && !force) {
      return;
    }
    this.loadingSignal.set(true);
    try {
      const periods = await firstValueFrom(this.api.listPeriods());
      this._periods.set(periods ?? []);
      this.errorSignal.set(null);
    } catch (error) {
      console.warn('[TrafficPeriodService] Failed to load traffic periods', error);
      this.errorSignal.set('Kalender konnten nicht geladen werden.');
    } finally {
      this.loadingSignal.set(false);
    }
  }

  setFilters(patch: Partial<TrafficPeriodFilters>) {
    this._filters.update((current) => ({ ...current, ...patch }));
  }

  resetFilters() {
    this._filters.set({ search: '', type: 'all', tag: 'all' });
  }

  setSort(sort: TrafficPeriodSort) {
    this._sort.set(sort);
  }

  getById(id: string): TrafficPeriod | undefined {
    return this.periodIndex().get(id);
  }

  private sortPeriods(
    a: TrafficPeriod,
    b: TrafficPeriod,
    sort: TrafficPeriodSort,
  ): number {
    const direction = sort.direction === 'asc' ? 1 : -1;
    switch (sort.field) {
      case 'name':
        return (
          a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }) *
          direction
        );
      case 'updatedAt':
      default:
        return (
          (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) *
          direction
        );
    }
  }

  async createPeriod(payload: TrafficPeriodCreatePayload): Promise<string> {
    try {
      const period = await firstValueFrom(this.api.createFromPayload(payload));
      this.applyPeriod(period);
      return period.id;
    } catch (error) {
      console.warn('[TrafficPeriodService] Failed to create period', error);
      return '';
    }
  }

  async createSingleDayPeriod(options: {
    name: string;
    date: string;
    type?: TrafficPeriodType;
    appliesTo?: TrafficPeriodVariantScope;
    variantType?: TrafficPeriodVariantType;
    tags?: string[];
    description?: string;
    responsible?: string;
  }): Promise<string> {
    try {
      const period = await firstValueFrom(this.api.createSingleDay(options));
      this.applyPeriod(period);
      return period.id;
    } catch (error) {
      console.warn('[TrafficPeriodService] Failed to create single-day period', error);
      return '';
    }
  }

  async updatePeriod(periodId: string, payload: TrafficPeriodCreatePayload): Promise<void> {
    const trimmed = periodId?.trim();
    if (!trimmed) {
      return;
    }
    try {
      const period = await firstValueFrom(this.api.updateFromPayload(trimmed, payload));
      this.applyPeriod(period);
    } catch (error) {
      console.warn('[TrafficPeriodService] Failed to update period', error);
    }
  }

  async ensureRailMlPeriod(payload: RailMlTrafficPeriodPayload): Promise<TrafficPeriod> {
    const sourceTag = `railml:${payload.sourceId}`;
    const existing = this._periods().find((period) =>
      period.tags?.includes(sourceTag),
    );
    if (existing) {
      return existing;
    }
    const period = await firstValueFrom(this.api.ensureRailMlPeriod(payload));
    this.applyPeriod(period);
    return period;
  }

  async deletePeriod(periodId: string): Promise<void> {
    this._periods.update((periods) =>
      periods.filter((period) => period.id !== periodId),
    );
    const trimmed = periodId?.trim();
    if (!trimmed) {
      return;
    }
    try {
      await firstValueFrom(this.api.deletePeriod(trimmed));
    } catch (error) {
      console.warn('[TrafficPeriodService] Failed to delete period', error);
    }
  }

  async addExclusionDates(periodId: string, dates: string[]): Promise<void> {
    const trimmed = periodId?.trim();
    if (!trimmed) {
      return;
    }
    try {
      const period = await firstValueFrom(this.api.addExclusionDates(trimmed, dates));
      this.applyPeriod(period);
    } catch (error) {
      console.warn('[TrafficPeriodService] Failed to update exclusions', error);
    }
  }

  async addVariantRule(
    periodId: string,
    options: TrafficPeriodVariantPayload,
  ): Promise<void> {
    const trimmed = periodId?.trim();
    if (!trimmed) {
      return;
    }
    try {
      const period = await firstValueFrom(this.api.addVariantRule(trimmed, options));
      this.applyPeriod(period);
    } catch (error) {
      console.warn('[TrafficPeriodService] Failed to add variant rule', error);
    }
  }

  private applyPeriod(period: TrafficPeriod): void {
    const exists = this.periodIndex().has(period.id);
    if (!exists) {
      this._periods.update((periods) => [period, ...periods]);
      return;
    }
    this._periods.update((periods) =>
      periods.map((entry) => (entry.id === period.id ? period : entry)),
    );
  }
}
