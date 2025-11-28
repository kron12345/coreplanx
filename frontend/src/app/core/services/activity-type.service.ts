import { Injectable, Signal, computed, signal } from '@angular/core';
import { ResourceKind } from '../../models/resource';

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
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 120,
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
  },
  {
    id: 'maintenance',
    label: 'Werkstattbuchung',
    description: 'Werkstattaufenthalt inkl. Ort und Zeitraum.',
    appliesTo: ['vehicle', 'vehicle-service'],
    relevantFor: ['vehicle', 'vehicle-service'],
    category: 'movement',
    timeMode: 'range',
    fields: ['from', 'start', 'end', 'remark'],
    defaultDurationMinutes: 8 * 60,
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
  },
  {
    id: 'break',
    label: 'Pause',
    description: 'Reguläre Pause innerhalb eines Dienstes.',
    appliesTo: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    relevantFor: ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 30,
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
  },
  {
    id: 'shunting',
    label: 'Rangieren',
    description: 'Rangierbewegungen inkl. Quelle und Ziel.',
    appliesTo: ['vehicle', 'vehicle-service'],
    relevantFor: ['vehicle', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'to', 'remark'],
    defaultDurationMinutes: 60,
  },
  {
    id: 'fuelling',
    label: 'Betankung',
    description: 'Betankung oder Stromaufnahme eines Fahrzeugs.',
    appliesTo: ['vehicle', 'vehicle-service'],
    relevantFor: ['vehicle', 'vehicle-service'],
    category: 'movement',
    timeMode: 'duration',
    fields: ['start', 'end', 'from', 'remark'],
    defaultDurationMinutes: 30,
  },
  {
    id: 'cleaning',
    label: 'Innenreinigung',
    description: 'Reinigungsarbeiten am Fahrzeug.',
    appliesTo: ['vehicle', 'vehicle-service'],
    relevantFor: ['vehicle', 'vehicle-service'],
    category: 'service',
    timeMode: 'duration',
    fields: ['start', 'end', 'remark'],
    defaultDurationMinutes: 45,
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
  },
];

@Injectable({ providedIn: 'root' })
export class ActivityTypeService {
  private readonly definitionsSignal = signal<ActivityTypeDefinition[]>(this.load());

  readonly definitions: Signal<ActivityTypeDefinition[]> = computed(
    () => this.definitionsSignal(),
  );

  add(input: ActivityTypeInput): void {
    const normalized = this.normalizeDefinition(input);
    this.definitionsSignal.set([...this.definitionsSignal(), normalized]);
    this.persist();
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
    this.persist();
  }

  remove(id: string): void {
    this.definitionsSignal.set(this.definitionsSignal().filter((definition) => definition.id !== id));
    this.persist();
  }

  reset(): void {
    this.definitionsSignal.set(DEFAULT_TYPES);
    this.persist();
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

  private load(): ActivityTypeDefinition[] {
    if (typeof window === 'undefined') {
      return DEFAULT_TYPES;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return DEFAULT_TYPES;
      }
      const parsed = JSON.parse(raw) as ActivityTypeDefinition[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return DEFAULT_TYPES;
      }
      return parsed.map((entry) => this.normalizeDefinition(entry));
    } catch {
      return DEFAULT_TYPES;
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.definitionsSignal()));
    } catch {
      // ignore storage errors
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
