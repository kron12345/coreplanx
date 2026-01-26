import { Controller, Sse, Query, UnauthorizedException } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { EMPTY, Observable, interval, merge, map } from 'rxjs';
import { DebugStreamService } from './debug-stream.service';
import type {
  DebugLogLevel,
  DebugLogTopic,
  DebugStreamOptions,
} from './debug-stream.types';

type DebugStreamQuery = {
  userId?: string;
  connectionId?: string;
  topics?: string;
  levels?: string;
  history?: string;
  historySize?: string;
  token?: string;
};

const VALID_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const VALID_TOPICS = [
  'planning',
  'solver',
  'assistant',
  'orders',
  'db',
  'rules',
  'system',
] as const;

@Controller('debug')
export class DebugStreamController {
  constructor(private readonly debugStream: DebugStreamService) {}

  @Sse('stream')
  stream(@Query() query: DebugStreamQuery): Observable<MessageEvent> {
    const token = query.token?.trim() || undefined;
    if (!this.debugStream.isAuthorized(token)) {
      throw new UnauthorizedException('Invalid debug stream token.');
    }

    const options: DebugStreamOptions = {
      userId: query.userId?.trim() || undefined,
      connectionId: query.connectionId?.trim() || undefined,
      topics: this.parseList(query.topics, VALID_TOPICS),
      levels: this.parseList(query.levels, VALID_LEVELS),
    };

    const includeHistory = this.parseBoolean(query.history);
    if (includeHistory === false) {
      options.includeHistory = false;
    }
    const historySize = this.parseNumber(query.historySize);
    if (historySize && historySize > 0) {
      options.historySize = historySize;
    }

    const stream = this.debugStream.isEnabled()
      ? this.debugStream.stream(options)
      : EMPTY;
    const events$ = stream.pipe(
      map(
        (entry): MessageEvent => ({
          id: entry.id,
          data: entry,
        }),
      ),
    );

    const heartbeatMs = this.debugStream.getHeartbeatMs();
    const heartbeat$ =
      heartbeatMs > 0
        ? interval(heartbeatMs).pipe(
            map(
              (): MessageEvent => ({
                type: 'heartbeat',
                data: '',
              }),
            ),
          )
        : EMPTY;

    return merge(events$, heartbeat$);
  }

  private parseList<T extends string>(
    value: string | undefined,
    allowed: readonly T[],
  ): T[] | undefined {
    if (!value) {
      return undefined;
    }
    const allowedSet = new Set(allowed);
    const cleaned = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .filter((entry) => allowedSet.has(entry as T)) as T[];
    return cleaned.length ? Array.from(new Set(cleaned)) : undefined;
  }

  private parseBoolean(value?: string): boolean | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === '0' || normalized === 'false' || normalized === 'no') {
      return false;
    }
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
      return true;
    }
    return undefined;
  }

  private parseNumber(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return parsed;
  }
}
