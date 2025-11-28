import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import type { Lod, TimelineResponse } from './timeline.types';

@Controller('api/timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  getTimeline(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('lod') lod: Lod = 'activity',
    @Query('stage') stage: 'base' | 'operations' = 'base',
  ): Promise<TimelineResponse> {
    if (!from || !to) {
      throw new BadRequestException('Query params "from" and "to" are required.');
    }
    return this.timelineService.getTimeline(from, to, lod, stage);
  }
}
