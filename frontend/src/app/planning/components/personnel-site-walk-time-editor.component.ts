import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { TransferEdge } from '../../shared/planning-types';
import type { CustomAttributeDefinition } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityGroup,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const WALK_TIME_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'attr-walk-time-site',
    key: 'siteId',
    label: 'Personnel Site',
    type: 'string',
    description: 'Start-/Zielstelle (PersonnelSite.siteId).',
    entityId: 'topology-personnel-site-walk-times',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    required: true,
    temporal: false,
  },
  {
    id: 'attr-walk-time-op',
    key: 'uniqueOpId',
    label: 'Operational Point',
    type: 'string',
    description: 'Operational Point (OperationalPoint.uniqueOpId).',
    entityId: 'topology-personnel-site-walk-times',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    required: true,
    temporal: false,
  },
  {
    id: 'attr-walk-time-sec',
    key: 'avgDurationSec',
    label: 'Wegzeit (Sek.)',
    type: 'number',
    description: 'Gehzeit zwischen Personnel Site und OP.',
    entityId: 'topology-personnel-site-walk-times',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    required: true,
    temporal: false,
  },
  {
    id: 'attr-walk-time-distance',
    key: 'distanceM',
    label: 'Distanz (Meter)',
    type: 'number',
    description: 'Optional: geschätzte Distanz.',
    entityId: 'topology-personnel-site-walk-times',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    required: false,
    temporal: false,
  },
];

const DEFAULT_FALLBACK = {
  siteId: '',
  uniqueOpId: '',
  avgDurationSec: '',
  distanceM: '',
};

