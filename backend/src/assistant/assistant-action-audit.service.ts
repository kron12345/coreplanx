import { Inject, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import path from 'path';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';
import type { AssistantActionChangeDto } from './assistant.dto';
import type { ResourceSnapshot } from '../planning/planning.types';

type AuditEvent = 'preview' | 'commit' | 'conflict';

interface AssistantActionAuditEntry {
  timestamp: string;
  event: AuditEvent;
  previewId?: string;
  clientId?: string | null;
  role?: string | null;
  summary?: string;
  changes?: AssistantActionChangeDto[];
  diffs?: Array<AssistantActionChangeDto & { before?: unknown; after?: unknown }>;
  payload?: Record<string, unknown>;
  reason?: string;
}

@Injectable()
export class AssistantActionAuditService {
  private readonly logger = new Logger(AssistantActionAuditService.name);
  private initialized = false;
  private pending = Promise.resolve();

  constructor(@Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig) {}

  recordPreview(options: {
    previewId?: string;
    clientId: string | null;
    role: string | null;
    summary: string;
    changes: AssistantActionChangeDto[];
    payload: Record<string, unknown>;
    baseSnapshot: ResourceSnapshot;
    nextSnapshot: ResourceSnapshot;
  }): void {
    if (!this.config.actionAuditEnabled) {
      return;
    }
    const entry: AssistantActionAuditEntry = {
      timestamp: new Date().toISOString(),
      event: 'preview',
      previewId: options.previewId,
      clientId: options.clientId,
      role: options.role,
      summary: options.summary,
      changes: options.changes,
      diffs: this.buildDiffs(options.baseSnapshot, options.nextSnapshot, options.changes),
      payload: options.payload,
    };
    this.enqueue(entry);
  }

  recordCommit(options: {
    previewId: string;
    clientId: string | null;
    role: string | null;
    summary: string;
    changes: AssistantActionChangeDto[];
    baseSnapshot: ResourceSnapshot;
    nextSnapshot: ResourceSnapshot;
  }): void {
    if (!this.config.actionAuditEnabled) {
      return;
    }
    const entry: AssistantActionAuditEntry = {
      timestamp: new Date().toISOString(),
      event: 'commit',
      previewId: options.previewId,
      clientId: options.clientId,
      role: options.role,
      summary: options.summary,
      changes: options.changes,
      diffs: this.buildDiffs(options.baseSnapshot, options.nextSnapshot, options.changes),
    };
    this.enqueue(entry);
  }

  recordConflict(options: {
    previewId?: string;
    clientId: string | null;
    role: string | null;
    reason: string;
  }): void {
    if (!this.config.actionAuditEnabled) {
      return;
    }
    const entry: AssistantActionAuditEntry = {
      timestamp: new Date().toISOString(),
      event: 'conflict',
      previewId: options.previewId,
      clientId: options.clientId,
      role: options.role,
      reason: options.reason,
    };
    this.enqueue(entry);
  }

  private enqueue(entry: AssistantActionAuditEntry): void {
    this.pending = this.pending
      .then(() => this.append(entry))
      .catch((error) => {
        this.logger.warn(
          `Assistant audit log write failed: ${(error as Error).message ?? String(error)}`,
        );
      });
  }

  private async append(entry: AssistantActionAuditEntry): Promise<void> {
    const target = this.config.actionAuditLogPath;
    await this.ensureDirectory(target);
    await fs.appendFile(target, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private async ensureDirectory(filePath: string): Promise<void> {
    if (this.initialized) {
      return;
    }
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    this.initialized = true;
  }

  private buildDiffs(
    baseSnapshot: ResourceSnapshot,
    nextSnapshot: ResourceSnapshot,
    changes: AssistantActionChangeDto[],
  ): Array<AssistantActionChangeDto & { before?: unknown; after?: unknown }> {
    return changes.map((change) => ({
      ...change,
      before: this.clone(this.findEntity(baseSnapshot, change.entityType, change.id)),
      after: this.clone(this.findEntity(nextSnapshot, change.entityType, change.id)),
    }));
  }

  private findEntity(
    snapshot: ResourceSnapshot,
    entityType: string,
    id: string,
  ): unknown {
    switch (entityType) {
      case 'personnelServicePool':
        return snapshot.personnelServicePools.find((entry) => entry.id === id) ?? null;
      case 'vehicleServicePool':
        return snapshot.vehicleServicePools.find((entry) => entry.id === id) ?? null;
      case 'personnelPool':
        return snapshot.personnelPools.find((entry) => entry.id === id) ?? null;
      case 'vehiclePool':
        return snapshot.vehiclePools.find((entry) => entry.id === id) ?? null;
      case 'personnelService':
        return snapshot.personnelServices.find((entry) => entry.id === id) ?? null;
      case 'vehicleService':
        return snapshot.vehicleServices.find((entry) => entry.id === id) ?? null;
      case 'personnel':
        return snapshot.personnel.find((entry) => entry.id === id) ?? null;
      case 'vehicle':
        return snapshot.vehicles.find((entry) => entry.id === id) ?? null;
      default:
        return null;
    }
  }

  private clone(value: unknown): unknown {
    if (value === undefined) {
      return undefined;
    }
    return value === null ? null : JSON.parse(JSON.stringify(value));
  }
}
