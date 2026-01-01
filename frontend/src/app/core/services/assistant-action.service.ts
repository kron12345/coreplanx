import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssistantApiService } from '../api/assistant-api.service';
import {
  AssistantActionPreviewResponseDto,
  AssistantActionCommitResponseDto,
  AssistantActionResolveResponseDto,
} from '../models/assistant-chat.model';
import { AssistantUiContextService } from './assistant-ui-context.service';
import { AssistantChatService } from './assistant-chat.service';
import { PlanningDataService } from '../../features/planning/planning-data.service';
import { PlanningStoreService } from '../../shared/planning-store.service';
import { SimulationService } from './simulation.service';
import { TimetableYearService } from './timetable-year.service';

type PreviewResult = 'actionable' | 'feedback' | 'not-actionable' | 'error';

@Injectable({ providedIn: 'root' })
export class AssistantActionService {
  private readonly api = inject(AssistantApiService);
  private readonly uiContext = inject(AssistantUiContextService);
  private readonly planning = inject(PlanningDataService);
  private readonly planningStore = inject(PlanningStoreService);
  private readonly simulations = inject(SimulationService);
  private readonly timetableYears = inject(TimetableYearService);
  private readonly chat = inject(AssistantChatService);

  readonly preview = signal<AssistantActionPreviewResponseDto | null>(null);
  readonly previewPrompt = signal<string | null>(null);
  readonly isLoading = signal(false);
  readonly isCommitting = signal(false);
  readonly isResolving = signal(false);
  readonly error = signal<string | null>(null);

  shouldAttemptAction(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return /(^|\s)(lege|anlegen|erstelle|erstellen|erstellt|erstell|erzeuge|füge|hinzu|mach|mache|lösche|entferne|ändere|bearbeite|aktualisiere)\b/.test(
      normalized,
    );
  }

  async requestPreview(prompt: string): Promise<PreviewResult> {
    const trimmed = prompt.trim();
    if (!trimmed || this.isLoading() || this.isCommitting()) {
      return 'error';
    }
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.api.previewAction({
          prompt: trimmed,
          clientId: this.chat.getOrCreateClientId(),
          uiContext: this.uiContext.snapshot(),
        }),
      );

      if (!response.actionable) {
        if (response.feedback || response.clarification) {
          this.preview.set(response);
          this.previewPrompt.set(trimmed);
          return 'feedback';
        }
        this.preview.set(null);
        this.previewPrompt.set(null);
        return 'not-actionable';
      }

      this.preview.set(response);
      this.previewPrompt.set(trimmed);
      return 'actionable';
    } catch (error) {
      this.error.set(this.describeError(error));
      return 'error';
    } finally {
      this.isLoading.set(false);
    }
  }

  async commitPreview(): Promise<AssistantActionCommitResponseDto | null> {
    const preview = this.preview();
    if (!preview?.previewId || this.isCommitting() || this.isLoading() || this.isResolving()) {
      return null;
    }
    this.isCommitting.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.api.commitAction({
          previewId: preview.previewId,
          clientId: this.chat.getOrCreateClientId(),
        }),
      );
      if (response.applied && response.snapshot) {
        this.planning.syncResourceSnapshot(response.snapshot);
      }
      if (response.applied) {
        this.handleRefreshHints(response.refresh);
      }
      this.clearPreview();
      return response;
    } catch (error) {
      this.error.set(this.describeError(error));
      return null;
    } finally {
      this.isCommitting.set(false);
    }
  }

  clearPreview(): void {
    this.preview.set(null);
    this.previewPrompt.set(null);
  }

  async resolveClarification(
    resolutionId: string,
    selectedId: string,
  ): Promise<AssistantActionResolveResponseDto | null> {
    if (!resolutionId || !selectedId || this.isResolving() || this.isLoading()) {
      return null;
    }
    this.isResolving.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.api.resolveAction({
          resolutionId,
          selectedId,
          clientId: this.chat.getOrCreateClientId(),
        }),
      );
      this.preview.set(response);
      return response;
    } catch (error) {
      this.error.set(this.describeError(error));
      return null;
    } finally {
      this.isResolving.set(false);
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const serverMessage = this.extractServerMessage(error);
      return serverMessage || error.message || 'Unbekannter Fehler beim Assistant-Request.';
    }
    return (error as Error)?.message ?? String(error);
  }

  private extractServerMessage(error: HttpErrorResponse): string {
    return typeof error.error === 'object' && error.error && 'message' in error.error
      ? String((error.error as { message?: unknown }).message ?? '')
      : '';
  }

  private handleRefreshHints(hints?: string[]): void {
    if (!hints?.length) {
      return;
    }
    const hintSet = new Set(hints);
    if (hintSet.has('topology')) {
      void this.planningStore.refreshAllFromApi();
    }
    if (hintSet.has('simulations')) {
      this.simulations.refresh();
    }
    if (hintSet.has('timetable-years')) {
      this.timetableYears.refresh();
    }
  }
}
