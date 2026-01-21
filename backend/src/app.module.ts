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
import { PrismaModule } from './prisma/prisma.module';
import { OrdersModule } from './orders/orders.module';
import { BusinessModule } from './business/business.module';
import { CustomersModule } from './customers/customers.module';
import { ScheduleTemplatesModule } from './schedule-templates/schedule-templates.module';
import { BusinessTemplatesModule } from './business-templates/business-templates.module';
import { OrderManagementAdminModule } from './order-management-admin/order-management-admin.module';

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
    PrismaModule,
    OrdersModule,
    BusinessModule,
    CustomersModule,
    ScheduleTemplatesModule,
    BusinessTemplatesModule,
    OrderManagementAdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
