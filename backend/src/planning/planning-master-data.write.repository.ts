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

@Injectable()
export class PlanningMasterDataWriteRepository {
  private readonly logger = new Logger(PlanningMasterDataWriteRepository.name);
  private readonly missingTopologyTables = new Set<string>();

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async replacePersonnelServicePools(
    items: PersonnelServicePool[],
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM personnel_service_pool_members');
        await client.query('DELETE FROM personnel_service_pools');
        if (items.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  name TEXT,
                  description TEXT,
                  attributes JSONB
                )
              )
              INSERT INTO personnel_service_pools (
                id,
                name,
                description,
                deleted,
                attributes
              )
              SELECT
                id,
                name,
                description,
                FALSE,
                COALESCE(attributes, '{}'::jsonb)
              FROM incoming
            `,
            [JSON.stringify(items)],
          );

          const members = this.flattenMembers(
            items.map((pool) => ({
              poolId: pool.id,
              members: pool.serviceIds ?? [],
            })),
          );
          if (members.length) {
            await client.query(
              `
                WITH incoming AS (
                  SELECT *
                  FROM jsonb_to_recordset($1::jsonb) AS t(
                    pool_id TEXT,
                    member_id TEXT
                  )
                )
                INSERT INTO personnel_service_pool_members (pool_id, service_id)
                SELECT pool_id, member_id FROM incoming
              `,
              [JSON.stringify(members)],
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Fehler beim Aktualisieren der Personnel-Service-Pools',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async replacePersonnelPools(items: PersonnelPool[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM personnel_pool_members');
        await client.query('DELETE FROM personnel_pools');
        if (items.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  name TEXT,
                  description TEXT,
                  attributes JSONB
                )
              )
              INSERT INTO personnel_pools (
                id,
                name,
                description,
                deleted,
                attributes
              )
              SELECT
                id,
                name,
                description,
                FALSE,
                COALESCE(attributes, '{}'::jsonb)
              FROM incoming
            `,
            [JSON.stringify(items)],
          );

          const members = this.flattenMembers(
            items.map((pool) => ({
              poolId: pool.id,
              members: pool.personnelIds ?? [],
            })),
          );
          if (members.length) {
            await client.query(
              `
                WITH incoming AS (
                  SELECT *
                  FROM jsonb_to_recordset($1::jsonb) AS t(
                    pool_id TEXT,
                    member_id TEXT
                  )
                )
                INSERT INTO personnel_pool_members (pool_id, personnel_id)
                SELECT pool_id, member_id FROM incoming
              `,
              [JSON.stringify(members)],
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Fehler beim Aktualisieren der Personnel-Pools',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async replaceHomeDepots(items: HomeDepot[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'master_home_depot',
      'home_depot_id',
      items.map((item) => ({ id: item.id, payload: item })),
    );
  }

  async replaceVehicleServicePools(items: VehicleServicePool[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM vehicle_service_pool_members');
        await client.query('DELETE FROM vehicle_service_pools');
        if (items.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  name TEXT,
                  description TEXT,
                  attributes JSONB
                )
              )
              INSERT INTO vehicle_service_pools (
                id,
                name,
                description,
                deleted,
                attributes
              )
              SELECT
                id,
                name,
                description,
                FALSE,
                COALESCE(attributes, '{}'::jsonb)
              FROM incoming
            `,
            [JSON.stringify(items)],
          );

          const members = this.flattenMembers(
            items.map((pool) => ({
              poolId: pool.id,
              members: pool.serviceIds ?? [],
            })),
          );
          if (members.length) {
            await client.query(
              `
                WITH incoming AS (
                  SELECT *
                  FROM jsonb_to_recordset($1::jsonb) AS t(
                    pool_id TEXT,
                    member_id TEXT
                  )
                )
                INSERT INTO vehicle_service_pool_members (pool_id, service_id)
                SELECT pool_id, member_id FROM incoming
              `,
              [JSON.stringify(members)],
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Fehler beim Aktualisieren der Vehicle-Service-Pools',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async replaceVehiclePools(items: VehiclePool[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM vehicle_pool_members');
        await client.query('DELETE FROM vehicle_pools');
        if (items.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  name TEXT,
                  description TEXT,
                  attributes JSONB
                )
              )
              INSERT INTO vehicle_pools (
                id,
                name,
                description,
                deleted,
                attributes
              )
              SELECT
                id,
                name,
                description,
                FALSE,
                COALESCE(attributes, '{}'::jsonb)
              FROM incoming
            `,
            [JSON.stringify(items)],
          );

          const members = this.flattenMembers(
            items.map((pool) => ({
              poolId: pool.id,
              members: pool.vehicleIds ?? [],
            })),
          );
          if (members.length) {
            await client.query(
              `
                WITH incoming AS (
                  SELECT *
                  FROM jsonb_to_recordset($1::jsonb) AS t(
                    pool_id TEXT,
                    member_id TEXT
                  )
                )
                INSERT INTO vehicle_pool_members (pool_id, vehicle_id)
                SELECT pool_id, member_id FROM incoming
              `,
              [JSON.stringify(members)],
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Fehler beim Aktualisieren der Vehicle-Pools',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async replacePersonnel(items: Personnel[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceCollection(
      'personnel',
      items,
      `
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS t(
            id TEXT,
            name TEXT,
            externalRef TEXT,
            homeBase TEXT,
            attributes JSONB
          )
        )
        INSERT INTO personnel (
          id,
          name,
          external_ref,
          home_base,
          deleted,
          deleted_at,
          attributes
        )
        SELECT
          id,
          name,
          externalRef,
          homeBase,
          FALSE,
          NULL,
          COALESCE(attributes, '{}'::jsonb)
        FROM incoming
      `,
    );
  }

  async replacePersonnelServices(items: PersonnelService[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceCollection(
      'personnel_services',
      items,
      `
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS t(
            id TEXT,
            name TEXT,
            poolId TEXT,
            attributes JSONB
          )
        )
        INSERT INTO personnel_services (
          id,
          label,
          pool_id,
          deleted,
          deleted_at,
          attributes
        )
        SELECT
          id,
          name,
          poolId,
          FALSE,
          NULL,
          COALESCE(attributes, '{}'::jsonb)
        FROM incoming
      `,
    );
  }

  async replaceVehicles(items: Vehicle[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceCollection(
      'vehicles',
      items,
      `
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS t(
            id TEXT,
            name TEXT,
            typeId TEXT,
            externalRef TEXT,
            homeDepot TEXT,
            attributes JSONB
          )
        )
        INSERT INTO vehicles (
          id,
          label,
          type_id,
          external_ref,
          home_depot,
          deleted,
          deleted_at,
          attributes
        )
        SELECT
          id,
          name,
          typeId,
          externalRef,
          homeDepot,
          FALSE,
          NULL,
          COALESCE(attributes, '{}'::jsonb)
        FROM incoming
      `,
    );
  }

  async replaceVehicleServices(items: VehicleService[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceCollection(
      'vehicle_services',
      items,
      `
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS t(
            id TEXT,
            name TEXT,
            poolId TEXT,
            attributes JSONB
          )
        )
        INSERT INTO vehicle_services (
          id,
          label,
          pool_id,
          deleted,
          deleted_at,
          attributes
        )
        SELECT
          id,
          name,
          poolId,
          FALSE,
          NULL,
          COALESCE(attributes, '{}'::jsonb)
        FROM incoming
      `,
    );
  }

  async replaceVehicleTypes(items: VehicleType[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceCollection(
      'vehicle_type',
      items,
      `
        WITH incoming AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS t(
            id TEXT,
            label TEXT,
            category TEXT,
            capacity INTEGER,
            maxSpeed INTEGER,
            maintenanceIntervalDays INTEGER,
            energyType TEXT,
            manufacturer TEXT,
            trainTypeCode TEXT,
            lengthMeters NUMERIC,
            weightTons NUMERIC,
            brakeType TEXT,
            brakePercentage INTEGER,
            tiltingCapability TEXT,
            powerSupplySystems TEXT[],
            trainProtectionSystems TEXT[],
            etcsLevel TEXT,
            gaugeProfile TEXT,
            maxAxleLoad NUMERIC,
            noiseCategory TEXT,
            remarks TEXT,
            attributes JSONB
          )
        )
        INSERT INTO vehicle_type (
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
        )
        SELECT
          id,
          label,
          category,
          capacity,
          maxSpeed,
          maintenanceIntervalDays,
          energyType,
          manufacturer,
          trainTypeCode,
          lengthMeters,
          weightTons,
          brakeType,
          brakePercentage,
          tiltingCapability,
          powerSupplySystems,
          trainProtectionSystems,
          etcsLevel,
          gaugeProfile,
          maxAxleLoad,
          noiseCategory,
          remarks,
          COALESCE(attributes, '{}'::jsonb)
        FROM incoming
      `,
    );
  }

  async replaceVehicleCompositions(items: VehicleComposition[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM vehicle_composition_entry');
        await client.query('DELETE FROM vehicle_composition');
        if (items.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  name TEXT,
                  turnaroundBuffer TEXT,
                  remark TEXT,
                  attributes JSONB
                )
              )
              INSERT INTO vehicle_composition (
                id,
                name,
                turnaround_buffer,
                remark,
                attributes
              )
              SELECT
                id,
                name,
                NULLIF(turnaroundBuffer, '')::interval,
                remark,
                COALESCE(attributes, '{}'::jsonb)
              FROM incoming
            `,
            [JSON.stringify(items)],
          );

          const entries = this.flattenVehicleCompositionEntries(items);
          if (entries.length) {
            await client.query(
              `
                WITH incoming AS (
                  SELECT *
                  FROM jsonb_to_recordset($1::jsonb) AS t(
                    "compositionId" TEXT,
                    "typeId" TEXT,
                    quantity INTEGER
                  )
                )
                INSERT INTO vehicle_composition_entry (composition_id, type_id, quantity)
                SELECT "compositionId", "typeId", quantity
                FROM incoming
              `,
              [JSON.stringify(entries)],
            );
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Fehler beim Aktualisieren der Vehicle-Compositions',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async replaceOperationalPoints(items: OperationalPoint[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_operational_point',
      'unique_op_id',
      items.map((item) => ({ id: item.uniqueOpId, payload: item })),
    );
  }

  async replaceSectionsOfLine(items: SectionOfLine[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_section_of_line',
      'sol_id',
      items.map((item) => ({ id: item.solId, payload: item })),
    );
  }

  async replacePersonnelSites(items: PersonnelSite[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_personnel_site',
      'site_id',
      items.map((item) => ({ id: item.siteId, payload: item })),
    );
  }

  async replaceReplacementStops(items: ReplacementStop[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_replacement_stop',
      'replacement_stop_id',
      items.map((item) => ({ id: item.replacementStopId, payload: item })),
    );
  }

  async replaceReplacementRoutes(items: ReplacementRoute[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_replacement_route',
      'replacement_route_id',
      items.map((item) => ({ id: item.replacementRouteId, payload: item })),
    );
  }

  async replaceReplacementEdges(items: ReplacementEdge[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_replacement_edge',
      'replacement_edge_id',
      items.map((item) => ({ id: item.replacementEdgeId, payload: item })),
    );
  }

  async replaceOpReplacementStopLinks(
    items: OpReplacementStopLink[],
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_op_replacement_stop_link',
      'link_id',
      items.map((item) => ({ id: item.linkId, payload: item })),
    );
  }

  async replaceTransferEdges(items: TransferEdge[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.replaceJsonPayloadCollection(
      'topology_transfer_edge',
      'transfer_id',
      items.map((item) => ({ id: item.transferId, payload: item })),
    );
  }

  private flattenVehicleCompositionEntries(
    items: VehicleComposition[],
  ): { compositionId: string; typeId: string; quantity: number }[] {
    const payload: {
      compositionId: string;
      typeId: string;
      quantity: number;
    }[] = [];
    items.forEach((composition) => {
      (composition.entries ?? []).forEach((entry) => {
        payload.push({
          compositionId: composition.id,
          typeId: entry.typeId,
          quantity: entry.quantity,
        });
      });
    });
    return payload;
  }

  private flattenMembers(items: { poolId: string; members: string[] }[]): {
    pool_id: string;
    member_id: string;
  }[] {
    const rows: { pool_id: string; member_id: string }[] = [];
    items.forEach((entry) => {
      (entry.members ?? []).forEach((member) => {
        rows.push({ pool_id: entry.poolId, member_id: member });
      });
    });
    return rows;
  }

  private async replaceCollection(
    tableName: string,
    items: unknown[],
    insertSql: string,
  ): Promise<void> {
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`DELETE FROM ${tableName}`);
        if (items.length) {
          await client.query(insertSql, [JSON.stringify(items)]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Fehler beim Aktualisieren von ${tableName}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  private async replaceJsonPayloadCollection(
    tableName: string,
    idColumn: string,
    rows: { id: string; payload: unknown }[],
  ): Promise<void> {
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`DELETE FROM ${tableName}`);
        if (rows.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  payload JSONB
                )
              )
              INSERT INTO ${tableName} (${idColumn}, payload)
              SELECT id, payload
              FROM incoming
            `,
            [JSON.stringify(rows)],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        if (this.isTopologyStructureMissing(error)) {
          this.warnTopologyTableOnce(
            tableName,
            'noch nicht migriert – überspringe Persistierung.',
          );
          return;
        }
        this.logger.error(
          `Fehler beim Aktualisieren von ${tableName}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  private isTopologyStructureMissing(error: unknown): boolean {
    const code = (error as { code?: string })?.code;
    return code === '42703' || code === '42P01';
  }

  private warnTopologyTableOnce(tableName: string, message: string): void {
    if (this.missingTopologyTables.has(tableName)) {
      return;
    }
    this.missingTopologyTables.add(tableName);
    this.logger.warn(`Tabelle ${tableName} (JSON-Payload) ${message}`);
  }
}
