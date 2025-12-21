import type { TrainRun, TrainSegment } from '../planning/planning.types';

export type TimetableStageId = 'base' | 'operations' | 'dispatch';

export interface TimetableSnapshot {
  variantId: string;
  stageId: TimetableStageId;
  trainRuns: TrainRun[];
  trainSegments: TrainSegment[];
}

export interface TimetableRevisionRecord {
  id: string;
  variantId: string;
  stageId: TimetableStageId;
  createdAt: string;
  createdBy?: string | null;
  message?: string | null;
  trainRunCount: number;
  trainSegmentCount: number;
}

export interface TrainServicePartRecord {
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

export interface TrainServicePartLinkRecord {
  variantId: string;
  fromPartId: string;
  toPartId: string;
  kind: 'circulation';
  createdAt: string;
}

