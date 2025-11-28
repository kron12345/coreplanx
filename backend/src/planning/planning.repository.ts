import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  Activity,
  ActivityDefinition,
  ActivityTemplate,
  ActivityTypeDefinition,
  LayerGroup,
  PersonnelPool,
  PersonnelServicePool,
  Personnel,
  PersonnelService,
  Resource,
  StageId,
  TimelineRange,
  TrainRun,
  TrainSegment,
  OperationalPoint,
  SectionOfLine,
  PersonnelSite,
  ReplacementStop,
  ReplacementRoute,
  ReplacementEdge,
  OpReplacementStopLink,
  TransferEdge,
  VehicleComposition,
  VehiclePool,
  VehicleServicePool,
  VehicleType,
  TranslationState,
  ResourceKind,
  ActivityFieldKey,
  Vehicle,
  VehicleService,
} from './planning.types';
import { randomUUID } from 'crypto';

interface StageRow {
  stage_id: string;
  version: string | null;
  timeline_start: string;
  timeline_end: string;
}

interface ResourceRow {
  id: string;
  name: string;
  kind: string;
  daily_service_capacity: number | null;
  attributes: Record<string, unknown> | null;
}

interface ActivityRow {
  id: string;
  client_id: string | null;
  title: string;
  start: string;
  end: string | null;
  type: string | null;
  from: string | null;
  to: string | null;
  remark: string | null;
  service_id: string | null;
  service_template_id: string | null;
  service_date: string | Date | null;
  service_category: string | null;
  service_role: string | null;
  location_id: string | null;
  location_label: string | null;
  capacity_group_id: string | null;
  required_qualifications: string[] | null;
  assigned_qualifications: string[] | null;
  work_rule_tags: string[] | null;
  row_version: string | null;
  created_at: string | Date | null;
  created_by: string | null;
  updated_at: string | Date | null;
  updated_by: string | null;
  scope: string | null;
  participants: unknown | null;
  group_id: string | null;
  group_order: number | null;
  train_run_id: string | null;
  train_segment_ids: string[] | null;
  attributes: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

interface ActivityTypeDefinitionRow {
  id: string;
  label: string;
  description: string | null;
  applies_to: string[];
  relevant_for: string[];
  category: string;
  time_mode: string;
  fields: string[];
  default_duration_minutes: number;
}

interface ActivityTemplateRow {
  id: string;
  label: string;
  description: string | null;
  activity_type: string | null;
  default_duration_minutes: number | null;
  attributes: Record<string, unknown> | null;
}

interface ActivityDefinitionRow {
  id: string;
  label: string;
  description: string | null;
  activity_type: string;
  template_id: string | null;
  default_duration_minutes: number | null;
  relevant_for: string[] | null;
  attributes: Record<string, unknown> | null;
}

interface ActivityLayerGroupRow {
  id: string;
  label: string;
  sort_order: number;
  description: string | null;
}

interface ActivityTranslationRow {
  locale: string;
  translation_key: string;
  label: string | null;
  abbreviation: string | null;
}

export interface StageData {
  stageId: StageId;
  timelineRange?: TimelineRange;
  version?: string | null;
  resources: Resource[];
  activities: Activity[];
  trainRuns: TrainRun[];
  trainSegments: TrainSegment[];
}

export interface MasterDataSets {
  personnel: Personnel[];
  personnelServices: PersonnelService[];
  personnelServicePools: PersonnelServicePool[];
  personnelPools: PersonnelPool[];
  vehicles: Vehicle[];
  vehicleServices: VehicleService[];
  vehicleServicePools: VehicleServicePool[];
  vehiclePools: VehiclePool[];
  vehicleTypes: VehicleType[];
  vehicleCompositions: VehicleComposition[];
  operationalPoints: OperationalPoint[];
  sectionsOfLine: SectionOfLine[];
  personnelSites: PersonnelSite[];
  replacementStops: ReplacementStop[];
  replacementRoutes: ReplacementRoute[];
  replacementEdges: ReplacementEdge[];
  opReplacementStopLinks: OpReplacementStopLink[];
  transferEdges: TransferEdge[];
}

export interface ActivityCatalogData {
  types: ActivityTypeDefinition[];
  templates: ActivityTemplate[];
  definitions: ActivityDefinition[];
  layerGroups: LayerGroup[];
  translations: TranslationState;
}

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
  length_meters: string | null;
  weight_tons: string | null;
  brake_type: string | null;
  brake_percentage: number | null;
  tilting_capability: string | null;
  power_supply_systems: string[] | null;
  train_protection_systems: string[] | null;
  etcs_level: string | null;
  gauge_profile: string | null;
  max_axle_load: string | null;
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
export class PlanningRepository {
  private readonly logger = new Logger(PlanningRepository.name);
  private readonly missingTopologyTables = new Set<string>();

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async loadStageData(stageId: StageId): Promise<StageData | null> {
    if (!this.isEnabled) {
      return null;
    }

    const stageResult = await this.database.query<StageRow>(
      `
        SELECT stage_id, version, timeline_start, timeline_end
        FROM planning_stage
        WHERE stage_id = $1
      `,
      [stageId],
    );
    const stageRow = stageResult.rows[0];
    if (!stageRow) {
      return null;
    }

    const resourcesResult = await this.database.query<ResourceRow>(
      `
        SELECT id, name, kind, daily_service_capacity, attributes
        FROM planning_resource
        WHERE stage_id = $1
        ORDER BY name
      `,
      [stageId],
    );

    const activitiesResult = await this.database.query<ActivityRow>(
      `
        SELECT
          id,
          client_id,
          title,
          start,
          "end",
          type,
          "from",
          "to",
          remark,
          service_id,
          service_template_id,
          service_date,
          service_category,
          service_role,
          location_id,
          location_label,
          capacity_group_id,
          required_qualifications,
          assigned_qualifications,
          work_rule_tags,
          row_version,
          created_at,
          created_by,
          updated_at,
          updated_by,
          scope,
          participants,
          group_id,
          group_order,
          train_run_id,
          train_segment_ids,
          attributes,
          meta
        FROM planning_activity
        WHERE stage_id = $1
        ORDER BY start
      `,
      [stageId],
    );

    const trainRunsResult = await this.database.query<{
      id: string;
      train_number: string;
      timetable_id: string | null;
      attributes: Record<string, unknown> | null;
    }>(
      `
        SELECT id, train_number, timetable_id, attributes
        FROM train_run
        WHERE stage_id = $1
        ORDER BY train_number, id
      `,
      [stageId],
    );

    const trainSegmentsResult = await this.database.query<{
      id: string;
      train_run_id: string;
      section_index: number;
      start_time: string | Date;
      end_time: string | Date;
      from_location_id: string;
      to_location_id: string;
      path_id: string | null;
      distance_km: number | null;
      attributes: Record<string, unknown> | null;
    }>(
      `
        SELECT
          id,
          train_run_id,
          section_index,
          start_time,
          end_time,
          from_location_id,
          to_location_id,
          path_id,
          distance_km,
          attributes
        FROM train_segment
        WHERE stage_id = $1
        ORDER BY train_run_id, section_index, id
      `,
      [stageId],
    );

    return {
      stageId,
      timelineRange: {
        start: this.toIso(stageRow.timeline_start),
        end: this.toIso(stageRow.timeline_end),
      },
      version: stageRow.version ? this.toIso(stageRow.version) : null,
      resources: resourcesResult.rows.map((row) => this.mapResource(row)),
      activities: activitiesResult.rows.map((row) => this.mapActivity(row)),
      trainRuns: trainRunsResult.rows.map((row) => ({
        id: row.id,
        trainNumber: row.train_number,
        timetableId: row.timetable_id ?? undefined,
        attributes: row.attributes ?? undefined,
      })),
      trainSegments: trainSegmentsResult.rows.map((row) => ({
        id: row.id,
        trainRunId: row.train_run_id,
        sectionIndex: row.section_index,
        startTime: this.toIso(row.start_time),
        endTime: this.toIso(row.end_time),
        fromLocationId: row.from_location_id,
        toLocationId: row.to_location_id,
        pathId: row.path_id ?? undefined,
        distanceKm: row.distance_km ?? undefined,
        attributes: row.attributes ?? undefined,
      })),
    };
  }

