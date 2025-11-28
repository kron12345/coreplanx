import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TimelineService } from './timeline.service';
import type {
  ActivityDto,
  ClientContext,
  GatewayInboundMessage,
  GatewayOutboundMessage,
  Lod,
  ViewportChangedPayload,
  ActivityUpdateRequestPayload,
  TimelineServiceDto,
} from './timeline.types';
import { ValidationService } from './validation.service';
import { overlapsRange, servicesForActivity } from './timeline.helpers';

@WebSocketGateway({ namespace: '/timeline' })
@Injectable()
export class TimelineGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TimelineGateway.name);
  private readonly contexts = new Map<string, ClientContext>();

  constructor(
    private readonly timelineService: TimelineService,
    private readonly validationService: ValidationService,
  ) {}

  handleConnection(client: Socket): void {
    this.contexts.set(client.id, {
      subscribedFrom: new Date().toISOString(),
      subscribedTo: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lod: 'activity',
      stage: 'base',
    });
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.contexts.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('event')
  async onMessage(
    @MessageBody() message: GatewayInboundMessage,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!message?.type) {
      return;
    }
    switch (message.type) {
      case 'VIEWPORT_CHANGED':
        this.handleViewportChanged(client.id, message.payload);
        break;
      case 'ACTIVITY_UPDATE_REQUEST':
        await this.handleActivityUpdateRequest(client, message.payload);
        break;
      default:
        break;
    }
  }

  private handleViewportChanged(clientId: string, payload: ViewportChangedPayload): void {
    const { from, to, lod, stage } = payload;
    this.contexts.set(clientId, {
      subscribedFrom: from,
      subscribedTo: to,
      lod: lod ?? 'activity',
      stage: stage ?? 'base',
    });
  }

  private async handleActivityUpdateRequest(
    client: Socket,
    payload: ActivityUpdateRequestPayload,
  ): Promise<void> {
    const stage = payload.stage ?? this.contexts.get(client.id)?.stage ?? 'base';
    const accepted: GatewayOutboundMessage = {
      type: 'ACTIVITY_UPDATE_ACCEPTED',
      payload: {
        requestId: payload.requestId,
        activityId: payload.activityId,
      },
    };
    client.emit('event', accepted);

    const validationMessages = await this.validationService.validateAndUpdate(
      payload,
      async () => {
        // In a real implementation, update DB + requery current state.
        return;
      },
    );

    validationMessages.forEach((msg) => client.emit('event', msg));

    // Notify subscribed clients about the change if it touches their viewport.
    const affected = await this.fetchActivitySnapshot(payload.activityId, stage);
    if (!affected) {
      return;
    }
    this.broadcastIfVisible(affected);
  }

  private async fetchActivitySnapshot(
    activityId: string,
    stage: 'base' | 'operations',
  ): Promise<ActivityDto | null> {
    // For simplicity, fetch with wide window; a real version would query by id.
    const windowStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const activities = await this.timelineService.getTimeline(
      windowStart,
      windowEnd,
      'activity',
      stage,
    );
    const found = activities.activities?.find((a) => a.id === activityId);
    return found ?? null;
  }

  private broadcastIfVisible(activity: ActivityDto): void {
    this.server.sockets.sockets.forEach((socket) => {
      const ctx = this.contexts.get(socket.id);
      if (!ctx) {
        return;
      }
      if (ctx.stage !== activity.stage) {
        return;
      }
      if (ctx.lod === 'service') {
        const services = servicesForActivity(activity);
        services.forEach((service) => {
          if (overlapsRange(service.start, service.end, ctx)) {
            const message: GatewayOutboundMessage = {
              type: service.type === 'ABSENCE' ? 'ABSENCE_UPDATED' : 'SERVICE_UPDATED',
              payload: service,
            };
            socket.emit('event', message);
          }
        });
        return;
      }
      if (overlapsRange(activity.start, activity.end, ctx, activity.isOpenEnded)) {
        const message: GatewayOutboundMessage = {
          type: 'ACTIVITY_UPDATED',
          payload: activity,
        };
        socket.emit('event', message);
      }
    });
  }
}
