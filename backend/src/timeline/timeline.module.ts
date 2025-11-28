import { Module } from '@nestjs/common';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';
import { TimelineRepository } from './timeline.repository';
import { TimelineGateway } from './timeline.gateway';
import { ValidationService } from './validation.service';

@Module({
  controllers: [TimelineController],
  providers: [TimelineService, TimelineRepository, TimelineGateway, ValidationService],
  exports: [TimelineService, TimelineGateway],
})
export class TimelineModule {}
