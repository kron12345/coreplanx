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
import { BusinessTemplatesService } from './business-templates.service';
import { OrderManagementRealtimeService } from '../order-management-realtime/order-management-realtime.service';
import { parseClientRequestId } from '../shared/client-context';
import type {
  BusinessTemplateSearchRequest,
  CreateBusinessTemplatePayload,
  UpdateBusinessTemplatePayload,
} from './business-templates.types';

@Controller('business-templates')
export class BusinessTemplatesController {
  constructor(
    private readonly service: BusinessTemplatesService,
    private readonly realtime: OrderManagementRealtimeService,
  ) {}

  @Post('search')
  search(@Body() payload: BusinessTemplateSearchRequest) {
    return this.service.searchTemplates(payload);
  }

  @Get(':templateId')
  getById(@Param('templateId') templateId: string) {
    return this.service.getTemplateById(templateId);
  }

  @Post()
  async create(
    @Body() payload: CreateBusinessTemplatePayload,
    @Headers('x-client-request-id') clientRequestId?: string,
  ) {
    const template = await this.service.createTemplate(payload);
    this.realtime.emitEvent({
      scope: 'templates',
      entityType: 'businessTemplate',
      entityId: template.id,
      action: 'upsert',
      payload: template,
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return template;
  }

  @Put(':templateId')
  async update(
    @Param('templateId') templateId: string,
    @Body() payload: UpdateBusinessTemplatePayload,
    @Headers('x-client-request-id') clientRequestId?: string,
  ) {
    const template = await this.service.updateTemplate(templateId, payload);
    this.realtime.emitEvent({
      scope: 'templates',
      entityType: 'businessTemplate',
      entityId: template.id,
      action: 'upsert',
      payload: template,
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return template;
  }

  @Delete(':templateId')
  async delete(
    @Param('templateId') templateId: string,
    @Headers('x-client-request-id') clientRequestId?: string,
  ) {
    await this.service.deleteTemplate(templateId);
    this.realtime.emitEvent({
      scope: 'templates',
      entityType: 'businessTemplate',
      entityId: templateId,
      action: 'delete',
      sourceConnectionId: parseClientRequestId(clientRequestId).connectionId,
    });
    return { ok: true };
  }
}
