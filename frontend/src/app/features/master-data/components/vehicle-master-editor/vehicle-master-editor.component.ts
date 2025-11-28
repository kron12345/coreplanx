import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import {
  AttributeEntityEditorComponent,
  AttributeEntityGroup,
  AttributeEntityRecord,
  EntitySaveEvent,
} from '../../../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { MasterDataCollectionsStoreService } from '../../master-data-collections.store';
import { MasterDataResourceStoreService } from '../../master-data-resource.store';
import { CustomAttributeDefinition, CustomAttributeService } from '../../../../core/services/custom-attribute.service';
import {
  Vehicle,
  VehicleComposition,
  VehicleCompositionEntry,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
} from '../../../../models/master-data';

type VehicleEditorMode =
  | 'servicePools'
  | 'services'
  | 'vehiclePools'
  | 'vehicles'
  | 'vehicleTypes'
  | 'compositions';

const VEHICLE_SERVICE_POOL_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  { id: 'vsp-name', key: 'name', label: 'Poolname', type: 'string', entityId: 'vehicle-service-pools', required: true },
  { id: 'vsp-description', key: 'description', label: 'Beschreibung', type: 'string', entityId: 'vehicle-service-pools' },
  { id: 'vsp-dispatcher', key: 'dispatcher', label: 'Leitstelle', type: 'string', entityId: 'vehicle-service-pools' },
];

const VEHICLE_SERVICE_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  { id: 'vs-name', key: 'name', label: 'Dienstname', type: 'string', entityId: 'vehicle-services', required: true },
  { id: 'vs-description', key: 'description', label: 'Beschreibung', type: 'string', entityId: 'vehicle-services' },
  { id: 'vs-pool', key: 'poolId', label: 'Pool-ID', type: 'string', entityId: 'vehicle-services' },
  { id: 'vs-start', key: 'startTime', label: 'Startzeit', type: 'time', entityId: 'vehicle-services' },
  { id: 'vs-end', key: 'endTime', label: 'Endzeit', type: 'time', entityId: 'vehicle-services' },
  { id: 'vs-overnight', key: 'isOvernight', label: 'Mit Nachtlage', type: 'boolean', entityId: 'vehicle-services' },
  { id: 'vs-primary-route', key: 'primaryRoute', label: 'Hauptlaufweg', type: 'string', entityId: 'vehicle-services' },
];

const VEHICLE_POOL_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  { id: 'vp-name', key: 'name', label: 'Poolname', type: 'string', entityId: 'vehicle-pools', required: true },
  { id: 'vp-description', key: 'description', label: 'Beschreibung', type: 'string', entityId: 'vehicle-pools' },
  { id: 'vp-depot', key: 'depotManager', label: 'Depotleitung', type: 'string', entityId: 'vehicle-pools' },
];

const VEHICLE_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  { id: 'veh-number', key: 'vehicleNumber', label: 'Fahrzeugnummer', type: 'string', entityId: 'vehicle', required: true },
  { id: 'veh-type', key: 'typeId', label: 'Fahrzeugtyp', type: 'string', entityId: 'vehicle', required: true },
  { id: 'veh-service-ids', key: 'serviceIds', label: 'Dienst-IDs (kommagetrennt)', type: 'string', entityId: 'vehicle' },
  { id: 'veh-pool', key: 'poolId', label: 'Pool-ID', type: 'string', entityId: 'vehicle' },
  { id: 'veh-description', key: 'description', label: 'Beschreibung', type: 'string', entityId: 'vehicle' },
  { id: 'veh-depot', key: 'depot', label: 'Depot', type: 'string', entityId: 'vehicle' },
];

const VEHICLE_CATEGORY_OPTIONS = [
  { label: 'Lokomotive', value: 'Lokomotive' },
  { label: 'Wagen', value: 'Wagen' },
  { label: 'Triebzug', value: 'Triebzug' },
];

