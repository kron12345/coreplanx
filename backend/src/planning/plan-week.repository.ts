import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  PlanWeekTemplate,
  PlanWeekSlice,
  PlanWeekActivity,
  PlanWeekValidity,
  WeekInstance,
  ScheduledService,
  ServiceAssignment,
  WeekInstanceStatus,
} from './planning.types';

interface PlanWeekTemplateRow {
  id: string;
  label: string;
  description: string | null;
  base_week_start: string;
  variant: string | null;
  version: Date;
  created_at: Date;
  updated_at: Date;
}

interface PlanWeekSliceRow {
  id: string;
  template_id: string;
  label: string | null;
  start_date: string;
  end_date: string;
}

interface PlanWeekActivityRow {
  id: string;
  template_id: string;
  title: string;
  start_at: Date;
  end_at: Date | null;
  type: string | null;
  remark: string | null;
  attributes: Record<string, unknown> | null;
  participants: { resourceId: string; role?: string | null }[] | null;
}

interface PlanWeekValidityRow {
  id: string;
  template_id: string;
  valid_from: string;
  valid_to: string;
  include_week_numbers: number[] | null;
  exclude_week_numbers: number[] | null;
  status: string;
}

interface WeekInstanceRow {
  id: string;
  template_id: string;
  week_start: string;
  template_version: Date;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface ScheduledServiceRow {
  id: string;
  instance_id: string;
  slice_id: string;
  start_at: Date;
  end_at: Date;
  attributes: Record<string, unknown> | null;
}

interface ServiceAssignmentRow {
  id: string;
  scheduled_service_id: string;
  resource_id: string;
  resource_kind: string;
  assigned_at: Date;
  assigned_by: string | null;
}

export interface UpsertPlanWeekTemplateInput {
  id: string;
  label: string;
  description?: string | null;
  baseWeekStartIso: string;
  variant?: string | null;
  slices: PlanWeekSlice[];
  version: Date;
}

@Injectable()
export class PlanWeekRepository {
  private readonly logger = new Logger(PlanWeekRepository.name);

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async listTemplates(): Promise<PlanWeekTemplate[]> {
    if (!this.isEnabled) {
      return [];
    }
    const [templateResult, sliceResult] = await Promise.all([
      this.database.query<PlanWeekTemplateRow>(
        `
          SELECT id, label, description, base_week_start, variant, version, created_at, updated_at
          FROM plan_week_template
          ORDER BY label
        `,
      ),
      this.database.query<PlanWeekSliceRow>(
        `
          SELECT id, template_id, label, start_date, end_date
          FROM plan_week_slice
          ORDER BY template_id, start_date, id
        `,
      ),
    ]);

    const slicesByTemplate = new Map<string, PlanWeekSliceRow[]>();
    sliceResult.rows.forEach((slice) => {
      const existing = slicesByTemplate.get(slice.template_id) ?? [];
      existing.push(slice);
      slicesByTemplate.set(slice.template_id, existing);
    });

    return templateResult.rows.map((row) =>
      this.mapTemplate(row, slicesByTemplate.get(row.id) ?? []),
    );
  }

  async getTemplate(templateId: string): Promise<PlanWeekTemplate | null> {
    if (!this.isEnabled) {
      return null;
    }
    const templateResult = await this.database.query<PlanWeekTemplateRow>(
      `
        SELECT id, label, description, base_week_start, variant, version, created_at, updated_at
        FROM plan_week_template
        WHERE id = $1
      `,
      [templateId],
    );
    const templateRow = templateResult.rows[0];
    if (!templateRow) {
      return null;
    }
    const slicesResult = await this.database.query<PlanWeekSliceRow>(
      `
        SELECT id, template_id, label, start_date, end_date
        FROM plan_week_slice
        WHERE template_id = $1
        ORDER BY start_date, id
      `,
      [templateId],
    );
    return this.mapTemplate(templateRow, slicesResult.rows);
  }

