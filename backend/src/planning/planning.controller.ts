import {
  Body,
  BadRequestException,
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
import {
  deriveTimetableYearLabelFromVariantId,
  normalizeVariantId,
} from '../shared/variant-scope';

@Controller('planning/stages')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @Post('operations/snapshot')
  snapshotOperationsFromBase(
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() payload?: { templateId?: string; replaceExisting?: boolean },
  ) {
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.planningService.snapshotBaseToOperations({
      variantId: normalizedVariantId,
      templateId: payload?.templateId ?? '',
      timetableYearLabel: derivedYear ?? timetableYearLabel ?? null,
      replaceExisting: payload?.replaceExisting ?? false,
    });
  }

  @Get(':stageId')
  getStage(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
  ) {
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.planningService.getStageSnapshot(
      stageId,
      normalizedVariantId,
      derivedYear ?? timetableYearLabel ?? null,
    );
  }

  @Get(':stageId/resources')
  listResources(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
  ) {
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.planningService.listResources(
      stageId,
      normalizedVariantId,
      derivedYear ?? timetableYearLabel ?? null,
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
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    const filters: ActivityFilters = {
      from,
      to,
      resourceIds: this.normalizeResourceIds(resourceIds),
    };
    return this.planningService.listActivities(
      stageId,
      normalizedVariantId,
      filters,
      derivedYear ?? timetableYearLabel ?? null,
    );
  }

  @Put(':stageId/resources')
  mutateResources(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: ResourceMutationRequest,
  ) {
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.planningService.mutateResources(
      stageId,
      normalizedVariantId,
      request,
      derivedYear ?? timetableYearLabel ?? null,
    );
  }

  @Put(':stageId/activities')
  mutateActivities(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: ActivityMutationRequest,
  ) {
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.planningService.mutateActivities(
      stageId,
      normalizedVariantId,
      request,
      derivedYear ?? timetableYearLabel ?? null,
    );
  }

  @Post(':stageId/activities:validate')
  validateActivities(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: ActivityValidationRequest,
  ) {
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.planningService.validateActivities(
      stageId,
      normalizedVariantId,
      request,
      derivedYear ?? timetableYearLabel ?? null,
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
    const normalizedVariantId = normalizeVariantId(variantId);
    const derivedYear = deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    if (derivedYear && timetableYearLabel && timetableYearLabel.trim() !== derivedYear) {
      throw new BadRequestException(
        `timetableYearLabel (${timetableYearLabel}) passt nicht zu variantId (${normalizedVariantId}).`,
      );
    }
    return this.planningService
      .streamStageEvents(
        stageId,
        normalizedVariantId,
        userId ?? clientId,
        connectionId,
        derivedYear ?? timetableYearLabel ?? null,
      )
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
