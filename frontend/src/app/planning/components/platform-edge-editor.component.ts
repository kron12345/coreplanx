import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { PlatformEdge } from '../../shared/planning-types';
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
  platformKey: '',
  trackKey: '',
  lengthMeters: '',
  platformHeight: '',
};

@Component({
  selector: 'app-platform-edge-editor',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AttributeEntityEditorComponent,
  ],
  templateUrl: './platform-edge-editor.component.html',
  styleUrl: './platform-edge-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlatformEdgeEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly selectOptions = computed(() => {
    const tracks = this.store
      .tracks()
      .map((track) => ({
        value: track.trackKey,
        label: `${track.trackId ?? track.trackKey}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const platforms = this.store
      .platforms()
      .map((platform) => ({
        value: platform.platformKey,
        label: platform.platformId ? `${platform.platformId} (${platform.platformKey})` : platform.platformKey,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { trackKey: tracks, platformKey: platforms };
  });

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-platform-edges'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.platformEdges().map((edge) => ({
      id: edge.platformEdgeId,
      label: edge.platformId ? `Platform ${edge.platformId}` : edge.platformEdgeId,
      secondaryLabel: edge.trackKey ?? '—',
      attributes: edge.attributes ?? [],
      fallbackValues: {
        platformId: edge.platformId ?? '',
        platformKey: edge.platformKey ?? '',
        trackKey: edge.trackKey ?? '',
        lengthMeters: edge.lengthMeters != null ? String(edge.lengthMeters) : '',
        platformHeight: edge.platformHeight ?? '',
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['lengthMeters'];
  readonly error = signal<string | null>(null);

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: PlatformEdge = {
      platformEdgeId: event.entityId ?? uid(),
      platformId: core.platformId,
      platformKey: core.platformKey,
      trackKey: core.trackKey,
      lengthMeters: core.lengthMeters,
      platformHeight: core.platformHeight,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updatePlatformEdge(payload.platformEdgeId, payload);
      } else {
        this.store.addPlatformEdge(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removePlatformEdge(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const edge = this.findEdge(id);
      if (!edge) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, edge.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updatePlatformEdge(id, { ...edge, attributes: merged });
    });
  }

  private findEdge(id: string): PlatformEdge | undefined {
    return this.store.platformEdges().find((edge) => edge.platformEdgeId === id);
  }

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        platformId?: string;
        platformKey?: string;
        trackKey?: string;
        lengthMeters?: number;
        platformHeight?: string;
      }
    | { ok: false; error: string } {
    const platformId = values['platformId']?.trim() || undefined;
    const platformKey = values['platformKey']?.trim() || undefined;
    const trackKey = values['trackKey']?.trim() || undefined;
    const lengthMeters = this.parseNumber(values['lengthMeters']);
    const platformHeight = values['platformHeight']?.trim() || undefined;
    return { ok: true, platformId, platformKey, trackKey, lengthMeters, platformHeight };
  }

  private parseNumber(raw: string | undefined): number | undefined {
    if (!raw) {
      return undefined;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `platform-edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
