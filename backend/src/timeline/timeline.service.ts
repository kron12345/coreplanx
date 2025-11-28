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

  constructor(private readonly repository: TimelineRepository) {}

  async getTimeline(
    from: string,
    to: string,
    lod: Lod,
    stage: 'base' | 'operations',
  ): Promise<TimelineResponse> {
    this.ensureDatabase();
    if (lod === 'activity') {
      const activities = await this.repository.listActivities(from, to, stage);
      return { lod, activities };
    }
    const services = await this.repository.listAggregatedServices(from, to, stage);
    return { lod, services };
  }

  private ensureDatabase(): void {
    if (!this.repository.isEnabled) {
      throw new ServiceUnavailableException(
        'Database connection is required for timeline queries.',
      );
    }
  }
}