const BRAKE_TYPE_OPTIONS = [
  { label: 'KE-GPR-E mZ', value: 'KE-GPR-E mZ' },
  { label: 'KE-GPR mZ', value: 'KE-GPR mZ' },
  { label: 'KE-RA-Mg', value: 'KE-RA-Mg' },
  { label: 'KE-R-A (S-Bahn)', value: 'KE-R-A (S-Bahn)' },
];

const TILTING_OPTIONS = [
  { label: 'Keine', value: 'none' },
  { label: 'Passiv', value: 'passive' },
  { label: 'Aktiv', value: 'active' },
];

const ETCS_LEVEL_OPTIONS = [
  { label: 'Kein ETCS', value: 'Kein ETCS' },
  { label: 'ETCS Level 1', value: 'ETCS Level 1' },
  { label: 'ETCS Level 2 Baseline 3', value: 'ETCS Level 2 Baseline 3' },
];

const GAUGE_PROFILE_OPTIONS = [
  { label: 'G1', value: 'G1' },
  { label: 'G2', value: 'G2' },
  { label: 'GA', value: 'GA' },
  { label: 'GB1', value: 'GB1' },
  { label: 'GB2', value: 'GB2' },
  { label: 'S-Bahn Berlin', value: 'S-Bahn Berlin' },
];

