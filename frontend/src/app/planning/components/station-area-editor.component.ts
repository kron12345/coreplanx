import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { StationArea } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  uniqueOpId: '',
  name: '',
  lat: '',
  lng: '',
};

@Component({
  selector: 'app-station-area-editor',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AttributeEntityEditorComponent,
  ],
  templateUrl: './station-area-editor.component.html',
  styleUrl: './station-area-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationAreaEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly selectOptions = computed(() => {
    const ops = this.store
      .operationalPoints()
      .map((op) => ({
        value: op.uniqueOpId,
        label: `${op.name ?? op.uniqueOpId} (${op.uniqueOpId})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { uniqueOpId: ops };
  });

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-station-areas'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.stationAreas().map((area) => ({
      id: area.stationAreaId,
      label: area.name ?? area.stationAreaId,
      secondaryLabel: area.uniqueOpId ?? '—',
      attributes: area.attributes ?? [],
      fallbackValues: {
        uniqueOpId: area.uniqueOpId ?? '',
        name: area.name ?? '',
        lat: area.position?.lat != null ? String(area.position.lat) : '',
        lng: area.position?.lng != null ? String(area.position.lng) : '',
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['lat', 'lng'];
  readonly error = signal<string | null>(null);

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: StationArea = {
      stationAreaId: event.entityId ?? uid(),
      uniqueOpId: core.uniqueOpId,
      name: core.name,
      position: core.position,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateStationArea(payload.stationAreaId, payload);
      } else {
        this.store.addStationArea(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeStationArea(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const area = this.findStationArea(id);
      if (!area) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, area.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateStationArea(id, { ...area, attributes: merged });
    });
  }

  private findStationArea(id: string): StationArea | undefined {
    return this.store.stationAreas().find((area) => area.stationAreaId === id);
  }

  private deriveCoreFields(values: Record<string, string>):
    | { ok: true; uniqueOpId?: string; name?: string; position?: { lat: number; lng: number } }
    | { ok: false; error: string } {
    const uniqueOpId = values['uniqueOpId']?.trim() || undefined;
    const name = values['name']?.trim() || undefined;
    const lat = this.parseNumber(values['lat']);
    const lng = this.parseNumber(values['lng']);
    const position =
      lat != null && lng != null ? { lat, lng } : undefined;
    return { ok: true, uniqueOpId, name, position };
  }

  private parseNumber(raw: string | undefined): number | null {
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `station-area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
