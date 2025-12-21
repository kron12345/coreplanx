import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface PlanningVariantRecord {
  id: string;
  timetableYearLabel: string;
  kind: 'productive' | 'simulation';
  label: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class VariantsRepository {
  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async listTimetableYears(): Promise<string[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<{ label: string }>(
      `SELECT label FROM timetable_year ORDER BY label`,
    );
    return result.rows.map((row) => row.label);
  }

  async upsertTimetableYear(label: string): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.query(
      `
        INSERT INTO timetable_year (label)
        VALUES ($1)
        ON CONFLICT (label) DO NOTHING
      `,
      [label],
    );
  }

  async listVariants(timetableYearLabel?: string): Promise<PlanningVariantRecord[]> {
    if (!this.isEnabled) {
      return [];
    }
    const params: any[] = [];
    let yearFilter = '';
    if (timetableYearLabel?.trim()) {
      params.push(timetableYearLabel.trim());
      yearFilter = `WHERE timetable_year_label = $1`;
    }
    const result = await this.database.query<{
      id: string;
      timetable_year_label: string;
      kind: 'productive' | 'simulation';
      label: string;
      description: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        SELECT id, timetable_year_label, kind, label, description, created_at, updated_at
        FROM planning_variant
        ${yearFilter}
        ORDER BY timetable_year_label, kind, label, id
      `,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      timetableYearLabel: row.timetable_year_label,
      kind: row.kind,
      label: row.label,
      description: row.description ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async upsertVariant(options: {
    id: string;
    timetableYearLabel: string;
    kind: PlanningVariantRecord['kind'];
    label: string;
    description?: string | null;
  }): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.query(
      `
        INSERT INTO planning_variant (id, timetable_year_label, kind, label, description)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
        SET timetable_year_label = EXCLUDED.timetable_year_label,
            kind = EXCLUDED.kind,
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            updated_at = now()
      `,
      [
        options.id,
        options.timetableYearLabel,
        options.kind,
        options.label,
        options.description ?? null,
      ],
    );
  }

  async getVariantById(id: string): Promise<PlanningVariantRecord | null> {
    if (!this.isEnabled) {
      return null;
    }
    const result = await this.database.query<{
      id: string;
      timetable_year_label: string;
      kind: 'productive' | 'simulation';
      label: string;
      description: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
        SELECT id, timetable_year_label, kind, label, description, created_at, updated_at
        FROM planning_variant
        WHERE id = $1
      `,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      timetableYearLabel: row.timetable_year_label,
      kind: row.kind,
      label: row.label,
      description: row.description ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async deleteVariant(id: string): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.query(`DELETE FROM planning_variant WHERE id = $1`, [id]);
  }

  async deleteTimetableYear(label: string): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('Database connection not configured');
    }
    await this.database.query(`DELETE FROM timetable_year WHERE label = $1`, [label]);
  }
}
