import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
  OnDestroy,
  effect,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CustomAttributeDefinition,
  CustomAttributePrimitiveType,
} from '../../../core/services/custom-attribute.service';
import { TopologyAttribute } from '../../planning-types';
import {
  AttributeSavePayload,
  AttributeTableEditorComponent,
} from '../attribute-table-editor/attribute-table-editor.component';

export interface AttributeEntityRecord {
  id: string;
  label: string;
  secondaryLabel?: string;
  attributes?: TopologyAttribute[];
  fallbackValues: Record<string, string>;
}

export interface AttributeEntityGroup {
  id: string;
  label: string;
  secondaryLabel?: string;
  description?: string;
  children: AttributeEntityRecord[];
}

type AttributeEntityGroupView = {
  id: string;
  label: string;
  secondaryLabel?: string;
  description?: string;
  children: AttributeEntityRecord[];
};

export interface AttributeBulkPreset {
  label: string;
  key: string;
  value: string;
}

export interface EntitySaveEvent {
  entityId: string | null;
  payload: AttributeSavePayload;
}

export interface BulkApplyEvent {
  entityIds: string[];
  key: string;
  value: string;
  validFrom?: string;
}

export interface AttributeActionEvent {
  key: string;
  values: Record<string, string>;
}

@Component({
  selector: 'app-attribute-entity-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    AttributeTableEditorComponent,
  ],
  template: `
    <div class="editor">
      <section class="editor__list">
        <header>
          <h2>{{ title }}</h2>
          <span>{{ combinedEntities().length }} Einträge</span>
        </header>

        <div class="toolbar">
          <div class="toolbar__row">
            <mat-form-field appearance="outline" class="toolbar__search">
              <mat-label>Suchen</mat-label>
              <input
                matInput
                type="search"
                placeholder="Name, Code …"
                [ngModel]="searchTerm()"
                (ngModelChange)="searchTerm.set($event)"
              />
              <button
                mat-icon-button
                matSuffix
                *ngIf="searchTerm()"
                (click)="searchTerm.set('')"
                aria-label="Suche leeren"
              >
                <mat-icon>close</mat-icon>
              </button>
            </mat-form-field>

            <button
              mat-icon-button
              type="button"
              (click)="toggleFilters()"
              matTooltip="Filter anzeigen"
              class="toolbar__filter-button"
            >
              <mat-icon>filter_alt</mat-icon>
            </button>
          </div>

          <div class="toolbar__row toolbar__row--compact">
            <mat-form-field appearance="outline" class="toolbar__sort">
              <mat-label>Sortieren nach</mat-label>
              <mat-select [ngModel]="sortKey()" (ngModelChange)="sortKey.set($event)">
                <mat-option value="name">Name</mat-option>
                <mat-option value="secondaryLabel">Code</mat-option>
                @for (definition of attributeDefinitions; track definition.key) {
                  <mat-option [value]="definition.key">{{ definition.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" class="toolbar__sort">
              <mat-label>Richtung</mat-label>
              <mat-select [ngModel]="sortDirection()" (ngModelChange)="sortDirection.set($event)">
                <mat-option value="asc">Aufsteigend</mat-option>
                <mat-option value="desc">Absteigend</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
        </div>

        <div class="filter-panel" *ngIf="showFilters()" @filterPanel>
          <div class="filter-panel__body">
            @for (definition of attributeDefinitions; track definition.key) {
              <div class="filter-chip-field">
                <mat-form-field appearance="outline">
                  <mat-label>{{ definition.label }}</mat-label>
                  <input
                    matInput
                    placeholder="Wert hinzufügen"
                    #filterInput
                    (keyup.enter)="addFilterValue(definition.key, filterInput.value); filterInput.value = ''"
                  />
                  <button
                    mat-icon-button
                    matSuffix
                    type="button"
                    (click)="addFilterValue(definition.key, filterInput.value); filterInput.value = ''"
                  >
                    <mat-icon>add</mat-icon>
                  </button>
                </mat-form-field>
                <div class="filter-chip-field__chips">
                  @for (value of filterValuesFor(definition.key); track value) {
                    <span class="filter-chip">
                      {{ value }}
                      <button
                        mat-icon-button
                        type="button"
                        (click)="removeFilterValue(definition.key, value)"
                        aria-label="Filter entfernen"
                      >
                        <mat-icon>close</mat-icon>
                      </button>
                    </span>
                  }
                </div>
              </div>
            }
          </div>
          <div class="filter-panel__actions">
            <button mat-stroked-button type="button" (click)="clearFilters()">Filter zurücksetzen</button>
            <button mat-flat-button color="primary" type="button" (click)="applyFilters()">Filter anwenden</button>
          </div>
        </div>

        <ng-container *ngIf="groupedView().length > 0; else flatList">
          <div class="stop-list stop-list--grouped">
            @for (group of groupedView(); track group.id) {
              <div class="stop-group">
                <div class="stop-group__header" (click)="toggleGroup(group.id)">
                  <button mat-icon-button type="button" (click)="$event.stopPropagation(); toggleGroup(group.id)">
                    <mat-icon>{{ isGroupExpanded(group.id) ? 'expand_less' : 'expand_more' }}</mat-icon>
                  </button>
                  <div class="stop-group__info">
                    <div class="stop-group__name">{{ group.label }}</div>
                    <div class="stop-group__secondary">{{ group.secondaryLabel || '—' }}</div>
                  </div>
                  <span class="stop-group__count">{{ group.children.length }}</span>
                  <button
                    mat-icon-button
                    type="button"
                    matTooltip="Eintrag hinzufügen"
                    (click)="createChildForGroup(group.id, $event)"
                  >
                    <mat-icon>add</mat-icon>
                  </button>
                </div>
                <div class="stop-group__children" *ngIf="isGroupExpanded(group.id)">
                  @for (entity of group.children; track entity.id) {
                    <div class="stop-row" [class.selected]="isSelected(entity.id)">
                      <mat-checkbox
                        [checked]="isSelected(entity.id)"
                        (change)="toggleSelection(entity.id, $event.checked)"
                      ></mat-checkbox>
                      <div class="stop-row__info" (click)="openSingle(entity.id)">
                        <div class="stop-row__name">{{ entity.label }}</div>
                        <div class="stop-row__secondary">{{ entity.secondaryLabel || '—' }}</div>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </ng-container>

        <ng-template #flatList>
          <ng-container *ngIf="filteredEntities().length > 0; else emptyState">
            <div class="stop-list">
              @for (entity of filteredEntities(); track entity.id) {
                <div class="stop-row" [class.selected]="isSelected(entity.id)">
                  <mat-checkbox
                    [checked]="isSelected(entity.id)"
                    (change)="toggleSelection(entity.id, $event.checked)"
                  ></mat-checkbox>
                  <div class="stop-row__info" (click)="openSingle(entity.id)">
                    <div class="stop-row__name">{{ entity.label }}</div>
                    <div class="stop-row__secondary">{{ entity.secondaryLabel || '—' }}</div>
                  </div>
                </div>
              }
            </div>
          </ng-container>
        </ng-template>

        <ng-template #emptyState>
          <div class="stop-empty">
            <mat-icon>map_off</mat-icon>
            <strong>Keine Einträge gefunden</strong>
            <span>Filter anpassen oder neue Daten hinzufügen.</span>
            <button mat-stroked-button type="button" (click)="resetView()">Ansicht zurücksetzen</button>
          </div>
        </ng-template>

        <button mat-stroked-button color="primary" type="button" (click)="createNew()">
          <mat-icon>add</mat-icon>
          Neu anlegen
        </button>

        <section class="bulk-panel" *ngIf="selectedIds().length > 1" @bulkPanel>
          <header>
            <div>
              <strong>{{ selectedIds().length }} Elemente ausgewählt</strong>
            </div>
            <button mat-icon-button type="button" matTooltip="Auswahl leeren" (click)="clearSelection()">
              <mat-icon>clear_all</mat-icon>
            </button>
          </header>

          <div class="bulk-panel__form">
            <mat-form-field appearance="outline">
              <mat-label>Attribut</mat-label>
              <mat-select
                [ngModel]="bulkAttributeKey()"
                (ngModelChange)="bulkAttributeKey.set($event)"
              >
                <mat-option value="">Bitte wählen</mat-option>
                @for (definition of attributeDefinitions; track definition.key) {
                  <mat-option [value]="definition.key">{{ definition.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <ng-container *ngIf="bulkAttributeDefinition() as selectedDef">
              <mat-form-field appearance="outline">
                <mat-label>Wert</mat-label>
                <input
                  matInput
                  [type]="bulkInputType(selectedDef.type)"
                  [ngModel]="bulkValue()"
                  (ngModelChange)="bulkValue.set($event)"
                />
              </mat-form-field>

              <mat-form-field appearance="outline" *ngIf="selectedDef.temporal">
                <mat-label>Gültig ab</mat-label>
                <input
                  matInput
                  type="date"
                  [ngModel]="bulkValidFrom()"
                  (ngModelChange)="bulkValidFrom.set($event)"
                />
              </mat-form-field>
            </ng-container>
          </div>

          <div class="bulk-panel__presets" *ngIf="presets?.length">
            <span>Presets:</span>
            @for (preset of presets; track preset.label) {
              <button mat-stroked-button type="button" (click)="applyPreset(preset)">
                {{ preset.label }}
              </button>
            }
            <button
              mat-stroked-button
              type="button"
              (click)="copyFromPrimary()"
              [disabled]="selectedIds().length < 2 || !bulkAttributeDefinition()"
            >
              Wert vom ersten
            </button>
            <button mat-stroked-button color="warn" type="button" (click)="emitDeleteSelected()">
              Ausgewählte löschen
            </button>
          </div>

          <div class="bulk-panel__actions">
            <span class="error" *ngIf="bulkError()">{{ bulkError() }}</span>
            <span class="success" *ngIf="bulkFeedback() === 'success'">
              <mat-icon>check_circle</mat-icon>
              Übernommen
            </span>
            <button mat-stroked-button type="button" (click)="clearSelection()">
              Auswahl leeren
            </button>
            <button mat-flat-button color="primary" type="button" (click)="applyBulkAttribute()">
              Anwenden
            </button>
          </div>
        </section>
      </section>

      <section class="editor__detail" *ngIf="attributeDefinitions.length > 0 && selectedIds().length <= 1">
        <div class="attributes">
          <header class="detail-header">
            <h3>Attribute</h3>
            <div class="detail-header__actions">
              <button
                mat-mini-fab
                color="primary"
                type="button"
                (click)="createNew()"
                matTooltip="Neu anlegen"
                aria-label="Neu anlegen"
              >
                <mat-icon>add</mat-icon>
              </button>
              <button
                mat-mini-fab
                color="warn"
                type="button"
                (click)="emitDeleteSelected()"
                matTooltip="Löschen"
                aria-label="Löschen"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          </header>
          <div class="error detail-error" *ngIf="detailError">{{ detailError }}</div>
          <app-attribute-table-editor
            [definitions]="attributeDefinitions"
            [attributes]="tableAttributes()"
            [fallbackValues]="fallbackValues()"
            [requiredKeys]="effectiveRequiredKeys"
            [numericKeys]="numericKeys"
            [actionKeys]="actionKeys"
            [selectOptions]="selectOptions"
            (valueChange)="handleValueChange($event)"
            (attributesChange)="emitSave($event)"
            (actionTriggered)="onActionTriggered($event)"
          />
        </div>

      </section>
    </div>
  `,
  styles: [
    `
      .editor {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 24px;
        padding: 24px;
      }

      .stop-list {
        max-height: 320px;
        overflow: auto;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
      }

      .stop-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        cursor: pointer;
        border-left: 3px solid transparent;
        border-radius: 8px;
        transition:
          background 160ms ease,
          border-color 160ms ease,
          transform 160ms ease,
          box-shadow 160ms ease;
      }

      .stop-row:hover {
        background: rgba(63, 81, 181, 0.04);
      }

      .stop-row.selected {
        background: rgba(63, 81, 181, 0.08);
        border-left-color: #3f51b5;
        transform: translateX(2px);
        box-shadow: 0 4px 12px rgba(63, 81, 181, 0.12);
      }

      .stop-row__info {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .stop-panel__secondary,
      .stop-row__secondary {
        font-size: 12px;
        opacity: 0.7;
      }

      .stop-list--grouped {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .stop-group {
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.9);
      }

      .stop-group__header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
      }

      .stop-group__info {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .stop-group__name {
        font-weight: 600;
      }

      .stop-group__secondary {
        font-size: 12px;
        opacity: 0.7;
      }

      .stop-group__count {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.6);
      }

      .stop-group__children {
        border-top: 1px solid rgba(0, 0, 0, 0.05);
        padding: 4px 8px 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .stop-empty {
        margin: 12px 0;
        padding: 24px;
        border-radius: 12px;
        border: 1px dashed rgba(63, 81, 181, 0.3);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        text-align: center;
        color: rgba(0, 0, 0, 0.6);
      }

      .stop-empty mat-icon {
        font-size: 36px;
        color: rgba(63, 81, 181, 0.8);
      }

      .editor__detail {
        padding: 16px;
        border-radius: 12px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(255, 255, 255, 0.9);
      }

      .bulk-panel {
        margin-top: 16px;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: rgba(255, 255, 255, 0.8);
      }

      .bulk-panel header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .bulk-panel__form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
      }

      .bulk-panel__presets {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .bulk-panel__actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        align-items: center;
      }

      .detail-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 12px;
      }

      .detail-header__actions {
        display: inline-flex;
        gap: 12px;
      }

      .detail-header__actions button {
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.15),
          0 2px 4px rgba(0, 0, 0, 0.08);
        transition:
          transform 160ms ease,
          box-shadow 160ms ease;
      }

      .detail-header__actions button:hover {
        transform: translateY(-2px);
        box-shadow:
          0 6px 18px rgba(0, 0, 0, 0.25),
          0 3px 6px rgba(0, 0, 0, 0.1);
      }

      .detail-error {
        margin-bottom: 8px;
      }

      .error {
        color: #d32f2f;
        font-size: 12px;
        flex: 1;
      }

      .success {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: #2e7d32;
        font-size: 12px;
        animation: fadeIn 200ms ease;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 960px) {
        .editor {
          grid-template-columns: 1fr;
        }
      }
      .toolbar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }

      .toolbar__row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .toolbar__row--compact {
        justify-content: flex-start;
      }

      .toolbar__search {
        flex: 1;
      }

      .toolbar__filter-button {
        margin-left: auto;
      }

      .filter-panel {
        margin-bottom: 12px;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid rgba(0, 0, 0, 0.1);
        background: rgba(255, 255, 255, 0.9);
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
        overflow: hidden;
      }

      .filter-panel__body {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }

      .filter-panel__actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
    `,
  ],
  animations: [
    trigger('filterPanel', [
      transition(':enter', [
        style({ height: 0, opacity: 0, transform: 'translateY(-6px)' }),
        animate('220ms ease-out', style({ height: '*', opacity: 1, transform: 'translateY(0)' })),
      ]),
      transition(':leave', [
        style({ height: '*', opacity: 1, transform: 'translateY(0)' }),
        animate('180ms ease-in', style({ height: 0, opacity: 0, transform: 'translateY(-6px)' })),
      ]),
    ]),
    trigger('bulkPanel', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(12px) scale(0.98)' }),
        animate('180ms 40ms ease-out', style({ opacity: 1, transform: 'translateY(0) scale(1)' })),
      ]),
      transition(':leave', [
        style({ opacity: 1, transform: 'translateY(0) scale(1)' }),
        animate('150ms ease-in', style({ opacity: 0, transform: 'translateY(12px) scale(0.97)' })),
      ]),
    ]),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttributeEntityEditorComponent implements OnDestroy {
  private readonly entitySignal = signal<AttributeEntityRecord[]>([]);
  private readonly draftSignal = signal<AttributeEntityRecord[]>([]);

  @Input() title = 'Attribute';
  @Input({ alias: 'entities' })
  set entityRecords(value: AttributeEntityRecord[]) {
    this.entitySignal.set(value ?? []);
    this.reconcileSelection();
  }
  readonly entities = this.entitySignal.asReadonly();
  readonly combinedEntities = computed<AttributeEntityRecord[]>(() => [
    ...this.draftSignal(),
    ...this.entitySignal(),
  ]);
  readonly searchTerm = signal('');
  readonly showFilters = signal(false);
  readonly filterValues = signal<Partial<Record<string, string[]>>>({});
  readonly activeFilters = signal<Partial<Record<string, string[]>>>({});
  readonly sortKey = signal('name');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');
  readonly detailDirty = signal(false);
  private readonly syncGroupExpansion = effect(
    () => {
      const groups = this.groupedView();
      const current = this.groupExpansion();
      const next: Record<string, boolean> = { ...current };
      const activeIds = new Set(groups.map((group) => group.id));
      let changed = false;
      groups.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = true;
          changed = true;
        } else if (group.children.length === 0 && next[group.id]) {
          next[group.id] = false;
          changed = true;
        }
      });
      Object.keys(next).forEach((id) => {
        if (!activeIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      if (changed) {
        this.groupExpansion.set(next);
      }
    },
    { allowSignalWrites: true },
  );
  private undoStack: Record<string, string>[] = [];
  private redoStack: Record<string, string>[] = [];
  private applyingSnapshot = false;

  @Input() attributeDefinitions: CustomAttributeDefinition[] = [];
  @Input() defaultFallbackValues: Record<string, string> = {};
  @Input() requiredKeys: string[] | null = null;
  @Input() numericKeys: string[] = [];
  @Input() actionKeys: string[] = [];
  @Input() presets: AttributeBulkPreset[] = [];
  @Input() detailError: string | null = null;
  @Input() groupedEntities: AttributeEntityGroup[] | null = null;
  @Input() createDefaultsFactory?: (groupId: string | null) => Record<string, string>;
  @Input() selectOptions: Record<string, { label: string; value: string }[]> = {};

  @Output() readonly saveEntity = new EventEmitter<EntitySaveEvent>();
  @Output() readonly deleteEntities = new EventEmitter<string[]>();
  @Output() readonly bulkApply = new EventEmitter<BulkApplyEvent>();
  @Output() readonly actionTriggered = new EventEmitter<AttributeActionEvent>();

  readonly selectedIds = signal<string[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly fallbackValues = signal<Record<string, string>>({});
  readonly tableAttributes = signal<TopologyAttribute[]>([]);
  readonly tableValues = signal<Record<string, string>>({});
  readonly bulkAttributeKey = signal<string>('');
  readonly bulkValue = signal<string>('');
  readonly bulkValidFrom = signal<string>('');
  readonly bulkError = signal<string | null>(null);
  readonly filteredEntityIds = computed(() => new Set(this.filteredEntities().map((entity) => entity.id)));
  readonly groupedView = computed<AttributeEntityGroupView[]>(() => {
    if (!this.groupedEntities || this.groupedEntities.length === 0) {
      return [];
    }
    const ids = this.filteredEntityIds();
    const query = this.searchTerm().trim().toLowerCase();
    const result: AttributeEntityGroupView[] = [];
    this.groupedEntities.forEach((group) => {
      const children = group.children.filter((child) => ids.has(child.id));
      const matchesGroup =
        !query ||
        group.label.toLowerCase().includes(query) ||
        (group.secondaryLabel ?? '').toLowerCase().includes(query);
      if (!matchesGroup && children.length === 0) {
        return;
      }
      result.push({
        id: group.id,
        label: group.label,
        secondaryLabel: group.secondaryLabel,
        description: group.description,
        children,
      });
    });
    return result;
  });
  readonly groupExpansion = signal<Record<string, boolean>>({});
  readonly bulkFeedback = signal<'success' | null>(null);
  private bulkFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly filteredEntities = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const filters = this.activeFilters();
    const sorted = [...this.combinedEntities()].sort((a: AttributeEntityRecord, b: AttributeEntityRecord) =>
      this.compareEntities(a, b, this.sortKey(), this.sortDirection()),
    );
    return sorted.filter((entity) => {
      const nameMatch =
        !query ||
        entity.label.toLowerCase().includes(query) ||
        (entity.secondaryLabel ?? '').toLowerCase().includes(query);
      if (!nameMatch) {
        return false;
      }
      const filterKeys = Object.keys(filters).filter((key) => (filters[key]?.length ?? 0) > 0);
      if (filterKeys.length === 0) {
        return true;
      }
      return filterKeys.every((key) => {
        const target = this.getLatestAttributeValue(entity, key)?.value ?? '';
        const needles = filters[key] ?? [];
        return needles.some((needle) =>
          target.toLowerCase().includes(needle.trim().toLowerCase()),
        );
      });
    });
  });

  get effectiveRequiredKeys(): string[] {
    if (this.requiredKeys && this.requiredKeys.length > 0) {
      return this.requiredKeys;
    }
    return this.attributeDefinitions.filter((definition) => definition.required).map((definition) => definition.key);
  }

  bulkAttributeDefinition(): CustomAttributeDefinition | undefined {
    return this.attributeDefinitions.find((def) => def.key === this.bulkAttributeKey());
  }

  toggleSelection(id: string, explicit?: boolean): void {
    this.selectedIds.update((current) => {
      const exists = current.includes(id);
      const shouldSelect = explicit ?? !exists;
      if (shouldSelect && !exists) {
        return [...current, id];
      }
      if (!shouldSelect && exists) {
        return current.filter((entry) => entry !== id);
      }
      return current;
    });
    this.syncDetailSelection();
  }

  openSingle(id: string): void {
    this.selectedIds.set([id]);
    this.syncDetailSelection();
  }

  createNew(groupId: string | null = null): void {
    const draft: AttributeEntityRecord = {
      id: this.createDraftId(),
      label: 'Neu…',
      secondaryLabel: 'noch nicht gespeichert',
      attributes: [],
      fallbackValues: { ...this.defaultFallbackValues, ...this.resolveCreateDefaults(groupId) },
    };
    this.draftSignal.update((current) => [draft, ...current]);
    this.selectedIds.set([draft.id]);
    this.selectedId.set(draft.id);
    this.setDetailContext(draft);
  }

  clearSelection(): void {
    this.selectedIds.set([]);
    this.selectedId.set(null);
    this.setDetailContext(null);
  }

  applyBulkAttribute(): void {
    const def = this.bulkAttributeDefinition();
    const ids = this.selectedIds().filter((id) => !this.isDraft(id));
    const value = this.bulkValue().trim();
    if (!def) {
      this.bulkError.set('Bitte ein Attribut auswählen.');
      return;
    }
    if (!value) {
      this.bulkError.set('Bitte einen Wert eingeben.');
      return;
    }
    if (ids.length === 0) {
      this.bulkError.set('Keine gespeicherten Elemente ausgewählt.');
      return;
    }
    const validFrom = def.temporal ? this.bulkValidFrom().trim() : undefined;
    if (def.temporal && !validFrom) {
      this.bulkError.set('Bitte „Gültig ab“ angeben.');
      return;
    }
    this.bulkApply.emit({ entityIds: ids, key: def.key, value, validFrom: validFrom || undefined });
    this.bulkError.set(null);
    this.bulkValue.set('');
    this.bulkValidFrom.set('');
    this.showBulkSuccess();
  }

  applyPreset(preset: AttributeBulkPreset): void {
    this.bulkAttributeKey.set(preset.key);
    this.bulkValue.set(preset.value);
    const def = this.bulkAttributeDefinition();
    if (def?.temporal) {
      this.bulkValidFrom.set(new Date().toISOString().slice(0, 10));
    } else {
      this.bulkValidFrom.set('');
    }
    this.applyBulkAttribute();
  }

  copyFromPrimary(): void {
    const def = this.bulkAttributeDefinition();
    const ids = this.selectedIds().filter((id) => !this.isDraft(id));
    if (!def || ids.length < 2) {
      this.bulkError.set('Mindestens zwei gespeicherte Elemente auswählen.');
      return;
    }
    const primary = this.combinedEntities().find(
      (entity: AttributeEntityRecord) => entity.id === ids[0],
    );
    if (!primary) {
      this.bulkError.set('Primärer Eintrag nicht gefunden.');
      return;
    }
    const value = this.getLatestAttributeValue(primary, def.key);
    if (!value) {
      this.bulkError.set('Primärer Eintrag besitzt keinen Wert für dieses Attribut.');
      return;
    }
    this.bulkValue.set(value.value);
    this.bulkValidFrom.set(def.temporal ? value.validFrom ?? '' : '');
    this.applyBulkAttribute();
  }

  emitDeleteSelected(): void {
    const ids = this.selectedIds().length
      ? [...this.selectedIds()]
      : this.selectedId()
      ? [this.selectedId()!]
      : [];
    if (ids.length === 0) {
      return;
    }
    const draftIds = ids.filter((id) => this.isDraft(id));
    if (draftIds.length) {
      this.removeDrafts(draftIds);
    }
    const realIds = ids.filter((id) => !this.isDraft(id));
    if (realIds.length) {
      this.deleteEntities.emit(realIds);
    }
    this.clearSelection();
  }

  handleValueChange(values: Record<string, string>): void {
    this.tableValues.set(values);
  }

  emitSave(payload: AttributeSavePayload): void {
    const id = this.selectedId();
    const isDraft = id ? this.isDraft(id) : true;
    if (isDraft && id) {
      this.removeDrafts([id]);
      this.selectedId.set(null);
      this.selectedIds.set([]);
    }
    this.saveEntity.emit({ entityId: isDraft ? null : id, payload });
  }

  onActionTriggered(key: string): void {
    this.actionTriggered.emit({ key, values: this.tableValues() });
  }

  isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  bulkInputType(type: CustomAttributePrimitiveType | undefined): string {
    switch (type) {
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      case 'time':
        return 'time';
      default:
        return 'text';
    }
  }

  private compareEntities(
    a: AttributeEntityRecord,
    b: AttributeEntityRecord,
    key: string,
    direction: 'asc' | 'desc',
  ): number {
    const multiplier = direction === 'asc' ? 1 : -1;
    const aValue = this.resolveSortValue(a, key);
    const bValue = this.resolveSortValue(b, key);
    return aValue.localeCompare(bValue, undefined, { sensitivity: 'base', numeric: true }) * multiplier;
  }

  private resolveSortValue(entity: AttributeEntityRecord, key: string): string {
    if (key === 'name') {
      return entity.label ?? '';
    }
    if (key === 'secondaryLabel') {
      return entity.secondaryLabel ?? '';
    }
    const attributeValue =
      this.getLatestAttributeValue(entity, key)?.value ??
      entity.fallbackValues[key] ??
      this.defaultFallbackValues[key] ??
      '';
    return attributeValue ?? '';
  }

  private reconcileSelection(): void {
    const ids = this.selectedIds();
    const available = new Set(
      this.combinedEntities().map((entity: AttributeEntityRecord) => entity.id),
    );
    const nextIds = ids.filter((id) => available.has(id));
    if (nextIds.length !== ids.length) {
      this.selectedIds.set(nextIds);
    }
    if (!this.selectedId() && this.combinedEntities().length > 0) {
      const firstId = this.combinedEntities()[0].id;
      this.selectedIds.set([firstId]);
      this.selectedId.set(firstId);
    } else if (this.selectedId() && !available.has(this.selectedId()!)) {
      const next = nextIds[0] ?? this.combinedEntities()[0]?.id ?? null;
      this.selectedId.set(next);
    }
    this.syncDetailSelection();
  }

  private syncDetailSelection(): void {
    const ids = this.selectedIds();
    if (ids.length === 1) {
      this.selectedId.set(ids[0]);
      const entity =
        this.combinedEntities().find((entry: AttributeEntityRecord) => entry.id === ids[0]) ?? null;
      this.setDetailContext(entity);
    } else if (ids.length === 0) {
      this.selectedId.set(null);
      this.setDetailContext(null);
    } else {
      this.selectedId.set(null);
      this.tableAttributes.set([]);
      this.tableValues.set({});
    }
  }

  private setDetailContext(entity: AttributeEntityRecord | null): void {
    const fallback = entity?.fallbackValues ?? this.defaultFallbackValues;
    this.fallbackValues.set(fallback);
    this.tableAttributes.set(entity?.attributes ?? []);
    const values: Record<string, string> = { ...fallback };
    this.attributeDefinitions.forEach((definition) => {
      const latest = this.getLatestAttributeValue(entity, definition.key);
      if (latest?.value) {
        values[definition.key] = latest.value;
      }
    });
    this.tableValues.set(values);
    this.bulkError.set(null);
  }

  private getLatestAttributeValue(
    entity: AttributeEntityRecord | null,
    key: string,
  ): { value: string; validFrom?: string } | null {
    if (!entity) {
      const fallback = this.defaultFallbackValues[key];
      return fallback ? { value: fallback } : null;
    }
    const attrs = entity.attributes?.filter((attr) => attr.key === key) ?? [];
    if (attrs.length === 0) {
      const fallback = entity.fallbackValues[key];
      return fallback ? { value: fallback } : null;
    }
    const sorted = [...attrs].sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''));
    const entry = sorted[0];
    if (!entry.value) {
      return null;
    }
    return { value: entry.value, validFrom: entry.validFrom ?? undefined };
  }

  toggleFilters(): void {
    this.showFilters.update((value) => !value);
  }

  addFilterValue(key: string, rawValue: string): void {
    const value = rawValue.trim();
    if (!value) {
      return;
    }
    this.filterValues.update((current) => {
      const existing = current[key] ?? [];
      if (existing.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
        return current;
      }
      return {
        ...current,
        [key]: [...existing, value],
      };
    });
  }

  removeFilterValue(key: string, value: string): void {
    this.filterValues.update((current) => {
      const existing = current[key] ?? [];
      const filtered = existing.filter((entry) => entry !== value);
      if (filtered.length === existing.length) {
        return current;
      }
      if (filtered.length === 0) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return {
        ...current,
        [key]: filtered,
      };
    });
  }

  applyFilters(): void {
    this.activeFilters.set(this.normalizeFilters(this.filterValues()));
    this.showFilters.set(false);
  }

  clearFilters(): void {
    this.filterValues.set({});
    this.activeFilters.set({});
  }

  resetView(): void {
    this.searchTerm.set('');
    this.clearFilters();
  }

  filterValuesFor(key: string): string[] {
    return this.filterValues()[key] ?? [];
  }

  toggleGroup(id: string): void {
    this.groupExpansion.update((current) => ({
      ...current,
      [id]: !(current[id] ?? false),
    }));
  }

  isGroupExpanded(id: string): boolean {
    return this.groupExpansion()[id] ?? false;
  }

  createChildForGroup(id: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.expandGroup(id);
    this.createNew(id);
  }

  private expandGroup(id: string): void {
    this.groupExpansion.update((current) => ({
      ...current,
      [id]: true,
    }));
  }

  private resolveCreateDefaults(groupId: string | null): Record<string, string> {
    if (!this.createDefaultsFactory) {
      return {};
    }
    try {
      const values = this.createDefaultsFactory(groupId);
      return values ?? {};
    } catch {
      return {};
    }
  }

  private normalizeFilters(
    values: Partial<Record<string, string[]>>,
  ): Partial<Record<string, string[]>> {
    const cleaned: Partial<Record<string, string[]>> = {};
    Object.entries(values).forEach(([key, list]) => {
      const trimmed = (list ?? [])
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (trimmed.length > 0) {
        cleaned[key] = trimmed;
      }
    });
    return cleaned;
  }

  private isDraft(id: string): boolean {
    return id.startsWith('__draft-');
  }

  private createDraftId(): string {
    return `__draft-${uid()}`;
  }

  private removeDrafts(ids: string[]): void {
    this.draftSignal.update((current) => current.filter((draft) => !ids.includes(draft.id)));
  }

  private showBulkSuccess(): void {
    if (this.bulkFeedbackTimeout) {
      clearTimeout(this.bulkFeedbackTimeout);
    }
    this.bulkFeedback.set('success');
    this.bulkFeedbackTimeout = setTimeout(() => this.bulkFeedback.set(null), 1500);
  }

  ngOnDestroy(): void {
    if (this.bulkFeedbackTimeout) {
      clearTimeout(this.bulkFeedbackTimeout);
    }
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
