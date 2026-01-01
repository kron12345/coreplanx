import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ASSISTANT_CONFIG } from './assistant.constants';
import type { AssistantConfig } from './assistant.config';

type RateLimitScope = 'chat' | 'help' | 'action';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class AssistantRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(@Inject(ASSISTANT_CONFIG) private readonly config: AssistantConfig) {}

  assertAllowed(
    scope: RateLimitScope,
    request: FastifyRequest,
    clientId?: string | null,
  ): void {
    const key = this.buildKey(scope, request, clientId);
    const limit =
      scope === 'action' ? this.config.actionRateLimitMax : this.config.rateLimitMax;
    const windowMs = this.config.rateLimitWindowMs;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      this.cleanup(now);
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new HttpException(
        'Zu viele Anfragen. Bitte spaeter erneut.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private buildKey(
    scope: RateLimitScope,
    request: FastifyRequest,
    clientId?: string | null,
  ): string {
    const normalizedClient = clientId?.trim();
    if (normalizedClient) {
      return `${scope}:client:${normalizedClient}`;
    }
    const forwarded = request.headers['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip =
      (typeof forwardedValue === 'string' && forwardedValue.split(',')[0]?.trim()) ||
      request.ip ||
      request.raw?.socket?.remoteAddress ||
      'unknown';
    return `${scope}:ip:${ip}`;
  }

  private cleanup(now: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
