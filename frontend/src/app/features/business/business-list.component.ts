import { CommonModule, DOCUMENT, DatePipe } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  BusinessDueDateFilter,
  BusinessFilters,
  BusinessService,
  BusinessSort,
  BusinessSortField,
  CreateBusinessPayload,
} from '../../core/services/business.service';
import {
  Business,
  BusinessStatus,
} from '../../core/models/business.model';
import {
  OrderItemOption,
  OrderService,
} from '../../core/services/order.service';
import { MatDialog } from '@angular/material/dialog';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { BusinessCreateDialogComponent } from './business-create-dialog.component';
import { ActivatedRoute, Router } from '@angular/router';
import {
  OrderItemPickerDialogComponent,
  OrderItemPickerDialogData,
} from './order-item-picker-dialog.component';
import {
  BusinessCommandDefinition,
  BusinessCommandPaletteDialogComponent,
} from './business-command-palette-dialog.component';
import { BusinessCreateFromTemplateComponent } from './business-create-from-template.component';

interface SortOption {
  value: string;
  label: string;
}

type BusinessMetric = {
  label: string;
  value: number | string;
  icon: string;
  hint: string;
};

interface BusinessHighlight {
  icon: string;
  label: string;
  filter?: { kind: 'status' | 'assignment'; value: string };
}

interface SavedFilterPreset {
  id: string;
  name: string;
  filters: BusinessFilters;
  sort: BusinessSort;
}

type PipelineMetrics = {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  dueSoon: number;
};

type MetricTrend = {
  active: number | null;
  completed: number | null;
  overdue: number | null;
  dueSoon: number | null;
};

type HealthTone = 'critical' | 'warning' | 'ok' | 'done' | 'idle';

interface HealthBadge {
  tone: HealthTone;
  label: string;
}

type TimelineState = 'past' | 'current' | 'future' | 'none';

interface TimelineEntry {
  label: string;
  description: string;
  state: TimelineState;
  date: Date | null;
}

interface ActivityFeedItem {
  icon: string;
  title: string;
  subtitle: string;
}

interface SearchSuggestion {
  label: string;
  value: string;
  icon: string;
  description: string;
  kind: 'tag' | 'assignment' | 'status';
}

interface BusinessInsightContext {
  title: string;
  message: string;
  hint: string;
  icon: string;
}

const BUSINESS_INSIGHTS_STORAGE_KEY = 'business.insightsCollapsed.v1';

