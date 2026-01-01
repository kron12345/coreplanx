import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  AttributeEntityGroup,
  EntitySaveEvent,
} from '../../../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { MasterDataCollectionsStoreService } from '../../master-data-collections.store';
import { MasterDataResourceStoreService } from '../../master-data-resource.store';
import { CustomAttributeDefinition, CustomAttributeService } from '../../../../core/services/custom-attribute.service';
import { HomeDepot, Personnel, PersonnelPool, PersonnelService, PersonnelServicePool } from '../../../../models/master-data';
import { PlanningDataService } from '../../../planning/planning-data.service';
import { PlanningStoreService } from '../../../../shared/planning-store.service';
import { AssistantUiContextService } from '../../../../core/services/assistant-ui-context.service';
import { SYSTEM_POOL_IDS, SYSTEM_POOL_LABELS } from '../../system-pools';

type PersonnelEditorMode =
  | 'servicePools'
  | 'services'
  | 'personnelPools'
  | 'homeDepots'
  | 'personnel'
  | 'system';

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
  {
    id: 'psp-home-depot',
    key: 'homeDepotId',
    label: 'Heimdepot',
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
    id: 'pp-home-depot',
    key: 'homeDepotId',
    label: 'Heimdepot',
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
    label: 'Dienste',
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

const HOME_DEPOT_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'hd-name',
    key: 'name',
    label: 'Name',
    type: 'string',
    entityId: 'home-depots',
    required: true,
  },
  {
    id: 'hd-description',
    key: 'description',
    label: 'Beschreibung',
    type: 'string',
    entityId: 'home-depots',
  },
  {
    id: 'hd-sites',
    key: 'siteIds',
    label: 'Start/Endstellen (Personnel Site)',
    type: 'string',
    entityId: 'home-depots',
    required: true,
  },
  {
    id: 'hd-break-sites',
    key: 'breakSiteIds',
    label: 'Pausenräume (Personnel Site)',
    type: 'string',
    entityId: 'home-depots',
  },
  {
    id: 'hd-short-break-sites',
    key: 'shortBreakSiteIds',
    label: 'Kurzpausenräume (Personnel Site)',
    type: 'string',
    entityId: 'home-depots',
  },
  {
    id: 'hd-overnight-sites',
    key: 'overnightSiteIds',
    label: 'Übernachtung (Personnel Site)',
    type: 'string',
    entityId: 'home-depots',
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

const HOME_DEPOT_DEFAULTS = {
  name: 'Depot Berlin (Beispiel)',
  description: 'Start/Ende sowie Pausenräume für das Team Berlin.',
  siteIds: '',
  breakSiteIds: '',
  shortBreakSiteIds: '',
  overnightSiteIds: '',
};

@Component({
    selector: 'app-personnel-master-editor',
    imports: [
      CommonModule,
      MatButtonModule,
      MatButtonToggleModule,
      MatIconModule,
      DragDropModule,
      AttributeEntityEditorComponent,
    ],
    templateUrl: './personnel-master-editor.component.html',
    styleUrl: './personnel-master-editor.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonnelMasterEditorComponent {
  private readonly collections = inject(MasterDataCollectionsStoreService);
  private readonly resources = inject(MasterDataResourceStoreService);
  private readonly customAttributes = inject(CustomAttributeService);
  private readonly planningData = inject(PlanningDataService);
  private readonly planningStore = inject(PlanningStoreService);
  private readonly assistantUiContext = inject(AssistantUiContextService);

  readonly viewMode = signal<PersonnelEditorMode>('servicePools');

  private readonly initTopologyForHomeDepots = effect(() => {
    if (this.viewMode() === 'homeDepots') {
      this.planningStore.ensureInitialized();
    }
  });

  private readonly updateAssistantContext = effect(() => {
    const isActive = this.assistantUiContext.docKey() === 'personnel';
    if (!isActive) {
      return;
    }
    const mode = this.viewMode();
    const subtopic = this.resolveModeLabel(mode);
    this.assistantUiContext.setDocKey('personnel');
    this.assistantUiContext.setDocSubtopic(subtopic);
    this.assistantUiContext.setBreadcrumbs(['Stammdaten', 'Personal', subtopic]);
    this.assistantUiContext.setDataSummary(this.buildAssistantDataSummary(mode));
  });

  readonly servicePoolDefaults = SERVICE_POOL_DEFAULTS;
  readonly personnelPoolDefaults = PERSONNEL_POOL_DEFAULTS;
  readonly homeDepotDefaults = HOME_DEPOT_DEFAULTS;
  readonly serviceDefaults = PERSONNEL_SERVICE_DEFAULTS;
  readonly personnelDefaults = PERSONNEL_DEFAULTS;

  readonly servicePoolRequiredKeys = ['name'];
  readonly personnelPoolRequiredKeys = ['name'];
  readonly homeDepotRequiredKeys = ['name', 'siteIds'];
  readonly servicePoolOptions = computed(() =>
    this.collections
      .personnelServicePools()
      .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelServicePool)
      .map((pool) => ({
        value: pool.id,
        label: pool.name ?? pool.id,
      })),
  );
  readonly personnelPoolOptions = computed(() =>
    this.collections
      .personnelPools()
      .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelPool)
      .map((pool) => ({
        value: pool.id,
        label: pool.name ?? pool.id,
      })),
  );
  readonly homeDepotOptions = computed(() =>
    [
      { value: '', label: '— kein Heimdepot —' },
      ...this.collections.homeDepots().map((depot) => ({
        value: depot.id,
        label: depot.name ?? depot.id,
      })),
    ],
  );
  readonly personnelSiteOptions = computed(() =>
    this.planningStore
      .personnelSites()
      .map((site) => ({
        value: site.siteId,
        label: `${site.name} · ${site.siteType} (${site.siteId})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  readonly poolSelectOptions = computed(() => ({
    homeDepotId: this.homeDepotOptions(),
  }));
  readonly serviceSelectOptions = computed(() => ({
    poolId: [{ value: '', label: '— kein Pool —' }, ...this.servicePoolOptions()],
  }));
  readonly personnelSelectOptions = computed(() => ({
    poolId: [{ value: '', label: '— kein Pool —' }, ...this.personnelPoolOptions()],
  }));
  readonly personnelServiceOptions = computed(() =>
    this.resources
      .personnelServices()
      .filter((service) => service.poolId !== SYSTEM_POOL_IDS.personnelServicePool)
      .map((service) => ({
        value: service.id,
        label: `${service.name ?? service.id} (${service.id})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );
  readonly personnelMultiSelectOptions = computed(() => ({
    serviceIds: this.personnelServiceOptions(),
  }));
  readonly homeDepotMultiSelectOptions = computed(() => {
    const options = this.personnelSiteOptions();
    return {
      siteIds: options,
      breakSiteIds: options,
      shortBreakSiteIds: options,
      overnightSiteIds: options,
    };
  });

  readonly servicePoolDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(SERVICE_POOL_BASE_DEFINITIONS, this.customAttributes.list('personnel-service-pools')),
  );

  private resolveModeLabel(mode: PersonnelEditorMode): string {
    switch (mode) {
      case 'servicePools':
        return 'Dienstpools';
      case 'services':
        return 'Dienste';
      case 'personnelPools':
        return 'Personalpools';
      case 'homeDepots':
        return 'Heimdepots';
      case 'personnel':
        return 'Personal';
      case 'system':
        return 'System-Pools';
      default:
        return 'Personal';
    }
  }

  private buildAssistantDataSummary(mode: PersonnelEditorMode): string {
    switch (mode) {
      case 'servicePools': {
        const items = this.collections
          .personnelServicePools()
          .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelServicePool);
        return this.formatSummary('Dienstpools', items, (pool) => {
          const name = pool.name ?? pool.id;
          const depot = pool.homeDepotId ? `, homeDepotId=${pool.homeDepotId}` : '';
          return `${pool.id}: ${name}${depot}`;
        });
      }
      case 'services': {
        const items = this.resources
          .personnelServices()
          .filter((service) => service.poolId !== SYSTEM_POOL_IDS.personnelServicePool);
        return this.formatSummary('Dienste', items, (service) => {
          const name = service.name ?? service.id;
          const pool = service.poolId ? `, poolId=${service.poolId}` : '';
          const quals =
            service.requiredQualifications && service.requiredQualifications.length
              ? `, qualis=${service.requiredQualifications.length}`
              : '';
          return `${service.id}: ${name}${pool}${quals}`;
        });
      }
      case 'personnelPools': {
        const items = this.collections
          .personnelPools()
          .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelPool);
        return this.formatSummary('Personalpools', items, (pool) => {
          const name = pool.name ?? pool.id;
          const location = pool.locationCode ? `, location=${pool.locationCode}` : '';
          const depot = pool.homeDepotId ? `, homeDepotId=${pool.homeDepotId}` : '';
          return `${pool.id}: ${name}${location}${depot}`;
        });
      }
      case 'homeDepots': {
        const items = this.collections.homeDepots();
        return this.formatSummary('Heimdepots', items, (depot) => {
          const name = depot.name ?? depot.id;
          const sites =
            depot.siteIds && depot.siteIds.length ? `, sites=${depot.siteIds.length}` : '';
          return `${depot.id}: ${name}${sites}`;
        });
      }
      case 'personnel': {
        const items = this.resources
          .personnel()
          .filter((person) => person.poolId !== SYSTEM_POOL_IDS.personnelPool);
        return this.formatSummary('Personal', items, (person) => {
          const firstName = typeof person.firstName === 'string' ? person.firstName : '';
          const lastName = person.lastName ?? '';
          const pool = person.poolId ? `, poolId=${person.poolId}` : '';
          return `${person.id}: ${`${firstName} ${lastName}`.trim() || '—'}${pool}`;
        });
      }
      case 'system': {
        const systemServiceCount = this.resources.personnelServices().filter(
          (service) => service.poolId === SYSTEM_POOL_IDS.personnelServicePool,
        ).length;
        const systemPersonnelCount = this.resources.personnel().filter(
          (person) => person.poolId === SYSTEM_POOL_IDS.personnelPool,
        ).length;
        return `System-Pools\nPersonaldienste: ${systemServiceCount}\nPersonal: ${systemPersonnelCount}`;
      }
      default:
        return '';
    }
  }

  private formatSummary<T>(
    title: string,
    items: readonly T[],
    formatItem: (item: T) => string,
  ): string {
    const limit = 6;
    const lines = items.slice(0, limit).map((item) => `- ${formatItem(item)}`);
    const remaining = items.length > limit ? `\n- … (+${items.length - limit} weitere)` : '';
    return `Aktuelle Liste: ${title}\nAnzahl: ${items.length}${lines.length ? `\n${lines.join('\n')}${remaining}` : ''}`;
  }

  readonly personnelPoolDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(PERSONNEL_POOL_BASE_DEFINITIONS, this.customAttributes.list('personnel-pools')),
  );

  readonly homeDepotDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(HOME_DEPOT_BASE_DEFINITIONS, this.customAttributes.list('home-depots')),
  );

  readonly serviceDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(PERSONNEL_SERVICE_BASE_DEFINITIONS, this.customAttributes.list('personnel-services')),
  );

  readonly personnelDefinitions = computed<CustomAttributeDefinition[]>(() =>
    mergeDefinitions(PERSONNEL_BASE_DEFINITIONS, this.customAttributes.list('personnel')),
  );

  readonly servicePoolRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections
      .personnelServicePools()
      .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelServicePool)
      .map((pool) => ({
        id: pool.id,
        label: pool.name ?? pool.id,
        secondaryLabel: pool.description ?? '',
        attributes: [],
        fallbackValues: {
          name: pool.name ?? '',
          description: pool.description ?? '',
          homeDepotId: pool.homeDepotId ?? '',
          shiftCoordinator: pool.shiftCoordinator ?? '',
          contactEmail: pool.contactEmail ?? '',
        },
      })),
  );

  readonly serviceRecords = computed<AttributeEntityRecord[]>(() =>
    this.resources
      .personnelServices()
      .filter((service) => service.poolId !== SYSTEM_POOL_IDS.personnelServicePool)
      .map((service) => ({
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
    this.collections
      .personnelPools()
      .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelPool)
      .map((pool) => ({
        id: pool.id,
        label: pool.name ?? pool.id,
        secondaryLabel: pool.description ?? '',
        attributes: [],
        fallbackValues: {
          name: pool.name ?? '',
          description: pool.description ?? '',
          homeDepotId: pool.homeDepotId ?? '',
          locationCode: pool.locationCode ?? '',
        },
      })),
  );

  readonly homeDepotRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections.homeDepots().map((depot) => ({
      id: depot.id,
      label: depot.name ?? depot.id,
      secondaryLabel: depot.description ?? '',
      attributes: [],
      fallbackValues: {
        name: depot.name ?? '',
        description: depot.description ?? '',
        siteIds: (depot.siteIds ?? []).join(', '),
        breakSiteIds: (depot.breakSiteIds ?? []).join(', '),
        shortBreakSiteIds: (depot.shortBreakSiteIds ?? []).join(', '),
        overnightSiteIds: (depot.overnightSiteIds ?? []).join(', '),
      },
    })),
  );

  readonly personnelRecords = computed<AttributeEntityRecord[]>(() =>
    this.resources
      .personnel()
      .filter((person) => person.poolId !== SYSTEM_POOL_IDS.personnelPool)
      .map((person) => ({
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
    const pools = this.collections
      .personnelServicePools()
      .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelServicePool);
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
    const pools = this.collections
      .personnelPools()
      .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelPool);
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

  readonly systemPoolLabels = SYSTEM_POOL_LABELS;
  readonly systemPoolIds = SYSTEM_POOL_IDS;
  readonly systemServiceItems = computed(() =>
    this.resources
      .personnelServices()
      .filter((service) => service.poolId === SYSTEM_POOL_IDS.personnelServicePool),
  );
  readonly systemPersonnelItems = computed(() =>
    this.resources.personnel().filter((person) => person.poolId === SYSTEM_POOL_IDS.personnelPool),
  );
  readonly serviceCountByPool = computed(() => {
    const counts = new Map<string, number>();
    this.resources.personnelServices().forEach((service) => {
      if (!service.poolId) {
        return;
      }
      counts.set(service.poolId, (counts.get(service.poolId) ?? 0) + 1);
    });
    return counts;
  });
  readonly personnelCountByPool = computed(() => {
    const counts = new Map<string, number>();
    this.resources.personnel().forEach((person) => {
      if (!person.poolId) {
        return;
      }
      counts.set(person.poolId, (counts.get(person.poolId) ?? 0) + 1);
    });
    return counts;
  });
  readonly servicePoolTargets = computed(() =>
    this.collections
      .personnelServicePools()
      .filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelServicePool),
  );
  readonly personnelPoolTargets = computed(() =>
    this.collections.personnelPools().filter((pool) => pool.id !== SYSTEM_POOL_IDS.personnelPool),
  );
  readonly servicePoolError = signal<string | null>(null);
  readonly personnelPoolError = signal<string | null>(null);
  readonly homeDepotError = signal<string | null>(null);
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
      homeDepotId: this.cleanString(values['homeDepotId']),
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
      homeDepotId: this.cleanString(values['homeDepotId']),
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

  handleHomeDepotSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('HD');
    const values = event.payload.values;
    const name = (values['name'] ?? '').trim();
    if (!name) {
      this.homeDepotError.set('Name darf nicht leer sein.');
      return;
    }
    const siteIds = this.parseList(values['siteIds']);
    if (!siteIds.length) {
      this.homeDepotError.set('Mindestens eine Start/Endstelle (siteId) angeben.');
      return;
    }
    const list = this.collections.homeDepots();
    const existing = list.find((depot) => depot.id === id);
    const updated: HomeDepot = {
      id,
      name,
      description: this.cleanString(values['description']),
      siteIds,
      breakSiteIds: this.parseList(values['breakSiteIds']),
      shortBreakSiteIds: this.parseList(values['shortBreakSiteIds']),
      overnightSiteIds: this.parseList(values['overnightSiteIds']),
      attributes: existing?.attributes,
    };
    const next = existing ? list.map((depot) => (depot.id === id ? updated : depot)) : [...list, updated];
    this.collections.syncHomeDepots(next);
    this.homeDepotError.set(null);
  }

  handleHomeDepotDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.collections.homeDepots().filter((depot) => !set.has(depot.id));
    this.collections.syncHomeDepots(remaining);
    this.detachHomeDepotReferences(ids);
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

  handleSystemServiceDrop(event: CdkDragDrop<string>): void {
    const serviceId = String(event.item.data ?? '').trim();
    const targetPoolId = String(event.container.data ?? '').trim();
    if (!serviceId || !targetPoolId) {
      return;
    }
    if (targetPoolId === SYSTEM_POOL_IDS.personnelServicePool) {
      return;
    }
    this.moveServiceToPool(serviceId, targetPoolId);
  }

  handleSystemPersonnelDrop(event: CdkDragDrop<string>): void {
    const personnelId = String(event.item.data ?? '').trim();
    const targetPoolId = String(event.container.data ?? '').trim();
    if (!personnelId || !targetPoolId) {
      return;
    }
    if (targetPoolId === SYSTEM_POOL_IDS.personnelPool) {
      return;
    }
    this.movePersonnelToPool(personnelId, targetPoolId);
  }

  resetToDefaults(): void {
    if (!this.confirmFactoryReset('Personal-Stammdaten')) {
      return;
    }
    this.planningData.resetResourceSnapshotToDefaults('personnel');
  }

  private moveServiceToPool(serviceId: string, poolId: string): void {
    const list = this.resources.personnelServices();
    const next = list.map((service) =>
      service.id === serviceId ? { ...service, poolId } : service,
    );
    this.resources.syncPersonnelServices(next);
  }

  private movePersonnelToPool(personnelId: string, poolId: string): void {
    const list = this.resources.personnel();
    const next = list.map((person) =>
      person.id === personnelId ? { ...person, poolId } : person,
    );
    this.resources.syncPersonnel(next);
  }

  private detachServicesFromPools(poolIds: string[]): void {
    const list = this.resources.personnelServices();
    let changed = false;
    const next = list.map((service) => {
      if (service.poolId && poolIds.includes(service.poolId)) {
        changed = true;
        return { ...service, poolId: SYSTEM_POOL_IDS.personnelServicePool };
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
        return { ...person, poolId: SYSTEM_POOL_IDS.personnelPool };
      }
      return person;
    });
    if (changed) {
      this.resources.syncPersonnel(next);
    }
  }

  private detachHomeDepotReferences(homeDepotIds: string[]): void {
    const idSet = new Set(homeDepotIds);
    const servicePools = this.collections.personnelServicePools();
    const personnelPools = this.collections.personnelPools();
    let servicePoolsChanged = false;
    let personnelPoolsChanged = false;

    const nextServicePools = servicePools.map((pool) => {
      if (pool.homeDepotId && idSet.has(pool.homeDepotId)) {
        servicePoolsChanged = true;
        return { ...pool, homeDepotId: undefined };
      }
      return pool;
    });
    const nextPersonnelPools = personnelPools.map((pool) => {
      if (pool.homeDepotId && idSet.has(pool.homeDepotId)) {
        personnelPoolsChanged = true;
        return { ...pool, homeDepotId: undefined };
      }
      return pool;
    });

    if (servicePoolsChanged) {
      this.collections.syncPersonnelServicePools(nextServicePools);
    }
    if (personnelPoolsChanged) {
      this.collections.syncPersonnelPools(nextPersonnelPools);
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

  formatPersonnelLabel(person: Personnel): string {
    const firstName = typeof person.firstName === 'string' ? person.firstName : '';
    const lastName = person.lastName ?? '';
    return `${firstName} ${lastName}`.trim() || person.id;
  }

  private generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private confirmFactoryReset(scopeLabel: string): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.confirm(
      `${scopeLabel}: Werkseinstellungen wiederherstellen?\n\nAlle Änderungen in diesem Bereich werden überschrieben.`,
    );
  }
}
