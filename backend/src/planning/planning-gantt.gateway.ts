import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { PlanningService } from './planning.service';
import { TemplateService } from '../template/template.service';
import type { StageId, PlanningStageRealtimeEvent } from './planning.types';
import type { TemplateRealtimeEvent } from '../template/template.types';
import type { ActivityDto } from '../timeline/timeline.types';
import { overlapsRange } from '../timeline/timeline.helpers';
import {
  deriveTimetableYearLabelFromVariantId,
  normalizeVariantId,
} from '../shared/variant-scope';

type PlanningSessionHello = {
  variantId?: string | null;
  timetableYearLabel?: string | null;
  userId?: string | null;
  name?: string | null;
  color?: string | null;
};

type PlanningViewportSubscribe = {
  stageId?: StageId | null;
  from?: string | null;
  to?: string | null;
  resourceIds?: string[] | null;
  variantId?: string | null;
  timetableYearLabel?: string | null;
  templateId?: string | null;
};

type PlanningPresenceUpdate = {
  stageId?: StageId | null;
  boardId?: string | null;
};

type PlanningCursorUpdate = {
  stageId?: StageId | null;
  userId?: string | null;
  time?: string | null;
  resourceId?: string | null;
};

type PlanningDragGhostEvent = {
  stageId?: StageId | null;
  userId?: string | null;
  activityId?: string | null;
  resourceId?: string | null;
  start?: string | null;
  end?: string | null;
  mode?: 'move' | 'copy' | 'create';
  state?: 'start' | 'move' | 'end';
  isValid?: boolean;
  draftActivity?: Record<string, unknown> | null;
};

type PlanningLockUpdate = {
  stageId?: StageId | null;
  activityId?: string | null;
  userId?: string | null;
  state?: 'locked' | 'released';
};

type PlanningSelectionUpdate = {
  stageId?: StageId | null;
  activityIds?: string[] | null;
  primaryId?: string | null;
  userId?: string | null;
  mode?: 'select' | 'edit';
};

type PlanningSelectionSnapshot = {
  selections: Array<{
    stageId: StageId;
    activityIds: string[];
    primaryId: string | null;
    userId: string;
    name?: string | null;
    color?: string | null;
    mode?: 'select' | 'edit';
    sourceConnectionId?: string | null;
    at?: string;
  }>;
  at?: string;
};

type PlanningEditUpdate = {
  stageId?: StageId | null;
  activityId?: string | null;
  userId?: string | null;
  field?: string | null;
  value?: unknown;
  state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
};

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
  variantId: string;
  timetableYearLabel: string | null;
  baseSubscription: {
    templateId: string | null;
    from: string | null;
    to: string | null;
    resourceIds: string[];
  };
  boardByStage: Map<StageId, string | null>;
};

type StageStreamEntry = {
  subscription: Subscription;
  variantId: string;
  timetableYearLabel: string | null;
};

type SelectionEntry = {
  stageId: StageId;
  activityIds: string[];
  primaryId: string | null;
  userId: string;
  name?: string | null;
  color?: string | null;
  mode?: 'select' | 'edit';
  connectionId: string;
  updatedAt: string;
};

