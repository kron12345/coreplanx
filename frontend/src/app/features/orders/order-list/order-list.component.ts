import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { ActivatedRoute } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { debounceTime, distinctUntilChanged } from 'rxjs';

import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import { OrderFilters, OrderService, OrderTtrPhase } from '../../../core/services/order.service';
import { Order } from '../../../core/models/order.model';
import { OrderItem } from '../../../core/models/order-item.model';
import { BusinessStatus } from '../../../core/models/business.model';
import { TimetablePhase } from '../../../core/models/timetable.model';
import { BusinessService } from '../../../core/services/business.service';
import { FilterBarComponent } from '../../filters/filter-bar/filter-bar.component';
import { OrderCardComponent } from '../order-card/order-card.component';
import { OrderCreateDialogComponent } from '../order-create-dialog.component';
import { OrderTemplateRecommendationComponent } from '../order-template-recommendation.component';

interface OrderSummary {
  order: Order;
  items: OrderItem[];
  itemCount: number;
  upcomingCount: number;
  attentionCount: number;
  tags: string[];
  customer?: string;
  timetableYear?: string;
  responsibles: string[];
}

interface OrderHeroMetrics {
  totalOrders: number;
  totalItems: number;
  upcomingItems: number;
  attentionItems: number;
  phaseCoverage: number;
  rollingPlanningItems: number;
  shortTermItems: number;
  adHocItems: number;
}

interface SearchSuggestion {
  label: string;
  value: string;
  icon: string;
  description: string;
}

interface OrdersHealthInsight {
  tone: 'ok' | 'warn' | 'critical';
  attentionPercent: number;
  upcomingPercent: number;
  summary: string;
  icon: string;
  title: string;
}

interface CollaborationContext {
  title: string;
  message: string;
  hint: string;
  icon: string;
}

interface OrderFilterPreset {
  id: string;
  name: string;
  filters: OrderFilters;
}

const INSIGHTS_COLLAPSED_STORAGE_KEY = 'orders.insightsCollapsed.v1';
const ORDER_PRESETS_STORAGE_KEY = 'orders.presets.v1';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ...MATERIAL_IMPORTS,
    FilterBarComponent,
    OrderCardComponent,
    OrderTemplateRecommendationComponent,
  ],
  templateUrl: './order-list.component.html',
  styleUrl: './order-list.component.scss',
})
export class OrderListComponent {
  private readonly store = inject(OrderService);
  private readonly businessService = inject(BusinessService);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly highlightItemId = signal<string | null>(null);
  private readonly viewTransitionFlag = signal(false);
  readonly isViewTransitioning = computed(() => this.viewTransitionFlag());
  readonly skeletonPlaceholders = Array.from({ length: 6 }, (_, index) => index);
  readonly templatePanelOpen = signal(false);

  readonly orders = computed(() => this.filteredOrders());
  readonly filters = computed(() => this.store.filters());
  readonly heroMetrics = computed(() => this.computeHeroMetrics());
  readonly tagStats = computed(() => this.computeTagStats());
  readonly responsibleStats = computed(() => this.computeResponsibleStats());
  readonly searchSuggestions = computed(() => this.computeSearchSuggestions());
  readonly topTags = computed(() => this.tagStats().slice(0, 3));
  readonly topResponsibles = computed(() => this.responsibleStats().slice(0, 3));
  readonly healthInsight = computed(() => this.computeHealthInsight());
  readonly collaborationContext = computed(() => this.computeCollaborationContext());
  readonly insightsCollapsed = signal(this.loadInsightsCollapsed());
  private readonly savedPresets = signal<OrderFilterPreset[]>([]);
  readonly savedFilterPresets = computed(() => this.savedPresets());
  private readonly activePresetId = signal<string | null>(null);
  readonly activePreset = computed(() => this.activePresetId());
  private readonly ttrPhaseMeta: Record<
    Exclude<OrderFilters['ttrPhase'], 'all'>,
    { label: string; window: string }
  > = {
    annual_request: { label: 'Annual TT Request', window: '12–7 Monate vor FP' },
    final_offer: { label: 'Final Offer (ENFP)', window: '7–4 Monate vor FP' },
    rolling_planning: { label: 'Rolling Planning', window: '13–3 Wochen vor FP' },
    short_term: { label: 'Short-Term', window: '30–7 Tage vor FP' },
    ad_hoc: { label: 'Ad-hoc', window: '0–7 Tage vor Produktion' },
    operational_delivery: { label: 'Operative Begleitung', window: 'laufender Betrieb' },
  };
  private readonly timelineReferenceLabels: Record<
    OrderFilters['timelineReference'],
    { label: string; hint: string }
  > = {
    fpDay: { label: 'Fahrplantag', hint: 'Planungsbezug' },
    fpYear: { label: 'Fahrplanjahr', hint: 'Jahresfrist' },
    operationalDay: { label: 'Produktionstag', hint: 'Echtzeit / Betrieb' },
  };

