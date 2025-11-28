import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { TemplateService } from './template.service';
import type {
  ActivityDto,
  ClientContext,
  GatewayInboundMessage,
  GatewayOutboundMessage,
  Lod,
  ViewportChangedPayload,
  ActivityUpdateRequestPayload,
  TimelineServiceDto,
} from '../timeline/timeline.types';
import { overlapsRange, servicesForActivity } from '../timeline/timeline.helpers';

@WebSocketGateway({ namespace: '/templates' })
@Injectable()
export class TemplateGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TemplateGateway.name);
  private readonly contexts = new Map<string, ClientContext & { templateId?: string }>();

  constructor(private readonly templateService: TemplateService) {}

  handleConnection(client: Socket): void {
    this.contexts.set(client.id, {
      subscribedFrom: new Date().toISOString(),
      subscribedTo: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lod: 'activity',
      stage: 'base',
      templateId: undefined,
    });
    this.logger.log(`Template client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.contexts.delete(client.id);
    this.logger.log(`Template client disconnected: ${client.id}`);
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

  private handleViewportChanged(clientId: string, payload: ViewportChangedPayload & { templateId?: string }): void {
    const { from, to, lod, stage, templateId } = payload;
    const ctx = this.contexts.get(clientId);
    this.contexts.set(clientId, {
      subscribedFrom: from,
      subscribedTo: to,
      lod: lod ?? ctx?.lod ?? 'activity',
      stage: stage ?? ctx?.stage ?? 'base',
      templateId: templateId ?? ctx?.templateId,
    });
  }

  private async handleActivityUpdateRequest(
    client: Socket,
    payload: ActivityUpdateRequestPayload & { templateId?: string },
  ): Promise<void> {
    const ctx = this.contexts.get(client.id);
    const templateId = payload.templateId ?? ctx?.templateId;
    if (!templateId) {
      this.logger.warn(`Update without templateId from client ${client.id}`);
      return;
    }
    const accepted: GatewayOutboundMessage = {
      type: 'ACTIVITY_UPDATE_ACCEPTED',
      payload: {
        requestId: payload.requestId,
        activityId: payload.activityId,
      },
    };
    client.emit('event', accepted);

    // TODO: integrate real validation/update. For now: refetch and broadcast.
    const snapshot = await this.fetchActivitySnapshot(
      templateId,
      payload.activityId,
      ctx?.stage ?? 'base',
    );
    if (snapshot) {
      this.broadcastIfVisible(snapshot, templateId);
    }
  }

  private async fetchActivitySnapshot(
    templateId: string,
    activityId: string,
    stage: 'base' | 'operations',
  ): Promise<ActivityDto | null> {
    const windowStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const timeline = await this.templateService.getTemplateTimeline(
      templateId,
      windowStart,
      windowEnd,
      'activity',
      stage,
    );
    return timeline.activities?.find((a) => a.id === activityId) ?? null;
  }

  private broadcastIfVisible(activity: ActivityDto, templateId: string): void {
    this.server.sockets.sockets.forEach((socket) => {
      const ctx = this.contexts.get(socket.id);
      if (!ctx || ctx.templateId !== templateId) {
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
