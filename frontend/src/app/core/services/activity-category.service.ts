import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { PlanningCatalogApiService } from '../api/planning-catalog-api.service';

export interface ActivityCategoryDefinition {
  id: string;
  label: string;
  order: number;
  icon?: string;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class ActivityCategoryService {
  private readonly api = inject(PlanningCatalogApiService);
  private readonly categoriesState = signal<Record<string, ActivityCategoryDefinition>>({});
  private loadingPromise: Promise<void> | null = null;

  readonly categories: Signal<ActivityCategoryDefinition[]> = computed(() =>
    Object.values(this.categoriesState())
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'de')),
  );

  constructor() {
    void this.init();
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
        const list = await this.api.listActivityCategories();
        if (list && list.length) {
          const next: Record<string, ActivityCategoryDefinition> = {};
          list.forEach((category) => {
            if (!category?.id) {
              return;
            }
            next[category.id] = {
              id: category.id,
              label: category.label,
              order: category.order ?? 50,
              icon: category.icon ?? undefined,
              description: category.description ?? undefined,
            };
          });
          this.categoriesState.set(next);
          return;
        }
        this.categoriesState.set({});
      } catch {
        if (!Object.keys(this.categoriesState()).length) {
          this.categoriesState.set({});
        }
      } finally {
        this.loadingPromise = null;
      }
    })();
    await this.loadingPromise;
  }

  getById(id: string | null | undefined): ActivityCategoryDefinition | null {
    if (!id) {
      return null;
    }
    return this.categoriesState()[id] ?? null;
  }

  add(input: Omit<ActivityCategoryDefinition, 'id' | 'order'> & { id?: string; order?: number }): void {
    const id = this.slugify(input.id ?? input.label);
    if (!id) {
      return;
    }
    const nextCategory: ActivityCategoryDefinition = {
      id,
      label: input.label.trim(),
      order: Number.isFinite(input.order) ? (input.order as number) : this.nextOrder(),
      icon: input.icon?.trim() || undefined,
      description: input.description?.trim() || undefined,
    };
    this.categoriesState.update((current) => {
      const next = { ...current, [id]: nextCategory };
      return next;
    });
    void this.persistCategories();
  }

  update(id: string, patch: Partial<ActivityCategoryDefinition>): void {
    this.categoriesState.update((current) => {
      const existing = current[id];
      if (!existing) {
        return current;
      }
      const next: ActivityCategoryDefinition = {
        ...existing,
        label: patch.label?.trim() ?? existing.label,
        description: patch.description?.trim() || existing.description,
        icon: patch.icon?.trim() || existing.icon,
        order: Number.isFinite(patch.order) ? (patch.order as number) : existing.order,
      };
      const state = { ...current, [id]: next };
      return state;
    });
    void this.persistCategories();
  }

  remove(id: string): void {
    this.categoriesState.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    void this.persistCategories();
  }

  move(id: string, direction: 'up' | 'down'): void {
    const list = this.categories();
    const idx = list.findIndex((c) => c.id === id);
    if (idx < 0) {
      return;
    }
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) {
      return;
    }
    const swapped = [...list];
    const [a, b] = [swapped[idx], swapped[targetIdx]];
    swapped[idx] = { ...a, order: b.order };
    swapped[targetIdx] = { ...b, order: a.order };
    const nextState: Record<string, ActivityCategoryDefinition> = {};
    swapped.forEach((c) => (nextState[c.id] = c));
    this.categoriesState.set(nextState);
    void this.persistCategories();
  }

  async resetToDefaults(): Promise<void> {
    try {
      const snapshot = await this.api.getCatalogDefaults();
      const next: Record<string, ActivityCategoryDefinition> = {};
      (snapshot.categories ?? []).forEach((category) => {
        if (!category?.id) {
          return;
        }
        next[category.id] = {
          id: category.id,
          label: category.label,
          order: category.order ?? 50,
          icon: category.icon ?? undefined,
          description: category.description ?? undefined,
        };
      });
      this.categoriesState.set(next);
      await this.persistCategories();
    } catch {
      // Reset-Fehler wird ignoriert, aktueller State bleibt bestehen.
    }
  }

  private nextOrder(): number {
    const values = Object.values(this.categoriesState());
    if (!values.length) {
      return 10;
    }
    return Math.max(...values.map((c) => c.order)) + 10;
  }

  private async persistCategories(): Promise<void> {
    try {
      await this.api.replaceActivityCategories(this.categories());
    } catch {
      // API-Fehler werden ignoriert, in-memory State bleibt bestehen.
    }
  }

  private slugify(raw: string): string {
    return (raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
