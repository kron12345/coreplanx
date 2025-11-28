import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ValidationProcessor } from './validation.processor';
import { ActivitiesModule } from '../activities/activities.module';
import { ResourcesModule } from '../resources/resources.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'validation',
      // connection: { host: 'localhost', port: 6379 } // per Config setzen
    }),
    ActivitiesModule,
    ResourcesModule,
  ],
  providers: [ValidationProcessor],
  exports: [],
})
export class ValidationModule {}
