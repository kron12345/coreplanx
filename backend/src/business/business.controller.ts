import { Body, Controller, Delete, Get, Headers, Param, Post, Put } from '@nestjs/common';
import { BusinessService } from './business.service';
import { OrderManagementRealtimeService } from '../order-management-realtime/order-management-realtime.service';
import { parseClientRequestId } from '../shared/client-context';
import type {
  BusinessDto,
  BusinessSearchRequest,
  BusinessSearchResponse,
  CreateBusinessPayload,
  UpdateBusinessPayload,
} from './business.types';

@Controller('businesses')
export class BusinessController {
  constructor(
    private readonly businessService: BusinessService,
    private readonly realtime: OrderManagementRealtimeService,
  ) {}

  @Post('search')
  searchBusinesses(
    @Body() payload: BusinessSearchRequest,
  ): Promise<BusinessSearchResponse> {
    return this.businessService.searchBusinesses(payload);
  }

  @Post()
  async createBusiness(
    @Body() payload: CreateBusinessPayload,
    @Headers('x-client-request-id') clientRequestId?: string,
  ): Promise<BusinessDto> {
    const business = await this.businessService.createBusiness(payload);
    this.realtime.emitEvent({
      scope: 'business',
      entityType: 'business',
      entityId: business.id,
      action: 'upsert',
      payload: business,
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return business;
  }

  @Put(':businessId')
  async updateBusiness(
    @Param('businessId') businessId: string,
    @Body() payload: UpdateBusinessPayload,
    @Headers('x-client-request-id') clientRequestId?: string,
  ): Promise<BusinessDto> {
    const business = await this.businessService.updateBusiness(businessId, payload);
    this.realtime.emitEvent({
      scope: 'business',
      entityType: 'business',
      entityId: business.id,
      action: 'upsert',
      payload: business,
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return business;
  }

  @Get(':businessId')
  getBusiness(
    @Param('businessId') businessId: string,
  ): Promise<BusinessDto> {
    return this.businessService.getBusinessById(businessId);
  }

  @Delete(':businessId')
  async deleteBusiness(
    @Param('businessId') businessId: string,
    @Headers('x-client-request-id') clientRequestId?: string,
  ): Promise<void> {
    await this.businessService.deleteBusiness(businessId);
    this.realtime.emitEvent({
      scope: 'business',
      entityType: 'business',
      entityId: businessId,
      action: 'delete',
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
  }
}
