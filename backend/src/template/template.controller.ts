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
import type {
  Lod,
  TimelineResponse,
  ActivityDto,
} from '../timeline/timeline.types';

@Controller('templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  listTemplateSets(
    @Query('variantId') variantId?: string,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<ActivityTemplateSet[]> {
    const flag = (includeArchived ?? '').toLowerCase();
    const wantsArchived = flag === '1' || flag === 'true' || flag === 'yes';
    return this.templateService.listTemplateSets(variantId, wantsArchived);
  }

  @Post()
  createTemplateSet(
    @Query('variantId') variantId: string | undefined,
    @Query('timetableYearLabel') timetableYearLabel: string | undefined,
    @Body() payload: CreateTemplateSetPayload,
  ): Promise<ActivityTemplateSet> {
    return this.templateService.createTemplateSet(payload, variantId, timetableYearLabel ?? null);
  }

  @Get(':templateId')
  getTemplateSet(
    @Param('templateId') templateId: string,
    @Query('variantId') variantId?: string,
  ): Promise<ActivityTemplateSet> {
    return this.templateService.getTemplateSet(templateId, variantId);
  }

  @Put(':templateId')
  updateTemplateSet(
    @Param('templateId') templateId: string,
    @Query('variantId') variantId: string | undefined,
    @Body() payload: UpdateTemplateSetPayload,
  ): Promise<ActivityTemplateSet> {
    return this.templateService.updateTemplateSet(templateId, payload, variantId);
  }

  @Delete(':templateId')
  deleteTemplateSet(
    @Param('templateId') templateId: string,
    @Query('variantId') variantId?: string,
  ): Promise<void> {
    return this.templateService.deleteTemplateSet(templateId, variantId);
  }

  @Get(':templateId/timeline')
  getTemplateTimeline(
    @Param('templateId') templateId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('lod') lod: Lod = 'activity',
    @Query('stage') stage: 'base' | 'operations' = 'base',
    @Query('variantId') variantId?: string,
  ): Promise<TimelineResponse> {
    if (!from || !to) {
      throw new Error('Query params "from" and "to" are required.');
    }
    return this.templateService.getTemplateTimeline(
      templateId,
      from,
      to,
      lod,
      stage,
      variantId,
    );
  }

  @Put(':templateId/activities/:activityId')
  upsertActivity(
    @Param('templateId') templateId: string,
    @Param('activityId') activityId: string,
    @Query('variantId') variantId: string | undefined,
    @Body() payload: ActivityDto,
  ): Promise<ActivityDto> {
    return this.templateService.upsertTemplateActivity(templateId, {
      ...payload,
      id: activityId,
    }, variantId);
  }

  @Delete(':templateId/activities/:activityId')
  deleteActivity(
    @Param('templateId') templateId: string,
    @Param('activityId') activityId: string,
    @Query('variantId') variantId?: string,
  ): Promise<void> {
    return this.templateService.deleteTemplateActivity(templateId, activityId, variantId);
  }

  @Post(':templateId/rollout')
  rolloutTemplate(
    @Param('templateId') templateId: string,
    @Query('variantId') variantId: string | undefined,
    @Body() payload: { stage: 'base' | 'operations'; anchorStart?: string },
  ): Promise<ActivityDto[]> {
    return this.templateService.rolloutTemplate(
      templateId,
      payload.stage,
      payload.anchorStart,
      variantId,
    );
  }

  @Post(':templateId/publish')
  publishTemplateSet(
    @Param('templateId') templateId: string,
    @Query('variantId') variantId: string | undefined,
    @Query('targetVariantId') targetVariantId: string | undefined,
    @Query('timetableYearLabel') timetableYearLabel: string | undefined,
  ): Promise<ActivityTemplateSet> {
    return this.templateService.publishTemplateSet({
      templateId,
      sourceVariantId: variantId,
      targetVariantId,
      timetableYearLabel: timetableYearLabel ?? null,
    });
  }
}
