import { Body, Controller, Get, Post } from '@nestjs/common';
import { OrderManagementAdminService } from './order-management-admin.service';
import type {
  OrderManagementAdminClearResponse,
  OrderManagementAdminSeedResponse,
  OrderManagementAdminSummary,
  OrderManagementSeedMode,
} from './order-management-admin.types';

@Controller('order-management/admin')
export class OrderManagementAdminController {
  constructor(private readonly adminService: OrderManagementAdminService) {}

  @Get('summary')
  getSummary(): Promise<OrderManagementAdminSummary> {
    return this.adminService.getSummary();
  }

  @Post('clear')
  clearData(
    @Body() body?: { confirmation?: string },
  ): Promise<OrderManagementAdminClearResponse> {
    return this.adminService.clearData(body?.confirmation ?? '');
  }

  @Post('seed')
  seedData(
    @Body()
    body?: { confirmation?: string; mode?: OrderManagementSeedMode },
  ): Promise<OrderManagementAdminSeedResponse> {
    return this.adminService.seedData(
      body?.confirmation ?? '',
      body?.mode ?? 'replace',
    );
  }
}
