import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GatewayService } from './gateway.service';
import { ActivitiesService } from '../activities/activities.service';
import {
  ActivityUpdateRequestPayload,
  ClientToServerMessage,
  ServerToClientMessage,
  ViewportChangedPayload,
} from '../shared/messages';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@WebSocketGateway({ namespace: '/ws/timeline', cors: true })
export class GatewayTimelineGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly gatewayService: GatewayService,
    private readonly activities: ActivitiesService,
    @InjectQueue('validation') private readonly validationQueue: Queue,
  ) {}

  handleConnection(client: Socket) {
    // default viewport (leer)
    this.gatewayService.upsertContext(client.id, {
      subscribedFrom: new Date(0).toISOString(),
      subscribedTo: new Date().toISOString(),
      lod: 'activity',
    });
  }

  handleDisconnect(client: Socket) {
    this.gatewayService.removeContext(client.id);
  }

  @SubscribeMessage('message')
  async onMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() message: ClientToServerMessage,
  ) {
    switch (message.type) {
      case 'VIEWPORT_CHANGED':
        return this.handleViewportChanged(client, message.payload);
      case 'ACTIVITY_UPDATE_REQUEST':
        return this.handleActivityUpdateRequest(client, message.payload);
      default:
        return;
    }
  }

  private async handleViewportChanged(client: Socket, payload: ViewportChangedPayload) {
    this.gatewayService.upsertContext(client.id, {
      subscribedFrom: payload.from,
      subscribedTo: payload.to,
      lod: payload.lod,
    });
    // Optional: sofortige Initial-Ladung zurücksenden
    const data =
      payload.lod === 'activity'
        ? await this.activities.getActivities(payload.from, payload.to)
        : null; // Service-LOD würde Aggregation nutzen
    if (payload.lod === 'activity') {
      const msg: ServerToClientMessage = {
        type: 'ACTIVITY_UPDATED',
        payload: null as any, // placeholder to satisfy type
      };
      // Wir senden mehrere Nachrichten; hier simplifiziert
      data?.forEach((activity) => {
        const out: ServerToClientMessage = { type: 'ACTIVITY_CREATED', payload: activity };
        client.emit('message', out);
      });
    }
  }

  private async handleActivityUpdateRequest(
    client: Socket,
    payload: ActivityUpdateRequestPayload,
  ) {
    const accepted: ServerToClientMessage = {
      type: 'ACTIVITY_UPDATE_ACCEPTED',
      payload: { requestId: payload.requestId, activityId: payload.activityId },
    };
    client.emit('message', accepted);
    await this.validationQueue.add('validate-activity', {
      requestId: payload.requestId,
      activityId: payload.activityId,
      newStart: payload.newStart,
      newEnd: payload.newEnd,
    });
  }
}
