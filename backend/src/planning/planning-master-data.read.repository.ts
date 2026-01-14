import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type {
  HomeDepot,
  OperationalPoint,
  OpReplacementStopLink,
  Personnel,
  PersonnelPool,
  PersonnelService,
  PersonnelServicePool,
  PersonnelSite,
  ReplacementEdge,
  ReplacementRoute,
  ReplacementStop,
  SectionOfLine,
  TransferEdge,
  Vehicle,
  VehicleComposition,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
} from './planning.types';
import type { MasterDataSets } from './planning.repository.types';

interface PersonnelServicePoolRow {
  id: string;
  name: string;
  description: string | null;
  service_ids?: string[];
  shift_coordinator?: string | null;
  contact_email?: string | null;
  attributes: Record<string, unknown> | null;
}

interface PersonnelPoolRow {
  id: string;
  name: string;
  description: string | null;
  personnel_ids?: string[];
  location_code?: string | null;
  attributes: Record<string, unknown> | null;
}

interface PersonnelRow {
  id: string;
  name: string;
  external_ref: string | null;
  home_base: string | null;
  deleted: boolean;
  deleted_at: string | null;
  attributes: Record<string, unknown> | null;
}

interface PersonnelServiceRow {
  id: string;
  label: string;
  pool_id: string | null;
  deleted: boolean;
  deleted_at: string | null;
  attributes: Record<string, unknown> | null;
}

interface VehicleServicePoolRow {
  id: string;
  name: string;
  description: string | null;
  service_ids?: string[];
  dispatcher?: string | null;
  attributes: Record<string, unknown> | null;
}

interface VehiclePoolRow {
  id: string;
  name: string;
  description: string | null;
  vehicle_ids?: string[];
  depot_manager?: string | null;
  attributes: Record<string, unknown> | null;
}

interface VehicleRow {
  id: string;
  label: string;
  type_id: string | null;
  external_ref: string | null;
  home_depot: string | null;
  deleted: boolean;
  deleted_at: string | null;
  attributes: Record<string, unknown> | null;
}

interface VehicleServiceRow {
  id: string;
  label: string;
  pool_id: string | null;
  deleted: boolean;
  deleted_at: string | null;
  attributes: Record<string, unknown> | null;
}

interface VehicleTypeRow {
  id: string;
  label: string;
  category: string | null;
  capacity: number | null;
  max_speed: number | null;
  maintenance_interval_days: number | null;
  energy_type: string | null;
  manufacturer: string | null;
  train_type_code: string | null;
  length_meters: string | number | null;
  weight_tons: string | number | null;
  brake_type: string | null;
  brake_percentage: number | null;
  tilting_capability: string | null;
  power_supply_systems: string[] | null;
  train_protection_systems: string[] | null;
  etcs_level: string | null;
  gauge_profile: string | null;
  max_axle_load: string | number | null;
  noise_category: string | null;
  remarks: string | null;
  attributes: Record<string, unknown> | null;
}

interface VehicleCompositionRow {
  id: string;
  name: string;
  turnaround_buffer: string | null;
  remark: string | null;
  attributes: Record<string, unknown> | null;
}

interface VehicleCompositionEntryRow {
  composition_id: string;
  type_id: string;
  quantity: number;
}

interface PersonnelPoolMemberRow {
  pool_id: string;
  personnel_id: string;
}

interface PersonnelServicePoolMemberRow {
  pool_id: string;
  service_id: string;
}

interface VehiclePoolMemberRow {
  pool_id: string;
  vehicle_id: string;
}

interface VehicleServicePoolMemberRow {
  pool_id: string;
  service_id: string;
}

interface JsonPayloadRow<T> {
  payload: T;
}

