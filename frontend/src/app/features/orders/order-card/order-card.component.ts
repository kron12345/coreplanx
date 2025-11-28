import { Component, Input, computed, effect, signal } from '@angular/core';
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
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-order-card',
  standalone: true,
  imports: [
    CommonModule,
    ...MATERIAL_IMPORTS,
    OrderItemListComponent,
  ],
  templateUrl: './order-card.component.html',
  styleUrl: './order-card.component.scss',
})
export class OrderCardComponent {
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
  readonly orderHealth = computed(() => this.computeOrderHealth());
  private readonly filters = computed(() => this.orderService.filters());
  private readonly filtersActive = computed(() =>
    this.orderService.hasActiveFilters(this.filters()),
  );
  readonly effectiveItems = computed(() => this.resolveItems());
  readonly selectionMode = signal(false);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly selectedCount = computed(() => this.selectedIds().size);

  private readonly businessStatusLabels: Record<BusinessStatus, string> = {
    neu: 'Neu',
    pausiert: 'Pausiert',
    in_arbeit: 'In Arbeit',
    erledigt: 'Erledigt',
  };
  private readonly timetablePhaseLabels: Record<TimetablePhase, string> = {
    bedarf: 'Draft',
    path_request: 'Path Request',
    offer: 'Offered',
    contract: 'Booked',
    operational: 'Used',
    archived: 'Cancelled',
  };
  private readonly internalStatusLabels: Partial<Record<InternalProcessingStatus, string>> = {
    in_bearbeitung: 'In Bearbeitung',
    freigegeben: 'Freigegeben',
    ueberarbeiten: 'Überarbeiten',
    uebermittelt: 'Übermittelt',
    beantragt: 'Beantragt',
    abgeschlossen: 'Abgeschlossen',
    annulliert: 'Annulliert',
  };
  public readonly orderProcessStatusLabels: Record<OrderProcessStatus, string> = {
    auftrag: 'Auftrag',
    planung: 'Planung',
    produkt_leistung: 'Produkt/Leistung',
    produktion: 'Produktion',
    abrechnung_nachbereitung: 'Abrechnung/Nachbereitung',
  };
  private readonly filterableTtrPhases = new Set<OrderTtrPhaseFilter>([
    'annual_request',
    'final_offer',
    'rolling_planning',
    'short_term',
    'ad_hoc',
    'operational_delivery',
  ]);

  constructor(
    private readonly dialog: MatDialog,
    private readonly businessService: BusinessService,
    private readonly orderService: OrderService,
    private readonly customerService: CustomerService,
    private readonly timetableService: TimetableService,
    private readonly snackBar: MatSnackBar,
  ) {
    effect(
      () => {
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
      },
      { allowSignalWrites: true },
    );
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
    const base = provided ?? this.orderService.filterItemsForOrder(order);
    const filters = this.filters();
    if (filters.businessStatus === 'all') {
      return base;
    }
    return base.filter((item) =>
      this.itemMatchesBusinessStatus(item, filters.businessStatus as BusinessStatus),
    );
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

  private computeBusinessStatusSummaries(items: OrderItem[]): StatusSummary[] {
    const ids = new Set<string>();
    items.forEach((item) =>
      (item.linkedBusinessIds ?? []).forEach((id) => ids.add(id)),
    );

    if (!ids.size) {
      return [];
    }

    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    const values = new Map<string, string>();

    const businesses = this.businessService.getByIds(Array.from(ids));
    businesses.forEach((business) => {
      const status = business.status;
      const className = this.statusClassName(status);
      counts.set(className, (counts.get(className) ?? 0) + 1);
      labels.set(
        className,
        this.businessStatusLabels[status] ?? this.fallbackStatusLabel(status),
      );
      values.set(className, status);
    });

    return this.sortSummaries(
      Array.from(counts.entries()).map(([className, count]) => ({
        key: className,
        label:
          labels.get(className) ??
          this.fallbackStatusLabel(this.stripStatusPrefix(className)),
        count,
        value: values.get(className) ?? this.stripStatusPrefix(className),
      })),
    );
  }

  private computeTimetablePhaseSummaries(items: OrderItem[]): StatusSummary[] {
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
      labels.set(key, this.timetablePhaseLabels[phase] ?? phase);
      values.set(key, phase);
    });

    return this.sortSummaries(
      Array.from(counts.entries()).map(([key, count]) => ({
        key,
        label: labels.get(key) ?? this.fallbackStatusLabel(this.stripStatusPrefix(key)),
        count,
        value: values.get(key) ?? this.stripStatusPrefix(key),
      })),
    );
  }

  private computeTtrPhaseSummaries(items: OrderItem[]): StatusSummary[] {
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

  private computeVariantSummaries(items: OrderItem[]): StatusSummary[] {
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    items.forEach((item) => {
      const variants = item.originalTimetable?.variants;
      if (!variants?.length) {
        return;
      }
      variants.forEach((variant) => {
        const number = variant.variantNumber ?? variant.id;
        const key = `variant-${number}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const label = variant.description
          ? `${number} · ${variant.description}`
          : number;
        labels.set(key, label);
      });
    });

    return this.sortSummaries(
      Array.from(counts.entries()).map(([key, count]) => ({
        key,
        label: labels.get(key) ?? key,
        count,
        value: key,
      })),
    );
  }

  private computeInternalStatusSummaries(items: OrderItem[]): StatusSummary[] {
    const counts = new Map<string, number>();
    const labels = new Map<string, string>();
    const values = new Map<string, InternalProcessingStatus>();
    items.forEach((item) => {
      if (!item.internalStatus) {
        return;
      }
      const key = this.statusClassName(item.internalStatus);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const label = this.internalStatusLabels[item.internalStatus] ?? this.fallbackStatusLabel(item.internalStatus);
      labels.set(key, label);
      values.set(key, item.internalStatus);
    });

    return this.sortSummaries(
      Array.from(counts.entries()).map(([key, count]) => ({
        key,
        label: labels.get(key) ?? this.stripStatusPrefix(key),
        count,
        value: values.get(key) ?? this.stripStatusPrefix(key),
      })),
    );
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

  private sortSummaries(summaries: StatusSummary[]): StatusSummary[] {
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

  private itemMatchesBusinessStatus(
    item: OrderItem,
    status: BusinessStatus,
  ): boolean {
    const ids = item.linkedBusinessIds ?? [];
    if (!ids.length) {
      return false;
    }
    const businesses = this.businessService.getByIds(ids);
    return businesses.some((b) => b.status === status);
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
    return this.filterableTtrPhases.has(phase as OrderTtrPhaseFilter);
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

interface StatusSummary {
  key: string;
  label: string;
  count: number;
  value: string;
}

interface OrderHealthSnapshot {
  total: number;
  upcoming: number;
  attention: number;
  active: number;
  idle: number;
  tone: 'ok' | 'warn' | 'critical';
  label: string;
  icon: string;
  caption: string;
  pastPercent: number;
  upcomingPercent: number;
  idlePercent: number;
}
