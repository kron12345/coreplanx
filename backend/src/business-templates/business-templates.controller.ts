import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { BusinessTemplatesService } from './business-templates.service';
import type {
  BusinessTemplateSearchRequest,
  CreateBusinessTemplatePayload,
  UpdateBusinessTemplatePayload,
} from './business-templates.types';

@Controller('business-templates')
export class BusinessTemplatesController {
  constructor(private readonly service: BusinessTemplatesService) {}

  @Post('search')
  search(@Body() payload: BusinessTemplateSearchRequest) {
    return this.service.searchTemplates(payload);
  }

  @Get(':templateId')
  getById(@Param('templateId') templateId: string) {
    return this.service.getTemplateById(templateId);
  }

  @Post()
  create(@Body() payload: CreateBusinessTemplatePayload) {
    return this.service.createTemplate(payload);
  }

  @Put(':templateId')
  update(
    @Param('templateId') templateId: string,
    @Body() payload: UpdateBusinessTemplatePayload,
  ) {
    return this.service.updateTemplate(templateId, payload);
  }

  @Delete(':templateId')
  async delete(@Param('templateId') templateId: string) {
    await this.service.deleteTemplate(templateId);
    return { ok: true };
  }
}
