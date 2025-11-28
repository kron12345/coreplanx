import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ActivityDto, TimelineServiceDto } from '../timeline/timeline.types';
import {
  TimelineActivityRow,
  mapActivityRow,
  aggregateServices,
} from '../timeline/timeline.helpers';
import { TemplateTableUtil } from './template.util';
import { ActivityTemplateSet } from './template.types';
import { randomUUID } from 'crypto';

interface TemplateSetRow {
  id: string;
  name: string;
  description: string | null;
  table_name: string;
  created_at: string;
  updated_at: string;
}

interface ActivityRow extends TimelineActivityRow {
  deleted: boolean;
  deleted_at: string | null;
}

@Injectable()
export class TemplateRepository {
  private readonly logger = new Logger(TemplateRepository.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly tableUtil: TemplateTableUtil,
  ) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async listTemplateSets(): Promise<ActivityTemplateSet[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<TemplateSetRow>(
      `
        SELECT id, name, description, table_name, created_at, updated_at
        FROM activity_template_set
        ORDER BY name
      `,
    );
    return result.rows.map((row) => this.mapTemplateSet(row));
  }

  async getTemplateSet(id: string): Promise<ActivityTemplateSet | null> {
    if (!this.isEnabled) {
      return null;
    }
    const result = await this.database.query<TemplateSetRow>(
      `
        SELECT id, name, description, table_name, created_at, updated_at
        FROM activity_template_set
        WHERE id = $1
      `,
      [id],
    );
    const row = result.rows[0];
    return row ? this.mapTemplateSet(row) : null;
  }

