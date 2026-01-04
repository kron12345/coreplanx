import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlanningModule } from './planning/planning.module';
import { DatabaseModule } from './database/database.module';
import { TimelineModule } from './timeline/timeline.module';
import { TemplateModule } from './template/template.module';
import { VariantsModule } from './variants/variants.module';
import { TimetableModule } from './timetable/timetable.module';
import { AssistantModule } from './assistant/assistant.module';
import { DebugModule } from './debug/debug.module';

@Module({
  imports: [
    DatabaseModule,
    PlanningModule,
    TimelineModule,
    TemplateModule,
    VariantsModule,
    TimetableModule,
    AssistantModule,
    DebugModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
