import { Injectable } from '@nestjs/common';
import { ActivityCatalogEntry, UpsertActivityCatalogEntriesPayload } from './activity-catalog.types';
import { ActivityCatalogRepository } from './activity-catalog.repository';

@Injectable()
export class ActivityCatalogService {
  constructor(private readonly repo: ActivityCatalogRepository) {}

  async list(): Promise<ActivityCatalogEntry[]> {
    return this.repo.list();
  }

  async replaceAll(payload: UpsertActivityCatalogEntriesPayload): Promise<void> {
    await this.repo.replaceAll(payload ?? []);
  }
}
