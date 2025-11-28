import { Module } from '@nestjs/common';
import { ActivitiesModule } from './activities/activities.module';
import { TimelineModule } from './timeline/timeline.module';
import { GatewayModule } from './gateway/gateway.module';
import { ValidationModule } from './validation/validation.module';
import { ResourcesModule } from './resources/resources.module';

@Module({
  imports: [
    // TypeORM/Config Module könnten hier ergänzt werden
    ActivitiesModule,
    TimelineModule,
    GatewayModule,
    ValidationModule,
    ResourcesModule,
  ],
})
export class AppModule {}
