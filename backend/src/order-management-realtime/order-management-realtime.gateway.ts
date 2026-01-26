import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { OrderManagementRealtimeService } from './order-management-realtime.service';
import type {
  OrderManagementCursorUpdate,
  OrderManagementEditUpdate,
  OrderManagementEditSnapshot,
  OrderManagementEntityType,
  OrderManagementPresenceSnapshot,
  OrderManagementPresenceUpdate,
  OrderManagementScope,
  OrderManagementSelectionSnapshot,
  OrderManagementSelectionUpdate,
  OrderManagementSessionHello,
} from './order-management-realtime.types';

type PresenceUser = {
  userId: string;
  name?: string | null;
  color?: string | null;
  connections: Set<string>;
};

type SocketContext = {
  userId: string;
  name: string | null;
  color: string | null;
  scope: OrderManagementScope;
  boardId: string | null;
};

type SelectionEntry = {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityIds: string[];
  primaryId: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  mode?: 'select' | 'edit';
  connectionId: string;
  updatedAt: string;
};

type EditEntry = {
  scope: OrderManagementScope;
  entityType: OrderManagementEntityType;
  entityId: string;
  userId: string;
  name?: string | null;
  color?: string | null;
  fields: Record<string, unknown>;
  activeField: string | null;
  connectionId: string;
  updatedAt: string;
};

const SOCKET_ALLOWED_ORIGINS = [
  /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/,
  /\.animeland\.de$/,
  /^https:\/\/qnamic\.ortwein\.chat$/,
];

const ORDER_MANAGEMENT_SCOPES: ReadonlySet<OrderManagementScope> = new Set([
  'orders',
  'business',
  'customers',
  'templates',
]);

const ORDER_MANAGEMENT_ENTITY_TYPES: ReadonlySet<OrderManagementEntityType> = new Set([
  'order',
  'orderItem',
  'business',
  'customer',
  'scheduleTemplate',
  'businessTemplate',
]);

