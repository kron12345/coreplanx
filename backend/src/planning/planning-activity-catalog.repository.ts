import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type {
  ActivityDefinition,
  ActivityFieldKey,
  ActivityTemplate,
  ActivityTypeDefinition,
  LayerGroup,
  ResourceKind,
  TranslationState,
} from './planning.types';
import type { ActivityCatalogData } from './planning.repository.types';

interface ActivityTypeDefinitionRow {
  id: string;
  label: string;
  description: string | null;
  applies_to: string[];
  relevant_for: string[];
  category: string;
  time_mode: string;
  fields: string[];
  default_duration_minutes: number;
}

interface ActivityTemplateRow {
  id: string;
  label: string;
  description: string | null;
  activity_type: string | null;
  default_duration_minutes: number | null;
  attributes: Record<string, unknown> | null;
}

interface ActivityDefinitionRow {
  id: string;
  label: string;
  description: string | null;
  activity_type: string;
  template_id: string | null;
  default_duration_minutes: number | null;
  relevant_for: string[] | null;
  attributes: Record<string, unknown> | null;
}

interface ActivityLayerGroupRow {
  id: string;
  label: string;
  sort_order: number;
  description: string | null;
}

interface ActivityTranslationRow {
  locale: string;
  translation_key: string;
  label: string | null;
  abbreviation: string | null;
}

@Injectable()
export class PlanningActivityCatalogRepository {
  private readonly logger = new Logger(PlanningActivityCatalogRepository.name);

  constructor(private readonly database: DatabaseService) {}

  get isEnabled(): boolean {
    return this.database.enabled;
  }

  async loadActivityCatalog(): Promise<ActivityCatalogData> {
    if (!this.isEnabled) {
      return this.createEmptyActivityCatalog();
    }

    const [typeResult, templateResult, definitionResult, layerResult, translationResult] =
      await Promise.all([
        this.database.query<ActivityTypeDefinitionRow>(
          `
            SELECT
              id,
              label,
              description,
              applies_to,
              relevant_for,
              category,
              time_mode,
              fields,
              default_duration_minutes
            FROM activity_type_definition
            ORDER BY id
          `,
        ),
        this.database.query<ActivityTemplateRow>(
          `
            SELECT
              id,
              label,
              description,
              activity_type,
              default_duration_minutes,
              attributes
            FROM activity_template
            ORDER BY id
          `,
        ),
        this.database.query<ActivityDefinitionRow>(
          `
            SELECT
              id,
              label,
              description,
              activity_type,
              template_id,
              default_duration_minutes,
              relevant_for,
              attributes
            FROM activity_definition
            ORDER BY id
          `,
        ),
        this.database.query<ActivityLayerGroupRow>(
          `
            SELECT id, label, sort_order, description
            FROM activity_layer_group
            ORDER BY sort_order, id
          `,
        ),
        this.database.query<ActivityTranslationRow>(
          `
            SELECT locale, translation_key, label, abbreviation
            FROM activity_translation
            ORDER BY locale, translation_key
          `,
        ),
      ]);

    return {
      types: typeResult.rows.map((row) => this.mapActivityTypeDefinition(row)),
      templates: templateResult.rows.map((row) => this.mapActivityTemplate(row)),
      definitions: definitionResult.rows.map((row) => this.mapActivityDefinition(row)),
      layerGroups: layerResult.rows.map((row) => this.mapActivityLayerGroup(row)),
      translations: this.mapTranslations(translationResult.rows),
    };
  }

