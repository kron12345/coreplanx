import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { TimetableService } from './timetable.service';
import type {
  TimetableStageId,
  TrainServicePartLinkRecord,
} from './timetable.types';
import type { TrainRun, TrainSegment } from '../planning/planning.types';

function normalizeStageId(value?: string): TimetableStageId {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return 'base';
  }
  if (
    trimmed === 'base' ||
    trimmed === 'operations' ||
    trimmed === 'dispatch'
  ) {
    return trimmed;
  }
  throw new BadRequestException(
    'Ungültiger stageId (erwartet: base|operations|dispatch).',
  );
}

@Controller('timetable')
export class TimetableController {
  constructor(private readonly service: TimetableService) {}

  @Get()
  getSnapshot(
    @Query('variantId') variantId?: string,
    @Query('stageId') stageId?: string,
  ) {
    return this.service.getSnapshot(variantId, normalizeStageId(stageId));
  }

  @Put()
  replaceSnapshot(
    @Query('variantId') variantId?: string,
    @Query('stageId') stageId?: string,
    @Body()
    payload?: {
      trainRuns?: TrainRun[];
      trainSegments?: TrainSegment[];
      revisionMessage?: string | null;
      createdBy?: string | null;
    },
  ) {
    return this.service.replaceSnapshot({
      variantId,
      stageId: normalizeStageId(stageId),
      trainRuns: payload?.trainRuns ?? [],
      trainSegments: payload?.trainSegments ?? [],
      revisionMessage: payload?.revisionMessage ?? null,
      createdBy: payload?.createdBy ?? null,
    });
  }

  @Get('revisions')
  listRevisions(
    @Query('variantId') variantId?: string,
    @Query('stageId') stageId?: string,
  ) {
    return this.service.listRevisions(variantId, normalizeStageId(stageId));
  }

  @Post('revisions')
  createRevision(
    @Query('variantId') variantId?: string,
    @Query('stageId') stageId?: string,
    @Body() payload?: { message?: string | null; createdBy?: string | null },
  ) {
    return this.service.createRevision({
      variantId,
      stageId: normalizeStageId(stageId),
      message: payload?.message ?? null,
      createdBy: payload?.createdBy ?? null,
    });
  }

  @Post('revisions/:revisionId/restore')
  restoreRevision(
    @Param('revisionId') revisionId: string,
    @Body() payload?: { message?: string | null },
  ) {
    return this.service.restoreRevision(revisionId, payload?.message ?? null);
  }

  @Get('service-parts')
  listServiceParts(
    @Query('variantId') variantId?: string,
    @Query('stageId') stageId?: string,
  ) {
    return this.service.listTrainServiceParts(
      variantId,
      normalizeStageId(stageId),
    );
  }

  @Post('service-parts/auto')
  rebuildServiceParts(
    @Query('variantId') variantId?: string,
    @Query('stageId') stageId?: string,
  ) {
    return this.service.rebuildTrainServiceParts(
      variantId,
      normalizeStageId(stageId),
    );
  }

  @Put('service-parts/links')
  upsertServicePartLink(
    @Query('variantId') variantId?: string,
    @Body()
    payload?: {
      fromPartId?: string;
      toPartId?: string;
      kind?: TrainServicePartLinkRecord['kind'];
    },
  ) {
    const fromPartId = payload?.fromPartId?.trim();
    const toPartId = payload?.toPartId?.trim();
    if (!fromPartId || !toPartId) {
      throw new BadRequestException(
        'fromPartId und toPartId sind erforderlich.',
      );
    }
    return this.service.upsertTrainServicePartLink({
      variantId,
      fromPartId,
      toPartId,
      kind: payload?.kind ?? 'circulation',
    });
  }

  @Post('service-parts/:partId/split')
  splitServicePart(
    @Query('variantId') variantId: string | undefined,
    @Query('stageId') stageId: string | undefined,
    @Param('partId') partId: string,
    @Body()
    payload?: {
      splitAfterSegmentId?: string | null;
      splitAfterOrderIndex?: number | null;
      newPartId?: string | null;
    },
  ) {
    return this.service.splitTrainServicePart({
      variantId,
      stageId: normalizeStageId(stageId),
      partId,
      splitAfterSegmentId: payload?.splitAfterSegmentId ?? null,
      splitAfterOrderIndex: payload?.splitAfterOrderIndex ?? null,
      newPartId: payload?.newPartId ?? null,
    });
  }

  @Post('service-parts/merge')
  mergeServiceParts(
    @Query('variantId') variantId: string | undefined,
    @Query('stageId') stageId: string | undefined,
    @Body() payload?: { leftPartId?: string; rightPartId?: string },
  ) {
    const leftPartId = payload?.leftPartId?.trim();
    const rightPartId = payload?.rightPartId?.trim();
    if (!leftPartId || !rightPartId) {
      throw new BadRequestException(
        'leftPartId und rightPartId sind erforderlich.',
      );
    }
    return this.service.mergeTrainServiceParts({
      variantId,
      stageId: normalizeStageId(stageId),
      leftPartId,
      rightPartId,
    });
  }
}
