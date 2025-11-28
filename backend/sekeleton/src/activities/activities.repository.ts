import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityEntity } from './activity.entity';

@Injectable()
export class ActivitiesRepository {
  constructor(
    @InjectRepository(ActivityEntity)
    private readonly repo: Repository<ActivityEntity>,
  ) {}

  async findOverlapping(from: string, to: string): Promise<ActivityEntity[]> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.deleted = FALSE')
      .andWhere('a.start_time < :to', { to })
      .andWhere('(a.end_time IS NULL OR a.end_time > :from OR a.is_open_ended = TRUE)', { from })
      .getMany();
  }

  async findById(id: string): Promise<ActivityEntity | null> {
    return this.repo.findOne({ where: { id, deleted: false } });
  }

  async save(entity: ActivityEntity): Promise<ActivityEntity> {
    return this.repo.save(entity);
  }
}
