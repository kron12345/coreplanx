import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderManagementRealtimeModule } from '../order-management-realtime/order-management-realtime.module';
import { BusinessController } from './business.controller';
import { BusinessRepository } from './business.repository';
import { BusinessService } from './business.service';

@Module({
  imports: [PrismaModule, OrderManagementRealtimeModule],
  controllers: [BusinessController],
  providers: [BusinessRepository, BusinessService],
  exports: [BusinessService],
})
export class BusinessModule {}
