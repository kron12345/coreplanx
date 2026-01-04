import { Injectable, inject } from '@angular/core';
import { API_CONFIG } from '../../core/config/api-config';
import { ClientIdentityService } from '../../core/services/client-identity.service';
import { PlanningDebugService, type PlanningDebugLogLevel } from './planning-debug.service';

type BackendDebugEvent = {
  id?: string;
  timestamp?: string;
  level?: PlanningDebugLogLevel | 'debug';
  topic?: string;
  message?: string;
  context?: Record<string, unknown>;
  stageId?: string;
  userId?: string;
  connectionId?: string;
};

@Injectable({ providedIn: 'root' })
export class PlanningDebugStreamService {
  private readonly config = inject(API_CONFIG);
  private readonly identity = inject(ClientIdentityService);
  private readonly debug = inject(PlanningDebugService);
  private eventSource: EventSource | null = null;
  private readonly defaultTopics = ['planning', 'solver', 'assistant', 'db', 'rules'];

  connect(options?: {
    topics?: string[];
    includeHistory?: boolean;
    historySize?: number;
    levels?: PlanningDebugLogLevel[];
    token?: string;
  }): void {
    this.disconnect();
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }
    const base = this.config.baseUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      userId: this.identity.userId(),
      connectionId: this.identity.connectionId(),
      topics: (options?.topics ?? this.defaultTopics).join(','),
    });
    if (options?.includeHistory === false) {
      params.set('history', '0');
    } else if (options?.historySize && options.historySize > 0) {
      params.set('history', options.historySize.toString());
    }
    if (options?.levels?.length) {
      params.set('levels', options.levels.join(','));
    }
    const token = options?.token?.trim() || this.config.debugStreamToken?.trim();
    if (token) {
      params.set('token', token);
    }
    const url = `${base}/debug/stream?${params.toString()}`;
    const eventSource = new EventSource(url, { withCredentials: true });
    this.eventSource = eventSource;

    const handleOpen = () => {
      this.debug.reportBackendStreamConnected({
        userId: this.identity.userId(),
        connectionId: this.identity.connectionId(),
      });
    };

    const handleMessage = (event: MessageEvent<string>) => {
      if (!event.data) {
        return;
      }
      try {
        const payload = JSON.parse(event.data) as BackendDebugEvent;
        if (!payload.message || !payload.level) {
          return;
        }
        this.debug.reportBackendStreamEvent();
        this.debug.log(
          this.normalizeLevel(payload.level),
          'backend',
          payload.message,
          {
            stageId: this.normalizeStageId(payload.stageId),
            context: payload.context,
            source: 'backend',
            topic: payload.topic,
            timestamp: payload.timestamp,
            id: payload.id,
          },
        );
      } catch (error) {
        this.debug.reportBackendStreamError('Backend-Stream Payload konnte nicht gelesen werden', {
          message: (error as Error)?.message ?? 'parse-error',
        });
        console.warn('[PlanningDebugStreamService] Failed to parse event payload', error);
      }
    };

    const handleError = (error: Event) => {
      const state = eventSource.readyState;
      const message =
        state === EventSource.CLOSED ? 'Backend-Stream geschlossen' : 'Backend-Stream unterbrochen';
      this.debug.reportBackendStreamError(message, { readyState: state });
      console.warn('[PlanningDebugStreamService] Backend stream error', error);
    };

    const handleHeartbeat = (event: MessageEvent<string>) => {
      if (!event.data) {
        this.debug.reportBackendStreamEvent();
        return;
      }
      try {
        JSON.parse(event.data);
      } catch {
        // ignore parsing issues for heartbeat payload
      }
      this.debug.reportBackendStreamEvent();
    };

    eventSource.addEventListener('open', handleOpen as EventListener);
    eventSource.addEventListener('message', handleMessage as EventListener);
    eventSource.addEventListener('error', handleError as EventListener);
    eventSource.addEventListener('heartbeat', handleHeartbeat as EventListener);
  }

  disconnect(): void {
    if (!this.eventSource) {
      return;
    }
    this.eventSource.close();
    this.eventSource = null;
    this.debug.reportBackendStreamDisconnected();
  }

  private normalizeLevel(raw: BackendDebugEvent['level']): PlanningDebugLogLevel {
    if (raw === 'debug') {
      return 'info';
    }
    if (raw === 'info' || raw === 'warn' || raw === 'error') {
      return raw;
    }
    return 'info';
  }

  private normalizeStageId(raw?: string): 'base' | 'operations' | undefined {
    if (raw === 'base' || raw === 'operations') {
      return raw;
    }
    return undefined;
  }
}
