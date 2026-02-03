import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { Siding } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  sidingId: '',
  uniqueOpId: '',
  lengthMeters: '',
  gradient: '',
  hasRefuelling: 'false',
  hasElectricShoreSupply: 'false',
  hasWaterRestocking: 'false',
  hasSandRestocking: 'false',
  hasToiletDischarge: 'false',
  hasExternalCleaning: 'false',
};

@Component({
  selector: 'app-siding-editor',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AttributeEntityEditorComponent,
  ],
  templateUrl: './siding-editor.component.html',
  styleUrl: './siding-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidingEditorComponent {
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
    this.customAttributes.list('topology-sidings'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.sidings().map((siding) => ({
      id: siding.sidingKey,
      label: siding.sidingId ?? siding.sidingKey,
      secondaryLabel: siding.uniqueOpId ?? '—',
      attributes: siding.attributes ?? [],
      fallbackValues: {
        sidingId: siding.sidingId ?? '',
        uniqueOpId: siding.uniqueOpId ?? '',
        lengthMeters: siding.lengthMeters != null ? String(siding.lengthMeters) : '',
        gradient: siding.gradient ?? '',
        hasRefuelling: this.boolValue(siding.hasRefuelling),
        hasElectricShoreSupply: this.boolValue(siding.hasElectricShoreSupply),
        hasWaterRestocking: this.boolValue(siding.hasWaterRestocking),
        hasSandRestocking: this.boolValue(siding.hasSandRestocking),
        hasToiletDischarge: this.boolValue(siding.hasToiletDischarge),
        hasExternalCleaning: this.boolValue(siding.hasExternalCleaning),
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['lengthMeters'];
  readonly error = signal<string | null>(null);
  readonly totalCount = this.store.sidingsTotal;

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: Siding = {
      sidingKey: event.entityId ?? uid(),
      sidingId: core.sidingId,
      uniqueOpId: core.uniqueOpId,
      lengthMeters: core.lengthMeters,
      gradient: core.gradient,
      hasRefuelling: core.hasRefuelling,
      hasElectricShoreSupply: core.hasElectricShoreSupply,
      hasWaterRestocking: core.hasWaterRestocking,
      hasSandRestocking: core.hasSandRestocking,
      hasToiletDischarge: core.hasToiletDischarge,
      hasExternalCleaning: core.hasExternalCleaning,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateSiding(payload.sidingKey, payload);
      } else {
        this.store.addSiding(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeSiding(id));
  }

  loadMore(): void {
    void this.store.loadMoreSidings();
  }

  handleSearch(term: string): void {
    void this.store.searchSidings(term);
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const siding = this.findSiding(id);
      if (!siding) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, siding.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateSiding(id, { ...siding, attributes: merged });
    });
  }

  private findSiding(id: string): Siding | undefined {
    return this.store.sidings().find((siding) => siding.sidingKey === id);
  }

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        sidingId?: string;
        uniqueOpId?: string;
        lengthMeters?: number;
        gradient?: string;
        hasRefuelling?: boolean;
        hasElectricShoreSupply?: boolean;
        hasWaterRestocking?: boolean;
        hasSandRestocking?: boolean;
        hasToiletDischarge?: boolean;
        hasExternalCleaning?: boolean;
      }
    | { ok: false; error: string } {
    const sidingId = values['sidingId']?.trim() || undefined;
    const uniqueOpId = values['uniqueOpId']?.trim() || undefined;
    const lengthMeters = this.parseNumber(values['lengthMeters']);
    const gradient = values['gradient']?.trim() || undefined;
    return {
      ok: true,
      sidingId,
      uniqueOpId,
      lengthMeters,
      gradient,
      hasRefuelling: this.parseBoolean(values['hasRefuelling']),
      hasElectricShoreSupply: this.parseBoolean(values['hasElectricShoreSupply']),
      hasWaterRestocking: this.parseBoolean(values['hasWaterRestocking']),
      hasSandRestocking: this.parseBoolean(values['hasSandRestocking']),
      hasToiletDischarge: this.parseBoolean(values['hasToiletDischarge']),
      hasExternalCleaning: this.parseBoolean(values['hasExternalCleaning']),
    };
  }

  private parseNumber(raw: string | undefined): number | undefined {
    if (!raw) {
      return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  private parseBoolean(raw: string | undefined): boolean | undefined {
    if (!raw) {
      return undefined;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === 'no' || normalized === '0') {
      return false;
    }
    return undefined;
  }

  private boolValue(value: boolean | undefined): string {
    if (value === undefined) {
      return '';
    }
    return value ? 'true' : 'false';
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `siding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