  async upsertTemplate(
    payload: UpsertPlanWeekTemplateInput,
  ): Promise<PlanWeekTemplate> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    return this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const templateResult = await client.query<PlanWeekTemplateRow>(
          `
            INSERT INTO plan_week_template (
              id,
              label,
              description,
              base_week_start,
              variant,
              version
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
              label = EXCLUDED.label,
              description = EXCLUDED.description,
              base_week_start = EXCLUDED.base_week_start,
              variant = EXCLUDED.variant,
              version = EXCLUDED.version,
              updated_at = now()
            RETURNING id, label, description, base_week_start, variant, version, created_at, updated_at
          `,
          [
            payload.id,
            payload.label,
            payload.description ?? null,
            payload.baseWeekStartIso,
            payload.variant ?? null,
            payload.version,
          ],
        );

        await client.query(
          `
            DELETE FROM plan_week_slice
            WHERE template_id = $1
          `,
          [payload.id],
        );

        if (payload.slices.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($2::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  "startIso" DATE,
                  "endIso" DATE
                )
              )
              INSERT INTO plan_week_slice (
                id,
                template_id,
                label,
                start_date,
                end_date
              )
              SELECT
                id,
                $1,
                label,
                "startIso",
                "endIso"
              FROM incoming
            `,
            [payload.id, JSON.stringify(payload.slices)],
          );
        }

        const slicesResult = await client.query<PlanWeekSliceRow>(
          `
            SELECT id, template_id, label, start_date, end_date
            FROM plan_week_slice
            WHERE template_id = $1
            ORDER BY start_date, id
          `,
          [payload.id],
        );

        await client.query('COMMIT');
        return this.mapTemplate(templateResult.rows[0], slicesResult.rows);
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Failed to save plan week template ${payload.id}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async listTemplateActivities(
    templateId: string,
  ): Promise<PlanWeekActivity[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<PlanWeekActivityRow>(
      `
        SELECT
          id,
          template_id,
          title,
          start_at,
          end_at,
          type,
          remark,
          attributes,
          participants
        FROM plan_week_activity
        WHERE template_id = $1
        ORDER BY start_at, id
      `,
      [templateId],
    );
    return result.rows.map((row) => this.mapActivity(row));
  }

  async upsertTemplateActivity(
    activity: PlanWeekActivity,
  ): Promise<PlanWeekActivity> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const result = await this.database.query<PlanWeekActivityRow>(
      `
        INSERT INTO plan_week_activity (
          id,
          template_id,
          title,
          start_at,
          end_at,
          type,
          remark,
          attributes,
          participants
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          template_id = EXCLUDED.template_id,
          title = EXCLUDED.title,
          start_at = EXCLUDED.start_at,
          end_at = EXCLUDED.end_at,
          type = EXCLUDED.type,
          remark = EXCLUDED.remark,
          attributes = EXCLUDED.attributes,
          participants = EXCLUDED.participants,
          updated_at = now()
        RETURNING
          id,
          template_id,
          title,
          start_at,
          end_at,
          type,
          remark,
          attributes,
          participants
      `,
      [
        activity.id,
        activity.templateId,
        activity.title,
        new Date(activity.startIso),
        activity.endIso ? new Date(activity.endIso) : null,
        activity.type ?? null,
        activity.remark ?? null,
        activity.attributes ?? null,
        JSON.stringify(activity.participants ?? []),
      ],
    );
    return this.mapActivity(result.rows[0]);
  }

  async deleteTemplateActivity(
    templateId: string,
    activityId: string,
  ): Promise<boolean> {
    if (!this.isEnabled) {
      return false;
    }
    const result = await this.database.query(
      `
        DELETE FROM plan_week_activity
        WHERE id = $1
          AND template_id = $2
      `,
      [activityId, templateId],
    );
    return result.rowCount > 0;
  }

  async deleteTemplate(templateId: string): Promise<boolean> {
    if (!this.isEnabled) {
      return false;
    }
    const result = await this.database.query(
      `
        DELETE FROM plan_week_template
        WHERE id = $1
      `,
      [templateId],
    );
    return result.rowCount > 0;
  }

  async listValidities(templateId: string): Promise<PlanWeekValidity[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<PlanWeekValidityRow>(
      `
        SELECT id, template_id, valid_from, valid_to, include_week_numbers, exclude_week_numbers, status
        FROM plan_week_validity
        WHERE template_id = $1
        ORDER BY valid_from, id
      `,
      [templateId],
    );
    return result.rows.map((row) => this.mapValidity(row));
  }

  async upsertValidity(validity: PlanWeekValidity): Promise<PlanWeekValidity> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const result = await this.database.query<PlanWeekValidityRow>(
      `
        INSERT INTO plan_week_validity (
          id,
          template_id,
          valid_from,
          valid_to,
          include_week_numbers,
          exclude_week_numbers,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
          template_id = EXCLUDED.template_id,
          valid_from = EXCLUDED.valid_from,
          valid_to = EXCLUDED.valid_to,
          include_week_numbers = EXCLUDED.include_week_numbers,
          exclude_week_numbers = EXCLUDED.exclude_week_numbers,
          status = EXCLUDED.status,
          updated_at = now()
        RETURNING id, template_id, valid_from, valid_to, include_week_numbers, exclude_week_numbers, status
      `,
      [
        validity.id,
        validity.templateId,
        validity.validFromIso,
        validity.validToIso,
        validity.includeWeekNumbers ?? null,
        validity.excludeWeekNumbers ?? null,
        validity.status,
      ],
    );
    return this.mapValidity(result.rows[0]);
  }

  async deleteValidity(
    templateId: string,
    validityId: string,
  ): Promise<boolean> {
    if (!this.isEnabled) {
      return false;
    }
    const result = await this.database.query(
      `
        DELETE FROM plan_week_validity
        WHERE id = $1
          AND template_id = $2
      `,
      [validityId, templateId],
    );
    return result.rowCount > 0;
  }

  async listWeekInstances(range: {
    from: string;
    to: string;
  }): Promise<WeekInstance[]> {
    if (!this.isEnabled) {
      return [];
    }
    const instancesResult = await this.database.query<WeekInstanceRow>(
      `
        SELECT id, template_id, week_start, template_version, status, created_at, updated_at
        FROM week_instance
        WHERE week_start BETWEEN $1 AND $2
        ORDER BY week_start
      `,
      [range.from, range.to],
    );
    return this.hydrateWeekInstances(instancesResult.rows);
  }

  async getWeekInstance(weekInstanceId: string): Promise<WeekInstance | null> {
    if (!this.isEnabled) {
      return null;
    }
    const result = await this.database.query<WeekInstanceRow>(
      `
        SELECT id, template_id, week_start, template_version, status, created_at, updated_at
        FROM week_instance
        WHERE id = $1
      `,
      [weekInstanceId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const items = await this.hydrateWeekInstances([row]);
    return items[0] ?? null;
  }

  async saveWeekInstance(instance: WeekInstance): Promise<void> {
    return this.saveWeekInstances([instance]);
  }

  async saveWeekInstances(instances: WeekInstance[]): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    if (!instances.length) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const instance of instances) {
          await this.persistWeekInstance(client, instance);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Failed to save week instances',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async deleteWeekInstance(weekInstanceId: string): Promise<boolean> {
    if (!this.isEnabled) {
      return false;
    }
    const result = await this.database.query(
      `
        DELETE FROM week_instance
        WHERE id = $1
      `,
      [weekInstanceId],
    );
    return result.rowCount > 0;
  }

  async findExistingWeekStartConflicts(
    templateId: string,
    weekStartIsos: string[],
  ): Promise<string[]> {
    if (!this.isEnabled || !weekStartIsos.length) {
      return [];
    }
    const result = await this.database.query<{ week_start: string }>(
      `
        SELECT week_start
        FROM week_instance
        WHERE template_id = $1
          AND week_start = ANY($2::date[])
      `,
      [templateId, weekStartIsos],
    );
    return result.rows.map((row) => row.week_start);
  }

  private async persistWeekInstance(
    client: PoolClient,
    instance: WeekInstance,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO week_instance (
          id,
          template_id,
          week_start,
          template_version,
          status
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          template_id = EXCLUDED.template_id,
          week_start = EXCLUDED.week_start,
          template_version = EXCLUDED.template_version,
          status = EXCLUDED.status,
          updated_at = now()
      `,
      [
        instance.id,
        instance.templateId,
        instance.weekStartIso,
        new Date(instance.templateVersion),
        instance.status,
      ],
    );

    await client.query(
      `
        DELETE FROM scheduled_service
        WHERE instance_id = $1
      `,
      [instance.id],
    );

    if (instance.services.length) {
      await client.query(
        `
          WITH incoming AS (
            SELECT *
            FROM jsonb_to_recordset($2::jsonb) AS t(
              id TEXT,
              "sliceId" TEXT,
              "startIso" TIMESTAMPTZ,
              "endIso" TIMESTAMPTZ,
              attributes JSONB
            )
          )
          INSERT INTO scheduled_service (
            id,
            instance_id,
            slice_id,
            start_at,
            end_at,
            attributes
          )
          SELECT
            id,
            $1,
            "sliceId",
            "startIso",
            "endIso",
            attributes
          FROM incoming
        `,
        [instance.id, JSON.stringify(instance.services)],
      );
    }

    if (instance.assignments.length) {
      await client.query(
        `
          WITH incoming AS (
            SELECT *
            FROM jsonb_to_recordset($2::jsonb) AS t(
              id TEXT,
              "scheduledServiceId" TEXT,
              "resourceId" TEXT,
              "resourceKind" TEXT,
              "assignedAtIso" TIMESTAMPTZ,
              "assignedBy" TEXT
            )
          )
          INSERT INTO service_assignment (
            id,
            scheduled_service_id,
            resource_id,
            resource_kind,
            assigned_at,
            assigned_by
          )
          SELECT
            id,
            "scheduledServiceId",
            "resourceId",
            "resourceKind",
            "assignedAtIso",
            "assignedBy"
          FROM incoming
          ON CONFLICT (id) DO UPDATE SET
            scheduled_service_id = EXCLUDED.scheduled_service_id,
            resource_id = EXCLUDED.resource_id,
            resource_kind = EXCLUDED.resource_kind,
            assigned_at = EXCLUDED.assigned_at,
            assigned_by = EXCLUDED.assigned_by,
            updated_at = now()
        `,
        [instance.id, JSON.stringify(instance.assignments)],
      );
    }
  }