  async createTemplateSet(set: ActivityTemplateSet): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `
            INSERT INTO activity_template_set (
              id, name, description, table_name, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            set.id,
            set.name,
            set.description ?? null,
            set.tableName,
            set.createdAt,
            set.updatedAt,
          ],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    await this.tableUtil.createTemplateTable(set.tableName);
  }

  async updateTemplateSet(set: ActivityTemplateSet): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.query(
      `
        UPDATE activity_template_set
        SET name = $2,
            description = $3,
            updated_at = $4
        WHERE id = $1
      `,
      [set.id, set.name, set.description ?? null, set.updatedAt],
    );
  }

  async deleteTemplateSet(id: string): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const row = await this.getTemplateSet(id);
    if (!row) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `DELETE FROM activity_template_set WHERE id = $1`,
          [id],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    await this.tableUtil.dropTemplateTable(row.tableName);
  }

  async listActivities(
    tableName: string,
    from: string,
    to: string,
    stage: 'base' | 'operations',
  ): Promise<ActivityDto[]> {
    const safeTable = this.tableUtil.sanitize(tableName);
    const result = await this.database.query<ActivityRow>(
      `
        SELECT
          id,
          type,
          stage,
          deleted,
          deleted_at,
          start_time,
          end_time,
          is_open_ended,
          attributes
        FROM ${safeTable}
        WHERE deleted = FALSE
          AND stage = $1
          AND start_time < $3
          AND (end_time IS NULL OR end_time > $2 OR is_open_ended = TRUE)
      `,
      [stage, from, to],
    );
    return result.rows
      .map((row) => mapActivityRow(row, this.logger))
      .filter((dto): dto is ActivityDto => dto !== null);
  }

  async listAggregatedServices(
    tableName: string,
    from: string,
    to: string,
    stage: 'base' | 'operations',
  ): Promise<TimelineServiceDto[]> {
    const activities = await this.listActivities(tableName, from, to, stage);
    return aggregateServices(activities);
  }

  async upsertActivity(tableName: string, activity: ActivityDto): Promise<ActivityDto> {
    const safeTable = this.tableUtil.sanitize(tableName);
    const isOpenEnded = activity.isOpenEnded || !activity.end;
    const attributes = {
      versions: [
        {
          version: activity.version ?? 1,
          validFrom: activity.start,
          validTo: null,
          data: {
            label: activity.label ?? null,
            serviceId: activity.serviceId ?? null,
            serviceRole: activity.serviceRole ?? null,
            start: activity.start,
            end: activity.end ?? null,
            status: activity.status ?? null,
            from: activity.from ?? null,
            to: activity.to ?? null,
            remark: activity.remark ?? null,
            resourceAssignments: activity.resourceAssignments ?? [],
            attributes: activity.attributes ?? null,
          },
        },
      ],
    };
    await this.database.query(
      `
        INSERT INTO ${safeTable} (
          id, type, stage, deleted, start_time, end_time, is_open_ended, attributes, audit_trail
        )
        VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7::jsonb, '[]'::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          stage = EXCLUDED.stage,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          is_open_ended = EXCLUDED.is_open_ended,
          attributes = EXCLUDED.attributes,
          updated_at = now()
      `,
      [
        activity.id,
        activity.type,
        activity.stage,
        activity.start,
        activity.end ?? null,
        isOpenEnded,
        JSON.stringify(attributes),
      ],
    );
    return {
      ...activity,
      resourceAssignments: activity.resourceAssignments ?? [],
    };
  }

  async deleteActivity(tableName: string, activityId: string): Promise<void> {
    const safeTable = this.tableUtil.sanitize(tableName);
    await this.database.query(
      `
        DELETE FROM ${safeTable}
        WHERE id = $1
      `,
      [activityId],
    );
  }

  async rolloutToPlanning(
    tableName: string,
    targetStage: 'base' | 'operations',
    anchorStart?: string,
  ): Promise<ActivityDto[]> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    const activities = await this.listActivities(
      tableName,
      '1900-01-01T00:00:00Z',
      '9999-12-31T23:59:59Z',
      targetStage,
    );
    if (!activities.length) {
      return [];
    }
    let offsetMs = 0;
    if (anchorStart) {
      const minStart = Math.min(
        ...activities.map((a) => Date.parse(a.start)).filter((v) => !Number.isNaN(v)),
      );
      const anchorMs = Date.parse(anchorStart);
      if (!Number.isNaN(anchorMs) && !Number.isNaN(minStart)) {
        offsetMs = anchorMs - minStart;
      }
    }

    const payload = activities.map((activity) => {
      const startMs = Date.parse(activity.start);
      const endMs = activity.end ? Date.parse(activity.end) : NaN;
      const shiftedStart = Number.isNaN(startMs)
        ? activity.start
        : new Date(startMs + offsetMs).toISOString();
      const shiftedEnd =
        activity.end && !Number.isNaN(endMs)
          ? new Date(endMs + offsetMs).toISOString()
          : null;
      const isOpenEnded = activity.isOpenEnded || !shiftedEnd;
      const newId = randomUUID();
      const attributes = {
        versions: [
          {
            version: 1,
            validFrom: shiftedStart,
            validTo: null,
            data: {
              label: activity.label ?? null,
              serviceId: activity.serviceId ?? null,
              serviceRole: activity.serviceRole ?? null,
              start: shiftedStart,
              end: shiftedEnd,
              status: activity.status ?? null,
              from: activity.from ?? null,
              to: activity.to ?? null,
              remark: activity.remark ?? null,
              resourceAssignments: activity.resourceAssignments ?? [],
              attributes: activity.attributes ?? null,
            },
          },
        ],
      };
      return {
        id: newId,
        type: activity.type,
        stage: targetStage,
        start_time: shiftedStart,
        end_time: shiftedEnd,
        is_open_ended: isOpenEnded,
        attributes,
      };
    });

    await this.database.query(
      `
        INSERT INTO activities (
          id, type, stage, deleted, start_time, end_time, is_open_ended, attributes, audit_trail
        )
        SELECT
          id,
          type,
          stage,
          FALSE,
          start_time,
          end_time,
          is_open_ended,
          attributes,
          '[]'::jsonb
        FROM jsonb_to_recordset($1::jsonb) AS x(
          id TEXT,
          type TEXT,
          stage TEXT,
          start_time TIMESTAMPTZ,
          end_time TIMESTAMPTZ,
          is_open_ended BOOLEAN,
          attributes JSONB
        )
      `,
      [JSON.stringify(payload)],
    );

    return payload.map((row) => {
      const version = row.attributes.versions?.[0];
      const data = version?.data ?? {};
      const activityAttributes =
        data.attributes === undefined ? undefined : data.attributes;
      return {
        id: row.id,
        stage: row.stage,
        type: row.type,
        start: row.start_time,
        end: row.end_time,
        isOpenEnded: row.is_open_ended,
        label: data.label ?? undefined,
        serviceId: data.serviceId ?? undefined,
        serviceRole: data.serviceRole ?? undefined,
        from: data.from ?? undefined,
        to: data.to ?? undefined,
        remark: data.remark ?? undefined,
        resourceAssignments: data.resourceAssignments ?? [],
        attributes: activityAttributes,
        version: version?.version ?? 1,
      };
    });
  }

  private mapTemplateSet(row: TemplateSetRow): ActivityTemplateSet {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      tableName: row.table_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

}
