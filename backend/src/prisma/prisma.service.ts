import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = PrismaService.resolveDatabaseUrl();
    if (!url) {
      throw new Error(
        'Prisma database connection is not configured. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER.',
      );
    }

    super({
      datasources: { db: { url } },
      log:
        process.env.PRISMA_LOG_QUERIES === 'true'
          ? ['query', 'info', 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private static resolveDatabaseUrl(): string | null {
    if (process.env.DATABASE_URL) {
      return process.env.DATABASE_URL;
    }

    const host = process.env.DB_HOST;
    const database = process.env.DB_NAME;
    const user = process.env.DB_USER;
    if (!host || !database || !user) {
      return null;
    }

    const port = process.env.DB_PORT ?? '5432';
    const password = process.env.DB_PASSWORD ?? '';
    const encodedUser = encodeURIComponent(user);
    const encodedPassword = password
      ? `:${encodeURIComponent(password)}`
      : '';
    const url = `postgresql://${encodedUser}${encodedPassword}@${host}:${port}/${database}`;
    process.env.DATABASE_URL = url;
    PrismaService.logger.warn(
      'DATABASE_URL was not set. Prisma will use the derived connection string.',
    );
    return url;
  }
}
