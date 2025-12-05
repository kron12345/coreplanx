import { Body, Controller, Get, Put } from '@nestjs/common';
import { ActivityCatalogService } from './activity-catalog.service';
import type { ActivityCatalogEntry, UpsertActivityCatalogEntriesPayload } from './activity-catalog.types';

@Controller('activity-catalog')
export class ActivityCatalogController {
  constructor(private readonly service: ActivityCatalogService) {}

  @Get()
  async list(): Promise<ActivityCatalogEntry[]> {
    return this.service.list();
  }

  /**
   * Ersetzt den kompletten Katalog durch die übergebene Liste.
   */
  @Put()
  async replaceAll(@Body() payload: UpsertActivityCatalogEntriesPayload): Promise<void> {
    await this.service.replaceAll(payload ?? []);
  }
}
