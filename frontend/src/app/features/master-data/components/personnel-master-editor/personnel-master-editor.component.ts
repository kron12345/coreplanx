import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  AttributeEntityGroup,
  EntitySaveEvent,
} from '../../../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { MasterDataCollectionsStoreService } from '../../master-data-collections.store';
import { MasterDataResourceStoreService } from '../../master-data-resource.store';
import { CustomAttributeDefinition, CustomAttributeService } from '../../../../core/services/custom-attribute.service';
import { Personnel, PersonnelPool, PersonnelService, PersonnelServicePool } from '../../../../models/master-data';

type PersonnelEditorMode = 'servicePools' | 'services' | 'personnelPools' | 'personnel';

const SERVICE_POOL_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'psp-name',
    key: 'name',
    label: 'Poolname',
    type: 'string',
    entityId: 'personnel-service-pools',
    required: true,
  },
  {
    id: 'psp-description',
    key: 'description',
    label: 'Beschreibung',
    type: 'string',
    entityId: 'personnel-service-pools',
  },
];

const PERSONNEL_POOL_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'pp-name',
    key: 'name',
    label: 'Poolname',
    type: 'string',
    entityId: 'personnel-pools',
    required: true,
  },
  {
    id: 'pp-description',
    key: 'description',
    label: 'Beschreibung',
    type: 'string',
    entityId: 'personnel-pools',
  },
  {
    id: 'pp-location',
    key: 'locationCode',
    label: 'Standortcode',
    type: 'string',
    entityId: 'personnel-pools',
  },
];

const UNASSIGNED_SERVICE_GROUP = '__unassigned-services';
const UNASSIGNED_PERSONNEL_GROUP = '__unassigned-personnel';

function mergeDefinitions(
  base: CustomAttributeDefinition[],
  custom: CustomAttributeDefinition[],
): CustomAttributeDefinition[] {
  const map = new Map<string, CustomAttributeDefinition>();
  base.forEach((definition) => map.set(definition.key, definition));
  custom.forEach((definition) => map.set(definition.key, definition));
  return Array.from(map.values());
}

const PERSONNEL_SERVICE_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'ps-name',
    key: 'name',
    label: 'Dienstname',
    type: 'string',
    entityId: 'personnel-services',
    required: true,
  },
  {
    id: 'ps-description',
    key: 'description',
    label: 'Beschreibung',
    type: 'string',
    entityId: 'personnel-services',
  },
  {
    id: 'ps-pool',
    key: 'poolId',
    label: 'Pool-ID',
    type: 'string',
    entityId: 'personnel-services',
  },
  {
    id: 'ps-start',
    key: 'startTime',
    label: 'Startzeit',
    type: 'time',
    entityId: 'personnel-services',
  },
  {
    id: 'ps-end',
    key: 'endTime',
    label: 'Endzeit',
    type: 'time',
    entityId: 'personnel-services',
  },
  {
    id: 'ps-night',
    key: 'isNightService',
    label: 'Nachtleistung',
    type: 'boolean',
    entityId: 'personnel-services',
  },
  {
    id: 'ps-qual',
    key: 'requiredQualifications',
    label: 'Qualifikationen (kommagetrennt)',
    type: 'string',
    entityId: 'personnel-services',
  },
  {
    id: 'ps-max-daily',
    key: 'maxDailyInstances',
    label: 'Tägliche Instanzen',
    type: 'number',
    entityId: 'personnel-services',
  },
  {
    id: 'ps-max-resources',
    key: 'maxResourcesPerInstance',
    label: 'Ressourcen pro Einsatz',
    type: 'number',
    entityId: 'personnel-services',
  },
];

