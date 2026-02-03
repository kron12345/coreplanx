import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  TrainPlan,
  TrainPlanCalendar,
  TrainPlanSourceType,
  TrainPlanStatus,
  TrainPlanStop,
  TrainPlanTechnicalData,
  TrainPlanRouteMetadata,
} from '../models/train-plan.model';
import { TrainPlanApiService } from '../api/train-plan-api.service';
import { CreateScheduleTemplateStopPayload } from './schedule-template.service';
import type { TimetableRollingStock } from '../models/timetable.model';
import type { ScheduleTemplate } from '../models/schedule-template.model';

export interface TrainPlanFilters {
  search: string;
  status: TrainPlanStatus | 'all';
  source: TrainPlanSourceType | 'all';
  responsibleRu: string | 'all';
}

export interface TrainPlanSort {
  field: 'updatedAt' | 'trainNumber' | 'status' | 'title';
  direction: 'asc' | 'desc';
}

export interface CreatePlansFromTemplatePayload {
  templateId: string;
  startTime: string; // HH:mm
  intervalMinutes: number;
  departuresPerDay: number;
  trafficPeriodId?: string;
  calendarDates?: string[];
  responsibleRu?: string;
  trainNumberStart?: number;
  trainNumberInterval?: number;
  composition?: ScheduleTemplate['composition'];
  planVariantType?: 'productive' | 'simulation';
  variantOfPlanId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface CreateManualPlanPayload {
  title: string;
  trainNumber: string;
  responsibleRu: string;
  departure: string; // ISO datetime
  stops: CreateScheduleTemplateStopPayload[];
  sourceName?: string;
  notes?: string;
  templateId?: string;
  trafficPeriodId?: string;
  validFrom?: string;
  validTo?: string;
  daysBitmap?: string;
  composition?: ScheduleTemplate['composition'];
  planVariantType?: 'productive' | 'simulation';
  variantOfPlanId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface CreatePlanModificationPayload {
  originalPlanId: string;
  title: string;
  trainNumber: string;
  responsibleRu: string;
  calendar: TrainPlanCalendar;
  trafficPeriodId?: string;
  notes?: string;
  stops?: PlanModificationStopInput[];
  rollingStock?: TimetableRollingStock;
  technical?: TrainPlanTechnicalData;
  routeMetadata?: TrainPlanRouteMetadata;
  planVariantType?: 'productive' | 'simulation';
  variantOfPlanId?: string;
  variantLabel?: string;
  simulationId?: string;
  simulationLabel?: string;
}

export interface CreatePlanVariantPayload {
  originalPlanId: string;
  type: 'productive' | 'simulation';
  label?: string;
}

export interface PlanModificationStopInput {
  sequence: number;
  type: TrainPlanStop['type'];
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrivalTime?: string;
  departureTime?: string;
  arrivalOffsetDays?: number;
  departureOffsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platform?: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class TrainPlanService {
  private readonly api = inject(TrainPlanApiService);
  private readonly _plans = signal<TrainPlan[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly _filters = signal<TrainPlanFilters>({
    search: '',
    status: 'all',
    source: 'all',
    responsibleRu: 'all',
  });
  private readonly _sort = signal<TrainPlanSort>({
    field: 'updatedAt',
    direction: 'desc',
  });
  private readonly planIndex = computed(() => {
    const entries = this._plans().map((plan) => [plan.id, plan] as const);
    return new Map<string, TrainPlan>(entries);
  });

  readonly plans = computed(() => this._plans());
  readonly filters = computed(() => this._filters());
  readonly sort = computed(() => this._sort());
  readonly loading = computed(() => this.loadingSignal());
  readonly error = computed(() => this.errorSignal());

  readonly responsibleRus = computed(() =>
    Array.from(
      new Set(this._plans().map((plan) => plan.responsibleRu)),
    ).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })),
  );

  readonly filteredPlans = computed(() => {
    const filters = this._filters();
    const sort = this._sort();
    const search = filters.search.toLowerCase();

    return this._plans()
      .filter((plan) => {
        if (search) {
          const haystack = `${plan.title} ${plan.trainNumber} ${plan.responsibleRu} ${
            plan.source.name
          } ${plan.notes ?? ''}`.toLowerCase();
          if (!haystack.includes(search)) {
            return false;
          }
        }
        if (filters.status !== 'all' && plan.status !== filters.status) {
          return false;
        }
        if (filters.source !== 'all' && plan.source.type !== filters.source) {
          return false;
        }
        if (
          filters.responsibleRu !== 'all' &&
          plan.responsibleRu !== filters.responsibleRu
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => this.sortPlans(a, b, sort));
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
      const plans = await firstValueFrom(this.api.listPlans());
      this._plans.set(plans ?? []);
      this.errorSignal.set(null);
    } catch (error) {
      console.warn('[TrainPlanService] Failed to load plans', error);
      this.errorSignal.set('Fahrpläne konnten nicht geladen werden.');
    } finally {
      this.loadingSignal.set(false);
    }
  }

  setFilters(patch: Partial<TrainPlanFilters>) {
    this._filters.update((current) => ({ ...current, ...patch }));
  }

  resetFilters() {
    this._filters.set({
      search: '',
      status: 'all',
      source: 'all',
      responsibleRu: 'all',
    });
  }

  setSort(sort: TrainPlanSort) {
    this._sort.set(sort);
  }

  linkOrderItem(planId: string, itemId: string) {
    this._plans.update((plans) =>
      plans.map((plan) =>
        plan.id === planId ? { ...plan, linkedOrderItemId: itemId } : plan,
      ),
    );
    const updated = this.getById(planId);
    if (updated) {
      void this.persistPlan(updated);
    }
  }

  unlinkOrderItem(planId: string) {
    this._plans.update((plans) =>
      plans.map((plan) =>
        plan.id === planId ? { ...plan, linkedOrderItemId: undefined } : plan,
      ),
    );
    const updated = this.getById(planId);
    if (updated) {
      void this.persistPlan(updated);
    }
  }

  assignTrafficPeriod(planId: string, trafficPeriodId: string): TrainPlan | undefined {
    let updatedPlan: TrainPlan | undefined;
    this._plans.update((plans) =>
      plans.map((plan) => {
        if (plan.id !== planId) {
          return plan;
        }
        updatedPlan = { ...plan, trafficPeriodId };
        return updatedPlan;
      }),
    );
    if (updatedPlan) {
      void this.persistPlan(updatedPlan);
    }
    return updatedPlan;
  }

  async createPlansFromTemplate(
    payload: CreatePlansFromTemplatePayload,
  ): Promise<TrainPlan[]> {
    try {
      const plans = await firstValueFrom(this.api.createFromTemplate(payload));
      this._plans.update((existing) => [...plans, ...existing]);
      await this.loadFromApi(true);
      return plans;
    } catch (error) {
      console.warn('[TrainPlanService] Failed to create plans from template', error);
      throw error instanceof Error ? error : new Error('Fahrpläne konnten nicht erstellt werden.');
    }
  }

  async createManualPlan(payload: CreateManualPlanPayload): Promise<TrainPlan> {
    try {
      const plan = await firstValueFrom(this.api.createManual(payload));
      this._plans.update((plans) => [plan, ...plans]);
      await this.loadFromApi(true);
      return plan;
    } catch (error) {
      console.warn('[TrainPlanService] Failed to create manual plan', error);
      throw error instanceof Error ? error : new Error('Fahrplan konnte nicht erstellt werden.');
    }
  }

  async createPlanModification(payload: CreatePlanModificationPayload): Promise<TrainPlan> {
    try {
      const plan = await firstValueFrom(this.api.createModification(payload));
      this._plans.update((plans) => [plan, ...plans]);
      await this.loadFromApi(true);
      return plan;
    } catch (error) {
      console.warn('[TrainPlanService] Failed to create plan modification', error);
      throw error instanceof Error ? error : new Error('Fahrplan konnte nicht aktualisiert werden.');
    }
  }

  async createPlanVariant(originalPlanId: string, type: 'productive' | 'simulation', label?: string): Promise<TrainPlan> {
    try {
      const plan = await firstValueFrom(this.api.createVariant({
        originalPlanId,
        type,
        label,
      }));
      this._plans.update((plans) => [plan, ...plans]);
      await this.loadFromApi(true);
      return plan;
    } catch (error) {
      console.warn('[TrainPlanService] Failed to create plan variant', error);
      throw error instanceof Error ? error : new Error('Variante konnte nicht erstellt werden.');
    }
  }

  getById(id: string): TrainPlan | undefined {
    return this.planIndex().get(id);
  }

  async savePlan(plan: TrainPlan): Promise<TrainPlan | null> {
    try {
      const saved = await firstValueFrom(this.api.upsertPlan(plan));
      this._plans.update((plans) => {
        const hasEntry = plans.some((entry) => entry.id === saved.id);
        if (!hasEntry) {
          return [saved, ...plans];
        }
        return plans.map((entry) => (entry.id === saved.id ? saved : entry));
      });
      return saved;
    } catch (error) {
      console.warn('[TrainPlanService] Failed to save plan', error);
      this.errorSignal.set('Fahrplan konnte nicht gespeichert werden.');
      return null;
    }
  }

  private async persistPlans(plans: TrainPlan[]): Promise<void> {
    try {
      await Promise.all(plans.map((plan) => firstValueFrom(this.api.upsertPlan(plan))));
      await this.loadFromApi(true);
    } catch (error) {
      console.warn('[TrainPlanService] Failed to persist plans', error);
    }
  }

  private async persistPlan(plan: TrainPlan): Promise<void> {
    try {
      await firstValueFrom(this.api.upsertPlan(plan));
      await this.loadFromApi(true);
    } catch (error) {
      console.warn('[TrainPlanService] Failed to persist plan', error);
    }
  }

  private sortPlans(a: TrainPlan, b: TrainPlan, sort: TrainPlanSort) {
    const direction = sort.direction === 'asc' ? 1 : -1;
    switch (sort.field) {
      case 'updatedAt':
        return (
          (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) *
          direction
        );
      case 'trainNumber':
        return (
          a.trainNumber.localeCompare(b.trainNumber, 'de', {
            sensitivity: 'base',
          }) * direction
        );
      case 'status': {
        const order: Record<TrainPlanStatus, number> = {
          not_ordered: 0,
          requested: 1,
          offered: 2,
          confirmed: 3,
          operating: 4,
          canceled: 5,
          modification_request: 6,
        };
        return (order[a.status] - order[b.status]) * direction;
      }
      case 'title':
      default:
        return (
          a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }) *
          direction
        );
    }
  }
}