@WebSocketGateway({
  namespace: '/order-management',
  cors: {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const isAllowed = SOCKET_ALLOWED_ORIGINS.some((pattern) => pattern.test(origin));
      callback(isAllowed ? null : new Error('Origin not allowed by CORS'), isAllowed);
    },
    credentials: true,
  },
})
@Injectable()
export class OrderManagementRealtimeGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(OrderManagementRealtimeGateway.name);
  private readonly contexts = new Map<string, SocketContext>();
  private readonly presenceByScope = new Map<string, Map<string, PresenceUser>>();
  private readonly selectionByScope = new Map<string, Map<string, SelectionEntry>>();
  private readonly editByScope = new Map<string, Map<string, EditEntry>>();

  constructor(private readonly realtime: OrderManagementRealtimeService) {
    this.realtime.events().subscribe((event) => {
      this.server.emit('realtime.event', event);
    });
  }

  handleConnection(client: Socket): void {
    const baseContext = this.buildDefaultContext(client);
    this.contexts.set(client.id, baseContext);
    this.registerPresence(client.id, baseContext);
    this.sendPresenceSnapshot(client.id, baseContext);
    this.sendSelectionSnapshot(client.id, baseContext);
    this.sendEditSnapshot(client.id, baseContext);
    this.logger.log(`Order management client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const context = this.contexts.get(client.id);
    if (context) {
      this.clearSelectionForConnection(client.id, context);
      this.clearEditForConnection(client.id, context);
      this.unregisterPresence(client.id, context);
    }
    this.contexts.delete(client.id);
    this.logger.log(`Order management client disconnected: ${client.id}`);
  }

  @SubscribeMessage('session.hello')
  handleSessionHello(
    @MessageBody() payload: OrderManagementSessionHello,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const nextUserId =
      payload.userId?.trim() ||
      context.userId ||
      this.defaultUserId(client.id);
    const nextName = this.normalizeName(payload.name, nextUserId);
    const nextColor = this.normalizeColor(payload.color, nextUserId);

    if (
      context.userId !== nextUserId ||
      context.name !== nextName ||
      context.color !== nextColor
    ) {
      this.clearSelectionForConnection(client.id, context);
      this.clearEditForConnection(client.id, context);
      this.unregisterPresence(client.id, context);
      context.userId = nextUserId;
      context.name = nextName;
      context.color = nextColor;
      this.registerPresence(client.id, context);
      this.sendPresenceSnapshot(client.id, context);
      this.sendSelectionSnapshot(client.id, context);
      this.sendEditSnapshot(client.id, context);
    }
  }

  @SubscribeMessage('presence.update')
  handlePresenceUpdate(
    @MessageBody() payload: OrderManagementPresenceUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const nextScope = this.normalizeScope(payload.scope) ?? context.scope;
    const nextBoard = this.normalizeBoardId(payload.boardId) ?? null;

    const scopeChanged =
      context.scope !== nextScope || (context.boardId ?? null) !== nextBoard;
    if (!scopeChanged) {
      return;
    }

    this.clearSelectionForConnection(client.id, context);
    this.clearEditForConnection(client.id, context);
    this.unregisterPresence(client.id, context);
    context.scope = nextScope;
    context.boardId = nextBoard;
    this.registerPresence(client.id, context);
    this.sendPresenceSnapshot(client.id, context);
    this.sendSelectionSnapshot(client.id, context);
    this.sendEditSnapshot(client.id, context);
  }

  @SubscribeMessage('selection.update')
  handleSelectionUpdate(
    @MessageBody() payload: OrderManagementSelectionUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const entityType = this.normalizeEntityType(payload.entityType);
    if (!entityType) {
      return;
    }
    const entityIds = this.normalizeIdList(payload.entityIds);
    const primaryId = payload.primaryId?.trim() || null;
    const mode = payload.mode === 'edit' ? 'edit' : 'select';
    const key = this.scopeKey(context.scope, context.boardId);
    const selections = this.selectionByScope.get(key) ?? new Map<string, SelectionEntry>();
    const shouldClear = entityIds.length === 0 && !primaryId;

    if (shouldClear) {
      if (selections.delete(client.id)) {
        this.emitSelectionUpdate(key, {
          scope: context.scope,
          entityType,
          entityIds: [],
          primaryId: null,
          userId: context.userId,
          name: context.name,
          color: context.color,
          mode,
          sourceConnectionId: client.id,
          at: new Date().toISOString(),
        });
      }
    } else {
      const entry: SelectionEntry = {
        scope: context.scope,
        entityType,
        entityIds,
        primaryId,
        userId: context.userId,
        name: context.name,
        color: context.color,
        mode,
        connectionId: client.id,
        updatedAt: new Date().toISOString(),
      };
      selections.set(client.id, entry);
      this.emitSelectionUpdate(key, this.selectionPayload(entry));
    }

    if (selections.size === 0) {
      this.selectionByScope.delete(key);
    } else {
      this.selectionByScope.set(key, selections);
    }
  }

  @SubscribeMessage('edit.update')
  handleEditUpdate(
    @MessageBody() payload: OrderManagementEditUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const entityType = this.normalizeEntityType(payload.entityType);
    const entityId = payload.entityId?.trim();
    if (!entityType || !entityId) {
      return;
    }
    const state = payload.state ?? 'change';
    const field = payload.field?.trim() || null;
    const key = this.scopeKey(context.scope, context.boardId);
    const edits = this.editByScope.get(key) ?? new Map<string, EditEntry>();

    if (state === 'end') {
      const existing = edits.get(client.id);
      if (existing) {
        edits.delete(client.id);
        this.emitEditUpdate(key, {
          scope: existing.scope,
          entityType: existing.entityType,
          entityId: existing.entityId,
          userId: existing.userId,
          name: existing.name ?? null,
          color: existing.color ?? null,
          field: field ?? existing.activeField ?? null,
          value: payload.value,
          state: 'end',
          sourceConnectionId: client.id,
          at: new Date().toISOString(),
        });
      }
      if (edits.size === 0) {
        this.editByScope.delete(key);
      } else {
        this.editByScope.set(key, edits);
      }
      return;
    }

    const entry = edits.get(client.id) ?? {
      scope: context.scope,
      entityType,
      entityId,
      userId: context.userId,
      name: context.name,
      color: context.color,
      fields: {},
      activeField: null,
      connectionId: client.id,
      updatedAt: new Date().toISOString(),
    };
    entry.scope = context.scope;
    entry.entityType = entityType;
    entry.entityId = entityId;
    entry.userId = context.userId;
    entry.name = context.name;
    entry.color = context.color;
    entry.updatedAt = new Date().toISOString();
    if (field) {
      entry.fields[field] = payload.value ?? null;
      entry.activeField = state === 'blur' ? null : field;
    } else if (state === 'blur') {
      entry.activeField = null;
    }
    edits.set(client.id, entry);
    this.editByScope.set(key, edits);

    this.emitEditUpdate(key, {
      scope: entry.scope,
      entityType: entry.entityType,
      entityId: entry.entityId,
      userId: entry.userId,
      name: entry.name ?? null,
      color: entry.color ?? null,
      field: entry.activeField ?? field,
      value: payload.value,
      state,
      fields: entry.fields,
      sourceConnectionId: client.id,
      at: new Date().toISOString(),
    });
  }

  @SubscribeMessage('cursor.update')
  handleCursorUpdate(
    @MessageBody() payload: OrderManagementCursorUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const entityType = this.normalizeEntityType(payload.entityType);
    const entityId = payload.entityId?.trim() || null;
    const key = this.scopeKey(context.scope, context.boardId);
    const event: OrderManagementCursorUpdate = {
      scope: context.scope,
      entityType: entityType ?? null,
      entityId,
      userId: payload.userId?.trim() || context.userId,
      name: context.name,
      color: context.color,
      sourceConnectionId: client.id,
      at: new Date().toISOString(),
    };
    this.emitToScopeKey(key, 'cursor.update', event);
  }

  private buildDefaultContext(client: Socket): SocketContext {
    const userId = this.defaultUserId(client.id);
    return {
      userId,
      name: this.normalizeName(null, userId),
      color: this.normalizeColor(null, userId),
      scope: 'orders',
      boardId: null,
    };
  }

  private ensureContext(client: Socket): SocketContext {
    const existing = this.contexts.get(client.id);
    if (existing) {
      return existing;
    }
    const context = this.buildDefaultContext(client);
    this.contexts.set(client.id, context);
    return context;
  }

  private normalizeScope(value?: string | null): OrderManagementScope | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }
    if (ORDER_MANAGEMENT_SCOPES.has(trimmed as OrderManagementScope)) {
      return trimmed as OrderManagementScope;
    }
    return null;
  }

  private normalizeEntityType(
    value?: OrderManagementEntityType | string | null,
  ): OrderManagementEntityType | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }
    if (ORDER_MANAGEMENT_ENTITY_TYPES.has(trimmed as OrderManagementEntityType)) {
      return trimmed as OrderManagementEntityType;
    }
    return null;
  }

  private normalizeBoardId(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed?.length ? trimmed : null;
  }

  private normalizeIdList(value?: string[] | null): string[] {
    if (!value) {
      return [];
    }
    const cleaned = value.map((entry) => `${entry}`.trim()).filter(Boolean);
    return cleaned.length ? Array.from(new Set(cleaned)) : [];
  }

  private normalizeName(value: string | null | undefined, userId: string): string | null {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
    return `User ${userId.slice(0, 6)}`;
  }

  private normalizeColor(value: string | null | undefined, userId: string): string | null {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
    let hash = 0;
    for (let i = 0; i < userId.length; i += 1) {
      hash = (hash * 31 + userId.charCodeAt(i)) % 360;
    }
    return `hsl(${hash} 70% 45%)`;
  }

  private defaultUserId(connectionId: string): string {
    return `user-${connectionId.slice(0, 8)}`;
  }

  private scopeKey(scope: OrderManagementScope, boardId: string | null): string {
    return `${scope}::${boardId ?? ''}`;
  }

  private registerPresence(connectionId: string, context: SocketContext): void {
    const key = this.scopeKey(context.scope, context.boardId);
    const users = this.presenceByScope.get(key) ?? new Map<string, PresenceUser>();
    const entry = users.get(context.userId) ?? {
      userId: context.userId,
      name: context.name,
      color: context.color,
      connections: new Set<string>(),
    };
    entry.name = context.name;
    entry.color = context.color;
    entry.connections.add(connectionId);
    users.set(context.userId, entry);
    this.presenceByScope.set(key, users);
    this.emitPresenceUpdate(key, entry, context);
  }

  private unregisterPresence(connectionId: string, context: SocketContext): void {
    const key = this.scopeKey(context.scope, context.boardId);
    const users = this.presenceByScope.get(key);
    if (!users) {
      return;
    }
    const entry = users.get(context.userId);
    if (!entry) {
      return;
    }
    entry.connections.delete(connectionId);
    if (entry.connections.size === 0) {
      users.delete(context.userId);
    } else {
      users.set(context.userId, entry);
    }
    if (users.size === 0) {
      this.presenceByScope.delete(key);
    } else {
      this.presenceByScope.set(key, users);
    }
    this.emitPresenceUpdate(key, {
      ...entry,
      connections: new Set(entry.connections),
    }, context);
  }

  private sendPresenceSnapshot(connectionId: string, context: SocketContext): void {
    const key = this.scopeKey(context.scope, context.boardId);
    const users = this.presenceByScope.get(key) ?? new Map<string, PresenceUser>();
    const payload: OrderManagementPresenceSnapshot = {
      scope: context.scope,
      boardId: context.boardId ?? null,
      users: Array.from(users.values()).map((entry) => ({
        userId: entry.userId,
        name: entry.name ?? null,
        color: entry.color ?? null,
        tabCount: entry.connections.size,
      })),
      at: new Date().toISOString(),
    };
    this.server.to(connectionId).emit('presence.snapshot', payload);
  }

  private sendSelectionSnapshot(connectionId: string, context: SocketContext): void {
    const key = this.scopeKey(context.scope, context.boardId);
    const selections = this.selectionByScope.get(key) ?? new Map<string, SelectionEntry>();
    const payload: OrderManagementSelectionSnapshot = {
      scope: context.scope,
      selections: Array.from(selections.values()).map((entry) => this.selectionPayload(entry)),
      at: new Date().toISOString(),
    };
    this.server.to(connectionId).emit('selection.snapshot', payload);
  }

  private sendEditSnapshot(connectionId: string, context: SocketContext): void {
    const key = this.scopeKey(context.scope, context.boardId);
    const edits = this.editByScope.get(key) ?? new Map<string, EditEntry>();
    const payload: OrderManagementEditSnapshot = {
      scope: context.scope,
      edits: Array.from(edits.values()).map((entry) => ({
        scope: entry.scope,
        entityType: entry.entityType,
        entityId: entry.entityId,
        userId: entry.userId,
        name: entry.name ?? null,
        color: entry.color ?? null,
        field: entry.activeField ?? null,
        fields: entry.fields,
        sourceConnectionId: entry.connectionId,
        at: entry.updatedAt,
      })),
      at: new Date().toISOString(),
    };
    this.server.to(connectionId).emit('edit.snapshot', payload);
  }

  private emitPresenceUpdate(
    scopeKey: string,
    entry: PresenceUser,
    context: SocketContext,
  ): void {
    const payload = {
      scope: context.scope,
      boardId: context.boardId ?? null,
      userId: entry.userId,
      name: entry.name ?? null,
      color: entry.color ?? null,
      tabCount: entry.connections.size,
      at: new Date().toISOString(),
    };
    this.emitToScopeKey(scopeKey, 'presence.update', payload);
  }

  private emitSelectionUpdate(
    scopeKey: string,
    payload: OrderManagementSelectionUpdate,
  ): void {
    this.emitToScopeKey(scopeKey, 'selection.update', payload);
  }

  private emitEditUpdate(
    scopeKey: string,
    payload: OrderManagementEditUpdate,
  ): void {
    this.emitToScopeKey(scopeKey, 'edit.update', payload);
  }

  private selectionPayload(entry: SelectionEntry): OrderManagementSelectionUpdate {
    return {
      scope: entry.scope,
      entityType: entry.entityType,
      entityIds: entry.entityIds,
      primaryId: entry.primaryId,
      userId: entry.userId,
      name: entry.name ?? null,
      color: entry.color ?? null,
      mode: entry.mode ?? 'select',
      sourceConnectionId: entry.connectionId,
      at: entry.updatedAt,
    };
  }

  private clearSelectionForConnection(connectionId: string, context: SocketContext): void {
    const key = this.scopeKey(context.scope, context.boardId);
    const selections = this.selectionByScope.get(key);
    if (!selections || !selections.has(connectionId)) {
      return;
    }
    const entry = selections.get(connectionId);
    selections.delete(connectionId);
    if (selections.size === 0) {
      this.selectionByScope.delete(key);
    } else {
      this.selectionByScope.set(key, selections);
    }
    if (entry) {
      this.emitSelectionUpdate(key, {
        scope: entry.scope,
        entityType: entry.entityType,
        entityIds: [],
        primaryId: null,
        userId: entry.userId,
        name: entry.name ?? null,
        color: entry.color ?? null,
        mode: entry.mode ?? 'select',
        sourceConnectionId: connectionId,
        at: new Date().toISOString(),
      });
    }
  }

  private clearEditForConnection(connectionId: string, context: SocketContext): void {
    const key = this.scopeKey(context.scope, context.boardId);
    const edits = this.editByScope.get(key);
    if (!edits) {
      return;
    }
    const entry = edits.get(connectionId);
    if (!entry) {
      return;
    }
    edits.delete(connectionId);
    if (edits.size === 0) {
      this.editByScope.delete(key);
    } else {
      this.editByScope.set(key, edits);
    }
    this.emitEditUpdate(key, {
      scope: entry.scope,
      entityType: entry.entityType,
      entityId: entry.entityId,
      userId: entry.userId,
      name: entry.name ?? null,
      color: entry.color ?? null,
      field: entry.activeField ?? null,
      state: 'end',
      sourceConnectionId: connectionId,
      at: new Date().toISOString(),
    });
  }

  private emitToScopeKey(
    scopeKey: string,
    event: string,
    payload: unknown,
  ): void {
    this.contexts.forEach((context, socketId) => {
      const key = this.scopeKey(context.scope, context.boardId);
      if (key !== scopeKey) {
        return;
      }
      this.server.to(socketId).emit(event, payload);
    });
  }
}
