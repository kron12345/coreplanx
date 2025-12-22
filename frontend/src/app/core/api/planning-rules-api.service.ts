import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PlanningStageId } from '../../features/planning/planning-stage.model';
import { API_CONFIG } from '../config/api-config';
import { PlanningApiContext } from './planning-api-context';
import type {
  PlanningRuleListResponse,
  PlanningRuleMutationRequest,
  PlanningRuleMutationResponse,
} from './planning-rules-api.types';

@Injectable({ providedIn: 'root' })
export class PlanningRulesApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listRules(stageId: PlanningStageId, context?: PlanningApiContext): Observable<PlanningRuleListResponse> {
    return this.http.get<PlanningRuleListResponse>(`${this.stageUrl(stageId)}/rules`, {
      params: this.buildContextParams(context),
    });
  }

  mutateRules(
    stageId: PlanningStageId,
    payload: PlanningRuleMutationRequest,
    context?: PlanningApiContext,
  ): Observable<PlanningRuleMutationResponse> {
    return this.http.put<PlanningRuleMutationResponse>(`${this.stageUrl(stageId)}/rules`, payload, {
      params: this.buildContextParams(context),
    });
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

