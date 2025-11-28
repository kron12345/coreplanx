import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AttributeEntityEditorComponent,
  AttributeEntityRecord,
  EntitySaveEvent,
} from '../../../../shared/components/attribute-entity-editor/attribute-entity-editor.component';
import { CustomAttributeDefinition } from '../../../../core/services/custom-attribute.service';
import { TimetableYearService } from '../../../../core/services/timetable-year.service';
import { TimetableYearRecord } from '../../../../core/models/timetable-year.model';

const TIMETABLE_YEAR_DEFINITIONS: CustomAttributeDefinition[] = [
  {
    id: 'tty-label',
    key: 'label',
    label: 'Label',
    type: 'string',
    entityId: 'timetable-years',
    required: true,
  },
  {
    id: 'tty-start',
    key: 'startIso',
    label: 'Beginn (inkl.)',
    type: 'date',
    entityId: 'timetable-years',
    required: true,
  },
  {
    id: 'tty-end',
    key: 'endIso',
    label: 'Ende (inkl.)',
    type: 'date',
    entityId: 'timetable-years',
    required: true,
  },
  {
    id: 'tty-description',
    key: 'description',
    label: 'Beschreibung',
    type: 'string',
    entityId: 'timetable-years',
  },
];

const DEFAULT_VALUES = {
  label: 'Fahrplanjahr 2025/26',
  startIso: '2024-12-15',
  endIso: '2025-12-13',
  description: 'Referenzfahrplan für das Jahr 2025/26',
};

@Component({
  selector: 'app-timetable-year-master-editor',
  standalone: true,
  imports: [CommonModule, AttributeEntityEditorComponent],
  templateUrl: './timetable-year-master-editor.component.html',
  styleUrl: './timetable-year-master-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimetableYearMasterEditorComponent {
  private readonly timetableYears = inject(TimetableYearService);

  readonly definitions = TIMETABLE_YEAR_DEFINITIONS;
  readonly defaults = DEFAULT_VALUES;
  readonly requiredKeys = ['label', 'startIso', 'endIso'];
  readonly error = signal<string | null>(null);

  readonly records = computed<AttributeEntityRecord[]>(() =>
    this.timetableYears.listManagedYearRecords().map((record) => this.toAttributeRecord(record)),
  );

  readonly createDefaultsFactory = () => {
    const defaults = this.timetableYears.nextDefaultRecord();
    return {
      label: defaults.label ?? '',
      startIso: defaults.startIso ?? '',
      endIso: defaults.endIso ?? '',
      description: defaults.description ?? '',
    };
  };

  handleSave(event: EntitySaveEvent): void {
    const values = event.payload.values;
    const label = (values['label'] ?? '').trim();
    const startIso = this.normalizeIso(values['startIso']);
    let endIso = this.normalizeIso(values['endIso']);
    if (!label) {
      this.error.set('Label darf nicht leer sein.');
      return;
    }
    if (!startIso) {
      this.error.set('Beginn ist erforderlich.');
      return;
    }
    if (!endIso) {
      endIso = startIso;
    }
    if (endIso < startIso) {
      endIso = startIso;
    }
    const payload: TimetableYearRecord = {
      id: event.entityId ?? this.generateId(),
      label,
      startIso,
      endIso,
      description: this.clean(values['description']),
    };
    const list = this.timetableYears.listManagedYearRecords();
    const index = list.findIndex((entry) => entry.id === payload.id);
    const next =
      index >= 0 ? list.map((entry, i) => (i === index ? payload : entry)) : [...list, payload];
    this.timetableYears.syncManagedYears(next);
    this.error.set(null);
  }

  handleDelete(ids: string[]): void {
    if (!ids.length) {
      return;
    }
    const set = new Set(ids);
    const remaining = this.timetableYears
      .listManagedYearRecords()
      .filter((record) => !set.has(record.id));
    this.timetableYears.syncManagedYears(remaining);
    this.error.set(null);
  }

  private toAttributeRecord(record: TimetableYearRecord): AttributeEntityRecord {
    return {
      id: record.id,
      label: record.label ?? record.id,
      secondaryLabel: this.formatRange(record),
      attributes: [],
      fallbackValues: {
        label: record.label ?? '',
        startIso: record.startIso ?? '',
        endIso: record.endIso ?? '',
        description: record.description ?? '',
      },
    };
  }

  private formatRange(record: TimetableYearRecord): string {
    if (record.startIso && record.endIso) {
      return `${record.startIso} – ${record.endIso}`;
    }
    if (record.startIso) {
      return `${record.startIso} – ?`;
    }
    if (record.endIso) {
      return `? – ${record.endIso}`;
    }
    return '—';
  }

  private normalizeIso(value: string | undefined): string {
    if (!value) {
      return '';
    }
    const trimmed = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
  }

  private clean(value: string | undefined): string | undefined {
    const trimmed = (value ?? '').trim();
    return trimmed.length ? trimmed : undefined;
  }

  private generateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `ty-${crypto.randomUUID()}`;
    }
    return `ty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }
}
