import { Injectable } from '@nestjs/common';
import { LodMode } from '../shared/messages';

export interface ClientContext {
  socketId: string;
  subscribedFrom: string;
  subscribedTo: string;
  lod: LodMode;
}

@Injectable()
export class GatewayService {
  private readonly clients = new Map<string, ClientContext>();

  upsertContext(socketId: string, ctx: Omit<ClientContext, 'socketId'>): void {
    this.clients.set(socketId, { socketId, ...ctx });
  }

  removeContext(socketId: string): void {
    this.clients.delete(socketId);
  }

  matchingClients(activityFrom: string, activityTo: string | null, isOpenEnded: boolean): ClientContext[] {
    const res: ClientContext[] = [];
    this.clients.forEach((ctx) => {
      if (this.overlaps(activityFrom, activityTo, ctx.subscribedFrom, ctx.subscribedTo, isOpenEnded)) {
        res.push(ctx);
      }
    });
    return res;
  }

  private overlaps(
    activityFrom: string,
    activityTo: string | null,
    subscribedFrom: string,
    subscribedTo: string,
    isOpenEnded: boolean,
  ): boolean {
    if (isOpenEnded || !activityTo) {
      return activityFrom < subscribedTo;
    }
    return activityFrom < subscribedTo && activityTo > subscribedFrom;
  }
}
