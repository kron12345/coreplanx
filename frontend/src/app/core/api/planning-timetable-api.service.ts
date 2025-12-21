import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { TrainRun, TrainSegment } from '../../models/train';
import type {
  MergeTrainServicePartsResponseDto,
  PlanningTimetableSnapshotDto,
  RebuildTrainServicePartsResponseDto,
  ReplaceTimetableSnapshotResponseDto,
  SplitTrainServicePartResponseDto,
  TimetableRevisionRecordDto,
  TimetableStageId,
  TrainServicePartRecordDto,
} from './planning-timetable-api.types';

@Injectable({ providedIn: 'root' })
export class PlanningTimetableApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  getSnapshot(variantId: string, stageId: TimetableStageId = 'base'): Observable<PlanningTimetableSnapshotDto> {
    const params = this.buildParams({ variantId, stageId });
    return this.http.get<PlanningTimetableSnapshotDto>(`${this.baseUrl()}/timetable`, { params });
  }

  replaceSnapshot(options: {
    variantId: string;
    stageId?: TimetableStageId;
    trainRuns: TrainRun[];
    trainSegments: TrainSegment[];
    revisionMessage?: string | null;
    createdBy?: string | null;
  }): Observable<ReplaceTimetableSnapshotResponseDto> {
    const params = this.buildParams({ variantId: options.variantId, stageId: options.stageId ?? 'base' });
    return this.http.put<ReplaceTimetableSnapshotResponseDto>(`${this.baseUrl()}/timetable`, {
      trainRuns: options.trainRuns,
      trainSegments: options.trainSegments,
      revisionMessage: options.revisionMessage ?? null,
      createdBy: options.createdBy ?? null,
    }, { params });
  }

  listRevisions(variantId: string, stageId: TimetableStageId = 'base'): Observable<TimetableRevisionRecordDto[]> {
    const params = this.buildParams({ variantId, stageId });
    return this.http.get<TimetableRevisionRecordDto[]>(`${this.baseUrl()}/timetable/revisions`, { params });
  }

  restoreRevision(options: {
    revisionId: string;
    message?: string | null;
  }): Observable<{ revision: TimetableRevisionRecordDto | null }> {
    const revisionId = options.revisionId.trim();
    return this.http.post<{ revision: TimetableRevisionRecordDto | null }>(
      `${this.baseUrl()}/timetable/revisions/${encodeURIComponent(revisionId)}/restore`,
      { message: options.message ?? null },
    );
  }

  listServiceParts(variantId: string, stageId: TimetableStageId = 'base'): Observable<TrainServicePartRecordDto[]> {
    const params = this.buildParams({ variantId, stageId });
    return this.http.get<TrainServicePartRecordDto[]>(`${this.baseUrl()}/timetable/service-parts`, { params });
  }

  rebuildServiceParts(variantId: string, stageId: TimetableStageId = 'base'): Observable<RebuildTrainServicePartsResponseDto> {
    const params = this.buildParams({ variantId, stageId });
    return this.http.post<RebuildTrainServicePartsResponseDto>(`${this.baseUrl()}/timetable/service-parts/auto`, {}, { params });
  }

  splitServicePart(options: {
    variantId: string;
    stageId?: TimetableStageId;
    partId: string;
    splitAfterSegmentId?: string | null;
    splitAfterOrderIndex?: number | null;
    newPartId?: string | null;
  }): Observable<SplitTrainServicePartResponseDto> {
    const params = this.buildParams({ variantId: options.variantId, stageId: options.stageId ?? 'base' });
    const partId = options.partId.trim();
    return this.http.post<SplitTrainServicePartResponseDto>(
      `${this.baseUrl()}/timetable/service-parts/${encodeURIComponent(partId)}/split`,
      {
        splitAfterSegmentId: options.splitAfterSegmentId ?? null,
        splitAfterOrderIndex: options.splitAfterOrderIndex ?? null,
        newPartId: options.newPartId ?? null,
      },
      { params },
    );
  }

  mergeServiceParts(options: {
    variantId: string;
    stageId?: TimetableStageId;
    leftPartId: string;
    rightPartId: string;
  }): Observable<MergeTrainServicePartsResponseDto> {
    const params = this.buildParams({ variantId: options.variantId, stageId: options.stageId ?? 'base' });
    return this.http.post<MergeTrainServicePartsResponseDto>(
      `${this.baseUrl()}/timetable/service-parts/merge`,
      { leftPartId: options.leftPartId, rightPartId: options.rightPartId },
      { params },
    );
  }

  private buildParams(options: { variantId: string; stageId: TimetableStageId }): HttpParams {
    let params = new HttpParams();
    const variantId = options.variantId?.trim();
    if (variantId) {
      params = params.set('variantId', variantId);
    }
    if (options.stageId) {
      params = params.set('stageId', options.stageId);
    }
    return params;
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}

