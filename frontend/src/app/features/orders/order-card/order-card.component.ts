import { ChangeDetectionStrategy, Component, Input, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import { Order, OrderProcessStatus } from '../../../core/models/order.model';
import { OrderItem, InternalProcessingStatus } from '../../../core/models/order-item.model';
import { OrderItemListComponent } from '../order-item-list/order-item-list.component';
import { OrderPositionDialogComponent } from '../order-position-dialog.component';
import { BusinessService } from '../../../core/services/business.service';
import { BusinessStatus } from '../../../core/models/business.model';
import {
  OrderService,
  OrderTtrPhase,
  OrderTtrPhaseFilter,
} from '../../../core/services/order.service';
import { CustomerService } from '../../../core/services/customer.service';
import { Customer } from '../../../core/models/customer.model';
import { TimetableService } from '../../../core/services/timetable.service';
import { TimetablePhase } from '../../../core/models/timetable.model';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  OrderLinkBusinessDialogComponent,
  OrderLinkBusinessDialogData,
} from '../order-link-business-dialog.component';
import {
  OrderStatusUpdateDialogComponent,
  OrderStatusUpdateDialogData,
} from '../order-status-update-dialog.component';
import { OrderManagementCollaborationService } from '../../../core/services/order-management-collaboration.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../shared/confirm-dialog/confirm-dialog.component';
import {
  SimulationAssignDialogComponent,
  SimulationAssignDialogResult,
} from '../shared/simulation-assign-dialog/simulation-assign-dialog.component';
import {
  BUSINESS_STATUS_LABELS,
  FILTERABLE_TTR_PHASES,
  INTERNAL_STATUS_LABELS,
  ORDER_PROCESS_STATUS_LABELS,
  TIMETABLE_PHASE_LABELS,
} from './order-card.constants';
import type { OrderHealthSnapshot, StatusSummary } from './order-card.types';

