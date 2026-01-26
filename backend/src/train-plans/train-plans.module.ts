import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleTemplatesModule } from '../schedule-templates/schedule-templates.module';
import { TrafficPeriodsModule } from '../traffic-periods/traffic-periods.module';
import { TrainPlansController } from './train-plans.controller';
import { TrainPlansService } from './train-plans.service';

@Module({
  imports: [PrismaModule, ScheduleTemplatesModule, TrafficPeriodsModule],
  controllers: [TrainPlansController],
  providers: [TrainPlansService],
  exports: [TrainPlansService],
})
export class TrainPlansModule {}