  constructor() {
    this.restorePresetsFromStorage();
    this.searchControl.setValue(this.store.filters().search, { emitEvent: false });
    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged())
      .subscribe((value) => {
        this.startViewTransition();
        this.clearActivePreset();
        this.store.setFilter({ search: value });
      });

    effect(() => {
      const next = this.store.filters().search;
      if (this.searchControl.value !== next) {
        this.searchControl.setValue(next, { emitEvent: false });
      }
    });

    this.route.queryParamMap.subscribe((params) => {
      const businessId = params.get('businessId');
      if (businessId) {
        this.store.setFilter({ linkedBusinessId: businessId });
      }
      const highlightItem = params.get('highlightItem');
      this.highlightItemId.set(highlightItem);
      if (highlightItem) {
        window.setTimeout(() => this.scrollToHighlightedItem(highlightItem), 0);
      }
    });

    effect(() => {
      this.orders();
      const target = this.highlightItemId();
      if (!target) {
        return;
      }
      window.setTimeout(() => this.scrollToHighlightedItem(target), 0);
    });

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

  readonly heroMetricList = computed(() => [
    {
      key: 'orders',
      label: 'Aufträge',
      value: this.heroMetrics().totalOrders,
      hint: 'Aktive Aufträge',
      icon: 'inventory_2',
      action: () => this.focusTtrPhase('all'),
    },
    {
      key: 'items',
      label: 'Positionen',
      value: this.heroMetrics().totalItems,
      hint: 'Summe aller Positionen',
      icon: 'view_list',
      action: () => {},
    },
    {
      key: 'upcoming',
      label: 'Diese Woche',
      value: this.heroMetrics().upcomingItems,
      hint: 'Start in den nächsten 7 Tagen',
      icon: 'event',
      action: () => this.focusUpcoming(),
    },
    {
      key: 'attention',
      label: 'Auffälligkeiten',
      value: this.heroMetrics().attentionItems,
      hint: 'Positionen mit Abweichung',
      icon: 'warning',
      action: () => this.focusAttention(),
    },
    {
      key: 'phaseCoverage',
      label: 'TTR-Phasen aktiv',
      value: this.heroMetrics().phaseCoverage,
      hint: 'Abgedeckte TTR-Buckets',
      icon: 'category',
      action: () => this.focusTtrPhase('all'),
    },
    {
      key: 'rolling',
      label: 'Rolling Window',
      value: this.heroMetrics().rollingPlanningItems,
      hint: '13–3 Wochen vor FP',
      icon: 'sync_alt',
      action: () => this.focusTtrPhase('rolling_planning'),
    },
    {
      key: 'shortTerm',
      label: 'Short-Term',
      value: this.heroMetrics().shortTermItems,
      hint: '30–7 Tage vor FP',
      icon: 'bolt',
      action: () => this.focusTtrPhase('short_term'),
    },
    {
      key: 'adHoc',
      label: 'Ad-hoc',
      value: this.heroMetrics().adHocItems,
      hint: '0–7 Tage vor Produktion',
      icon: 'flash_on',
      action: () => this.focusTtrPhase('ad_hoc'),
    },
  ]);

  openCreateDialog(): void {
    this.dialog.open(OrderCreateDialogComponent, {
      width: '760px',
      maxWidth: '95vw',
    });
  }

  trackByOrderId(_: number, entry: { order: Order }): string {
    return entry.order.id;
  }

  formatTagLabel(tag?: string | null): string {
    if (!tag || tag === 'all') {
      return '#—';
    }
    return tag.startsWith('#') ? tag : `#${tag}`;
  }

