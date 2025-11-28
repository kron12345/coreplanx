import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { ReplacementRoute } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  name: '',
  operator: '',
};

@Component({
  selector: 'app-replacement-route-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  template: `
    <app-attribute-entity-editor
      [title]="'Replacement Routes'"
      [entities]="entityRecords()"
      [attributeDefinitions]="attributeDefinitions()"
      [defaultFallbackValues]="defaultFallback"
      [detailError]="error()"
      (saveEntity)="handleSave($event)"
      (deleteEntities)="handleDelete($event)"
      (bulkApply)="handleBulkApply($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplacementRouteEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-replacement-routes'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.replacementRoutes().map((route) => ({
      id: route.replacementRouteId,
      label: route.name,
      secondaryLabel: route.operator || '—',
      attributes: route.attributes ?? [],
      fallbackValues: {
        name: route.name ?? '',
        operator: route.operator ?? '',
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly error = signal<string | null>(null);

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: ReplacementRoute = {
      replacementRouteId: event.entityId ?? uid(),
      name: core.name,
      operator: core.operator,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateReplacementRoute(payload.replacementRouteId, payload);
      } else {
        this.store.addReplacementRoute(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeReplacementRoute(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const route = this.findRoute(id);
      if (!route) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, route.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateReplacementRoute(id, {
        ...route,
        attributes: merged,
      });
    });
  }

  private deriveCoreFields(values: Record<string, string>):
    | { ok: true; name: string; operator?: string }
    | { ok: false; error: string } {
    const name = values['name']?.trim();
    if (!name) {
      return { ok: false, error: 'Name ist erforderlich.' };
    }
    const operator = values['operator']?.trim();
    return { ok: true, name, operator: operator || undefined };
  }

  private findRoute(id: string): ReplacementRoute | null {
    return this.store.replacementRoutes().find((route) => route.replacementRouteId === id) ?? null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
