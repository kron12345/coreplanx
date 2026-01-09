import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type {
  ActivityAttributeValue,
  ActivityDefinition,
  ActivityTemplate,
  CustomAttributeDefinition,
  CustomAttributeState,
  LayerGroup,
  ResourceKind,
  TranslationState,
} from './planning.types';
import type { ActivityCatalogData } from './planning.repository.types';

interface ActivityTemplateRow {
  id: string;
  label: string;
  description: string | null;
  activity_type: string | null;
  default_duration_minutes: number | null;
  attributes: unknown | null;
}

interface ActivityDefinitionRow {
  id: string;
  label: string;
  description: string | null;
  activity_type: string;
  template_id: string | null;
  default_duration_minutes: number | null;
  relevant_for: string[] | null;
  attributes: unknown | null;
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

interface CustomAttributeDefinitionRow {
  id: string;
  entity_id: string;
  key: string;
  label: string;
  type: string;
  description: string | null;
  temporal: boolean | null;
  required: boolean | null;
  created_at: string | null;
  updated_at: string | null;
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

    const [
      templateResult,
      definitionResult,
      layerResult,
      translationResult,
      customAttributeResult,
    ] = await Promise.all([
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
      this.database.query<CustomAttributeDefinitionRow>(
        `
          SELECT
            id,
            entity_id,
            key,
            label,
            type,
            description,
            temporal,
            required,
            created_at,
            updated_at
          FROM custom_attribute_definition
          ORDER BY entity_id, key
        `,
      ),
    ]);

    return {
      templates: templateResult.rows.map((row) => this.mapActivityTemplate(row)),
      definitions: definitionResult.rows.map((row) => this.mapActivityDefinition(row)),
      layerGroups: layerResult.rows.map((row) => this.mapActivityLayerGroup(row)),
      translations: this.mapTranslations(translationResult.rows),
      customAttributes: this.mapCustomAttributes(customAttributeResult.rows),
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
        await client.query('DELETE FROM activity_layer_group');
        await client.query('DELETE FROM activity_translation');
        await client.query('DELETE FROM custom_attribute_definition');

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

        const customAttributeRows = this.flattenCustomAttributes(catalog.customAttributes);
        if (customAttributeRows.length) {
          await client.query(
            `
              WITH incoming AS (
                SELECT *
                FROM jsonb_to_recordset($1::jsonb) AS t(
                  id TEXT,
                  entity_id TEXT,
                  key TEXT,
                  label TEXT,
                  type TEXT,
                  description TEXT,
                  temporal BOOLEAN,
                  required BOOLEAN,
                  "createdAt" TIMESTAMPTZ,
                  "updatedAt" TIMESTAMPTZ
                )
              )
              INSERT INTO custom_attribute_definition (
                id,
                entity_id,
                key,
                label,
                type,
                description,
                temporal,
                required,
                created_at,
                updated_at
              )
              SELECT
                id,
                entity_id,
                key,
                label,
                type,
                description,
                COALESCE(temporal, false),
                COALESCE(required, false),
                COALESCE("createdAt", now()),
                COALESCE("updatedAt", now())
              FROM incoming
            `,
            [JSON.stringify(customAttributeRows)],
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
      templates: [],
      definitions: [],
      layerGroups: [],
      translations: {},
      customAttributes: {},
    };
  }

  private mapActivityTemplate(row: ActivityTemplateRow): ActivityTemplate {
    return {
      id: row.id,
      label: row.label,
      description: row.description ?? undefined,
      activityType: row.activity_type ?? undefined,
      defaultDurationMinutes: row.default_duration_minutes ?? undefined,
      attributes: this.normalizeAttributeList(row.attributes),
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
      attributes: this.normalizeAttributeList(row.attributes),
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

  private mapCustomAttributes(rows: CustomAttributeDefinitionRow[]): CustomAttributeState {
    const state: CustomAttributeState = {};
    rows.forEach((row) => {
      const bucket = state[row.entity_id] ?? [];
      bucket.push({
        id: row.id,
        key: row.key,
        label: row.label,
        type: row.type as CustomAttributeDefinition['type'],
        description: row.description ?? undefined,
        entityId: row.entity_id,
        createdAt: row.created_at ?? undefined,
        updatedAt: row.updated_at ?? undefined,
        temporal: row.temporal ?? undefined,
        required: row.required ?? undefined,
      });
      state[row.entity_id] = bucket;
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

  private flattenCustomAttributes(state: CustomAttributeState): CustomAttributeDefinitionRow[] {
    const rows: CustomAttributeDefinitionRow[] = [];
    Object.entries(state ?? {}).forEach(([entityId, entries]) => {
      if (!entityId) {
        return;
      }
      (entries ?? []).forEach((entry) => {
        if (!entry?.id) {
          return;
        }
        rows.push({
          id: entry.id,
          entity_id: entityId,
          key: entry.key,
          label: entry.label,
          type: entry.type,
          description: entry.description ?? null,
          temporal: entry.temporal ?? null,
          required: entry.required ?? null,
          created_at: entry.createdAt ?? null,
          updated_at: entry.updatedAt ?? null,
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

  private normalizeAttributeList(value?: unknown): ActivityAttributeValue[] {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      const list: ActivityAttributeValue[] = [];
      value.forEach((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return;
        }
        const key = (entry as { key?: unknown }).key;
        if (typeof key !== 'string' || !key.trim()) {
          return;
        }
        const metaValue = (entry as { meta?: unknown }).meta;
        const meta =
          metaValue && typeof metaValue === 'object' && !Array.isArray(metaValue)
            ? { ...(metaValue as Record<string, unknown>) }
            : undefined;
        list.push({ key: key.trim(), meta });
      });
      return list;
    }
    if (typeof value === 'object') {
      const list: ActivityAttributeValue[] = [];
      Object.entries(value as Record<string, unknown>).forEach(([key, metaValue]) => {
        if (!key.trim()) {
          return;
        }
        if (metaValue && typeof metaValue === 'object' && !Array.isArray(metaValue)) {
          list.push({ key: key.trim(), meta: { ...(metaValue as Record<string, unknown>) } });
        } else {
          list.push({
            key: key.trim(),
            meta:
              metaValue === undefined || metaValue === null
                ? undefined
                : { value: String(metaValue) },
          });
        }
      });
      return list;
    }
    return [];
  }
}
