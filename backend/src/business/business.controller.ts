import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { BusinessService } from './business.service';
import type {
  BusinessDto,
  BusinessSearchRequest,
  BusinessSearchResponse,
  CreateBusinessPayload,
  UpdateBusinessPayload,
} from './business.types';

@Controller('businesses')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post('search')
  searchBusinesses(
    @Body() payload: BusinessSearchRequest,
  ): Promise<BusinessSearchResponse> {
    return this.businessService.searchBusinesses(payload);
  }

  @Post()
  createBusiness(
    @Body() payload: CreateBusinessPayload,
  ): Promise<BusinessDto> {
    return this.businessService.createBusiness(payload);
  }

  @Put(':businessId')
  updateBusiness(
    @Param('businessId') businessId: string,
    @Body() payload: UpdateBusinessPayload,
  ): Promise<BusinessDto> {
    return this.businessService.updateBusiness(businessId, payload);
  }

  @Get(':businessId')
  getBusiness(
    @Param('businessId') businessId: string,
  ): Promise<BusinessDto> {
    return this.businessService.getBusinessById(businessId);
  }

  @Delete(':businessId')
  deleteBusiness(
    @Param('businessId') businessId: string,
  ): Promise<void> {
    return this.businessService.deleteBusiness(businessId);
  }
}
