import { Module } from '@nestjs/common';
import { TrainPlansModule } from '../train-plans/train-plans.module';
import { TimetableOrderingController } from './timetable-ordering.controller';
import { TimetableOrderingRepository } from './timetable-ordering.repository';
import { TimetableOrderingService } from './timetable-ordering.service';

@Module({
  imports: [TrainPlansModule],
  controllers: [TimetableOrderingController],
  providers: [TimetableOrderingRepository, TimetableOrderingService],
  exports: [TimetableOrderingService],
})
export class TimetableOrderingModule {}
