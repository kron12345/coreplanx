import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScheduleTemplatesController } from './schedule-templates.controller';
import { ScheduleTemplatesService } from './schedule-templates.service';
import { ScheduleTemplatesRepository } from './schedule-templates.repository';

@Module({
  imports: [PrismaModule],
  controllers: [ScheduleTemplatesController],
  providers: [ScheduleTemplatesService, ScheduleTemplatesRepository],
})
export class ScheduleTemplatesModule {}
