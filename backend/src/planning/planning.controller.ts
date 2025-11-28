import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type {
  ActivityFilters,
  ActivityMutationRequest,
  ActivityValidationRequest,
  ResourceMutationRequest,
} from './planning.types';
import { PlanningService } from './planning.service';

@Controller('planning/stages')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Get(':stageId')
  getStage(@Param('stageId') stageId: string) {
    return this.planningService.getStageSnapshot(stageId);
  }

  @Get(':stageId/resources')
  listResources(@Param('stageId') stageId: string) {
    return this.planningService.listResources(stageId);
  }

  @Get(':stageId/activities')
  listActivities(
    @Param('stageId') stageId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('resourceIds') resourceIds?: string | string[],
  ) {
    const filters: ActivityFilters = {
      from,
      to,
      resourceIds: this.normalizeResourceIds(resourceIds),
    };
    return this.planningService.listActivities(stageId, filters);
  }

  @Put(':stageId/resources')
  mutateResources(
    @Param('stageId') stageId: string,
    @Body() request?: ResourceMutationRequest,
  ) {
    return this.planningService.mutateResources(stageId, request);
  }

  @Put(':stageId/activities')
  mutateActivities(
    @Param('stageId') stageId: string,
    @Body() request?: ActivityMutationRequest,
  ) {
    return this.planningService.mutateActivities(stageId, request);
  }

  @Post(':stageId/activities:validate')
  validateActivities(
    @Param('stageId') stageId: string,
    @Body() request?: ActivityValidationRequest,
  ) {
    return this.planningService.validateActivities(stageId, request);
  }

  @Sse(':stageId/events')
  streamEvents(
    @Param('stageId') stageId: string,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('connectionId') connectionId?: string,
  ): Observable<MessageEvent> {
    return this.planningService
      .streamStageEvents(stageId, userId ?? clientId, connectionId)
      .pipe(map((data) => ({ data })));
  }

  private normalizeResourceIds(
    value?: string | string[],
  ): string[] | undefined {
    if (!value) {
      return undefined;
    }
    const raw = Array.isArray(value) ? value : value.split(',');
    const cleaned = raw.map((entry) => entry.trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
}
