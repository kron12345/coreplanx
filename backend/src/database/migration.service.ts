import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PoolClient } from 'pg';
import * as path from 'path';
import { DatabaseService } from './database.service';

interface MigrationFile {
  filename: string;
  content: string;
  checksum: string;
}

@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);
  private readonly migrationsDir = path.resolve(
    __dirname,
    '..',
    '..',
    'sql',
    'migrations',
  );
  private readonly tableName = 'planning_schema_migration';

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    if (!this.database.enabled) {
      this.logger.log(
        'Database connection not configured, skipping migrations',
      );
      return;
    }
    await this.runMigrations();
  }

  async runMigrations(): Promise<void> {
    const migrations = await this.readMigrationFiles();
    if (!migrations.length) {
      this.logger.log(
        `No SQL migrations found in ${this.migrationsDir}, skipping`,
      );
      return;
    }

    await this.database.withClient(async (client) => {
      await this.ensureMigrationsTable(client);
      let applied = await this.fetchAppliedMigrations(client);
      const mismatched = this.detectSchemaMismatches(migrations, applied);
      if (mismatched.length) {
        this.logger.warn(
          `Detected schema mismatches for ${mismatched.join(', ')}. Dropping managed tables for a clean rebuild.`,
        );
        await this.resetPlanningSchema(client);
        await this.ensureMigrationsTable(client);
        applied = await this.fetchAppliedMigrations(client);
      }

      const pending = migrations.filter((migration) => {
        const checksum = applied.get(migration.filename);
        if (!checksum) {
          return true;
        }
        return checksum !== migration.checksum;
      });

      if (!pending.length) {
        this.logger.log('Database schema already up to date');
        return;
      }

      for (const migration of pending) {
        await this.applyMigration(client, migration);
      }
    });
  }

  private async ensureMigrationsTable(client: PoolClient) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  private async fetchAppliedMigrations(
    client: PoolClient,
  ): Promise<Map<string, string>> {
    const result = await client.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM ${this.tableName}`,
    );
    return result.rows.reduce((map, row) => {
      map.set(row.filename, row.checksum);
      return map;
    }, new Map<string, string>());
  }

  private async applyMigration(
    client: PoolClient,
    migration: MigrationFile,
  ): Promise<void> {
    this.logger.log(`Applying migration ${migration.filename}`);
    await client.query('BEGIN');
    try {
      await client.query(migration.content);
      await client.query(
        `INSERT INTO ${this.tableName} (filename, checksum)
         VALUES ($1, $2)
         ON CONFLICT (filename)
         DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
        [migration.filename, migration.checksum],
      );
      await client.query('COMMIT');
      this.logger.log(`Migration ${migration.filename} applied`);
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(
        `Failed to apply migration ${migration.filename}`,
        (error as Error).stack ?? error,
      );
      throw error;
    }
  }

  private async readMigrationFiles(): Promise<MigrationFile[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.migrationsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const sqlFiles = entries
      .filter((name) => name.toLowerCase().endsWith('.sql'))
      .sort();

    const migrations: MigrationFile[] = [];
    for (const filename of sqlFiles) {
      const fullPath = path.join(this.migrationsDir, filename);
      const content = await fs.readFile(fullPath, 'utf8');
      migrations.push({
        filename,
        content,
        checksum: this.computeChecksum(content),
      });
    }
    return migrations;
  }

  private computeChecksum(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private detectSchemaMismatches(
    migrations: MigrationFile[],
    applied: Map<string, string>,
  ): string[] {
    if (!applied.size) {
      return [];
    }
    const migrationMap = new Map(
      migrations.map((migration) => [migration.filename, migration]),
    );
    const mismatches: string[] = [];
    applied.forEach((checksum, filename) => {
      const migration = migrationMap.get(filename);
      if (!migration || migration.checksum !== checksum) {
        mismatches.push(filename);
      }
    });
    return mismatches;
  }

  private async resetPlanningSchema(client: PoolClient): Promise<void> {
    const tables = [
      // Templates / timeline
      'activities',
      'activity_template_set',
      // Plan week
      'train_segment',
      'train_run',
      // Train service parts (Zugleistungen)
      'train_service_part_link',
      'train_service_part_segment',
      'train_service_part',
      // Timetable revisions
      'timetable_revision',
      'service_assignment',
      'scheduled_service',
      'week_instance',
      'plan_week_validity',
      'plan_week_activity',
      'plan_week_slice',
      'plan_week_template',
      // Master data: vehicles/personnel + pools + members
      'vehicle_composition_entry',
      'vehicle_composition',
      'vehicle_type',
      'vehicle_pool_members',
      'vehicle_pool',
      'vehicle_service_pool_members',
      'vehicle_service_pool',
      'vehicle_services',
      'vehicles',
      'personnel_pool_members',
      'personnel_pools',
      'personnel_service_pool_members',
      'personnel_service_pools',
      'personnel_services',
      'personnel',
      'master_home_depot',
      // Topology
      'topology_op_replacement_link',
      'topology_op_replacement_stop_link',
      'topology_replacement_edge',
      'topology_replacement_route',
      'topology_replacement_stop',
      'topology_transfer_edge',
      'topology_personnel_site',
      'topology_section_of_line',
      'topology_operational_point',
      // Legacy planning tables
      'planning_activity',
      'planning_resource',
      'planning_stage',
      // Activity catalog tables
      'activity_translation',
      'activity_layer_group',
      'activity_definition',
      'activity_template',
      'activity_type_definition',
      'custom_attribute_definition',
      'activity_catalog_entry',
      // Variant/year metadata
      'planning_variant',
      'timetable_year',
      // Order management
      'business_automation_executions',
      'business_phase_conditions',
      'business_phase_templates',
      'business_templates',
      'business_order_items',
      'businesses',
      'order_items',
      'orders',
      'schedule_template_stops',
      'schedule_templates',
      'traffic_period_rules',
      'traffic_period_versions',
      'traffic_periods',
      'train_plan_versions',
      'train_plans',
      'customers',
      this.tableName,
    ];

    await client.query('BEGIN');
    try {
      for (const table of tables) {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error(
        'Failed to reset planning schema before applying migrations',
        (error as Error).stack ?? error,
      );
      throw error;
    }
  }
}
