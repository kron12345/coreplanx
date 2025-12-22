import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from './database.service';

const PLANNING_PARTITIONED_TABLES = [
  'planning_stage',
  'planning_resource',
  'planning_activity',
  'planning_rule',
  'train_run',
  'train_segment',
  'train_service_part',
  'train_service_part_segment',
  'train_service_part_link',
] as const;

@Injectable()
export class VariantPartitionService {
  private readonly logger = new Logger(VariantPartitionService.name);

  constructor(private readonly database: DatabaseService) {}

  async ensurePlanningPartitions(variantId: string): Promise<void> {
    if (!this.database.enabled) {
      return;
    }
    const normalizedVariantId = variantId.trim();
    if (!normalizedVariantId) {
      return;
    }

    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const parent of PLANNING_PARTITIONED_TABLES) {
          const partition = this.partitionName(parent, normalizedVariantId);
          const variantLiteral = this.quoteLiteral(normalizedVariantId);
          await client.query(
            `CREATE TABLE IF NOT EXISTS ${partition} PARTITION OF ${parent} FOR VALUES IN (${variantLiteral});`,
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Failed to create partitions for variant ${normalizedVariantId}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  async dropPlanningPartitions(variantId: string): Promise<void> {
    if (!this.database.enabled) {
      return;
    }
    const normalizedVariantId = variantId.trim();
    if (!normalizedVariantId) {
      return;
    }

    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const parent of PLANNING_PARTITIONED_TABLES) {
          const partition = this.partitionName(parent, normalizedVariantId);
          await client.query(`DROP TABLE IF EXISTS ${partition} CASCADE;`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          `Failed to drop partitions for variant ${normalizedVariantId}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  private partitionName(parentTable: string, variantId: string): string {
    const normalized = this.normalizeForIdentifier(variantId);
    const candidate = `${parentTable}_${normalized}`;
    if (candidate.length <= 63) {
      return candidate;
    }
    const hash = createHash('sha1').update(variantId).digest('hex').slice(0, 10);
    const remaining = 63 - parentTable.length - 1 - hash.length - 1;
    const prefix = normalized.slice(0, Math.max(0, remaining));
    return `${parentTable}_${prefix}_${hash}`.replace(/_+$/, '');
  }

  private normalizeForIdentifier(value: string): string {
    const cleaned = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!cleaned) {
      return 'v';
    }
    return /^[a-z_]/.test(cleaned) ? cleaned : `v_${cleaned}`;
  }

  private quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }
}
