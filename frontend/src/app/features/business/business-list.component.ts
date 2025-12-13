import { CommonModule, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  DOCUMENT,
} from '@angular/core';
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
  BusinessService,
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
import { BusinessHeroComponent } from './business-hero.component';
import { BusinessInsightsComponent } from './business-insights.component';
import {
  BUSINESS_DUE_DATE_LABEL_LOOKUP,
  BUSINESS_DUE_DATE_PRESET_OPTIONS,
  BUSINESS_PAGE_SIZE,
  BUSINESS_SORT_OPTIONS,
  BUSINESS_STATUS_LABEL_LOOKUP,
  BUSINESS_STATUS_LABELS,
  BUSINESS_STATUS_OPTIONS,
} from './business-list.constants';
import {
  businessPresetMatchesCurrent,
  createBusinessPresetId,
  defaultBusinessPresetName,
  loadBusinessFilterPresets,
  persistBusinessFilterPresets,
} from './business-list.presets';
import {
  assignmentIcon,
  assignmentInitials,
  assignmentLabel,
  buildBusinessHighlights,
  buildOrderItemLookup,
  businessActivityFeed as buildBusinessActivityFeed,
  businessElementId,
  businessMetrics,
  businessTimeline as buildBusinessTimeline,
  computeDueSoonHighlights,
  computeInsightContext,
  computeOverviewMetrics,
  computeSearchSuggestions,
  computeStatusBreakdown,
  computeTagStats,
  computeTopAssignments,
  daysUntilDue,
  dueDateState,
  dueProgress,
  formatTagLabel,
  healthBadge,
  orderItemRange as formatOrderItemRange,
  tagTone,
  trackByBusinessId,
} from './business-list.utils';
import type {
  BusinessHighlight,
  MetricTrend,
  PipelineMetrics,
  SavedFilterPreset,
  SearchSuggestion,
} from './business-list.types';

