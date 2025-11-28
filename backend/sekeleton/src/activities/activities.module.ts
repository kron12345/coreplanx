import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEntity } from './activity.entity';
import { ActivitiesRepository } from './activities.repository';
import { ActivitiesService } from './activities.service';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityEntity])],
  providers: [ActivitiesRepository, ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
