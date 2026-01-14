import { forwardRef, Module } from '@nestjs/common';
import { DebugModule } from '../debug/debug.module';
import { PlanningModule } from '../planning/planning.module';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { TemplateRepository } from './template.repository';
import { TemplateTableUtil } from './template.util';
import { TemplateGateway } from './template.gateway';

@Module({
  imports: [forwardRef(() => PlanningModule), DebugModule],
  controllers: [TemplateController],
  providers: [
    TemplateService,
    TemplateRepository,
    TemplateTableUtil,
    TemplateGateway,
  ],
  exports: [TemplateService, TemplateGateway],
})
export class TemplateModule {}
