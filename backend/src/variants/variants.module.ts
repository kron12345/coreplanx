import { Module } from '@nestjs/common';
import { TemplateModule } from '../template/template.module';
import { TimetableYearController } from './timetable-year.controller';
import { TimetableYearService } from './timetable-year.service';
import { VariantsRepository } from './variants.repository';

@Module({
  imports: [TemplateModule],
  controllers: [TimetableYearController],
  providers: [TimetableYearService, VariantsRepository],
  exports: [TimetableYearService],
})
export class VariantsModule {}