  async updateStageMetadata(
    stageId: StageId,
    timeline: TimelineRange,
    version?: string | null,
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    const resolvedVersion = version ?? new Date().toISOString();
    await this.database.query(
      `
        INSERT INTO planning_stage (stage_id, version, timeline_start, timeline_end)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (stage_id) DO UPDATE
        SET version = EXCLUDED.version,
            timeline_start = EXCLUDED.timeline_start,
            timeline_end = EXCLUDED.timeline_end
      `,
      [stageId, resolvedVersion, timeline.start, timeline.end],
    );
  }

  async applyResourceMutations(
    stageId: StageId,
    upserts: Resource[],
    deleteIds: string[],
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    if (!upserts.length && !deleteIds.length) {
      return;
    }

    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        if (upserts.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($2::jsonb)
                     AS r(
                       id TEXT,
                       name TEXT,
                       kind TEXT,
                       "dailyServiceCapacity" INTEGER,
                       attributes JSONB
                     )
              )
              INSERT INTO planning_resource (
                id, stage_id, name, kind, daily_service_capacity, attributes
              )
              SELECT
                id,
                $1,
                name,
                kind,
                "dailyServiceCapacity",
                attributes
              FROM payload
              ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                kind = EXCLUDED.kind,
                daily_service_capacity = EXCLUDED.daily_service_capacity,
                attributes = EXCLUDED.attributes,
                updated_at = now()
            `,
            [stageId, JSON.stringify(upserts)],
          );
        }

        if (deleteIds.length) {
          await client.query(
            `
              DELETE FROM planning_resource
              WHERE stage_id = $1
                AND id = ANY($2::text[])
            `,
            [stageId, deleteIds],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Fehler beim Speichern der Ressourcen für Stage ${stageId}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async applyActivityMutations(
    stageId: StageId,
    upserts: Activity[],
    deleteIds: string[],
  ): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    if (!upserts.length && !deleteIds.length) {
      return;
    }

    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        if (upserts.length) {
          await client.query(
            `
              WITH payload AS (
                SELECT *
                FROM jsonb_to_recordset($2::jsonb)
                     AS a(
                       id TEXT,
                       "clientId" TEXT,
                       title TEXT,
                       start TIMESTAMPTZ,
                       "end" TIMESTAMPTZ,
                       type TEXT,
                       "from" TEXT,
                       "to" TEXT,
                       remark TEXT,
                       "serviceId" TEXT,
                       "serviceTemplateId" TEXT,
                       "serviceDate" DATE,
                       "serviceCategory" TEXT,
                       "serviceRole" TEXT,
                       "locationId" TEXT,
                       "locationLabel" TEXT,
                       "capacityGroupId" TEXT,
                       "requiredQualifications" TEXT[],
                       "assignedQualifications" TEXT[],
                       "workRuleTags" TEXT[],
                       "rowVersion" TEXT,
                       "createdAt" TIMESTAMPTZ,
                       "createdBy" TEXT,
                       "updatedAt" TIMESTAMPTZ,
                       "updatedBy" TEXT,
                       scope TEXT,
                       participants JSONB,
                       "groupId" TEXT,
                       "groupOrder" INTEGER,
                       "trainRunId" TEXT,
                       "trainSegmentIds" TEXT[],
                       attributes JSONB,
                       meta JSONB
                     )
              )
              INSERT INTO planning_activity (
                id,
                stage_id,
                client_id,
                title,
                start,
                "end",
                type,
                "from",
                "to",
                remark,
                service_id,
                service_template_id,
                service_date,
                service_category,
                service_role,
                location_id,
                location_label,
                capacity_group_id,
                required_qualifications,
                assigned_qualifications,
                work_rule_tags,
                row_version,
                created_at,
                created_by,
                updated_at,
                updated_by,
                scope,
                participants,
                group_id,
                group_order,
                train_run_id,
                train_segment_ids,
                attributes,
                meta
              )
              SELECT
                id,
                $1,
                "clientId",
                title,
                start,
                "end",
                type,
                "from",
                "to",
                remark,
                "serviceId",
                "serviceTemplateId",
                "serviceDate",
                "serviceCategory",
                "serviceRole",
                "locationId",
                "locationLabel",
                "capacityGroupId",
                "requiredQualifications",
                "assignedQualifications",
                "workRuleTags",
                COALESCE("rowVersion", now()::text),
                COALESCE("createdAt", now()),
                "createdBy",
                now(),
                "updatedBy",
                scope,
                participants,
                "groupId",
                "groupOrder",
                "trainRunId",
                "trainSegmentIds",
                attributes,
                meta
              FROM payload
              ON CONFLICT (id) DO UPDATE SET
                client_id = EXCLUDED.client_id,
                title = EXCLUDED.title,
                start = EXCLUDED.start,
                "end" = EXCLUDED."end",
                type = EXCLUDED.type,
                "from" = EXCLUDED."from",
                "to" = EXCLUDED."to",
                remark = EXCLUDED.remark,
                service_id = EXCLUDED.service_id,
                service_template_id = EXCLUDED.service_template_id,
                service_date = EXCLUDED.service_date,
                service_category = EXCLUDED.service_category,
                service_role = EXCLUDED.service_role,
                location_id = EXCLUDED.location_id,
                location_label = EXCLUDED.location_label,
                capacity_group_id = EXCLUDED.capacity_group_id,
                required_qualifications = EXCLUDED.required_qualifications,
                assigned_qualifications = EXCLUDED.assigned_qualifications,
                work_rule_tags = EXCLUDED.work_rule_tags,
                row_version = EXCLUDED.row_version,
                attributes = EXCLUDED.attributes,
                meta = EXCLUDED.meta,
                updated_by = EXCLUDED.updated_by,
                scope = EXCLUDED.scope,
                participants = EXCLUDED.participants,
                group_id = EXCLUDED.group_id,
                group_order = EXCLUDED.group_order,
                train_run_id = EXCLUDED.train_run_id,
                train_segment_ids = EXCLUDED.train_segment_ids,
                updated_at = now()
            `,
            [stageId, JSON.stringify(upserts)],
          );
        }

        if (deleteIds.length) {
          await client.query(
            `
              DELETE FROM planning_activity
              WHERE stage_id = $1
                AND id = ANY($2::text[])
            `,
            [stageId, deleteIds],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Fehler beim Speichern der Aktivitäten für Stage ${stageId}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async deleteActivities(stageId: StageId, deleteIds: string[]): Promise<void> {
    if (!this.isEnabled || !deleteIds.length) {
      return;
    }
    await this.database.query(
      `
        DELETE FROM planning_activity
        WHERE stage_id = $1
          AND id = ANY($2::text[])
      `,
      [stageId, deleteIds],
    );
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

  async loadActivityCatalog(): Promise<ActivityCatalogData> {
    if (!this.isEnabled) {
      return this.createEmptyActivityCatalog();
    }

    const [
      typeResult,
      templateResult,
      definitionResult,
      layerResult,
      translationResult,
    ] = await Promise.all([
      this.database.query<ActivityTypeDefinitionRow>(
        `
            SELECT
              id,
              label,
              description,
              applies_to,
              relevant_for,
              category,
              time_mode,
              fields,
              default_duration_minutes
            FROM activity_type_definition
            ORDER BY id
          `,
      ),
      this.database.query<ActivityTemplateRow>(
        `
            SELECT
              id,
              label,
              description,
              activity_type,
              default_duration_minutes,
              attributes
            FROM activity_template
            ORDER BY id
          `,
      ),
      this.database.query<ActivityDefinitionRow>(
        `
            SELECT
              id,
              label,
              description,
              activity_type,
              template_id,
              default_duration_minutes,
              relevant_for,
              attributes
            FROM activity_definition
            ORDER BY id
          `,
      ),
      this.database.query<ActivityLayerGroupRow>(
        `
            SELECT id, label, sort_order, description
            FROM activity_layer_group
            ORDER BY sort_order, id
          `,
      ),
      this.database.query<ActivityTranslationRow>(
        `
            SELECT locale, translation_key, label, abbreviation
            FROM activity_translation
            ORDER BY locale, translation_key
          `,
      ),
    ]);

    return {
      types: typeResult.rows.map((row) => this.mapActivityTypeDefinition(row)),
      templates: templateResult.rows.map((row) =>
        this.mapActivityTemplate(row),
      ),
      definitions: definitionResult.rows.map((row) =>
        this.mapActivityDefinition(row),
      ),
      layerGroups: layerResult.rows.map((row) =>
        this.mapActivityLayerGroup(row),
      ),
      translations: this.mapTranslations(translationResult.rows),
    };
  }

  async replaceActivityCatalog(catalog: ActivityCatalogData): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM activity_definition');
        await client.query('DELETE FROM activity_template');
        await client.query('DELETE FROM activity_type_definition');
        await client.query('DELETE FROM activity_layer_group');
        await client.query('DELETE FROM activity_translation');

        if (catalog.layerGroups.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  "order" INTEGER,
                  description TEXT
                )
              )
              INSERT INTO activity_layer_group (
                id,
                label,
                sort_order,
                description
              )
              SELECT
                id,
                label,
                COALESCE("order", 50),
                description
              FROM incoming
            `,
            [JSON.stringify(catalog.layerGroups)],
          );
        }

