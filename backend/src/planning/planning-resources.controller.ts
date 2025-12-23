import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { PlanningService } from './planning.service';
import type { ResourceSnapshot } from './planning.types';

@Controller('planning/resources')
export class PlanningResourcesController {
  constructor(private readonly planningService: PlanningService) {}

  @Get()
  getResources(): ResourceSnapshot {
    return this.planningService.getResourceSnapshot();
  }

  @Put()
  replaceResources(
    @Body() payload: ResourceSnapshot,
  ): Promise<ResourceSnapshot> {
    return this.planningService.replaceResourceSnapshot(payload);
  }

  @Post('reset')
  resetToDefaults(): Promise<ResourceSnapshot> {
    return this.planningService.resetResourcesToDefaults();
  }

  @Post('reset/personnel')
  resetPersonnelToDefaults(): Promise<ResourceSnapshot> {
    return this.planningService.resetPersonnelToDefaults();
  }

  @Post('reset/vehicles')
  resetVehiclesToDefaults(): Promise<ResourceSnapshot> {
    return this.planningService.resetVehiclesToDefaults();
  }
}