@Component({
  selector: 'app-business-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS, BusinessCreateFromTemplateComponent],
  templateUrl: './business-list.component.html',
  styleUrl: './business-list.component.scss',
  providers: [DatePipe],
})
export class BusinessListComponent {
  private readonly businessService = inject(BusinessService);
  private readonly orderService = inject(OrderService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly datePipe = inject(DatePipe);

  readonly searchControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(80)],
  });

  readonly statusOptions: { value: BusinessStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'Alle' },
    { value: 'neu', label: 'Neu' },
    { value: 'in_arbeit', label: 'In Arbeit' },
    { value: 'pausiert', label: 'Pausiert' },
    { value: 'erledigt', label: 'Erledigt' },
  ];

  readonly dueDatePresetOptions: {
    value: BusinessDueDateFilter;
    label: string;
    icon: string;
  }[] = [
    { value: 'all', label: 'Alle', icon: 'all_inclusive' },
    { value: 'today', label: 'Heute', icon: 'event' },
    { value: 'this_week', label: 'Diese Woche', icon: 'calendar_view_week' },
    { value: 'next_week', label: 'Nächste Woche', icon: 'calendar_month' },
    { value: 'overdue', label: 'Überfällig', icon: 'schedule' },
  ];

  readonly sortOptions: SortOption[] = [
    { value: 'dueDate:asc', label: 'Fälligkeit · aufsteigend' },
    { value: 'dueDate:desc', label: 'Fälligkeit · absteigend' },
    { value: 'status:asc', label: 'Status' },
    { value: 'createdAt:desc', label: 'Erstellt · neueste zuerst' },
    { value: 'title:asc', label: 'Titel A–Z' },
  ];

  readonly statusLabelLookup: Record<BusinessStatus | 'all', string> =
    this.statusOptions.reduce((acc, option) => {
      acc[option.value] = option.label;
      return acc;
    }, {} as Record<BusinessStatus | 'all', string>);

  readonly dueDateLabelLookup: Record<BusinessDueDateFilter, string> =
    this.dueDatePresetOptions.reduce((acc, option) => {
      acc[option.value] = option.label;
      return acc;
    }, {} as Record<BusinessDueDateFilter, string>);

  readonly assignments = computed(() => this.businessService.assignments());
  readonly filters = computed(() => this.businessService.filters());
  readonly sort = computed(() => this.businessService.sort());
  readonly businesses = computed(() => this.businessService.filteredBusinesses());
  readonly orderItemOptions = computed<OrderItemOption[]>(() =>
    this.orderService.orderItemOptions(),
  );
  readonly availableTags = computed(() => {
    const stats = new Map<string, number>();
    this.businesses().forEach((business) => {
      business.tags?.forEach((tag) => {
        stats.set(tag, (stats.get(tag) ?? 0) + 1);
      });
    });
    return Array.from(stats.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }))
      .map(([tag]) => tag);
  });
  readonly tagStats = computed(() => {
    const stats = new Map<string, number>();
    this.businesses().forEach((business) => {
      business.tags?.forEach((tag) => {
        stats.set(tag, (stats.get(tag) ?? 0) + 1);
      });
    });
    return Array.from(stats.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }),
    );
  });
  readonly topTagInsights = computed(() => this.tagStats().slice(0, 3));
  readonly insightsCollapsed = signal(this.loadInsightsCollapsed());
  readonly topAssignments = computed(() => this.computeTopAssignments());
  readonly statusBreakdown = computed(() => this.computeStatusBreakdown());
  readonly dueSoonHighlights = computed(() => this.computeDueSoonHighlights());
  readonly insightContext = computed(() => this.computeInsightContext());
  readonly searchSuggestions = computed<SearchSuggestion[]>(() => {
    const query = this.searchControl.value.trim().toLowerCase();
    const suggestions: SearchSuggestion[] = [];

    this.tagStats().forEach(([tag, count]) => {
      const encoded = this.encodeTokenValue(tag);
      suggestions.push({
        label: this.formatTagLabel(tag),
        value: `tag:${encoded}`,
        icon: 'sell',
        description: `${count} Treffer · Tag`,
        kind: 'tag',
      });
    });

    this.assignments().forEach((assignment) => {
      const encoded = this.encodeTokenValue(assignment.name);
      suggestions.push({
        label: assignment.name,
        value: `assign:${encoded}`,
        icon: assignment.type === 'group' ? 'groups' : 'person',
        description: 'Verantwortlich',
        kind: 'assignment',
      });
    });

    this.statusOptions
      .filter((option) => option.value !== 'all')
      .forEach((option) => {
        suggestions.push({
          label: option.label,
          value: `status:${option.value}`,
          icon: 'flag',
          description: 'Status',
          kind: 'status',
        });
      });

    const filtered = query
      ? suggestions.filter(
          (suggestion) =>
            suggestion.label.toLowerCase().includes(query) ||
            suggestion.value.toLowerCase().includes(query),
        )
      : suggestions;

    return filtered.slice(0, 8);
  });
  readonly orderItemLookup = computed(() => {
    const map = new Map<string, OrderItemOption>();
    this.orderItemOptions().forEach((option) => map.set(option.itemId, option));
    return map;
  });

  private readonly selectedBusinessId = signal<string | null>(null);
  private readonly savedPresets = signal<SavedFilterPreset[]>([]);
  private readonly activePresetId = signal<string | null>(null);
  private readonly presetStorageKey = 'om.business.presets.v1';
  private readonly metricsBaseline = signal<PipelineMetrics | null>(null);
  readonly metricTrends = signal<MetricTrend>({
    active: null,
    completed: null,
    overdue: null,
    dueSoon: null,
  });
  private readonly bulkSelection = signal<Set<string>>(new Set());
  readonly bulkSelectionCount = computed(() => this.bulkSelection().size);
  readonly hasBulkSelection = computed(() => this.bulkSelectionCount() > 0);
  private readonly viewTransitionFlag = signal(false);
  readonly isViewTransitioning = computed(() => this.viewTransitionFlag());
  private viewTransitionTimer: number | null = null;
  readonly skeletonPlaceholders = Array.from({ length: 6 }, (_, index) => index);

  readonly selectedBusiness = computed(() => {
    const id = this.selectedBusinessId();
    if (!id) {
      return null;
    }
    return this.businesses().find((business) => business.id === id) ?? null;
  });

  readonly savedFilterPresets = computed(() => this.savedPresets());
  readonly activePreset = computed(() => this.activePresetId());

  private readonly statusLabels: Record<BusinessStatus, string> = {
    neu: 'Neu',
    pausiert: 'Pausiert',
    in_arbeit: 'In Arbeit',
    erledigt: 'Erledigt',
  };

  readonly overviewMetrics = computed(() => {
    const entries = this.businesses();
    const total = entries.length;
    let active = 0;
    let completed = 0;
    let overdue = 0;
    let dueSoon = 0;
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const soonThreshold = new Date(startToday);
    soonThreshold.setDate(soonThreshold.getDate() + 7);

    entries.forEach((business) => {
      if (business.status === 'erledigt') {
        completed += 1;
      } else {
        active += 1;
      }

      if (!business.dueDate) {
        return;
      }

      const due = new Date(business.dueDate);
      if (due < startToday) {
        overdue += 1;
        return;
      }
      if (due >= startToday && due <= soonThreshold) {
        dueSoon += 1;
      }
    });

    return {
      total,
      active,
      completed,
      overdue,
      dueSoon,
    };
  });

  private pendingScrollId: string | null = null;

  constructor() {
    this.restorePresetsFromStorage();
    this.searchControl.setValue(this.filters().search, { emitEvent: false });

    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        this.startViewTransition();
        this.clearActivePreset();
        this.businessService.setFilters({ search: value });
      });

    effect(() => {
      const next = this.filters().search;
      if (this.searchControl.value !== next) {
        this.searchControl.setValue(next, { emitEvent: false });
      }
    });

    this.route.fragment
      .pipe(takeUntilDestroyed())
      .subscribe((fragment) => {
        this.pendingScrollId = fragment ?? null;
        window.setTimeout(() => this.scrollToPendingBusiness(), 0);
      });

    effect(
      () => {
        const businesses = this.businesses();
        if (businesses.length && !this.selectedBusinessId()) {
          this.selectedBusinessId.set(businesses[0].id);
        } else if (businesses.length && this.selectedBusinessId()) {
          const exists = businesses.some((biz) => biz.id === this.selectedBusinessId());
          if (!exists) {
            this.selectedBusinessId.set(businesses[0].id);
          }
        } else if (!businesses.length) {
          this.selectedBusinessId.set(null);
        }
        window.setTimeout(() => this.scrollToPendingBusiness(), 0);
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const current = this.overviewMetrics();
        const baseline = this.metricsBaseline();
        if (baseline) {
          this.metricTrends.set({
            active: current.active - baseline.active,
            completed: current.completed - baseline.completed,
            overdue: current.overdue - baseline.overdue,
            dueSoon: current.dueSoon - baseline.dueSoon,
          });
        } else {
          this.metricTrends.set({
            active: null,
            completed: null,
            overdue: null,
            dueSoon: null,
          });
        }
        this.metricsBaseline.set(current);
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      this.persistPresets(this.savedPresets());
    });

    effect(
      () => {
        const activeId = this.activePresetId();
        if (!activeId) {
          return;
        }
        const preset = this.savedPresets().find((entry) => entry.id === activeId);
        if (!preset || !this.presetsMatchCurrent(preset)) {
          this.activePresetId.set(null);
        }
      },
      { allowSignalWrites: true },
    );
  }

  openCreateDialog(): void {
    const dialogRef = this.dialog.open<
      BusinessCreateDialogComponent,
      { orderItemOptions: OrderItemOption[] },
      CreateBusinessPayload | undefined
    >(BusinessCreateDialogComponent, {
      width: '560px',
      data: {
        orderItemOptions: this.orderItemOptions(),
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.businessService.createBusiness(result);
      }
    });
  }

  onStatusFilterChange(value: BusinessStatus | 'all'): void {
    this.startViewTransition();
    this.clearActivePreset();
    this.businessService.setFilters({ status: value });
  }

  onAssignmentFilterChange(value: string | 'all'): void {
    this.startViewTransition();
    this.clearActivePreset();
    this.businessService.setFilters({ assignment: value });
  }

  onDueDatePresetChange(value: BusinessDueDateFilter): void {
    this.startViewTransition();
    this.clearActivePreset();
    this.businessService.setFilters({ dueDate: value });
  }

  onSortChange(value: string): void {
    this.startViewTransition();
    const [field, direction] = value.split(':') as [
      BusinessSortField,
      'asc' | 'desc',
    ];
    this.businessService.setSort({ field, direction });
  }

  resetFilters(): void {
    this.startViewTransition();
    this.clearActivePreset();
    this.searchControl.setValue('', { emitEvent: false });
    this.businessService.resetFilters();
    this.businessService.setSort({ field: 'dueDate', direction: 'asc' });
    this.clearBulkSelection();
  }

  clearFilter(kind: 'search' | 'status' | 'assignment' | 'dueDate' | 'tags'): void {
    if (kind === 'tags') {
      this.clearTagFilters();
      return;
    }
    this.startViewTransition();
    this.clearActivePreset();
    switch (kind) {
      case 'search':
        this.searchControl.setValue('');
        break;
      case 'status':
        this.onStatusFilterChange('all');
        break;
      case 'assignment':
        this.onAssignmentFilterChange('all');
        break;
      case 'dueDate':
        this.onDueDatePresetChange('all');
        break;
    }
  }

  saveCurrentFilterPreset(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const name = window
      .prompt('Filteransicht benennen', this.defaultPresetName())
      ?.trim();
    if (!name) {
      return;
    }
    const preset: SavedFilterPreset = {
      id: this.generatePresetId(),
      name,
      filters: { ...this.filters(), search: this.searchControl.value },
      sort: { ...this.sort() },
    };
    this.savedPresets.update((current) => [...current, preset]);
    this.activePresetId.set(preset.id);
  }

  applyFilterPreset(preset: SavedFilterPreset): void {
    this.startViewTransition();
    this.searchControl.setValue(preset.filters.search, { emitEvent: false });
    this.businessService.setFilters({ ...preset.filters });
    this.businessService.setSort({ ...preset.sort });
    this.activePresetId.set(preset.id);
    this.clearBulkSelection();
  }

  removeFilterPreset(id: string): void {
    this.savedPresets.update((current) =>
      current.filter((preset) => preset.id !== id),
    );
    if (this.activePresetId() === id) {
      this.activePresetId.set(null);
    }
  }

  renameFilterPreset(preset: SavedFilterPreset): void {
    if (typeof window === 'undefined') {
      return;
    }
    const nextName = window
      .prompt('Neuen Namen vergeben', preset.name)
      ?.trim();
    if (!nextName || nextName === preset.name) {
      return;
    }
    this.savedPresets.update((current) =>
      current.map((entry) =>
        entry.id === preset.id ? { ...entry, name: nextName } : entry,
      ),
    );
  }

  duplicateFilterPreset(preset: SavedFilterPreset): void {
    const copy: SavedFilterPreset = {
      id: this.generatePresetId(),
      name: `${preset.name} (Kopie)`,
      filters: { ...preset.filters },
      sort: { ...preset.sort },
    };
    this.savedPresets.update((current) => [...current, copy]);
  }

  applyMetricFilter(
    kind: 'active' | 'completed' | 'overdue' | 'dueSoon',
  ): void {
    this.clearBulkSelection();
    switch (kind) {
      case 'active':
        this.onStatusFilterChange('in_arbeit');
        break;
      case 'completed':
        this.onStatusFilterChange('erledigt');
        break;
      case 'overdue':
        this.onDueDatePresetChange('overdue');
        break;
      case 'dueSoon':
        this.onDueDatePresetChange('this_week');
        break;
    }
  }

  isTagSelected(tag: string): boolean {
    const normalized = tag.toLowerCase();
    return this.filters().tags.some((entry) => entry.toLowerCase() === normalized);
  }

  toggleTagFilter(tag: string): void {
    const value = tag.trim();
    if (!value) {
      return;
    }
    const normalized = value.toLowerCase();
    const current = this.filters().tags;
    const has = current.some((entry) => entry.toLowerCase() === normalized);
    const next = has
      ? current.filter((entry) => entry.toLowerCase() !== normalized)
      : [...current, value];
    this.startViewTransition();
    this.clearActivePreset();
    this.businessService.setFilters({ tags: next });
  }

  removeTagFilter(tag: string): void {
    const normalized = tag.toLowerCase();
    const current = this.filters().tags;
    if (!current.some((entry) => entry.toLowerCase() === normalized)) {
      return;
    }
    const next = current.filter((entry) => entry.toLowerCase() !== normalized);
    this.startViewTransition();
    this.clearActivePreset();
    this.businessService.setFilters({ tags: next });
  }

  clearTagFilters(): void {
    if (!this.filters().tags.length) {
      return;
    }
    this.startViewTransition();
    this.clearActivePreset();
    this.businessService.setFilters({ tags: [] });
  }

  toggleInsightsCollapsed(): void {
    this.insightsCollapsed.update((current) => {
      const next = !current;
      this.persistInsightsCollapsed(next);
      return next;
    });
  }

  applyTagInsight(tag: string): void {
    const value = tag.trim();
    if (!value) {
      return;
    }
    this.startViewTransition();
    this.clearActivePreset();
    this.businessService.setFilters({ tags: [value] });
  }

  applyAssignmentInsight(name: string): void {
    this.onAssignmentFilterChange(name);
  }

  applyStatusInsight(status: BusinessStatus): void {
    this.onStatusFilterChange(status);
  }

  focusDueSoon(): void {
    this.onDueDatePresetChange('this_week');
  }

  formatTagLabel(tag: string): string {
    return tag.startsWith('#') ? tag : `#${tag}`;
  }

  private encodeTokenValue(value: string): string {
    return value.includes(' ') ? `"${value}"` : value;
  }

  addTagToBusiness(business: Business, raw: string): void {
    const value = raw.trim();
    if (!value) {
      return;
    }
    const existing = business.tags ?? [];
    if (existing.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      return;
    }
    this.businessService.updateTags(business.id, [...existing, value]);
  }

  removeTagFromBusiness(business: Business, tag: string): void {
    const existing = business.tags ?? [];
    const next = existing.filter((entry) => entry !== tag);
    this.businessService.updateTags(business.id, next);
  }

  tagTone(tag: string): 'region' | 'phase' | 'risk' | 'priority' | 'default' {
    const normalized = tag.toLowerCase();
    if (normalized.startsWith('de-') || ['ch', 'at', 'basel'].some((region) => normalized.includes(region))) {
      return 'region';
    }
    if (['pitch', 'rollout', 'vertrag', 'pilot'].some((keyword) => normalized.includes(keyword))) {
      return 'phase';
    }
    if (['risk', 'risiko', 'escalation', 'warn'].some((keyword) => normalized.includes(keyword))) {
      return 'risk';
    }
    if (['highimpact', 'premium', 'prio'].some((keyword) => normalized.includes(keyword))) {
      return 'priority';
    }
    return 'default';
  }

  tagCount(tag: string): number {
    return this.tagStats().find(([entry]) => entry === tag)?.[1] ?? 0;
  }

  suggestedTagsForBusiness(business: Business): string[] {
    const existing = new Set((business.tags ?? []).map((tag) => tag.toLowerCase()));
    return this.availableTags()
      .filter((tag) => !existing.has(tag.toLowerCase()))
      .slice(0, 6);
  }

  onSearchSuggestionSelected(event: MatAutocompleteSelectedEvent): void {
    const value = event.option.value as string;
    if (!value) {
      return;
    }
    const current = this.searchControl.value.trim();
    const next = current.length ? `${current} ${value}` : value;
    this.searchControl.setValue(`${next} `);
  }

  toggleBulkSelection(id: string, checked: boolean | undefined): void {
    const next = new Set(this.bulkSelection());
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.bulkSelection.set(next);
  }

  isInBulkSelection(id: string): boolean {
    return this.bulkSelection().has(id);
  }

  selectAllVisible(): void {
    this.bulkSelection.set(new Set(this.businesses().map((business) => business.id)));
  }

  clearBulkSelection(): void {
    if (this.bulkSelection().size) {
      this.bulkSelection.set(new Set());
    }
  }

  bulkUpdateStatus(status: BusinessStatus): void {
    if (!this.bulkSelection().size) {
      return;
    }
    this.startViewTransition();
    this.bulkSelection().forEach((id) => this.businessService.updateStatus(id, status));
    this.clearBulkSelection();
  }

  private removeFromBulkSelection(id: string): void {
    if (!this.bulkSelection().has(id)) {
      return;
    }
    const next = new Set(this.bulkSelection());
    next.delete(id);
    this.bulkSelection.set(next);
  }

  openCommandPalette(): void {
    const commands = this.buildCommandDefinitions();
    const dialogRef = this.dialog.open(BusinessCommandPaletteDialogComponent, {
      width: '520px',
      data: { commands },
    });
    dialogRef.afterClosed().subscribe((commandId?: string) => {
      if (commandId) {
        this.executeCommand(commandId);
      }
    });
  }

  executeCommand(commandId: string): void {
    switch (commandId) {
      case 'create-business':
        this.openCreateDialog();
        break;
      case 'reset-filters':
        this.resetFilters();
        break;
      case 'filter-overdue':
        this.applyMetricFilter('overdue');
        break;
      case 'filter-due-soon':
        this.applyMetricFilter('dueSoon');
        break;
      case 'filter-active':
        this.applyMetricFilter('active');
        break;
      case 'select-all-visible':
        this.selectAllVisible();
        break;
      case 'clear-selection':
        this.clearBulkSelection();
        break;
      default:
        break;
    }
  }

  private buildCommandDefinitions(): BusinessCommandDefinition[] {
    const metrics = this.overviewMetrics();
    return [
      {
        id: 'create-business',
        label: 'Neues Geschäft erstellen',
        icon: 'add',
        hint: 'Shift + N',
      },
      {
        id: 'reset-filters',
        label: 'Filter zurücksetzen',
        icon: 'refresh',
      },
      {
        id: 'filter-overdue',
        label: `Überfällige anzeigen (${metrics.overdue})`,
        icon: 'priority_high',
      },
      {
        id: 'filter-due-soon',
        label: `Fällig diese Woche (${metrics.dueSoon})`,
        icon: 'event',
      },
      {
        id: 'filter-active',
        label: `Aktive Vorgänge (${metrics.active})`,
        icon: 'work',
      },
      {
        id: 'select-all-visible',
        label: 'Alle sichtbaren auswählen',
        icon: 'select_all',
      },
      {
        id: 'clear-selection',
        label: 'Auswahl leeren',
        icon: 'close',
      },
    ];
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalShortcut(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'k') {
      event.preventDefault();
      this.openCommandPalette();
      return;
    }
    if (event.shiftKey && key === 'n') {
      event.preventDefault();
      this.openCreateDialog();
    }
  }

  private startViewTransition(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (this.viewTransitionTimer) {
      window.clearTimeout(this.viewTransitionTimer);
    }
    this.viewTransitionFlag.set(true);
    this.viewTransitionTimer = window.setTimeout(() => {
      this.viewTransitionFlag.set(false);
      this.viewTransitionTimer = null;
    }, 320);
  }

  private clearActivePreset(): void {
    if (this.activePresetId()) {
      this.activePresetId.set(null);
    }
  }

  private restorePresetsFromStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(this.presetStorageKey);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SavedFilterPreset[];
      if (Array.isArray(parsed)) {
        this.savedPresets.set(
          parsed.map((preset) => ({
            ...preset,
            filters: this.normalizeFilters(preset.filters as BusinessFilters | undefined),
            sort: { ...preset.sort },
          })),
        );
      }
    } catch (error) {
      console.warn('Filter-Presets konnten nicht geladen werden', error);
    }
  }

  private persistPresets(presets: SavedFilterPreset[]): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(this.presetStorageKey, JSON.stringify(presets));
    } catch (error) {
      console.warn('Filter-Presets konnten nicht gespeichert werden', error);
    }
  }

  private presetsMatchCurrent(preset: SavedFilterPreset): boolean {
    const currentFilters = this.filters();
    const currentSort = this.sort();
    return (
      this.filtersEqual(preset.filters, currentFilters) &&
      preset.sort.field === currentSort.field &&
      preset.sort.direction === currentSort.direction
    );
  }

  private filtersEqual(a: BusinessFilters, b: BusinessFilters): boolean {
    return (
      a.search === b.search &&
      a.assignment === b.assignment &&
      a.status === b.status &&
      a.dueDate === b.dueDate &&
      this.sameTags(a.tags, b.tags)
    );
  }

  private normalizeFilters(filters?: BusinessFilters): BusinessFilters {
    return {
      search: filters?.search ?? '',
      status: filters?.status ?? 'all',
      dueDate: filters?.dueDate ?? 'all',
      assignment: filters?.assignment ?? 'all',
      tags: filters?.tags ?? [],
    } as BusinessFilters;
  }

  private sameTags(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const normalize = (tags: string[]) =>
      [...tags].map((tag) => tag.toLowerCase()).sort();
    const aSorted = normalize(a);
    const bSorted = normalize(b);
    return aSorted.every((tag, index) => tag === bSorted[index]);
  }

  onStatusChange(id: string, status: BusinessStatus): void {
    this.businessService.updateStatus(id, status);
  }

  removeLinkedItem(id: string, itemId: string): void {
    const current = this.businessService
      .businesses()
      .find((business) => business.id === id)?.linkedOrderItemIds ?? [];
    const next = current.filter((existing) => existing !== itemId);
    this.businessService.setLinkedOrderItems(id, next);
  }

  deleteBusiness(business: Business): void {
    const confirmed = confirm(`Geschäft "${business.title}" löschen?`);
    if (!confirmed) {
      return;
    }
    this.startViewTransition();
    this.businessService.deleteBusiness(business.id);
    if (this.selectedBusinessId() === business.id) {
      this.selectedBusinessId.set(null);
    }
    this.removeFromBulkSelection(business.id);
  }

  openOrderItemPicker(business: Business): void {
    const dialogRef = this.dialog.open<OrderItemPickerDialogComponent, OrderItemPickerDialogData, string[] | undefined>(
      OrderItemPickerDialogComponent,
      {
        width: '720px',
        data: {
          options: this.orderItemOptions(),
          selectedIds: business.linkedOrderItemIds ?? [],
        },
      },
    );

    dialogRef.afterClosed().subscribe((selection) => {
      if (!selection) {
        return;
      }
      this.businessService.setLinkedOrderItems(business.id, selection);
    });
  }

  openOrderOverview(business: Business): void {
    this.router.navigate(['/'], {
      queryParams: { businessId: business.id },
    });
  }

  goToOrderItem(business: Business, itemId: string): void {
    this.router.navigate(['/'], {
      queryParams: {
        businessId: business.id,
        highlightItem: itemId,
      },
    });
  }

  orderItemMeta(itemId: string): OrderItemOption | undefined {
    return this.orderItemLookup().get(itemId);
  }

  orderItemRange(itemId: string): string | null {
    const meta = this.orderItemMeta(itemId);
    if (!meta?.start && !meta?.end) {
      return null;
    }
    const start = meta?.start
      ? this.datePipe.transform(meta.start, 'short')
      : '—';
    const end = meta?.end ? this.datePipe.transform(meta.end, 'short') : '—';
    return `${start} – ${end}`;
  }

  selectBusiness(business: Business): void {
    this.selectedBusinessId.set(business.id);
  }

  isBusinessSelected(business: Business): boolean {
    return this.selectedBusinessId() === business.id;
  }

  assignmentInitials(business: Business): string {
    return business.assignment.name
      .split(' ')
      .map((chunk) => chunk.trim()[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  businessHighlights(business: Business): BusinessHighlight[] {
    const highlights: BusinessHighlight[] = [];
    highlights.push({
      icon: 'flag',
      label: this.statusLabel(business.status),
      filter: { kind: 'status', value: business.status },
    });
    highlights.push({
      icon: this.assignmentIcon(business),
      label: this.assignmentLabel(business),
      filter: { kind: 'assignment', value: business.assignment.name },
    });
    const dueLabel = business.dueDate
      ? this.datePipe.transform(business.dueDate, 'mediumDate')
      : null;
    const createdLabel = this.datePipe.transform(business.createdAt, 'short') ?? business.createdAt;
    highlights.push({
      icon: 'event_available',
      label: `Erstellt ${createdLabel}`,
    });
    highlights.push({
      icon: 'schedule',
      label: dueLabel ? `Fällig ${dueLabel}` : 'Keine Fälligkeit',
    });
    return highlights;
  }

  applyHighlightFilter(event: MouseEvent, highlight: BusinessHighlight): void {
    if (!highlight.filter) {
      return;
    }
    event.stopPropagation();
    this.startViewTransition();
    this.clearActivePreset();
    if (highlight.filter.kind === 'status') {
      this.businessService.setFilters({ status: highlight.filter.value as BusinessStatus });
    }
    if (highlight.filter.kind === 'assignment') {
      this.businessService.setFilters({ assignment: highlight.filter.value });
    }
  }

  dueProgress(business: Business): number {
    const created = new Date(business.createdAt).getTime();
    if (!business.dueDate) {
      return 0;
    }
    const due = new Date(business.dueDate).getTime();
    if (Number.isNaN(created) || Number.isNaN(due) || due <= created) {
      return 100;
    }
    const now = Date.now();
    const total = due - created;
    const elapsed = Math.min(Math.max(0, now - created), total);
    return Math.round((elapsed / total) * 100);
  }

  daysUntilDue(business: Business): number | null {
    if (!business.dueDate) {
      return null;
    }
    const due = new Date(business.dueDate);
    const now = new Date();
    const diff = due.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  businessMetrics(business: Business): BusinessMetric[] {
    const linked = business.linkedOrderItemIds?.length ?? 0;
    const docs = business.documents?.length ?? 0;
    const daysLeft = this.daysUntilDue(business);
    return [
      {
        label: 'Positionen',
        value: linked,
        icon: 'work',
        hint: 'Verknüpfte Auftragspositionen',
      },
      {
        label: 'Dokumente',
        value: docs,
        icon: 'attach_file',
        hint: 'Hinterlegte Geschäftsdokumente',
      },
      {
        label: 'Tage übrig',
        value: daysLeft ?? '—',
        icon: 'calendar_today',
        hint: 'Tage bis zur Fälligkeit',
      },
    ];
  }

  businessTimeline(business: Business): TimelineEntry[] {
    const created = new Date(business.createdAt);
    const due = business.dueDate ? new Date(business.dueDate) : null;
    const today = new Date();
    const createdLabel =
      this.datePipe.transform(created, 'mediumDate') ?? created.toDateString();
    const dueLabel = due
      ? this.datePipe.transform(due, 'mediumDate') ?? due.toDateString()
      : 'Keine Angabe';

    const dueState: TimelineState = due
      ? this.isBeforeDay(due, today)
        ? 'past'
        : this.isSameDay(due, today)
        ? 'current'
        : 'future'
      : 'none';

    return [
      {
        label: 'Erstellt',
        description: createdLabel,
        state: 'past',
        date: created,
      },
      {
        label: 'Heute',
        description: this.datePipe.transform(today, 'mediumDate') ?? '',
        state:
          dueState === 'past'
            ? 'past'
            : dueState === 'current'
            ? 'current'
            : 'future',
        date: today,
      },
      {
        label: 'Fälligkeit',
        description: dueLabel,
        state: dueState,
        date: due,
      },
    ];
  }

  businessActivityFeed(business: Business): ActivityFeedItem[] {
    const items: ActivityFeedItem[] = [
      {
        icon: 'flag',
        title: `Status: ${this.statusLabel(business.status)}`,
        subtitle: `Aktualisiert am ${
          this.datePipe.transform(new Date(business.createdAt), 'medium') ??
          ''
        }`,
      },
    ];

    if (business.dueDate) {
      items.push({
        icon: 'calendar_today',
        title: 'Fälligkeit geplant',
        subtitle:
          this.datePipe.transform(business.dueDate, 'fullDate') ??
          business.dueDate,
      });
    }

    if (business.linkedOrderItemIds?.length) {
      items.push({
        icon: 'link',
        title: `${business.linkedOrderItemIds.length} Position${
          business.linkedOrderItemIds.length === 1 ? '' : 'en'
        } verknüpft`,
        subtitle: 'Zuletzt gepflegt im Positionen-Tab',
      });
    }

    return items;
  }

  healthBadge(business: Business): HealthBadge {
    if (business.status === 'erledigt') {
      return { tone: 'done', label: 'Abgeschlossen' };
    }
    const daysLeft = this.daysUntilDue(business);
    if (daysLeft === null) {
      return { tone: 'idle', label: 'Ohne Termin' };
    }
    if (daysLeft < 0) {
      return {
        tone: 'critical',
        label: `${Math.abs(daysLeft)} Tage überfällig`,
      };
    }
    if (daysLeft <= 3) {
      return {
        tone: 'warning',
        label: `Fällig in ${daysLeft} Tag${daysLeft === 1 ? '' : 'en'}`,
      };
    }
    return { tone: 'ok', label: 'Im Plan' };
  }

  assignmentLabel(business: Business): string {
    return business.assignment.type === 'group'
      ? `Gruppe ${business.assignment.name}`
      : business.assignment.name;
  }

  assignmentIcon(business: Business): string {
    return business.assignment.type === 'group' ? 'groups' : 'person';
  }

  statusLabel(status: BusinessStatus): string {
    return this.statusLabels[status];
  }

  dueDateState(business: Business):
    | 'overdue'
    | 'today'
    | 'upcoming'
    | 'none' {
    if (!business.dueDate) {
      return 'none';
    }
    const due = new Date(business.dueDate);
    const today = new Date();
    if (this.isBeforeDay(due, today)) {
      return 'overdue';
    }
    if (this.isSameDay(due, today)) {
      return 'today';
    }
    return 'upcoming';
  }

  trackByBusinessId(_: number, business: Business): string {
    return business.id;
  }

  businessElementId(id: string): string {
    return `business-${id}`;
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private isBeforeDay(a: Date, b: Date): boolean {
    const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return startA.getTime() < startB.getTime();
  }

  private generatePresetId(): string {
    return `preset-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  private defaultPresetName(): string {
    return `Ansicht ${this.savedPresets().length + 1}`;
  }

  private computeTopAssignments(): { name: string; type: Business['assignment']['type']; count: number }[] {
    const stats = new Map<
      string,
      { count: number; type: Business['assignment']['type'] }
    >();
    this.businesses().forEach((business) => {
      const entry = stats.get(business.assignment.name) ?? {
        count: 0,
        type: business.assignment.type,
      };
      entry.count += 1;
      entry.type = business.assignment.type;
      stats.set(business.assignment.name, entry);
    });
    return Array.from(stats.entries())
      .map(([name, info]) => ({ name, type: info.type, count: info.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }))
      .slice(0, 3);
  }

  private computeStatusBreakdown(): { status: BusinessStatus; label: string; count: number }[] {
    const counts = new Map<BusinessStatus, number>();
    this.businesses().forEach((business) => {
      counts.set(business.status, (counts.get(business.status) ?? 0) + 1);
    });
    const statuses: BusinessStatus[] = ['neu', 'in_arbeit', 'pausiert', 'erledigt'];
    return statuses
      .map((status) => ({
        status,
        label: this.statusLabel(status),
        count: counts.get(status) ?? 0,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }

  private computeDueSoonHighlights(): Business[] {
    return this.businesses()
      .filter((business) => business.dueDate && business.status !== 'erledigt')
      .sort(
        (a, b) =>
          new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime(),
      )
      .slice(0, 3);
  }

  private computeInsightContext(): BusinessInsightContext {
    const filters = this.filters();
    const search = this.searchControl.value.trim();
    const resultCount = this.businesses().length;
    if (search.length) {
      return {
        title: 'Suche aktiv',
        message: `Gefiltert nach "${search}" · ${resultCount} Treffer.`,
        hint: 'Suche leeren, um wieder alle Geschäfte zu sehen.',
        icon: 'search',
      };
    }
    if (filters.status !== 'all') {
      return {
        title: 'Statusfilter aktiv',
        message: `${this.statusLabel(filters.status as BusinessStatus)} · ${resultCount} Treffer.`,
        hint: 'Status oben im Filterbereich zurücksetzen.',
        icon: 'flag',
      };
    }
    if (filters.assignment !== 'all') {
      return {
        title: 'Zuständigkeit aktiv',
        message: `${filters.assignment} · ${resultCount} Geschäfte.`,
        hint: 'Zuständigkeitsfilter anpassen, um weitere anzuzeigen.',
        icon: 'groups',
      };
    }
    if (filters.dueDate !== 'all') {
      return {
        title: 'Fälligkeit aktiv',
        message: `${this.dueDateLabelLookup[filters.dueDate]} · ${resultCount} Geschäfte.`,
        hint: 'Preset in der Suche zurücksetzen für alle Termine.',
        icon: 'event',
      };
    }
    if (filters.tags.length) {
      return {
        title: 'Tags aktiv',
        message: `${filters.tags.map((tag) => this.formatTagLabel(tag)).join(', ')}`,
        hint: 'Tag-Chips unten anklicken, um Filter zu entfernen.',
        icon: 'sell',
      };
    }
    const metrics = this.overviewMetrics();
    return {
      title: 'Pipeline Überblick',
      message: `${metrics.total} Geschäfte · ${metrics.overdue} überfällig · ${metrics.dueSoon} fällig in 7 Tagen.`,
      hint: 'Nutze die Insights, um schnell in Tags, Zuständigkeiten oder Termine zu springen.',
      icon: 'insights',
    };
  }

  private loadInsightsCollapsed(): boolean {
    try {
      const storage = this.document?.defaultView?.localStorage;
      if (!storage) {
        return false;
      }
      return storage.getItem(BUSINESS_INSIGHTS_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private persistInsightsCollapsed(value: boolean): void {
    try {
      const storage = this.document?.defaultView?.localStorage;
      storage?.setItem(BUSINESS_INSIGHTS_STORAGE_KEY, String(value));
    } catch {
      // ignore storage issues
    }
  }

  private scrollToPendingBusiness(): void {
    if (!this.pendingScrollId) {
      return;
    }
    const element = this.document.getElementById(
      this.businessElementId(this.pendingScrollId),
    );
    if (!element) {
      return;
    }
    this.pendingScrollId = null;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.add('business-card--highlight');
    window.setTimeout(() => {
      element.classList.remove('business-card--highlight');
    }, 2000);
  }
}