@Component({
    selector: 'app-business-list',
    imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS, BusinessHeroComponent, BusinessInsightsComponent],
    templateUrl: './business-list.component.html',
    styleUrl: './business-list.component.scss',
    providers: [DatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class BusinessListComponent {
  private readonly businessService = inject(BusinessService);
  private readonly orderService = inject(OrderService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly datePipe = inject(DatePipe);
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('filterShelf') filterShelf?: ElementRef<HTMLElement>;

  readonly searchControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(80)],
  });

  readonly statusOptions = BUSINESS_STATUS_OPTIONS;
  readonly dueDatePresetOptions = BUSINESS_DUE_DATE_PRESET_OPTIONS;
  readonly sortOptions = BUSINESS_SORT_OPTIONS;

  readonly statusLabelLookup = BUSINESS_STATUS_LABEL_LOOKUP;
  readonly dueDateLabelLookup = BUSINESS_DUE_DATE_LABEL_LOOKUP;

  readonly assignments = computed(() => this.businessService.assignments());
  readonly filters = computed(() => this.businessService.filters());
  readonly sort = computed(() => this.businessService.sort());
  readonly businesses = computed(() => this.businessService.filteredBusinesses());
  readonly totalBusinesses = computed(() => this.businessService.businesses().length);
  private readonly visibleCount = signal(BUSINESS_PAGE_SIZE);
  readonly visibleBusinesses = computed(() =>
    this.businesses().slice(0, this.visibleCount()),
  );
  readonly hasMoreBusinesses = computed(
    () => this.visibleCount() < this.businesses().length,
  );
  readonly detailJumpVisible = signal(false);
  readonly orderItemOptions = computed<OrderItemOption[]>(() =>
    this.orderService.orderItemOptions(),
  );
  readonly tagStats = computed(() => computeTagStats(this.businesses()));
  readonly availableTags = computed(() => this.tagStats().map(([tag]) => tag));
  readonly topTagInsights = computed(() => this.tagStats().slice(0, 3));
  readonly topAssignments = computed(() => computeTopAssignments(this.businesses()));
  readonly statusBreakdown = computed(() =>
    computeStatusBreakdown(this.businesses(), this.statusLabel),
  );
  readonly dueSoonHighlights = computed(() =>
    computeDueSoonHighlights(this.businesses()),
  );
  readonly overviewMetrics = computed(() => computeOverviewMetrics(this.businesses()));
  readonly insightContext = computed(() =>
    computeInsightContext({
      filters: this.filters(),
      search: this.searchControl.value,
      resultCount: this.businesses().length,
      statusLabel: this.statusLabel,
      dueDateLabelLookup: this.dueDateLabelLookup,
      formatTagLabel: this.formatTagLabel,
      metrics: this.overviewMetrics(),
    }),
  );
  readonly searchSuggestions = computed<SearchSuggestion[]>(() =>
    computeSearchSuggestions({
      query: this.searchControl.value,
      tagStats: this.tagStats(),
      assignments: this.assignments(),
      statusOptions: this.statusOptions,
    }),
  );
  readonly orderItemLookup = computed(() => buildOrderItemLookup(this.orderItemOptions()));

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
  readonly statusLabel = (status: BusinessStatus) => BUSINESS_STATUS_LABELS[status];
  readonly formatTagLabel = formatTagLabel;
  readonly tagTone = tagTone;
  readonly assignmentInitials = assignmentInitials;
  readonly assignmentLabel = assignmentLabel;
  readonly assignmentIcon = assignmentIcon;
  readonly dueProgress = dueProgress;
  readonly daysUntilDue = daysUntilDue;
  readonly businessMetrics = businessMetrics;
  readonly healthBadge = healthBadge;
  readonly dueDateState = dueDateState;
  readonly trackByBusinessId = trackByBusinessId;
  readonly businessElementId = businessElementId;
  readonly orderItemRange = (itemId: string) =>
    formatOrderItemRange(itemId, this.orderItemLookup(), this.datePipe);
  readonly businessHighlights = (business: Business) =>
    buildBusinessHighlights(business, {
      datePipe: this.datePipe,
      statusLabel: this.statusLabel,
      assignmentIcon: this.assignmentIcon,
      assignmentLabel: this.assignmentLabel,
    });
  readonly businessTimeline = (business: Business) =>
    buildBusinessTimeline(business, this.datePipe);
  readonly businessActivityFeed = (business: Business) =>
    buildBusinessActivityFeed(business, {
      datePipe: this.datePipe,
      statusLabel: this.statusLabel,
    });

  private pendingScrollId: string | null = null;

  constructor() {
    this.savedPresets.set(loadBusinessFilterPresets(this.presetStorageKey));
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

    effect(
      () => {
        // Reset sichtbare Ergebnisse bei Filter-/Sort-Änderungen
        this.businesses();
        this.sort();
        this.visibleCount.set(BUSINESS_PAGE_SIZE);
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      persistBusinessFilterPresets(this.presetStorageKey, this.savedPresets());
    });

    effect(
      () => {
        const activeId = this.activePresetId();
        if (!activeId) {
          return;
        }
        const preset = this.savedPresets().find((entry) => entry.id === activeId);
        if (!preset || !businessPresetMatchesCurrent(preset, this.filters(), this.sort())) {
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
      width: '900px',
      maxWidth: '95vw',
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

  loadMoreBusinesses(): void {
    if (!this.hasMoreBusinesses()) {
      return;
    }
    const next = Math.min(
      this.visibleCount() + BUSINESS_PAGE_SIZE,
      this.businesses().length,
    );
    this.visibleCount.set(next);
  }

  saveCurrentFilterPreset(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const name = window
      .prompt('Filteransicht benennen', defaultBusinessPresetName(this.savedPresets().length))
      ?.trim();
    if (!name) {
      return;
    }
    const preset: SavedFilterPreset = {
      id: createBusinessPresetId(),
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
      id: createBusinessPresetId(),
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
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (key === '/') {
        event.preventDefault();
        this.focusSearch();
        return;
      }
      if (key === 'g') {
        event.preventDefault();
        this.scrollToFilters();
        return;
      }
      if (key === 'j') {
        event.preventDefault();
        this.selectRelativeBusiness(1);
        return;
      }
      if (key === 'k') {
        event.preventDefault();
        this.selectRelativeBusiness(-1);
        return;
      }
    }
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const y = this.document.defaultView?.scrollY ?? 0;
    this.detailJumpVisible.set(y > 240);
  }

  private focusSearch(): void {
    if (this.searchInput?.nativeElement) {
      this.searchInput.nativeElement.focus();
      setTimeout(() => this.searchInput?.nativeElement.select(), 0);
    }
  }

  private scrollToFilters(): void {
    if (this.filterShelf?.nativeElement) {
      this.filterShelf.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    this.focusSearch();
  }

  private selectRelativeBusiness(offset: number): void {
    const list = this.visibleBusinesses();
    if (!list.length) {
      return;
    }
    const currentId = this.selectedBusinessId();
    let index = currentId ? list.findIndex((b) => b.id === currentId) : 0;
    if (index === -1) {
      index = 0;
    }
    const next = list[Math.min(Math.max(0, index + offset), list.length - 1)];
    if (next) {
      this.selectedBusinessId.set(next.id);
      this.scrollToBusinessCard(next.id);
    }
  }

  scrollToBusinessCard(id: string): void {
    const element = this.document.getElementById(this.businessElementId(id));
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  selectBusiness(business: Business): void {
    this.selectedBusinessId.set(business.id);
  }

  isBusinessSelected(business: Business): boolean {
    return this.selectedBusinessId() === business.id;
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
