import { Injectable, Signal, computed, signal } from '@angular/core';

import { CUSTOM_ATTRIBUTE_TARGETS, DEFAULT_CUSTOM_ATTRIBUTE_STATE } from './custom-attribute.defaults';
import type {
  CustomAttributeDefinition,
  CustomAttributeInput,
  CustomAttributePrimitiveType,
  CustomAttributeState,
  CustomAttributeTarget,
} from './custom-attribute.types';

export type {
  CustomAttributeDefinition,
  CustomAttributeInput,
  CustomAttributePrimitiveType,
  CustomAttributeState,
  CustomAttributeTarget,
} from './custom-attribute.types';

@Injectable({
  providedIn: 'root',
})
export class CustomAttributeService {
  private readonly state = signal<CustomAttributeState>(structuredClone(DEFAULT_CUSTOM_ATTRIBUTE_STATE));
  private readonly dirty = signal(false);

  readonly definitions: Signal<CustomAttributeState> = computed(() => this.state());
  readonly isDirty: Signal<boolean> = computed(() => this.dirty());

  getTargets(): CustomAttributeTarget[] {
    return CUSTOM_ATTRIBUTE_TARGETS;
  }

  list(entityId: string): CustomAttributeDefinition[] {
    const map = this.state();
    return map[entityId] ?? [];
  }

  add(entityId: string, input: CustomAttributeInput): CustomAttributeDefinition {
    const id = this.generateId();
    const key = this.generateKey(entityId, input.key ?? input.label);
    const now = new Date().toISOString();
    const definition: CustomAttributeDefinition = {
      id,
      key,
      label: input.label.trim(),
      type: input.type,
      description: input.description?.trim() || undefined,
      entityId,
      createdAt: now,
      updatedAt: now,
      temporal: input.temporal ?? false,
      required: input.required ?? false,
    };

    this.state.update((current) => {
      const next = { ...current };
      const list = next[entityId] ? [...next[entityId]] : [];
      list.push(definition);
      next[entityId] = list;
      return next;
    });
    this.markDirty();
    return definition;
  }

  update(
    entityId: string,
    id: string,
    updates: Partial<
      Pick<
        CustomAttributeDefinition,
        'label' | 'type' | 'description' | 'key' | 'temporal' | 'required'
      >
    >,
  ): void {
    this.state.update((current) => {
      const list = current[entityId];
      if (!list) {
        return current;
      }

      const nextList = list.map((definition) => {
        if (definition.id !== id) {
          return definition;
        }

        const label = updates.label?.trim() ?? definition.label;
        const description = updates.description?.trim() ?? definition.description;
        const nextKey =
          updates.key && updates.key !== definition.key
            ? this.generateKey(entityId, updates.key, id)
            : definition.key;

        return {
          ...definition,
          label,
          description: description || undefined,
          type: updates.type ?? definition.type,
          key: nextKey,
          temporal: updates.temporal ?? definition.temporal,
          required: updates.required ?? definition.required,
          updatedAt: new Date().toISOString(),
        };
      });

      return {
        ...current,
        [entityId]: nextList,
      };
    });
    this.markDirty();
  }

  remove(entityId: string, id: string): void {
    this.state.update((current) => {
      const list = current[entityId];
      if (!list) {
        return current;
      }

      const nextList = list.filter((definition) => definition.id !== id);
      const nextState = { ...current };
      if (nextList.length > 0) {
        nextState[entityId] = nextList;
      } else {
        delete nextState[entityId];
      }
      return nextState;
    });
    this.markDirty();
  }

  loadFromServer(snapshot: CustomAttributeState): void {
    this.state.set(structuredClone(snapshot));
    this.dirty.set(false);
  }

  preparePersistPayload(): CustomAttributeState {
    return structuredClone(this.state());
  }

  markPersisted(): void {
    this.dirty.set(false);
  }

  private markDirty(): void {
    if (!this.dirty()) {
      this.dirty.set(true);
    }
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `attr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private generateKey(entityId: string, base: string, skipId?: string): string {
    let slugBase = this.slugify(base);
    if (!slugBase) {
      slugBase = 'feld';
    }
    const existing = new Set(
      (this.state()[entityId] ?? [])
        .filter((definition) => definition.id !== skipId)
        .map((definition) => definition.key),
    );

    if (!existing.has(slugBase)) {
      return slugBase;
    }

    let counter = 1;
    let candidate = `${slugBase}-${counter}`;
    while (existing.has(candidate)) {
      counter += 1;
      candidate = `${slugBase}-${counter}`;
    }
    return candidate;
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
