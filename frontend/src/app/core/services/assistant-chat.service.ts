import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssistantApiService } from '../api/assistant-api.service';
import { AssistantChatMessageDto, AssistantChatStatusDto } from '../models/assistant-chat.model';
import { AssistantUiContextService } from './assistant-ui-context.service';

const STORAGE_KEY = 'coreplanx.assistant.conversationId';
const CLIENT_ID_STORAGE_KEY = 'coreplanx.assistant.clientId';
const AUTO_RESET_STATUS = 403;

@Injectable({ providedIn: 'root' })
export class AssistantChatService {
  private readonly api = inject(AssistantApiService);
  private readonly uiContext = inject(AssistantUiContextService);

  readonly clientId = signal<string | null>(this.readClientId());
  readonly conversationId = signal<string | null>(this.readConversationId());
  readonly messages = signal<AssistantChatMessageDto[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<AssistantChatStatusDto[]>([]);

  async sendPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || this.isLoading()) {
      return;
    }

    const conversationId = this.ensureConversationId();
    const optimisticMessage: AssistantChatMessageDto = {
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    this.messages.update((messages) => [...messages, optimisticMessage]);

    this.isLoading.set(true);
    this.error.set(null);
    this.status.set([{ stage: 'processing', message: 'Anfrage wird verarbeitet...' }]);

    try {
      await this.sendRequest(trimmed, conversationId);
    } catch (error) {
      const autoResetMessage = this.isConversationOwnershipError(error);
      if (autoResetMessage) {
        const clientId = this.ensureClientId();
        this.resetConversation();
        this.messages.set([optimisticMessage]);
        try {
          await this.sendRequest(trimmed, this.ensureConversationId(), clientId);
          return;
        } catch (retryError) {
          this.error.set(this.describeError(retryError));
          this.status.set([]);
          return;
        }
      }
      this.error.set(this.describeError(error));
      this.status.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  resetConversation(): void {
    this.conversationId.set(null);
    this.messages.set([]);
    this.error.set(null);
    this.status.set([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  getOrCreateClientId(): string {
    return this.ensureClientId();
  }

  private readClientId(): string | null {
    try {
      const value = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
      return value?.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  }

  private readConversationId(): string | null {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value?.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  }

  private persistConversationId(conversationId: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, conversationId);
    } catch {
      // ignore
    }
  }

  private persistClientId(clientId: string): void {
    try {
      localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    } catch {
      // ignore
    }
  }

  private ensureClientId(): string {
    const existing = this.clientId();
    if (existing) {
      return existing;
    }
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    this.clientId.set(id);
    this.persistClientId(id);
    return id;
  }

  private ensureConversationId(): string {
    const existing = this.conversationId();
    if (existing) {
      return existing;
    }
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    this.conversationId.set(id);
    this.persistConversationId(id);
    return id;
  }

  private async sendRequest(
    prompt: string,
    conversationId: string,
    clientId?: string,
  ): Promise<void> {
    const resolvedClientId = clientId ?? this.ensureClientId();
    const response = await firstValueFrom(
      this.api.chat({
        prompt,
        clientId: resolvedClientId,
        conversationId,
        uiContext: this.uiContext.snapshot(),
      }),
    );
    this.conversationId.set(response.conversationId);
    this.persistConversationId(response.conversationId);
    this.messages.set(response.messages ?? []);
    this.status.set(response.status ?? []);
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

  private isConversationOwnershipError(error: unknown): string | null {
    if (!(error instanceof HttpErrorResponse)) {
      return null;
    }
    if (error.status !== AUTO_RESET_STATUS) {
      return null;
    }
    const message = this.extractServerMessage(error).trim();
    if (!message) {
      return null;
    }
    const normalized = message.toLowerCase();
    if (normalized.includes('conversationid is owned')) {
      return message;
    }
    if (normalized.includes('belongs to another client')) {
      return message;
    }
    return null;
  }
}
