import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { share } from 'rxjs/operators';
import { API_CONFIG } from '../../core/config/api-config';
import { PlanningStageId } from './planning-stage.model';
import { PlanningTimelineRange } from './planning-data.types';
import { Resource } from '../../models/resource';
import { Activity } from '../../models/activity';
import { ClientIdentityService } from '../../core/services/client-identity.service';
import { PlanningApiContext } from '../../core/api/planning-api-context';

export type PlanningRealtimeScope = 'resources' | 'activities' | 'timeline';

export interface PlanningRealtimeEvent {
  stageId: PlanningStageId;
  scope: PlanningRealtimeScope;
  upserts?: Resource[] | Activity[];
  deleteIds?: string[];
  timelineRange?: PlanningTimelineRange | { start: string | Date; end: string | Date };
  version?: string | null;
  clientRequestId?: string | null;
  sourceClientId?: string | null;
  sourceConnectionId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PlanningRealtimeService {
  private readonly config = inject(API_CONFIG);
  private readonly identity = inject(ClientIdentityService);

  private readonly eventStreams = new Map<string, Observable<PlanningRealtimeEvent>>();

  events(stageId: PlanningStageId, context?: PlanningApiContext): Observable<PlanningRealtimeEvent> {
    const variantId = context?.variantId?.trim() || 'default';
    const key = `${stageId}::${variantId}`;
    if (!this.eventStreams.has(key)) {
      this.eventStreams.set(key, this.createStageStream(stageId, variantId));
    }
    return this.eventStreams.get(key)!;
  }

  clientId(): string {
    return this.identity.id();
  }

  private createStageStream(
    stageId: PlanningStageId,
    variantId: string,
  ): Observable<PlanningRealtimeEvent> {
    const subjectFactory = () => new Subject<PlanningRealtimeEvent>();
    return new Observable<PlanningRealtimeEvent>((observer) => {
      if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
        observer.complete();
        return;
      }

      const base = this.config.baseUrl.replace(/\/$/, '');
      const params = new URLSearchParams({
        userId: this.identity.userId(),
        clientId: this.identity.userId(),
        connectionId: this.identity.connectionId(),
        variantId,
      });
      const url = `${base}/planning/stages/${stageId}/events?${params.toString()}`;
      const eventSource = new EventSource(url, { withCredentials: true });

      const handleMessage = (event: MessageEvent<string>) => {
        if (!event.data) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as PlanningRealtimeEvent;
          observer.next(payload);
        } catch (error) {
          console.warn('[PlanningRealtimeService] Failed to parse event payload', error);
        }
      };

      // Let EventSource auto-reconnect; just log and keep the stream alive.
      const handleError = (error: Event) => {
        console.warn('[PlanningRealtimeService] SSE connection error', error);
      };

      eventSource.addEventListener('message', handleMessage as EventListener);
      eventSource.addEventListener('error', handleError as EventListener);

      return () => {
        eventSource.removeEventListener('message', handleMessage as EventListener);
        eventSource.removeEventListener('error', handleError as EventListener);
        eventSource.close();
      };
    }).pipe(
      share({
        connector: subjectFactory,
        resetOnError: true,
        resetOnComplete: true,
        resetOnRefCountZero: true,
      }),
    );
  }
}
