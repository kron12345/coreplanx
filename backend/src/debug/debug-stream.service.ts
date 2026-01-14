import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type {
  DebugLogEntry,
  DebugLogLevel,
  DebugLogTopic,
  DebugStreamOptions,
} from './debug-stream.types';

const LEVEL_ORDER: Record<DebugLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

@Injectable()
export class DebugStreamService {
  private readonly logger = new Logger(DebugStreamService.name);
  private readonly enabled = this.toBoolean(
    process.env.DEBUG_STREAM_ENABLED,
    false,
  );
  private readonly minLevel = this.normalizeLevel(
    process.env.DEBUG_STREAM_LEVEL ?? 'info',
  );
  private readonly maxEntries = this.toNumber(
    process.env.DEBUG_STREAM_BUFFER_SIZE,
    200,
  );
  private readonly accessToken = (process.env.DEBUG_STREAM_TOKEN ?? '').trim();
  private readonly heartbeatMs = this.toNumber(
    process.env.DEBUG_STREAM_HEARTBEAT_MS,
    15000,
  );
  private readonly maxPayloadBytes = this.toNumber(
    process.env.DEBUG_STREAM_MAX_PAYLOAD_BYTES,
    8000,
  );
  private readonly maxContextBytes = this.toNumber(
    process.env.DEBUG_STREAM_MAX_CONTEXT_BYTES,
    6000,
  );
  private readonly maxMessageLength = this.toNumber(
    process.env.DEBUG_STREAM_MAX_MESSAGE_LENGTH,
    400,
  );
  private readonly httpEnabled = this.toBoolean(
    process.env.DEBUG_STREAM_HTTP_ENABLED,
    false,
  );
  private readonly httpLevel = this.normalizeLevel(
    process.env.DEBUG_STREAM_HTTP_LEVEL ?? 'info',
  );
  private readonly subject = new Subject<DebugLogEntry>();
  private readonly buffer: DebugLogEntry[] = [];
  private sequence = 0;

  isEnabled(): boolean {
    return this.enabled;
  }

  isAuthorized(token?: string): boolean {
    if (!this.accessToken) {
      return true;
    }
    return token?.trim() === this.accessToken;
  }

  getHeartbeatMs(): number {
    if (!this.enabled) {
      return 0;
    }
    if (this.heartbeatMs <= 0) {
      return 0;
    }
    return Math.max(this.heartbeatMs, 1000);
  }

  isHttpLoggingEnabled(): boolean {
    return this.enabled && this.httpEnabled;
  }

  getHttpLogLevel(): DebugLogLevel {
    return this.httpLevel;
  }

  log(
    level: DebugLogLevel,
    topic: DebugLogTopic,
    message: string,
    context?: Record<string, unknown>,
    meta?: { userId?: string; connectionId?: string; stageId?: string },
  ): void {
    if (!this.enabled) {
      return;
    }
    if (!this.levelAllowed(level)) {
      return;
    }
    const sanitizedMessage = this.truncateMessage(message);
    const sanitizedContext = this.sanitizeContext(context);
    const entry: DebugLogEntry = {
      id: `dbg-${++this.sequence}`,
      timestamp: new Date().toISOString(),
      level,
      topic,
      message: sanitizedMessage,
      context: sanitizedContext,
      userId: meta?.userId,
      connectionId: meta?.connectionId,
      stageId: meta?.stageId,
    };
    const limited = this.enforcePayloadLimit(entry);
    this.buffer.push(limited);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
    this.subject.next(limited);
  }

  stream(options: DebugStreamOptions): Observable<DebugLogEntry> {
    if (!this.enabled) {
      return new Observable<DebugLogEntry>((subscriber) =>
        subscriber.complete(),
      );
    }
    const levels = options.levels?.length ? new Set(options.levels) : null;
    const topics = options.topics?.length ? new Set(options.topics) : null;
    const userId = options.userId?.trim() || null;
    const connectionId = options.connectionId?.trim() || null;
    const includeHistory = options.includeHistory !== false;
    const historySize =
      options.historySize && options.historySize > 0
        ? options.historySize
        : null;

    const matches = (entry: DebugLogEntry) => {
      if (levels && !levels.has(entry.level)) {
        return false;
      }
      if (topics && !topics.has(entry.topic)) {
        return false;
      }
      if (userId && entry.userId && entry.userId !== userId) {
        return false;
      }
      if (
        connectionId &&
        entry.connectionId &&
        entry.connectionId !== connectionId
      ) {
        return false;
      }
      return true;
    };

    return new Observable<DebugLogEntry>((subscriber) => {
      if (includeHistory && this.buffer.length) {
        const history = historySize
          ? this.buffer.slice(-historySize)
          : this.buffer;
        history.filter(matches).forEach((entry) => subscriber.next(entry));
      }

      const subscription = this.subject.subscribe({
        next: (entry) => {
          if (matches(entry)) {
            subscriber.next(entry);
          }
        },
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      return () => subscription.unsubscribe();
    });
  }

  private levelAllowed(level: DebugLogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.minLevel];
  }

  private normalizeLevel(raw: string): DebugLogLevel {
    const normalized = raw.trim().toLowerCase();
    if (
      normalized === 'debug' ||
      normalized === 'info' ||
      normalized === 'warn' ||
      normalized === 'error'
    ) {
      return normalized as DebugLogLevel;
    }
    this.logger.warn(
      `Unbekanntes DEBUG_STREAM_LEVEL "${raw}", fallback auf "info".`,
    );
    return 'info';
  }

  private toBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
      return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
    return fallback;
  }

  private toNumber(value: string | undefined, fallback: number): number {
    if (!value) {
      return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return fallback;
  }

  private truncateMessage(
    message: string,
    limit = this.maxMessageLength,
  ): string {
    if (limit <= 0 || message.length <= limit) {
      return message;
    }
    return `${message.slice(0, limit)}...`;
  }

  private sanitizeContext(
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context || Object.keys(context).length === 0) {
      return undefined;
    }
    try {
      const serialized = JSON.stringify(context);
      if (
        this.maxContextBytes > 0 &&
        serialized.length > this.maxContextBytes
      ) {
        return { truncated: true, bytes: serialized.length };
      }
      return context;
    } catch {
      return { error: 'context not serializable' };
    }
  }

  private enforcePayloadLimit(entry: DebugLogEntry): DebugLogEntry {
    if (this.maxPayloadBytes <= 0) {
      return entry;
    }
    const initialBytes = this.measurePayloadBytes(entry);
    if (initialBytes <= this.maxPayloadBytes) {
      return entry;
    }
    const adjusted: DebugLogEntry = { ...entry };
    if (adjusted.context) {
      adjusted.context = { truncated: true, bytes: initialBytes };
    }
    const adjustedBytes = this.measurePayloadBytes(adjusted);
    if (adjustedBytes <= this.maxPayloadBytes) {
      return adjusted;
    }
    const messageLimit = Math.max(
      32,
      Math.min(adjusted.message.length, this.maxPayloadBytes - 200),
    );
    adjusted.message = this.truncateMessage(adjusted.message, messageLimit);
    return adjusted;
  }

  private measurePayloadBytes(entry: DebugLogEntry): number {
    try {
      return Buffer.byteLength(JSON.stringify(entry), 'utf8');
    } catch {
      return entry.message.length;
    }
  }
}
