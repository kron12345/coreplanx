import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  TrainPlanService,
  TrainPlanSort,
} from '../../core/services/train-plan.service';
import {
  TrainPlan,
  TrainPlanSourceType,
  TrainPlanStatus,
} from '../../core/models/train-plan.model';
import {
  TimetableRollingStock,
  TimetableRollingStockSegment,
  TimetableRollingStockSegmentRole,
  TimetableRollingStockOperation,
} from '../../core/models/timetable.model';
import {
  OrderItemOption,
  OrderService,
} from '../../core/services/order.service';
import { ActivatedRoute, Router } from '@angular/router';

interface SortOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-train-plan-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './train-plan-list.component.html',
  styleUrl: './train-plan-list.component.scss',
})
export class TrainPlanListComponent {
  private readonly plansService = inject(TrainPlanService);
  private readonly orderService = inject(OrderService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  readonly searchControl = new FormControl('', { nonNullable: true });

  readonly filters = computed(() => this.plansService.filters());
  readonly sort = computed(() => this.plansService.sort());
  readonly plans = computed(() => this.plansService.filteredPlans());
  readonly responsibleRus = computed(() => this.plansService.responsibleRus());
  readonly orderItemOptions = computed<OrderItemOption[]>(() =>
    this.orderService.orderItemOptions(),
  );
  private readonly highlightPlanId = signal<string | null>(null);

  readonly statusLabels: Record<TrainPlanStatus, string> = {
    not_ordered: 'Nicht bestellt',
    requested: 'Angefragt',
    offered: 'Im Angebot',
    confirmed: 'Bestätigt',
    operating: 'Unterwegs',
    canceled: 'Storniert',
    modification_request: 'Modifikation bestellen',
  };

  readonly sourceLabels: Record<TrainPlanSourceType, string> = {
    rollout: 'Rollout',
    ttt: 'TTT',
    external: 'Externe Quelle',
  };

  readonly statusOptions: { value: TrainPlanStatus | 'all'; label: string }[] =
    [
      { value: 'all', label: 'Alle Status' },
      { value: 'not_ordered', label: 'Nicht bestellt' },
      { value: 'requested', label: 'Angefragt' },
      { value: 'offered', label: 'Im Angebot' },
      { value: 'confirmed', label: 'Bestätigt' },
      { value: 'operating', label: 'Unterwegs' },
      { value: 'canceled', label: 'Storniert' },
      { value: 'modification_request', label: 'Modifikation bestellen' },
    ];

  readonly sourceOptions: {
    value: TrainPlanSourceType | 'all';
    label: string;
  }[] = [
    { value: 'all', label: 'Alle Quellen' },
    { value: 'rollout', label: 'Rollout' },
    { value: 'ttt', label: 'TTT Path Request' },
    { value: 'external', label: 'Externe Systeme' },
  ];

  readonly sortOptions: SortOption[] = [
    { value: 'updatedAt:desc', label: 'Zuletzt aktualisiert' },
    { value: 'trainNumber:asc', label: 'Zugnummer (aufsteigend)' },
    { value: 'status:asc', label: 'Status' },
    { value: 'title:asc', label: 'Titel' },
  ];

  private readonly segmentRoleLabels: Record<TimetableRollingStockSegmentRole, string> = {
    leading: 'Führend',
    intermediate: 'Zwischenteil',
    trailing: 'Schiebend',
    powercar: 'Triebkopf',
  };

  private readonly rollingStockOperationLabels: Record<
    TimetableRollingStockOperation['type'],
    string
  > = {
    split: 'Flügeln',
    join: 'Vereinigen',
    reconfigure: 'Rekonfiguration',
  };

  private readonly rollingStockOperationIcons: Record<
    TimetableRollingStockOperation['type'],
    string
  > = {
    split: 'call_split',
    join: 'call_merge',
    reconfigure: 'settings',
  };

  constructor() {
    this.searchControl.setValue(this.filters().search, { emitEvent: false });

    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.plansService.setFilters({ search: value }));

    effect(() => {
      const current = this.filters().search;
      if (this.searchControl.value !== current) {
        this.searchControl.setValue(current, { emitEvent: false });
      }
    });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        const highlight = params.get('highlightPlan');
        this.highlightPlanId.set(highlight);
        window.setTimeout(() => this.scrollToHighlightedPlan(), 0);
      });

    effect(() => {
      this.plans();
      window.setTimeout(() => this.scrollToHighlightedPlan(), 0);
    });
  }

  onStatusFilterChange(value: TrainPlanStatus | 'all') {
    this.plansService.setFilters({ status: value });
  }

  onSourceFilterChange(value: TrainPlanSourceType | 'all') {
    this.plansService.setFilters({ source: value });
  }

  onRuFilterChange(value: string | 'all') {
    this.plansService.setFilters({ responsibleRu: value });
  }

  onSortChange(value: string) {
    const [field, direction] = value.split(':') as [
      TrainPlanSort['field'],
      TrainPlanSort['direction'],
    ];
    this.plansService.setSort({ field, direction });
  }

  sortSelection(sort: TrainPlanSort): string {
    return `${sort.field}:${sort.direction}`;
  }

  calendarLabel(plan: TrainPlan): string {
    const toPart = plan.calendar.validTo
      ? ` – ${plan.calendar.validTo}`
      : ' – offen';
    return `${plan.calendar.validFrom}${toPart}`;
  }

  planElementId(id: string): string {
    return `plan-${id}`;
  }

  linkedOrderLabel(plan: TrainPlan): string | undefined {
    if (!plan.linkedOrderItemId) {
      return undefined;
    }
    const option = this.orderItemOptions().find(
      (item) => item.itemId === plan.linkedOrderItemId,
    );
    if (!option) {
      return plan.linkedOrderItemId;
    }
    return `${option.orderName} · ${option.itemName}`;
  }

  timelineTime(stopTime?: string, offset?: number): string | undefined {
    if (!stopTime) {
      return undefined;
    }
    return offset && offset !== 0 ? `${stopTime} (+${offset}T)` : stopTime;
  }

  statusClass(plan: TrainPlan): string {
    return `status-${plan.status.replace(/_/g, '-')}`;
  }

  stopTypeLabel(type: TrainPlan['stops'][number]['type']): string {
    switch (type) {
      case 'origin':
        return 'Start';
      case 'destination':
        return 'Ziel';
      default:
        return 'Halt';
    }
  }

  trackByPlanId(_: number, plan: TrainPlan) {
    return plan.id;
  }

  trackByStopId(_: number, stop: TrainPlan['stops'][number]) {
    return stop.id;
  }

  trackByRollingStockSegment(
    _: number,
    segment: TimetableRollingStockSegment,
  ) {
    return `${segment.position}-${segment.vehicleTypeId}`;
  }

  trackByRollingStockOperation(
    _: number,
    operation: TimetableRollingStockOperation,
  ) {
    return `${operation.stopId}-${operation.type}-${operation.setIds?.join('-') ?? ''}`;
  }

  rollingStockSummary(rolling: TimetableRollingStock): string {
    const total =
      rolling.segments?.reduce((sum, segment) => sum + (segment.count ?? 0), 0) ?? 0;
    const totalLabel =
      total > 0 ? `${total} ${total === 1 ? 'Einheit' : 'Einheiten'}` : 'Komposition';
    const types = Array.from(new Set(rolling.segments?.map((segment) => segment.vehicleTypeId) ?? []));
    const typeLabel = types.length ? types.join(', ') : 'ohne Typangabe';
    return `${totalLabel} · ${typeLabel}`;
  }

  rollingStockSegmentLabel(segment: TimetableRollingStockSegment): string {
    const parts = [`${segment.count ?? 1} × ${segment.vehicleTypeId}`];
    if (segment.setLabel) {
      parts.push(segment.setLabel);
    } else if (segment.setId) {
      parts.push(segment.setId);
    }
    return parts.join(' · ');
  }

  rollingStockSegmentMeta(segment: TimetableRollingStockSegment): string | null {
    const parts: string[] = [];
    const roleLabel = this.segmentRoleLabel(segment.role);
    if (roleLabel) {
      parts.push(roleLabel);
    }
    if (segment.destination) {
      parts.push(segment.destination);
    }
    return parts.length ? parts.join(' · ') : null;
  }

  private segmentRoleLabel(role?: TimetableRollingStockSegmentRole | null): string {
    if (!role) {
      return '';
    }
    return this.segmentRoleLabels[role] ?? role;
  }

  rollingStockOperationSummary(
    plan: TrainPlan,
    operation: TimetableRollingStockOperation,
  ): string {
    const stopLabel = this.planStopName(plan, operation.stopId);
    const sets = operation.setIds?.length ? operation.setIds.join(', ') : undefined;
    const base = `${this.rollingStockOperationLabel(operation.type)} @ ${stopLabel}`;
    const setLabel = sets ? ` · ${sets}` : '';
    const remarks = operation.remarks ? ` – ${operation.remarks}` : '';
    return `${base}${setLabel}${remarks}`;
  }

  rollingStockOperationLabel(type: TimetableRollingStockOperation['type']): string {
    return this.rollingStockOperationLabels[type] ?? type;
  }

  rollingStockOperationIcon(type: TimetableRollingStockOperation['type']): string {
    return this.rollingStockOperationIcons[type] ?? 'train';
  }

  formatList(values: string[] | undefined | null): string {
    if (!values?.length) {
      return '—';
    }
    return values.join(', ');
  }

  private planStopName(plan: TrainPlan, stopId: string): string {
    const match = plan.stops.find((stop) => stop.id === stopId);
    if (!match) {
      return stopId;
    }
    return `${match.locationName} (#${match.sequence})`;
  }

  private scrollToHighlightedPlan() {
    const highlight = this.highlightPlanId();
    if (!highlight) {
      return;
    }
    const element = this.document.getElementById(this.planElementId(highlight));
    if (!element) {
      return;
    }
    this.highlightPlanId.set(null);
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.add('plan-card--highlight');
    window.setTimeout(() => {
      element.classList.remove('plan-card--highlight');
    }, 2000);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { highlightPlan: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
