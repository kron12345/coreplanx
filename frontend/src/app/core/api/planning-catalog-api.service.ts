import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import type { ActivityTypeDefinition } from '../services/activity-type.service';
import type { ActivityDefinition, ActivityTemplate } from '../services/activity-catalog.service';
import type { LayerGroup } from '../services/layer-group.service';
import type { CustomAttributeState } from '../services/custom-attribute.service';

export type TranslationState = Record<
  string,
  Record<string, { label?: string | null; abbreviation?: string | null }>
>;

export interface ActivityCatalogSnapshot {
  types: ActivityTypeDefinition[];
  templates: ActivityTemplate[];
  definitions: ActivityDefinition[];
  layerGroups: LayerGroup[];
  translations: TranslationState;
  customAttributes: CustomAttributeState;
}

@Injectable({ providedIn: 'root' })
export class PlanningCatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  listTypes(): Promise<ActivityTypeDefinition[]> {
    return lastValueFrom(
      this.http.get<ActivityTypeDefinition[]>(`${this.baseUrl()}/planning/catalog/types`),
    ).then((res) => res ?? []);
  }

  getCatalogDefaults(): Promise<ActivityCatalogSnapshot> {
    return lastValueFrom(
      this.http.get<ActivityCatalogSnapshot>(`${this.baseUrl()}/planning/catalog/defaults`),
    );
  }

  resetCatalog(): Promise<ActivityCatalogSnapshot> {
    return lastValueFrom(
      this.http.post<ActivityCatalogSnapshot>(`${this.baseUrl()}/planning/catalog/reset`, {}),
    );
  }

  replaceTypes(payload: ActivityTypeDefinition[]): Promise<ActivityTypeDefinition[]> {
    return lastValueFrom(
      this.http.put<ActivityTypeDefinition[]>(
        `${this.baseUrl()}/planning/catalog/types`,
        payload ?? [],
      ),
    ).then((res) => res ?? []);
  }

  createType(payload: ActivityTypeDefinition): Promise<ActivityTypeDefinition> {
    return lastValueFrom(
      this.http.post<ActivityTypeDefinition>(`${this.baseUrl()}/planning/catalog/types`, payload),
    );
  }

  upsertType(typeId: string, payload: ActivityTypeDefinition): Promise<ActivityTypeDefinition> {
    return lastValueFrom(
      this.http.put<ActivityTypeDefinition>(
        `${this.baseUrl()}/planning/catalog/types/${typeId}`,
        payload,
      ),
    );
  }

  deleteType(typeId: string): Promise<void> {
    return lastValueFrom(
      this.http.delete<void>(`${this.baseUrl()}/planning/catalog/types/${typeId}`),
    );
  }

  listTemplates(): Promise<ActivityTemplate[]> {
    return lastValueFrom(
      this.http.get<ActivityTemplate[]>(`${this.baseUrl()}/planning/catalog/templates`),
    ).then((res) => res ?? []);
  }

  replaceTemplates(payload: ActivityTemplate[]): Promise<ActivityTemplate[]> {
    return lastValueFrom(
      this.http.put<ActivityTemplate[]>(
        `${this.baseUrl()}/planning/catalog/templates`,
        payload ?? [],
      ),
    ).then((res) => res ?? []);
  }

  createTemplate(payload: ActivityTemplate): Promise<ActivityTemplate> {
    return lastValueFrom(
      this.http.post<ActivityTemplate>(
        `${this.baseUrl()}/planning/catalog/templates`,
        payload,
      ),
    );
  }

  upsertTemplate(templateId: string, payload: ActivityTemplate): Promise<ActivityTemplate> {
    return lastValueFrom(
      this.http.put<ActivityTemplate>(
        `${this.baseUrl()}/planning/catalog/templates/${templateId}`,
        payload,
      ),
    );
  }

  deleteTemplate(templateId: string): Promise<void> {
    return lastValueFrom(
      this.http.delete<void>(`${this.baseUrl()}/planning/catalog/templates/${templateId}`),
    );
  }

  listDefinitions(): Promise<ActivityDefinition[]> {
    return lastValueFrom(
      this.http.get<ActivityDefinition[]>(`${this.baseUrl()}/planning/catalog/definitions`),
    ).then((res) => res ?? []);
  }

  replaceDefinitions(payload: ActivityDefinition[]): Promise<ActivityDefinition[]> {
    return lastValueFrom(
      this.http.put<ActivityDefinition[]>(
        `${this.baseUrl()}/planning/catalog/definitions`,
        payload ?? [],
      ),
    ).then((res) => res ?? []);
  }

  createDefinition(payload: ActivityDefinition): Promise<ActivityDefinition> {
    return lastValueFrom(
      this.http.post<ActivityDefinition>(
        `${this.baseUrl()}/planning/catalog/definitions`,
        payload,
      ),
    );
  }

  upsertDefinition(definitionId: string, payload: ActivityDefinition): Promise<ActivityDefinition> {
    return lastValueFrom(
      this.http.put<ActivityDefinition>(
        `${this.baseUrl()}/planning/catalog/definitions/${definitionId}`,
        payload,
      ),
    );
  }

  deleteDefinition(definitionId: string): Promise<void> {
    return lastValueFrom(
      this.http.delete<void>(`${this.baseUrl()}/planning/catalog/definitions/${definitionId}`),
    );
  }

  listLayerGroups(): Promise<LayerGroup[]> {
    return lastValueFrom(
      this.http.get<LayerGroup[]>(`${this.baseUrl()}/planning/catalog/layers`),
    ).then((res) => res ?? []);
  }

  replaceLayerGroups(payload: LayerGroup[]): Promise<LayerGroup[]> {
    return lastValueFrom(
      this.http.put<LayerGroup[]>(`${this.baseUrl()}/planning/catalog/layers`, payload ?? []),
    ).then((res) => res ?? []);
  }

  createLayerGroup(payload: LayerGroup): Promise<LayerGroup> {
    return lastValueFrom(
      this.http.post<LayerGroup>(`${this.baseUrl()}/planning/catalog/layers`, payload),
    );
  }

  upsertLayerGroup(layerId: string, payload: LayerGroup): Promise<LayerGroup> {
    return lastValueFrom(
      this.http.put<LayerGroup>(
        `${this.baseUrl()}/planning/catalog/layers/${layerId}`,
        payload,
      ),
    );
  }

  deleteLayerGroup(layerId: string): Promise<void> {
    return lastValueFrom(
      this.http.delete<void>(`${this.baseUrl()}/planning/catalog/layers/${layerId}`),
    );
  }

  getTranslations(): Promise<TranslationState> {
    return lastValueFrom(
      this.http.get<TranslationState>(`${this.baseUrl()}/planning/catalog/translations`),
    ).then((res) => res ?? {});
  }

  replaceTranslations(payload: TranslationState): Promise<TranslationState> {
    return lastValueFrom(
      this.http.put<TranslationState>(
        `${this.baseUrl()}/planning/catalog/translations`,
        payload ?? {},
      ),
    ).then((res) => res ?? {});
  }

  getTranslationsForLocale(
    locale: string,
  ): Promise<Record<string, { label?: string | null; abbreviation?: string | null }>> {
    return lastValueFrom(
      this.http.get<Record<string, { label?: string | null; abbreviation?: string | null }>>(
        `${this.baseUrl()}/planning/catalog/translations/${locale}`,
      ),
    ).then((res) => res ?? {});
  }

  replaceTranslationsForLocale(
    locale: string,
    payload: Record<string, { label?: string | null; abbreviation?: string | null }>,
  ): Promise<Record<string, { label?: string | null; abbreviation?: string | null }>> {
    return lastValueFrom(
      this.http.put<Record<string, { label?: string | null; abbreviation?: string | null }>>(
        `${this.baseUrl()}/planning/catalog/translations/${locale}`,
        payload ?? {},
      ),
    ).then((res) => res ?? {});
  }

  deleteTranslationsForLocale(locale: string): Promise<void> {
    return lastValueFrom(
      this.http.delete<void>(`${this.baseUrl()}/planning/catalog/translations/${locale}`),
    );
  }

  getCustomAttributes(): Promise<CustomAttributeState> {
    return lastValueFrom(
      this.http.get<CustomAttributeState>(`${this.baseUrl()}/planning/catalog/custom-attributes`),
    ).then((res) => res ?? {});
  }

  replaceCustomAttributes(payload: CustomAttributeState): Promise<CustomAttributeState> {
    return lastValueFrom(
      this.http.put<CustomAttributeState>(
        `${this.baseUrl()}/planning/catalog/custom-attributes`,
        payload ?? {},
      ),
    ).then((res) => res ?? {});
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
