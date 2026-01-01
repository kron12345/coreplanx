import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import {
  AssistantChatRequestDto,
  AssistantChatResponseDto,
  AssistantActionCommitRequestDto,
  AssistantActionCommitResponseDto,
  AssistantActionPreviewRequestDto,
  AssistantActionPreviewResponseDto,
  AssistantActionResolveRequestDto,
  AssistantActionResolveResponseDto,
  AssistantHelpRequestDto,
  AssistantHelpResponseDto,
} from '../models/assistant-chat.model';

@Injectable({ providedIn: 'root' })
export class AssistantApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  chat(request: AssistantChatRequestDto): Observable<AssistantChatResponseDto> {
    return this.http.post<AssistantChatResponseDto>(`${this.baseUrl()}/assistant/chat`, request);
  }

  help(request: AssistantHelpRequestDto): Observable<AssistantHelpResponseDto> {
    return this.http.post<AssistantHelpResponseDto>(`${this.baseUrl()}/assistant/help`, request);
  }

  previewAction(
    request: AssistantActionPreviewRequestDto,
  ): Observable<AssistantActionPreviewResponseDto> {
    return this.http.post<AssistantActionPreviewResponseDto>(
      `${this.baseUrl()}/assistant/actions/preview`,
      request,
    );
  }

  commitAction(
    request: AssistantActionCommitRequestDto,
  ): Observable<AssistantActionCommitResponseDto> {
    return this.http.post<AssistantActionCommitResponseDto>(
      `${this.baseUrl()}/assistant/actions/commit`,
      request,
    );
  }

  resolveAction(
    request: AssistantActionResolveRequestDto,
  ): Observable<AssistantActionResolveResponseDto> {
    return this.http.post<AssistantActionResolveResponseDto>(
      `${this.baseUrl()}/assistant/actions/resolve`,
      request,
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
