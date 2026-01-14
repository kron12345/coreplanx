import { Inject, Injectable } from '@nestjs/common';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import type { AssistantActionClarificationOptionDto } from './assistant.dto';
import type { ResourceSnapshot } from '../planning/planning.types';

export type AssistantActionClarificationApply =
  | { mode: 'target'; path: Array<string | number> }
  | { mode: 'value'; path: Array<string | number> };

export interface StoredAssistantActionClarification {
  id: string;
  clientId: string | null;
  role: string | null;
  payload: Record<string, unknown>;
  snapshot: ResourceSnapshot;
  baseHash: string;
  apply: AssistantActionClarificationApply;
  options: AssistantActionClarificationOptionDto[];
  input?: {
    label?: string;
    placeholder?: string;
    hint?: string;
    minLength?: number;
    maxLength?: number;
  };
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class AssistantActionClarificationStore {
  private readonly clarifications = new Map<
    string,
    StoredAssistantActionClarification
  >();

  constructor(
    @Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig,
  ) {}

  create(
    clarification: StoredAssistantActionClarification,
  ): StoredAssistantActionClarification {
    this.purgeExpired();
    this.clarifications.set(clarification.id, clarification);
    return clarification;
  }

  get(
    clarificationId: string,
    clientId?: string | null,
    role?: string | null,
  ): StoredAssistantActionClarification | null {
    this.purgeExpired();
    const clarification = this.clarifications.get(clarificationId);
    if (!clarification) {
      return null;
    }
    this.assertClient(clarification, clientId);
    this.assertRole(clarification, role);
    return clarification;
  }

  delete(clarificationId: string): void {
    this.clarifications.delete(clarificationId);
  }

  private purgeExpired(): void {
    const ttl = this.config.actionPreviewTtlMs;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return;
    }
    const now = Date.now();
    for (const [id, clarification] of this.clarifications.entries()) {
      if (now - clarification.updatedAt > ttl) {
        this.clarifications.delete(id);
      }
    }
  }

  private assertClient(
    clarification: StoredAssistantActionClarification,
    clientId?: string | null,
  ): void {
    const normalized = clientId?.trim() || null;
    if (!normalized) {
      return;
    }
    if (!clarification.clientId) {
      clarification.clientId = normalized;
      clarification.updatedAt = Date.now();
      return;
    }
    if (clarification.clientId !== normalized) {
      throw new Error('clarificationId belongs to another client');
    }
  }

  private assertRole(
    clarification: StoredAssistantActionClarification,
    role?: string | null,
  ): void {
    const normalized = role?.trim() || null;
    if (!normalized) {
      return;
    }
    if (!clarification.role) {
      clarification.role = normalized;
      clarification.updatedAt = Date.now();
      return;
    }
    if (clarification.role !== normalized) {
      throw new Error('clarificationId belongs to another role');
    }
  }
}
