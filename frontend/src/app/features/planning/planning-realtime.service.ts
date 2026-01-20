import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { filter, share } from 'rxjs/operators';
import { io, Socket } from 'socket.io-client';
import { API_CONFIG } from '../../core/config/api-config';
import { PlanningStageId } from './planning-stage.model';
import { PlanningTimelineRange } from './planning-data.types';
import { Resource } from '../../models/resource';
import { Activity } from '../../models/activity';
import { PlanningApiContext } from '../../core/api/planning-api-context';
import { PlanningDebugService } from './planning-debug.service';
import { ClientIdentityService } from '../../core/services/client-identity.service';

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

export type PlanningPresenceUser = {
  userId: string;
  name?: string | null;
  color?: string | null;
  tabCount: number;
};

export type PlanningPresenceSnapshot = {
  users: PlanningPresenceUser[];
  at?: string;
};

export type PlanningPresenceUpdate = {
  userId: string;
  name?: string | null;
  color?: string | null;
  tabCount: number;
  at?: string;
};

export type PlanningCursorUpdate = {
  stageId: PlanningStageId;
  userId: string;
  time: string | null;
  resourceId?: string | null;
  name?: string | null;
  color?: string | null;
  sourceConnectionId?: string | null;
};

export type PlanningDragGhostEvent = {
  stageId: PlanningStageId;
  userId: string;
  activityId: string;
  resourceId: string;
  start: string;
  end?: string | null;
  mode?: 'move' | 'copy' | 'create';
  name?: string | null;
  color?: string | null;
  sourceConnectionId?: string | null;
  state?: 'start' | 'move' | 'end';
  isValid?: boolean;
  draftActivity?: Activity;
};

export type PlanningLockUpdate = {
  stageId: PlanningStageId;
  activityId: string;
  userId: string;
  name?: string | null;
  color?: string | null;
  state: 'locked' | 'released';
  at?: string;
};

export type PlanningSelectionUpdate = {
  stageId: PlanningStageId;
  activityIds: string[];
  primaryId?: string | null;
  userId?: string | null;
  name?: string | null;
  color?: string | null;
  mode?: 'select' | 'edit';
  sourceConnectionId?: string | null;
  at?: string;
};

export type PlanningSelectionSnapshot = {
  selections: PlanningSelectionUpdate[];
  at?: string;
};

export type PlanningEditUpdate = {
  stageId: PlanningStageId;
  activityId: string;
  userId?: string | null;
  name?: string | null;
  color?: string | null;
  field?: string | null;
  value?: unknown;
  state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
  fields?: Record<string, unknown>;
  sourceConnectionId?: string | null;
  at?: string;
};

export type PlanningEditSnapshot = {
  edits: PlanningEditUpdate[];
  at?: string;
};

type PlanningSessionHello = {
  variantId: string;
  timetableYearLabel?: string | null;
  userId?: string | null;
};

@Injectable({ providedIn: 'root' })
export class PlanningRealtimeService {
  private readonly config = inject(API_CONFIG);
  private readonly debug = inject(PlanningDebugService);
  private readonly identity = inject(ClientIdentityService);

  private socket: Socket | null = null;
  private connectionIdValue: string | null = null;
  private readonly eventSubject = new Subject<PlanningRealtimeEvent>();
  private readonly presenceSubject = new Subject<PlanningPresenceSnapshot | PlanningPresenceUpdate>();
  private readonly cursorSubject = new Subject<PlanningCursorUpdate>();
  private readonly dragSubject = new Subject<PlanningDragGhostEvent>();
  private readonly lockSubject = new Subject<PlanningLockUpdate>();
  private readonly selectionSubject = new Subject<PlanningSelectionSnapshot | PlanningSelectionUpdate>();
  private readonly editSubject = new Subject<PlanningEditSnapshot | PlanningEditUpdate>();
  private readonly eventStreams = new Map<string, Observable<PlanningRealtimeEvent>>();
  private readonly subscribedStages = new Set<PlanningStageId>();
  private activeSession: PlanningSessionHello | null = null;
  private pendingSession: PlanningSessionHello | null = null;

