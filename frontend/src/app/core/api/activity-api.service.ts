import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PlanningStageId } from '../../features/planning/planning-stage.model';
import { API_CONFIG } from '../config/api-config';
import { PlanningApiContext } from './planning-api-context';
import {
  ActivityBatchMutationRequest,
  ActivityBatchMutationResponse,
  ActivityValidationRequest,
  ActivityValidationResponse,
  OperationsSnapshotRequest,
  OperationsSnapshotResponse,
  PlanningStageViewportSubscriptionRequest,
  PlanningStageViewportSubscriptionResponse,
  ResourceBatchMutationRequest,
  ResourceBatchMutationResponse,
} from './activity-api.types';
import type { Activity } from '../../models/activity';

@Injectable({ providedIn: 'root' })
export class ActivityApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  batchMutateActivities(
    stageId: PlanningStageId,
    payload: ActivityBatchMutationRequest,
    context?: PlanningApiContext,
  ): Observable<ActivityBatchMutationResponse> {
    return this.http.put<ActivityBatchMutationResponse>(`${this.stageUrl(stageId)}/activities`, payload, {
      params: this.buildContextParams(context),
    });
  }

  batchMutateResources(
    stageId: PlanningStageId,
    payload: ResourceBatchMutationRequest,
    context?: PlanningApiContext,
  ): Observable<ResourceBatchMutationResponse> {
    return this.http.put<ResourceBatchMutationResponse>(`${this.stageUrl(stageId)}/resources`, payload, {
      params: this.buildContextParams(context),
    });
  }

  validateActivities(
    stageId: PlanningStageId,
    payload: ActivityValidationRequest,
    context?: PlanningApiContext,
  ): Observable<ActivityValidationResponse> {
    return this.http.post<ActivityValidationResponse>(`${this.stageUrl(stageId)}/activities:validate`, payload, {
      params: this.buildContextParams(context),
    });
  }

  listActivities(
    stageId: PlanningStageId,
    filters?: { from?: string; to?: string; resourceIds?: string[] },
    context?: PlanningApiContext,
  ): Observable<Activity[]> {
    let params = this.buildContextParams(context);
    if (filters?.from) {
      params = params.set('from', filters.from);
    }
    if (filters?.to) {
      params = params.set('to', filters.to);
    }
    if (filters?.resourceIds?.length) {
      params = params.set('resourceIds', filters.resourceIds.join(','));
    }
    return this.http.get<Activity[]>(`${this.stageUrl(stageId)}/activities`, { params });
  }

  updateViewportSubscription(
    stageId: PlanningStageId,
    payload: PlanningStageViewportSubscriptionRequest,
    context?: PlanningApiContext,
  ): Observable<PlanningStageViewportSubscriptionResponse> {
    return this.http.post<PlanningStageViewportSubscriptionResponse>(
      `${this.stageUrl(stageId)}/subscriptions`,
      payload,
      { params: this.buildContextParams(context) },
    );
  }

  snapshotOperationsFromBase(
    payload: OperationsSnapshotRequest,
    context?: PlanningApiContext,
  ): Observable<OperationsSnapshotResponse> {
    return this.http.post<OperationsSnapshotResponse>(
      `${this.stageUrl('operations')}/snapshot`,
      payload,
      { params: this.buildContextParams(context) },
    );
  }

  private stageUrl(stageId: PlanningStageId): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    return `${base}/planning/stages/${stageId}`;
  }

  private buildContextParams(context?: PlanningApiContext): HttpParams {
    let params = new HttpParams();
    const variantId = context?.variantId?.trim();
    if (variantId) {
      params = params.set('variantId', variantId);
    }
    return params;
  }
}
