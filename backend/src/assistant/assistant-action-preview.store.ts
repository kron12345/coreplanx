import { Inject, Injectable } from '@nestjs/common';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import type { AssistantActionChangeDto } from './assistant.dto';
import type { AssistantActionCommitTask, AssistantActionRefreshHint } from './assistant-action.types';
import type { ResourceSnapshot } from '../planning/planning.types';

export interface StoredAssistantActionPreview {
  id: string;
  clientId: string | null;
  role: string | null;
  summary: string;
  changes: AssistantActionChangeDto[];
  snapshot: ResourceSnapshot;
  baseHash: string;
  commitTasks?: AssistantActionCommitTask[];
  refreshHints?: AssistantActionRefreshHint[];
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class AssistantActionPreviewStore {
  private readonly previews = new Map<string, StoredAssistantActionPreview>();

  constructor(@Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig) {}

  create(preview: StoredAssistantActionPreview): StoredAssistantActionPreview {
    this.purgeExpired();
    this.previews.set(preview.id, preview);
    return preview;
  }

  get(
    previewId: string,
    clientId?: string | null,
    role?: string | null,
  ): StoredAssistantActionPreview | null {
    this.purgeExpired();
    const preview = this.previews.get(previewId);
    if (!preview) {
      return null;
    }
    this.assertClient(preview, clientId);
    this.assertRole(preview, role);
    return preview;
  }

  delete(previewId: string): void {
    this.previews.delete(previewId);
  }

  private purgeExpired(): void {
    const ttl = this.config.actionPreviewTtlMs;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return;
    }
    const now = Date.now();
    for (const [id, preview] of this.previews.entries()) {
      if (now - preview.updatedAt > ttl) {
        this.previews.delete(id);
      }
    }
  }

  private assertClient(
    preview: StoredAssistantActionPreview,
    clientId?: string | null,
  ): void {
    const normalized = clientId?.trim() || null;
    if (!normalized) {
      return;
    }
    if (!preview.clientId) {
      preview.clientId = normalized;
      preview.updatedAt = Date.now();
      return;
    }
    if (preview.clientId !== normalized) {
      throw new Error('previewId belongs to another client');
    }
  }

  private assertRole(preview: StoredAssistantActionPreview, role?: string | null): void {
    const normalized = role?.trim() || null;
    if (!normalized) {
      return;
    }
    if (!preview.role) {
      preview.role = normalized;
      preview.updatedAt = Date.now();
      return;
    }
    if (preview.role !== normalized) {
      throw new Error('previewId belongs to another role');
    }
  }
}