  events(stageId: PlanningStageId, context?: PlanningApiContext): Observable<PlanningRealtimeEvent> {
    const variantId = context?.variantId?.trim() || 'default';
    const key = `${stageId}::${variantId}`;
    this.ensureSocket();
    this.ensureSession(context);
    this.subscribedStages.add(stageId);
    if (!this.eventStreams.has(key)) {
      this.eventStreams.set(
        key,
        this.eventSubject.pipe(
          filter((event) => event.stageId === stageId),
          share({ resetOnComplete: true, resetOnError: true, resetOnRefCountZero: true }),
        ),
      );
    }
    return this.eventStreams.get(key)!;
  }

  presence(): Observable<PlanningPresenceSnapshot | PlanningPresenceUpdate> {
    this.ensureSocket();
    return this.presenceSubject.asObservable();
  }

  cursor(): Observable<PlanningCursorUpdate> {
    this.ensureSocket();
    return this.cursorSubject.asObservable();
  }

  dragGhosts(): Observable<PlanningDragGhostEvent> {
    this.ensureSocket();
    return this.dragSubject.asObservable();
  }

  locks(): Observable<PlanningLockUpdate> {
    this.ensureSocket();
    return this.lockSubject.asObservable();
  }

  selections(): Observable<PlanningSelectionSnapshot | PlanningSelectionUpdate> {
    this.ensureSocket();
    return this.selectionSubject.asObservable();
  }

  editUpdates(): Observable<PlanningEditSnapshot | PlanningEditUpdate> {
    this.ensureSocket();
    return this.editSubject.asObservable();
  }

  connectionId(): string | null {
    return this.connectionIdValue;
  }

  subscribeViewport(
    stageId: PlanningStageId,
    window: PlanningTimelineRange,
    resourceIds: string[],
    context?: PlanningApiContext,
    options?: { templateId?: string | null },
  ): void {
    const socket = this.ensureSocket();
    this.ensureSession(context);
    const payload = {
      stageId,
      from: window.start.toISOString(),
      to: window.end.toISOString(),
      resourceIds: resourceIds.length ? resourceIds : undefined,
      variantId: context?.variantId?.trim() || 'default',
      timetableYearLabel: context?.timetableYearLabel ?? null,
      templateId: options?.templateId ?? null,
    };
    socket.emit('viewport.subscribe', payload, (ack?: { ok?: boolean; error?: string }) => {
      if (ack?.ok) {
        this.debug.reportViewportSubscription(stageId, window, resourceIds.length);
        return;
      }
      if (ack?.error) {
        this.debug.reportViewportError(stageId, ack.error);
      }
    });
  }

