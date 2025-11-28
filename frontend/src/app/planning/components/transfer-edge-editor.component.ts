import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { TransferEdge, TransferMode, TransferNode } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  fromKind: 'OP',
  fromRef: '',
  toKind: 'OP',
  toRef: '',
  mode: 'WALK',
  avgDurationSec: '',
  distanceM: '',
  bidirectional: 'false',
};

const MODES: TransferMode[] = ['WALK', 'SHUTTLE', 'INTERNAL'];

@Component({
  selector: 'app-transfer-edge-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  template: `
    <app-attribute-entity-editor
      [title]="'Transfer Edges'"
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
export class TransferEdgeEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-transfer-edges'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.transferEdges().map((edge) => ({
      id: edge.transferId,
      label: `${this.describeNode(edge.from)} → ${this.describeNode(edge.to)}`,
      secondaryLabel: `${edge.mode} · ${edge.avgDurationSec ?? '—'} s`,
      attributes: edge.attributes ?? [],
      fallbackValues: {
        fromKind: edge.from.kind,
        fromRef: this.extractNodeRef(edge.from),
        toKind: edge.to.kind,
        toRef: this.extractNodeRef(edge.to),
        mode: edge.mode,
        avgDurationSec: edge.avgDurationSec != null ? String(edge.avgDurationSec) : '',
        distanceM: edge.distanceM != null ? String(edge.distanceM) : '',
        bidirectional: edge.bidirectional ? 'true' : 'false',
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['avgDurationSec', 'distanceM'];
  readonly error = signal<string | null>(null);

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: TransferEdge = {
      transferId: event.entityId ?? uid(),
      from: core.from,
      to: core.to,
      mode: core.mode,
      avgDurationSec: core.avgDurationSec,
      distanceM: core.distanceM,
      bidirectional: core.bidirectional,
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
      this.store.updateTransferEdge(id, { ...edge, attributes: merged });
    });
  }

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        from: TransferNode;
        to: TransferNode;
        mode: TransferMode;
        avgDurationSec?: number;
        distanceM?: number;
        bidirectional: boolean;
      }
    | { ok: false; error: string } {
    const from = this.parseNode(values['fromKind'], values['fromRef']);
    if (!from.ok) {
      return from;
    }
    const to = this.parseNode(values['toKind'], values['toRef']);
    if (!to.ok) {
      return to;
    }
    const mode = values['mode']?.trim().toUpperCase() as TransferMode | undefined;
    if (!mode || !MODES.includes(mode)) {
      return { ok: false, error: 'Modus ist ungültig.' };
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
    const bidirectional = this.parseBoolean(values['bidirectional']);

    return {
      ok: true,
      from: from.node,
      to: to.node,
      mode,
      avgDurationSec,
      distanceM,
      bidirectional,
    };
  }

  private parseNode(
    kindRaw: string | undefined,
    refRaw: string | undefined,
  ): { ok: false; error: string } | { ok: true; node: TransferNode } {
    const kind = (kindRaw ?? '').trim().toUpperCase();
    const ref = refRaw?.trim();
    if (!kind || !ref) {
      return { ok: false, error: 'Knotenangaben sind unvollständig.' };
    }
    switch (kind) {
      case 'OP': {
        if (!this.findOperationalPointByUniqueId(ref)) {
          return { ok: false, error: `Operational Point ${ref} existiert nicht.` };
        }
        return { ok: true, node: { kind: 'OP', uniqueOpId: ref } };
      }
      case 'PERSONNEL_SITE': {
        if (!this.findPersonnelSite(ref)) {
          return { ok: false, error: `Personnel Site ${ref} existiert nicht.` };
        }
        return { ok: true, node: { kind: 'PERSONNEL_SITE', siteId: ref } };
      }
      case 'REPLACEMENT_STOP': {
        if (!this.findReplacementStop(ref)) {
          return { ok: false, error: `Replacement Stop ${ref} existiert nicht.` };
        }
        return { ok: true, node: { kind: 'REPLACEMENT_STOP', replacementStopId: ref } };
      }
      default:
        return { ok: false, error: `Unbekannter Knotentyp ${kind}.` };
    }
  }

  private parseBoolean(value: string | undefined): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'ja';
  }

  private describeNode(node: TransferNode): string {
    switch (node.kind) {
      case 'OP':
        return this.findOperationalPointByUniqueId(node.uniqueOpId)?.name ?? node.uniqueOpId;
      case 'PERSONNEL_SITE': {
        const site = this.findPersonnelSite(node.siteId);
        return `Site ${site?.name ?? node.siteId}`;
      }
      case 'REPLACEMENT_STOP': {
        const stop = this.findReplacementStop(node.replacementStopId);
        return stop?.name ?? node.replacementStopId;
      }
    }
  }

  private extractNodeRef(node: TransferNode): string {
    switch (node.kind) {
      case 'OP':
        return node.uniqueOpId;
      case 'PERSONNEL_SITE':
        return node.siteId;
      case 'REPLACEMENT_STOP':
        return node.replacementStopId;
    }
  }

  private findOperationalPointByUniqueId(uniqueOpId: string) {
    return this.store.operationalPoints().find((op) => op.uniqueOpId === uniqueOpId);
  }

  private findPersonnelSite(id: string) {
    return this.store.personnelSites().find((site) => site.siteId === id);
  }

  private findReplacementStop(id: string) {
    return this.store.replacementStops().find((stop) => stop.replacementStopId === id);
  }

  private findEdge(id: string): TransferEdge | null {
    return this.store.transferEdges().find((edge) => edge.transferId === id) ?? null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
