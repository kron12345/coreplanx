import {
  Body,
  BadRequestException,
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
import {
  deriveTimetableYearLabelFromVariantId,
  normalizeVariantId,
} from '../shared/variant-scope';

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
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear =
      deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (
      derivedYear &&
      timetableYearLabel &&
      timetableYearLabel.trim() !== derivedYear
    ) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.templateService.createTemplateSet(
      payload,
      normalizedVariantId,
      derivedYear ?? timetableYearLabel ?? null,
    );
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
    return this.templateService.updateTemplateSet(
      templateId,
      payload,
      variantId,
    );
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
    return this.templateService.upsertTemplateActivity(
      templateId,
      {
        ...payload,
        id: activityId,
      },
      variantId,
    );
  }

  @Delete(':templateId/activities/:activityId')
  deleteActivity(
    @Param('templateId') templateId: string,
    @Param('activityId') activityId: string,
    @Query('variantId') variantId?: string,
  ): Promise<void> {
    return this.templateService.deleteTemplateActivity(
      templateId,
      activityId,
      variantId,
    );
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
    const normalizedSourceVariantId = normalizeVariantId(variantId);
    const normalizedTargetVariantId = targetVariantId?.trim().length
      ? targetVariantId.trim()
      : undefined;
    const derivedTargetYear = normalizedTargetVariantId
      ? deriveTimetableYearLabelFromVariantId(normalizedTargetVariantId)
      : null;
    if (
      derivedTargetYear &&
      timetableYearLabel &&
      timetableYearLabel.trim() !== derivedTargetYear
    ) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu targetVariantId (${normalizedTargetVariantId}).`,
      );
    }
    return this.templateService.publishTemplateSet({
      templateId,
      sourceVariantId: normalizedSourceVariantId,
      targetVariantId: normalizedTargetVariantId,
      timetableYearLabel: derivedTargetYear ?? timetableYearLabel ?? null,
    });
  }
}