        if (catalog.types.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  description TEXT,
                  "appliesTo" TEXT[],
                  "relevantFor" TEXT[],
                  category TEXT,
                  "timeMode" TEXT,
                  fields TEXT[],
                  "defaultDurationMinutes" INTEGER
                )
              )
              INSERT INTO activity_type_definition (
                id,
                label,
                description,
                applies_to,
                relevant_for,
                category,
                time_mode,
                fields,
                default_duration_minutes
              )
              SELECT
                id,
                label,
                description,
                "appliesTo",
                "relevantFor",
                category,
                "timeMode",
                fields,
                "defaultDurationMinutes"
              FROM incoming
            `,
            [JSON.stringify(catalog.types)],
          );
        }

        if (catalog.templates.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  description TEXT,
                  "activityType" TEXT,
                  "defaultDurationMinutes" INTEGER,
                  attributes JSONB
                )
              )
              INSERT INTO activity_template (
                id,
                label,
                description,
                activity_type,
                default_duration_minutes,
                attributes
              )
              SELECT
                id,
                label,
                description,
                "activityType",
                "defaultDurationMinutes",
                attributes
              FROM incoming
            `,
            [JSON.stringify(catalog.templates)],
          );
        }

        if (catalog.definitions.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  description TEXT,
                  "activityType" TEXT,
                  "templateId" TEXT,
                  "defaultDurationMinutes" INTEGER,
                  "relevantFor" TEXT[],
                  attributes JSONB
                )
              )
              INSERT INTO activity_definition (
                id,
                label,
                description,
                activity_type,
                template_id,
                default_duration_minutes,
                relevant_for,
                attributes
              )
              SELECT
                id,
                label,
                description,
                "activityType",
                "templateId",
                "defaultDurationMinutes",
                "relevantFor",
                attributes
              FROM incoming
            `,
            [JSON.stringify(catalog.definitions)],
          );
        }

        const translationRows = this.flattenTranslations(catalog.translations);
        if (translationRows.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  locale TEXT,
                  translation_key TEXT,
                  label TEXT,
                  abbreviation TEXT
                )
              )
              INSERT INTO activity_translation (
                locale,
                translation_key,
                label,
                abbreviation
              )
              SELECT locale, translation_key, label, abbreviation
              FROM incoming
            `,
            [JSON.stringify(translationRows)],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Fehler beim Speichern des Activity-Katalogs',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
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
            "externalRef" TEXT,
            "homeBase" TEXT,
            attributes JSONB
          )
        )
        INSERT INTO personnel (
          id,
          name,
          external_ref,
          home_base,
          deleted,
          attributes
        )
        SELECT
          id,
          name,
          "externalRef",
          "homeBase",
          FALSE,
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
            "poolId" TEXT,
            attributes JSONB
          )
        )
        INSERT INTO personnel_services (
          id,
          label,
          pool_id,
          deleted,
          attributes
        )
        SELECT
          id,
          name,
          "poolId",
          FALSE,
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
            "typeId" TEXT,
            "externalRef" TEXT,
            "homeDepot" TEXT,
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
          attributes
        )
        SELECT
          id,
          name,
          "typeId",
          "externalRef",
          "homeDepot",
          FALSE,
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
            "poolId" TEXT,
            attributes JSONB
          )
        )
        INSERT INTO vehicle_services (
          id,
          label,
          pool_id,
          deleted,
          attributes
        )
        SELECT
          id,
          name,
          "poolId",
          FALSE,
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
            "maxSpeed" INTEGER,
            "maintenanceIntervalDays" INTEGER,
            "energyType" TEXT,
            manufacturer TEXT,
            "trainTypeCode" TEXT,
            "lengthMeters" NUMERIC,
            "weightTons" NUMERIC,
            "brakeType" TEXT,
            "brakePercentage" INTEGER,
            "tiltingCapability" TEXT,
            "powerSupplySystems" TEXT[],
            "trainProtectionSystems" TEXT[],
            "etcsLevel" TEXT,
            "gaugeProfile" TEXT,
            "maxAxleLoad" NUMERIC,
            "noiseCategory" TEXT,
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
          "maxSpeed",
          "maintenanceIntervalDays",
          "energyType",
          manufacturer,
          "trainTypeCode",
          "lengthMeters",
          "weightTons",
          "brakeType",
          "brakePercentage",
          "tiltingCapability",
          "powerSupplySystems",
          "trainProtectionSystems",
          "etcsLevel",
          "gaugeProfile",
          "maxAxleLoad",
          "noiseCategory",
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
                  "turnaroundBuffer" TEXT,
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
              NULLIF("turnaroundBuffer", '')::interval,
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
                INSERT INTO vehicle_composition_entry (
                  composition_id,
                  type_id,
                  quantity
                )
                SELECT
                  "compositionId",
                  "typeId",
                  quantity
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
          'Fehler beim Speichern der Fahrzeugzusammenstellungen',
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

  private mapActivityTypeDefinition(
    row: ActivityTypeDefinitionRow,
  ): ActivityTypeDefinition {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      appliesTo: this.toResourceKinds(row.applies_to),
      relevantFor: this.toResourceKinds(row.relevant_for),
      category: row.category as ActivityTypeDefinition['category'],
      timeMode: row.time_mode as ActivityTypeDefinition['timeMode'],
      fields: this.toActivityFields(row.fields),
      defaultDurationMinutes: row.default_duration_minutes,
    };
  }

  private mapActivityTemplate(row: ActivityTemplateRow): ActivityTemplate {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      activityType: row.activity_type ?? undefined,
      defaultDurationMinutes: row.default_duration_minutes ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapActivityDefinition(
    row: ActivityDefinitionRow,
  ): ActivityDefinition {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      activityType: row.activity_type,
      templateId: row.template_id ?? undefined,
      defaultDurationMinutes: row.default_duration_minutes ?? undefined,
      relevantFor: this.toResourceKinds(row.relevant_for),
      attributes: row.attributes ?? undefined,
    };
  }

  private mapActivityLayerGroup(row: ActivityLayerGroupRow): LayerGroup {
    return {
      id: row.id,
      label: row.label,
      order: row.sort_order ?? undefined,
      description: row.description ?? undefined,
    };
  }

  private mapTranslations(rows: ActivityTranslationRow[]): TranslationState {
    const state: TranslationState = {};
    rows.forEach((row) => {
      const localeBucket = state[row.locale] ?? {};
      localeBucket[row.translation_key] = {
        label: row.label ?? undefined,
        abbreviation: row.abbreviation ?? undefined,
      };
      state[row.locale] = localeBucket;
    });
    return state;
  }

  private flattenTranslations(
    state: TranslationState,
  ): ActivityTranslationRow[] {
    const rows: ActivityTranslationRow[] = [];
    Object.entries(state ?? {}).forEach(([locale, entries]) => {
      if (!locale) {
        return;
      }
      Object.entries(entries ?? {}).forEach(([key, value]) => {
        if (!key) {
          return;
        }
        rows.push({
          locale,
          translation_key: key,
          label: value?.label ?? null,
          abbreviation: value?.abbreviation ?? null,
        });
      });
    });
    return rows;
  }

  private toResourceKinds(values?: string[] | null): ResourceKind[] {
    const allowed: ResourceKind[] = [
      'personnel-service',
      'vehicle-service',
      'personnel',
      'vehicle',
    ];
    const allowedSet = new Set<ResourceKind>(allowed);
    return (values ?? [])
      .map((entry) => entry?.trim())
      .filter((entry): entry is ResourceKind => Boolean(entry) && allowedSet.has(entry as ResourceKind));
  }

  private toActivityFields(values?: string[] | null): ActivityFieldKey[] {
    const allowed: ActivityFieldKey[] = ['start', 'end', 'from', 'to', 'remark'];
    const allowedSet = new Set<ActivityFieldKey>(allowed);
    return (values ?? [])
      .map((entry) => entry?.trim())
      .filter((entry): entry is ActivityFieldKey => Boolean(entry) && allowedSet.has(entry as ActivityFieldKey));
  }

  private mapPersonnel(row: PersonnelRow): Personnel {
    return {
      id: row.id,
      name: row.name,
      externalRef: row.external_ref ?? undefined,
      homeBase: row.home_base ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapPersonnelService(row: PersonnelServiceRow): PersonnelService {
    return {
      id: row.id,
      name: row.label,
      poolId: row.pool_id ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapVehicle(row: VehicleRow): Vehicle {
    return {
      id: row.id,
      name: row.label,
      typeId: row.type_id ?? undefined,
      externalRef: row.external_ref ?? undefined,
      homeDepot: row.home_depot ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapVehicleService(row: VehicleServiceRow): VehicleService {
    return {
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
    return poolRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      personnelIds: membersByPool.get(row.id) ?? [],
      locationCode: row.location_code ?? undefined,
      attributes: row.attributes ?? undefined,
    }));
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
    return poolRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      serviceIds: membersByPool.get(row.id) ?? [],
      shiftCoordinator: undefined,
      contactEmail: undefined,
      attributes: row.attributes ?? undefined,
    }));
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
    return poolRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      vehicleIds: membersByPool.get(row.id) ?? [],
      depotManager: row.depot_manager ?? undefined,
      attributes: row.attributes ?? undefined,
    }));
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
    return poolRows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      serviceIds: membersByPool.get(row.id) ?? [],
      dispatcher: undefined,
      attributes: row.attributes ?? undefined,
    }));
  }

  private mapResource(row: ResourceRow): Resource {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as Resource['kind'],
      dailyServiceCapacity: row.daily_service_capacity ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapActivity(row: ActivityRow): Activity {
    let participants: Activity['participants'] | undefined;
    if (row.participants && Array.isArray(row.participants)) {
      participants = row.participants.map((entry) => ({
        resourceId: String(entry.resourceId),
        kind: entry.kind,
        role: entry.role ?? undefined,
      }));
    }

    return {
      id: row.id,
      clientId: row.client_id ?? undefined,
      title: row.title,
      start: this.toIso(row.start),
      end: row.end ? this.toIso(row.end) : undefined,
      type: row.type ?? undefined,
      from: row.from ?? undefined,
      to: row.to ?? undefined,
      remark: row.remark ?? undefined,
      serviceId: row.service_id ?? undefined,
      serviceTemplateId: row.service_template_id ?? undefined,
      serviceDate: this.toDateString(row.service_date),
      serviceCategory: row.service_category ?? undefined,
      serviceRole: row.service_role ?? undefined,
      locationId: row.location_id ?? undefined,
      locationLabel: row.location_label ?? undefined,
      capacityGroupId: row.capacity_group_id ?? undefined,
      requiredQualifications: row.required_qualifications ?? undefined,
      assignedQualifications: row.assigned_qualifications ?? undefined,
      workRuleTags: row.work_rule_tags ?? undefined,
      rowVersion: row.row_version ?? undefined,
      createdAt: row.created_at ? this.toIso(row.created_at) : undefined,
      createdBy: row.created_by ?? undefined,
      updatedAt: row.updated_at ? this.toIso(row.updated_at) : undefined,
      updatedBy: row.updated_by ?? undefined,
      scope: (row.scope as any) ?? undefined,
      participants,
      groupId: row.group_id ?? undefined,
      groupOrder: row.group_order ?? undefined,
      trainRunId: row.train_run_id ?? undefined,
      trainSegmentIds: row.train_segment_ids ?? undefined,
      attributes: row.attributes ?? undefined,
      meta: row.meta ?? undefined,
    };
  }

  private toIso(value: string | Date): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private toDateString(value: string | Date | null): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value instanceof Date) {
      return value.toISOString().substring(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? undefined
      : parsed.toISOString().substring(0, 10);
  }

  private mapPersonnelServicePool(
    row: PersonnelServicePoolRow,
  ): PersonnelServicePool {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      serviceIds: [...(row.service_ids ?? [])],
      shiftCoordinator: row.shift_coordinator ?? undefined,
      contactEmail: row.contact_email ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapPersonnelPool(row: PersonnelPoolRow): PersonnelPool {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      personnelIds: [...(row.personnel_ids ?? [])],
      locationCode: row.location_code ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapVehicleServicePool(
    row: VehicleServicePoolRow,
  ): VehicleServicePool {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      serviceIds: [...(row.service_ids ?? [])],
      dispatcher: row.dispatcher ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapVehiclePool(row: VehiclePoolRow): VehiclePool {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      vehicleIds: [...(row.vehicle_ids ?? [])],
      depotManager: row.depot_manager ?? undefined,
      attributes: row.attributes ?? undefined,
    };
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

  private flattenMembers(
    items: { poolId: string; members: string[] }[],
  ): { pool_id: string; member_id: string }[] {
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
            `Topologie-Tabelle ${tableName} ohne payload-Spalte gefunden – Migration 004 muss noch ausgeführt werden. Verwende leere Sammlung.`,
          );
        }
        this.missingTopologyTables.add(tableName);
        return [];
      }
      throw error;
    }
  }

  private createEmptyActivityCatalog(): ActivityCatalogData {
    return {
      types: [],
      templates: [],
      definitions: [],
      layerGroups: [],
      translations: {},
    };
  }

  private createEmptyMasterData(): MasterDataSets {
    return {
      personnel: [],
      personnelServices: [],
      personnelServicePools: [],
      personnelPools: [],
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

  private warnTopologyTableOnce(tableName: string, message: string): void {
    if (this.missingTopologyTables.has(tableName)) {
      return;
    }
    this.missingTopologyTables.add(tableName);
    this.logger.warn(`Topologie-Tabelle ${tableName} ${message}`);
  }
}
