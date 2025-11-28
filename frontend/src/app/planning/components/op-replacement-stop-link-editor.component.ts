import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { OpReplRelation, OpReplacementStopLink } from '../../shared/planning-types';
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
  replacementStopId: '',
  relationType: 'PRIMARY_SEV_STOP',
  walkingTimeSec: '',
  distanceM: '',
};

const RELATIONS: OpReplRelation[] = ['PRIMARY_SEV_STOP', 'ALTERNATIVE', 'TEMPORARY'];

@Component({
  selector: 'app-op-replacement-stop-link-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  template: `
    <app-attribute-entity-editor
      [title]="'OP ↔ Replacement Stop Links'"
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
export class OpReplacementStopLinkEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-op-replacement-links'),
  );
  readonly stopNameMap = computed(() => {
    const map = new Map<string, string>();
    this.store.replacementStops().forEach((stop) =>
      map.set(stop.replacementStopId, stop.name ?? stop.replacementStopId),
    );
    return map;
  });
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.opReplacementStopLinks().map((link) => ({
      id: link.linkId,
      label: `${link.uniqueOpId} → ${this.stopNameMap().get(link.replacementStopId) ?? link.replacementStopId}`,
      secondaryLabel: `${link.relationType}`,
      attributes: link.attributes ?? [],
      fallbackValues: {
        uniqueOpId: link.uniqueOpId,
        replacementStopId: link.replacementStopId,
        relationType: link.relationType,
        walkingTimeSec: link.walkingTimeSec != null ? String(link.walkingTimeSec) : '',
        distanceM: link.distanceM != null ? String(link.distanceM) : '',
      },
    })),
  );

  readonly defaultFallback = DEFAULT_FALLBACK;
  readonly numericKeys = ['walkingTimeSec', 'distanceM'];
  readonly error = signal<string | null>(null);

  handleSave(event: EntitySaveEvent): void {
    const core = this.deriveCoreFields(event.payload.values);
    if (!core.ok) {
      this.error.set(core.error);
      return;
    }
    const payload: OpReplacementStopLink = {
      linkId: event.entityId ?? uid(),
      uniqueOpId: core.uniqueOpId,
      replacementStopId: core.replacementStopId,
      relationType: core.relationType,
      walkingTimeSec: core.walkingTimeSec,
      distanceM: core.distanceM,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updateOpReplacementStopLink(payload.linkId, payload);
      } else {
        this.store.addOpReplacementStopLink(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removeOpReplacementStopLink(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const link = this.findLink(id);
      if (!link) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, link.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updateOpReplacementStopLink(id, { ...link, attributes: merged });
    });
  }

  private deriveCoreFields(values: Record<string, string>):
    | {
        ok: true;
        uniqueOpId: string;
        replacementStopId: string;
        relationType: OpReplRelation;
        walkingTimeSec?: number;
        distanceM?: number;
      }
    | { ok: false; error: string } {
    const uniqueOpId = values['uniqueOpId']?.trim();
    const replacementStopId = values['replacementStopId']?.trim();
    if (!uniqueOpId || !replacementStopId) {
      return { ok: false, error: 'OP und Ersatzhalt müssen gesetzt sein.' };
    }
    if (!this.findOperationalPointByUniqueId(uniqueOpId)) {
      return { ok: false, error: 'Operational Point existiert nicht.' };
    }
    if (!this.findStop(replacementStopId)) {
      return { ok: false, error: 'Replacement Stop existiert nicht.' };
    }
    const relationRaw = values['relationType']?.trim().toUpperCase() as OpReplRelation | undefined;
    if (!relationRaw || !RELATIONS.includes(relationRaw)) {
      return { ok: false, error: 'Relation ist ungültig.' };
    }
    const walkingRaw = values['walkingTimeSec']?.trim() ?? '';
    const distanceRaw = values['distanceM']?.trim() ?? '';
    const walkingTimeSec = walkingRaw ? Number(walkingRaw) : undefined;
    const distanceM = distanceRaw ? Number(distanceRaw) : undefined;
    if (walkingRaw && !Number.isFinite(walkingTimeSec)) {
      return { ok: false, error: 'Fußweg muss numerisch sein.' };
    }
    if (distanceRaw && !Number.isFinite(distanceM)) {
      return { ok: false, error: 'Distanz muss numerisch sein.' };
    }

    return {
      ok: true,
      uniqueOpId,
      replacementStopId,
      relationType: relationRaw,
      walkingTimeSec,
      distanceM,
    };
  }

  private findOperationalPointByUniqueId(uniqueOpId: string) {
    return this.store.operationalPoints().find((op) => op.uniqueOpId === uniqueOpId);
  }

  private findStop(id: string) {
    return this.store.replacementStops().find((stop) => stop.replacementStopId === id);
  }

  private findLink(id: string): OpReplacementStopLink | null {
    return this.store.opReplacementStopLinks().find((link) => link.linkId === id) ?? null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
