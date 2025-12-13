import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';
import { PlanningCatalogController } from './planning-catalog.controller';
import { PlanningService } from './planning.service';
import { PlanningRepository } from './planning.repository';
import { PlanningStageRepository } from './planning-stage.repository';
import { PlanningMasterDataRepository } from './planning-master-data.repository';
import { PlanningMasterDataReadRepository } from './planning-master-data.read.repository';
import { PlanningMasterDataWriteRepository } from './planning-master-data.write.repository';
import { PlanningActivityCatalogRepository } from './planning-activity-catalog.repository';
import { PlanningBaseController } from './planning-base.controller';
import { PlanningOperationsController } from './planning-operations.controller';
import { PlanningTopologyController } from './planning-topology.controller';
import { PlanningResourcesController } from './planning-resources.controller';
import { PlanningMasterDataController } from './planning-master-data.controller';
import { PlanWeekService } from './plan-week.service';
import { PlanWeekRepository } from './plan-week.repository';
import { PlanningStageService } from './planning-stage.service';
import { PlanningMasterDataService } from './planning-master-data.service';
import { PlanningActivityCatalogService } from './planning-activity-catalog.service';
import { PlanningTopologyImportService } from './planning-topology-import.service';

@Module({
  controllers: [
    PlanningController,
    PlanningCatalogController,
    PlanningMasterDataController,
    PlanningBaseController,
    PlanningOperationsController,
    PlanningTopologyController,
    PlanningResourcesController,
  ],
  providers: [
    PlanningService,
    PlanningStageService,
    PlanningMasterDataService,
    PlanningActivityCatalogService,
    PlanningTopologyImportService,
    PlanningStageRepository,
    PlanningMasterDataReadRepository,
    PlanningMasterDataWriteRepository,
    PlanningMasterDataRepository,
    PlanningActivityCatalogRepository,
    PlanningRepository,
    PlanWeekService,
    PlanWeekRepository,
  ],
  exports: [PlanningService, PlanWeekService],
})
export class PlanningModule {}
