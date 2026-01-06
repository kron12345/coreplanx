import { forwardRef, Module } from '@nestjs/common';
import { TemplateModule } from '../template/template.module';
import { DebugModule } from '../debug/debug.module';
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
import { PlanningRulesController } from './planning-rules.controller';
import { PlanningRulesetController } from './planning-ruleset.controller';
import { PlanningOptimizationController } from './planning-optimization.controller';
import { PlanWeekService } from './plan-week.service';
import { PlanWeekRepository } from './plan-week.repository';
import { PlanningStageService } from './planning-stage.service';
import { PlanningMasterDataService } from './planning-master-data.service';
import { PlanningActivityCatalogService } from './planning-activity-catalog.service';
import { PlanningRulesetService } from './planning-ruleset.service';
import { PlanningTopologyImportService } from './planning-topology-import.service';
import { PlanningSnapshotService } from './planning-snapshot.service';
import { PlanningRuleRepository } from './planning-rule.repository';
import { PlanningRuleService } from './planning-rule.service';
import { DutyAutopilotService } from './duty-autopilot.service';
import { PlanningCandidateBuilder } from './planning-candidate-builder.service';
import { PlanningOptimizationService } from './planning-optimization.service';
import { PlanningSolverService } from './planning-solver.service';

@Module({
  imports: [forwardRef(() => TemplateModule), DebugModule],
  controllers: [
    PlanningController,
    PlanningCatalogController,
    PlanningMasterDataController,
    PlanningBaseController,
    PlanningOperationsController,
    PlanningTopologyController,
    PlanningResourcesController,
    PlanningRulesController,
    PlanningRulesetController,
    PlanningOptimizationController,
  ],
  providers: [
    PlanningService,
    PlanningStageService,
    PlanningMasterDataService,
    PlanningActivityCatalogService,
    PlanningRulesetService,
    PlanningSnapshotService,
    PlanningTopologyImportService,
    PlanningOptimizationService,
    PlanningSolverService,
    PlanningStageRepository,
    PlanningMasterDataReadRepository,
    PlanningMasterDataWriteRepository,
    PlanningMasterDataRepository,
    PlanningActivityCatalogRepository,
    PlanningRepository,
    PlanningRuleRepository,
    PlanningRuleService,
    DutyAutopilotService,
    PlanningCandidateBuilder,
    PlanWeekService,
    PlanWeekRepository,
  ],
  exports: [PlanningService, PlanWeekService, DutyAutopilotService],
})
export class PlanningModule {}
