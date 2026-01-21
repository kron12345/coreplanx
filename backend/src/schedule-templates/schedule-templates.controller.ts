import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ScheduleTemplatesService } from './schedule-templates.service';
import type {
  CreateScheduleTemplatePayload,
  ScheduleTemplateSearchRequest,
  UpdateScheduleTemplatePayload,
} from './schedule-templates.types';

@Controller('schedule-templates')
export class ScheduleTemplatesController {
  constructor(private readonly service: ScheduleTemplatesService) {}

  @Post('search')
  search(@Body() payload: ScheduleTemplateSearchRequest) {
    return this.service.searchTemplates(payload);
  }

  @Get(':templateId')
  getById(@Param('templateId') templateId: string) {
    return this.service.getTemplateById(templateId);
  }

  @Post()
  create(@Body() payload: CreateScheduleTemplatePayload) {
    return this.service.createTemplate(payload);
  }

  @Put(':templateId')
  update(
    @Param('templateId') templateId: string,
    @Body() payload: UpdateScheduleTemplatePayload,
  ) {
    return this.service.updateTemplate(templateId, payload);
  }

  @Delete(':templateId')
  async delete(@Param('templateId') templateId: string) {
    await this.service.deleteTemplate(templateId);
    return { ok: true };
  }
}
