import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlanningModule } from './planning/planning.module';
import { DatabaseModule } from './database/database.module';
import { TimelineModule } from './timeline/timeline.module';
import { TemplateModule } from './template/template.module';

@Module({
  imports: [DatabaseModule, PlanningModule, TimelineModule, TemplateModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
