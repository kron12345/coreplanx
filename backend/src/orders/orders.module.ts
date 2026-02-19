import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderManagementRealtimeModule } from '../order-management-realtime/order-management-realtime.module';
import { DebugModule } from '../debug/debug.module';
import { TimetableModule } from '../timetable/timetable.module';
import { TimetableOrderingModule } from '../timetable-ordering/timetable-ordering.module';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    PrismaModule,
    OrderManagementRealtimeModule,
    DebugModule,
    TimetableModule,
    TimetableOrderingModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
