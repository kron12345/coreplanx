import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderManagementRealtimeService } from '../order-management-realtime/order-management-realtime.service';
import { parseClientRequestId } from '../shared/client-context';
import type {
  OrderDto,
  OrderTraceabilityCaseDetailsDto,
  OrderTraceabilityDto,
  OrderOperationalContextDto,
  OrderItemsSearchRequest,
  OrderItemsSearchResponse,
  OrderPhaseSnapshotDto,
  OrderUpsertPayload,
  OrdersSearchRequest,
  OrdersSearchResponse,
} from './orders.types';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly realtime: OrderManagementRealtimeService,
  ) {}

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

  @Get(':orderId/phase-snapshot')
  getOrderPhaseSnapshot(
    @Param('orderId') orderId: string,
  ): Promise<OrderPhaseSnapshotDto> {
    return this.ordersService.getOrderPhaseSnapshot(orderId);
  }

  @Get(':orderId/operational-contexts')
  getOrderOperationalContexts(
    @Param('orderId') orderId: string,
  ): Promise<OrderOperationalContextDto[]> {
    return this.ordersService.getOrderOperationalContexts(orderId);
  }

  @Get(':orderId/traceability')
  getOrderTraceability(
    @Param('orderId') orderId: string,
  ): Promise<OrderTraceabilityDto> {
    return this.ordersService.getOrderTraceability(orderId);
  }

  @Get(':orderId/traceability/:caseId')
  getOrderTraceabilityCaseDetails(
    @Param('orderId') orderId: string,
    @Param('caseId') caseId: string,
  ): Promise<OrderTraceabilityCaseDetailsDto> {
    return this.ordersService.getOrderTraceabilityCaseDetails(orderId, caseId);
  }

  @Post()
  async createOrder(
    @Body() payload: OrderUpsertPayload,
    @Headers('x-client-request-id') clientRequestId?: string,
  ): Promise<OrderDto> {
    const order = await this.ordersService.createOrder(payload);
    this.realtime.emitEvent({
      scope: 'orders',
      entityType: 'order',
      entityId: order.id,
      action: 'upsert',
      payload: order,
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return order;
  }

  @Put(':orderId')
  async upsertOrder(
    @Param('orderId') orderId: string,
    @Body() payload: OrderUpsertPayload,
    @Headers('x-client-request-id') clientRequestId?: string,
  ): Promise<OrderDto> {
    const order = await this.ordersService.upsertOrder(orderId, payload);
    this.realtime.emitEvent({
      scope: 'orders',
      entityType: 'order',
      entityId: order.id,
      action: 'upsert',
      payload: order,
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return order;
  }

  @Delete(':orderId')
  async deleteOrder(
    @Param('orderId') orderId: string,
    @Headers('x-client-request-id') clientRequestId?: string,
  ) {
    await this.ordersService.deleteOrder(orderId);
    this.realtime.emitEvent({
      scope: 'orders',
      entityType: 'order',
      entityId: orderId,
      action: 'delete',
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return { ok: true };
  }
}
