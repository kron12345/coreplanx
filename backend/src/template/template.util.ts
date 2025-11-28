import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TemplateTableUtil {
  private readonly logger = new Logger(TemplateTableUtil.name);

  constructor(private readonly database: DatabaseService) {}

  async createTemplateTable(tableName: string): Promise<void> {
    const safeName = this.sanitize(tableName);
    await this.database.query(
      `
        CREATE TABLE IF NOT EXISTS ${safeName} (
          id UUID PRIMARY KEY,
          type TEXT NOT NULL,
          stage TEXT NOT NULL DEFAULT 'base',
          deleted BOOLEAN NOT NULL DEFAULT FALSE,
          deleted_at TIMESTAMPTZ,
          start_time TIMESTAMPTZ NOT NULL,
          end_time TIMESTAMPTZ,
          is_open_ended BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          attributes JSONB NOT NULL,
          audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb
        );

        CREATE INDEX IF NOT EXISTS idx_${safeName}_timerange
          ON ${safeName} (stage, start_time, end_time)
          WHERE deleted = FALSE;
      `,
    );
    this.logger.log(`Template timeline table ${safeName} created/ensured.`);
  }

  async dropTemplateTable(tableName: string): Promise<void> {
    const safeName = this.sanitize(tableName);
    await this.database.query(`DROP TABLE IF EXISTS ${safeName};`);
    this.logger.log(`Template timeline table ${safeName} dropped (if existed).`);
  }

  sanitize(raw: string): string {
    // allow only alphanumerics + underscore to avoid injection
    const safe = raw.replace(/[^a-zA-Z0-9_]/g, '_');
    if (!safe.length) {
      throw new Error('Invalid table name');
    }
    return safe;
  }
}
