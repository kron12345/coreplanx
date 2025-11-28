import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PlanningStageId } from '../../features/planning/planning-stage.model';
import { API_CONFIG } from '../config/api-config';
import {
  ActivityBatchMutationRequest,
  ActivityBatchMutationResponse,
  ActivityValidationRequest,
  ActivityValidationResponse,
  ResourceBatchMutationRequest,
  ResourceBatchMutationResponse,
} from './activity-api.types';

@Injectable({ providedIn: 'root' })
export class ActivityApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  batchMutateActivities(
    stageId: PlanningStageId,
    payload: ActivityBatchMutationRequest,
  ): Observable<ActivityBatchMutationResponse> {
    return this.http.put<ActivityBatchMutationResponse>(`${this.stageUrl(stageId)}/activities`, payload);
  }

  batchMutateResources(
    stageId: PlanningStageId,
    payload: ResourceBatchMutationRequest,
  ): Observable<ResourceBatchMutationResponse> {
    return this.http.put<ResourceBatchMutationResponse>(`${this.stageUrl(stageId)}/resources`, payload);
  }

  validateActivities(
    stageId: PlanningStageId,
    payload: ActivityValidationRequest,
  ): Observable<ActivityValidationResponse> {
    return this.http.post<ActivityValidationResponse>(`${this.stageUrl(stageId)}/activities:validate`, payload);
  }

  private stageUrl(stageId: PlanningStageId): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    return `${base}/planning/stages/${stageId}`;
  }
}
