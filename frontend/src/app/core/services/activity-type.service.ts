import { Injectable, Signal, computed, signal } from '@angular/core';
import { ResourceKind } from '../../models/resource';
import { ActivityCatalogApiService } from '../api/activity-catalog-api.service';

export type ActivityFieldKey = 'start' | 'end' | 'from' | 'to' | 'remark';
export type ActivityCategory = 'rest' | 'movement' | 'service' | 'other';
export type ActivityTimeMode = 'duration' | 'range' | 'point';

export interface ActivityTypeDefinition {
  id: string;
  label: string;
  description?: string;
  appliesTo: ResourceKind[];
  relevantFor: ResourceKind[];
  category: ActivityCategory;
  timeMode: ActivityTimeMode;
  fields: ActivityFieldKey[];
  defaultDurationMinutes: number;
  attributes?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export interface ActivityTypeInput {
  id: string;
  label: string;
  description?: string;
  appliesTo: ResourceKind[];
  relevantFor?: ResourceKind[];
  category?: ActivityCategory;
  timeMode?: ActivityTimeMode;
  fields: ActivityFieldKey[];
  defaultDurationMinutes: number;
  attributes?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

const STORAGE_KEY = 'activity-type-definitions.v1';

const DEFAULT_TYPES: ActivityTypeDefinition[] = [
  {
    id: 'service',
    label: 'Dienstleistung',
    description: 'Standardaktivität innerhalb eines Dienstes.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 120,
    attributes: { is_within_service: 'yes', consider_location_conflicts: true, color: '#1976d2' },
  },
  {
    id: 'rest-day',
    label: 'Ruhetag',
    description: 'Ganztägiger Ruhetag ohne Ortsangaben.',
    appliesTo: ['personnel', 'personnel-service'],
    relevantFor: ['personnel', 'personnel-service'],
    category: 'rest',
    timeMode: 'range',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 24 * 60,
    attributes: {
      is_within_service: 'no',
      is_absence: true,
      consider_capacity_conflicts: false,
      consider_location_conflicts: false,
      color: '#8d6e63',
    },
  },
  {
    id: 'vacation',
    label: 'Ferien',
    description: 'Urlaubszeitraum für Personalressourcen.',
    appliesTo: ['personnel', 'personnel-service'],
    relevantFor: ['personnel', 'personnel-service'],
    category: 'rest',
    timeMode: 'range',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 24 * 60,
    attributes: {
      is_within_service: 'no',
      is_absence: true,
      consider_capacity_conflicts: false,
      consider_location_conflicts: false,
      color: '#6d4c41',
    },
  },
  {
    id: 'maintenance',
    label: 'Werkstattbuchung',
    description: 'Werkstattaufenthalt inkl. Ort und Zeitraum.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'range',
    fields: ['from', 'start', 'end', 'remark'],
    defaultDurationMinutes: 8 * 60,
    attributes: {
      is_within_service: 'no',
      is_maintenance: true,
      requires_vehicle: true,
      consider_capacity_conflicts: false,
      consider_location_conflicts: false,
      color: '#455a64',
    },
  },
  {
    id: 'service-start',
    label: 'Dienstanfang',
    description: 'Startleistung mit exaktem Ort und Übergabe.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'point',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 45,
    attributes: {
      is_service_start: true,
      is_within_service: 'yes',
      to_hidden: true,
      to_location_mode: 'previous',
      color: '#43a047',
    },
  },
  {
    id: 'crew-change',
    label: 'Personalwechsel',
    description: 'Übergabe zwischen zwei Personalen an einem Bahnhof.',
    appliesTo: ['personnel', 'personnel-service'],
    relevantFor: ['personnel', 'personnel-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'remark'],
    defaultDurationMinutes: 20,
    attributes: { is_within_service: 'yes', is_crew_change: true, color: '#5e35b1' },
  },
  {
    id: 'service-end',
    label: 'Dienstende',
    description: 'Abschlussleistung mit Ziel und Bemerkung.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'point',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 45,
    attributes: {
      is_service_end: true,
      is_within_service: 'yes',
      to_hidden: true,
      to_location_mode: 'previous',
      color: '#c62828',
    },
  },
  {
    id: 'break',
    label: 'Pause',
    description: 'Reguläre Pause innerhalb eines Dienstes.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 30,
    attributes: {
      is_break: true,
      is_within_service: 'yes',
      to_hidden: true,
      to_location_mode: 'previous',
      consider_capacity_conflicts: true,
      color: '#ffb74d',
    },
  },
  {
    id: 'short-break',
    label: 'Kurzpause (Arbeitsunterbrechung)',
    description: 'Arbeitsunterbrechung innerhalb eines Dienstes (gilt als Arbeitszeit).',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 15,
    attributes: {
      is_break: true,
      is_short_break: true,
      is_within_service: 'yes',
      to_hidden: true,
      to_location_mode: 'previous',
      consider_capacity_conflicts: true,
      color: '#ffe082',
    },
  },
  {
    id: 'briefing',
    label: 'Dienstbesprechung',
    description: 'Briefing oder Debriefing vor bzw. nach dem Dienst.',
    appliesTo: ['personnel', 'personnel-service'],
    relevantFor: ['personnel', 'personnel-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 20,
    attributes: { is_within_service: 'yes', is_briefing: true, color: '#3949ab' },
  },
  {
    id: 'standby',
    label: 'Bereitschaft',
    description: 'Bereitschaftszeit mit möglichen Ortsangaben.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'remark'],
    defaultDurationMinutes: 60,
    attributes: { is_within_service: 'yes', is_standby: true, color: '#6a1b9a' },
  },
  {
    id: 'commute',
    label: 'Wegezeit',
    description: 'An- oder Abreise zwischen Standorten.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 45,
    attributes: {
      is_within_service: 'yes',
      is_travel: true,
      is_commute: true,
      consider_location_conflicts: true,
      color: '#0288d1',
    },
  },
  {
    id: 'vehicle-on',
    label: 'Einschalten',
    description: 'Fahrzeug einschalten bzw. bereitstellen.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'remark'],
    defaultDurationMinutes: 15,
    attributes: { is_within_service: 'yes', requires_vehicle: true, is_vehicle_on: true, color: '#2e7d32' },
  },
  {
    id: 'vehicle-off',
    label: 'Ausschalten',
    description: 'Fahrzeug ausschalten bzw. außer Betrieb nehmen.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'remark'],
    defaultDurationMinutes: 10,
    attributes: { is_within_service: 'yes', requires_vehicle: true, is_vehicle_off: true, color: '#c62828' },
  },
  {
    id: 'shunting',
    label: 'Rangieren',
    description: 'Rangierbewegungen inkl. Quelle und Ziel.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 60,
    attributes: {
      is_within_service: 'yes',
      is_shunting: true,
      requires_vehicle: true,
      consider_location_conflicts: true,
      color: '#00838f',
    },
  },
  {
    id: 'park',
    label: 'Parken',
    description: 'Fahrzeug abstellen bzw. parken.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'remark'],
    defaultDurationMinutes: 15,
    attributes: {
      is_within_service: 'yes',
      requires_vehicle: true,
      is_parking: true,
      consider_location_conflicts: true,
      color: '#6d4c41',
    },
  },
  {
    id: 'unpark',
    label: 'Entparken',
    description: 'Fahrzeug aus dem Abstellbereich holen bzw. entparken.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 15,
    attributes: {
      is_within_service: 'yes',
      requires_vehicle: true,
      is_unparking: true,
      consider_location_conflicts: true,
      color: '#5d4037',
    },
  },
  {
    id: 'fuelling',
    label: 'Betankung',
    description: 'Betankung oder Stromaufnahme eines Fahrzeugs.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'remark'],
    defaultDurationMinutes: 30,
    attributes: { is_within_service: 'yes', is_fuelling: true, requires_vehicle: true, color: '#e64a19' },
  },
  {
    id: 'cleaning',
    label: 'Innenreinigung',
    description: 'Reinigungsarbeiten am Fahrzeug.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 45,
    attributes: { is_within_service: 'yes', is_cleaning: true, requires_vehicle: true, color: '#00897b' },
  },
  {
    id: 'transfer',
    label: 'Transfer',
    description: 'Überführung von Ressourcen zu einem anderen Ort.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 90,
    attributes: {
      is_within_service: 'yes',
      is_transfer: true,
      is_travel: true,
      consider_location_conflicts: true,
      color: '#0097a7',
    },
  },
  {
    id: 'travel',
    label: 'Fahrt',
    description: 'Geplante Fahrtleistung zwischen zwei Orten.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 60,
    attributes: {
      is_within_service: 'yes',
      is_travel: true,
      requires_vehicle: true,
      consider_location_conflicts: true,
      color: '#00796b',
    },
  },
  {
    id: 'other',
    label: 'Sonstige',
    description: 'Freie Aktivität mit allen Angaben.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'other',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 60,
    attributes: { is_within_service: 'yes', color: '#4a148c' },
  },
  {
    id: 'training',
    label: 'Schulung',
    description: 'Schulung oder Fortbildung während des Dienstplans.',
    appliesTo: ['personnel', 'personnel-service'],
    relevantFor: ['personnel', 'personnel-service'],
    category: 'other',
    timeMode: 'range',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 4 * 60,
    attributes: { is_within_service: 'yes', is_training: true, color: '#7b1fa2' },
  },
  {
    id: 'reserve-buffer',
    label: 'Reserven / Puffer',
    description: 'Geplanter Puffer zur Abfederung von Störungen.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'other',
    timeMode: 'duration',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 30,
    attributes: { is_within_service: 'yes', is_reserve: true, color: '#546e7a' },
  },
];

@Injectable({ providedIn: 'root' })
export class ActivityTypeService {
  private readonly api = new ActivityCatalogApiService();
  private readonly definitionsSignal = signal<ActivityTypeDefinition[]>(DEFAULT_TYPES);
  private loadingPromise: Promise<void> | null = null;

  readonly definitions: Signal<ActivityTypeDefinition[]> = computed(
    () => this.definitionsSignal(),
  );

  constructor() {
    void this.init();
  }

  add(input: ActivityTypeInput): void {
    const normalized = this.normalizeDefinition(input);
    this.definitionsSignal.set([...this.definitionsSignal(), normalized]);
    void this.persist();
  }

  update(id: string, patch: Partial<ActivityTypeInput>): void {
    this.definitionsSignal.set(
      this.definitionsSignal().map((definition) => {
        if (definition.id !== id) {
          return definition;
        }
        return this.normalizeDefinition({ ...definition, ...patch });
      }),
    );
    void this.persist();
  }

  remove(id: string): void {
    this.definitionsSignal.set(this.definitionsSignal().filter((definition) => definition.id !== id));
    void this.persist();
  }

  reset(): void {
    this.definitionsSignal.set(DEFAULT_TYPES);
    void this.persist();
  }

  resetToDefaults(): void {
    this.reset();
  }

  private normalizeDefinition(input: ActivityTypeInput): ActivityTypeDefinition {
    const fields = Array.from(
      new Set<ActivityFieldKey>(['start', 'end', ...input.fields.filter((field) => field !== 'start' && field !== 'end')]),
    );
    const allowedKinds: ResourceKind[] = ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'];
    const candidateKinds = input.relevantFor && input.relevantFor.length > 0 ? input.relevantFor : input.appliesTo;
    const rawKinds =
      candidateKinds && candidateKinds.length > 0 ? Array.from(new Set(candidateKinds)) : ['personnel', 'vehicle'];
    let relevantFor = rawKinds.filter((kind): kind is ResourceKind => allowedKinds.includes(kind as ResourceKind));
    if (relevantFor.length === 0) {
      relevantFor = ['personnel', 'vehicle'];
    }
    const category: ActivityCategory = this.normalizeCategory(input.category);
    const timeMode: ActivityTimeMode =
      input.timeMode === 'range' ? 'range' : input.timeMode === 'point' ? 'point' : 'duration';
    const defaultDurationMinutes = Math.max(1, Math.trunc(input.defaultDurationMinutes ?? 60));
    const attributes =
      input.attributes && typeof input.attributes === 'object' && !Array.isArray(input.attributes)
        ? input.attributes
        : undefined;
    const meta =
      input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? input.meta : undefined;
    return {
      id: this.slugify(input.id || input.label),
      label: input.label.trim(),
      description: input.description?.trim(),
      appliesTo: relevantFor,
      relevantFor,
      category,
      timeMode,
      fields,
      defaultDurationMinutes,
      attributes,
      meta,
    };
  }

  private normalizeCategory(category: ActivityCategory | undefined): ActivityCategory {
    switch (category) {
      case 'rest':
      case 'movement':
      case 'service':
      case 'other':
        return category;
      default:
        return 'other';
    }
  }

  async init(): Promise<void> {
    await this.loadFromApi();
  }

  private async loadFromApi(): Promise<void> {
    if (this.loadingPromise) {
      return this.loadingPromise;
    }
    this.loadingPromise = (async () => {
      try {
        const list = await this.api.list();
        if (Array.isArray(list) && list.length) {
          this.definitionsSignal.set(list.map((entry) => this.normalizeDefinition(entry)));
          return;
        }
        this.definitionsSignal.set(DEFAULT_TYPES);
        await this.persist();
      } catch {
        this.definitionsSignal.set(DEFAULT_TYPES);
      } finally {
        this.loadingPromise = null;
      }
    })();
    await this.loadingPromise;
  }

  private async persist(): Promise<void> {
    try {
      await this.api.replaceAll(this.definitionsSignal());
    } catch {
      // API-Fehler werden ignoriert, in-memory State bleibt bestehen.
    }
  }

  private slugify(value: string): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
