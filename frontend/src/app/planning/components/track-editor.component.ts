import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { Track } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  trackId: '',
  uniqueOpId: '',
  platformEdgeIds: '',
};

@Component({
  selector: 'app-track-editor',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    AttributeEntityEditorComponent,
  ],
  templateUrl: './track-editor.component.html',
  styleUrl: './track-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackEditorComponent {
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
    this.customAttributes.list('topology-tracks'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.tracks().map((track) => ({
      id: track.trackKey,
      label: track.trackId ?? track.trackKey,
      secondaryLabel: track.uniqueOpId ?? '—',
      attributes: track.attributes ?? [],
      fallbackValues: {
        trackId: track.trackId ?? '',
        uniqueOpId: track.uniqueOpId ?? '',
        platformEdgeIds: (track.platformEdgeIds ?? []).join(', '),
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly error = signal<string | null>(null);
  readonly totalCount = this.store.tracksTotal;

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: Track = {
      trackKey: event.entityId ?? uid(),
      trackId: core.trackId,
      uniqueOpId: core.uniqueOpId,
      platformEdgeIds: core.platformEdgeIds,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateTrack(payload.trackKey, payload);
      } else {
        this.store.addTrack(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeTrack(id));
  }

  loadMore(): void {
    void this.store.loadMoreTracks();
  }

  handleSearch(term: string): void {
    void this.store.searchTracks(term);
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const track = this.findTrack(id);
      if (!track) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, track.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateTrack(id, { ...track, attributes: merged });
    });
  }

  private findTrack(id: string): Track | undefined {
    return this.store.tracks().find((track) => track.trackKey === id);
  }

  private deriveCoreFields(values: Record<string, string>):
    | { ok: true; trackId?: string; uniqueOpId?: string; platformEdgeIds?: string[] }
    | { ok: false; error: string } {
    const trackId = values['trackId']?.trim() || undefined;
    const uniqueOpId = values['uniqueOpId']?.trim() || undefined;
    const platformEdgeIds = this.parseIdList(values['platformEdgeIds']);
    return { ok: true, trackId, uniqueOpId, platformEdgeIds };
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
  return `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
