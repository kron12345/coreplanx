import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { OrderManagementRealtimeEvent } from './order-management-realtime.types';

@Injectable()
export class OrderManagementRealtimeService {
  private readonly eventStream = new Subject<OrderManagementRealtimeEvent>();

  events(): Observable<OrderManagementRealtimeEvent> {
    return this.eventStream.asObservable();
  }

  emitEvent(
    payload: Omit<OrderManagementRealtimeEvent, 'at'> & { at?: string },
  ): void {
    this.eventStream.next({
      ...payload,
      at: payload.at ?? new Date().toISOString(),
    });
  }
}