  private async hydrateWeekInstances(
    rows: WeekInstanceRow[],
  ): Promise<WeekInstance[]> {
    if (!rows.length) {
      return [];
    }
    const instanceIds = rows.map((row) => row.id);
    const serviceResult = await this.database.query<ScheduledServiceRow>(
      `
        SELECT id, instance_id, slice_id, start_at, end_at, attributes
        FROM scheduled_service
        WHERE instance_id = ANY($1::text[])
        ORDER BY start_at
      `,
      [instanceIds],
    );

    const serviceIds = serviceResult.rows.map((row) => row.id);
    const assignmentResult = serviceIds.length
      ? await this.database.query<ServiceAssignmentRow>(
          `
            SELECT id, scheduled_service_id, resource_id, resource_kind, assigned_at, assigned_by
            FROM service_assignment
            WHERE scheduled_service_id = ANY($1::text[])
            ORDER BY assigned_at
          `,
          [serviceIds],
        )
      : { rows: [] as ServiceAssignmentRow[] };

    const servicesByInstance = new Map<string, ScheduledServiceRow[]>();
    const serviceInstanceLookup = new Map<string, string>();
    serviceResult.rows.forEach((service) => {
      const list = servicesByInstance.get(service.instance_id) ?? [];
      list.push(service);
      servicesByInstance.set(service.instance_id, list);
      serviceInstanceLookup.set(service.id, service.instance_id);
    });

    const assignmentsByInstance = new Map<string, ServiceAssignmentRow[]>();
    assignmentResult.rows.forEach((assignment) => {
      const instanceId = serviceInstanceLookup.get(
        assignment.scheduled_service_id,
      );
      if (!instanceId) {
        return;
      }
      const list = assignmentsByInstance.get(instanceId) ?? [];
      list.push(assignment);
      assignmentsByInstance.set(instanceId, list);
    });

    return rows.map((row) =>
      this.mapWeekInstance(
        row,
        servicesByInstance.get(row.id) ?? [],
        assignmentsByInstance.get(row.id) ?? [],
      ),
    );
  }

