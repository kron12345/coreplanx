import { Injectable, computed, signal } from '@angular/core';
import { PlanningStageId } from './planning-stage.model';

export type PlanningDebugLogLevel = 'info' | 'warn' | 'error';
export type PlanningDebugLogScope = 'api' | 'sse' | 'viewport' | 'system' | 'mutation' | 'backend';
export type PlanningDebugLogSource = 'frontend' | 'backend';

export interface PlanningDebugLogEntry {
  id: string;
  timestamp: string;
  level: PlanningDebugLogLevel;
  scope: PlanningDebugLogScope;
  message: string;
  source?: PlanningDebugLogSource;
  topic?: string;
  stageId?: PlanningStageId;
  context?: Record<string, unknown>;
}

export interface PlanningApiStatus {
  state: 'idle' | 'ok' | 'error';
  message?: string;
  lastSuccessAt?: string;
  lastErrorAt?: string;
}

export interface PlanningSseStatus {
  state: 'idle' | 'connected' | 'error';
  message?: string;
  lastConnectedAt?: string;
  lastEventAt?: string;
  lastErrorAt?: string;
}

export interface PlanningBackendStreamStatus {
  state: 'idle' | 'connected' | 'error';
  message?: string;
  lastConnectedAt?: string;
  lastEventAt?: string;
  lastErrorAt?: string;
}

