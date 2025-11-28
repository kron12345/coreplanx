import { Injectable, Logger } from '@nestjs/common';
import { ActivityUpdateRequestPayload, GatewayOutboundMessage } from './timeline.types';

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  async validateAndUpdate(
    payload: ActivityUpdateRequestPayload,
    updater: (update: { activityId: string; newStart: string; newEnd?: string | null }) => Promise<void>,
  ): Promise<GatewayOutboundMessage[]> {
    // Placeholder for asynchronous validation/queue integration.
    // Simulate async validation with a short delay.
    await new Promise((resolve) => setTimeout(resolve, 25));
    try {
      await updater({
        activityId: payload.activityId,
        newStart: payload.newStart,
        newEnd: payload.newEnd,
      });
      return [
        {
          type: 'ACTIVITY_UPDATE_VALIDATION_RESULT',
          payload: {
            requestId: payload.requestId,
            activityId: payload.activityId,
            status: 'OK',
          },
        },
      ];
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unbekannter Validierungsfehler';
      this.logger.error(
        `Validation failed for activity ${payload.activityId}: ${message}`,
      );
      return [
        {
          type: 'ACTIVITY_UPDATE_VALIDATION_RESULT',
          payload: {
            requestId: payload.requestId,
            activityId: payload.activityId,
            status: 'ERROR',
            errors: [{ code: 'VALIDATION_FAILED', message }],
          },
        },
      ];
    }
  }
}
