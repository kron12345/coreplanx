import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { ReplacementStop } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeActionEvent,
  AttributeBulkPreset,
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { isTemporalAttribute, mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const BULK_PRESETS: AttributeBulkPreset[] = [
  { label: 'Überdachung = Offen', key: 'shelter', value: 'Offen' },
  { label: 'Überdachung = Überdacht', key: 'shelter', value: 'Überdacht' },
];

const DEFAULT_FALLBACK = {
  name: '',
  stopCode: '',
  nearestUniqueOpId: '',
  lat: '',
  lng: '',
};

@Component({
  selector: 'app-replacement-stop-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  template: `
    <app-attribute-entity-editor
      [title]="'Replacement Stops'"
      [entities]="entityRecords()"
      [attributeDefinitions]="attributeDefinitions()"
      [defaultFallbackValues]="defaultFallback"
      [numericKeys]="numericKeys"
      [actionKeys]="actionKeys"
      [presets]="bulkPresets"
      [detailError]="error()"
      (saveEntity)="handleSave($event)"
      (deleteEntities)="handleDelete($event)"
      (bulkApply)="handleBulkApply($event)"
      (actionTriggered)="handleAction($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplacementStopEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-replacement-stops'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.replacementStops().map((stop) => ({
      id: stop.replacementStopId,
      label: stop.name,
      secondaryLabel: stop.stopCode || 'ohne Code',
      attributes: stop.attributes ?? [],
      fallbackValues: {
        name: stop.name ?? '',
        stopCode: stop.stopCode ?? '',
        nearestUniqueOpId: stop.nearestUniqueOpId ?? '',
        lat: String(stop.position.lat ?? ''),
        lng: String(stop.position.lng ?? ''),
      },
    })),
  );

  readonly bulkPresets = BULK_PRESETS;
  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['lat', 'lng'];
  readonly actionKeys = ['lat', 'lng'];
  readonly error = signal<string | null>(null);

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: ReplacementStop = {
      replacementStopId: event.entityId ?? uid(),
      name: core.name,
      stopCode: core.stopCode,
      nearestUniqueOpId: core.nearestUniqueOpId,
      position: { lat: core.lat, lng: core.lng },
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateReplacementStop(payload.replacementStopId, payload);
      } else {
        this.store.addReplacementStop(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeReplacementStop(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const temporal = isTemporalAttribute(this.attributeDefinitions(), event.key);
    event.entityIds.forEach((id) => {
      const stop = this.findStop(id);
      if (!stop) {
        return;
      }
      const merged = mergeAttributeEntry(this.attributeDefinitions(), stop.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateReplacementStop(id, {
        ...stop,
        attributes: merged,
      });
    });
  }

  handleAction(event: AttributeActionEvent): void {
    if (event.key !== 'lat' && event.key !== 'lng') {
      return;
    }
    const lat = event.values['lat'];
    const lng = event.values['lng'];
    if (!this.isValidNumber(lat) || !this.isValidNumber(lng)) {
      this.error.set('Bitte gültige Koordinaten eingeben.');
      return;
    }
    window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16`, '_blank');
  }

  private deriveCoreFields(values: Record<string, string>):
    | { ok: true; name: string; stopCode?: string; nearestUniqueOpId?: string; lat: number; lng: number }
    | { ok: false; error: string } {
    const name = values['name']?.trim();
    if (!name) {
      return { ok: false, error: 'Name ist erforderlich.' };
    }
    const latRaw = values['lat']?.trim() ?? '';
    const lngRaw = values['lng']?.trim() ?? '';
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: 'Latitude und Longitude müssen numerisch sein.' };
    }
    const stopCode = values['stopCode']?.trim();
    const nearestUniqueOpId = values['nearestUniqueOpId']?.trim();
    return {
      ok: true,
      name,
      stopCode: stopCode || undefined,
      nearestUniqueOpId: nearestUniqueOpId || undefined,
      lat,
      lng,
    };
  }

  private isValidNumber(value: string | undefined): boolean {
    if (value == null || value === '') {
      return false;
    }
    return Number.isFinite(Number(value));
  }

  private findStop(id: string): ReplacementStop | null {
    return this.store.replacementStops().find((stop) => stop.replacementStopId === id) ?? null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
