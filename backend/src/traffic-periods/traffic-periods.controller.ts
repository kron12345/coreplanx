import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { TrafficPeriodsService } from './traffic-periods.service';
import type {
  RailMlTrafficPeriodPayload,
  SingleDayTrafficPeriodPayload,
  TrafficPeriodCreatePayload,
  TrafficPeriodDto,
  TrafficPeriodExclusionPayload,
  TrafficPeriodVariantPayload,
} from './traffic-periods.types';

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

  @Post('compose')
  createFromPayload(
    @Body() payload: TrafficPeriodCreatePayload,
  ): Promise<TrafficPeriodDto> {
    return this.service.createFromPayload(payload);
  }

  @Post('single-day')
  createSingleDay(
    @Body() payload: SingleDayTrafficPeriodPayload,
  ): Promise<TrafficPeriodDto> {
    return this.service.createSingleDayPeriod(payload);
  }

  @Post('railml')
  ensureRailMl(
    @Body() payload: RailMlTrafficPeriodPayload,
  ): Promise<TrafficPeriodDto> {
    return this.service.ensureRailMlPeriod(payload);
  }

  @Put(':periodId')
  updatePeriod(
    @Param('periodId') periodId: string,
    @Body() payload: TrafficPeriodDto,
  ): Promise<TrafficPeriodDto> {
    const next = { ...payload, id: periodId };
    return this.service.upsertPeriod(next);
  }

  @Put(':periodId/compose')
  updateFromPayload(
    @Param('periodId') periodId: string,
    @Body() payload: TrafficPeriodCreatePayload,
  ): Promise<TrafficPeriodDto> {
    return this.service.updateFromPayload(periodId, payload);
  }

  @Post(':periodId/variant')
  addVariantRule(
    @Param('periodId') periodId: string,
    @Body() payload: TrafficPeriodVariantPayload,
  ): Promise<TrafficPeriodDto> {
    return this.service.addVariantRule(periodId, payload);
  }

  @Post(':periodId/exclusions')
  addExclusions(
    @Param('periodId') periodId: string,
    @Body() payload: TrafficPeriodExclusionPayload,
  ): Promise<TrafficPeriodDto> {
    return this.service.addExclusionDates(periodId, payload);
  }

  @Delete(':periodId')
  async deletePeriod(@Param('periodId') periodId: string): Promise<{ ok: boolean }> {
    await this.service.deletePeriod(periodId);
    return { ok: true };
  }
}
