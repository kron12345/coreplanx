import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TimelineRepository } from './timeline.repository';
import {
  ActivityDto,
  Lod,
  TimelineResponse,
  TimelineServiceDto,
} from './timeline.types';

@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);
  private loggedDbWarning = false;

  constructor(private readonly repository: TimelineRepository) {}

  async getTimeline(
    from: string,
    to: string,
    lod: Lod,
    stage: 'base' | 'operations',
  ): Promise<TimelineResponse> {
    if (!this.repository.isEnabled) {
      if (!this.loggedDbWarning) {
        this.logger.warn(
          'Timeline requested but database is not configured. Returning empty data.',
        );
        this.loggedDbWarning = true;
      }
      return lod === 'activity'
        ? { lod, activities: [] }
        : { lod, services: [] };
    }
    if (lod === 'activity') {
      const activities = await this.repository.listActivities(from, to, stage);
      return { lod, activities };
    }
    const services = await this.repository.listAggregatedServices(from, to, stage);
    return { lod, services };
  }
}
