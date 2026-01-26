import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderManagementRealtimeModule } from '../order-management-realtime/order-management-realtime.module';
import { BusinessTemplatesController } from './business-templates.controller';
import { BusinessTemplatesService } from './business-templates.service';
import { BusinessTemplatesRepository } from './business-templates.repository';

@Module({
  imports: [PrismaModule, OrderManagementRealtimeModule],
  controllers: [BusinessTemplatesController],
  providers: [BusinessTemplatesService, BusinessTemplatesRepository],
})
export class BusinessTemplatesModule {}
