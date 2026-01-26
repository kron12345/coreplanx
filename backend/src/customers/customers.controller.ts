import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { OrderManagementRealtimeService } from '../order-management-realtime/order-management-realtime.service';
import { parseClientRequestId } from '../shared/client-context';
import type {
  CreateCustomerPayload,
  CustomerDto,
  CustomerSearchRequest,
  CustomerSearchResponse,
} from './customers.types';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly realtime: OrderManagementRealtimeService,
  ) {}

  @Post('search')
  searchCustomers(
    @Body() payload: CustomerSearchRequest,
  ): Promise<CustomerSearchResponse> {
    return this.customersService.searchCustomers(payload);
  }

  @Post()
  async createCustomer(
    @Body() payload: CreateCustomerPayload,
    @Headers('x-client-request-id') clientRequestId?: string,
  ): Promise<CustomerDto> {
    const customer = await this.customersService.createCustomer(payload);
    this.realtime.emitEvent({
      scope: 'customers',
      entityType: 'customer',
      entityId: customer.id,
      action: 'upsert',
      payload: customer,
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return customer;
  }

  @Get(':customerId')
  getCustomer(
    @Param('customerId') customerId: string,
  ): Promise<CustomerDto> {
    return this.customersService.getCustomerById(customerId);
  }

  @Delete(':customerId')
  async deleteCustomer(
    @Param('customerId') customerId: string,
    @Headers('x-client-request-id') clientRequestId?: string,
  ): Promise<void> {
    await this.customersService.deleteCustomer(customerId);
    this.realtime.emitEvent({
      scope: 'customers',
      entityType: 'customer',
      entityId: customerId,
      action: 'delete',
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
  }
}
