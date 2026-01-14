import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VariantPartitionService } from '../database/variant-partition.service';
import {
  normalizeVariantId,
  isProductiveVariantId,
  deriveTimetableYearLabelFromVariantId,
} from '../shared/variant-scope';
import type { TrainRun, TrainSegment } from '../planning/planning.types';
import { TimetableRepository } from './timetable.repository';
import type {
  TimetableRevisionRecord,
  TimetableStageId,
  TrainServicePartLinkRecord,
  TrainServicePartRecord,
} from './timetable.types';

@Injectable()
export class TimetableService {
  constructor(
    private readonly repository: TimetableRepository,
    private readonly partitions: VariantPartitionService,
  ) {}

  async getSnapshot(variantId?: string, stageId: TimetableStageId = 'base') {
    const normalizedVariantId = normalizeVariantId(variantId);
    return this.repository.loadSnapshot(normalizedVariantId, stageId);
  }

  async replaceSnapshot(options: {
    variantId?: string;
    stageId?: TimetableStageId;
    trainRuns: TrainRun[];
    trainSegments: TrainSegment[];
    revisionMessage?: string | null;
    createdBy?: string | null;
  }): Promise<{
    revision?: TimetableRevisionRecord;
    applied: { trainRuns: number; trainSegments: number };
  }> {
    const normalizedVariantId = normalizeVariantId(options.variantId);
    const stageId = options.stageId ?? 'base';
    if (
      !Array.isArray(options.trainRuns) ||
      !Array.isArray(options.trainSegments)
    ) {
      throw new BadRequestException(
        'trainRuns/trainSegments müssen Arrays sein.',
      );
    }

    await this.partitions.ensurePlanningPartitions(normalizedVariantId);

    let revision: TimetableRevisionRecord | undefined;
    const wantsRevision =
      isProductiveVariantId(normalizedVariantId) ||
      (options.revisionMessage?.trim().length ?? 0) > 0 ||
      (options.createdBy?.trim().length ?? 0) > 0;
    if (wantsRevision) {
      revision = await this.repository.createRevision({
        variantId: normalizedVariantId,
        stageId,
        createdBy: options.createdBy ?? null,
        message:
          options.revisionMessage ??
          (isProductiveVariantId(normalizedVariantId) ? 'update' : null),
      });
    }

    const applied = await this.repository.replaceSnapshot({
      variantId: normalizedVariantId,
      stageId,
      trainRuns: options.trainRuns,
      trainSegments: options.trainSegments,
    });

    return { revision, applied };
  }

  async listRevisions(
    variantId?: string,
    stageId: TimetableStageId = 'base',
  ): Promise<TimetableRevisionRecord[]> {
    const normalizedVariantId = normalizeVariantId(variantId);
    return this.repository.listRevisions(normalizedVariantId, stageId);
  }

  async createRevision(options: {
    variantId?: string;
    stageId?: TimetableStageId;
    message?: string | null;
    createdBy?: string | null;
  }): Promise<TimetableRevisionRecord> {
    const normalizedVariantId = normalizeVariantId(options.variantId);
    const stageId = options.stageId ?? 'base';
    return this.repository.createRevision({
      variantId: normalizedVariantId,
      stageId,
      createdBy: options.createdBy ?? null,
      message: options.message ?? null,
    });
  }

  async restoreRevision(
    revisionId: string,
    message?: string | null,
  ): Promise<{ revision: TimetableRevisionRecord | null }> {
    const trimmed = revisionId?.trim();
    if (!trimmed) {
      throw new BadRequestException('revisionId ist erforderlich.');
    }
    const snapshot = await this.repository.loadRevisionSnapshot(trimmed);
    if (!snapshot) {
      throw new NotFoundException(`Revision ${trimmed} existiert nicht.`);
    }
    const result = await this.replaceSnapshot({
      variantId: snapshot.variantId,
      stageId: snapshot.stageId,
      trainRuns: snapshot.trainRuns,
      trainSegments: snapshot.trainSegments,
      revisionMessage: message ?? `restore ${trimmed}`,
      createdBy: null,
    });
    return { revision: result.revision ?? null };
  }

  async listTrainServiceParts(
    variantId?: string,
    stageId: TimetableStageId = 'base',
  ): Promise<TrainServicePartRecord[]> {
    const normalizedVariantId = normalizeVariantId(variantId);
    return this.repository.listTrainServiceParts(normalizedVariantId, stageId);
  }

  async rebuildTrainServiceParts(
    variantId?: string,
    stageId: TimetableStageId = 'base',
  ): Promise<{ parts: number }> {
    const normalizedVariantId = normalizeVariantId(variantId);
    await this.partitions.ensurePlanningPartitions(normalizedVariantId);
    const yearLabel =
      deriveTimetableYearLabelFromVariantId(normalizedVariantId);
    return this.repository.rebuildTrainServiceParts({
      variantId: normalizedVariantId,
      stageId,
      timetableYearLabel: yearLabel,
    });
  }

  async upsertTrainServicePartLink(options: {
    variantId?: string;
    fromPartId: string;
    toPartId: string;
    kind?: TrainServicePartLinkRecord['kind'];
  }): Promise<TrainServicePartLinkRecord> {
    const normalizedVariantId = normalizeVariantId(options.variantId);
    const from = options.fromPartId?.trim();
    const to = options.toPartId?.trim();
    if (!from || !to) {
      throw new BadRequestException(
        'fromPartId und toPartId sind erforderlich.',
      );
    }
    await this.partitions.ensurePlanningPartitions(normalizedVariantId);
    return this.repository.upsertTrainServicePartLink({
      variantId: normalizedVariantId,
      fromPartId: from,
      toPartId: to,
      kind: options.kind ?? 'circulation',
    });
  }

  async splitTrainServicePart(options: {
    variantId?: string;
    stageId?: TimetableStageId;
    partId: string;
    splitAfterSegmentId?: string | null;
    splitAfterOrderIndex?: number | null;
    newPartId?: string | null;
  }): Promise<{ leftPartId: string; rightPartId: string }> {
    const normalizedVariantId = normalizeVariantId(options.variantId);
    const stageId = options.stageId ?? 'base';
    await this.partitions.ensurePlanningPartitions(normalizedVariantId);
    return this.repository.splitTrainServicePart({
      variantId: normalizedVariantId,
      stageId,
      partId: options.partId,
      splitAfterSegmentId: options.splitAfterSegmentId ?? null,
      splitAfterOrderIndex: options.splitAfterOrderIndex ?? null,
      newPartId: options.newPartId ?? null,
    });
  }

  async mergeTrainServiceParts(options: {
    variantId?: string;
    stageId?: TimetableStageId;
    leftPartId: string;
    rightPartId: string;
  }): Promise<{ mergedPartId: string }> {
    const normalizedVariantId = normalizeVariantId(options.variantId);
    const stageId = options.stageId ?? 'base';
    await this.partitions.ensurePlanningPartitions(normalizedVariantId);
    return this.repository.mergeTrainServiceParts({
      variantId: normalizedVariantId,
      stageId,
      leftPartId: options.leftPartId,
      rightPartId: options.rightPartId,
    });
  }
}
