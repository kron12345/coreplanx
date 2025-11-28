import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { TemplateRepository } from './template.repository';
import { TemplateTableUtil } from './template.util';
import { TemplateGateway } from './template.gateway';

@Module({
  controllers: [TemplateController],
  providers: [TemplateService, TemplateRepository, TemplateTableUtil, TemplateGateway],
  exports: [TemplateService, TemplateGateway],
})
export class TemplateModule {}
