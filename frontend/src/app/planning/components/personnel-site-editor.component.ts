import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { PersonnelSite, PersonnelSiteType } from '../../shared/planning-types';
import { CustomAttributeService } from '../../core/services/custom-attribute.service';
import {
  AttributeActionEvent,
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  BulkApplyEvent,
  EntitySaveEvent,
} from '../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { mergeAttributeEntry } from '../../shared/utils/topology-attribute.helpers';

const DEFAULT_FALLBACK = {
  name: '',
  siteType: 'MELDESTELLE',
  uniqueOpId: '',
  lat: '',
  lng: '',
  openingHoursJson: '',
};

const SITE_TYPES: PersonnelSiteType[] = ['MELDESTELLE', 'PAUSENRAUM', 'BEREITSCHAFT', 'BÜRO'];

@Component({
  selector: 'app-personnel-site-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  template: `
    <app-attribute-entity-editor
      [title]="'Personnel Sites'"
      [entities]="entityRecords()"
      [attributeDefinitions]="attributeDefinitions()"
      [defaultFallbackValues]="defaultFallback"
      [numericKeys]="numericKeys"
      [actionKeys]="actionKeys"
      [detailError]="error()"
      (saveEntity)="handleSave($event)"
      (deleteEntities)="handleDelete($event)"
      (bulkApply)="handleBulkApply($event)"
      (actionTriggered)="handleAction($event)"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonnelSiteEditorComponent {
  private readonly store = inject(PlanningStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly attributeDefinitions = computed(() =>
    this.customAttributes.list('topology-personnel-sites'),
  );
  readonly entityRecords = computed<AttributeEntityRecord[]>(() =>
    this.store.personnelSites().map((site) => ({
      id: site.siteId,
      label: site.name,
      secondaryLabel: `${site.siteType} · ${site.uniqueOpId || 'ohne OP'}`,
      attributes: site.attributes ?? [],
      fallbackValues: {
        name: site.name ?? '',
        siteType: site.siteType,
        uniqueOpId: site.uniqueOpId ?? '',
        lat: String(site.position.lat ?? ''),
        lng: String(site.position.lng ?? ''),
        openingHoursJson: site.openingHoursJson ?? '',
      },
    })),
  );

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
    const payload: PersonnelSite = {
      siteId: event.entityId ?? uid(),
      name: core.name,
      siteType: core.siteType,
      uniqueOpId: core.uniqueOpId,
      position: { lat: core.lat, lng: core.lng },
      openingHoursJson: core.openingHoursJson,
      attributes: event.payload.attributes,
    };

    try {
      if (event.entityId) {
        this.store.updatePersonnelSite(payload.siteId, payload);
      } else {
        this.store.addPersonnelSite(payload);
      }
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }

  handleDelete(ids: string[]): void {
    ids.forEach((id) => this.store.removePersonnelSite(id));
  }

  handleBulkApply(event: BulkApplyEvent): void {
    const definitions = this.attributeDefinitions();
    event.entityIds.forEach((id) => {
      const site = this.findSite(id);
      if (!site) {
        return;
      }
      const merged = mergeAttributeEntry(definitions, site.attributes, {
        key: event.key,
        value: event.value,
        validFrom: event.validFrom || undefined,
      });
      this.store.updatePersonnelSite(id, { ...site, attributes: merged });
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
    | {
        ok: true;
        name: string;
        siteType: PersonnelSiteType;
        uniqueOpId?: string;
        lat: number;
        lng: number;
        openingHoursJson?: string;
      }
    | { ok: false; error: string } {
    const name = values['name']?.trim();
    if (!name) {
      return { ok: false, error: 'Name ist erforderlich.' };
    }
    const siteType = values['siteType']?.trim().toUpperCase() as PersonnelSiteType | undefined;
    if (!siteType || !SITE_TYPES.includes(siteType)) {
      return { ok: false, error: 'Ungültiger Site-Typ.' };
    }
    const uniqueOpId = values['uniqueOpId']?.trim();
    if (uniqueOpId && !this.findOperationalPointByUniqueId(uniqueOpId)) {
      return { ok: false, error: 'Zugeordneter OP existiert nicht.' };
    }
    const latRaw = values['lat']?.trim() ?? '';
    const lngRaw = values['lng']?.trim() ?? '';
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { ok: false, error: 'Koordinaten müssen numerisch sein.' };
    }
    const openingHoursJson = values['openingHoursJson']?.trim();

    return {
      ok: true,
      name,
      siteType,
      uniqueOpId: uniqueOpId || undefined,
      lat,
      lng,
      openingHoursJson: openingHoursJson || undefined,
    };
  }

  private isValidNumber(value: string | undefined): boolean {
    if (value == null || value === '') {
      return false;
    }
    return Number.isFinite(Number(value));
  }

  private findOperationalPointByUniqueId(uniqueOpId: string) {
    return this.store.operationalPoints().find((op) => op.uniqueOpId === uniqueOpId);
  }

  private findSite(id: string): PersonnelSite | null {
    return this.store.personnelSites().find((entry) => entry.siteId === id) ?? null;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
