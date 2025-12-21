import { TrainRun, TrainSegment } from '../../models/train';

export type TimetableStageId = 'base' | 'operations' | 'dispatch';

export interface PlanningTimetableSnapshotDto {
  variantId: string;
  stageId: TimetableStageId;
  trainRuns: TrainRun[];
  trainSegments: TrainSegment[];
}

export interface TimetableRevisionRecordDto {
  id: string;
  variantId: string;
  stageId: TimetableStageId;
  createdAt: string;
  createdBy?: string | null;
  message?: string | null;
  trainRunCount: number;
  trainSegmentCount: number;
}

export interface ReplaceTimetableSnapshotResponseDto {
  revision?: TimetableRevisionRecordDto | null;
  applied: { trainRuns: number; trainSegments: number };
}

export interface TrainServicePartRecordDto {
  id: string;
  variantId: string;
  stageId: TimetableStageId;
  timetableYearLabel?: string | null;
  trainRunId: string;
  trainNumber?: string | null;
  fromLocationId: string;
  toLocationId: string;
  startTime: string;
  endTime: string;
  segmentIds: string[];
  attributes?: Record<string, unknown> | null;
}

export interface RebuildTrainServicePartsResponseDto {
  parts: number;
}

export interface SplitTrainServicePartResponseDto {
  leftPartId: string;
  rightPartId: string;
}

export interface MergeTrainServicePartsResponseDto {
  mergedPartId: string;
}