  tagTone(tag: string): 'region' | 'phase' | 'risk' | 'priority' | 'default' {
    const normalized = tag.toLowerCase();
    if (normalized.startsWith('de-') || ['ch', 'at'].some((region) => normalized.includes(region))) {
      return 'region';
    }
    if (['rollout', 'pitch', 'vertrag', 'pilot'].some((keyword) => normalized.includes(keyword))) {
      return 'phase';
    }
    if (['risk', 'risiko', 'warn', 'esc'].some((keyword) => normalized.includes(keyword))) {
      return 'risk';
    }
    if (['premium', 'priority', 'vip', 'high'].some((keyword) => normalized.includes(keyword))) {
      return 'priority';
    }
    return 'default';
  }

  isTagSelected(tag: string): boolean {
    return this.store.filters().tag === tag;
  }

  toggleTagFilter(tag: string): void {
    const current = this.store.filters().tag;
    const next = current === tag ? 'all' : tag;
    this.clearActivePreset();
    this.store.setFilter({ tag: next });
  }

  clearTagFilter(): void {
    this.clearActivePreset();
    this.store.setFilter({ tag: 'all' });
  }

  clearTtrPhaseFilter(): void {
    this.clearActivePreset();
    this.store.setFilter({ ttrPhase: 'all' });
  }

  clearFpRangeFilter(): void {
    this.clearActivePreset();
    this.store.setFilter({ fpRangeStart: null, fpRangeEnd: null });
  }

  resetTimelineReference(): void {
    this.clearActivePreset();
    this.store.setFilter({ timelineReference: 'fpDay' });
  }

  describeTtrPhase(phase: OrderFilters['ttrPhase']): string {
    if (phase === 'all') {
      return 'Alle TTR-Phasen';
    }
    return this.ttrPhaseMeta[phase]?.label ?? phase;
  }

  describeTtrPhaseWindow(phase: OrderFilters['ttrPhase']): string {
    if (phase === 'all') {
      return 'Keine Einschränkung';
    }
    return this.ttrPhaseMeta[phase]?.window ?? '';
  }

  hasFpRange(): boolean {
    const filters = this.filters();
    return Boolean(filters.fpRangeStart || filters.fpRangeEnd);
  }

  fpRangeLabel(): string {
    const filters = this.filters();
    if (filters.fpRangeStart && filters.fpRangeEnd) {
      return `${this.formatDateLabel(filters.fpRangeStart)} – ${this.formatDateLabel(filters.fpRangeEnd)}`;
    }
    if (filters.fpRangeStart) {
      return `ab ${this.formatDateLabel(filters.fpRangeStart)}`;
    }
    if (filters.fpRangeEnd) {
      return `bis ${this.formatDateLabel(filters.fpRangeEnd)}`;
    }
    return '';
  }

  timelineReferenceLabel(): string {
    return this.timelineReferenceLabels[this.filters().timelineReference]?.label ?? 'Fahrplantag';
  }

  timelineReferenceHint(): string {
    return this.timelineReferenceLabels[this.filters().timelineReference]?.hint ?? '';
  }

  private formatDateLabel(value: string): string {
    try {
      return new Intl.DateTimeFormat('de-DE').format(new Date(`${value}T00:00:00`));
    } catch {
      return value;
    }
  }

  applyTagInsight(tag: string): void {
    this.startViewTransition();
    this.clearActivePreset();
    this.store.setFilter({ tag });
  }

  applyResponsibleInsight(responsible: string): void {
    this.upsertSearchToken('resp', responsible);
  }

  focusAttention(): void {
    this.searchControl.setValue('deviation');
  }

  focusUpcoming(): void {
    this.startViewTransition();
    this.clearActivePreset();
    this.store.setFilter({ timeRange: 'thisWeek' });
  }

  focusTtrPhase(phase: OrderFilters['ttrPhase']): void {
    this.startViewTransition();
    if (phase === 'all') {
      this.clearTtrPhaseFilter();
      return;
    }
    this.clearActivePreset();
    this.store.setFilter({ ttrPhase: phase });
  }

  toggleInsightsCollapsed(): void {
    this.insightsCollapsed.update((current) => {
      const next = !current;
      this.persistInsightsCollapsed(next);
      return next;
    });
  }

