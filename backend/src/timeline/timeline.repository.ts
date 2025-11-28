import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  ActivityDto,
  TimelineServiceDto,
} from './timeline.types';
import {
  aggregateServices,
  mapActivityRow,
  TimelineActivityRow,
} from './timeline.helpers';

interface ActivityRow extends TimelineActivityRow {
  deleted: boolean;
  deleted_at: string | null;
}

@Injectable()
export class TimelineRepository {
  private readonly logger = new Logger(TimelineRepository.name);

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async listActivities(
    from: string,
    to: string,
    stage: 'base' | 'operations',
  ): Promise<ActivityDto[]> {
    if (!this.isEnabled) {
      return [];
    }
    const result = await this.database.query<ActivityRow>(
      `
        SELECT
          id,
          type,
          stage,
          deleted,
          deleted_at,
          start_time,
          end_time,
          is_open_ended,
          attributes
        FROM activities
        WHERE deleted = FALSE
          AND stage = $1
          AND start_time < $3
          AND (end_time IS NULL OR end_time > $2 OR is_open_ended = TRUE)
      `,
      [stage, from, to],
    );
    return result.rows
      .map((row) => mapActivityRow(row, this.logger))
      .filter((dto): dto is ActivityDto => dto !== null);
  }

  async listAggregatedServices(
    from: string,
    to: string,
    stage: 'base' | 'operations',
  ): Promise<TimelineServiceDto[]> {
    const activities = await this.listActivities(from, to, stage);
    return aggregateServices(activities);
  }
}
