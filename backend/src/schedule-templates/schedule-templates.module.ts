import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderManagementRealtimeModule } from '../order-management-realtime/order-management-realtime.module';
import { ScheduleTemplatesController } from './schedule-templates.controller';
import { ScheduleTemplatesService } from './schedule-templates.service';
import { ScheduleTemplatesRepository } from './schedule-templates.repository';

@Module({
  imports: [PrismaModule, OrderManagementRealtimeModule],
  controllers: [ScheduleTemplatesController],
  providers: [ScheduleTemplatesService, ScheduleTemplatesRepository],
})
export class ScheduleTemplatesModule {}
