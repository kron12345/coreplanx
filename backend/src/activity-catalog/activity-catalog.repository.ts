import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ActivityCatalogEntry } from './activity-catalog.types';

interface ActivityCatalogRow {
  id: string;
  label: string;
  description: string | null;
  applies_to: string[] | null;
  relevant_for: string[] | null;
  category: string;
  time_mode: string;
  fields: string[] | null;
  default_duration_minutes: number;
  attributes: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ActivityCatalogRepository {
  private readonly logger = new Logger(ActivityCatalogRepository.name);

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async list(): Promise<ActivityCatalogEntry[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<ActivityCatalogRow>(
      `
        SELECT id, label, description, applies_to, relevant_for, category, time_mode,
               fields, default_duration_minutes, attributes, meta, created_at, updated_at
        FROM activity_catalog_entry
        ORDER BY label, id
      `,
    );
    return result.rows.map((row) => this.mapRow(row));
  }

  async upsertMany(entries: ActivityCatalogEntry[]): Promise<void> {
    if (!this.isEnabled || !entries.length) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await this.upsertManyWithClient(client, entries);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error('Failed to upsert activity catalog entries', error as any);
        throw error;
      }
    });
  }

  async replaceAll(entries: ActivityCatalogEntry[]): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('TRUNCATE activity_catalog_entry');
        if (entries.length) {
          await this.upsertManyWithClient(client, entries);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error('Failed to replace activity catalog entries', error as any);
        throw error;
      }
    });
  }

  private async upsertManyWithClient(client: { query: (text: string, params?: any[]) => Promise<any> }, entries: ActivityCatalogEntry[]): Promise<void> {
    if (!entries.length) {
      return;
    }
    await client.query(
      `
        WITH payload AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb)
               AS e(
                 id TEXT,
                 label TEXT,
                 description TEXT,
                 "appliesTo" TEXT[],
                 "relevantFor" TEXT[],
                 category TEXT,
                 "timeMode" TEXT,
                 fields TEXT[],
                 "defaultDurationMinutes" INTEGER,
                 attributes JSONB,
                 meta JSONB
               )
        )
        INSERT INTO activity_catalog_entry (
          id,
          label,
          description,
          applies_to,
          relevant_for,
          category,
          time_mode,
          fields,
          default_duration_minutes,
          attributes,
          meta,
          created_at,
          updated_at
        )
        SELECT
          id,
          label,
          NULLIF(description, ''),
          COALESCE("appliesTo", '{}'::text[]),
          COALESCE("relevantFor", '{}'::text[]),
          category,
          "timeMode",
          COALESCE(fields, '{}'::text[]),
          COALESCE("defaultDurationMinutes", 0),
          attributes,
          meta,
          now(),
          now()
        FROM payload
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label,
          description = EXCLUDED.description,
          applies_to = EXCLUDED.applies_to,
          relevant_for = EXCLUDED.relevant_for,
          category = EXCLUDED.category,
          time_mode = EXCLUDED.time_mode,
          fields = EXCLUDED.fields,
          default_duration_minutes = EXCLUDED.default_duration_minutes,
          attributes = EXCLUDED.attributes,
          meta = EXCLUDED.meta,
          updated_at = now()
      `,
      [JSON.stringify(entries)],
    );
  }

  private mapRow(row: ActivityCatalogRow): ActivityCatalogEntry {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      appliesTo: row.applies_to ?? [],
      relevantFor: row.relevant_for ?? [],
      category: row.category,
      timeMode: row.time_mode,
      fields: row.fields ?? [],
      defaultDurationMinutes: row.default_duration_minutes ?? 0,
      attributes: row.attributes ?? undefined,
      meta: row.meta ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