@Component({
    selector: 'app-order-card',
    imports: [
        CommonModule,
        ...MATERIAL_IMPORTS,
        OrderItemListComponent,
    ],
    templateUrl: './order-card.component.html',
    styleUrl: './order-card.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderCardComponent {
  private readonly collaboration = inject(OrderManagementCollaborationService);
  private readonly orderSignal = signal<Order | null>(null);
  private readonly itemsSignal = signal<OrderItem[] | null>(null);

  private _order!: Order;

  @Input({ required: true })
  set order(value: Order) {
    this._order = value;
    this.orderSignal.set(value);
  }
  get order(): Order {
    return this._order;
  }

  @Input()
  set items(value: OrderItem[] | null) {
    this.itemsSignal.set(value);
  }
  get items(): OrderItem[] | null {
    return this.itemsSignal();
  }

  @Input()
  highlightItemId: string | null = null;
  expanded = signal(false);
  private readonly autoExpandedByFilter = signal(false);
  readonly businessStatusSummaries = computed(() =>
    this.computeBusinessStatusSummaries(this.effectiveItems()),
  );
  readonly timetablePhaseSummaries = computed(() =>
    this.computeTimetablePhaseSummaries(this.effectiveItems()),
  );
  readonly ttrPhaseSummaries = computed(() =>
    this.computeTtrPhaseSummaries(this.effectiveItems()),
  );
  readonly variantSummaries = computed(() =>
    this.computeVariantSummaries(this.effectiveItems()),
  );
  readonly timetableYearSummaries = computed(() =>
    this.computeTimetableYearSummaries(this.effectiveItems()),
  );
  readonly internalStatusSummaries = computed(() =>
    this.computeInternalStatusSummaries(this.effectiveItems()),
  );
  readonly itemsLoading = computed(() => {
    const order = this.orderSignal();
    return order ? this.orderService.isOrderItemsLoading(order.id) : false;
  });
  readonly orderHealth = computed(() => this.computeOrderHealth());
  private readonly filters = computed(() => this.orderService.filters());
  private readonly filtersActive = computed(() =>
    this.orderService.hasActiveFilters(this.filters()),
  );
  readonly effectiveItems = computed(() => this.resolveItems());
  readonly selectionMode = signal(false);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly selectedCount = computed(() => this.selectedIds().size);
  public readonly orderProcessStatusLabels = ORDER_PROCESS_STATUS_LABELS;

  constructor(
    private readonly dialog: MatDialog,
    private readonly businessService: BusinessService,
    private readonly orderService: OrderService,
    private readonly customerService: CustomerService,
    private readonly timetableService: TimetableService,
    private readonly snackBar: MatSnackBar,
  ) {
    effect(() => {
      const active = this.filtersActive();
      if (active) {
        if (!this.expanded()) {
          this.expanded.set(true);
          this.autoExpandedByFilter.set(true);
        }
      } else if (this.autoExpandedByFilter()) {
        this.expanded.set(false);
        this.autoExpandedByFilter.set(false);
      }
    });

    effect(() => {
      const order = this.orderSignal();
      if (!order || !this.expanded()) {
        return;
      }
      void this.orderService.ensureOrderItemsLoaded(order.id);
    });
  }

  openPositionDialog(event: MouseEvent) {
    event.stopPropagation();
    this.dialog.open(OrderPositionDialogComponent, {
      width: '95vw',
      maxWidth: '1200px',
      data: {
        order: this.order,
      },
    });
  }

  private resolveItems(): OrderItem[] {
    const order = this.orderSignal();
    if (!order) {
      return [];
    }
    const provided = this.itemsSignal();
    return provided ?? this.orderService.filterItemsForOrder(order);
  }

  toggleSelectionMode(event: MouseEvent) {
    event.stopPropagation();
    if (this.selectionMode()) {
      this.clearSelection();
      return;
    }
    this.selectionMode.set(true);
  }

  toggleExpanded(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    if (!next) {
      this.autoExpandedByFilter.set(false);
    }
  }

  clearSelection(event?: MouseEvent) {
    event?.stopPropagation();
    this.selectedIds.set(new Set());
    this.selectionMode.set(false);
    this.notifySelectionUpdate();
  }

  selectAllVisible(event?: MouseEvent) {
    event?.stopPropagation();
    const allIds = this.effectiveItems().map((item) => item.id);
    this.selectedIds.set(new Set(allIds));
    this.notifySelectionUpdate();
  }

  openLinkBusinessDialog(event: MouseEvent): void {
    event.stopPropagation();
    const data: OrderLinkBusinessDialogData = {
      order: this.order,
      items: this.effectiveItems(),
    };
    this.dialog.open(OrderLinkBusinessDialogComponent, {
      data,
      width: '720px',
      maxWidth: '95vw',
    });
  }

  openStatusUpdateDialog(event: MouseEvent): void {
    event.stopPropagation();
    const data: OrderStatusUpdateDialogData = {
      order: this.order,
      items: this.effectiveItems(),
    };
    this.dialog.open(OrderStatusUpdateDialogComponent, {
      data,
      width: '640px',
      maxWidth: '95vw',
    });
  }

  onBulkSelectionChange(change: { id: string; selected: boolean }) {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (change.selected) {
        next.add(change.id);
      } else {
        next.delete(change.id);
      }
      return next;
    });
    this.notifySelectionUpdate();
  }

  private notifySelectionUpdate(): void {
    const ids = Array.from(this.selectedIds());
    this.collaboration.sendSelection({
      entityType: 'orderItem',
      entityIds: ids,
      primaryId: ids[0] ?? null,
      mode: 'select',
    });
  }

  submitSelected(event?: MouseEvent) {
    event?.stopPropagation();
    const ids = Array.from(this.selectedIds());
    if (!ids.length) {
      this.snackBar.open('Keine Auftragsposition ausgewählt.', 'OK', {
        duration: 2500,
      });
      return;
    }
    this.orderService.submitOrderItems(this.order.id, ids);
    this.snackBar.open(`${ids.length} Auftragsposition(en) bestellt.`, 'OK', {
      duration: 3000,
    });
    this.clearSelection();
  }

  bulkCopyToSimulation(event?: MouseEvent): void {
    event?.stopPropagation();
    const candidates = this.selectedProductiveItems();
    if (!candidates.length) {
      this.snackBar.open('Keine produktiven Positionen für eine Simulation ausgewählt.', 'OK', {
        duration: 2500,
      });
      return;
    }
    const dialogRef = this.dialog.open<
      SimulationAssignDialogComponent,
      { timetableYearLabel: string; selectedId?: string | null; allowProductive?: boolean },
      SimulationAssignDialogResult | undefined
    >(SimulationAssignDialogComponent, {
      width: '520px',
      data: {
        timetableYearLabel: this.order.timetableYearLabel ?? '',
        selectedId: null,
        allowProductive: false,
      },
    });
    dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) {
        return;
      }
      let created = 0;
      for (const item of candidates) {
        try {
          const variant = await this.orderService.createSimulationVariant(
            this.order.id,
            item.id,
            result.simulationLabel,
          );
          if (variant) {
            created += 1;
          }
        } catch (error) {
          console.error(error);
        }
      }
      this.snackBar.open(
        `${created} Position(en) in die Simulation „${result.simulationLabel}“ kopiert.`,
        'OK',
        { duration: 3200 },
      );
    });
  }

  async bulkMergeSimulations(event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    const sims = this.selectedSimulationItems();
    if (!sims.length) {
      this.snackBar.open('Keine Simulations-Varianten zum Mergen ausgewählt.', 'OK', {
        duration: 2500,
      });
      return;
    }
    let updated = 0;
    let created = 0;
    let modifications = 0;
    for (const sim of sims) {
      try {
        const result = await this.orderService.mergeSimulationIntoProductive(this.order.id, sim.id);
        if (result.type === 'updated') {
          updated += 1;
        } else if (result.type === 'created') {
          created += 1;
        } else {
          modifications += 1;
        }
      } catch (error) {
        console.error(error);
      }
    }
    this.snackBar.open(
      `Abgleich abgeschlossen: ${updated} aktualisiert, ${created} neu, ${modifications} als Modifikation.`,
      'OK',
      { duration: 3600 },
    );
  }

  hasSimulationSelection(): boolean {
    return this.selectedSimulationItems().length > 0;
  }

  hasProductiveSelection(): boolean {
    return this.selectedProductiveItems().length > 0;
  }

  submitSingle(itemId: string) {
    this.orderService.submitOrderItems(this.order.id, [itemId]);
    this.snackBar.open('Auftragsposition bestellt.', 'OK', { duration: 2000 });
  }

  advanceProcessStatus(event: MouseEvent): void {
    event.stopPropagation();
    const current = this.order.processStatus ?? 'auftrag';
    const next = this.nextProcessStatus(current);
    if (!next || next === current) {
      this.snackBar.open('Der Auftrag befindet sich bereits im letzten Prozessschritt.', 'OK', {
        duration: 2500,
      });
      return;
    }

    if (next === 'produktion') {
      const missing = this.orderService.getItemsMissingBookedStatus(this.order.id);
      if (missing.length) {
        const names = missing
          .slice(0, 5)
          .map((item) => `• ${item.name}`)
          .join('\n');
        const more = missing.length > 5 ? `\n… und ${missing.length - 5} weitere.` : '';
        const data: ConfirmDialogData = {
          title: 'Auftrag in Produktion übergeben?',
          message:
            `Es sind noch ${missing.length} Fahrplan-Position(en) nicht im TTT-Status „Booked“.\n` +
            `Möchten Sie den Auftrag trotzdem in den Prozessschritt „Produktion“ übergeben?\n\n` +
            `${names}${more}`,
          confirmLabel: 'Trotzdem übergeben',
          cancelLabel: 'Abbrechen',
        };
        this.dialog
          .open(ConfirmDialogComponent, {
            data,
            width: '520px',
            maxWidth: '95vw',
          })
          .afterClosed()
          .subscribe((confirmed) => {
            if (confirmed) {
              this.orderService.setOrderProcessStatus(this.order.id, next);
              this.snackBar.open('Prozessstatus auf „Produktion“ gesetzt.', 'OK', {
                duration: 2500,
              });
            }
          });
        return;
      }
    }

    this.orderService.setOrderProcessStatus(this.order.id, next);
    this.snackBar.open(
      `Prozessstatus auf „${this.orderProcessStatusLabels[next]}“ gesetzt.`,
      'OK',
      { duration: 2500 },
    );
  }

  private nextProcessStatus(current: OrderProcessStatus): OrderProcessStatus | null {
    switch (current) {
      case 'auftrag':
        return 'planung';
      case 'planung':
        return 'produkt_leistung';
      case 'produkt_leistung':
        return 'produktion';
      case 'produktion':
        return 'abrechnung_nachbereitung';
      case 'abrechnung_nachbereitung':
      default:
        return null;
    }
  }

  private selectedItems(): OrderItem[] {
    const ids = this.selectedIds();
    if (!ids.size) {
      return [];
    }
    const set = ids;
    return this.effectiveItems().filter((item) => set.has(item.id));
  }

  private selectedProductiveItems(): OrderItem[] {
    return this.selectedItems().filter(
      (item) => (item.variantType ?? 'productive') === 'productive',
    );
  }

  private selectedSimulationItems(): OrderItem[] {
    return this.selectedItems().filter((item) => item.variantType === 'simulation');
  }

  private computeBusinessStatusSummaries(items: OrderItem[]): StatusSummary<BusinessStatus>[] {
    const ids = new Set<string>();
    items.forEach((item) =>
      (item.linkedBusinessIds ?? []).forEach((id) => ids.add(id)),
    );

    if (!ids.size) {
      return [];
    }

    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    const values = new Map<string, BusinessStatus>();

    const businesses = this.businessService.getByIds(Array.from(ids));
    businesses.forEach((business) => {
      const status = business.status;
      const className = this.statusClassName(status);
      counts.set(className, (counts.get(className) ?? 0) + 1);
      labels.set(
        className,
        BUSINESS_STATUS_LABELS[status] ?? this.fallbackStatusLabel(status),
      );
      values.set(className, status);
    });

    return this.sortSummaries<BusinessStatus>(
      Array.from(counts.entries()).map(([className, count]) => ({
        key: className,
        label:
          labels.get(className) ??
          this.fallbackStatusLabel(this.stripStatusPrefix(className)),
        count,
        value: values.get(className) ?? (this.stripStatusPrefix(className) as BusinessStatus),
      })),
    );
  }

  private computeTimetablePhaseSummaries(items: OrderItem[]): StatusSummary<TimetablePhase>[] {
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    const values = new Map<string, TimetablePhase>();

    items.forEach((item) => {
      const phase = this.resolveTimetablePhase(item);
      if (!phase) {
        return;
      }
      const key = this.statusClassName(phase);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      labels.set(key, TIMETABLE_PHASE_LABELS[phase] ?? phase);
      values.set(key, phase);
    });

    return this.sortSummaries<TimetablePhase>(
      Array.from(counts.entries()).map(([key, count]) => ({
        key,
        label: labels.get(key) ?? this.fallbackStatusLabel(this.stripStatusPrefix(key)),
        count,
        value: values.get(key) ?? (this.stripStatusPrefix(key) as TimetablePhase),
      })),
    );
  }

  private computeTtrPhaseSummaries(items: OrderItem[]): StatusSummary<OrderTtrPhase>[] {
    const counts = new Map<OrderTtrPhase, number>();
    items.forEach((item) => {
      const phase = this.orderService.getTtrPhaseForItem(item);
      counts.set(phase, (counts.get(phase) ?? 0) + 1);
    });

    return Array.from(counts.entries())
      .filter(([phase]) => phase !== 'unknown')
      .map(([phase, count]) => {
        const meta = this.orderService.getTtrPhaseMeta(phase);
        const key = this.statusClassName(`ttr-${phase}`);
        return {
          key,
          label: meta.label,
          count,
          value: phase,
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));
  }

  private computeVariantSummaries(items: OrderItem[]): StatusSummary<'productive' | 'simulation'>[] {
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    const values = new Map<string, 'productive' | 'simulation'>();
    items.forEach((item) => {
      const type = item.variantType ?? 'productive';
      if (type === 'simulation') {
        const label = item.simulationLabel ?? item.variantLabel ?? 'Simulation';
        const key = `sim-${label}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        labels.set(key, label);
        values.set(key, 'simulation');
      } else {
        const key = 'productive';
        counts.set(key, (counts.get(key) ?? 0) + 1);
        labels.set(key, 'Produktiv');
        values.set(key, 'productive');
      }
    });

    return this.sortSummaries<'productive' | 'simulation'>(
      Array.from(counts.entries()).map(([key, count]) => ({
        key,
        label: labels.get(key) ?? key,
        count,
        value: values.get(key) ?? 'productive',
      })),
    );
  }

  private computeInternalStatusSummaries(items: OrderItem[]): StatusSummary<InternalProcessingStatus>[] {
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    const values = new Map<string, InternalProcessingStatus>();
    items.forEach((item) => {
      if (!item.internalStatus) {
        return;
      }
      const key = this.statusClassName(item.internalStatus);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const label =
        INTERNAL_STATUS_LABELS[item.internalStatus] ??
        this.fallbackStatusLabel(item.internalStatus);
      labels.set(key, label);
      values.set(key, item.internalStatus);
    });

    return this.sortSummaries<InternalProcessingStatus>(
      Array.from(counts.entries()).map(([key, count]) => ({
        key,
        label: labels.get(key) ?? this.stripStatusPrefix(key),
        count,
        value: values.get(key) ?? (this.stripStatusPrefix(key) as InternalProcessingStatus),
      })),
    );
  }

  isVariantActive(type: 'all' | 'productive' | 'simulation'): boolean {
    const current = this.filters().variantType ?? 'all';
    return current === type;
  }

  clearVariantFilter(event?: MouseEvent): void {
    event?.stopPropagation();
    this.orderService.setFilter({ variantType: 'all' });
    this.autoExpandedByFilter.set(true);
  }

  toggleVariantFilter(type: 'productive' | 'simulation', event?: MouseEvent): void {
    event?.stopPropagation();
    const current = this.filters().variantType ?? 'all';
    const next = current === type ? 'all' : type;
    this.orderService.setFilter({ variantType: next });
    this.autoExpandedByFilter.set(true);
  }

  private fallbackStatusLabel(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
  }

  private normalizeStatusValue(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  private resolveTimetablePhase(item: OrderItem): TimetablePhase | undefined {
    if (item.generatedTimetableRefId) {
      const timetable = this.timetableService.getByRefTrainId(item.generatedTimetableRefId);
      if (timetable?.status) {
        return timetable.status;
      }
    }
    return item.timetablePhase ?? undefined;
  }

  private statusClassName(value: string): string {
    return `status-${this.normalizeStatusValue(value)}`;
  }

  ttrPhaseChipClasses(value: string): string {
    return `ttr-phase-${this.normalizeStatusValue(value)}`;
  }

  ttrPhaseTooltip(value: string): string {
    const meta = this.orderService.getTtrPhaseMeta(value as OrderTtrPhase);
    const referenceLabel =
      meta.reference === 'fpDay'
        ? 'Fahrplantag'
        : meta.reference === 'operationalDay'
          ? 'Produktionstag'
          : 'Plan-/Produktionsbezug';
    return `${meta.window} · ${meta.hint} (${referenceLabel})`;
  }

  private sortSummaries<T>(summaries: StatusSummary<T>[]): StatusSummary<T>[] {
    return summaries.sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
    });
  }

  private stripStatusPrefix(value: string): string {
    return value.startsWith('status-') ? value.slice('status-'.length) : value;
  }

  isPhaseActive(status: string): boolean {
    return this.filters().trainStatus === status;
  }

  isBusinessStatusActive(status: string): boolean {
    return this.filters().businessStatus === status;
  }

  isInternalStatusActive(status: string): boolean {
    return this.filters().internalStatus === status;
  }

  togglePhaseFilter(status: string, event: MouseEvent) {
    event.stopPropagation();
    const current = this.filters().trainStatus;
    const next = current === status ? 'all' : (status as TimetablePhase | 'all');
    this.orderService.setFilter({ trainStatus: next });
  }

  toggleBusinessStatus(status: string, event: MouseEvent) {
    event.stopPropagation();
    const current = this.filters().businessStatus;
    const next = current === status ? 'all' : (status as BusinessStatus);
    this.orderService.setFilter({ businessStatus: next });
  }

  private computeTimetableYearSummaries(items: OrderItem[]): { label: string; count: number }[] {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      const label = this.orderService.getItemTimetableYear(item);
      if (!label) {
        return;
      }
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'de', { sensitivity: 'base' }))
      .map(([label, count]) => ({ label, count }));
  }

  clearBusinessStatus(event: MouseEvent) {
    event.stopPropagation();
    this.orderService.setFilter({ businessStatus: 'all' });
  }

  clearInternalStatus(event: MouseEvent) {
    event.stopPropagation();
    this.orderService.setFilter({ internalStatus: 'all' });
  }

  toggleInternalStatus(status: string, event: MouseEvent) {
    event.stopPropagation();
    const current = this.filters().internalStatus;
    const next = current === status ? 'all' : (status as InternalProcessingStatus);
    this.orderService.setFilter({ internalStatus: next });
  }

  clearPhaseFilter(event: MouseEvent) {
    event.stopPropagation();
    this.orderService.setFilter({ trainStatus: 'all' });
  }

  clearTtrPhaseFilter(event: MouseEvent) {
    event.stopPropagation();
    this.orderService.setFilter({ ttrPhase: 'all' });
  }

  isTtrPhaseActive(phase: string): boolean {
    if (phase === 'all') {
      return this.filters().ttrPhase === 'all';
    }
    const typed = phase as OrderTtrPhase;
    if (!this.isFilterableTtrPhase(typed)) {
      return false;
    }
    return this.filters().ttrPhase === (typed as OrderTtrPhaseFilter);
  }

  toggleTtrPhaseFilter(phase: string, event: MouseEvent) {
    event.stopPropagation();
    const typed = phase as OrderTtrPhase;
    if (!this.isFilterableTtrPhase(typed)) {
      return;
    }
    const filterPhase = typed as OrderTtrPhaseFilter;
    const next = this.filters().ttrPhase === filterPhase ? 'all' : filterPhase;
    this.orderService.setFilter({ ttrPhase: next });
  }

  private isFilterableTtrPhase(phase: OrderTtrPhase): boolean {
    return FILTERABLE_TTR_PHASES.has(phase as OrderTtrPhaseFilter);
  }

  customerDetails(): Customer | undefined {
    const order = this.orderSignal();
    if (!order?.customerId) {
      return undefined;
    }
    return this.customerService.getById(order.customerId);
  }

  private computeOrderHealth(): OrderHealthSnapshot {
    const items = this.effectiveItems();
    const total = items.length;
    if (!total) {
      return {
        total: 0,
        upcoming: 0,
        attention: 0,
        active: 0,
        idle: 0,
        tone: 'ok',
        label: 'Keine Positionen',
        icon: 'task_alt',
        caption: 'Keine Positionen im aktuellen Filter sichtbar.',
        pastPercent: 0,
        upcomingPercent: 0,
        idlePercent: 100,
      };
    }

    let upcoming = 0;
    let attention = 0;
    let active = 0;
    const now = new Date();

    items.forEach((item) => {
      if (item.deviation) {
        attention += 1;
      }
      const start = this.tryParseDate(item.start);
      if (!start) {
        return;
      }
      if (start <= now) {
        active += 1;
      } else {
        upcoming += 1;
      }
    });

    const idle = Math.max(total - active - upcoming, 0);
    const attentionRatio = attention / total;
    let tone: OrderHealthSnapshot['tone'];
    let label: string;
    let icon: string;

    if (attentionRatio >= 0.3) {
      tone = 'critical';
      label = 'Kritisch';
      icon = 'priority_high';
    } else if (attentionRatio >= 0.12) {
      tone = 'warn';
      label = 'Beobachten';
      icon = 'warning';
    } else {
      tone = 'ok';
      label = upcoming ? 'Planmäßig' : 'Stabil';
      icon = 'task_alt';
    }

    const pastPercent = Math.round((active / total) * 100);
    const upcomingPercent = Math.round((upcoming / total) * 100);
    const idlePercent = Math.max(0, 100 - pastPercent - upcomingPercent);

    return {
      total,
      upcoming,
      attention,
      active,
      idle,
      tone,
      label,
      icon,
      caption: `${attention} Abweichung${attention !== 1 ? 'en' : ''} · ${upcoming} demnächst`,
      pastPercent,
      upcomingPercent,
      idlePercent,
    };
  }

  private tryParseDate(value?: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
