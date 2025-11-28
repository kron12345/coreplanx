import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PlanWeekService } from './plan-week.service';
import type {
  PlanWeekRolloutRequest,
  PlanWeekTemplate,
  PlanWeekValidity,
  PlanWeekActivity,
} from './planning.types';

@Controller('planning/base')
export class PlanningBaseController {
  constructor(private readonly planWeekService: PlanWeekService) {}

  @Get('templates')
  listTemplates() {
    return this.planWeekService.listTemplates();
  }

  @Put('templates/:templateId')
  upsertTemplate(
    @Param('templateId') templateId: string,
    @Body() payload: PlanWeekTemplate,
  ) {
    return this.planWeekService.upsertTemplate(templateId, payload);
  }

  @Delete('templates/:templateId')
  @HttpCode(204)
  deleteTemplate(@Param('templateId') templateId: string) {
    return this.planWeekService.deleteTemplate(templateId);
  }

  @Get('templates/:templateId/validities')
  listValidities(@Param('templateId') templateId: string) {
    return this.planWeekService.listValidities(templateId);
  }

  @Put('templates/:templateId/validities/:validityId')
  upsertValidity(
    @Param('templateId') templateId: string,
    @Param('validityId') validityId: string,
    @Body() payload: PlanWeekValidity,
  ) {
    return this.planWeekService.upsertValidity(templateId, validityId, payload);
  }

  @Delete('templates/:templateId/validities/:validityId')
  @HttpCode(204)
  deleteValidity(
    @Param('templateId') templateId: string,
    @Param('validityId') validityId: string,
  ) {
    return this.planWeekService.deleteValidity(templateId, validityId);
  }

  @Get('templates/:templateId/activities')
  listActivities(@Param('templateId') templateId: string) {
    return this.planWeekService.listTemplateActivities(templateId);
  }

  @Put('templates/:templateId/activities/:activityId')
  upsertActivity(
    @Param('templateId') templateId: string,
    @Param('activityId') activityId: string,
    @Body() payload: PlanWeekActivity,
  ) {
    return this.planWeekService.upsertTemplateActivity(
      templateId,
      activityId,
      payload,
    );
  }

  @Delete('templates/:templateId/activities/:activityId')
  @HttpCode(204)
  deleteActivity(
    @Param('templateId') templateId: string,
    @Param('activityId') activityId: string,
  ) {
    return this.planWeekService.deleteTemplateActivity(templateId, activityId);
  }

  @Post('templates\:rollout')
  rolloutTemplate(@Body() payload: PlanWeekRolloutRequest) {
    return this.planWeekService.rolloutTemplate(payload);
  }

  @Sse('templates/events')
  streamTemplateEvents(
    @Query('templateId') templateId?: string,
    @Query('userId') _userId?: string,
    @Query('connectionId') _connectionId?: string,
  ): Observable<MessageEvent> {
    return this.planWeekService
      .streamTemplateEvents(templateId)
      .pipe(map((data) => ({ data })));
  }
}
