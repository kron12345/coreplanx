import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import type {
  OrderDto,
  OrderItemsSearchRequest,
  OrderItemsSearchResponse,
  OrderUpsertPayload,
  OrdersSearchRequest,
  OrdersSearchResponse,
} from './orders.types';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('search')
  searchOrders(
    @Body() payload: OrdersSearchRequest,
  ): Promise<OrdersSearchResponse> {
    return this.ordersService.searchOrders(payload);
  }

  @Post(':orderId/items/search')
  searchOrderItems(
    @Param('orderId') orderId: string,
    @Body() payload: OrderItemsSearchRequest,
  ): Promise<OrderItemsSearchResponse> {
    return this.ordersService.searchOrderItems(orderId, payload);
  }

  @Get(':orderId')
  getOrder(
    @Param('orderId') orderId: string,
  ): Promise<OrderDto> {
    return this.ordersService.getOrderById(orderId);
  }

  @Post()
  createOrder(@Body() payload: OrderUpsertPayload): Promise<OrderDto> {
    return this.ordersService.createOrder(payload);
  }

  @Put(':orderId')
  upsertOrder(
    @Param('orderId') orderId: string,
    @Body() payload: OrderUpsertPayload,
  ): Promise<OrderDto> {
    return this.ordersService.upsertOrder(orderId, payload);
  }

  @Delete(':orderId')
  async deleteOrder(@Param('orderId') orderId: string) {
    await this.ordersService.deleteOrder(orderId);
    return { ok: true };
  }
}