  tagUsageCount(tag: string): number {
    if (!tag || tag === 'all') {
      return this.orders().length;
    }
    const stat = this.tagStats().find(([name]) => name === tag);
    return stat ? stat[1] : 0;
  }

  onSearchSuggestionSelected(event: MatAutocompleteSelectedEvent): void {
    const value = event.option?.value as string;
    if (!value) {
      return;
    }
    const current = this.searchControl.value.trim();
    const next = current.length ? `${current} ${value}` : value;
    this.searchControl.setValue(`${next} `);
  }

  private filteredOrders() {
    const filters = this.store.filters();
    const orders = this.store.filteredOrders();
    const itemFiltersActive =
      filters.timeRange !== 'all' ||
      filters.trainStatus !== 'all' ||
      filters.businessStatus !== 'all' ||
      filters.trainNumber.trim() !== '' ||
      filters.timetableYearLabel !== 'all' ||
      filters.ttrPhase !== 'all' ||
      Boolean(filters.fpRangeStart) ||
      Boolean(filters.fpRangeEnd) ||
      Boolean(filters.linkedBusinessId);

    return orders
      .map((order) => ({
        order,
        items: this.filteredItems(order),
      }))
      .filter(({ items }) => (itemFiltersActive ? items.length > 0 : true));
  }

  private filteredItems(order: Order): OrderItem[] {
    const filters = this.store.filters();
    const base = this.store.filterItemsForOrder(order);
    if (filters.businessStatus === 'all') {
      return base;
    }
    return base.filter((item) =>
      this.itemMatchesBusinessStatus(item, filters.businessStatus as BusinessStatus),
    );
  }

  private itemMatchesBusinessStatus(item: OrderItem, status: BusinessStatus): boolean {
    const businessIds = item.linkedBusinessIds ?? [];
    if (!businessIds.length) {
      return false;
    }
    const businesses = this.businessService.getByIds(businessIds);
    return businesses.some((business) => business.status === status);
  }

  private computeHeroMetrics(): OrderHeroMetrics {
    const entries = this.orders();
    let totalItems = 0;
    let upcoming = 0;
    let attention = 0;
    let rollingPlanning = 0;
    let shortTerm = 0;
    let adHoc = 0;
    const phaseSet = new Set<OrderTtrPhase>();
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    entries.forEach(({ items }) => {
      items.forEach((item) => {
        totalItems += 1;
        if (item.deviation) {
          attention += 1;
        }
        const start = item.start ? new Date(item.start) : null;
        if (start && start >= now && start <= nextWeek) {
          upcoming += 1;
        }
         const phase = this.store.getTtrPhaseForItem(item);
         if (phase && phase !== 'unknown') {
           phaseSet.add(phase);
           if (phase === 'rolling_planning') {
             rollingPlanning += 1;
           } else if (phase === 'short_term') {
             shortTerm += 1;
           } else if (phase === 'ad_hoc') {
             adHoc += 1;
           }
         }
      });
    });

    return {
      totalOrders: entries.length,
      totalItems,
      upcomingItems: upcoming,
      attentionItems: attention,
      phaseCoverage: phaseSet.size,
      rollingPlanningItems: rollingPlanning,
      shortTermItems: shortTerm,
      adHocItems: adHoc,
    };
  }

