import { Injectable, computed, inject, signal } from '@angular/core';
import {
  TrafficPeriod,
  TrafficPeriodRule,
  TrafficPeriodType,
  TrafficPeriodVariantType,
  TrafficPeriodVariantScope,
} from '../models/traffic-period.model';
import { MOCK_TRAFFIC_PERIODS } from '../mock/mock-traffic-periods.mock';
import { TimetableYearBounds } from '../models/timetable-year.model';
import { TimetableYearService } from './timetable-year.service';

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
  variantType: TrafficPeriodVariantType;
  variantNumber: string;
  appliesTo: TrafficPeriodVariantScope;
  reason?: string;
  primary?: boolean;
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
  private readonly timetableYear = inject(TimetableYearService);
  private readonly _periods = signal<TrafficPeriod[]>(MOCK_TRAFFIC_PERIODS);
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
  private idCounter = 0;

  readonly periods = computed(() => this._periods());
  readonly filters = computed(() => this._filters());
  readonly sort = computed(() => this._sort());

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

  createPeriod(payload: TrafficPeriodCreatePayload): string {
    const filteredRules = payload.rules.filter((rule) => rule.selectedDates.length);
    if (!filteredRules.length) {
      return '';
    }

    const yearInfo = this.resolveTimetableYear(filteredRules, payload.timetableYearLabel);
    const now = new Date().toISOString();
    const id = this.generateId();
    const tags = new Set(this.normalizeTags(payload.tags) ?? []);
    tags.add(`timetable-year:${yearInfo.label}`);

    const period: TrafficPeriod = {
      id,
      name: payload.name,
      type: payload.type,
      description: payload.description,
      responsible: payload.responsible,
      timetableYearLabel: yearInfo.label,
      createdAt: now,
      updatedAt: now,
      tags: Array.from(tags),
      rules: this.buildRulesFromPayload(id, filteredRules, undefined, yearInfo),
    };

    this._periods.update((periods) => [period, ...periods]);
    return id;
  }

  createSingleDayPeriod(options: {
    name: string;
    date: string;
    type?: TrafficPeriodType;
    appliesTo?: TrafficPeriodVariantScope;
    variantType?: TrafficPeriodVariantType;
    tags?: string[];
    description?: string;
    responsible?: string;
  }): string {
    const isoDate = options.date.slice(0, 10);
    const yearInfo = this.timetableYear.getYearBounds(isoDate);
    return this.createPeriod({
      name: options.name,
      description: options.description,
      responsible: options.responsible,
      type: options.type ?? 'standard',
      year: yearInfo.startYear,
      timetableYearLabel: yearInfo.label,
      tags: options.tags,
      rules: [
        {
          name: `${options.name} ${isoDate}`,
          year: yearInfo.startYear,
          selectedDates: [isoDate],
          variantType: options.variantType ?? 'special_day',
          appliesTo: options.appliesTo ?? 'both',
          variantNumber: '00',
          primary: true,
        },
      ],
    });
  }

  updatePeriod(periodId: string, payload: TrafficPeriodCreatePayload) {
    const filteredRules = payload.rules.filter((rule) => rule.selectedDates.length);
    if (!filteredRules.length) {
      return;
    }

    const existing = this.getById(periodId);
    if (!existing) {
      return;
    }
    const yearInfo = this.resolveTimetableYear(
      filteredRules,
      payload.timetableYearLabel ?? existing.timetableYearLabel,
    );
    const tags = new Set(this.normalizeTags(payload.tags) ?? []);
    tags.add(`timetable-year:${yearInfo.label}`);

    this._periods.update((periods) =>
      periods.map((period) => {
        if (period.id !== periodId) {
          return period;
        }

        return {
          ...period,
          name: payload.name,
          type: payload.type,
          description: payload.description,
          responsible: payload.responsible,
          timetableYearLabel: yearInfo.label,
          tags: Array.from(tags),
          updatedAt: new Date().toISOString(),
          rules: this.buildRulesFromPayload(periodId, filteredRules, period.rules, yearInfo),
        } satisfies TrafficPeriod;
      }),
    );
  }

  ensureRailMlPeriod(payload: RailMlTrafficPeriodPayload): TrafficPeriod {
    const sourceTag = `railml:${payload.sourceId}`;
    const existing = this._periods().find((period) =>
      period.tags?.includes(sourceTag),
    );
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const id = this.generateId();
    const ruleId = `${id}-R1`;
    const normalizedBitmap = this.normalizeDaysBitmap(payload.daysBitmap);
    const dateSamples =
      this.expandDates(
        payload.validityStart,
        payload.validityEnd,
        normalizedBitmap,
      ) ?? [payload.validityStart.slice(0, 10)];
    const yearInfo = this.timetableYear.ensureDatesWithinSameYear(dateSamples);
    const rule: TrafficPeriodRule = {
      id: ruleId,
      name: `RailML ${payload.sourceId}`,
      daysBitmap: normalizedBitmap,
      validityStart: dateSamples[0],
      validityEnd: dateSamples[dateSamples.length - 1],
      includesDates: dateSamples,
      variantType: 'series',
      appliesTo: payload.scope ?? 'commercial',
      reason: payload.reason ?? payload.description,
      primary: true,
    };

    const period: TrafficPeriod = {
      id,
      name: payload.name,
      type: payload.type ?? 'standard',
      description: payload.description,
      responsible: 'RailML Import',
      timetableYearLabel: yearInfo.label,
      createdAt: now,
      updatedAt: now,
      rules: [rule],
      tags: ['railml', sourceTag, `timetable-year:${yearInfo.label}`],
    };

    this._periods.update((periods) => [period, ...periods]);
    return period;
  }

  deletePeriod(periodId: string) {
    this._periods.update((periods) =>
      periods.filter((period) => period.id !== periodId),
    );
  }

  private generateId(): string {
    const ts = Date.now().toString(36).toUpperCase();
    this.idCounter = (this.idCounter + 1) % 1679616; // 36^4 combinations
    const suffix = this.idCounter.toString(36).toUpperCase().padStart(4, '0');
    return `TPER-${ts}${suffix}`;
  }

  private normalizeDaysBitmap(value: string): string {
    const sanitized = value
      .padEnd(7, '1')
      .slice(0, 7)
      .split('')
      .map((char) => (char === '1' ? '1' : '0'))
      .join('');
    return sanitized.length === 7 ? sanitized : '1111111';
  }

  private expandDates(
    startIso: string,
    endIso: string,
    daysBitmap: string,
  ): string[] | undefined {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return undefined;
    }
    const normalizedBitmap = this.normalizeDaysBitmap(daysBitmap);
    const dates: string[] = [];
    for (
      let cursor = new Date(start);
      cursor <= end && dates.length <= 1460;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const weekday = cursor.getDay();
      const bitmapIndex = weekday === 0 ? 6 : weekday - 1;
      if (normalizedBitmap[bitmapIndex] === '1') {
        dates.push(cursor.toISOString().slice(0, 10));
      }
    }
    return dates.length ? dates : undefined;
  }

  private normalizeTags(tags?: string[]): string[] | undefined {
    if (!tags?.length) {
      return undefined;
    }
    return Array.from(new Set(tags.filter((tag) => tag.trim().length))).map((tag) =>
      tag.trim(),
    );
  }

  private buildRulesFromPayload(
    periodId: string,
    rulePayloads: TrafficPeriodRulePayload[],
    existingRules: TrafficPeriodRule[] = [],
    yearBounds?: TimetableYearBounds,
  ): TrafficPeriodRule[] {
    return rulePayloads.map((payload, index) => {
      const sortedSelectedDates = [...new Set(payload.selectedDates)].sort();
      const sortedExcludedDates = payload.excludedDates?.length
        ? [...new Set(payload.excludedDates)].sort()
        : undefined;
      const existingRule = payload.id
        ? existingRules.find((rule) => rule.id === payload.id)
        : undefined;
      const ruleId = payload.id ?? existingRule?.id ?? `${periodId}-R${index + 1}`;
      const defaultStart = yearBounds?.startIso ?? `${payload.year}-01-01`;
      const defaultEnd = yearBounds?.endIso ?? defaultStart;
      const validityStart = sortedSelectedDates[0] ?? defaultStart;
      const validityEnd =
        sortedSelectedDates[sortedSelectedDates.length - 1] ?? defaultEnd;
      if (yearBounds) {
        sortedSelectedDates.forEach((date) => {
          if (!this.timetableYear.isDateWithinYear(date, yearBounds)) {
            throw new Error(
              `Kalender "${payload.name}" enthält den Fahrtag ${date}, der nicht zum Fahrplanjahr ${yearBounds.label} gehört.`,
            );
          }
        });
      }
      return {
        id: ruleId,
        name: payload.name?.trim() || `Kalender ${payload.year}`,
        daysBitmap: this.buildDaysBitmapFromDates(sortedSelectedDates),
        validityStart,
        validityEnd,
        includesDates: sortedSelectedDates,
        excludesDates: sortedExcludedDates,
        variantType: payload.variantType,
        appliesTo: payload.appliesTo,
        variantNumber: payload.variantNumber || '00',
        reason: payload.reason,
        primary: payload.primary ?? index === 0,
      } satisfies TrafficPeriodRule;
    });
  }

  addExclusionDates(periodId: string, dates: string[]): void {
    const period = this.getById(periodId);
    if (!period || !dates.length) {
      return;
    }
    const normalized = Array.from(
      new Set(
        dates
          .map((date) => date?.trim())
          .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ),
    ).sort();
    if (!normalized.length) {
      return;
    }
    this._periods.update((periods) =>
      periods.map((candidate) => {
        if (candidate.id !== periodId) {
          return candidate;
        }
        const rules = candidate.rules.map((rule, index) => {
          if (!rule.primary && index !== 0) {
            return rule;
          }
          const excludes = new Set(rule.excludesDates ?? []);
          normalized.forEach((date) => excludes.add(date));
          return { ...rule, excludesDates: Array.from(excludes).sort() };
        });
        return {
          ...candidate,
          rules,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  }

  addVariantRule(
    periodId: string,
    options: {
      name?: string;
      dates: string[];
      variantType?: TrafficPeriodVariantType;
      appliesTo?: TrafficPeriodVariantScope;
      reason?: string;
    },
  ): void {
    const period = this.getById(periodId);
    if (!period) {
      return;
    }
    const normalized = Array.from(
      new Set(
        options.dates
          .map((date) => date?.trim())
          .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)),
      ),
    ).sort();
    if (!normalized.length) {
      return;
    }
    const yearInfo = period.timetableYearLabel
      ? this.timetableYear.getYearByLabel(period.timetableYearLabel)
      : this.timetableYear.ensureDatesWithinSameYear(normalized);

    normalized.forEach((date) => {
      if (!this.timetableYear.isDateWithinYear(date, yearInfo)) {
        throw new Error(
          `Kalender "${options.name ?? 'Variante'}" enthält den Fahrtag ${date}, der nicht zum Fahrplanjahr ${yearInfo.label} gehört.`,
        );
      }
    });

    const rule: TrafficPeriodRule = {
      id: `${periodId}-VAR-${Date.now().toString(36)}`,
      name: options.name?.trim() || `Variante ${period.rules.length + 1}`,
      daysBitmap: this.buildDaysBitmapFromDates(normalized),
      validityStart: normalized[0],
      validityEnd: normalized[normalized.length - 1],
      includesDates: normalized,
      variantType: options.variantType ?? 'special_day',
      appliesTo: options.appliesTo ?? 'both',
      variantNumber: this.nextVariantNumber(period),
      reason: options.reason,
      primary: false,
    };

    this._periods.update((periods) =>
      periods.map((entry) =>
        entry.id === periodId
          ? {
              ...entry,
              rules: [...entry.rules, rule],
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );
  }

  private resolveTimetableYear(
    rules: TrafficPeriodRulePayload[],
    explicitLabel?: string,
  ): TimetableYearBounds {
    if (explicitLabel) {
      return this.timetableYear.getYearByLabel(explicitLabel);
    }
    const dates = rules.flatMap((rule) => rule.selectedDates ?? []);
    if (dates.length) {
      return this.timetableYear.ensureDatesWithinSameYear(dates);
    }
    const fallbackYear = rules[0]?.year ?? new Date().getFullYear();
    return this.timetableYear.getYearBounds(new Date(fallbackYear, 5, 15));
  }

  private buildDaysBitmapFromDates(dates: string[]): string {
    if (!dates.length) {
      return '1111111';
    }
    const bits = Array(7).fill('0');
    dates.forEach((iso) => {
      const date = new Date(`${iso}T00:00:00`);
      const weekday = date.getDay();
      const index = weekday === 0 ? 6 : weekday - 1;
      bits[index] = '1';
    });
    return bits.join('');
  }

  private nextVariantNumber(period: TrafficPeriod): string {
    const numericValues = period.rules
      .map((rule) => Number.parseInt(rule.variantNumber ?? '', 10))
      .filter((value) => Number.isFinite(value));
    const next = numericValues.length ? Math.max(...numericValues) + 1 : 1;
    return next.toString().padStart(2, '0');
  }
}
