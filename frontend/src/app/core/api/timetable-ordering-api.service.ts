import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type {
  ApplyTimetableOrderingActionPayload,
  ApplyTimetableOrderingEventPayload,
  ApplyTimetableOrderingSimulatorPayload,
  CreateTimetableOrderingCasePayload,
  TimetableOrderingCaseDetailsDto,
  TimetableOrderingCaseDto,
  TimetableOrderingProfileSummaryDto,
  TimetableOrderingSnapshotDto,
} from './timetable-ordering-api.types';

@Injectable({ providedIn: 'root' })
export class TimetableOrderingApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listProfiles(): Observable<TimetableOrderingProfileSummaryDto[]> {
    return this.http.get<TimetableOrderingProfileSummaryDto[]>(
      `${this.baseUrl()}/timetable-ordering/profiles`,
    );
  }

  listCases(): Observable<TimetableOrderingCaseDto[]> {
    return this.http.get<TimetableOrderingCaseDto[]>(`${this.baseUrl()}/timetable-ordering/cases`);
  }

  createCase(payload: CreateTimetableOrderingCasePayload): Observable<TimetableOrderingCaseDetailsDto> {
    return this.http.post<TimetableOrderingCaseDetailsDto>(
      `${this.baseUrl()}/timetable-ordering/cases`,
      payload,
    );
  }

  getCase(caseId: string): Observable<TimetableOrderingCaseDetailsDto> {
    return this.http.get<TimetableOrderingCaseDetailsDto>(
      `${this.baseUrl()}/timetable-ordering/cases/${encodeURIComponent(caseId)}`,
    );
  }

  getSnapshot(caseId: string): Observable<TimetableOrderingSnapshotDto> {
    return this.http.get<TimetableOrderingSnapshotDto>(
      `${this.baseUrl()}/timetable-ordering/cases/${encodeURIComponent(caseId)}/snapshot`,
    );
  }

  applyAction(
    caseId: string,
    payload: ApplyTimetableOrderingActionPayload,
  ): Observable<TimetableOrderingCaseDetailsDto> {
    return this.http.post<TimetableOrderingCaseDetailsDto>(
      `${this.baseUrl()}/timetable-ordering/cases/${encodeURIComponent(caseId)}/actions`,
      payload,
    );
  }

  applyEvent(
    caseId: string,
    payload: ApplyTimetableOrderingEventPayload,
  ): Observable<TimetableOrderingCaseDetailsDto> {
    return this.http.post<TimetableOrderingCaseDetailsDto>(
      `${this.baseUrl()}/timetable-ordering/cases/${encodeURIComponent(caseId)}/events`,
      payload,
    );
  }

  applySimulator(
    caseId: string,
    payload: ApplyTimetableOrderingSimulatorPayload,
  ): Observable<TimetableOrderingCaseDetailsDto> {
    return this.http.post<TimetableOrderingCaseDetailsDto>(
      `${this.baseUrl()}/timetable-ordering/cases/${encodeURIComponent(caseId)}/simulator`,
      payload,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