  private mapTemplate(
    row: PlanWeekTemplateRow,
    slices: PlanWeekSliceRow[],
  ): PlanWeekTemplate {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      baseWeekStartIso: row.base_week_start,
      variant: row.variant ?? undefined,
      slices: slices.map((slice) => this.mapSlice(slice)),
      createdAtIso: row.created_at.toISOString(),
      updatedAtIso: row.updated_at.toISOString(),
      version: row.version.toISOString(),
    };
  }

  private mapSlice(row: PlanWeekSliceRow): PlanWeekSlice {
    return {
      id: row.id,
      templateId: row.template_id,
      label: row.label ?? undefined,
      startIso: row.start_date,
      endIso: row.end_date,
    };
  }

  private mapActivity(row: PlanWeekActivityRow): PlanWeekActivity {
    return {
      id: row.id,
      templateId: row.template_id,
      title: row.title,
      startIso: row.start_at.toISOString(),
      endIso: row.end_at?.toISOString(),
      type: row.type ?? undefined,
      remark: row.remark ?? undefined,
      attributes: row.attributes ?? undefined,
      participants:
        row.participants?.map((participant) => ({
          resourceId: participant.resourceId,
          role: participant.role ?? undefined,
        })) ?? [],
    };
  }

  private mapValidity(row: PlanWeekValidityRow): PlanWeekValidity {
    return {
      id: row.id,
      templateId: row.template_id,
      validFromIso: row.valid_from,
      validToIso: row.valid_to,
      includeWeekNumbers: row.include_week_numbers ?? undefined,
      excludeWeekNumbers: row.exclude_week_numbers ?? undefined,
      status: row.status as PlanWeekValidity['status'],
    };
  }

