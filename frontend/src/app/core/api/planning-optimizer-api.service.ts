import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import { PlanningStageId } from '../../features/planning/planning-stage.model';
import { PlanningApiContext } from './planning-api-context';
import {
  PlanningCandidateBuildResponseDto,
  PlanningSolverResponseDto,
  RulesetSelectionRequestDto,
} from './planning-optimizer-api.types';

@Injectable({ providedIn: 'root' })
export class PlanningOptimizerApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  buildCandidates(
    stageId: PlanningStageId,
    payload?: RulesetSelectionRequestDto,
    context?: PlanningApiContext,
  ): Observable<PlanningCandidateBuildResponseDto> {
    return this.http.post<PlanningCandidateBuildResponseDto>(
      `${this.stageUrl(stageId)}/optimizer/candidates`,
      payload ?? {},
      { params: this.buildContextParams(context) },
    );
  }

  solve(
    stageId: PlanningStageId,
    payload?: RulesetSelectionRequestDto,
    context?: PlanningApiContext,
  ): Observable<PlanningSolverResponseDto> {
    return this.http.post<PlanningSolverResponseDto>(
      `${this.stageUrl(stageId)}/optimizer/solve`,
      payload ?? {},
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
    const timetableYearLabel = context?.timetableYearLabel?.trim();
    if (timetableYearLabel) {
      params = params.set('timetableYearLabel', timetableYearLabel);
    }
    return params;
  }
}
