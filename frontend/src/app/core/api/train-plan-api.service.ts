import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { TrainPlan } from '../models/train-plan.model';
import type {
  CreateManualPlanPayload,
  CreatePlanModificationPayload,
  CreatePlanVariantPayload,
  CreatePlansFromTemplatePayload,
} from '../services/train-plan.service';

@Injectable({ providedIn: 'root' })
export class TrainPlanApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listPlans(): Observable<TrainPlan[]> {
    return this.http.get<TrainPlan[]>(`${this.baseUrl()}/train-plans`);
  }

  upsertPlan(plan: TrainPlan): Observable<TrainPlan> {
    const id = plan.id?.trim();
    if (!id) {
      return this.http.post<TrainPlan>(`${this.baseUrl()}/train-plans`, plan);
    }
    return this.http.put<TrainPlan>(
      `${this.baseUrl()}/train-plans/${encodeURIComponent(id)}`,
      plan,
    );
  }

  createFromTemplate(payload: CreatePlansFromTemplatePayload): Observable<TrainPlan[]> {
    return this.http.post<TrainPlan[]>(`${this.baseUrl()}/train-plans/from-template`, payload);
  }

  createManual(payload: CreateManualPlanPayload): Observable<TrainPlan> {
    return this.http.post<TrainPlan>(`${this.baseUrl()}/train-plans/manual`, payload);
  }

  createModification(payload: CreatePlanModificationPayload): Observable<TrainPlan> {
    return this.http.post<TrainPlan>(`${this.baseUrl()}/train-plans/modification`, payload);
  }

  createVariant(payload: CreatePlanVariantPayload): Observable<TrainPlan> {
    return this.http.post<TrainPlan>(`${this.baseUrl()}/train-plans/variant`, payload);
  }

  deletePlan(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.baseUrl()}/train-plans/${encodeURIComponent(id)}`,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