@Component({
  selector: 'app-personnel-site-walk-time-editor',
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatSelectModule, AttributeEntityEditorComponent],
  templateUrl: './personnel-site-walk-time-editor.component.html',
  styleUrl: './personnel-site-walk-time-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonnelSiteWalkTimeEditorComponent {
  private readonly store = inject(PlanningStoreService);

  readonly siteFilter = signal<string>('');

  readonly siteFilterOptions = computed(() =>
    this.store
      .personnelSites()
      .map((site) => ({
        value: site.siteId,
        label: `${site.name} · ${site.siteType}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  readonly attributeDefinitions = WALK_TIME_DEFINITIONS;

  private readonly filteredWalkEdges = computed(() => {
    const selectedSiteId = this.siteFilter().trim();
    const edges = this.walkEdges();
    if (!selectedSiteId) {
      return edges;
    }
    return edges.filter((edge) => this.extract(edge)?.siteId === selectedSiteId);
  });

  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.filteredWalkEdges().map((edge) => this.toRecord(edge)),
  );

  readonly groupedEntities = computed<AttributeEntityGroup[]>(() => {
    const edges = this.filteredWalkEdges();
    const bySiteId = new Map<string, TransferEdge[]>();
    edges.forEach((edge) => {
      const extracted = this.extract(edge);
      const siteId = extracted?.siteId ?? '—';
      const list = bySiteId.get(siteId) ?? [];
      list.push(edge);
      bySiteId.set(siteId, list);
    });
    const siteMap = new Map(this.store.personnelSites().map((site) => [site.siteId, site] as const));
    return Array.from(bySiteId.entries())
      .map(([siteId, list]) => {
        const site = siteMap.get(siteId) ?? null;
        return {
          id: siteId,
          label: site?.name ?? siteId,
          secondaryLabel: site ? `${site.siteType} · ${site.uniqueOpId ?? 'ohne OP'}` : '',
          children: list.map((edge) => this.toRecord(edge)),
        } satisfies AttributeEntityGroup;
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['avgDurationSec', 'distanceM'];
  readonly error = signal<string | null>(null);

  readonly selectOptions = computed(() => ({
    siteId: this.store.personnelSites().map((site) => ({ label: site.name, value: site.siteId })),
    uniqueOpId: this.store.operationalPoints().map((op) => ({ label: op.name, value: op.uniqueOpId })),
  }));

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }

    const existing = this.findExisting(core.siteId, core.uniqueOpId, event.entityId ?? null);
    if (existing) {
      this.error.set(`Wegzeit existiert bereits (${existing.transferId}). Bitte den bestehenden Eintrag nutzen.`);
      return;
    }

    const payload: TransferEdge = {
      transferId: event.entityId ?? uid(),
      from: { kind: 'PERSONNEL_SITE', siteId: core.siteId },
      to: { kind: 'OP', uniqueOpId: core.uniqueOpId },
      mode: 'WALK',
      avgDurationSec: core.avgDurationSec,
      distanceM: core.distanceM,
      bidirectional: true,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateTransferEdge(payload.transferId, payload);
      } else {
        this.store.addTransferEdge(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeTransferEdge(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    event.entityIds.forEach((id) => {
      const edge = this.walkEdges().find((entry) => entry.transferId === id) ?? null;
      if (!edge) {
        return;
      }
      const merged = mergeAttributeEntry(this.attributeDefinitions, edge.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateTransferEdge(id, { ...edge, attributes: merged });
    });
  }

  private walkEdges(): TransferEdge[] {
    return this.store
      .transferEdges()
      .filter((edge) => edge.mode === 'WALK')
      .filter((edge) => this.extract(edge) !== null)
      .sort((a, b) => (a.transferId ?? '').localeCompare(b.transferId ?? ''));
  }

  private toRecord(edge: TransferEdge): AttributeEntityRecord {
    const extracted = this.extract(edge);
    const site = extracted ? this.findPersonnelSite(extracted.siteId) : null;
    const op = extracted ? this.findOperationalPoint(extracted.uniqueOpId) : null;
    return {
      id: edge.transferId,
      label: `${site?.name ?? extracted?.siteId ?? '—'} ↔ ${op?.name ?? extracted?.uniqueOpId ?? '—'}`,
      secondaryLabel: `${edge.avgDurationSec ?? '—'} s`,
      attributes: edge.attributes ?? [],
      fallbackValues: {
        siteId: extracted?.siteId ?? '',
        uniqueOpId: extracted?.uniqueOpId ?? '',
        avgDurationSec: edge.avgDurationSec != null ? String(edge.avgDurationSec) : '',
        distanceM: edge.distanceM != null ? String(edge.distanceM) : '',
      },
    };
  }

  private extract(edge: TransferEdge): { siteId: string; uniqueOpId: string } | null {
    if (edge.from.kind === 'PERSONNEL_SITE' && edge.to.kind === 'OP') {
      return { siteId: edge.from.siteId, uniqueOpId: edge.to.uniqueOpId };
    }
    if (edge.from.kind === 'OP' && edge.to.kind === 'PERSONNEL_SITE') {
      return { siteId: edge.to.siteId, uniqueOpId: edge.from.uniqueOpId };
    }
    return null;
  }

  private deriveCoreFields(values: Record<string, string>):
    | { ok: true; siteId: string; uniqueOpId: string; avgDurationSec: number; distanceM?: number }
    | { ok: false; error: string } {
    const siteId = values['siteId']?.trim();
    if (!siteId || !this.findPersonnelSite(siteId)) {
      return { ok: false, error: 'Personnel Site ist ungültig.' };
    }
    const uniqueOpId = values['uniqueOpId']?.trim();
    if (!uniqueOpId || !this.findOperationalPoint(uniqueOpId)) {
      return { ok: false, error: 'Operational Point ist ungültig.' };
    }
    const durationRaw = values['avgDurationSec']?.trim() ?? '';
    const distanceRaw = values['distanceM']?.trim() ?? '';
    const avgDurationSec = durationRaw ? Number(durationRaw) : NaN;
    const distanceM = distanceRaw ? Number(distanceRaw) : undefined;
    if (!Number.isFinite(avgDurationSec) || avgDurationSec <= 0) {
      return { ok: false, error: 'Wegzeit (Sek.) muss eine positive Zahl sein.' };
    }
    if (distanceRaw && !Number.isFinite(distanceM)) {
      return { ok: false, error: 'Distanz muss numerisch sein.' };
    }
    return { ok: true, siteId, uniqueOpId, avgDurationSec, distanceM: distanceRaw ? distanceM : undefined };
  }

  private findExisting(siteId: string, uniqueOpId: string, excludeTransferId: string | null): TransferEdge | null {
    return (
      this.walkEdges().find((edge) => {
        if (excludeTransferId && edge.transferId === excludeTransferId) {
          return false;
        }
        const extracted = this.extract(edge);
        return extracted?.siteId === siteId && extracted?.uniqueOpId === uniqueOpId;
      }) ?? null
    );
  }

  private findPersonnelSite(id: string) {
    return this.store.personnelSites().find((site) => site.siteId === id) ?? null;
  }

  private findOperationalPoint(uniqueOpId: string) {
    return this.store.operationalPoints().find((op) => op.uniqueOpId === uniqueOpId) ?? null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
