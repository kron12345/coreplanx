import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssistantApiService } from '../api/assistant-api.service';
import { AssistantHelpResponseDto } from '../models/assistant-chat.model';
import { AssistantUiContextService } from './assistant-ui-context.service';

@Injectable({ providedIn: 'root' })
export class AssistantHelpService {
  private readonly api = inject(AssistantApiService);
  private readonly uiContext = inject(AssistantUiContextService);

  readonly response = signal<AssistantHelpResponseDto | null>(null);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  async load(): Promise<void> {
    if (this.isLoading()) {
      return;
    }
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.api.help({
          uiContext: this.uiContext.snapshot(),
        }),
      );
      this.response.set(response);
    } catch (error) {
      this.error.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  clear(): void {
    this.response.set(null);
    this.error.set(null);
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const serverMessage =
        typeof error.error === 'object' && error.error && 'message' in error.error
          ? String((error.error as { message?: unknown }).message ?? '')
          : '';
      return serverMessage || error.message || 'Unbekannter Fehler beim Hilfe-Request.';
    }
    return (error as Error)?.message ?? String(error);
  }
}