type EditEntry = {
  stageId: StageId;
  activityId: string;
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

@WebSocketGateway({
  namespace: '/planning-gantt',
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
export class PlanningGanttGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(PlanningGanttGateway.name);
  private readonly contexts = new Map<string, SocketContext>();
  private readonly stageStreams = new Map<string, Map<StageId, StageStreamEntry>>();
  private readonly presenceByVariant = new Map<string, Map<string, PresenceUser>>();
  private readonly locksByConnection = new Map<string, Set<string>>();
  private readonly selectionByVariant = new Map<string, Map<string, SelectionEntry>>();
  private readonly editByVariant = new Map<string, Map<string, EditEntry>>();

  constructor(
    private readonly planningService: PlanningService,
    private readonly templateService: TemplateService,
  ) {
    this.templateService
      .streamActivityEvents()
      .subscribe((event) => this.handleTemplateEvent(event));
  }

  handleConnection(client: Socket): void {
    const baseContext = this.buildDefaultContext(client);
    this.contexts.set(client.id, baseContext);
    this.registerPresence(client.id, baseContext);
    this.sendPresenceSnapshot(client.id, baseContext);
    this.sendSelectionSnapshot(client.id, baseContext);
    this.sendEditSnapshot(client.id, baseContext);
    this.logger.log(`Planning Gantt client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    const context = this.contexts.get(client.id);
    if (context) {
      this.clearSelectionForConnection(client.id, context);
      this.clearEditForConnection(client.id, context);
      this.releaseLocksForConnection(client.id, context);
      this.unregisterPresence(client.id, context);
    }
    const streams = this.stageStreams.get(client.id);
    if (streams) {
      streams.forEach((entry) => entry.subscription.unsubscribe());
      this.stageStreams.delete(client.id);
    }
    this.contexts.delete(client.id);
    this.logger.log(`Planning Gantt client disconnected: ${client.id}`);
  }

  @SubscribeMessage('session.hello')
  handleSessionHello(
    @MessageBody() payload: PlanningSessionHello,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const nextVariantId = this.normalizeVariant(payload.variantId, context);
    const nextYearLabel = this.normalizeYearLabel(
      payload.timetableYearLabel,
      nextVariantId,
    );
    const nextUserId =
      payload.userId?.trim() ||
      context.userId ||
      this.defaultUserId(client.id);
    const nextName = this.normalizeName(payload.name, nextUserId);
    const nextColor = this.normalizeColor(payload.color, nextUserId);

    const variantChanged =
      context.variantId !== nextVariantId ||
      (context.timetableYearLabel ?? null) !== (nextYearLabel ?? null);
    const userChanged = context.userId !== nextUserId;

    if (variantChanged || userChanged || context.name !== nextName || context.color !== nextColor) {
      this.clearSelectionForConnection(client.id, context);
      this.clearEditForConnection(client.id, context);
      this.unregisterPresence(client.id, context);
      context.variantId = nextVariantId;
      context.timetableYearLabel = nextYearLabel ?? null;
      context.userId = nextUserId;
      context.name = nextName;
      context.color = nextColor;
      this.registerPresence(client.id, context);
    }

    if (variantChanged) {
      this.resetStageStreams(client.id, nextVariantId, nextYearLabel ?? null);
    }

    this.sendPresenceSnapshot(client.id, context);
  }

  @SubscribeMessage('viewport.subscribe')
  async handleViewportSubscribe(
    @MessageBody() payload: PlanningViewportSubscribe,
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok?: boolean; error?: string }> {
    const context = this.ensureContext(client);
    const stageId = this.normalizeStageId(payload.stageId);
    if (!stageId) {
      return { error: 'Stage ist ungueltig.' };
    }
    const from = payload.from?.trim();
    const to = payload.to?.trim();
    if (!from || !to) {
      return { error: 'Viewport from/to fehlt.' };
    }
    const nextVariantId = this.normalizeVariant(payload.variantId, context);
    const nextYearLabel = this.normalizeYearLabel(
      payload.timetableYearLabel,
      nextVariantId,
    );
    if (
      context.variantId !== nextVariantId ||
      (context.timetableYearLabel ?? null) !== (nextYearLabel ?? null)
    ) {
      this.unregisterPresence(client.id, context);
      context.variantId = nextVariantId;
      context.timetableYearLabel = nextYearLabel ?? null;
      this.registerPresence(client.id, context);
    }

    const resourceIds = this.normalizeResourceIds(payload.resourceIds);
    if (stageId === 'base') {
      const templateId = payload.templateId?.trim() ?? '';
      if (!templateId) {
        return { error: 'TemplateId fehlt.' };
      }
      context.baseSubscription = {
        templateId,
        from,
        to,
        resourceIds,
      };
      return { ok: true };
    }

    try {
      await this.planningService.updateViewportSubscription(
        stageId,
        nextVariantId,
        {
          from,
          to,
          resourceIds: resourceIds.length ? resourceIds : undefined,
          userId: context.userId,
          connectionId: client.id,
        },
        nextYearLabel ?? null,
      );
      this.ensureStageStream(
        client,
        stageId,
        nextVariantId,
        nextYearLabel ?? null,
      );
      return { ok: true };
    } catch (error) {
      this.logger.warn(
        `Viewport-Subscription fehlgeschlagen (${client.id}): ${error}`,
      );
      return { error: 'Viewport konnte nicht abonniert werden.' };
    }
  }

  @SubscribeMessage('presence.update')
  handlePresenceUpdate(
    @MessageBody() payload: PlanningPresenceUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const stageId = this.normalizeStageId(payload.stageId);
    if (stageId) {
      context.boardByStage.set(stageId, payload.boardId ?? null);
    }
  }

  @SubscribeMessage('cursor.move')
  handleCursorMove(
    @MessageBody() payload: PlanningCursorUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const event = {
      stageId: payload.stageId ?? 'operations',
      userId: payload.userId?.trim() || context.userId,
      time: payload.time ?? null,
      resourceId: payload.resourceId ?? null,
      name: context.name,
      color: context.color,
      sourceConnectionId: client.id,
    };
    this.emitToVariant(context, 'cursor.update', event);
  }

  @SubscribeMessage('drag.start')
  handleDragStart(
    @MessageBody() payload: PlanningDragGhostEvent,
    @ConnectedSocket() client: Socket,
  ): void {
    this.handleDragEvent('start', payload, client);
  }

  @SubscribeMessage('drag.move')
  handleDragMove(
    @MessageBody() payload: PlanningDragGhostEvent,
    @ConnectedSocket() client: Socket,
  ): void {
    this.handleDragEvent('move', payload, client);
  }

  @SubscribeMessage('drag.end')
  handleDragEnd(
    @MessageBody() payload: PlanningDragGhostEvent,
    @ConnectedSocket() client: Socket,
  ): void {
    this.handleDragEvent('end', payload, client);
  }

  @SubscribeMessage('lock.update')
  handleLockUpdate(
    @MessageBody() payload: PlanningLockUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const stageId = this.normalizeStageId(payload.stageId);
    const activityId = payload.activityId?.trim();
    if (!stageId || !activityId) {
      return;
    }
    const state = payload.state ?? 'locked';
    this.updateLock(client.id, stageId, activityId, state, context);
  }

  @SubscribeMessage('selection.update')
  handleSelectionUpdate(
    @MessageBody() payload: PlanningSelectionUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const stageId = this.normalizeStageId(payload.stageId) ?? 'operations';
    const activityIds = this.normalizeIdList(payload.activityIds);
    const primaryId = payload.primaryId?.trim() || null;
    const mode = payload.mode === 'edit' ? 'edit' : 'select';
    const variantKey = this.variantKey(context.variantId, context.timetableYearLabel);
    const selections = this.selectionByVariant.get(variantKey) ?? new Map<string, SelectionEntry>();
    const shouldClear = activityIds.length === 0 && !primaryId;

    if (shouldClear) {
      if (selections.delete(client.id)) {
        this.emitSelectionUpdate(variantKey, {
          stageId,
          activityIds: [],
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
        stageId,
        activityIds,
        primaryId,
        userId: context.userId,
        name: context.name,
        color: context.color,
        mode,
        connectionId: client.id,
        updatedAt: new Date().toISOString(),
      };
      selections.set(client.id, entry);
      this.emitSelectionUpdate(variantKey, this.selectionPayload(entry));
    }

    if (selections.size === 0) {
      this.selectionByVariant.delete(variantKey);
    } else {
      this.selectionByVariant.set(variantKey, selections);
    }
  }

  @SubscribeMessage('edit.update')
  handleEditUpdate(
    @MessageBody() payload: PlanningEditUpdate,
    @ConnectedSocket() client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const stageId = this.normalizeStageId(payload.stageId) ?? 'operations';
    const activityId = payload.activityId?.trim();
    if (!activityId) {
      return;
    }
    const state = payload.state ?? 'change';
    const field = payload.field?.trim() || null;
    const variantKey = this.variantKey(context.variantId, context.timetableYearLabel);
    const edits = this.editByVariant.get(variantKey) ?? new Map<string, EditEntry>();

    if (state === 'end') {
      const existing = edits.get(client.id);
      if (existing) {
        edits.delete(client.id);
        this.emitEditUpdate(variantKey, {
          stageId: existing.stageId,
          activityId: existing.activityId,
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
        this.editByVariant.delete(variantKey);
      } else {
        this.editByVariant.set(variantKey, edits);
      }
      return;
    }

    const entry = edits.get(client.id) ?? {
      stageId,
      activityId,
      userId: context.userId,
      name: context.name,
      color: context.color,
      fields: {},
      activeField: null,
      connectionId: client.id,
      updatedAt: new Date().toISOString(),
    };
    entry.stageId = stageId;
    entry.activityId = activityId;
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
    this.editByVariant.set(variantKey, edits);

    this.emitEditUpdate(variantKey, {
      stageId: entry.stageId,
      activityId: entry.activityId,
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

  private handleDragEvent(
    state: 'start' | 'move' | 'end',
    payload: PlanningDragGhostEvent,
    client: Socket,
  ): void {
    const context = this.ensureContext(client);
    const stageId = this.normalizeStageId(payload.stageId) ?? 'operations';
    const activityId = payload.activityId?.trim();
    const resourceId = payload.resourceId?.trim();
    if (!activityId || !resourceId || !payload.start) {
      return;
    }
    const event = {
      stageId,
      userId: payload.userId?.trim() || context.userId,
      activityId,
      resourceId,
      start: payload.start,
      end: payload.end ?? null,
      mode: payload.mode ?? 'move',
      state,
      isValid: payload.isValid ?? true,
      draftActivity: payload.draftActivity ?? null,
      name: context.name,
      color: context.color,
      sourceConnectionId: client.id,
    };
    this.emitToVariant(context, `drag.${state}`, event);
    if (state === 'start') {
      this.updateLock(client.id, stageId, activityId, 'locked', context);
    }
    if (state === 'end') {
      this.updateLock(client.id, stageId, activityId, 'released', context);
    }
  }

  private updateLock(
    connectionId: string,
    stageId: StageId,
    activityId: string,
    state: 'locked' | 'released',
    context: SocketContext,
  ): void {
    const key = `${stageId}:${activityId}`;
    if (state === 'locked') {
      const set = this.locksByConnection.get(connectionId) ?? new Set<string>();
      set.add(key);
      this.locksByConnection.set(connectionId, set);
    } else {
      const set = this.locksByConnection.get(connectionId);
      if (set) {
        set.delete(key);
        if (set.size === 0) {
          this.locksByConnection.delete(connectionId);
        }
      }
    }
    this.emitToVariant(context, 'lock.update', {
      stageId,
      activityId,
      userId: context.userId,
      name: context.name,
      color: context.color,
      state,
      at: new Date().toISOString(),
    });
  }

  private releaseLocksForConnection(
    connectionId: string,
    context: SocketContext,
  ): void {
    const locks = this.locksByConnection.get(connectionId);
    if (!locks) {
      return;
    }
    locks.forEach((key) => {
      const [stageId, activityId] = key.split(':');
      if (!stageId || !activityId) {
        return;
      }
      this.emitToVariant(context, 'lock.update', {
        stageId: stageId as StageId,
        activityId,
        userId: context.userId,
        name: context.name,
        color: context.color,
        state: 'released',
        at: new Date().toISOString(),
      });
    });
    this.locksByConnection.delete(connectionId);
  }

  private ensureStageStream(
    client: Socket,
    stageId: StageId,
    variantId: string,
    timetableYearLabel: string | null,
  ): void {
    if (stageId !== 'operations') {
      return;
    }
    const context = this.ensureContext(client);
    const map = this.stageStreams.get(client.id) ?? new Map<StageId, StageStreamEntry>();
    const existing = map.get(stageId);
    if (
      existing &&
      existing.variantId === variantId &&
      (existing.timetableYearLabel ?? null) === (timetableYearLabel ?? null)
    ) {
      return;
    }
    existing?.subscription.unsubscribe();
    const stream = this.planningService.streamStageEvents(
      stageId,
      variantId,
      context.userId,
      client.id,
      timetableYearLabel ?? null,
    );
    const subscription = stream.subscribe({
      next: (event) => this.emitStageEvent(client, event),
      error: (error) =>
        this.logger.warn(
          `Planning stage stream failed for ${client.id}: ${error}`,
        ),
    });
    map.set(stageId, { subscription, variantId, timetableYearLabel });
    this.stageStreams.set(client.id, map);
  }

  private emitStageEvent(client: Socket, event: PlanningStageRealtimeEvent): void {
    client.emit('realtime.event', {
      stageId: event.stageId,
      scope: event.scope,
      upserts: event.upserts,
      deleteIds: event.deleteIds,
      timelineRange: event.timelineRange,
      version: event.version ?? null,
      clientRequestId: event.clientRequestId ?? null,
      sourceClientId: event.sourceClientId ?? null,
      sourceConnectionId: event.sourceConnectionId ?? null,
    });
  }

  private handleTemplateEvent(event: TemplateRealtimeEvent): void {
    if (!event.templateId) {
      return;
    }
    const variantKey = this.variantKey(event.variantId, event.timetableYearLabel ?? null);
    const contexts = Array.from(this.contexts.entries()).filter(
      ([, context]) => this.variantKey(context.variantId, context.timetableYearLabel) === variantKey,
    );
    if (contexts.length === 0) {
      return;
    }
    const upserts = event.upserts ?? [];
    const deleteIds = event.deleteIds ?? [];
    contexts.forEach(([socketId, context]) => {
      const subscription = context.baseSubscription;
      if (!subscription.templateId || subscription.templateId !== event.templateId) {
        return;
      }
      const filteredUpserts = upserts.length
        ? this.filterTemplateActivities(subscription, upserts)
        : [];
      if (!filteredUpserts.length && !deleteIds.length) {
        return;
      }
      this.server.to(socketId).emit('realtime.event', {
        stageId: 'base',
        scope: 'activities',
        upserts: filteredUpserts.length ? filteredUpserts : undefined,
        deleteIds: deleteIds.length ? deleteIds : undefined,
        version: null,
        clientRequestId: null,
        sourceClientId: null,
        sourceConnectionId: null,
      });
    });
  }

  private filterTemplateActivities(
    subscription: SocketContext['baseSubscription'],
    activities: ActivityDto[],
  ): ActivityDto[] {
    const ctx = {
      subscribedFrom: subscription.from ?? '',
      subscribedTo: subscription.to ?? '',
      lod: 'activity' as const,
      stage: 'base' as const,
    };
    if (!ctx.subscribedFrom || !ctx.subscribedTo) {
      return activities;
    }
    const resourceFilter = subscription.resourceIds.length
      ? new Set(subscription.resourceIds)
      : null;
    return activities.filter((activity) => {
      if (!overlapsRange(activity.start, activity.end, ctx, activity.isOpenEnded)) {
        return false;
      }
      if (!resourceFilter) {
        return true;
      }
      return activity.resourceAssignments.some((assignment) =>
        resourceFilter.has(assignment.resourceId),
      );
    });
  }

  private resetStageStreams(
    connectionId: string,
    variantId: string,
    timetableYearLabel: string | null,
  ): void {
    const streams = this.stageStreams.get(connectionId);
    if (!streams) {
      return;
    }
    streams.forEach((entry, stageId) => {
      if (
        entry.variantId !== variantId ||
        (entry.timetableYearLabel ?? null) !== (timetableYearLabel ?? null)
      ) {
        entry.subscription.unsubscribe();
        streams.delete(stageId);
      }
    });
  }

  private buildDefaultContext(client: Socket): SocketContext {
    const userId = this.defaultUserId(client.id);
    return {
      userId,
      name: this.normalizeName(null, userId),
      color: this.normalizeColor(null, userId),
      variantId: 'default',
      timetableYearLabel: null,
      baseSubscription: {
        templateId: null,
        from: null,
        to: null,
        resourceIds: [],
      },
      boardByStage: new Map(),
    };
  }

  private ensureContext(client: Socket): SocketContext {
    const existing = this.contexts.get(client.id);
    if (existing) {
      return existing;
    }
    const created = this.buildDefaultContext(client);
    this.contexts.set(client.id, created);
    return created;
  }

  private normalizeVariant(
    value: string | null | undefined,
    context: SocketContext,
  ): string {
    if (value && value.trim().length > 0) {
      return normalizeVariantId(value);
    }
    return normalizeVariantId(context.variantId);
  }

  private normalizeYearLabel(
    value: string | null | undefined,
    variantId: string,
  ): string | null {
    const trimmed = value?.trim();
    const derived = deriveTimetableYearLabelFromVariantId(variantId);
    if (derived) {
      if (trimmed && trimmed !== derived) {
        return derived;
      }
      return derived;
    }
    return trimmed && trimmed.length > 0 ? trimmed : null;
  }

  private normalizeStageId(value: StageId | string | null | undefined): StageId | null {
    if (value === 'base' || value === 'operations') {
      return value;
    }
    return null;
  }

  private normalizeResourceIds(value?: string[] | null): string[] {
    if (!value) {
      return [];
    }
    const cleaned = value.map((entry) => `${entry}`.trim()).filter(Boolean);
    return cleaned.length ? Array.from(new Set(cleaned)) : [];
  }

  private normalizeIdList(value?: string[] | null): string[] {
    return this.normalizeResourceIds(value);
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

  private variantKey(variantId: string, timetableYearLabel: string | null): string {
    return `${variantId}::${timetableYearLabel ?? ''}`;
  }

  private registerPresence(connectionId: string, context: SocketContext): void {
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    const users = this.presenceByVariant.get(key) ?? new Map<string, PresenceUser>();
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
    this.presenceByVariant.set(key, users);
    this.emitPresenceUpdate(key, entry);
  }

  private unregisterPresence(connectionId: string, context: SocketContext): void {
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    const users = this.presenceByVariant.get(key);
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
      this.presenceByVariant.delete(key);
    } else {
      this.presenceByVariant.set(key, users);
    }
    this.emitPresenceUpdate(key, {
      ...entry,
      connections: new Set(entry.connections),
    });
  }

  private sendPresenceSnapshot(connectionId: string, context: SocketContext): void {
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    const users = this.presenceByVariant.get(key) ?? new Map<string, PresenceUser>();
    const payload = {
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
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    const selections = this.selectionByVariant.get(key) ?? new Map<string, SelectionEntry>();
    const payload: PlanningSelectionSnapshot = {
      selections: Array.from(selections.values()).map((entry) => this.selectionPayload(entry)),
      at: new Date().toISOString(),
    };
    this.server.to(connectionId).emit('selection.snapshot', payload);
  }

  private sendEditSnapshot(connectionId: string, context: SocketContext): void {
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    const edits = this.editByVariant.get(key) ?? new Map<string, EditEntry>();
    const payload = {
      edits: Array.from(edits.values()).map((entry) => ({
        stageId: entry.stageId,
        activityId: entry.activityId,
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

  private emitPresenceUpdate(variantKey: string, entry: PresenceUser): void {
    const payload = {
      userId: entry.userId,
      name: entry.name ?? null,
      color: entry.color ?? null,
      tabCount: entry.connections.size,
      at: new Date().toISOString(),
    };
    this.emitToVariantKey(variantKey, 'presence.update', payload);
  }

  private emitSelectionUpdate(
    variantKey: string,
    payload: {
      stageId: StageId;
      activityIds: string[];
      primaryId: string | null;
      userId: string;
      name?: string | null;
      color?: string | null;
      mode?: 'select' | 'edit';
      sourceConnectionId?: string | null;
      at?: string;
    },
  ): void {
    this.emitToVariantKey(variantKey, 'selection.update', payload);
  }

  private emitEditUpdate(
    variantKey: string,
    payload: {
      stageId: StageId;
      activityId: string;
      userId: string;
      name?: string | null;
      color?: string | null;
      field?: string | null;
      value?: unknown;
      state?: 'start' | 'focus' | 'change' | 'blur' | 'end';
      fields?: Record<string, unknown>;
      sourceConnectionId?: string | null;
      at?: string;
    },
  ): void {
    this.emitToVariantKey(variantKey, 'edit.update', payload);
  }

  private selectionPayload(entry: SelectionEntry): {
    stageId: StageId;
    activityIds: string[];
    primaryId: string | null;
    userId: string;
    name?: string | null;
    color?: string | null;
    mode?: 'select' | 'edit';
    sourceConnectionId?: string | null;
    at?: string;
  } {
    return {
      stageId: entry.stageId,
      activityIds: entry.activityIds,
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
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    const selections = this.selectionByVariant.get(key);
    if (!selections || !selections.has(connectionId)) {
      return;
    }
    const entry = selections.get(connectionId);
    selections.delete(connectionId);
    if (selections.size === 0) {
      this.selectionByVariant.delete(key);
    } else {
      this.selectionByVariant.set(key, selections);
    }
    if (entry) {
      this.emitSelectionUpdate(key, {
        stageId: entry.stageId,
        activityIds: [],
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
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    const edits = this.editByVariant.get(key);
    if (!edits) {
      return;
    }
    const entry = edits.get(connectionId);
    if (!entry) {
      return;
    }
    edits.delete(connectionId);
    if (edits.size === 0) {
      this.editByVariant.delete(key);
    } else {
      this.editByVariant.set(key, edits);
    }
    this.emitEditUpdate(key, {
      stageId: entry.stageId,
      activityId: entry.activityId,
      userId: entry.userId,
      name: entry.name ?? null,
      color: entry.color ?? null,
      field: entry.activeField ?? null,
      state: 'end',
      sourceConnectionId: connectionId,
      at: new Date().toISOString(),
    });
  }

  private emitToVariant(
    context: SocketContext,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    const key = this.variantKey(context.variantId, context.timetableYearLabel);
    this.emitToVariantKey(key, event, payload);
  }

  private emitToVariantKey(
    variantKey: string,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    this.contexts.forEach((context, socketId) => {
      const key = this.variantKey(context.variantId, context.timetableYearLabel);
      if (key !== variantKey) {
        return;
      }
      this.server.to(socketId).emit(event, payload);
    });
  }
}