@Injectable()
export class PlanningMasterDataReadRepository {
  private readonly logger = new Logger(PlanningMasterDataReadRepository.name);
  private readonly missingTopologyTables = new Set<string>();

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async loadMasterData(): Promise<MasterDataSets> {
    if (!this.isEnabled) {
      return this.createEmptyMasterData();
    }

    const [
      personnelRows,
      personnelServiceRows,
      personnelPoolRows,
      personnelPoolMemberRows,
      personnelServicePoolRows,
      personnelServicePoolMemberRows,
      homeDepots,
      vehicleRows,
      vehicleServiceRows,
      vehiclePoolRows,
      vehiclePoolMemberRows,
      vehicleServicePoolRows,
      vehicleServicePoolMemberRows,
      vehicleTypes,
      vehicleCompositions,
      operationalPoints,
      sectionsOfLine,
      personnelSites,
      replacementStops,
      replacementRoutes,
      replacementEdges,
      opReplacementStopLinks,
      transferEdges,
    ] = await Promise.all([
      this.database
        .query<PersonnelRow>(
          `
            SELECT id, name, external_ref, home_base, deleted, deleted_at, attributes
            FROM personnel
            WHERE deleted = FALSE
            ORDER BY name
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<PersonnelServiceRow>(
          `
            SELECT id, label, pool_id, deleted, deleted_at, attributes
            FROM personnel_services
            WHERE deleted = FALSE
            ORDER BY label
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<PersonnelPoolRow>(
          `
            SELECT id, name, description, attributes
            FROM personnel_pools
            WHERE deleted = FALSE
            ORDER BY name
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<PersonnelPoolMemberRow>(
          `
            SELECT pool_id, personnel_id
            FROM personnel_pool_members
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<PersonnelServicePoolRow>(
          `
            SELECT id, name, description, attributes
            FROM personnel_service_pools
            WHERE deleted = FALSE
            ORDER BY name
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<PersonnelServicePoolMemberRow>(
          `
            SELECT pool_id, service_id
            FROM personnel_service_pool_members
          `,
        )
        .then((result) => result.rows),
      this.loadJsonCollection<HomeDepot>('master_home_depot', 'home_depot_id'),
      this.database
        .query<VehicleRow>(
          `
            SELECT id, label, type_id, external_ref, home_depot, deleted, deleted_at, attributes
            FROM vehicles
            WHERE deleted = FALSE
            ORDER BY label
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<VehicleServiceRow>(
          `
            SELECT id, label, pool_id, deleted, deleted_at, attributes
            FROM vehicle_services
            WHERE deleted = FALSE
            ORDER BY label
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<VehiclePoolRow>(
          `
            SELECT id, name, description, attributes
            FROM vehicle_pools
            WHERE deleted = FALSE
            ORDER BY name
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<VehiclePoolMemberRow>(
          `
            SELECT pool_id, vehicle_id
            FROM vehicle_pool_members
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<VehicleServicePoolRow>(
          `
            SELECT id, name, description, attributes
            FROM vehicle_service_pools
            WHERE deleted = FALSE
            ORDER BY name
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<VehicleServicePoolMemberRow>(
          `
            SELECT pool_id, service_id
            FROM vehicle_service_pool_members
          `,
        )
        .then((result) => result.rows),
      this.database
        .query<VehicleTypeRow>(
          `
            SELECT
              id,
              label,
              category,
              capacity,
              max_speed,
              maintenance_interval_days,
              energy_type,
              manufacturer,
              train_type_code,
              length_meters,
              weight_tons,
              brake_type,
              brake_percentage,
              tilting_capability,
              power_supply_systems,
              train_protection_systems,
              etcs_level,
              gauge_profile,
              max_axle_load,
              noise_category,
              remarks,
              attributes
            FROM vehicle_type
            ORDER BY label
          `,
        )
        .then((result) => result.rows.map((row) => this.mapVehicleType(row))),
      this.loadVehicleCompositions(),
      this.loadJsonCollection<OperationalPoint>(
        'topology_operational_point',
        'unique_op_id',
      ),
      this.loadJsonCollection<SectionOfLine>(
        'topology_section_of_line',
        'sol_id',
      ),
      this.loadJsonCollection<PersonnelSite>(
        'topology_personnel_site',
        'site_id',
      ),
      this.loadJsonCollection<ReplacementStop>(
        'topology_replacement_stop',
        'replacement_stop_id',
      ),
      this.loadJsonCollection<ReplacementRoute>(
        'topology_replacement_route',
        'replacement_route_id',
      ),
      this.loadJsonCollection<ReplacementEdge>(
        'topology_replacement_edge',
        'replacement_edge_id',
      ),
      this.loadJsonCollection<OpReplacementStopLink>(
        'topology_op_replacement_stop_link',
        'link_id',
      ),
      this.loadJsonCollection<TransferEdge>(
        'topology_transfer_edge',
        'transfer_id',
      ),
    ]);

    const personnel = personnelRows.map((row) => this.mapPersonnel(row));
    const personnelServices = personnelServiceRows.map((row) =>
      this.mapPersonnelService(row),
    );
    const personnelPools = this.mapPersonnelPoolsWithMembers(
      personnelPoolRows,
      personnelPoolMemberRows,
    );
    const personnelServicePools = this.mapPersonnelServicePoolsWithMembers(
      personnelServicePoolRows,
      personnelServicePoolMemberRows,
    );
    const vehicles = vehicleRows.map((row) => this.mapVehicle(row));
    const vehicleServices = vehicleServiceRows.map((row) =>
      this.mapVehicleService(row),
    );
    const vehiclePools = this.mapVehiclePoolsWithMembers(
      vehiclePoolRows,
      vehiclePoolMemberRows,
    );
    const vehicleServicePools = this.mapVehicleServicePoolsWithMembers(
      vehicleServicePoolRows,
      vehicleServicePoolMemberRows,
    );

    return {
      personnel,
      personnelServices,
      personnelServicePools,
      personnelPools,
      homeDepots,
      vehicles,
      vehicleServices,
      vehicleServicePools,
      vehiclePools,
      vehicleTypes,
      vehicleCompositions,
      operationalPoints,
      sectionsOfLine,
      personnelSites,
      replacementStops,
      replacementRoutes,
      replacementEdges,
      opReplacementStopLinks,
      transferEdges,
    };
  }

  private mapPersonnel(row: PersonnelRow): Personnel {
    const attrs = this.ensureRecord(row.attributes);
    return {
      ...attrs,
      id: row.id,
      name: row.name,
      externalRef: row.external_ref ?? undefined,
      homeBase: row.home_base ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapPersonnelService(row: PersonnelServiceRow): PersonnelService {
    const attrs = this.ensureRecord(row.attributes);
    return {
      ...attrs,
      id: row.id,
      name: row.label,
      poolId: row.pool_id ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapVehicle(row: VehicleRow): Vehicle {
    const attrs = this.ensureRecord(row.attributes);
    return {
      ...attrs,
      id: row.id,
      name: row.label,
      typeId: row.type_id ?? undefined,
      externalRef: row.external_ref ?? undefined,
      homeDepot: row.home_depot ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapVehicleService(row: VehicleServiceRow): VehicleService {
    const attrs = this.ensureRecord(row.attributes);
    return {
      ...attrs,
      id: row.id,
      name: row.label,
      poolId: row.pool_id ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapPersonnelPoolsWithMembers(
    poolRows: PersonnelPoolRow[],
    memberRows: PersonnelPoolMemberRow[],
  ): PersonnelPool[] {
    const membersByPool = new Map<string, string[]>();
    memberRows.forEach((row) => {
      const list = membersByPool.get(row.pool_id) ?? [];
      list.push(row.personnel_id);
      membersByPool.set(row.pool_id, list);
    });
    return poolRows.map((row) => {
      const attrs = this.ensureRecord(row.attributes);
      const locationCode =
        typeof attrs['locationCode'] === 'string'
          ? attrs['locationCode']
          : typeof row.location_code === 'string'
            ? row.location_code
            : undefined;
      return {
        ...attrs,
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        personnelIds: membersByPool.get(row.id) ?? [],
        locationCode,
        attributes: row.attributes ?? undefined,
      };
    });
  }

  private mapPersonnelServicePoolsWithMembers(
    poolRows: PersonnelServicePoolRow[],
    memberRows: PersonnelServicePoolMemberRow[],
  ): PersonnelServicePool[] {
    const membersByPool = new Map<string, string[]>();
    memberRows.forEach((row) => {
      const list = membersByPool.get(row.pool_id) ?? [];
      list.push(row.service_id);
      membersByPool.set(row.pool_id, list);
    });
    return poolRows.map((row) => {
      const attrs = this.ensureRecord(row.attributes);
      const shiftCoordinator =
        typeof attrs['shiftCoordinator'] === 'string'
          ? attrs['shiftCoordinator']
          : undefined;
      const contactEmail =
        typeof attrs['contactEmail'] === 'string'
          ? attrs['contactEmail']
          : undefined;
      return {
        ...attrs,
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        serviceIds: membersByPool.get(row.id) ?? [],
        shiftCoordinator,
        contactEmail,
        attributes: row.attributes ?? undefined,
      };
    });
  }

  private mapVehiclePoolsWithMembers(
    poolRows: VehiclePoolRow[],
    memberRows: VehiclePoolMemberRow[],
  ): VehiclePool[] {
    const membersByPool = new Map<string, string[]>();
    memberRows.forEach((row) => {
      const list = membersByPool.get(row.pool_id) ?? [];
      list.push(row.vehicle_id);
      membersByPool.set(row.pool_id, list);
    });
    return poolRows.map((row) => {
      const attrs = this.ensureRecord(row.attributes);
      const depotManager =
        typeof attrs['depotManager'] === 'string'
          ? attrs['depotManager']
          : undefined;
      return {
        ...attrs,
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        vehicleIds: membersByPool.get(row.id) ?? [],
        depotManager,
        attributes: row.attributes ?? undefined,
      };
    });
  }

  private mapVehicleServicePoolsWithMembers(
    poolRows: VehicleServicePoolRow[],
    memberRows: VehicleServicePoolMemberRow[],
  ): VehicleServicePool[] {
    const membersByPool = new Map<string, string[]>();
    memberRows.forEach((row) => {
      const list = membersByPool.get(row.pool_id) ?? [];
      list.push(row.service_id);
      membersByPool.set(row.pool_id, list);
    });
    return poolRows.map((row) => {
      const attrs = this.ensureRecord(row.attributes);
      const dispatcher =
        typeof attrs['dispatcher'] === 'string'
          ? attrs['dispatcher']
          : undefined;
      return {
        ...attrs,
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        serviceIds: membersByPool.get(row.id) ?? [],
        dispatcher,
        attributes: row.attributes ?? undefined,
      };
    });
  }

  private ensureRecord(
    value: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value;
  }

  private mapVehicleType(row: VehicleTypeRow): VehicleType {
    return {
      id: row.id,
      label: row.label,
      category: row.category ?? undefined,
      capacity: row.capacity ?? undefined,
      maxSpeed: row.max_speed ?? undefined,
      maintenanceIntervalDays: row.maintenance_interval_days ?? undefined,
      energyType: row.energy_type ?? undefined,
      manufacturer: row.manufacturer ?? undefined,
      trainTypeCode: row.train_type_code ?? undefined,
      lengthMeters: this.toNumber(row.length_meters),
      weightTons: this.toNumber(row.weight_tons),
      brakeType: row.brake_type ?? undefined,
      brakePercentage: row.brake_percentage ?? undefined,
      tiltingCapability:
        (row.tilting_capability as VehicleType['tiltingCapability']) ??
        undefined,
      powerSupplySystems: row.power_supply_systems ?? undefined,
      trainProtectionSystems: row.train_protection_systems ?? undefined,
      etcsLevel: row.etcs_level ?? undefined,
      gaugeProfile: row.gauge_profile ?? undefined,
      maxAxleLoad: this.toNumber(row.max_axle_load),
      noiseCategory: row.noise_category ?? undefined,
      remarks: row.remarks ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private async loadVehicleCompositions(): Promise<VehicleComposition[]> {
    if (!this.isEnabled) {
      return [];
    }
    const [compositionResult, entryResult] = await Promise.all([
      this.database.query<VehicleCompositionRow>(
        `
          SELECT id, name, turnaround_buffer, remark, attributes
          FROM vehicle_composition
          ORDER BY name
        `,
      ),
      this.database.query<VehicleCompositionEntryRow>(
        `
          SELECT composition_id, type_id, quantity
          FROM vehicle_composition_entry
          ORDER BY composition_id, type_id
        `,
      ),
    ]);

    return this.mapVehicleCompositions(
      compositionResult.rows,
      entryResult.rows,
    );
  }

  private mapVehicleCompositions(
    rows: VehicleCompositionRow[],
    entryRows: VehicleCompositionEntryRow[],
  ): VehicleComposition[] {
    const entriesByComposition = new Map<
      string,
      VehicleCompositionEntryRow[]
    >();
    entryRows.forEach((entry) => {
      const list = entriesByComposition.get(entry.composition_id) ?? [];
      list.push(entry);
      entriesByComposition.set(entry.composition_id, list);
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      entries: (entriesByComposition.get(row.id) ?? []).map((entry) => ({
        typeId: entry.type_id,
        quantity: entry.quantity,
      })),
      turnaroundBuffer: row.turnaround_buffer ?? undefined,
      remark: row.remark ?? undefined,
      attributes: row.attributes ?? undefined,
    }));
  }

  private toNumber(value: string | number | null): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private async loadJsonCollection<T>(
    tableName: string,
    idColumn: string,
  ): Promise<T[]> {
    if (!this.isEnabled) {
      return [];
    }
    try {
      const result = await this.database.query<JsonPayloadRow<T>>(
        `SELECT payload FROM ${tableName} ORDER BY ${idColumn}`,
      );
      return result.rows.map((row) => row.payload);
    } catch (error) {
      if (this.isTopologyStructureMissing(error)) {
        if (!this.missingTopologyTables.has(tableName)) {
          this.logger.debug(
            `Tabelle ${tableName} (JSON-Payload) fehlt oder hat keine payload-Spalte – verwende leere Sammlung.`,
          );
        }
        this.missingTopologyTables.add(tableName);
        return [];
      }
      throw error;
    }
  }

  private createEmptyMasterData(): MasterDataSets {
    return {
      personnel: [],
      personnelServices: [],
      personnelServicePools: [],
      personnelPools: [],
      homeDepots: [],
      vehicles: [],
      vehicleServices: [],
      vehicleServicePools: [],
      vehiclePools: [],
      vehicleTypes: [],
      vehicleCompositions: [],
      operationalPoints: [],
      sectionsOfLine: [],
      personnelSites: [],
      replacementStops: [],
      replacementRoutes: [],
      replacementEdges: [],
      opReplacementStopLinks: [],
      transferEdges: [],
    };
  }

  private isTopologyStructureMissing(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    return code === '42703' || code === '42P01';
  }
}
