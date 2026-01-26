import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { API_CONFIG } from '../config/api-config';
import { ClientIdentityService } from './client-identity.service';

export type OrderManagementScope = 'orders' | 'business' | 'customers' | 'templates';

export type OrderManagementEntityType =
  | 'order'
  | 'orderItem'
  | 'business'
  | 'customer'
  | 'scheduleTemplate'
  | 'businessTemplate';

export type OrderManagementRealtimeAction = 'upsert' | 'delete';

export interface OrderManagementRealtimeEvent {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityId: string;
  action: OrderManagementRealtimeAction;
  payload?: unknown;
  at?: string;
  sourceConnectionId?: string | null;
}

export type OrderManagementPresenceUser = {
  userId: string;
  name?: string | null;
  color?: string | null;
  tabCount: number;
};

export type OrderManagementPresenceSnapshot = {
  scope: OrderManagementScope;
  boardId?: string | null;
  users: OrderManagementPresenceUser[];
  at?: string;
};

export type OrderManagementPresenceUpdate = {
  scope: OrderManagementScope;
  boardId?: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  tabCount: number;
  at?: string;
};

export type OrderManagementSelectionUpdate = {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityIds: string[];
  primaryId?: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  mode?: 'select' | 'edit';
  sourceConnectionId?: string | null;
  at?: string;
};

export type OrderManagementSelectionSnapshot = {
  scope: OrderManagementScope;
  selections: OrderManagementSelectionUpdate[];
  at?: string;
};

export type OrderManagementEditUpdate = {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityId: string;
  userId: string;
  name?: string | null;
  color?: string | null;
  field?: string | null;
  value?: unknown;
  state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
  fields?: Record<string, unknown>;
  sourceConnectionId?: string | null;
  at?: string;
};

export type OrderManagementEditSnapshot = {
  scope: OrderManagementScope;
  edits: OrderManagementEditUpdate[];
  at?: string;
};

export type OrderManagementCursorUpdate = {
  scope: OrderManagementScope;
  entityType?: OrderManagementEntityType | null;
  entityId?: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  sourceConnectionId?: string | null;
  at?: string;
};

type OrderManagementSessionHello = {
  userId: string;
  name?: string | null;
  color?: string | null;
};

type OrderManagementScopeUpdate = {
  scope: OrderManagementScope;
  boardId?: string | null;
};

@Injectable({ providedIn: 'root' })
export class OrderManagementRealtimeService {
  private readonly config = inject(API_CONFIG);
  private readonly identity = inject(ClientIdentityService);

  private socket: Socket | null = null;
  private connectionIdValue: string | null = null;
  private readonly eventSubject = new Subject<OrderManagementRealtimeEvent>();
  private readonly presenceSubject = new Subject<
    OrderManagementPresenceSnapshot | OrderManagementPresenceUpdate
  >();
  private readonly selectionSubject = new Subject<
    OrderManagementSelectionSnapshot | OrderManagementSelectionUpdate
  >();
  private readonly editSubject = new Subject<
    OrderManagementEditSnapshot | OrderManagementEditUpdate
  >();
  private readonly cursorSubject = new Subject<OrderManagementCursorUpdate>();
  private activeSession: OrderManagementSessionHello | null = null;
  private pendingSession: OrderManagementSessionHello | null = null;
  private activeScope: OrderManagementScopeUpdate | null = null;
  private pendingScope: OrderManagementScopeUpdate | null = null;

  events(): Observable<OrderManagementRealtimeEvent> {
    this.ensureSocket();
    this.ensureSession();
    return this.eventSubject.asObservable();
  }

  presence(): Observable<OrderManagementPresenceSnapshot | OrderManagementPresenceUpdate> {
    this.ensureSocket();
    this.ensureSession();
    return this.presenceSubject.asObservable();
  }

  selections(): Observable<OrderManagementSelectionSnapshot | OrderManagementSelectionUpdate> {
    this.ensureSocket();
    this.ensureSession();
    return this.selectionSubject.asObservable();
  }

  editUpdates(): Observable<OrderManagementEditSnapshot | OrderManagementEditUpdate> {
    this.ensureSocket();
    this.ensureSession();
    return this.editSubject.asObservable();
  }

  cursor(): Observable<OrderManagementCursorUpdate> {
    this.ensureSocket();
    this.ensureSession();
    return this.cursorSubject.asObservable();
  }

  connectionId(): string | null {
    return this.connectionIdValue;
  }

  setScope(scope: OrderManagementScope, boardId?: string | null): void {
    const next = { scope, boardId: boardId ?? null };
    this.activeScope = next;
    const socket = this.ensureSocket();
    if (socket.connected) {
      socket.emit('presence.update', next);
      this.pendingScope = null;
    } else {
      this.pendingScope = next;
    }
  }

  sendSelection(payload: {
    entityType: OrderManagementEntityType;
    entityIds: string[];
    primaryId?: string | null;
    mode?: 'select' | 'edit';
  }): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    socket.emit('selection.update', payload);
  }

  sendEditUpdate(payload: {
    entityType: OrderManagementEntityType;
    entityId: string;
    field?: string | null;
    value?: unknown;
    state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
  }): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    socket.emit('edit.update', payload);
  }

  sendCursor(payload: {
    entityType?: OrderManagementEntityType | null;
    entityId?: string | null;
  }): void {
    const socket = this.ensureSocket();
    this.ensureSession();
    socket.emit('cursor.update', payload);
  }

  private ensureSocket(): Socket {
    if (this.socket) {
      return this.socket;
    }
    const base = this.socketBaseUrl();
    const socket = io(`${base}/order-management`, {
      withCredentials: true,
      autoConnect: true,
    });
    this.socket = socket;

    socket.on('connect', () => this.handleConnected());
    socket.on('disconnect', () => this.handleDisconnected());

    socket.on('realtime.event', (payload) =>
      this.eventSubject.next(payload as OrderManagementRealtimeEvent),
    );
    socket.on('presence.snapshot', (payload) => this.presenceSubject.next(payload));
    socket.on('presence.update', (payload) => this.presenceSubject.next(payload));
    socket.on('selection.snapshot', (payload) => this.selectionSubject.next(payload));
    socket.on('selection.update', (payload) => this.selectionSubject.next(payload));
    socket.on('edit.snapshot', (payload) => this.editSubject.next(payload));
    socket.on('edit.update', (payload) => this.editSubject.next(payload));
    socket.on('cursor.update', (payload) => this.cursorSubject.next(payload));

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
    if (this.pendingScope) {
      this.socket.emit('presence.update', this.pendingScope);
      this.pendingScope = null;
    } else if (this.activeScope) {
      this.socket.emit('presence.update', this.activeScope);
    }
  }

  private handleDisconnected(): void {
    this.connectionIdValue = null;
  }

  private ensureSession(): void {
    const next: OrderManagementSessionHello = {
      userId: this.identity.userId(),
    };
    if (this.activeSession?.userId === next.userId) {
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

  private socketBaseUrl(): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const match = base.match(/^(.*)\/api(?:\/v\d+)?$/);
    if (match) {
      return match[1] || '';
    }
    return base;
  }
}