  async replaceActivityCatalog(catalog: ActivityCatalogData): Promise<void> {
    if (!this.isEnabled) {
      return;
    }
    await this.database.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM activity_definition');
        await client.query('DELETE FROM activity_template');
        await client.query('DELETE FROM activity_type_definition');
        await client.query('DELETE FROM activity_layer_group');
        await client.query('DELETE FROM activity_translation');

        if (catalog.layerGroups.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  "order" INTEGER,
                  description TEXT
                )
              )
              INSERT INTO activity_layer_group (
                id,
                label,
                sort_order,
                description
              )
              SELECT
                id,
                label,
                COALESCE("order", 0),
                description
              FROM incoming
            `,
            [JSON.stringify(catalog.layerGroups)],
          );
        }

        if (catalog.types.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  description TEXT,
                  "appliesTo" TEXT[],
                  "relevantFor" TEXT[],
                  category TEXT,
                  "timeMode" TEXT,
                  fields TEXT[],
                  "defaultDurationMinutes" INTEGER
                )
              )
              INSERT INTO activity_type_definition (
                id,
                label,
                description,
                applies_to,
                relevant_for,
                category,
                time_mode,
                fields,
                default_duration_minutes
              )
              SELECT
                id,
                label,
                description,
                "appliesTo",
                "relevantFor",
                category,
                "timeMode",
                fields,
                COALESCE("defaultDurationMinutes", 0)
              FROM incoming
            `,
            [JSON.stringify(catalog.types)],
          );
        }

        if (catalog.templates.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  description TEXT,
                  "activityType" TEXT,
                  "defaultDurationMinutes" INTEGER,
                  attributes JSONB
                )
              )
              INSERT INTO activity_template (
                id,
                label,
                description,
                activity_type,
                default_duration_minutes,
                attributes
              )
              SELECT
                id,
                label,
                description,
                "activityType",
                "defaultDurationMinutes",
                attributes
              FROM incoming
            `,
            [JSON.stringify(catalog.templates)],
          );
        }

        if (catalog.definitions.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  label TEXT,
                  description TEXT,
                  "activityType" TEXT,
                  "templateId" TEXT,
                  "defaultDurationMinutes" INTEGER,
                  "relevantFor" TEXT[],
                  attributes JSONB
                )
              )
              INSERT INTO activity_definition (
                id,
                label,
                description,
                activity_type,
                template_id,
                default_duration_minutes,
                relevant_for,
                attributes
              )
              SELECT
                id,
                label,
                description,
                "activityType",
                "templateId",
                "defaultDurationMinutes",
                "relevantFor",
                attributes
              FROM incoming
            `,
            [JSON.stringify(catalog.definitions)],
          );
        }

        const translationRows = this.flattenTranslations(catalog.translations);
        if (translationRows.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  locale TEXT,
                  translation_key TEXT,
                  label TEXT,
                  abbreviation TEXT
                )
              )
              INSERT INTO activity_translation (
                locale,
                translation_key,
                label,
                abbreviation
              )
              SELECT locale, translation_key, label, abbreviation
              FROM incoming
            `,
            [JSON.stringify(translationRows)],
          );
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        this.logger.error(
          'Fehler beim Speichern des Activity-Katalogs',
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    });
  }

  private createEmptyActivityCatalog(): ActivityCatalogData {
    return {
      types: [],
      templates: [],
      definitions: [],
      layerGroups: [],
      translations: {},
    };
  }

  private mapActivityTypeDefinition(row: ActivityTypeDefinitionRow): ActivityTypeDefinition {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      appliesTo: this.toResourceKinds(row.applies_to),
      relevantFor: this.toResourceKinds(row.relevant_for),
      category: row.category as ActivityTypeDefinition['category'],
      timeMode: row.time_mode as ActivityTypeDefinition['timeMode'],
      fields: this.toActivityFields(row.fields),
      defaultDurationMinutes: row.default_duration_minutes,
    };
  }

  private mapActivityTemplate(row: ActivityTemplateRow): ActivityTemplate {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      activityType: row.activity_type ?? undefined,
      defaultDurationMinutes: row.default_duration_minutes ?? undefined,
      attributes: row.attributes ?? undefined,
    };
  }

  private mapActivityDefinition(row: ActivityDefinitionRow): ActivityDefinition {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      activityType: row.activity_type,
      templateId: row.template_id ?? undefined,
      defaultDurationMinutes: row.default_duration_minutes ?? undefined,
      relevantFor: this.toResourceKinds(row.relevant_for),
      attributes: row.attributes ?? undefined,
    };
  }

  private mapActivityLayerGroup(row: ActivityLayerGroupRow): LayerGroup {
    return {
      id: row.id,
      label: row.label,
      order: row.sort_order ?? undefined,
      description: row.description ?? undefined,
    };
  }

  private mapTranslations(rows: ActivityTranslationRow[]): TranslationState {
    const state: TranslationState = {};
    rows.forEach((row) => {
      const localeBucket = state[row.locale] ?? {};
      localeBucket[row.translation_key] = {
        label: row.label ?? undefined,
        abbreviation: row.abbreviation ?? undefined,
      };
      state[row.locale] = localeBucket;
    });
    return state;
  }

  private flattenTranslations(state: TranslationState): ActivityTranslationRow[] {
    const rows: ActivityTranslationRow[] = [];
    Object.entries(state ?? {}).forEach(([locale, entries]) => {
      if (!locale) {
        return;
      }
      Object.entries(entries ?? {}).forEach(([key, value]) => {
        if (!key) {
          return;
        }
        rows.push({
          locale,
          translation_key: key,
          label: value?.label ?? null,
          abbreviation: value?.abbreviation ?? null,
        });
      });
    });
    return rows;
  }

  private toResourceKinds(values?: string[] | null): ResourceKind[] {
    const allowed: ResourceKind[] = [
      'personnel-service',
      'vehicle-service',
      'personnel',
      'vehicle',
    ];
    const allowedSet = new Set<ResourceKind>(allowed);
    return (values ?? [])
      .map((entry) => entry?.trim())
      .filter(
        (entry): entry is ResourceKind =>
          Boolean(entry) && allowedSet.has(entry as ResourceKind),
      );
  }

  private toActivityFields(values?: string[] | null): ActivityFieldKey[] {
    const allowed: ActivityFieldKey[] = ['start', 'end', 'from', 'to', 'remark'];
    const allowedSet = new Set<ActivityFieldKey>(allowed);
    return (values ?? [])
      .map((entry) => entry?.trim())
      .filter(
        (entry): entry is ActivityFieldKey =>
          Boolean(entry) && allowedSet.has(entry as ActivityFieldKey),
      );
  }
}

