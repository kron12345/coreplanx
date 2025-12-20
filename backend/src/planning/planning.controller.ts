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

  @Post('operations/snapshot')
  snapshotOperationsFromBase(
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() payload?: { templateId?: string; replaceExisting?: boolean },
  ) {
    return this.planningService.snapshotBaseToOperations({
      variantId: this.normalizeVariantId(variantId),
      templateId: payload?.templateId ?? '',
      timetableYearLabel: timetableYearLabel ?? null,
      replaceExisting: payload?.replaceExisting ?? false,
    });
  }

  @Get(':stageId')
  getStage(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
  ) {
    return this.planningService.getStageSnapshot(
      stageId,
      this.normalizeVariantId(variantId),
      timetableYearLabel ?? null,
    );
  }

  @Get(':stageId/resources')
  listResources(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
  ) {
    return this.planningService.listResources(
      stageId,
      this.normalizeVariantId(variantId),
      timetableYearLabel ?? null,
    );
  }

  @Get(':stageId/activities')
  listActivities(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('resourceIds') resourceIds?: string | string[],
  ) {
    const filters: ActivityFilters = {
      from,
      to,
      resourceIds: this.normalizeResourceIds(resourceIds),
    };
    return this.planningService.listActivities(
      stageId,
      this.normalizeVariantId(variantId),
      filters,
      timetableYearLabel ?? null,
    );
  }

  @Put(':stageId/resources')
  mutateResources(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: ResourceMutationRequest,
  ) {
    return this.planningService.mutateResources(
      stageId,
      this.normalizeVariantId(variantId),
      request,
      timetableYearLabel ?? null,
    );
  }

  @Put(':stageId/activities')
  mutateActivities(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: ActivityMutationRequest,
  ) {
    return this.planningService.mutateActivities(
      stageId,
      this.normalizeVariantId(variantId),
      request,
      timetableYearLabel ?? null,
    );
  }

  @Post(':stageId/activities:validate')
  validateActivities(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: ActivityValidationRequest,
  ) {
    return this.planningService.validateActivities(
      stageId,
      this.normalizeVariantId(variantId),
      request,
      timetableYearLabel ?? null,
    );
  }

  @Sse(':stageId/events')
  streamEvents(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('connectionId') connectionId?: string,
  ): Observable<MessageEvent> {
    return this.planningService
      .streamStageEvents(
        stageId,
        this.normalizeVariantId(variantId),
        userId ?? clientId,
        connectionId,
        timetableYearLabel ?? null,
      )
      .pipe(map((data) => ({ data })));
  }

  private normalizeVariantId(value?: string): string {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : 'default';
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
