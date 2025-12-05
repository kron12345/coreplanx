import 'dotenv/config';
import { MigrationService } from '../database/migration.service';
import { DatabaseService } from '../database/database.service';

async function main() {
  const database = new DatabaseService();
  if (!database.enabled) {
    throw new Error(
      'Database connection is not configured. Set DATABASE_URL oder DB_HOST/DB_NAME/DB_USER.',
    );
  }
  const migrations = new MigrationService(database);
  await migrations.runMigrations();
  await database.onModuleDestroy();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
