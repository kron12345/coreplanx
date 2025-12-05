import { Module } from '@nestjs/common';
import { ActivityCatalogController } from './activity-catalog.controller';
import { ActivityCatalogService } from './activity-catalog.service';
import { ActivityCatalogRepository } from './activity-catalog.repository';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ActivityCatalogController],
  providers: [ActivityCatalogService, ActivityCatalogRepository],
  exports: [ActivityCatalogService],
})
export class ActivityCatalogModule {}
