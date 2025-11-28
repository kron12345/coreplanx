import { Injectable, Signal, computed, signal } from '@angular/core';

export interface LayerGroup {
  id: string;
  label: string;
  order: number;
  description?: string;
}

const STORAGE_KEY = 'activity-layer-groups.v1';
const DEFAULT_GROUPS: LayerGroup[] = [
  { id: 'background', label: 'Hintergrund', order: 10, description: 'Flächige Hintergründe' },
  { id: 'default', label: 'Standard', order: 50, description: 'Normale Activities' },
  { id: 'marker', label: 'Marker', order: 90, description: 'Marker/Overlay' },
];

@Injectable({ providedIn: 'root' })
export class LayerGroupService {
  private readonly groupsState = signal<Record<string, LayerGroup>>({});

  readonly groups: Signal<LayerGroup[]> = computed(() =>
    Object.values(this.groupsState())
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'de')),
  );

  constructor() {
    this.load();
    this.ensureDefaults();
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
      this.persist(next);
      return next;
    });
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
      this.persist(state);
      return state;
    });
  }

  remove(id: string): void {
    if (DEFAULT_GROUPS.some((g) => g.id === id)) {
      return;
    }
    this.groupsState.update((current) => {
      const next = { ...current };
      delete next[id];
      this.persist(next);
      return next;
    });
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
    this.persist(nextState);
  }

  private ensureDefaults(): void {
    const current = { ...this.groupsState() };
    DEFAULT_GROUPS.forEach((group) => {
      if (!current[group.id]) {
        current[group.id] = group;
      }
    });
    this.groupsState.set(current);
    this.persist(current);
  }

  private nextOrder(): number {
    const values = Object.values(this.groupsState());
    if (!values.length) {
      return 10;
    }
    return Math.max(...values.map((g) => g.order)) + 10;
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.groupsState.set(parsed as Record<string, LayerGroup>);
        }
      }
    } catch {
      // ignore
    }
  }

  private persist(state: Record<string, LayerGroup>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
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
