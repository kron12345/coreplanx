import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { ActivityCatalogEntry, UpsertActivityCatalogEntriesPayload } from './activity-catalog.types';
import { ActivityCatalogRepository } from './activity-catalog.repository';

@Injectable()
export class ActivityCatalogService implements OnModuleInit {
  private readonly logger = new Logger(ActivityCatalogService.name);
  private readonly defaultEntries: ActivityCatalogEntry[] = [];
  private defaultsLoaded = false;

  constructor(private readonly repo: ActivityCatalogRepository) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.list();
    } catch (error) {
      this.logger.error(
        'Failed to seed activity catalog defaults',
        (error as Error).stack ?? String(error),
      );
    }
  }

  async list(): Promise<ActivityCatalogEntry[]> {
    if (!this.repo.isEnabled) {
      return [];
    }
    this.loadDefaultsOnce();
    let entries = await this.repo.list();
    if (!entries.length && this.defaultEntries.length) {
      await this.repo.upsertMany(this.defaultEntries);
      this.logger.log(`Seeded activity catalog with ${this.defaultEntries.length} default entries.`);
      entries = await this.repo.list();
      return entries;
    }

    if (entries.length && this.defaultEntries.length) {
      const updated = this.mergeDefaultAttributes(entries, this.defaultEntries);
      if (updated.toUpsert.length) {
        await this.repo.upsertMany(updated.toUpsert);
        this.logger.log(
          `Updated ${updated.toUpsert.length} activity catalog entries with missing default attributes.`,
        );
      }
      return updated.entries;
    }

    return entries;
  }

  async replaceAll(payload: UpsertActivityCatalogEntriesPayload): Promise<void> {
    await this.repo.replaceAll(payload ?? []);
  }

  private loadDefaultEntries(): ActivityCatalogEntry[] {
    const dir = this.resolveDefaultDir();
    if (!dir) {
      this.logger.warn('Default activity catalog directory not found; skipping seeding.');
      return [];
    }
    const files = readdirSync(dir)
      .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml') || entry.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
    const entries: ActivityCatalogEntry[] = [];
    for (const filename of files) {
      const fullPath = join(dir, filename);
      const raw = readFileSync(fullPath, 'utf-8');
      const format = filename.endsWith('.json') ? 'json' : 'yaml';
      let parsed: any;
      try {
        parsed = format === 'json' ? JSON.parse(raw) : yaml.load(raw);
      } catch (error) {
        this.logger.error(
          `Failed to parse activity catalog file ${fullPath}`,
          (error as Error).stack ?? String(error),
        );
        continue;
      }
      const entry = this.normalizeEntry(parsed, fullPath);
      if (!entry) {
        continue;
      }
      entries.push(entry);
    }
    return entries;
  }

  private loadDefaultsOnce(): void {
    if (this.defaultsLoaded) {
      return;
    }
    this.defaultsLoaded = true;
    this.defaultEntries.push(...this.loadDefaultEntries());
  }

  private normalizeEntry(raw: any, source: string): ActivityCatalogEntry | null {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (!id) {
      this.logger.warn(`Skipping activity catalog file without id: ${source}`);
      return null;
    }
    const label = typeof raw?.label === 'string' && raw.label.trim().length ? raw.label.trim() : id;
    const description = typeof raw?.description === 'string' ? raw.description.trim() : undefined;
    const appliesTo = Array.isArray(raw?.appliesTo)
      ? raw.appliesTo.map((entry: any) => String(entry).trim()).filter(Boolean)
      : [];
    const relevantFor = Array.isArray(raw?.relevantFor)
      ? raw.relevantFor.map((entry: any) => String(entry).trim()).filter(Boolean)
      : appliesTo;
    const category = typeof raw?.category === 'string' ? raw.category.trim() : '';
    const timeMode = typeof raw?.timeMode === 'string' ? raw.timeMode.trim() : '';
    const fields = Array.isArray(raw?.fields) ? raw.fields.map((entry: any) => String(entry).trim()).filter(Boolean) : [];
    const defaultDurationMinutes =
      typeof raw?.defaultDurationMinutes === 'number'
        ? raw.defaultDurationMinutes
        : typeof raw?.defaultDurationMinutes === 'string'
          ? Number.parseInt(raw.defaultDurationMinutes, 10)
          : 0;
    const attributes =
      raw?.attributes && typeof raw.attributes === 'object' && !Array.isArray(raw.attributes)
        ? (raw.attributes as Record<string, unknown>)
        : undefined;
    const meta =
      raw?.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)
        ? (raw.meta as Record<string, unknown>)
        : undefined;
    if (!category || !timeMode) {
      this.logger.warn(`Skipping activity catalog entry ${id} (missing category/timeMode) from ${source}`);
      return null;
    }
    return {
      id,
      label,
      description,
      appliesTo,
      relevantFor,
      category,
      timeMode,
      fields,
      defaultDurationMinutes: Number.isFinite(defaultDurationMinutes) ? defaultDurationMinutes : 0,
      attributes,
      meta,
    };
  }

  private mergeDefaultAttributes(
    entries: ActivityCatalogEntry[],
    defaults: ActivityCatalogEntry[],
  ): { entries: ActivityCatalogEntry[]; toUpsert: ActivityCatalogEntry[] } {
    const defaultById = new Map(defaults.map((entry) => [entry.id, entry] as const));
    const toUpsert: ActivityCatalogEntry[] = [];
    const mergedEntries = entries.map((entry) => {
      const fallback = defaultById.get(entry.id);
      if (!fallback) {
        return entry;
      }
      const fallbackAttrs =
        fallback.attributes && typeof fallback.attributes === 'object' && !Array.isArray(fallback.attributes)
          ? (fallback.attributes as Record<string, unknown>)
          : null;
      const attrs =
        entry.attributes && typeof entry.attributes === 'object' && !Array.isArray(entry.attributes)
          ? (entry.attributes as Record<string, unknown>)
          : {};
      let changed = false;

      let mergedAttributes: Record<string, unknown> | undefined;
      if (fallbackAttrs && Object.keys(fallbackAttrs).length > 0) {
        mergedAttributes = { ...fallbackAttrs };
        Object.entries(attrs).forEach(([key, value]) => {
          mergedAttributes![key] = value;
        });
        Object.keys(fallbackAttrs).forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(attrs, key)) {
            changed = true;
          }
        });
      }

      const fallbackFields = Array.isArray(fallback.fields) ? fallback.fields : [];
      const existingFields = Array.isArray(entry.fields) ? entry.fields : [];
      let mergedFields = existingFields;
      if (fallbackFields.length) {
        const normalizedFallback = fallbackFields.map((field) => `${field ?? ''}`.trim()).filter(Boolean);
        const fallbackSet = new Set(normalizedFallback);
        const extras = existingFields
          .map((field) => `${field ?? ''}`.trim())
          .filter((field) => field.length > 0 && !fallbackSet.has(field));
        const nextFields = [...normalizedFallback, ...extras];
        const fieldsChanged =
          nextFields.length !== existingFields.length ||
          nextFields.some((field, index) => field !== existingFields[index]);
        if (fieldsChanged) {
          mergedFields = nextFields;
          changed = true;
        }
      }

      if (!changed) {
        return entry;
      }

      const next: ActivityCatalogEntry = {
        ...entry,
        fields: mergedFields,
        attributes: mergedAttributes ?? entry.attributes,
      };
      toUpsert.push(next);
      return next;
    });
    return { entries: mergedEntries, toUpsert };
  }

  private resolveDefaultDir(): string | null {
    const candidates = [
      join(process.cwd(), 'catalog', 'activity-catalog'),
      join(process.cwd(), 'backend', 'catalog', 'activity-catalog'),
      join(__dirname, '..', '..', '..', 'catalog', 'activity-catalog'),
      join(__dirname, '..', '..', '..', 'backend', 'catalog', 'activity-catalog'),
    ];
    for (const candidate of candidates) {
      try {
        const entries = readdirSync(candidate);
        if (entries.length >= 0) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }
}