  private mapWeekInstance(
    row: WeekInstanceRow,
    services: ScheduledServiceRow[],
    assignments: ServiceAssignmentRow[],
  ): WeekInstance {
    const scheduledServices: ScheduledService[] = services.map((service) => ({
      id: service.id,
      instanceId: service.instance_id,
      sliceId: service.slice_id,
      startIso: service.start_at.toISOString(),
      endIso: service.end_at.toISOString(),
      attributes: service.attributes ?? undefined,
    }));

    const assignmentModels: ServiceAssignment[] = assignments.map(
      (assignment) => ({
        id: assignment.id,
        scheduledServiceId: assignment.scheduled_service_id,
        resourceId: assignment.resource_id,
        resourceKind:
          assignment.resource_kind as ServiceAssignment['resourceKind'],
        assignedAtIso: assignment.assigned_at.toISOString(),
        assignedBy: assignment.assigned_by ?? undefined,
      }),
    );

    return {
      id: row.id,
      templateId: row.template_id,
      weekStartIso: row.week_start,
      templateVersion: row.template_version.toISOString(),
      services: scheduledServices,
      assignments: assignmentModels.sort((a, b) =>
        a.assignedAtIso.localeCompare(b.assignedAtIso),
      ),
      status: row.status as WeekInstanceStatus,
    };
  }
}
