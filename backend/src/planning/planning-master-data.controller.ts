import { Body, Controller, Get, Put } from '@nestjs/common';
import type {
  PersonnelPoolListRequest,
  PersonnelServicePoolListRequest,
  VehicleCompositionListRequest,
  VehiclePoolListRequest,
  VehicleServicePoolListRequest,
  VehicleTypeListRequest,
} from './planning.types';
import { PlanningService } from './planning.service';

@Controller('planning/master-data')
export class PlanningMasterDataController {
  constructor(private readonly planningService: PlanningService) {}

  @Get('personnel-service-pools')
  listPersonnelServicePools() {
    return this.planningService.listPersonnelServicePools();
  }

  @Put('personnel-service-pools')
  savePersonnelServicePools(@Body() request: PersonnelServicePoolListRequest) {
    return this.planningService.savePersonnelServicePools(request);
  }

  @Get('personnel-pools')
  listPersonnelPools() {
    return this.planningService.listPersonnelPools();
  }

  @Put('personnel-pools')
  savePersonnelPools(@Body() request: PersonnelPoolListRequest) {
    return this.planningService.savePersonnelPools(request);
  }

  @Get('vehicle-service-pools')
  listVehicleServicePools() {
    return this.planningService.listVehicleServicePools();
  }

  @Put('vehicle-service-pools')
  saveVehicleServicePools(@Body() request: VehicleServicePoolListRequest) {
    return this.planningService.saveVehicleServicePools(request);
  }

  @Get('vehicle-pools')
  listVehiclePools() {
    return this.planningService.listVehiclePools();
  }

  @Put('vehicle-pools')
  saveVehiclePools(@Body() request: VehiclePoolListRequest) {
    return this.planningService.saveVehiclePools(request);
  }

  @Get('vehicle-types')
  listVehicleTypes() {
    return this.planningService.listVehicleTypes();
  }

  @Put('vehicle-types')
  saveVehicleTypes(@Body() request: VehicleTypeListRequest) {
    return this.planningService.saveVehicleTypes(request);
  }

  @Get('vehicle-compositions')
  listVehicleCompositions() {
    return this.planningService.listVehicleCompositions();
  }

  @Put('vehicle-compositions')
  saveVehicleCompositions(@Body() request: VehicleCompositionListRequest) {
    return this.planningService.saveVehicleCompositions(request);
  }
}
