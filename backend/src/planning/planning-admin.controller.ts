import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PlanningAdminService } from './planning-admin.service';

@Controller('planning/admin')
export class PlanningAdminController {
  constructor(private readonly adminService: PlanningAdminService) {}

  @Get('summary')
  getSummary(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : undefined;
    return this.adminService.getPlanningDataSummary(parsed);
  }

  @Post('clear')
  clearPlanningData(@Body() body?: { confirmation?: string; scope?: string }) {
    return this.adminService.clearPlanningData(body?.confirmation ?? '', body?.scope);
  }
}
