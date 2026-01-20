import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type {
  ActivityFilters,
  ActivityMutationRequest,
  ActivityValidationRequest,
  PlanningStageViewportSubscriptionRequest,
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
    @Req()
    req?: {
      requestId?: string;
      headers?: Record<string, string | string[] | undefined>;
    },
  ) {
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
    const requestId =
      req?.requestId ??
      (typeof req?.headers?.['x-request-id'] === 'string'
        ? req?.headers?.['x-request-id']
        : undefined);
    return this.planningService.mutateActivities(
      stageId,
      normalizedVariantId,
      request,
      derivedYear ?? timetableYearLabel ?? null,
      requestId,
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
    return this.planningService.validateActivities(
      stageId,
      normalizedVariantId,
      request,
      derivedYear ?? timetableYearLabel ?? null,
    );
  }

  @Post(':stageId/subscriptions')
  updateViewportSubscription(
    @Param('stageId') stageId: string,
    @Query('variantId') variantId?: string,
    @Query('timetableYearLabel') timetableYearLabel?: string,
    @Body() request?: PlanningStageViewportSubscriptionRequest,
  ) {
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
    const normalizedResourceIds = this.normalizeResourceIds(
      request?.resourceIds,
    );
    const payload = request
      ? {
          ...request,
          resourceIds: normalizedResourceIds,
        }
      : undefined;
    return this.planningService.updateViewportSubscription(
      stageId,
      normalizedVariantId,
      payload,
      derivedYear ?? timetableYearLabel ?? null,
    );
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
