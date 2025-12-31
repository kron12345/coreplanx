import {
  ChangeDetectionStrategy,
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  signal,
} from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CustomAttributeDefinition } from '../../../core/services/custom-attribute.service';
import { TopologyAttribute } from '../../planning-types';

export interface AttributeSavePayload {
  attributes: TopologyAttribute[];
  values: Record<string, string>;
}

interface SelectOption {
  label: string;
  value: string;
}

interface AttributeHistoryEntry {
  id: string;
  value: string;
  validFrom: string;
}

interface AttributeRowState {
  key: string;
  label: string;
  temporal: boolean;
  value: string;
  validFrom: string;
  history: AttributeHistoryEntry[];
}

const uid = () => crypto.randomUUID();

@Component({
    selector: 'app-attribute-table-editor',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ScrollingModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
        MatSelectModule,
        MatFormFieldModule,
    ],
    templateUrl: './attribute-table-editor.component.html',
    styleUrl: './attribute-table-editor.component.scss',
    animations: [
        trigger('historyDrawer', [
            transition(':enter', [
                style({ opacity: 0, transform: 'translateY(-8px)' }),
                animate('200ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
            ]),
            transition(':leave', [
                style({ opacity: 1, transform: 'translateY(0)' }),
                animate('150ms ease-in', style({ opacity: 0, transform: 'translateY(-8px)' })),
            ]),
        ]),
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AttributeTableEditorComponent implements OnChanges {
  @Input() definitions: CustomAttributeDefinition[] = [];
  @Input() attributes: TopologyAttribute[] = [];
  @Input() fallbackValues: Record<string, string> = {};
  @Input() requiredKeys: string[] = [];
  @Input() numericKeys: string[] = [];
  @Input() actionKeys: string[] = [];
  @Input() selectOptions: Record<string, SelectOption[]> = {};
  @Input() multiSelectOptions: Record<string, SelectOption[]> = {};
  @Output() attributesChange = new EventEmitter<AttributeSavePayload>();
  @Output() valueChange = new EventEmitter<Record<string, string>>();
  @Output() actionTriggered = new EventEmitter<string>();

  readonly rows = signal<AttributeRowState[]>([]);
  readonly historyDrawerFor = signal<string | null>(null);
  private snapshot: AttributeRowState[] = [];
  private readonly multiSelectCache = new Map<string, { raw: string; parsed: string[] }>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['definitions'] || changes['attributes'] || changes['fallbackValues']) {
      this.buildRows();
    }
  }

  updateRowField(key: string, field: 'value' | 'validFrom', next: string): void {
    this.rows.update((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              [field]: next,
            }
          : row,
      ),
    );
    this.emitValueSnapshot();
  }

  addHistoryEntry(key: string): void {
    this.rows.update((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              history: [{ id: uid(), value: '', validFrom: '' }, ...row.history],
            }
          : row,
      ),
    );
    this.historyDrawerFor.set(key);
  }

  updateHistoryEntry(key: string, id: string, field: 'value' | 'validFrom', next: string): void {
    this.rows.update((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              history: row.history.map((entry) =>
                entry.id === id
                  ? {
                      ...entry,
                      [field]: next,
                    }
                  : entry,
              ),
            }
          : row,
      ),
    );
  }

  removeHistoryEntry(key: string, id: string): void {
    this.rows.update((current) =>
      current.map((row) =>
        row.key === key
          ? {
              ...row,
              history: row.history.filter((entry) => entry.id !== id),
            }
          : row,
      ),
    );
  }

  moveHistoryEntry(key: string, id: string, direction: number): void {
    this.rows.update((current) =>
      current.map((row) => {
        if (row.key !== key) {
          return row;
        }
        const index = row.history.findIndex((entry) => entry.id === id);
        if (index < 0) {
          return row;
        }
        const target = index + direction;
        if (target < 0 || target >= row.history.length) {
          return row;
        }
        const nextHistory = [...row.history];
        const [entry] = nextHistory.splice(index, 1);
        nextHistory.splice(target, 0, entry);
        return {
          ...row,
          history: nextHistory,
        };
      }),
    );
  }

  saveRow(_key: string): void {
    const payload: AttributeSavePayload = {
      attributes: this.collectAttributes(),
      values: this.currentValueMap(),
    };
    this.snapshot = this.rows().map((row) => this.cloneRow(row));
    this.attributesChange.emit(payload);
  }

  resetRow(key: string): void {
    const original = this.snapshot.find((row) => row.key === key);
    if (!original) {
      return;
    }
    this.rows.update((current) =>
      current.map((row) => (row.key === key ? this.cloneRow(original) : row)),
    );
    this.emitValueSnapshot();
  }

  toggleHistory(key: string): void {
    this.historyDrawerFor.set(this.historyDrawerFor() === key ? null : key);
  }

  isFirstHistoryEntry(key: string, id: string): boolean {
    const row = this.rows().find((entry) => entry.key === key);
    return !row || row.history[0]?.id === id;
  }

  isLastHistoryEntry(key: string, id: string): boolean {
    const row = this.rows().find((entry) => entry.key === key);
    return !row || row.history[row.history.length - 1]?.id === id;
  }

  hasError(key: string): boolean {
    const value = this.currentValueMap()[key]?.trim() ?? '';
    if (this.requiredKeys.includes(key)) {
      if (!value) {
        return true;
      }
    }
    if (this.numericKeys.includes(key)) {
      if (!value || !Number.isFinite(Number(value))) {
        return true;
      }
    }
    return false;
  }

  hasSelectOptions(key: string): boolean {
    const options = this.selectOptions[key];
    return Array.isArray(options) && options.length > 0;
  }

  hasMultiSelectOptions(key: string): boolean {
    const options = this.multiSelectOptions[key];
    return Array.isArray(options) && options.length > 0;
  }

  multiSelectModel(key: string, value: string): string[] {
    const raw = (value ?? '').toString();
    const cached = this.multiSelectCache.get(key);
    if (cached && cached.raw === raw) {
      return cached.parsed;
    }
    const parsed = raw
      ? raw
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];
    this.multiSelectCache.set(key, { raw, parsed });
    return parsed;
  }

  updateMultiSelectRow(key: string, next: string[] | null | undefined): void {
    const normalized = Array.isArray(next) ? next : [];
    const cleaned = normalized.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    const value = cleaned.join(', ');
    this.multiSelectCache.set(key, { raw: value, parsed: cleaned });
    this.updateRowField(key, 'value', value);
  }

  trackOption(_index: number, option: SelectOption): string {
    return option.value;
  }

  private buildRows(): void {
    this.multiSelectCache.clear();
    const defs = this.definitions;
    if (!defs || defs.length === 0) {
      this.rows.set([]);
      this.snapshot = [];
      return;
    }
    const grouped = new Map<string, TopologyAttribute[]>();
    (this.attributes ?? []).forEach((attr) => {
      const list = grouped.get(attr.key) ?? [];
      list.push({ ...attr });
      grouped.set(attr.key, list);
    });
    grouped.forEach((list, key) => {
      list.sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''));
      grouped.set(key, list);
    });

    const rows = defs.map((definition) => {
      const entries = grouped.get(definition.key) ?? [];
      if (entries.length === 0) {
        const fallbackValue = this.fallbackValues[definition.key] ?? '';
        entries.push({ key: definition.key, value: fallbackValue, validFrom: undefined });
      }
      const [current, ...history] = entries;
      return {
        key: definition.key,
        label: definition.label,
        temporal: !!definition.temporal,
        value: current?.value ?? '',
        validFrom: current?.validFrom ?? '',
        history: history.map((entry) => this.toHistoryEntry(entry)),
      };
    });

    this.rows.set(rows);
    this.snapshot = rows.map((row) => this.cloneRow(row));
    this.emitValueSnapshot();
    this.historyDrawerFor.set(null);
  }

  private collectAttributes(): TopologyAttribute[] {
    const result: TopologyAttribute[] = [];
    this.rows().forEach((row) => {
      const entries = [
        { value: row.value, validFrom: row.validFrom },
        ...row.history.map((entry) => ({ value: entry.value, validFrom: entry.validFrom })),
      ].filter((entry) => entry.value && entry.value.trim().length > 0);

      entries
        .sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''))
        .forEach((entry) =>
          result.push({
            key: row.key,
            value: entry.value.trim(),
            validFrom: entry.validFrom || undefined,
          }),
        );
    });
    return result;
  }

  private currentValueMap(): Record<string, string> {
    return this.rows().reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value ?? '';
      return acc;
    }, {});
  }

  private emitValueSnapshot(): void {
    this.valueChange.emit(this.currentValueMap());
  }

  private cloneRow(row: AttributeRowState): AttributeRowState {
    return {
      ...row,
      history: row.history.map((entry) => ({ ...entry })),
    };
  }

  private toHistoryEntry(entry: TopologyAttribute): AttributeHistoryEntry {
    return {
      id: uid(),
      value: entry.value ?? '',
      validFrom: entry.validFrom ?? '',
    };
  }
}