const VEHICLE_TYPE_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  { id: 'vt-label', key: 'label', label: 'Bezeichnung', type: 'string', entityId: 'vehicle-types', required: true },
  { id: 'vt-category', key: 'category', label: 'Kategorie', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-capacity', key: 'capacity', label: 'Kapazität (Sitzplätze)', type: 'number', entityId: 'vehicle-types' },
  { id: 'vt-train-type', key: 'trainTypeCode', label: 'TTT Train Type', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-length', key: 'lengthMeters', label: 'Länge (m)', type: 'number', entityId: 'vehicle-types' },
  { id: 'vt-weight', key: 'weightTons', label: 'Masse (t)', type: 'number', entityId: 'vehicle-types' },
  { id: 'vt-brake', key: 'brakeType', label: 'Bremssystem', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-brake-percentage', key: 'brakePercentage', label: 'Bremshundertstel (%)', type: 'number', entityId: 'vehicle-types' },
  { id: 'vt-tilting', key: 'tiltingCapability', label: 'Neigetechnik', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-power', key: 'powerSupplySystems', label: 'Energieversorgung (kommagetrennt)', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-protection', key: 'trainProtectionSystems', label: 'Zugsicherungssysteme (kommagetrennt)', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-etcs', key: 'etcsLevel', label: 'ETCS-Level', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-gauge', key: 'gaugeProfile', label: 'Lichtraumprofil', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-max-speed', key: 'maxSpeed', label: 'Höchstgeschwindigkeit (km/h)', type: 'number', entityId: 'vehicle-types' },
  {
    id: 'vt-maintenance',
    key: 'maintenanceIntervalDays',
    label: 'Wartungsintervall (Tage)',
    type: 'number',
    entityId: 'vehicle-types',
  },
  { id: 'vt-energy', key: 'energyType', label: 'Energieart', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-manufacturer', key: 'manufacturer', label: 'Hersteller', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-axle', key: 'maxAxleLoad', label: 'Max. Achslast (t)', type: 'number', entityId: 'vehicle-types' },
  { id: 'vt-noise', key: 'noiseCategory', label: 'Lärmkategorie', type: 'string', entityId: 'vehicle-types' },
  { id: 'vt-remarks', key: 'remarks', label: 'Hinweise', type: 'string', entityId: 'vehicle-types' },
];

const VEHICLE_COMPOSITION_BASE_DEFINITIONS: CustomAttributeDefinition[] = [
  { id: 'vc-name', key: 'name', label: 'Name', type: 'string', entityId: 'vehicle-compositions', required: true },
  {
    id: 'vc-entries',
    key: 'entriesSerialized',
    label: 'Zusammenstellung (Typ:Anzahl pro Zeile)',
    type: 'string',
    entityId: 'vehicle-compositions',
  },
  { id: 'vc-turnaround', key: 'turnaroundBuffer', label: 'Wendezeit-Puffer', type: 'time', entityId: 'vehicle-compositions' },
  { id: 'vc-remark', key: 'remark', label: 'Bemerkung', type: 'string', entityId: 'vehicle-compositions' },
];

const VEHICLE_SERVICE_POOL_DEFAULTS = {
  name: 'IC Nord',
  description: 'Disposition für die Umläufe Hamburg – Köln',
  dispatcher: 'Leitstelle Hannover',
};
const VEHICLE_SERVICE_DEFAULTS = {
  name: 'IC 2070 Tagesumlauf',
  description: 'Hamburg Hbf → Köln Hbf',
  poolId: 'ic-nord',
  startTime: '04:45',
  endTime: '13:30',
  isOvernight: 'false',
  primaryRoute: 'Hamburg – Köln',
};
const VEHICLE_POOL_DEFAULTS = {
  name: 'Depot Hamburg',
  description: 'IC-Fahrzeuge Nord',
  depotManager: 'Depot HH-Eidelstedt',
};
const VEHICLE_DEFAULTS = {
  vehicleNumber: '4010 001-5',
  typeId: 'ICE4-12',
  serviceIds: 'IC2070,IC2071',
  poolId: 'depot-hamburg',
  description: 'Langläufer Hamburg – Köln',
  depot: 'Hamburg-Eidelstedt',
};
const VEHICLE_TYPE_DEFAULTS = {
  label: 'ICE 4 (12-teilig)',
  category: 'Triebzug',
  capacity: '830',
  trainTypeCode: 'ICE4-12',
  lengthMeters: '346',
  weightTons: '670',
  brakeType: 'KE-GPR-E mZ',
  brakePercentage: '150',
  tiltingCapability: 'none',
  powerSupplySystems: '15kV/16.7Hz,25kV/50Hz',
  trainProtectionSystems: 'PZB,LZB,ETCS',
  etcsLevel: 'ETCS Level 2',
  gaugeProfile: 'G2',
  maxSpeed: '250',
  maintenanceIntervalDays: '30',
  energyType: 'electric',
  manufacturer: 'Siemens',
  maxAxleLoad: '17',
  noiseCategory: 'TSI HL',
  remarks: 'Demo-Typ für Tests',
};
const VEHICLE_COMPOSITION_DEFAULTS = {
  name: 'ICE 4 Doppelführung',
  entriesSerialized: 'ICE4-12:1\nICE4-7:1',
  turnaroundBuffer: '00:20',
  remark: 'Zuglänge 19 Teile, benötigt Bahnsteiglänge 400m',
};

const UNASSIGNED_SERVICE_GROUP = '__unassigned-vehicle-services';
const UNASSIGNED_VEHICLE_GROUP = '__unassigned-vehicles';

const VEHICLE_TYPE_NUMERIC_KEYS = [
  'capacity',
  'lengthMeters',
  'weightTons',
  'brakePercentage',
  'maxSpeed',
  'maintenanceIntervalDays',
  'maxAxleLoad',
];

const VEHICLE_TYPE_SELECT_OPTIONS: Record<string, { label: string; value: string }[]> = {
  category: VEHICLE_CATEGORY_OPTIONS,
  brakeType: BRAKE_TYPE_OPTIONS,
  tiltingCapability: TILTING_OPTIONS,
  etcsLevel: ETCS_LEVEL_OPTIONS,
  gaugeProfile: GAUGE_PROFILE_OPTIONS,
};

function mergeDefinitions(
  base: CustomAttributeDefinition[],
  custom: CustomAttributeDefinition[],
): CustomAttributeDefinition[] {
  const map = new Map<string, CustomAttributeDefinition>();
  base.forEach((definition) => map.set(definition.key, definition));
  custom.forEach((definition) => map.set(definition.key, definition));
  return Array.from(map.values());
}

@Component({
  selector: 'app-vehicle-master-editor',
  standalone: true,
  imports: [CommonModule, MatButtonToggleModule, MatIconModule, AttributeEntityEditorComponent],
  templateUrl: './vehicle-master-editor.component.html',
  styleUrl: './vehicle-master-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VehicleMasterEditorComponent {
  private readonly collections = inject(MasterDataCollectionsStoreService);
  private readonly resources = inject(MasterDataResourceStoreService);
  private readonly customAttributes = inject(CustomAttributeService);

  readonly viewMode = signal<VehicleEditorMode>('servicePools');

  readonly servicePoolDefinitions = computed(() =>
    mergeDefinitions(VEHICLE_SERVICE_POOL_BASE_DEFINITIONS, this.customAttributes.list('vehicle-service-pools')),
  );
  readonly serviceDefinitions = computed(() =>
    mergeDefinitions(VEHICLE_SERVICE_BASE_DEFINITIONS, this.customAttributes.list('vehicle-services')),
  );
  readonly vehiclePoolDefinitions = computed(() =>
    mergeDefinitions(VEHICLE_POOL_BASE_DEFINITIONS, this.customAttributes.list('vehicle-pools')),
  );
  readonly vehicleDefinitions = computed(() =>
    mergeDefinitions(VEHICLE_BASE_DEFINITIONS, this.customAttributes.list('vehicles')),
  );
  readonly vehicleTypeDefinitions = computed(() =>
    mergeDefinitions(VEHICLE_TYPE_BASE_DEFINITIONS, this.customAttributes.list('vehicle-types')),
  );
  readonly compositionDefinitions = computed(() =>
    mergeDefinitions(VEHICLE_COMPOSITION_BASE_DEFINITIONS, this.customAttributes.list('vehicle-compositions')),
  );

  readonly servicePoolRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections.vehicleServicePools().map((pool) => ({
      id: pool.id,
      label: pool.name ?? pool.id,
      secondaryLabel: pool.description ?? '',
      attributes: [],
      fallbackValues: {
        name: pool.name ?? '',
        description: pool.description ?? '',
        dispatcher: pool.dispatcher ?? '',
      },
    })),
  );
  readonly serviceRecords = computed<AttributeEntityRecord[]>(() =>
    this.resources.vehicleServices().map((service) => ({
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
        isOvernight: service.isOvernight ? 'true' : 'false',
        primaryRoute: service.primaryRoute ?? '',
      },
    })),
  );
  readonly vehiclePoolRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections.vehiclePools().map((pool) => ({
      id: pool.id,
      label: pool.name ?? pool.id,
      secondaryLabel: pool.description ?? '',
      attributes: [],
      fallbackValues: {
        name: pool.name ?? '',
        description: pool.description ?? '',
        depotManager: pool.depotManager ?? '',
      },
    })),
  );
  readonly vehicleRecords = computed<AttributeEntityRecord[]>(() =>
    this.resources.vehicles().map((vehicle) => ({
      id: vehicle.id,
      label: vehicle.vehicleNumber ?? vehicle.id,
      secondaryLabel: vehicle.poolId ? `Pool ${vehicle.poolId}` : 'kein Pool',
      attributes: [],
      fallbackValues: {
        vehicleNumber: vehicle.vehicleNumber ?? '',
        typeId: vehicle.typeId ?? '',
        serviceIds: (vehicle.serviceIds ?? []).join(', '),
        poolId: vehicle.poolId ?? '',
        description: vehicle.description ?? '',
        depot: vehicle.depot ?? '',
      },
    })),
  );
  readonly vehicleTypeLabelMap = computed(() =>
    new Map(this.collections.vehicleTypes().map((type) => [type.id, type.label ?? type.id] as const)),
  );
  readonly vehicleTypeRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections.vehicleTypes().map((type) => ({
      id: type.id,
      label: type.label ?? type.id,
      secondaryLabel: type.category ?? '',
      attributes: [],
      fallbackValues: {
        label: type.label ?? '',
        category: type.category ?? '',
        capacity: this.formatNumber(type.capacity),
        trainTypeCode: type.trainTypeCode ?? '',
        lengthMeters: this.formatNumber(type.lengthMeters),
        weightTons: this.formatNumber(type.weightTons),
        brakeType: type.brakeType ?? '',
        brakePercentage: this.formatNumber(type.brakePercentage),
        tiltingCapability: type.tiltingCapability ?? '',
        powerSupplySystems: (type.powerSupplySystems ?? []).join(', '),
        trainProtectionSystems: (type.trainProtectionSystems ?? []).join(', '),
        etcsLevel: type.etcsLevel ?? '',
        gaugeProfile: type.gaugeProfile ?? '',
        maxSpeed: this.formatNumber(type.maxSpeed),
        maintenanceIntervalDays: this.formatNumber(type.maintenanceIntervalDays),
        energyType: type.energyType ?? '',
        manufacturer: type.manufacturer ?? '',
        maxAxleLoad: this.formatNumber(type.maxAxleLoad),
        noiseCategory: type.noiseCategory ?? '',
        remarks: type.remarks ?? '',
      },
    })),
  );
  readonly compositionRecords = computed<AttributeEntityRecord[]>(() =>
    this.collections.vehicleCompositions().map((composition) => ({
      id: composition.id,
      label: composition.name ?? composition.id,
      secondaryLabel: this.renderCompositionEntries(composition.entries),
      attributes: [],
      fallbackValues: {
        name: composition.name ?? '',
        entriesSerialized: this.serializeCompositionEntries(composition.entries ?? []),
        turnaroundBuffer: composition.turnaroundBuffer ?? '',
        remark: composition.remark ?? '',
      },
    })),
  );
  readonly serviceGroups = computed<AttributeEntityGroup[]>(() => {
    const pools = this.collections.vehicleServicePools();
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
  readonly vehicleGroups = computed<AttributeEntityGroup[]>(() => {
    const pools = this.collections.vehiclePools();
    const entries = this.vehicleRecords();
    const groups: AttributeEntityGroup[] = pools.map((pool) => ({
      id: pool.id,
      label: pool.name ?? pool.id,
      secondaryLabel: pool.description ?? '',
      children: entries.filter((vehicle) => (vehicle.fallbackValues['poolId'] ?? '') === pool.id),
    }));
    const unassigned = entries.filter((vehicle) => !(vehicle.fallbackValues['poolId'] ?? '').trim());
    if (unassigned.length) {
      groups.push({
        id: UNASSIGNED_VEHICLE_GROUP,
        label: 'Ohne Pool',
        secondaryLabel: 'Fahrzeuge ohne Zuordnung',
        children: unassigned,
      });
    }
    return groups;
  });
  readonly servicePoolDefaults = VEHICLE_SERVICE_POOL_DEFAULTS;
  readonly serviceDefaults = VEHICLE_SERVICE_DEFAULTS;
  readonly vehiclePoolDefaults = VEHICLE_POOL_DEFAULTS;
  readonly vehicleDefaults = VEHICLE_DEFAULTS;
  readonly vehicleTypeDefaults = VEHICLE_TYPE_DEFAULTS;
  readonly compositionDefaults = VEHICLE_COMPOSITION_DEFAULTS;

  readonly servicePoolRequiredKeys = ['name'];
  readonly vehiclePoolRequiredKeys = ['name'];
  readonly vehicleTypeRequiredKeys = ['label'];
  readonly compositionRequiredKeys = ['name'];
  readonly vehicleTypeNumericKeys = VEHICLE_TYPE_NUMERIC_KEYS;

  readonly serviceSelectOptions = computed(() => ({
    poolId: this.collections.vehicleServicePools().map((pool) => ({
      value: pool.id,
      label: pool.name ?? pool.id,
    })),
  }));
  readonly vehicleSelectOptions = computed(() => ({
    poolId: this.collections.vehiclePools().map((pool) => ({
      value: pool.id,
      label: pool.name ?? pool.id,
    })),
    typeId: this.collections.vehicleTypes().map((type) => ({
      value: type.id,
      label: type.label ?? type.id,
    })),
  }));
  readonly vehicleTypeSelectOptions = VEHICLE_TYPE_SELECT_OPTIONS;

  readonly servicePoolError = signal<string | null>(null);
  readonly serviceError = signal<string | null>(null);
  readonly vehiclePoolError = signal<string | null>(null);
  readonly vehicleError = signal<string | null>(null);
  readonly vehicleTypeError = signal<string | null>(null);
  readonly compositionError = signal<string | null>(null);

  readonly serviceCreateDefaultsFactory = (groupId: string | null): Record<string, string> => {
    if (!groupId || groupId === UNASSIGNED_SERVICE_GROUP) {
      return {};
    }
    return { poolId: groupId };
  };
  readonly vehicleCreateDefaultsFactory = (groupId: string | null): Record<string, string> => {
    if (!groupId || groupId === UNASSIGNED_VEHICLE_GROUP) {
      return {};
    }
    return { poolId: groupId };
  };

  handleServicePoolSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('VSP');
    const name = (event.payload.values['name'] ?? '').trim();
    if (!name) {
      this.servicePoolError.set('Name darf nicht leer sein.');
      return;
    }
    const description = this.cleanString(event.payload.values['description']);
    const dispatcher = this.cleanString(event.payload.values['dispatcher']);
    const list = this.collections.vehicleServicePools();
    const existing = list.find((entry) => entry.id === id);
    const payload: VehicleServicePool = {
      id,
      name,
      description,
      serviceIds: existing?.serviceIds ?? [],
      dispatcher: dispatcher ?? undefined,
    };
    const next = existing ? list.map((entry) => (entry.id === id ? payload : entry)) : [...list, payload];
    this.collections.syncVehicleServicePools(next);
    this.servicePoolError.set(null);
  }

  handleServicePoolDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.collections.vehicleServicePools().filter((entry) => !set.has(entry.id));
    this.collections.syncVehicleServicePools(remaining);
    this.detachVehicleServicesFromPools(ids);
  }

  handleServiceSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('VS');
    const values = event.payload.values;
    const name = (values['name'] ?? '').trim();
    if (!name) {
      this.serviceError.set('Name darf nicht leer sein.');
      return;
    }
    const poolId = this.cleanString(values['poolId']);
    if (poolId && !this.serviceSelectOptions().poolId.some((option) => option.value === poolId)) {
      this.serviceError.set('Ungültiger Pool.');
      return;
    }
    const payload: VehicleService = {
      id,
      name,
      description: this.cleanString(values['description']),
      poolId: poolId || undefined,
      startTime: this.cleanString(values['startTime']),
      endTime: this.cleanString(values['endTime']),
      isOvernight: this.parseBoolean(values['isOvernight']),
      primaryRoute: this.cleanString(values['primaryRoute']),
    };
    const list = this.resources.vehicleServices();
    const next = list.some((entry) => entry.id === id)
      ? list.map((entry) => (entry.id === id ? payload : entry))
      : [...list, payload];
    this.resources.syncVehicleServices(next);
    this.serviceError.set(null);
  }

  handleServiceDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.resources.vehicleServices().filter((entry) => !set.has(entry.id));
    this.resources.syncVehicleServices(remaining);
    this.detachVehiclesFromServices(ids);
  }

  handleVehiclePoolSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('VP');
    const name = (event.payload.values['name'] ?? '').trim();
    if (!name) {
      this.vehiclePoolError.set('Name darf nicht leer sein.');
      return;
    }
    const list = this.collections.vehiclePools();
    const existing = list.find((entry) => entry.id === id);
    const payload: VehiclePool = {
      id,
      name,
      description: this.cleanString(event.payload.values['description']),
      vehicleIds: existing?.vehicleIds ?? [],
      depotManager: this.cleanString(event.payload.values['depotManager']),
    };
    const next = existing ? list.map((entry) => (entry.id === id ? payload : entry)) : [...list, payload];
    this.collections.syncVehiclePools(next);
    this.vehiclePoolError.set(null);
  }

  handleVehiclePoolDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.collections.vehiclePools().filter((entry) => !set.has(entry.id));
    this.collections.syncVehiclePools(remaining);
    this.detachVehiclesFromPools(ids);
  }

  handleVehicleSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('V');
    const values = event.payload.values;
    const vehicleNumber = (values['vehicleNumber'] ?? '').trim();
    const typeId = (values['typeId'] ?? '').trim();
    if (!vehicleNumber || !typeId) {
      this.vehicleError.set('Fahrzeugnummer und Typ sind erforderlich.');
      return;
    }
    const poolId = this.cleanString(values['poolId']);
    if (poolId && !this.vehicleSelectOptions().poolId.some((option) => option.value === poolId)) {
      this.vehicleError.set('Ungültiger Pool.');
      return;
    }
    const payload: Vehicle = {
      id,
      vehicleNumber,
      typeId,
      serviceIds: this.parseList(values['serviceIds']),
      poolId: poolId || undefined,
      description: this.cleanString(values['description']),
      depot: this.cleanString(values['depot']),
    };
    const list = this.resources.vehicles();
    const next = list.some((entry) => entry.id === id)
      ? list.map((entry) => (entry.id === id ? payload : entry))
      : [...list, payload];
    this.resources.syncVehicles(next);
    this.vehicleError.set(null);
  }

  handleVehicleDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.resources.vehicles().filter((entry) => !set.has(entry.id));
    this.resources.syncVehicles(remaining);
    this.detachVehiclesFromPools(ids);
  }

  handleVehicleTypeSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('VT');
    const values = event.payload.values;
    const label = (values['label'] ?? '').trim();
    if (!label) {
      this.vehicleTypeError.set('Bezeichnung darf nicht leer sein.');
      return;
    }
    const tilting = this.cleanString(values['tiltingCapability']);
    const tiltingCapability =
      tilting === 'none' || tilting === 'passive' || tilting === 'active' ? tilting : undefined;
    const powerSupplySystems = this.parseList(values['powerSupplySystems']);
    const trainProtectionSystems = this.parseList(values['trainProtectionSystems']);
    const payload: VehicleType = {
      id,
      label,
      category: this.cleanString(values['category']),
      capacity: this.parseNumber(values['capacity']),
      trainTypeCode: this.cleanString(values['trainTypeCode']),
      lengthMeters: this.parseNumber(values['lengthMeters']),
      weightTons: this.parseNumber(values['weightTons']),
      brakeType: this.cleanString(values['brakeType']),
      brakePercentage: this.parseNumber(values['brakePercentage']),
      tiltingCapability,
      powerSupplySystems: powerSupplySystems.length ? powerSupplySystems : undefined,
      trainProtectionSystems: trainProtectionSystems.length ? trainProtectionSystems : undefined,
      etcsLevel: this.cleanString(values['etcsLevel']),
      gaugeProfile: this.cleanString(values['gaugeProfile']),
      maxSpeed: this.parseNumber(values['maxSpeed']),
      maintenanceIntervalDays: this.parseNumber(values['maintenanceIntervalDays']),
      energyType: this.cleanString(values['energyType']),
      manufacturer: this.cleanString(values['manufacturer']),
      maxAxleLoad: this.parseNumber(values['maxAxleLoad']),
      noiseCategory: this.cleanString(values['noiseCategory']),
      remarks: this.cleanString(values['remarks']),
    };
    const list = this.collections.vehicleTypes();
    const next = list.some((entry) => entry.id === id)
      ? list.map((entry) => (entry.id === id ? payload : entry))
      : [...list, payload];
    this.collections.syncVehicleTypes(next);
    this.vehicleTypeError.set(null);
  }

  handleVehicleTypeDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.collections.vehicleTypes().filter((entry) => !set.has(entry.id));
    this.collections.syncVehicleTypes(remaining);
  }

  handleCompositionSave(event: EntitySaveEvent): void {
    const id = event.entityId ?? this.generateId('VC');
    const values = event.payload.values;
    const name = (values['name'] ?? '').trim();
    if (!name) {
      this.compositionError.set('Name darf nicht leer sein.');
      return;
    }
    const entries = this.parseCompositionEntries(values['entriesSerialized'] ?? '');
    if (!entries.length) {
      this.compositionError.set('Mindestens ein Fahrzeugtyp wird benötigt (Format Typ:Anzahl).');
      return;
    }
    const payload: VehicleComposition = {
      id,
      name,
      entries,
      turnaroundBuffer: this.cleanString(values['turnaroundBuffer']),
      remark: this.cleanString(values['remark']),
    };
    const list = this.collections.vehicleCompositions();
    const next = list.some((entry) => entry.id === id)
      ? list.map((entry) => (entry.id === id ? payload : entry))
      : [...list, payload];
    this.collections.syncVehicleCompositions(next);
    this.compositionError.set(null);
  }

  handleCompositionDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.collections.vehicleCompositions().filter((entry) => !set.has(entry.id));
    this.collections.syncVehicleCompositions(remaining);
  }

  private detachVehicleServicesFromPools(poolIds: string[]): void {
    const set = new Set(poolIds);
    const list = this.resources.vehicleServices();
    let changed = false;
    const next = list.map((service) => {
      if (service.poolId && set.has(service.poolId)) {
        changed = true;
        return { ...service, poolId: undefined };
      }
      return service;
    });
    if (changed) {
      this.resources.syncVehicleServices(next);
    }
  }

  private detachVehiclesFromServices(serviceIds: string[]): void {
    const idSet = new Set(serviceIds);
    const list = this.resources.vehicles().map((vehicle) => ({
      ...vehicle,
      serviceIds: (vehicle.serviceIds ?? []).filter((id) => !idSet.has(id)),
    }));
    this.resources.syncVehicles(list);
  }

  private detachVehiclesFromPools(poolIds: string[]): void {
    const set = new Set(poolIds);
    const list = this.resources.vehicles();
    let changed = false;
    const next = list.map((vehicle) => {
      if (vehicle.poolId && set.has(vehicle.poolId)) {
        changed = true;
        return { ...vehicle, poolId: undefined };
      }
      return vehicle;
    });
    if (changed) {
      this.resources.syncVehicles(next);
    }
  }

  private serializeCompositionEntries(entries: VehicleCompositionEntry[] | undefined): string {
    if (!entries || entries.length === 0) {
      return '';
    }
    return entries.map((entry) => `${entry.typeId}:${entry.quantity}`).join('\n');
  }

  private renderCompositionEntries(entries: VehicleCompositionEntry[] | undefined): string {
    if (!entries || entries.length === 0) {
      return '—';
    }
    const labelMap = this.vehicleTypeLabelMap();
    return entries
      .map((entry) => {
        const label = labelMap.get(entry.typeId) ?? entry.typeId;
        return `${entry.quantity}× ${label}`;
      })
      .join(', ');
  }

  private parseCompositionEntries(value: string): VehicleCompositionEntry[] {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [typeIdPart, quantityPart] = line.split(':').map((part) => part.trim());
        const quantity = Number.parseInt(quantityPart ?? '1', 10);
        return {
          typeId: typeIdPart ?? '',
          quantity: Number.isNaN(quantity) ? 1 : Math.max(1, quantity),
        };
      })
      .filter((entry) => entry.typeId.length > 0);
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private formatNumber(value: number | undefined | null): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
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

  private parseBoolean(value: string | undefined): boolean {
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'ja';
  }

  private cleanString(value: string | undefined): string | undefined {
    const trimmed = (value ?? '').trim();
    return trimmed.length ? trimmed : undefined;
  }

  private generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
