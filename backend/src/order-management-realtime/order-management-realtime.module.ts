import { Module } from '@nestjs/common';
import { OrderManagementRealtimeService } from './order-management-realtime.service';
import { OrderManagementRealtimeGateway } from './order-management-realtime.gateway';

@Module({
  providers: [OrderManagementRealtimeService, OrderManagementRealtimeGateway],
  exports: [OrderManagementRealtimeService],
})
export class OrderManagementRealtimeModule {}
