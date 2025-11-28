import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TemplateService } from './template.service';
import type {
  ActivityTemplateSet,
  CreateTemplateSetPayload,
  UpdateTemplateSetPayload,
} from './template.types';
import type { Lod, TimelineResponse, ActivityDto } from '../timeline/timeline.types';

@Controller('api/templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  listTemplateSets(): Promise<ActivityTemplateSet[]> {
    return this.templateService.listTemplateSets();
  }

  @Post()
  createTemplateSet(@Body() payload: CreateTemplateSetPayload): Promise<ActivityTemplateSet> {
    return this.templateService.createTemplateSet(payload);
  }

  @Get(':templateId')
  getTemplateSet(@Param('templateId') templateId: string): Promise<ActivityTemplateSet> {
    return this.templateService.getTemplateSet(templateId);
  }

  @Put(':templateId')
  updateTemplateSet(
    @Param('templateId') templateId: string,
    @Body() payload: UpdateTemplateSetPayload,
  ): Promise<ActivityTemplateSet> {
    return this.templateService.updateTemplateSet(templateId, payload);
  }

  @Delete(':templateId')
  deleteTemplateSet(@Param('templateId') templateId: string): Promise<void> {
    return this.templateService.deleteTemplateSet(templateId);
  }

  @Get(':templateId/timeline')
  getTemplateTimeline(
    @Param('templateId') templateId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('lod') lod: Lod = 'activity',
    @Query('stage') stage: 'base' | 'operations' = 'base',
  ): Promise<TimelineResponse> {
    if (!from || !to) {
      throw new Error('Query params "from" and "to" are required.');
    }
    return this.templateService.getTemplateTimeline(templateId, from, to, lod, stage);
  }

  @Put(':templateId/activities/:activityId')
  upsertActivity(
    @Param('templateId') templateId: string,
    @Param('activityId') activityId: string,
    @Body() payload: ActivityDto,
  ): Promise<ActivityDto> {
    return this.templateService.upsertTemplateActivity(templateId, {
      ...payload,
      id: activityId,
    });
  }

  @Delete(':templateId/activities/:activityId')
  deleteActivity(
    @Param('templateId') templateId: string,
    @Param('activityId') activityId: string,
  ): Promise<void> {
    return this.templateService.deleteTemplateActivity(templateId, activityId);
  }

  @Post(':templateId/rollout')
  rolloutTemplate(
    @Param('templateId') templateId: string,
    @Body() payload: { stage: 'base' | 'operations'; anchorStart?: string },
  ): Promise<ActivityDto[]> {
    return this.templateService.rolloutTemplate(
      templateId,
      payload.stage,
      payload.anchorStart,
    );
  }
}
