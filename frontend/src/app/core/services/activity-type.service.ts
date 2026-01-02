import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ResourceKind } from '../../models/resource';
import { PlanningCatalogApiService } from '../api/planning-catalog-api.service';

export type ActivityFieldKey = 'start' | 'end' | 'from' | 'to' | 'remark';
export type ActivityCategory = 'rest' | 'movement' | 'service' | 'other';
export type ActivityTimeMode = 'duration' | 'range' | 'point';

export interface ActivityTypeDefinition {
  id: string;
  label: string;
  description?: string;
  appliesTo: ResourceKind[];
  relevantFor: ResourceKind[];
  category: ActivityCategory;
  timeMode: ActivityTimeMode;
  fields: ActivityFieldKey[];
  defaultDurationMinutes: number;
  attributes?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export interface ActivityTypeInput {
  id: string;
  label: string;
  description?: string;
  appliesTo: ResourceKind[];
  relevantFor?: ResourceKind[];
  category?: ActivityCategory;
  timeMode?: ActivityTimeMode;
  fields: ActivityFieldKey[];
  defaultDurationMinutes: number;
  attributes?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}
@Injectable({ providedIn: 'root' })
export class ActivityTypeService {
  private readonly api = inject(PlanningCatalogApiService);
  private readonly definitionsSignal = signal<ActivityTypeDefinition[]>([]);
  private loadingPromise: Promise<void> | null = null;

  readonly definitions: Signal<ActivityTypeDefinition[]> = computed(
    () => this.definitionsSignal(),
  );

  constructor() {
    void this.init();
  }

  add(input: ActivityTypeInput): void {
    const normalized = this.normalizeDefinition(input);
    this.definitionsSignal.set([...this.definitionsSignal(), normalized]);
    void this.persist();
  }

  update(id: string, patch: Partial<ActivityTypeInput>): void {
    this.definitionsSignal.set(
      this.definitionsSignal().map((definition) => {
        if (definition.id !== id) {
          return definition;
        }
        return this.normalizeDefinition({ ...definition, ...patch });
      }),
    );
    void this.persist();
  }

  remove(id: string): void {
    this.definitionsSignal.set(this.definitionsSignal().filter((definition) => definition.id !== id));
    void this.persist();
  }

  reset(): void {
    void this.resetToDefaults();
  }

  async resetToDefaults(): Promise<void> {
    try {
      const snapshot = await this.api.getCatalogDefaults();
      const list = snapshot.types ?? [];
      this.definitionsSignal.set(list.map((entry) => this.normalizeDefinition(entry)));
      await this.api.replaceTypes(list);
    } catch {
      // Reset-Fehler wird ignoriert, aktueller State bleibt bestehen.
    }
  }

  private normalizeDefinition(input: ActivityTypeInput): ActivityTypeDefinition {
    const fields = Array.from(
      new Set<ActivityFieldKey>(['start', 'end', ...input.fields.filter((field) => field !== 'start' && field !== 'end')]),
    );
    const allowedKinds: ResourceKind[] = ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'];
    const candidateKinds = input.relevantFor && input.relevantFor.length > 0 ? input.relevantFor : input.appliesTo;
    const rawKinds =
      candidateKinds && candidateKinds.length > 0 ? Array.from(new Set(candidateKinds)) : ['personnel', 'vehicle'];
    let relevantFor = rawKinds.filter((kind): kind is ResourceKind => allowedKinds.includes(kind as ResourceKind));
    if (relevantFor.length === 0) {
      relevantFor = ['personnel', 'vehicle'];
    }
    const category: ActivityCategory = this.normalizeCategory(input.category);
    const timeMode: ActivityTimeMode =
      input.timeMode === 'range' ? 'range' : input.timeMode === 'point' ? 'point' : 'duration';
    const defaultDurationMinutes = Math.max(1, Math.trunc(input.defaultDurationMinutes ?? 60));
    const attributes =
      input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes)
        ? input.attributes
        : undefined;
    const meta =
      input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta : undefined;
    return {
      id: this.slugify(input.id || input.label),
      label: input.label.trim(),
      description: input.description?.trim(),
      appliesTo: relevantFor,
      relevantFor,
      category,
      timeMode,
      fields,
      defaultDurationMinutes,
      attributes,
      meta,
    };
  }

  private normalizeCategory(category: ActivityCategory | undefined): ActivityCategory {
    switch (category) {
      case 'rest':
      case 'movement':
      case 'service':
      case 'other':
        return category;
      default:
        return 'other';
    }
  }

  async init(): Promise<void> {
    await this.loadFromApi();
  }

  async refresh(): Promise<void> {
    await this.loadFromApi(true);
  }

  private async loadFromApi(force = false): Promise<void> {
    if (this.loadingPromise) {
      const pending = this.loadingPromise;
      await pending;
      if (!force) {
        return;
      }
    }
    this.loadingPromise = (async () => {
      try {
        const list = await this.api.listTypes();
        if (Array.isArray(list)) {
          this.definitionsSignal.set(list.map((entry) => this.normalizeDefinition(entry)));
          return;
        }
        this.definitionsSignal.set([]);
      } catch {
        if (!this.definitionsSignal().length) {
          this.definitionsSignal.set([]);
        }
      } finally {
        this.loadingPromise = null;
      }
    })();
    await this.loadingPromise;
  }

  private async persist(): Promise<void> {
    try {
      await this.api.replaceTypes(this.definitionsSignal());
    } catch {
      // API-Fehler werden ignoriert, in-memory State bleibt bestehen.
    }
  }

  private slugify(value: string): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
