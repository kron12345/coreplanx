import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { ReplacementEdge } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  replacementRouteId: '',
  fromStopId: '',
  toStopId: '',
  seq: '1',
  avgDurationSec: '',
  distanceM: '',
};

@Component({
  selector: 'app-replacement-edge-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  template: `
    <app-attribute-entity-editor
      [title]="'Replacement Edges'"
      [entities]="entityRecords()"
      [attributeDefinitions]="attributeDefinitions()"
      [defaultFallbackValues]="defaultFallback"
      [numericKeys]="numericKeys"
      [detailError]="error()"
      (saveEntity)="handleSave($event)"
      (deleteEntities)="handleDelete($event)"
      (bulkApply)="handleBulkApply($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReplacementEdgeEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-replacement-edges'),
  );
  readonly routeNameMap = computed(() => {
    const map = new Map<string, string>();
    this.store.replacementRoutes().forEach((route) =>
      map.set(route.replacementRouteId, route.name ?? route.replacementRouteId),
    );
    return map;
  });
  readonly stopNameMap = computed(() => {
    const map = new Map<string, string>();
    this.store.replacementStops().forEach((stop) =>
      map.set(stop.replacementStopId, stop.name ?? stop.replacementStopId),
    );
    return map;
  });
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.replacementEdges().map((edge) => ({
      id: edge.replacementEdgeId,
      label: `${this.routeNameMap().get(edge.replacementRouteId) ?? edge.replacementRouteId} · Seq ${
        edge.seq
      }`,
      secondaryLabel: `${this.stopNameMap().get(edge.fromStopId) ?? edge.fromStopId} → ${
        this.stopNameMap().get(edge.toStopId) ?? edge.toStopId
      }`,
      attributes: edge.attributes ?? [],
      fallbackValues: {
        replacementRouteId: edge.replacementRouteId,
        fromStopId: edge.fromStopId,
        toStopId: edge.toStopId,
        seq: String(edge.seq ?? ''),
        avgDurationSec: edge.avgDurationSec != null ? String(edge.avgDurationSec) : '',
        distanceM: edge.distanceM != null ? String(edge.distanceM) : '',
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['seq', 'avgDurationSec', 'distanceM'];
  readonly error = signal<string | null>(null);

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: ReplacementEdge = {
      replacementEdgeId: event.entityId ?? uid(),
      replacementRouteId: core.replacementRouteId,
      fromStopId: core.fromStopId,
      toStopId: core.toStopId,
      seq: core.seq,
      avgDurationSec: core.avgDurationSec,
      distanceM: core.distanceM,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateReplacementEdge(payload.replacementEdgeId, payload);
      } else {
        this.store.addReplacementEdge(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeReplacementEdge(id));
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
      this.store.updateReplacementEdge(id, { ...edge, attributes: merged });
    });
  }

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        replacementRouteId: string;
        fromStopId: string;
        toStopId: string;
        seq: number;
        avgDurationSec?: number;
        distanceM?: number;
      }
    | { ok: false; error: string } {
    const replacementRouteId = values['replacementRouteId']?.trim();
    const fromStopId = values['fromStopId']?.trim();
    const toStopId = values['toStopId']?.trim();
    if (!replacementRouteId || !fromStopId || !toStopId) {
      return { ok: false, error: 'Route und Stop-IDs sind erforderlich.' };
    }
    if (!this.findRoute(replacementRouteId)) {
      return { ok: false, error: 'Route existiert nicht.' };
    }
    if (!this.findStop(fromStopId) || !this.findStop(toStopId)) {
      return { ok: false, error: 'Stop-ID ist ungültig.' };
    }
    const seqRaw = values['seq']?.trim() ?? '';
    const seq = Number(seqRaw);
    if (!Number.isInteger(seq) || seq <= 0) {
      return { ok: false, error: 'Sequenz muss eine positive Ganzzahl sein.' };
    }
    const durationRaw = values['avgDurationSec']?.trim() ?? '';
    const distanceRaw = values['distanceM']?.trim() ?? '';
    const avgDurationSec = durationRaw ? Number(durationRaw) : undefined;
    const distanceM = distanceRaw ? Number(distanceRaw) : undefined;
    if (durationRaw && !Number.isFinite(avgDurationSec)) {
      return { ok: false, error: 'Dauer muss numerisch sein.' };
    }
    if (distanceRaw && !Number.isFinite(distanceM)) {
      return { ok: false, error: 'Distanz muss numerisch sein.' };
    }

    return {
      ok: true,
      replacementRouteId,
      fromStopId,
      toStopId,
      seq,
      avgDurationSec,
      distanceM,
    };
  }

  private findRoute(id: string) {
    return this.store.replacementRoutes().find((route) => route.replacementRouteId === id);
  }

  private findStop(id: string) {
    return this.store.replacementStops().find((stop) => stop.replacementStopId === id);
  }

  private findEdge(id: string): ReplacementEdge | null {
    return this.store.replacementEdges().find((edge) => edge.replacementEdgeId === id) ?? null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
