import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { Platform } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  platformId: '',
  uniqueOpId: '',
  name: '',
  lengthMeters: '',
  platformHeight: '',
  platformEdgeIds: '',
};

@Component({
  selector: 'app-platform-editor',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AttributeEntityEditorComponent,
  ],
  templateUrl: './platform-editor.component.html',
  styleUrl: './platform-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformEditorComponent {
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
    this.customAttributes.list('topology-platforms'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.platforms().map((platform) => ({
      id: platform.platformKey,
      label: platform.platformId ?? platform.platformKey,
      secondaryLabel: platform.uniqueOpId ?? '—',
      attributes: platform.attributes ?? [],
      fallbackValues: {
        platformId: platform.platformId ?? '',
        uniqueOpId: platform.uniqueOpId ?? '',
        name: platform.name ?? '',
        lengthMeters: platform.lengthMeters != null ? String(platform.lengthMeters) : '',
        platformHeight: platform.platformHeight ?? '',
        platformEdgeIds: (platform.platformEdgeIds ?? []).join(', '),
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['lengthMeters'];
  readonly error = signal<string | null>(null);
  readonly totalCount = this.store.platformsTotal;

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: Platform = {
      platformKey: event.entityId ?? uid(),
      platformId: core.platformId,
      uniqueOpId: core.uniqueOpId,
      name: core.name,
      lengthMeters: core.lengthMeters,
      platformHeight: core.platformHeight,
      platformEdgeIds: core.platformEdgeIds,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updatePlatform(payload.platformKey, payload);
      } else {
        this.store.addPlatform(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removePlatform(id));
  }

  loadMore(): void {
    void this.store.loadMorePlatforms();
  }

  handleSearch(term: string): void {
    void this.store.searchPlatforms(term);
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const platform = this.findPlatform(id);
      if (!platform) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, platform.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updatePlatform(id, { ...platform, attributes: merged });
    });
  }

  private findPlatform(id: string): Platform | undefined {
    return this.store.platforms().find((platform) => platform.platformKey === id);
  }

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        platformId?: string;
        uniqueOpId?: string;
        name?: string;
        lengthMeters?: number;
        platformHeight?: string;
        platformEdgeIds?: string[];
      }
    | { ok: false; error: string } {
    const platformId = values['platformId']?.trim() || undefined;
    const uniqueOpId = values['uniqueOpId']?.trim() || undefined;
    const name = values['name']?.trim() || undefined;
    const lengthMeters = this.parseNumber(values['lengthMeters']);
    const platformHeight = values['platformHeight']?.trim() || undefined;
    const platformEdgeIds = this.parseIdList(values['platformEdgeIds']);
    return { ok: true, platformId, uniqueOpId, name, lengthMeters, platformHeight, platformEdgeIds };
  }

  private parseNumber(raw: string | undefined): number | undefined {
    if (!raw) {
      return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  private parseIdList(raw: string | undefined): string[] | undefined {
    if (!raw) {
      return undefined;
    }
    const list = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return list.length ? list : undefined;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `platform-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
