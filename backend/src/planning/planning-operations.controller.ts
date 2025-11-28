import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { PlanWeekService } from './plan-week.service';
import type { WeekInstance } from './planning.types';

@Controller('planning/operations/weeks')
export class PlanningOperationsController {
  constructor(private readonly planWeekService: PlanWeekService) {}

  @Get()
  listWeekInstances(@Query('from') from: string, @Query('to') to: string) {
    return this.planWeekService.listWeekInstances(from, to);
  }

  @Get(':weekInstanceId')
  getWeekInstance(@Param('weekInstanceId') weekInstanceId: string) {
    return this.planWeekService.getWeekInstance(weekInstanceId);
  }

  @Put(':weekInstanceId')
  upsertWeekInstance(
    @Param('weekInstanceId') weekInstanceId: string,
    @Body() payload: WeekInstance,
  ) {
    return this.planWeekService.saveWeekInstance(weekInstanceId, payload);
  }

  @Delete(':weekInstanceId')
  @HttpCode(204)
  deleteWeekInstance(@Param('weekInstanceId') weekInstanceId: string) {
    return this.planWeekService.deleteWeekInstance(weekInstanceId);
  }
}
