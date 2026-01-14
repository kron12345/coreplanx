import { Inject, Injectable } from '@nestjs/common';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import type { AssistantChatRole } from './assistant.dto';

export interface StoredAssistantChatMessage {
  role: AssistantChatRole;
  content: string;
  createdAt: number;
}

export interface StoredConversationState {
  id: string;
  clientId: string | null;
  messages: StoredAssistantChatMessage[];
  summary: string | null;
  summaryPending: StoredAssistantChatMessage[];
  lastDocSignature: string | null;
  updatedAt: number;
}

@Injectable()
export class AssistantConversationStore {
  private readonly conversations = new Map<string, StoredConversationState>();

  constructor(
    @Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig,
  ) {}

  get(conversationId: string): StoredConversationState | null {
    this.purgeExpired();
    return this.conversations.get(conversationId) ?? null;
  }

  getOrCreate(
    conversationId: string,
    clientId?: string | null,
  ): StoredConversationState {
    this.purgeExpired();
    const existing = this.conversations.get(conversationId);
    if (existing) {
      this.assertClient(existing, clientId);
      return existing;
    }
    const state: StoredConversationState = {
      id: conversationId,
      clientId: clientId ?? null,
      messages: [],
      summary: null,
      summaryPending: [],
      lastDocSignature: null,
      updatedAt: Date.now(),
    };
    this.conversations.set(conversationId, state);
    this.enforceConversationLimit();
    return state;
  }

  append(
    conversationId: string,
    message: StoredAssistantChatMessage,
    clientId?: string | null,
  ): StoredConversationState {
    const conversation = this.getOrCreate(conversationId, clientId);
    conversation.messages.push(message);
    conversation.updatedAt = Date.now();
    this.trimMessages(conversation);
    this.enforceConversationLimit();
    return conversation;
  }

  clear(conversationId: string): void {
    this.purgeExpired();
    this.conversations.delete(conversationId);
  }

  updateSummary(conversationId: string, summary: string | null): void {
    const conversation = this.get(conversationId);
    if (!conversation) {
      return;
    }
    conversation.summary = summary?.trim() ? summary.trim() : null;
    conversation.updatedAt = Date.now();
  }

  updateLastDocSignature(
    conversationId: string,
    signature: string | null,
  ): void {
    const conversation = this.get(conversationId);
    if (!conversation) {
      return;
    }
    conversation.lastDocSignature = signature?.trim() ? signature.trim() : null;
    conversation.updatedAt = Date.now();
  }

  private trimMessages(conversation: StoredConversationState): void {
    const limit = Math.max(1, this.config.maxContextMessages);
    if (conversation.messages.length <= limit) {
      return;
    }
    const removeCount = conversation.messages.length - limit;
    const removed = conversation.messages.splice(0, removeCount);

    if (this.config.enableSummary && removed.length) {
      conversation.summaryPending.push(...removed);
      const maxPending = Math.max(this.config.summaryBatchMessages * 10, 50);
      if (conversation.summaryPending.length > maxPending) {
        conversation.summaryPending.splice(
          0,
          conversation.summaryPending.length - maxPending,
        );
      }
    }
  }

  private enforceConversationLimit(): void {
    const limit = Math.max(1, this.config.maxConversations);
    if (this.conversations.size <= limit) {
      return;
    }
    const entries = Array.from(this.conversations.entries());
    entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const overflow = this.conversations.size - limit;
    for (let i = 0; i < overflow; i += 1) {
      this.conversations.delete(entries[i]?.[0] ?? '');
    }
  }

  private purgeExpired(): void {
    const ttl = this.config.conversationTtlMs;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return;
    }
    const now = Date.now();
    for (const [id, conversation] of this.conversations.entries()) {
      if (now - conversation.updatedAt > ttl) {
        this.conversations.delete(id);
      }
    }
  }

  private assertClient(
    conversation: StoredConversationState,
    clientId?: string | null,
  ): void {
    const normalized = clientId?.trim() || null;
    if (!normalized) {
      return;
    }
    if (!conversation.clientId) {
      conversation.clientId = normalized;
      return;
    }
    if (conversation.clientId !== normalized) {
      throw new Error('conversationId belongs to another client');
    }
  }
}
