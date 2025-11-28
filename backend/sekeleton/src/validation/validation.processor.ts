import { Process, Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ActivitiesRepository } from '../activities/activities.repository';
import { GatewayService } from '../gateway/gateway.service';
import { ServerToClientMessage } from '../shared/messages';

interface ValidationJobPayload {
  activityId: string;
  requestId: string;
  newStart: string;
  newEnd: string | null;
}

@Processor('validation')
export class ValidationProcessor {
  constructor(
    private readonly activitiesRepo: ActivitiesRepository,
    private readonly gateway: GatewayService,
  ) {}

  @Process()
  async handle(job: Job<ValidationJobPayload>) {
    const payload = job.data;
    // TODO: Lade Activity + Kontext, führe Regeln aus
    // Stub: immer OK
    const msg: ServerToClientMessage = {
      type: 'ACTIVITY_UPDATE_VALIDATION_RESULT',
      payload: {
        requestId: payload.requestId,
        activityId: payload.activityId,
        status: 'OK',
      },
    };
    // Hier könnten wir den WebSocket-Server injizieren/weitergeben; gekürzt für Skeleton.
    return msg;
  }
}
