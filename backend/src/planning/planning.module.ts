import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';
import { PlanningCatalogController } from './planning-catalog.controller';
import { PlanningService } from './planning.service';
import { PlanningRepository } from './planning.repository';
import { PlanningBaseController } from './planning-base.controller';
import { PlanningOperationsController } from './planning-operations.controller';
import { PlanningTopologyController } from './planning-topology.controller';
import { PlanningResourcesController } from './planning-resources.controller';
import { PlanWeekService } from './plan-week.service';
import { PlanWeekRepository } from './plan-week.repository';

@Module({
  controllers: [
    PlanningController,
    PlanningCatalogController,
    PlanningBaseController,
    PlanningOperationsController,
    PlanningTopologyController,
    PlanningResourcesController,
  ],
  providers: [
    PlanningService,
    PlanningRepository,
    PlanWeekService,
    PlanWeekRepository,
  ],
  exports: [PlanningService, PlanWeekService],
})
export class PlanningModule {}