const PERSONNEL_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'person-first-name',
    key: 'firstName',
    label: 'Vorname',
    type: 'string',
    entityId: 'personnel',
    required: true,
  },
  {
    id: 'person-last-name',
    key: 'lastName',
    label: 'Nachname',
    type: 'string',
    entityId: 'personnel',
    required: true,
  },
  {
    id: 'person-preferred-name',
    key: 'preferredName',
    label: 'Rufname',
    type: 'string',
    entityId: 'personnel',
  },
  {
    id: 'person-qualifications',
    key: 'qualifications',
    label: 'Qualifikationen (kommagetrennt)',
    type: 'string',
    entityId: 'personnel',
  },
  {
    id: 'person-service-ids',
    key: 'serviceIds',
    label: 'Dienst-IDs (kommagetrennt)',
    type: 'string',
    entityId: 'personnel',
  },
  {
    id: 'person-pool-id',
    key: 'poolId',
    label: 'Pool-ID',
    type: 'string',
    entityId: 'personnel',
  },
  {
    id: 'person-home-station',
    key: 'homeStation',
    label: 'Heimatbahnhof',
    type: 'string',
    entityId: 'personnel',
  },
  {
    id: 'person-availability',
    key: 'availabilityStatus',
    label: 'Status',
    type: 'string',
    entityId: 'personnel',
  },
  {
    id: 'person-qual-expiry',
    key: 'qualificationExpires',
    label: 'Qualifikation gültig bis',
    type: 'date',
    entityId: 'personnel',
  },
  {
    id: 'person-reserve',
    key: 'isReserve',
    label: 'Reserve?',
    type: 'boolean',
    entityId: 'personnel',
  },
];

const SERVICE_POOL_DEFAULTS = {
  name: 'Fernverkehr Süd',
  description: 'Stammpool für die Langläufe München–Berlin',
  shiftCoordinator: 'Leonie Kraus',
  contactEmail: 'fv-sued@rail.example',
};

const PERSONNEL_SERVICE_DEFAULTS = {
  name: 'ICE 1001 Frühdienst',
  description: 'Besetzt den Umlauf Berlin → München',
  poolId: 'fv-sued',
  startTime: '05:00',
  endTime: '13:00',
  isNightService: 'false',
  requiredQualifications: 'Traktion A, ETCS',
  maxDailyInstances: '4',
  maxResourcesPerInstance: '2',
};

const PERSONNEL_DEFAULTS = {
  firstName: 'Max',
  lastName: 'Beispiel',
  preferredName: 'Max',
  qualifications: 'Traktion A, Notfallhelfer',
  serviceIds: 'ICE1001,ICE1003',
  poolId: 'team-berlin',
  homeStation: 'Berlin Hbf',
  availabilityStatus: 'einsatzbereit',
  qualificationExpires: '2025-12-31',
  isReserve: 'false',
};

const PERSONNEL_POOL_DEFAULTS = {
  name: 'Team Berlin',
  description: 'Lokführerstandort für den Nordkorridor',
  locationCode: 'BER',
};

