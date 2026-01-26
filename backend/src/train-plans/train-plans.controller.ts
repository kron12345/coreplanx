import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { TrainPlansService } from './train-plans.service';
import type {
  CreateManualPlanPayload,
  CreatePlanModificationPayload,
  CreatePlanVariantPayload,
  CreatePlansFromTemplatePayload,
  TrainPlanDto,
} from './train-plans.types';

@Controller('train-plans')
export class TrainPlansController {
  constructor(private readonly service: TrainPlansService) {}

  @Get()
  listPlans(): Promise<TrainPlanDto[]> {
    return this.service.listPlans();
  }

  @Post()
  createPlan(@Body() payload: TrainPlanDto): Promise<TrainPlanDto> {
    return this.service.upsertPlan(payload);
  }

  @Post('from-template')
  createFromTemplate(
    @Body() payload: CreatePlansFromTemplatePayload,
  ): Promise<TrainPlanDto[]> {
    return this.service.createPlansFromTemplate(payload);
  }

  @Post('manual')
  createManual(@Body() payload: CreateManualPlanPayload): Promise<TrainPlanDto> {
    return this.service.createManualPlan(payload);
  }

  @Post('modification')
  createModification(
    @Body() payload: CreatePlanModificationPayload,
  ): Promise<TrainPlanDto> {
    return this.service.createPlanModification(payload);
  }

  @Post('variant')
  createVariant(
    @Body() payload: CreatePlanVariantPayload,
  ): Promise<TrainPlanDto> {
    return this.service.createPlanVariant(payload);
  }

  @Put(':planId')
  updatePlan(
    @Param('planId') planId: string,
    @Body() payload: TrainPlanDto,
  ): Promise<TrainPlanDto> {
    const next = { ...payload, id: planId };
    return this.service.upsertPlan(next);
  }

  @Delete(':planId')
  async deletePlan(@Param('planId') planId: string): Promise<{ ok: boolean }> {
    await this.service.deletePlan(planId);
    return { ok: true };
  }
}
