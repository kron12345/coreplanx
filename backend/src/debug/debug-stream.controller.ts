import { Controller, MessageEvent, NotFoundException, Query, Sse } from '@nestjs/common';
import { Observable, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { DebugStreamService } from './debug-stream.service';
import type { DebugLogLevel, DebugLogTopic } from './debug-stream.types';

@Controller('debug')
export class DebugStreamController {
  constructor(private readonly debugStream: DebugStreamService) {}

  @Sse('stream')
  stream(
    @Query('userId') userId?: string,
    @Query('connectionId') connectionId?: string,
    @Query('levels') levels?: string,
    @Query('topics') topics?: string,
    @Query('history') history?: string,
    @Query('token') token?: string,
  ): Observable<MessageEvent> {
    if (!this.debugStream.isEnabled() || !this.debugStream.isAuthorized(token)) {
      throw new NotFoundException();
    }
    const parsedLevels = this.parseList<DebugLogLevel>(levels, (entry) =>
      ['debug', 'info', 'warn', 'error'].includes(entry),
    );
    const parsedTopics = this.parseList<DebugLogTopic>(topics, (entry) =>
      ['planning', 'solver', 'assistant', 'db', 'rules', 'system'].includes(entry),
    );
    const { includeHistory, historySize } = this.parseHistory(history);

    const stream$ = this.debugStream
      .stream({
        userId: userId?.trim() || undefined,
        connectionId: connectionId?.trim() || undefined,
        levels: parsedLevels,
        topics: parsedTopics,
        includeHistory,
        historySize,
      })
      .pipe(map((data) => ({ data })));

    const heartbeatMs = this.debugStream.getHeartbeatMs();
    if (heartbeatMs <= 0) {
      return stream$;
    }
    return merge(
      stream$,
      interval(heartbeatMs).pipe(
        map(() => ({
          type: 'heartbeat',
          data: { timestamp: new Date().toISOString() },
        })),
      ),
    );
  }

  private parseList<T extends string>(
    raw: string | undefined,
    accept: (value: string) => boolean,
  ): T[] | undefined {
    if (!raw) {
      return undefined;
    }
    const values = raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0 && accept(entry));
    return values.length ? (values as T[]) : undefined;
  }

  private parseHistory(raw: string | undefined): { includeHistory: boolean; historySize?: number } {
    if (!raw) {
      return { includeHistory: true };
    }
    const trimmed = raw.trim().toLowerCase();
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return { includeHistory: parsed > 0, historySize: parsed > 0 ? parsed : undefined };
    }
    if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') {
      return { includeHistory: false };
    }
    return { includeHistory: true };
  }
}
