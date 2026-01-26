import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { TrafficPeriodsService } from './traffic-periods.service';
import type { TrafficPeriodDto } from './traffic-periods.types';

@Controller('traffic-periods')
export class TrafficPeriodsController {
  constructor(private readonly service: TrafficPeriodsService) {}

  @Get()
  listPeriods(): Promise<TrafficPeriodDto[]> {
    return this.service.listPeriods();
  }

  @Post()
  createPeriod(@Body() payload: TrafficPeriodDto): Promise<TrafficPeriodDto> {
    return this.service.upsertPeriod(payload);
  }

  @Put(':periodId')
  updatePeriod(
    @Param('periodId') periodId: string,
    @Body() payload: TrafficPeriodDto,
  ): Promise<TrafficPeriodDto> {
    const next = { ...payload, id: periodId };
    return this.service.upsertPeriod(next);
  }

  @Delete(':periodId')
  async deletePeriod(@Param('periodId') periodId: string): Promise<{ ok: boolean }> {
    await this.service.deletePeriod(periodId);
    return { ok: true };
  }
}