@Component({
  selector: 'app-personnel-master-editor',
  standalone: true,
  imports: [CommonModule, MatButtonToggleModule, MatIconModule, AttributeEntityEditorComponent],
  template: `
    <section class="personnel-editor">
      <header>
        <mat-button-toggle-group
          color="primary"
          [value]="viewMode()"
          (valueChange)="viewMode.set($event)"
        >
          <mat-button-toggle value="servicePools">
            <mat-icon fontIcon="group_work"></mat-icon>
            Dienstpools
          </mat-button-toggle>
          <mat-button-toggle value="services">
            <mat-icon fontIcon="event"></mat-icon>
            Dienste
          </mat-button-toggle>
          <mat-button-toggle value="personnelPools">
            <mat-icon fontIcon="groups"></mat-icon>
            Personalpools
          </mat-button-toggle>
          <mat-button-toggle value="personnel">
            <mat-icon fontIcon="badge"></mat-icon>
            Personal
          </mat-button-toggle>
        </mat-button-toggle-group>
      </header>

      <ng-container [ngSwitch]="viewMode()">
        <app-attribute-entity-editor
          *ngSwitchCase="'servicePools'"
          [title]="'Dienstpools'"
          [entities]="servicePoolRecords()"
          [attributeDefinitions]="servicePoolDefinitions()"
          [defaultFallbackValues]="servicePoolDefaults"
          [detailError]="servicePoolError()"
          [requiredKeys]="servicePoolRequiredKeys"
          (saveEntity)="handleServicePoolSave($event)"
          (deleteEntities)="handleServicePoolDelete($event)"
        />

        <app-attribute-entity-editor
          *ngSwitchCase="'services'"
          [title]="'Dienste'"
          [entities]="serviceRecords()"
          [attributeDefinitions]="serviceDefinitions()"
          [defaultFallbackValues]="serviceDefaults"
          [detailError]="serviceError()"
          [groupedEntities]="serviceGroups()"
          [createDefaultsFactory]="serviceCreateDefaultsFactory"
          [selectOptions]="serviceSelectOptions()"
          (saveEntity)="handleServiceSave($event)"
          (deleteEntities)="handleServiceDelete($event)"
        />

        <app-attribute-entity-editor
          *ngSwitchCase="'personnelPools'"
          [title]="'Personalpools'"
          [entities]="personnelPoolRecords()"
          [attributeDefinitions]="personnelPoolDefinitions()"
          [defaultFallbackValues]="personnelPoolDefaults"
          [detailError]="personnelPoolError()"
          [requiredKeys]="personnelPoolRequiredKeys"
          (saveEntity)="handlePersonnelPoolSave($event)"
          (deleteEntities)="handlePersonnelPoolDelete($event)"
        />

        <app-attribute-entity-editor
          *ngSwitchCase="'personnel'"
          [title]="'Personal'"
          [entities]="personnelRecords()"
          [attributeDefinitions]="personnelDefinitions()"
          [defaultFallbackValues]="personnelDefaults"
          [detailError]="personnelError()"
          [groupedEntities]="personnelGroups()"
          [createDefaultsFactory]="personnelCreateDefaultsFactory"
          [selectOptions]="personnelSelectOptions()"
          (saveEntity)="handlePersonnelSave($event)"
          (deleteEntities)="handlePersonnelDelete($event)"
        />
      </ng-container>
    </section>
  `,
  styles: [
    `
      .personnel-editor {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      header {
        display: flex;
        justify-content: flex-start;
      }

      mat-button-toggle-group {
        border-radius: 999px;
      }

      mat-button-toggle {
        text-transform: none;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonnelMasterEditorComponent {
  private readonly collections = inject(MasterDataCollectionsStoreService);
  private readonly resources = inject(MasterDataResourceStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly viewMode = signal<PersonnelEditorMode>('servicePools');

  readonly servicePoolDefaults = SERVICE_POOL_DEFAULTS;
  readonly personnelPoolDefaults = PERSONNEL_POOL_DEFAULTS;
  readonly serviceDefaults = PERSONNEL_SERVICE_DEFAULTS;
  readonly personnelDefaults = PERSONNEL_DEFAULTS;

  readonly servicePoolRequiredKeys = ['name'];
  readonly personnelPoolRequiredKeys = ['name'];
  readonly servicePoolOptions = computed(() =>
    this.collections.personnelServicePools().map((pool) => ({
      value: pool.id,
      label: pool.name ?? pool.id,
    })),
  );
  readonly personnelPoolOptions = computed(() =>
    this.collections.personnelPools().map((pool) => ({
      value: pool.id,
      label: pool.name ?? pool.id,
    })),
  );
  readonly serviceSelectOptions = computed(() => ({
    poolId: this.servicePoolOptions(),
  }));
  readonly personnelSelectOptions = computed(() => ({
    poolId: this.personnelPoolOptions(),
  }));

  readonly servicePoolDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(SERVICE_POOL_BASE_DEFINITIONS, this.customAttributes.list('personnel-service-pools')),
  );

  readonly personnelPoolDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(PERSONNEL_POOL_BASE_DEFINITIONS, this.customAttributes.list('personnel-pools')),
  );

  readonly serviceDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(PERSONNEL_SERVICE_BASE_DEFINITIONS, this.customAttributes.list('personnel-services')),
  );

  readonly personnelDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(PERSONNEL_BASE_DEFINITIONS, this.customAttributes.list('personnel')),
  );

  readonly servicePoolRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections.personnelServicePools().map((pool) => ({
      id: pool.id,
      label: pool.name ?? pool.id,
      secondaryLabel: pool.description ?? '',
      attributes: [],
      fallbackValues: {
        name: pool.name ?? '',
        description: pool.description ?? '',
        shiftCoordinator: pool.shiftCoordinator ?? '',
        contactEmail: pool.contactEmail ?? '',
      },
    })),
  );

  readonly serviceRecords = computed<AttributeEntityRecord[]>(() =>
    this.resources.personnelServices().map((service) => ({
      id: service.id,
      label: service.name ?? service.id,
      secondaryLabel: service.poolId ? `Pool ${service.poolId}` : 'kein Pool',
      attributes: [],
      fallbackValues: {
        name: service.name ?? '',
        description: service.description ?? '',
        poolId: service.poolId ?? '',
        startTime: service.startTime ?? '',
        endTime: service.endTime ?? '',
        isNightService: service.isNightService ? 'true' : 'false',
        requiredQualifications: (service.requiredQualifications ?? []).join(', '),
        maxDailyInstances: service.maxDailyInstances != null ? String(service.maxDailyInstances) : '',
        maxResourcesPerInstance:
          service.maxResourcesPerInstance != null ? String(service.maxResourcesPerInstance) : '',
      },
    })),
  );

  readonly personnelPoolRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections.personnelPools().map((pool) => ({
      id: pool.id,
      label: pool.name ?? pool.id,
      secondaryLabel: pool.description ?? '',
      attributes: [],
      fallbackValues: {
        name: pool.name ?? '',
        description: pool.description ?? '',
        locationCode: pool.locationCode ?? '',
      },
    })),
  );

  readonly personnelRecords = computed<AttributeEntityRecord[]>(() =>
    this.resources.personnel().map((person) => ({
      id: person.id,
      label: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || person.id,
      secondaryLabel: person.poolId ? `Pool ${person.poolId}` : 'kein Pool',
      attributes: [],
      fallbackValues: {
        firstName: (person.firstName as string) ?? '',
        lastName: person.lastName ?? '',
        preferredName: (person.preferredName as string) ?? '',
        qualifications: (person.qualifications ?? []).join(', '),
        serviceIds: (person.serviceIds ?? []).join(', '),
        poolId: person.poolId ?? '',
        homeStation: person.homeStation ?? '',
        availabilityStatus: person.availabilityStatus ?? '',
        qualificationExpires: person.qualificationExpires ?? '',
        isReserve: person.isReserve ? 'true' : 'false',
      },
    })),
  );
  readonly serviceGroups = computed<AttributeEntityGroup[]>(() => {
    const pools = this.collections.personnelServicePools();
    const services = this.serviceRecords();
    const groups: AttributeEntityGroup[] = pools.map((pool) => ({
      id: pool.id,
      label: pool.name ?? pool.id,
      secondaryLabel: pool.description ?? '',
      children: services.filter((service) => (service.fallbackValues['poolId'] ?? '') === pool.id),
    }));
    const unassigned = services.filter((service) => !(service.fallbackValues['poolId'] ?? '').trim());
    if (unassigned.length) {
      groups.push({
        id: UNASSIGNED_SERVICE_GROUP,
        label: 'Ohne Pool',
        secondaryLabel: 'Dienste ohne Zuordnung',
        children: unassigned,
      });
    }
    return groups;
  });

  readonly personnelGroups = computed<AttributeEntityGroup[]>(() => {
    const pools = this.collections.personnelPools();
    const persons = this.personnelRecords();
    const groups: AttributeEntityGroup[] = pools.map((pool) => ({
      id: pool.id,
      label: pool.name ?? pool.id,
      secondaryLabel: pool.description ?? '',
      children: persons.filter((person) => (person.fallbackValues['poolId'] ?? '') === pool.id),
    }));
    const unassigned = persons.filter((person) => !(person.fallbackValues['poolId'] ?? '').trim());
    if (unassigned.length) {
      groups.push({
        id: UNASSIGNED_PERSONNEL_GROUP,
        label: 'Ohne Pool',
        secondaryLabel: 'Personal ohne Zuordnung',
        children: unassigned,
      });
    }
    return groups;
  });
  readonly servicePoolError = signal<string | null>(null);
  readonly personnelPoolError = signal<string | null>(null);
  readonly serviceError = signal<string | null>(null);
  readonly personnelError = signal<string | null>(null);
  readonly serviceCreateDefaultsFactory = (groupId: string | null): Record<string, string> => {
    if (!groupId || groupId === UNASSIGNED_SERVICE_GROUP) {
      return {};
    }
    return { poolId: groupId };
  };
  readonly personnelCreateDefaultsFactory = (groupId: string | null): Record<string, string> => {
    if (!groupId || groupId === UNASSIGNED_PERSONNEL_GROUP) {
      return {};
    }
    return { poolId: groupId };
  };

  handleServicePoolSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('PSP');
    const values = event.payload.values;
    const name = (values['name'] ?? '').trim();
    if (!name) {
      this.servicePoolError.set('Name darf nicht leer sein.');
      return;
    }
    const list = this.collections.personnelServicePools();
    const existing = list.find((pool) => pool.id === id);
    const updated: PersonnelServicePool = {
      id,
      name,
      description: this.cleanString(values['description']),
      serviceIds: existing?.serviceIds ?? [],
      shiftCoordinator: this.cleanString(values['shiftCoordinator']),
      contactEmail: this.cleanString(values['contactEmail']),
    };
    const next = existing
      ? list.map((pool) => (pool.id === id ? updated : pool))
      : [...list, updated];
    this.collections.syncPersonnelServicePools(next);
    this.servicePoolError.set(null);
  }

  handleServicePoolDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.collections.personnelServicePools().filter((pool) => !set.has(pool.id));
    this.collections.syncPersonnelServicePools(remaining);
    this.detachServicesFromPools(ids);
  }

  handlePersonnelPoolSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('PP');
    const values = event.payload.values;
    const name = (values['name'] ?? '').trim();
    if (!name) {
      this.personnelPoolError.set('Name darf nicht leer sein.');
      return;
    }
    const list = this.collections.personnelPools();
    const existing = list.find((pool) => pool.id === id);
    const updated: PersonnelPool = {
      id,
      name,
      description: this.cleanString(values['description']),
      personnelIds: existing?.personnelIds ?? [],
      locationCode: this.cleanString(values['locationCode']),
    };
    const next = existing
      ? list.map((pool) => (pool.id === id ? updated : pool))
      : [...list, updated];
    this.collections.syncPersonnelPools(next);
    this.personnelPoolError.set(null);
  }

  handlePersonnelPoolDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.collections.personnelPools().filter((pool) => !set.has(pool.id));
    this.collections.syncPersonnelPools(remaining);
    this.detachPersonnelFromPools(ids);
  }

  handleServiceSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('PS');
    const values = event.payload.values;
    const name = (values['name'] ?? '').trim();
    if (!name) {
      this.serviceError.set('Name darf nicht leer sein.');
      return;
    }
    const poolId = (values['poolId'] ?? '').trim();
    if (!poolId) {
      this.serviceError.set('Bitte einen Dienst-Pool auswählen.');
      return;
    }
    if (!this.servicePoolOptions().some((option) => option.value === poolId)) {
      this.serviceError.set('Ungültiger Dienst-Pool.');
      return;
    }
    const updated: PersonnelService = {
      id,
      name,
      description: this.cleanString(values['description']),
      poolId,
      startTime: this.cleanString(values['startTime']),
      endTime: this.cleanString(values['endTime']),
      isNightService: this.parseBoolean(values['isNightService']),
      requiredQualifications: this.parseList(values['requiredQualifications']),
      maxDailyInstances: this.parseNumber(values['maxDailyInstances']),
      maxResourcesPerInstance: this.parseNumber(values['maxResourcesPerInstance']),
    };
    const list = this.resources.personnelServices();
    const next = list.some((service) => service.id === id)
      ? list.map((service) => (service.id === id ? updated : service))
      : [...list, updated];
    this.resources.syncPersonnelServices(next);
    this.serviceError.set(null);
  }

  handleServiceDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.resources
      .personnelServices()
      .filter((service) => !set.has(service.id));
    this.resources.syncPersonnelServices(remaining);
    this.detachServiceReferences(ids);
  }

  handlePersonnelSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('P');
    const values = event.payload.values;
    const firstName = (values['firstName'] ?? '').trim();
    const lastName = (values['lastName'] ?? '').trim();
    if (!firstName || !lastName) {
      this.personnelError.set('Vor- und Nachname sind erforderlich.');
      return;
    }
    const poolId = (values['poolId'] ?? '').trim();
    if (!poolId) {
      this.personnelError.set('Bitte einen Personalpool auswählen.');
      return;
    }
    if (!this.personnelPoolOptions().some((option) => option.value === poolId)) {
      this.personnelError.set('Ungültiger Personalpool.');
      return;
    }
    const updated: Personnel = {
      id,
      firstName,
      lastName,
      preferredName: this.cleanString(values['preferredName']),
      qualifications: this.parseList(values['qualifications']),
      serviceIds: this.parseList(values['serviceIds']),
      poolId,
      homeStation: this.cleanString(values['homeStation']),
      availabilityStatus: this.cleanString(values['availabilityStatus']),
      qualificationExpires: this.cleanString(values['qualificationExpires']),
      isReserve: this.parseBoolean(values['isReserve']),
    };
    const list = this.resources.personnel();
    const next = list.some((person) => person.id === id)
      ? list.map((person) => (person.id === id ? updated : person))
      : [...list, updated];
    this.resources.syncPersonnel(next);
    this.personnelError.set(null);
  }

  handlePersonnelDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.resources.personnel().filter((person) => !set.has(person.id));
    this.resources.syncPersonnel(remaining);
    this.detachPersonFromPools(ids);
  }

  private detachServicesFromPools(poolIds: string[]): void {
    const list = this.resources.personnelServices();
    let changed = false;
    const next = list.map((service) => {
      if (service.poolId && poolIds.includes(service.poolId)) {
        changed = true;
        return { ...service, poolId: undefined };
      }
      return service;
    });
    if (changed) {
      this.resources.syncPersonnelServices(next);
    }
  }

  private detachPersonnelFromPools(poolIds: string[]): void {
    const list = this.resources.personnel();
    let changed = false;
    const next = list.map((person) => {
      if (person.poolId && poolIds.includes(person.poolId)) {
        changed = true;
        return { ...person, poolId: undefined };
      }
      return person;
    });
    if (changed) {
      this.resources.syncPersonnel(next);
    }
  }

  private detachServiceReferences(serviceIds: string[]): void {
    const idSet = new Set(serviceIds);
    const next = this.resources.personnel().map((person) => ({
      ...person,
      serviceIds: (person.serviceIds ?? []).filter((id) => !idSet.has(id)),
    }));
    this.resources.syncPersonnel(next);
  }

  private detachPersonFromPools(personIds: string[]): void {
    const idSet = new Set(personIds);
    const nextPools = this.collections.personnelPools().map((pool) => ({
      ...pool,
      personnelIds: (pool.personnelIds ?? []).filter((id) => !idSet.has(id)),
    }));
    this.collections.syncPersonnelPools(nextPools);
  }

  private cleanString(value: string | undefined): string | undefined {
    const trimmed = (value ?? '').trim();
    return trimmed.length ? trimmed : undefined;
  }

  private parseList(value: string | undefined): string[] {
    if (!value) {
      return [];
    }
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseBoolean(value: string | undefined): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'ja';
  }

  private generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
