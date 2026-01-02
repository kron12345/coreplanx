import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { PlanningCatalogApiService } from '../api/planning-catalog-api.service';

export interface LayerGroup {
  id: string;
  label: string;
  order: number;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class LayerGroupService {
  private readonly api = inject(PlanningCatalogApiService);
  private readonly groupsState = signal<Record<string, LayerGroup>>({});
  private loadingPromise: Promise<void> | null = null;

  readonly groups: Signal<LayerGroup[]> = computed(() =>
    Object.values(this.groupsState())
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
        const list = await this.api.listLayerGroups();
        if (list && list.length) {
          const next: Record<string, LayerGroup> = {};
          list.forEach((group) => {
            if (!group?.id) {
              return;
            }
            next[group.id] = {
              id: group.id,
              label: group.label,
              order: group.order ?? 50,
              description: group.description ?? undefined,
            };
          });
          this.groupsState.set(next);
          return;
        }
        this.groupsState.set({});
      } catch {
        if (!Object.keys(this.groupsState()).length) {
          this.groupsState.set({});
        }
      } finally {
        this.loadingPromise = null;
      }
    })();
    await this.loadingPromise;
  }

  getById(id: string | null | undefined): LayerGroup | null {
    if (!id) {
      return null;
    }
    return this.groupsState()[id] ?? null;
  }

  add(input: Omit<LayerGroup, 'id'> & { id?: string }): void {
    const id = this.slugify(input.id ?? input.label);
    if (!id) {
      return;
    }
    const nextGroup: LayerGroup = {
      id,
      label: input.label.trim(),
      description: input.description?.trim() || undefined,
      order: Number.isFinite(input.order) ? input.order : this.nextOrder(),
    };
    this.groupsState.update((current) => {
      const next = { ...current, [id]: nextGroup };
      return next;
    });
    void this.persistGroups();
  }

  update(id: string, patch: Partial<LayerGroup>): void {
    this.groupsState.update((current) => {
      const existing = current[id];
      if (!existing) {
        return current;
      }
      const next: LayerGroup = {
        ...existing,
        label: patch.label?.trim() ?? existing.label,
        description: patch.description?.trim() || existing.description,
        order: Number.isFinite(patch.order) ? (patch.order as number) : existing.order,
      };
      const state = { ...current, [id]: next };
      return state;
    });
    void this.persistGroups();
  }

  remove(id: string): void {
    this.groupsState.update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    void this.persistGroups();
  }

  move(id: string, direction: 'up' | 'down'): void {
    const list = this.groups();
    const idx = list.findIndex((g) => g.id === id);
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
    const nextState: Record<string, LayerGroup> = {};
    swapped.forEach((g) => (nextState[g.id] = g));
    this.groupsState.set(nextState);
    void this.persistGroups();
  }

  async resetToDefaults(): Promise<void> {
    try {
      const snapshot = await this.api.getCatalogDefaults();
      const next: Record<string, LayerGroup> = {};
      (snapshot.layerGroups ?? []).forEach((group) => {
        if (!group?.id) {
          return;
        }
        next[group.id] = {
          id: group.id,
          label: group.label,
          order: group.order ?? 50,
          description: group.description ?? undefined,
        };
      });
      this.groupsState.set(next);
      await this.persistGroups();
    } catch {
      // Reset-Fehler wird ignoriert, aktueller State bleibt bestehen.
    }
  }

  private nextOrder(): number {
    const values = Object.values(this.groupsState());
    if (!values.length) {
      return 10;
    }
    return Math.max(...values.map((g) => g.order)) + 10;
  }

  private async persistGroups(): Promise<void> {
    try {
      await this.api.replaceLayerGroups(this.groups());
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
