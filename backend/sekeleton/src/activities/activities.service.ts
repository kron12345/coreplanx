import { Injectable } from '@nestjs/common';
import { ActivitiesRepository } from './activities.repository';
import { ActivityDto } from './dto/activity.dto';
import { ActivityEntity } from './activity.entity';

@Injectable()
export class ActivitiesService {
  constructor(private readonly repo: ActivitiesRepository) {}

  async getActivities(from: string, to: string): Promise<ActivityDto[]> {
    const entities = await this.repo.findOverlapping(from, to);
    return entities.map((e) => this.toDto(e));
  }

  async getById(id: string): Promise<ActivityDto | null> {
    const entity = await this.repo.findById(id);
    return entity ? this.toDto(entity) : null;
  }

  private toDto(entity: ActivityEntity): ActivityDto {
    const versions = (entity.attributes as any)?.versions ?? [];
    const current = versions.find((v: any) => !v.validTo) ?? versions[versions.length - 1] ?? {};
    const data = current.data ?? {};
    return {
      id: entity.id,
      type: entity.type,
      label: data.label ?? '',
      start: data.start ?? entity.start_time,
      end: data.end ?? entity.end_time,
      status: data.status ?? 'PLANNED',
      attributes: data,
      resourceAssignments: data.resourceAssignments ?? [],
    };
  }
}