  updatePresence(payload: { stageId?: PlanningStageId; boardId?: string | null }): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    socket.emit('presence.update', payload);
  }

  sendCursor(payload: PlanningCursorUpdate): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    socket.emit('cursor.move', payload);
  }

  sendDragGhost(payload: PlanningDragGhostEvent): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    const event = payload.state ?? 'move';
    socket.emit(`drag.${event}`, payload);
  }

  sendSelection(payload: {
    stageId: PlanningStageId;
    activityIds: string[];
    primaryId?: string | null;
    mode?: 'select' | 'edit';
  }): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    socket.emit('selection.update', {
      ...payload,
      userId: this.identity.userId(),
    });
  }

  sendEditUpdate(payload: {
    stageId: PlanningStageId;
    activityId: string;
    field?: string | null;
    value?: unknown;
    state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
  }): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    socket.emit('edit.update', {
      ...payload,
      userId: this.identity.userId(),
    });
  }

  private ensureSocket(): Socket {
    if (this.socket) {
      return this.socket;
    }
    const base = this.config.baseUrl.replace(/\/$/, '');
    const socket = io(`${base}/planning-gantt`, {
      withCredentials: true,
      autoConnect: true,
    });
    this.socket = socket;

    socket.on('connect', () => this.handleConnected());
    socket.on('disconnect', (reason) => this.handleDisconnected(reason));
    socket.on('connect_error', (error) => this.handleError(error));

    socket.on('activity.upserted', (payload) => this.handleActivityUpsert(payload));
    socket.on('activity.deleted', (payload) => this.handleActivityDelete(payload));
    socket.on('resource.upserted', (payload) => this.handleResourceUpsert(payload));
    socket.on('resource.deleted', (payload) => this.handleResourceDelete(payload));
    socket.on('timeline.updated', (payload) => this.handleTimelineUpdate(payload));
    socket.on('realtime.event', (payload) => this.handleRealtimeEvent(payload));

    socket.on('presence.snapshot', (payload) => this.presenceSubject.next(payload));
    socket.on('presence.update', (payload) => this.presenceSubject.next(payload));
    socket.on('cursor.update', (payload) => this.cursorSubject.next(payload));
    socket.on('drag.ghost', (payload) => this.dragSubject.next(payload));
    socket.on('drag.start', (payload) => this.dragSubject.next({ ...(payload ?? {}), state: 'start' }));
    socket.on('drag.move', (payload) => this.dragSubject.next({ ...(payload ?? {}), state: 'move' }));
    socket.on('drag.end', (payload) => this.dragSubject.next({ ...(payload ?? {}), state: 'end' }));
    socket.on('lock.update', (payload) => this.lockSubject.next(payload));
    socket.on('selection.snapshot', (payload) => this.selectionSubject.next(payload));
    socket.on('selection.update', (payload) => this.selectionSubject.next(payload));
    socket.on('edit.snapshot', (payload) => this.editSubject.next(payload));
    socket.on('edit.update', (payload) => this.editSubject.next(payload));

    return socket;
  }

  private handleConnected(): void {
    if (!this.socket) {
      return;
    }
    this.connectionIdValue = this.socket.id ?? null;
    if (this.pendingSession) {
      this.socket.emit('session.hello', this.pendingSession);
      this.activeSession = this.pendingSession;
      this.pendingSession = null;
    } else if (this.activeSession) {
      this.socket.emit('session.hello', this.activeSession);
    }
    this.subscribedStages.forEach((stageId) => {
      this.debug.reportSseConnected(stageId, { mode: 'socket' });
    });
  }

  private handleDisconnected(reason: string): void {
    this.connectionIdValue = null;
    this.subscribedStages.forEach((stageId) => {
      this.debug.reportSseError(stageId, 'Realtime Verbindung getrennt', { reason });
    });
  }

  private handleError(error: unknown): void {
    this.subscribedStages.forEach((stageId) => {
      this.debug.reportSseError(stageId, 'Realtime Verbindung fehlgeschlagen', error);
    });
  }

  private ensureSession(context?: PlanningApiContext): void {
    const next: PlanningSessionHello = {
      variantId: context?.variantId?.trim() || 'default',
      timetableYearLabel: context?.timetableYearLabel ?? null,
      userId: this.identity.userId(),
    };
    if (this.activeSession && this.activeSession.variantId === next.variantId &&
      (this.activeSession.timetableYearLabel ?? null) === (next.timetableYearLabel ?? null)) {
      return;
    }
    this.activeSession = next;
    if (this.socket?.connected) {
      this.socket.emit('session.hello', next);
      this.pendingSession = null;
      return;
    }
    this.pendingSession = next;
  }

  private handleActivityUpsert(payload: Record<string, unknown> | null | undefined): void {
    const stageId = this.readStageId(payload?.['stageId']);
    if (!stageId) {
      return;
    }
    const upserts = this.readList<Activity>(payload?.['activities'], payload?.['upserts']);
    this.emitEvent({
      stageId,
      scope: 'activities',
      upserts,
      deleteIds: [],
      version: this.readString(payload?.['version']),
      clientRequestId: this.readString(payload?.['clientRequestId']),
      sourceClientId: this.readString(payload?.['sourceUserId'] ?? payload?.['sourceClientId']),
      sourceConnectionId: this.readString(payload?.['sourceConnectionId']),
    });
  }

  private handleActivityDelete(payload: Record<string, unknown> | null | undefined): void {
    const stageId = this.readStageId(payload?.['stageId']);
    if (!stageId) {
      return;
    }
    const deleteIds = this.readStringList(payload?.['deleteIds'], payload?.['deletedIds']);
    this.emitEvent({
      stageId,
      scope: 'activities',
      upserts: [],
      deleteIds,
      version: this.readString(payload?.['version']),
      clientRequestId: this.readString(payload?.['clientRequestId']),
      sourceClientId: this.readString(payload?.['sourceUserId'] ?? payload?.['sourceClientId']),
      sourceConnectionId: this.readString(payload?.['sourceConnectionId']),
    });
  }

  private handleResourceUpsert(payload: Record<string, unknown> | null | undefined): void {
    const stageId = this.readStageId(payload?.['stageId']);
    if (!stageId) {
      return;
    }
    const upserts = this.readList<Resource>(payload?.['resources'], payload?.['upserts']);
    this.emitEvent({
      stageId,
      scope: 'resources',
      upserts,
      deleteIds: [],
      version: this.readString(payload?.['version']),
      clientRequestId: this.readString(payload?.['clientRequestId']),
      sourceClientId: this.readString(payload?.['sourceUserId'] ?? payload?.['sourceClientId']),
      sourceConnectionId: this.readString(payload?.['sourceConnectionId']),
    });
  }

  private handleResourceDelete(payload: Record<string, unknown> | null | undefined): void {
    const stageId = this.readStageId(payload?.['stageId']);
    if (!stageId) {
      return;
    }
    const deleteIds = this.readStringList(payload?.['deleteIds'], payload?.['deletedIds']);
    this.emitEvent({
      stageId,
      scope: 'resources',
      upserts: [],
      deleteIds,
      version: this.readString(payload?.['version']),
      clientRequestId: this.readString(payload?.['clientRequestId']),
      sourceClientId: this.readString(payload?.['sourceUserId'] ?? payload?.['sourceClientId']),
      sourceConnectionId: this.readString(payload?.['sourceConnectionId']),
    });
  }

  private handleTimelineUpdate(payload: Record<string, unknown> | null | undefined): void {
    const stageId = this.readStageId(payload?.['stageId']);
    if (!stageId) {
      return;
    }
    const range = payload?.['timelineRange'] ?? payload?.['range'];
    if (!range || typeof range !== 'object') {
      return;
    }
    this.emitEvent({
      stageId,
      scope: 'timeline',
      timelineRange: range as PlanningTimelineRange,
      version: this.readString(payload?.['version']),
      clientRequestId: this.readString(payload?.['clientRequestId']),
      sourceClientId: this.readString(payload?.['sourceUserId'] ?? payload?.['sourceClientId']),
      sourceConnectionId: this.readString(payload?.['sourceConnectionId']),
    });
  }

  private handleRealtimeEvent(payload: Record<string, unknown> | null | undefined): void {
    if (!payload) {
      return;
    }
    const stageId = this.readStageId(payload['stageId']);
    if (!stageId) {
      return;
    }
    const scope = payload['scope'];
    if (scope !== 'resources' && scope !== 'activities' && scope !== 'timeline') {
      return;
    }
    let upserts: Resource[] | Activity[] | undefined;
    if (scope === 'resources') {
      upserts = this.readList<Resource>(payload['upserts'], payload['resources']);
    } else if (scope === 'activities') {
      upserts = this.readList<Activity>(payload['upserts'], payload['activities']);
    }
    this.emitEvent({
      stageId,
      scope,
      upserts,
      deleteIds: this.readStringList(payload['deleteIds']),
      timelineRange: payload['timelineRange'] as PlanningTimelineRange | undefined,
      version: this.readString(payload['version']),
      clientRequestId: this.readString(payload['clientRequestId']),
      sourceClientId: this.readString(payload['sourceUserId'] ?? payload['sourceClientId']),
      sourceConnectionId: this.readString(payload['sourceConnectionId']),
    });
  }

  private emitEvent(event: PlanningRealtimeEvent): void {
    this.eventSubject.next(event);
    this.debug.reportSseEvent(event.stageId);
  }

  private readStageId(value: unknown): PlanningStageId | null {
    if (value === 'base' || value === 'operations') {
      return value;
    }
    return null;
  }

  private readList<T>(...candidates: unknown[]): T[] {
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
    return [];
  }

  private readString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    return null;
  }

  private readStringList(...candidates: unknown[]): string[] {
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.map((entry) => `${entry}`.trim()).filter(Boolean);
      }
      if (typeof candidate === 'string') {
        return candidate
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    }
    return [];
  }
}
