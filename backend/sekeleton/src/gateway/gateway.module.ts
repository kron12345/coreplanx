import { Module } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import { GatewayTimelineGateway } from './timeline.gateway';
import { ActivitiesModule } from '../activities/activities.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ActivitiesModule,
    BullModule.registerQueue({
      name: 'validation',
    }),
  ],
  providers: [GatewayService, GatewayTimelineGateway],
})
export class GatewayModule {}
