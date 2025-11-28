import { Controller, Get, Query } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { ActivityDto } from '../activities/dto/activity.dto';
import { ServiceDto } from '../activities/dto/service.dto';

@Controller('timeline')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  async getTimeline(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('lod') lod: 'activity' | 'service' = 'activity',
  ): Promise<{ activities?: ActivityDto[]; services?: ServiceDto[] }> {
    return this.timeline.loadTimeline(from, to, lod);
  }
}
