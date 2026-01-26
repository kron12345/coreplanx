import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { DebugStreamService } from './debug-stream.service';
import type { DebugLogLevel, DebugLogTopic } from './debug-stream.types';

@Injectable()
export class DebugStreamInterceptor implements NestInterceptor {
  constructor(private readonly debugStream: DebugStreamService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (
      !this.debugStream.isHttpLoggingEnabled() ||
      context.getType() !== 'http'
    ) {
      return next.handle();
    }
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      query?: Record<string, string | string[]>;
      params?: Record<string, string>;
      headers?: Record<string, string | string[] | undefined>;
      body?: unknown;
      requestId?: string;
    }>();
    const response = httpContext.getResponse<{ statusCode?: number }>();
    const method = (request.method ?? 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return next.handle();
    }
    const path = request.originalUrl ?? request.url ?? '';
    if (path.includes('/debug/stream')) {
      return next.handle();
    }

    const start = Date.now();
    const userId = this.readParam(request.query, 'userId');
    const connectionId = this.readParam(request.query, 'connectionId');
    const clientRequestId = this.readParam(
      request.headers,
      'x-client-request-id',
    );
    const requestId =
      request.requestId ?? this.readParam(request.headers, 'x-request-id');
    const stageId = this.readStageId(request);
    const topic = this.resolveTopic(path);
    const activityInfo = this.readActivityInfo(request.body);

    const logRequest = (
      status: number,
      level: DebugLogLevel,
      error?: unknown,
    ) => {
      const durationMs = Date.now() - start;
      this.debugStream.log(
        level,
        topic,
        `${method} ${path} (${status})`,
        {
          method,
          path,
          status,
          durationMs,
          requestId,
          clientRequestId,
          ...activityInfo,
          ...(error ? { error: this.serializeError(error) } : {}),
        },
        { userId, connectionId, stageId },
      );
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const status = response.statusCode ?? 200;
          const level = this.levelForStatus(status);
          logRequest(status, level);
        },
      }),
      catchError((error) => {
        const status = this.readStatus(error) ?? response.statusCode ?? 500;
        const level = this.levelForStatus(status, true);
        logRequest(status, level, error);
        return throwError(() => error);
      }),
    );
  }

  private readParam(
    source: Record<string, string | string[] | undefined> | undefined,
    key: string,
  ): string | undefined {
    if (!source) {
      return undefined;
    }
    const value = source[key];
    if (Array.isArray(value)) {
      return value[0]?.toString();
    }
    if (typeof value === 'string') {
      return value;
    }
    return undefined;
  }

  private readStageId(request: {
    query?: Record<string, string | string[]>;
    params?: Record<string, string>;
  }): string | undefined {
    const fromParams = request.params?.['stageId'];
    if (fromParams === 'base' || fromParams === 'operations') {
      return fromParams;
    }
    const fromQuery = this.readParam(request.query, 'stageId');
    if (fromQuery === 'base' || fromQuery === 'operations') {
      return fromQuery;
    }
    return undefined;
  }

  private readActivityInfo(
    body?: unknown,
  ): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object') {
      return undefined;
    }
    const payload = body as {
      activityId?: unknown;
      activityIds?: unknown;
      upserts?: Array<{ id?: string }>;
      deleteIds?: unknown;
    };
    const activityId =
      typeof payload.activityId === 'string' ? payload.activityId : undefined;
    const activityIds = Array.isArray(payload.activityIds)
      ? payload.activityIds
          .map((entry) => String(entry))
          .filter((entry) => entry.length > 0)
      : [];
    const upsertIds = Array.isArray(payload.upserts)
      ? payload.upserts
          .map((entry) => entry.id)
          .filter((id): id is string => typeof id === 'string')
      : [];
    const deleteIds = Array.isArray(payload.deleteIds)
      ? payload.deleteIds
          .map((entry) => String(entry))
          .filter((entry) => entry.length > 0)
      : [];
    if (
      !activityId &&
      activityIds.length === 0 &&
      upsertIds.length === 0 &&
      deleteIds.length === 0
    ) {
      return undefined;
    }
    return {
      ...(activityId ? { activityId } : {}),
      ...(activityIds.length
        ? { activityIds, activityCount: activityIds.length }
        : {}),
      ...(upsertIds.length ? { upsertIds, upsertCount: upsertIds.length } : {}),
      ...(deleteIds.length ? { deleteIds, deleteCount: deleteIds.length } : {}),
    };
  }

  private resolveTopic(path: string): DebugLogTopic {
    const lower = path.toLowerCase();
    if (
      lower.includes('/orders') ||
      lower.includes('/customers') ||
      lower.includes('/businesses') ||
      lower.includes('/templates') ||
      lower.includes('/schedule-templates') ||
      lower.includes('/plans')
    ) {
      return 'orders';
    }
    if (lower.includes('/optimizer') || lower.includes('/autopilot')) {
      return 'solver';
    }
    if (lower.includes('/assistant')) {
      return 'assistant';
    }
    if (lower.includes('/ruleset') || lower.includes('/rules')) {
      return 'rules';
    }
    if (lower.includes('/planning')) {
      return 'planning';
    }
    return 'system';
  }

  private levelForStatus(status: number, isError?: boolean): DebugLogLevel {
    if (status >= 500) {
      return 'error';
    }
    if (status >= 400 || isError) {
      return 'warn';
    }
    return this.debugStream.getHttpLogLevel();
  }

  private readStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }
    const err = error as { status?: number; statusCode?: number };
    if (typeof err.status === 'number') {
      return err.status;
    }
    if (typeof err.statusCode === 'number') {
      return err.statusCode;
    }
    return undefined;
  }

  private serializeError(error: unknown): Record<string, unknown> | undefined {
    if (!error) {
      return undefined;
    }
    if (error instanceof Error) {
      return { name: error.name, message: error.message };
    }
    if (typeof error === 'object') {
      const err = error as {
        message?: string;
        status?: number;
        statusCode?: number;
      };
      return {
        message: err.message ?? 'error',
        status: err.status ?? err.statusCode,
      };
    }
    return { message: String(error) };
  }
}
