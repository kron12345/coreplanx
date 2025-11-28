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
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
  ],
  template: `
    <div class="attributes" *ngIf="rows().length > 0">
      <table class="attributes__table">
        <thead>
          <tr>
            <th>Gültig ab</th>
            <th>Attribut</th>
            <th>Wert</th>
            <th class="actions">Aktionen</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.key) {
            <tr [class.has-error]="hasError(row.key)">
              <td>
                <input
                  type="date"
                  [disabled]="!row.temporal"
                  [ngModel]="row.validFrom"
                  (ngModelChange)="updateRowField(row.key, 'validFrom', $event || '')"
                />
              </td>
              <td>
                <div class="attr-label">
                  <span>{{ row.label }}</span>
                  @if (actionKeys.includes(row.key)) {
                    <button
                      mat-icon-button
                      type="button"
                      (click)="actionTriggered.emit(row.key)"
                      matTooltip="Spezielle Aktion"
                    >
                      <mat-icon>open_in_new</mat-icon>
                    </button>
                  }
                  @if (row.temporal) {
                    <button
                      mat-icon-button
                      type="button"
                      (click)="toggleHistory(row.key)"
                      matTooltip="Historie anzeigen"
                    >
                      <mat-icon>
                        {{ historyDrawerFor() === row.key ? 'history_toggle_off' : 'history' }}
                      </mat-icon>
                    </button>
                  }
                </div>
              </td>
              <td>
                <ng-container *ngIf="hasSelectOptions(row.key); else textInput">
                  <mat-form-field appearance="outline" class="select-field">
                    <mat-select
                      [ngModel]="row.value"
                      (ngModelChange)="updateRowField(row.key, 'value', $event || '')"
                    >
                      <mat-option
                        *ngFor="let option of selectOptions[row.key]"
                        [value]="option.value"
                      >
                        {{ option.label }}
                      </mat-option>
                    </mat-select>
                  </mat-form-field>
                </ng-container>
                <ng-template #textInput>
                  <input
                    type="text"
                    [ngModel]="row.value"
                    (ngModelChange)="updateRowField(row.key, 'value', $event || '')"
                  />
                </ng-template>
              </td>
              <td class="row-actions">
                <button mat-icon-button color="primary" type="button" (click)="saveRow(row.key)" matTooltip="Speichern">
                  <mat-icon>check</mat-icon>
                </button>
                <button mat-icon-button type="button" (click)="resetRow(row.key)" matTooltip="Zurücksetzen">
                  <mat-icon>close</mat-icon>
                </button>
              </td>
            </tr>
            @if (historyDrawerFor() === row.key) {
              <tr class="history-row" @historyDrawer>
                <td colspan="4">
                  <div class="history-panel">
                    <header>
                      <span>Historie – {{ row.label }}</span>
                      <button mat-stroked-button type="button" (click)="addHistoryEntry(row.key)">
                        <mat-icon>add</mat-icon>
                        Eintrag hinzufügen
                      </button>
                    </header>
                    <div class="history-list">
                      @if (row.history.length === 0) {
                        <p class="history-empty">Keine historischen Einträge vorhanden.</p>
                      } @else {
                        @for (entry of row.history; track entry.id) {
                          <div class="history-entry">
                            <input
                              type="date"
                              [ngModel]="entry.validFrom"
                              (ngModelChange)="updateHistoryEntry(row.key, entry.id, 'validFrom', $event || '')"
                            />
                            <input
                              type="text"
                              [ngModel]="entry.value"
                              (ngModelChange)="updateHistoryEntry(row.key, entry.id, 'value', $event || '')"
                            />
                            <div class="history-entry__actions">
                              <button
                                mat-icon-button
                                type="button"
                                (click)="moveHistoryEntry(row.key, entry.id, -1)"
                                [disabled]="isFirstHistoryEntry(row.key, entry.id)"
                                matTooltip="Nach oben"
                              >
                                <mat-icon>arrow_upward</mat-icon>
                              </button>
                              <button
                                mat-icon-button
                                type="button"
                                (click)="moveHistoryEntry(row.key, entry.id, 1)"
                                [disabled]="isLastHistoryEntry(row.key, entry.id)"
                                matTooltip="Nach unten"
                              >
                                <mat-icon>arrow_downward</mat-icon>
                              </button>
                              <button
                                mat-icon-button
                                type="button"
                                color="warn"
                                (click)="removeHistoryEntry(row.key, entry.id)"
                                matTooltip="Eintrag löschen"
                              >
                                <mat-icon>delete</mat-icon>
                              </button>
                            </div>
                          </div>
                        }
                      }
                    </div>
                    <div class="history-panel__actions">
                      <button mat-stroked-button type="button" (click)="toggleHistory(row.key)">Schließen</button>
                      <button mat-flat-button color="primary" type="button" (click)="saveRow(row.key)">
                        Änderungen übernehmen
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [
    `
      .attributes__table {
        width: 100%;
        border-collapse: collapse;
      }
      .attributes__table th,
      .attributes__table td {
        padding: 8px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        vertical-align: top;
      }
      .attributes__table tr.has-error {
        background: rgba(255, 138, 128, 0.12);
      }
      .row-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        align-items: center;
      }
      .attr-label {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .history-row {
        background: rgba(0, 0, 0, 0.02);
      }
      .history-panel {
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .history-entry {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) auto;
        gap: 8px;
        align-items: center;
      }
      .history-entry__actions {
        display: flex;
        gap: 4px;
      }
      .history-panel__actions {
        display: flex;
        justify-content: space-between;
      }
      .history-empty {
        font-size: 12px;
        opacity: 0.7;
      }
      .select-field {
        width: 100%;
      }
    `,
  ],
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttributeTableEditorComponent implements OnChanges {
  @Input() definitions: CustomAttributeDefinition[] = [];
  @Input() attributes: TopologyAttribute[] = [];
  @Input() fallbackValues: Record<string, string> = {};
  @Input() requiredKeys: string[] = [];
  @Input() numericKeys: string[] = [];
  @Input() actionKeys: string[] = [];
  @Input() selectOptions: Record<string, SelectOption[]> = {};
  @Output() attributesChange = new EventEmitter<AttributeSavePayload>();
  @Output() valueChange = new EventEmitter<Record<string, string>>();
  @Output() actionTriggered = new EventEmitter<string>();

  readonly rows = signal<AttributeRowState[]>([]);
  readonly historyDrawerFor = signal<string | null>(null);
  private snapshot: AttributeRowState[] = [];

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

  private buildRows(): void {
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
