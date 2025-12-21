import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { MigrationService } from './migration.service';
import { VariantPartitionService } from './variant-partition.service';

@Global()
@Module({
  providers: [DatabaseService, MigrationService, VariantPartitionService],
  exports: [DatabaseService, VariantPartitionService],
})
export class DatabaseModule {}