  private computeTagStats(): [string, number][] {
    const stats = new Map<string, number>();
    this.orders().forEach(({ order }) => {
      order.tags?.forEach((tag) => stats.set(tag, (stats.get(tag) ?? 0) + 1));
    });
    return Array.from(stats.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }),
    );
  }

  private computeResponsibleStats(): [string, number][] {
    const stats = new Map<string, number>();
    this.orders().forEach(({ items }) => {
      items.forEach((item) => {
        const responsible = item.responsible?.trim();
        if (responsible) {
          stats.set(responsible, (stats.get(responsible) ?? 0) + 1);
        }
      });
    });
    return Array.from(stats.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de', { sensitivity: 'base' }),
    );
  }

  private computeSearchSuggestions(): SearchSuggestion[] {
    const query = this.searchControl.value.trim().toLowerCase();
    const suggestions: SearchSuggestion[] = [];

    this.tagStats().forEach(([tag, count]) => {
      suggestions.push({
        label: this.formatTagLabel(tag),
        value: `tag:${this.encodeTokenValue(tag)}`,
        icon: 'sell',
        description: `${count} Treffer · Tag`,
      });
    });

    this.responsibleStats().forEach(([name, count]) => {
      suggestions.push({
        label: name,
        value: `resp:${this.encodeTokenValue(name)}`,
        icon: 'person',
        description: `${count} Positionen · Verantwortlich`,
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
  }

  private computeHealthInsight(): OrdersHealthInsight {
    const metrics = this.heroMetrics();
    const total = Math.max(metrics.totalItems, 1);
    const attentionPercent = Math.round((metrics.attentionItems / total) * 100);
    const upcomingPercent = Math.round((metrics.upcomingItems / total) * 100);
    let tone: OrdersHealthInsight['tone'];
    let icon: string;
    let title: string;

    if (attentionPercent >= 30) {
      tone = 'critical';
      icon = 'crisis_alert';
      title = 'Hohe Aufmerksamkeit';
    } else if (attentionPercent >= 12) {
      tone = 'warn';
      icon = 'warning_amber';
      title = 'Im Blick behalten';
    } else {
      tone = 'ok';
      icon = 'task_alt';
      title = 'Planmäßig';
    }

    return {
      tone,
      attentionPercent,
      upcomingPercent,
      icon,
      title,
      summary: `${metrics.attentionItems} Abweichung${metrics.attentionItems === 1 ? '' : 'en'} · ${metrics.upcomingItems} Starts in 7 Tagen`,
    };
  }


  private encodeTokenValue(value: string): string {
    return value.includes(' ') ? `"${value}"` : value;
  }

  private upsertSearchToken(tokenPrefix: string, rawValue: string): void {
    const normalizedPrefix = `${tokenPrefix.toLowerCase()}:`;
    const formatted = `${tokenPrefix}:${this.encodeTokenValue(rawValue)}`;
    const currentTokens = this.searchControl.value
      .trim()
      .split(/\s+/)
      .filter((token) => token.length);
    const filteredTokens = currentTokens.filter(
      (token) => !token.toLowerCase().startsWith(normalizedPrefix),
    );
    filteredTokens.push(formatted);
    this.searchControl.setValue(`${filteredTokens.join(' ')} `);
  }

  saveCurrentFilterPreset(): void {
    const view = this.document?.defaultView;
    if (!view) {
      return;
    }
    const name = view.prompt('Filteransicht benennen', this.defaultPresetName())?.trim();
    if (!name) {
      return;
    }
    const preset: OrderFilterPreset = {
      id: this.generatePresetId(),
      name,
      filters: this.currentFiltersSnapshot(),
    };
    this.savedPresets.update((current) => [...current, preset]);
    this.activePresetId.set(preset.id);
  }

  applyFilterPreset(preset: OrderFilterPreset): void {
    this.startViewTransition();
    this.searchControl.setValue(preset.filters.search, { emitEvent: false });
    this.store.setFilter({ ...preset.filters });
    this.activePresetId.set(preset.id);
  }

  removeFilterPreset(id: string): void {
    this.savedPresets.update((current) =>
      current.filter((preset) => preset.id !== id),
    );
    if (this.activePresetId() === id) {
      this.activePresetId.set(null);
    }
  }

  duplicateFilterPreset(preset: OrderFilterPreset): void {
    const copy: OrderFilterPreset = {
      id: this.generatePresetId(),
      name: `${preset.name} (Kopie)`,
      filters: this.normalizeFilters(preset.filters),
    };
    this.savedPresets.update((current) => [...current, copy]);
  }

  renameFilterPreset(preset: OrderFilterPreset): void {
    const view = this.document?.defaultView;
    if (!view) {
      return;
    }
    const nextName = view.prompt('Neuen Namen vergeben', preset.name)?.trim();
    if (!nextName || nextName === preset.name) {
      return;
    }
    this.savedPresets.update((current) =>
      current.map((entry) =>
        entry.id === preset.id ? { ...entry, name: nextName } : entry,
      ),
    );
  }

  private computeCollaborationContext(): CollaborationContext {
    const filters = this.filters();
    const metrics = this.heroMetrics();
    const totalOrders = this.orders().length;
    if (filters.tag !== 'all') {
      const count = this.tagUsageCount(filters.tag);
      return {
        title: 'Tag-Fokus aktiv',
        message: `${this.formatTagLabel(filters.tag)} in ${count} Auftrag${count === 1 ? '' : 'en'} sichtbar.`,
        hint: 'Filter entfernen, um alle Tags zu sehen.',
        icon: 'sell',
      };
    }

    const search = filters.search.trim();
    if (search) {
      return {
        title: 'Freitextsuche aktiv',
        message: `Gefiltert nach "${search}" · ${totalOrders} Treffer.`,
        hint: 'Suchfeld leeren für den Gesamtabgleich.',
        icon: 'search',
      };
    }

    if (filters.linkedBusinessId) {
      return {
        title: 'Geschäfts-Kontext',
        message: `Nur Positionen des Geschäfts ${filters.linkedBusinessId} eingeblendet.`,
        hint: 'Filter zurücksetzen, um alle Verknüpfungen zu prüfen.',
        icon: 'hub',
      };
    }

    if (filters.timeRange !== 'all') {
      return {
        title: 'Zeitfenster aktiv',
        message: `Ansicht auf ${this.describeTimeRange(filters.timeRange)} reduziert.`,
        hint: 'Zeitfilter oben in den Pills löschen.',
        icon: 'event',
      };
    }

    if (filters.businessStatus !== 'all' || filters.trainStatus !== 'all') {
      return {
        title: 'Status-Fokus',
        message: `Pipeline zeigt nur ${filters.businessStatus !== 'all' ? this.friendlyBusinessStatus(filters.businessStatus as BusinessStatus) : this.friendlyPhase(filters.trainStatus as TimetablePhase)}.`,
        hint: 'Status-Chips im Kartenkopf zurücksetzen.',
        icon: 'adjust',
      };
    }

    return {
      title: 'Pipeline Überblick',
      message: `${metrics.totalOrders} Aufträge · ${metrics.attentionItems} Auffälligkeiten · ${metrics.upcomingItems} demnächst.`,
      hint: 'Insights unterhalb liefern Details zu Tags & Verantwortlichen.',
      icon: 'group_work',
    };
  }

  private describeTimeRange(range: OrderFilters['timeRange']): string {
    switch (range) {
      case 'next4h':
        return 'die nächsten 4 Stunden';
      case 'next12h':
        return 'die nächsten 12 Stunden';
      case 'today':
        return 'heute';
      case 'thisWeek':
        return 'diese Woche';
      default:
        return 'alle Zeiträume';
    }
  }

  private currentFiltersSnapshot(): OrderFilters {
    const snapshot: Partial<OrderFilters> = { ...this.filters() };
    snapshot.search = this.searchControl.value;
    return this.normalizeFilters(snapshot);
  }

  private normalizeFilters(filters?: Partial<OrderFilters>): OrderFilters {
    return {
      search: filters?.search ?? '',
      tag: filters?.tag ?? 'all',
      timeRange: filters?.timeRange ?? 'all',
      trainStatus: filters?.trainStatus ?? 'all',
      businessStatus: filters?.businessStatus ?? 'all',
      internalStatus: filters?.internalStatus ?? 'all',
      trainNumber: filters?.trainNumber ?? '',
      timetableYearLabel: filters?.timetableYearLabel ?? 'all',
      linkedBusinessId: filters?.linkedBusinessId ?? null,
      fpRangeStart: filters?.fpRangeStart ?? null,
      fpRangeEnd: filters?.fpRangeEnd ?? null,
      timelineReference: filters?.timelineReference ?? 'fpDay',
      ttrPhase: filters?.ttrPhase ?? 'all',
    };
  }

  private filtersEqual(a: OrderFilters, b: OrderFilters): boolean {
    return (
      a.search === b.search &&
      a.tag === b.tag &&
      a.timeRange === b.timeRange &&
      a.trainStatus === b.trainStatus &&
      a.businessStatus === b.businessStatus &&
      a.internalStatus === b.internalStatus &&
      a.trainNumber === b.trainNumber &&
      a.timetableYearLabel === b.timetableYearLabel &&
      (a.linkedBusinessId ?? null) === (b.linkedBusinessId ?? null) &&
      (a.fpRangeStart ?? null) === (b.fpRangeStart ?? null) &&
      (a.fpRangeEnd ?? null) === (b.fpRangeEnd ?? null) &&
      a.timelineReference === b.timelineReference &&
      a.ttrPhase === b.ttrPhase
    );
  }

  private presetsMatchCurrent(preset: OrderFilterPreset): boolean {
    return this.filtersEqual(preset.filters, this.filters());
  }

  private restorePresetsFromStorage(): void {
    try {
      const storage = this.document?.defaultView?.localStorage;
      if (!storage) {
        return;
      }
      const raw = storage.getItem(ORDER_PRESETS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<OrderFilterPreset>[] | undefined;
      if (!Array.isArray(parsed)) {
        return;
      }
      const normalized = parsed
        .map((entry) => {
          if (!entry?.id || !entry.name) {
            return null;
          }
          return {
            id: entry.id,
            name: entry.name,
            filters: this.normalizeFilters(entry.filters as Partial<OrderFilters> | undefined),
          };
        })
        .filter((entry): entry is OrderFilterPreset => !!entry);
      this.savedPresets.set(normalized);
    } catch (error) {
      console.warn('Auftrags-Presets konnten nicht geladen werden', error);
    }
  }

  private persistPresets(presets: OrderFilterPreset[]): void {
    try {
      const storage = this.document?.defaultView?.localStorage;
      storage?.setItem(ORDER_PRESETS_STORAGE_KEY, JSON.stringify(presets));
    } catch (error) {
      console.warn('Auftrags-Presets konnten nicht gespeichert werden', error);
    }
  }

  private clearActivePreset(): void {
    if (this.activePresetId()) {
      this.activePresetId.set(null);
    }
  }

  private defaultPresetName(): string {
    return `Ansicht ${this.savedPresets().length + 1}`;
  }

  private generatePresetId(): string {
    return `order-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private friendlyBusinessStatus(status: BusinessStatus): string {
    switch (status) {
      case 'neu':
        return 'neue Geschäfte';
      case 'in_arbeit':
        return 'laufende Geschäfte';
      case 'pausiert':
        return 'pausierte Geschäfte';
      case 'erledigt':
        return 'erledigte Geschäfte';
      default:
        return 'Geschäfte';
    }
  }

  private friendlyPhase(phase: TimetablePhase | 'all'): string {
    switch (phase) {
      case 'bedarf':
        return 'Draft';
      case 'path_request':
        return 'Path Request';
      case 'offer':
        return 'Offered';
      case 'contract':
        return 'Booked';
      case 'operational':
        return 'Used';
      case 'archived':
        return 'Cancelled';
      default:
        return 'all phases';
    }
  }

  private isUpcoming(item: OrderItem): boolean {
    if (!item.start) {
      return false;
    }
    const start = new Date(item.start);
    const now = new Date();
    const week = new Date();
    week.setDate(now.getDate() + 7);
    return start >= now && start <= week;
  }

  private scrollToHighlightedItem(itemId: string | null): void {
    if (!itemId) {
      return;
    }
    const element = this.document.getElementById(`order-item-${itemId}`);
    if (!element) {
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      if (this.highlightItemId() === itemId) {
        this.highlightItemId.set(null);
      }
    }, 2500);
  }

  private startViewTransition(): void {
    this.viewTransitionFlag.set(true);
    window.setTimeout(() => this.viewTransitionFlag.set(false), 320);
  }

  toggleTemplatePanel(force?: boolean): void {
    if (typeof force === 'boolean') {
      this.templatePanelOpen.set(force);
      return;
    }
    this.templatePanelOpen.update((open) => !open);
  }

  @HostListener('window:keydown', ['$event'])
  handleShortcuts(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      const input = this.document.querySelector<HTMLInputElement>('input[matinput]');
      input?.focus();
    }
  }

  private loadInsightsCollapsed(): boolean {
    try {
      const storage = this.document?.defaultView?.localStorage;
      if (!storage) {
        return false;
      }
      return storage.getItem(INSIGHTS_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private persistInsightsCollapsed(value: boolean): void {
    try {
      const storage = this.document?.defaultView?.localStorage;
      storage?.setItem(INSIGHTS_COLLAPSED_STORAGE_KEY, String(value));
    } catch {
      // ignore
    }
  }
}
