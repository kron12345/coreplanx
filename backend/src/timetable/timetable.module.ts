import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller';
import { TimetableRepository } from './timetable.repository';
import { TimetableService } from './timetable.service';

@Module({
  controllers: [TimetableController],
  providers: [TimetableRepository, TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
