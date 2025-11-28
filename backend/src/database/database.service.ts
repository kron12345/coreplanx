import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, PoolConfig, QueryConfig, QueryResult } from 'pg';

type QueryText = string | QueryConfig<any>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool?: Pool;

  constructor() {
    const config = this.resolvePoolConfig();
    if (!config) {
      this.logger.warn(
        'Database connection is not configured. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER to enable it.',
      );
      return;
    }

    this.pool = new Pool(config);
    this.pool.on('error', (error) => {
      this.logger.error('Unexpected PostgreSQL error', error.stack ?? error);
    });
  }

  get enabled(): boolean {
    return !!this.pool;
  }

  async query<T = unknown, I extends any[] = any[]>(
    text: QueryText,
    values?: I,
  ): Promise<QueryResult<T>> {
    const pool = this.assertPool();
    return pool.query<T>(text, values);
  }

  async withClient<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = this.assertPool();
    const client = await pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  private assertPool(): Pool {
    if (!this.pool) {
      throw new Error(
        'Database connection is not available. Did you set DATABASE_URL or DB_HOST/DB_NAME/DB_USER?',
      );
    }
    return this.pool;
  }

  private resolvePoolConfig(): PoolConfig | null {
    const ssl = this.resolveSslConfig();
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      return { connectionString, ssl };
    }

    const host = process.env.DB_HOST;
    const database = process.env.DB_NAME;
    const user = process.env.DB_USER;
    if (!host || !database || !user) {
      return null;
    }

    const port = Number.parseInt(process.env.DB_PORT ?? '5432', 10);
    const password = process.env.DB_PASSWORD;
    return {
      host,
      port,
      database,
      user,
      password,
      ssl,
    };
  }

  private resolveSslConfig(): PoolConfig['ssl'] {
    const flag = (process.env.DATABASE_SSL ?? '').toLowerCase();
    if (!flag || flag === 'false' || flag === '0' || flag === 'no') {
      return undefined;
    }
    const rejectUnauthorized =
      (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !==
      'false';
    return { rejectUnauthorized };
  }
}
