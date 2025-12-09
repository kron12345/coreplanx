import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  EntitySaveEvent,
} from '../../../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { CustomAttributeDefinition } from '../../../../core/services/custom-attribute.service';
import { SimulationService } from '../../../../core/services/simulation.service';
import { SimulationRecord } from '../../../../core/models/simulation.model';

const SIMULATION_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'sim-label',
    key: 'label',
    label: 'Titel',
    type: 'string',
    entityId: 'simulations',
    required: true,
  },
  {
    id: 'sim-year',
    key: 'timetableYearLabel',
    label: 'Fahrplanjahr',
    type: 'string',
    entityId: 'simulations',
    required: true,
  },
  {
    id: 'sim-description',
    key: 'description',
    label: 'Beschreibung',
    type: 'string',
    entityId: 'simulations',
  },
];

const DEFAULT_VALUES = {
  label: 'Simulation (z. B. Var A)',
  timetableYearLabel: '2030/31',
  description: 'Frühe Varianten für dieses Fahrplanjahr.',
};

@Component({
  selector: 'app-simulation-master-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  templateUrl: './simulation-master-editor.component.html',
  styleUrl: './simulation-master-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimulationMasterEditorComponent {
  private readonly simulations = inject(SimulationService);

  readonly definitions = SIMULATION_DEFINITIONS;
  readonly defaults = DEFAULT_VALUES;
  readonly requiredKeys = ['label', 'timetableYearLabel'];
  readonly error = signal<string | null>(null);

  readonly records = computed<AttributeEntityRecord[]>(() =>
    this.simulations.list().map((record) => this.toAttributeRecord(record)),
  );

  readonly createDefaultsFactory = () => ({ ...DEFAULT_VALUES });

  handleSave(event: EntitySaveEvent): void {
    const values = event.payload.values;
    const label = (values['label'] ?? '').trim();
    const timetableYearLabel = (values['timetableYearLabel'] ?? '').trim();
    if (!label) {
      this.error.set('Titel ist erforderlich.');
      return;
    }
    if (!timetableYearLabel) {
      this.error.set('Fahrplanjahr ist erforderlich.');
      return;
    }
    const payload: SimulationRecord = {
      id: event.entityId ?? this.generateId(),
      label,
      timetableYearLabel,
      description: this.clean(values['description']),
    };
    this.simulations.upsert(payload);
    this.error.set(null);
  }

  handleDelete(ids: string[]): void {
    this.simulations.remove(ids);
    this.error.set(null);
  }

  private toAttributeRecord(record: SimulationRecord): AttributeEntityRecord {
    return {
      id: record.id,
      label: record.label,
      secondaryLabel: record.timetableYearLabel,
      attributes: [],
      fallbackValues: {
        label: record.label,
        timetableYearLabel: record.timetableYearLabel,
        description: record.description ?? '',
      },
    };
  }

  private clean(value: string | undefined): string | undefined {
    const trimmed = (value ?? '').trim();
    return trimmed.length ? trimmed : undefined;
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `sim-${crypto.randomUUID()}`;
    }
    return `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }
}