export interface PlanningViewportStatus {
  windowStart?: string;
  windowEnd?: string;
  resourceCount: number;
  lastSubscriptionAt?: string;
  lastLoadAt?: string;
  lastActivityCount?: number;
  lastErrorAt?: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class PlanningDebugService {
  private readonly entriesSignal = signal<PlanningDebugLogEntry[]>([]);
  private readonly apiStatusSignal = signal<PlanningApiStatus>({ state: 'idle' });
  private readonly sseStatusSignal = signal<Record<PlanningStageId, PlanningSseStatus>>({
    base: { state: 'idle' },
    operations: { state: 'idle' },
  });
  private readonly backendStreamStatusSignal = signal<PlanningBackendStreamStatus>({ state: 'idle' });
  private readonly viewportStatusSignal = signal<Record<PlanningStageId, PlanningViewportStatus>>({
    base: { resourceCount: 0 },
    operations: { resourceCount: 0 },
  });
  private readonly pausedSignal = signal(false);
  private readonly pendingCountSignal = signal(0);
  private readonly maxEntries = 500;
  private sequence = 0;
  private pendingEntries: PlanningDebugLogEntry[] = [];

  readonly entries = computed(() => this.entriesSignal());
  readonly apiStatus = computed(() => this.apiStatusSignal());
  readonly sseStatus = computed(() => this.sseStatusSignal());
  readonly viewportStatus = computed(() => this.viewportStatusSignal());
  readonly backendStreamStatus = computed(() => this.backendStreamStatusSignal());
  readonly paused = computed(() => this.pausedSignal());
  readonly pendingCount = computed(() => this.pendingCountSignal());

  log(
    level: PlanningDebugLogLevel,
    scope: PlanningDebugLogScope,
    message: string,
    options?: {
      stageId?: PlanningStageId;
      context?: Record<string, unknown>;
      source?: PlanningDebugLogSource;
      topic?: string;
      timestamp?: string;
      id?: string;
    },
  ): void {
    const entry: PlanningDebugLogEntry = {
      id: options?.id ?? `log-${++this.sequence}`,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      level,
      scope,
      message,
      source: options?.source ?? 'frontend',
    };
    if (options?.stageId) {
      entry.stageId = options.stageId;
    }
    if (options?.context && Object.keys(options.context).length > 0) {
      entry.context = options.context;
    }
    if (options?.topic) {
      entry.topic = options.topic;
    }
    if (this.pausedSignal()) {
      this.pendingEntries.push(entry);
      if (this.pendingEntries.length > this.maxEntries) {
        this.pendingEntries.splice(0, this.pendingEntries.length - this.maxEntries);
      }
      this.pendingCountSignal.set(this.pendingEntries.length);
      return;
    }
    const next = [...this.entriesSignal(), entry];
    if (next.length > this.maxEntries) {
      next.splice(0, next.length - this.maxEntries);
    }
    this.entriesSignal.set(next);
  }

  clear(): void {
    this.entriesSignal.set([]);
    this.pendingEntries = [];
    this.pendingCountSignal.set(0);
  }

  exportEntries(options?: { includePending?: boolean }): PlanningDebugLogEntry[] {
    if (options?.includePending) {
      return [...this.entriesSignal(), ...this.pendingEntries];
    }
    return this.entriesSignal();
  }

  pause(): void {
    this.pausedSignal.set(true);
  }

  resume(): void {
    this.pausedSignal.set(false);
    if (!this.pendingEntries.length) {
      return;
    }
    const next = [...this.entriesSignal(), ...this.pendingEntries];
    if (next.length > this.maxEntries) {
      next.splice(0, next.length - this.maxEntries);
    }
    this.entriesSignal.set(next);
    this.pendingEntries = [];
    this.pendingCountSignal.set(0);
  }

  reportApiSuccess(message?: string, context?: Record<string, unknown>): void {
    const successMessage = message ?? 'OK';
    const stageId = this.readStageId(context);
    this.apiStatusSignal.update((current) => ({
      ...current,
      state: 'ok',
      message: successMessage,
      lastSuccessAt: new Date().toISOString(),
    }));
    if (message) {
      this.log('info', 'api', message, { stageId, context });
    }
  }

  reportApiError(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const stageId = this.readStageId(context);
    this.apiStatusSignal.update((current) => ({
      ...current,
      state: 'error',
      message,
      lastErrorAt: new Date().toISOString(),
    }));
    this.log('error', 'api', message, {
      stageId,
      context: this.combineContext(context, this.serializeError(error)),
    });
  }

  reportSseConnected(stageId: PlanningStageId, context?: Record<string, unknown>): void {
    this.sseStatusSignal.update((current) => ({
      ...current,
      [stageId]: {
        ...current[stageId],
        state: 'connected',
        message: 'Verbunden',
        lastConnectedAt: new Date().toISOString(),
      },
    }));
    this.log('info', 'sse', 'SSE verbunden', { stageId, context });
  }

  reportSseEvent(stageId: PlanningStageId): void {
    this.sseStatusSignal.update((current) => ({
      ...current,
      [stageId]: {
        ...current[stageId],
        state:
          current[stageId].state === 'error' || current[stageId].state === 'idle'
            ? 'connected'
            : current[stageId].state,
        lastEventAt: new Date().toISOString(),
      },
    }));
  }

  reportSseError(stageId: PlanningStageId, message: string, error?: unknown): void {
    this.sseStatusSignal.update((current) => ({
      ...current,
      [stageId]: {
        ...current[stageId],
        state: 'error',
        message,
        lastErrorAt: new Date().toISOString(),
      },
    }));
    this.log('warn', 'sse', message, {
      stageId,
      context: this.serializeError(error),
    });
  }

  reportBackendStreamConnected(context?: Record<string, unknown>): void {
    this.backendStreamStatusSignal.set({
      state: 'connected',
      message: 'Verbunden',
      lastConnectedAt: new Date().toISOString(),
      lastEventAt: new Date().toISOString(),
    });
    if (context) {
      this.log('info', 'system', 'Backend-Stream verbunden', { context });
    }
  }

  reportBackendStreamEvent(): void {
    this.backendStreamStatusSignal.update((current) => ({
      ...current,
      state: current.state === 'error' ? 'connected' : current.state,
      lastEventAt: new Date().toISOString(),
    }));
  }

  reportBackendStreamError(message: string, error?: unknown): void {
    this.backendStreamStatusSignal.set({
      state: 'error',
      message,
      lastErrorAt: new Date().toISOString(),
    });
    this.log('warn', 'system', message, { context: this.serializeError(error) });
  }

  reportBackendStreamDisconnected(): void {
    this.backendStreamStatusSignal.set({ state: 'idle' });
  }

  reportViewportSubscription(
    stageId: PlanningStageId,
    window: { start: Date; end: Date },
    resourceCount: number,
  ): void {
    this.viewportStatusSignal.update((current) => ({
      ...current,
      [stageId]: {
        ...current[stageId],
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        resourceCount,
        lastSubscriptionAt: new Date().toISOString(),
      },
    }));
    this.reportApiSuccess('Viewport abonniert', {
      stageId,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      resourceCount,
    });
  }

  reportViewportLoad(
    stageId: PlanningStageId,
    window: { start: Date; end: Date },
    activityCount: number,
  ): void {
    this.viewportStatusSignal.update((current) => ({
      ...current,
      [stageId]: {
        ...current[stageId],
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        lastLoadAt: new Date().toISOString(),
        lastActivityCount: activityCount,
      },
    }));
    this.reportApiSuccess('Aktivitaeten geladen', {
      stageId,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      activityCount,
    });
  }

  reportViewportError(stageId: PlanningStageId, message: string, error?: unknown): void {
    this.viewportStatusSignal.update((current) => ({
      ...current,
      [stageId]: {
        ...current[stageId],
        lastErrorAt: new Date().toISOString(),
        message,
      },
    }));
    this.apiStatusSignal.update((current) => ({
      ...current,
      state: 'error',
      message,
      lastErrorAt: new Date().toISOString(),
    }));
    this.log('error', 'viewport', message, {
      stageId,
      context: this.serializeError(error),
    });
  }

  private serializeError(error?: unknown): Record<string, unknown> | undefined {
    if (!error) {
      return undefined;
    }
    if (typeof error === 'string') {
      return { message: error };
    }
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    if (typeof error === 'object' && error !== null) {
      const err = error as {
        status?: number;
        statusText?: string;
        message?: string;
        error?: unknown;
        readyState?: number;
      };
      const payload: Record<string, unknown> = {};
      if (typeof err['status'] !== 'undefined') {
        payload['status'] = err['status'];
      }
      if (err['statusText']) {
        payload['statusText'] = err['statusText'];
      }
      if (err['message']) {
        payload['message'] = err['message'];
      }
      if (typeof err['error'] !== 'undefined') {
        payload['error'] = err['error'];
      }
      if (typeof err['readyState'] !== 'undefined') {
        payload['readyState'] = err['readyState'];
      }
      return payload;
    }
    return { message: 'Unbekannter Fehler' };
  }

  private combineContext(
    context?: Record<string, unknown>,
    errorContext?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context && !errorContext) {
      return undefined;
    }
    return {
      ...(context ?? {}),
      ...(errorContext ? { error: errorContext } : {}),
    };
  }

  private readStageId(context?: Record<string, unknown>): PlanningStageId | undefined {
    const stageId = context?.['stageId'];
    if (stageId === 'base' || stageId === 'operations') {
      return stageId;
    }
    return undefined;
  }
}
