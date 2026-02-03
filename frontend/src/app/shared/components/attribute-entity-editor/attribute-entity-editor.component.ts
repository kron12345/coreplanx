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
import { ScrollingModule } from '@angular/cdk/scrolling';
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
        ScrollingModule,
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
    templateUrl: './attribute-entity-editor.component.html',
    styleUrl: './attribute-entity-editor.component.scss',
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
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AttributeEntityEditorComponent implements OnDestroy {
  private readonly entitySignal = signal<AttributeEntityRecord[]>([]);
  private readonly draftSignal = signal<AttributeEntityRecord[]>([]);
  private readonly totalCountSignal = signal<number | null>(null);
  private listLimitValue = 2000;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private autoLoadCooldown: ReturnType<typeof setTimeout> | null = null;
  private autoLoadLocked = false;

  @Input() title = 'Attribute';
  @Input({ alias: 'entities' })
  set entityRecords(value: AttributeEntityRecord[]) {
    this.entitySignal.set(value ?? []);
    this.reconcileSelection();
  }
  @Input()
  set listLimit(value: number | null | undefined) {
    const next = typeof value === 'number' && value > 0 ? value : 2000;
    this.listLimitValue = next;
    this.visibleLimit.set(next);
  }
  @Input()
  set totalCount(value: number | null | undefined) {
    if (typeof value === 'number' && value >= 0) {
      this.totalCountSignal.set(value);
    } else {
      this.totalCountSignal.set(null);
    }
  }
  readonly entities = this.entitySignal.asReadonly();
  readonly combinedEntities = computed<AttributeEntityRecord[]>(() => [
    ...this.draftSignal(),
    ...this.entitySignal(),
  ]);
  readonly loadedCount = computed(() => this.entitySignal().length);
  readonly searchTerm = signal('');
  readonly showFilters = signal(false);
  readonly filterValues = signal<Partial<Record<string, string[]>>>({});
  readonly activeFilters = signal<Partial<Record<string, string[]>>>({});
  readonly isFiltering = computed(() => {
    const query = this.searchTerm().trim();
    const filters = this.activeFilters();
    const hasQuery = query.length > 0;
    const hasFilters = Object.keys(filters).length > 0;
    return (hasQuery && !this.serverSearch) || hasFilters;
  });
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
  );
  private undoStack: Record<string, string>[] = [];
  private redoStack: Record<string, string>[] = [];
  private applyingSnapshot = false;

  @Input() attributeDefinitions: CustomAttributeDefinition[] = [];
  @Input() defaultFallbackValues: Record<string, string> = {};
  @Input() requiredKeys: string[] | null = null;
  @Input() numericKeys: string[] = [];
  @Input() actionKeys: string[] = [];
  @Input() serverSearch = false;
  @Input() presets: AttributeBulkPreset[] = [];
  @Input() detailError: string | null = null;
  @Input() groupedEntities: AttributeEntityGroup[] | null = null;
  @Input() createDefaultsFactory?: (groupId: string | null) => Record<string, string>;
  @Input() selectOptions: Record<string, { label: string; value: string }[]> = {};
  @Input() multiSelectOptions: Record<string, { label: string; value: string }[]> = {};

  @Output() readonly saveEntity = new EventEmitter<EntitySaveEvent>();
  @Output() readonly deleteEntities = new EventEmitter<string[]>();
  @Output() readonly bulkApply = new EventEmitter<BulkApplyEvent>();
  @Output() readonly actionTriggered = new EventEmitter<AttributeActionEvent>();
  @Output() readonly loadMore = new EventEmitter<void>();
  @Output() readonly searchChanged = new EventEmitter<string>();

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
    const combined = this.combinedEntities();
    const hasQuery = query.length > 0;
    const filterKeys = Object.keys(filters).filter((key) => (filters[key]?.length ?? 0) > 0);
    const hasFilters = filterKeys.length > 0;
    const sortKey = this.sortKey();
    const sortDirection = this.sortDirection();
    const needsSort = hasQuery || hasFilters || sortKey !== 'name' || sortDirection !== 'asc';
    const sorted = needsSort
      ? [...combined].sort((a: AttributeEntityRecord, b: AttributeEntityRecord) =>
          this.compareEntities(a, b, sortKey, sortDirection),
        )
      : combined;
    return sorted.filter((entity) => {
      const nameMatch =
        !hasQuery ||
        entity.label.toLowerCase().includes(query) ||
        (entity.secondaryLabel ?? '').toLowerCase().includes(query);
      if (!nameMatch) {
        return false;
      }
      if (!hasFilters) {
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
  readonly visibleLimit = signal(this.listLimitValue);
  readonly limitedEntities = computed(() =>
    this.filteredEntities().slice(0, this.visibleLimit()),
  );
  readonly hasMore = computed(() => {
    const total = this.totalCountSignal();
    if (total !== null && !this.isFiltering()) {
      return this.loadedCount() < total;
    }
    return this.filteredEntities().length > this.visibleLimit();
  });
  readonly totalAvailable = computed(() => {
    const total = this.totalCountSignal();
    if (total === null || this.isFiltering()) {
      return this.filteredEntities().length;
    }
    return total;
  });
  readonly headerCountLabel = computed(() => {
    const total = this.totalAvailable();
    if (this.totalCountSignal() !== null && !this.isFiltering()) {
      return `${this.loadedCount()} von ${total} Einträgen`;
    }
    return `${total} Einträge`;
  });
  private readonly resetVisibleOnFilter = effect(() => {
    this.searchTerm();
    this.activeFilters();
    this.sortKey();
    this.sortDirection();
    this.visibleLimit.set(this.listLimitValue);
  });

  get hasDetailPanel(): boolean {
    return (
      (this.attributeDefinitions?.length ?? 0) > 0 ||
      Object.keys(this.fallbackValues()).length > 0
    );
  }

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
    this.visibleLimit.set(this.listLimitValue);
  }

  showMore(): void {
    if (this.shouldRequestMore()) {
      this.loadMore.emit();
    }
    this.visibleLimit.update((current) => current + this.listLimitValue);
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    if (this.searchDebounce) {
      clearTimeout(this.searchDebounce);
    }
    this.searchDebounce = setTimeout(() => {
      this.searchChanged.emit(this.searchTerm().trim());
    }, 250);
  }

  onVirtualScroll(index: number): void {
    if (!this.hasMore()) {
      return;
    }
    const remaining = this.limitedEntities().length - index;
    if (remaining > 24) {
      return;
    }
    if (this.autoLoadLocked) {
      return;
    }
    this.autoLoadLocked = true;
    this.showMore();
    if (this.autoLoadCooldown) {
      clearTimeout(this.autoLoadCooldown);
    }
    this.autoLoadCooldown = setTimeout(() => {
      this.autoLoadLocked = false;
    }, 400);
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

  private shouldRequestMore(): boolean {
    const total = this.totalCountSignal();
    if (total === null) {
      return false;
    }
    if (this.isFiltering()) {
      return false;
    }
    return this.loadedCount() < total;
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
    if (this.searchDebounce) {
      clearTimeout(this.searchDebounce);
    }
    if (this.autoLoadCooldown) {
      clearTimeout(this.autoLoadCooldown);
    }
  }

  trackEntityId(_index: number, entity: AttributeEntityRecord): string {
    return entity.id;
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
