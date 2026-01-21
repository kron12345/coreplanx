import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type {
  CreateCustomerPayload,
  CustomerDto,
  CustomerSearchRequest,
  CustomerSearchResponse,
} from './customers.types';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post('search')
  searchCustomers(
    @Body() payload: CustomerSearchRequest,
  ): Promise<CustomerSearchResponse> {
    return this.customersService.searchCustomers(payload);
  }

  @Post()
  createCustomer(
    @Body() payload: CreateCustomerPayload,
  ): Promise<CustomerDto> {
    return this.customersService.createCustomer(payload);
  }

  @Get(':customerId')
  getCustomer(
    @Param('customerId') customerId: string,
  ): Promise<CustomerDto> {
    return this.customersService.getCustomerById(customerId);
  }

  @Delete(':customerId')
  deleteCustomer(
    @Param('customerId') customerId: string,
  ): Promise<void> {
    return this.customersService.deleteCustomer(customerId);
  }
}
