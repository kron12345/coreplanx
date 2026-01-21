import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrderManagementAdminController } from './order-management-admin.controller';
import { OrderManagementAdminService } from './order-management-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderManagementAdminController],
  providers: [OrderManagementAdminService],
})
export class OrderManagementAdminModule {}
