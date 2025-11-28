import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import {
  OrderItem,
  OrderItemTimetableSnapshotModification,
  OrderItemTimetableSnapshotVariant,
  InternalProcessingStatus,
} from '../../../core/models/order-item.model';
import {
  Business,
  BusinessStatus,
} from '../../../core/models/business.model';
import { BusinessService } from '../../../core/services/business.service';
import { TrafficPeriodService } from '../../../core/services/traffic-period.service';
import { ScheduleTemplateService } from '../../../core/services/schedule-template.service';
import { TrainPlanService } from '../../../core/services/train-plan.service';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { OrderItemEditDialogComponent } from '../order-item-edit-dialog/order-item-edit-dialog.component';
import { TimetablePhase } from '../../../core/models/timetable.model';
import { TimetableService } from '../../../core/services/timetable.service';
import { OrderService } from '../../../core/services/order.service';

@Component({
  selector: 'app-order-item-list',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  providers: [DatePipe],
  templateUrl: './order-item-list.component.html',
  styleUrl: './order-item-list.component.scss',
})
export class OrderItemListComponent {
  @Input({ required: true }) items!: OrderItem[];
  @Input({ required: true }) orderId!: string;
  @Input() bulkSelectionEnabled = false;
  @Input() selectedIds: ReadonlySet<string> | null = null;
  @Input() highlightItemId: string | null = null;
  @Output() bulkSelectionChange = new EventEmitter<{ id: string; selected: boolean }>();
  @Output() submitRequested = new EventEmitter<string>();

  get orderedItems(): OrderItem[] {
    if (!this.items) {
      return [];
    }
    return [...this.items].sort((a, b) => {
      const aPath = a.versionPath;
      const bPath = b.versionPath;
      if (!aPath?.length && !bPath?.length) {
        return this.items.indexOf(a) - this.items.indexOf(b);
      }
      if (!aPath?.length) {
        return 1;
      }
      if (!bPath?.length) {
        return -1;
      }
      const minLength = Math.min(aPath.length, bPath.length);
      for (let i = 0; i < minLength; i++) {
        const aValue = aPath[i];
        const bValue = bPath[i];
        if (aValue !== bValue) {
          return aValue - bValue;
        }
      }
      if (aPath.length !== bPath.length) {
        return aPath.length - bPath.length;
      }
      return this.items.indexOf(a) - this.items.indexOf(b);
    });
  }

  private readonly statusLabels: Record<BusinessStatus, string> = {
    neu: 'Neu',
    pausiert: 'Pausiert',
    in_arbeit: 'In Arbeit',
    erledigt: 'Erledigt',
  };
  private readonly itemTypeLabels: Record<OrderItem['type'], string> = {
    Leistung: 'Leistung',
    Fahrplan: 'Fahrplan',
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

  constructor(
    private readonly businessService: BusinessService,
    private readonly trafficPeriodService: TrafficPeriodService,
    private readonly templateService: ScheduleTemplateService,
    private readonly trainPlanService: TrainPlanService,
    private readonly router: Router,
    private readonly dialog: MatDialog,
    private readonly timetableService: TimetableService,
    private readonly orderService: OrderService,
    private readonly datePipe: DatePipe,
  ) {}

  businessesForItem(item: OrderItem): Business[] {
    return this.businessService.getByIds(item.linkedBusinessIds ?? []);
  }

  navigateToTrainPlan(event: MouseEvent, trainPlanId: string) {
    event.stopPropagation();
    this.router.navigate(['/plans'], {
      queryParams: { highlightPlan: trainPlanId },
    });
  }

  typeLabel(item: OrderItem): string {
    return this.itemTypeLabels[item.type] ?? item.type;
  }

  timetablePhaseLabel(item: OrderItem): string | undefined {
    const phase = this.resolveTimetablePhase(item);
    if (!phase) {
      return undefined;
    }
    return this.timetablePhaseLabels[phase] ?? phase;
  }

  timetablePhaseClass(item: OrderItem): string | undefined {
    const phase = this.resolveTimetablePhase(item);
    if (!phase) {
      return undefined;
    }
    return `phase-${phase}`;
  }

  ttrPhaseLabel(item: OrderItem): string | undefined {
    const phase = this.orderService.getTtrPhaseForItem(item);
    if (phase === 'unknown') {
      return undefined;
    }
    return this.orderService.getTtrPhaseMeta(phase).label;
  }

  ttrPhaseClass(item: OrderItem): string | undefined {
    const phase = this.orderService.getTtrPhaseForItem(item);
    if (phase === 'unknown') {
      return undefined;
    }
    return `ttr-${phase.replace(/_/g, '-')}`;
  }

  ttrPhaseTooltip(item: OrderItem): string | undefined {
    const phase = this.orderService.getTtrPhaseForItem(item);
    if (phase === 'unknown') {
      return undefined;
    }
    const meta = this.orderService.getTtrPhaseMeta(phase);
    return `${meta.window} · ${meta.hint} (${this.referenceLabel(meta.reference)})`;
  }

  internalStatusLabel(item: OrderItem): string | undefined {
    if (!item.internalStatus) {
      return undefined;
    }
    return this.internalStatusLabels[item.internalStatus] ?? item.internalStatus;
  }

  formatScheduleTime(value: string | undefined): string {
    if (!value) {
      return '—';
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      const formatted = this.datePipe.transform(parsed, 'shortTime');
      if (formatted) {
        return formatted;
      }
    }
    return /^\d{1,2}:\d{2}$/.test(value) ? value : value;
  }

  isItemSelected(item: OrderItem): boolean {
    if (!this.selectedIds) {
      return false;
    }
    return this.selectedIds.has(item.id);
  }

  toggleSelection(item: OrderItem, selected: boolean) {
    this.bulkSelectionChange.emit({ id: item.id, selected });
  }

  statusLabel(status: BusinessStatus): string {
    return this.statusLabels[status];
  }

  assignmentLabel(business: Business): string {
    return business.assignment.type === 'group'
      ? `Gruppe ${business.assignment.name}`
      : business.assignment.name;
  }

  assignmentIcon(business: Business): string {
    return business.assignment.type === 'group' ? 'groups' : 'person';
  }

  trafficPeriodName(id: string | undefined): string | undefined {
    if (!id) {
      return undefined;
    }
    return this.trafficPeriodService.getById(id)?.name;
  }

  navigateToTrafficPeriod(event: MouseEvent, periodId: string) {
    event.stopPropagation();
    this.router.navigate(['/plans'], {
      queryParams: {
        view: 'calendars',
        highlightPeriod: periodId,
      },
    });
  }

  templateName(id: string | undefined): string | undefined {
    if (!id) {
      return undefined;
    }
    return this.templateService.getById(id)?.title;
  }

  navigateToTimetable(event: MouseEvent, refTrainId: string) {
    event.stopPropagation();
    this.router.navigate(['/fahrplanmanager'], {
      queryParams: { search: refTrainId },
    });
  }

  navigateToTemplate(event: MouseEvent, templateId: string) {
    event.stopPropagation();
    this.router.navigate(['/templates'], {
      queryParams: {
        highlightTemplate: templateId,
      },
    });
  }

  trainPlanLabel(id: string | undefined): string | undefined {
    if (!id) {
      return undefined;
    }
    const plan = this.trainPlanService.getById(id);
    return plan ? `${plan.trainNumber} · ${plan.calendar.validFrom}` : undefined;
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

  hasSchedule(item: OrderItem): boolean {
    return Boolean(item.start && item.end);
  }

  originalVariants(item: OrderItem): OrderItemTimetableSnapshotVariant[] {
    return item.originalTimetable?.variants ?? [];
  }

  originalModifications(
    item: OrderItem,
  ): OrderItemTimetableSnapshotModification[] {
    return item.originalTimetable?.modifications ?? [];
  }

  variantLabel(variant: OrderItemTimetableSnapshotVariant): string {
    const number = variant.variantNumber ?? variant.id;
    const type = variant.type ? this.formatLabel(variant.type) : undefined;
    if (type) {
      return `${number} · ${type}`;
    }
    return number;
  }

  variantTooltip(variant: OrderItemTimetableSnapshotVariant): string {
    const parts: string[] = [];
    if (variant.description) {
      parts.push(variant.description);
    }
    if (variant.validFrom) {
      const range = variant.validTo
        ? `${variant.validFrom} – ${variant.validTo}`
        : variant.validFrom;
      parts.push(range);
    }
    if (variant.daysOfWeek?.length) {
      parts.push(`Tage: ${variant.daysOfWeek.join(', ')}`);
    }
    if (variant.dates?.length) {
      parts.push(`Sondertage: ${variant.dates.join(', ')}`);
    }
    if (variant.reason) {
      parts.push(variant.reason);
    }
    return parts.join(' · ');
  }

  modificationLabel(
    modification: OrderItemTimetableSnapshotModification,
  ): string {
    return modification.description ?? this.formatLabel(modification.type);
  }

  private formatLabel(value: string): string {
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
  }

  private referenceLabel(reference: 'fpDay' | 'operationalDay' | 'fpYear' | 'mixed'): string {
    switch (reference) {
      case 'fpDay':
        return 'Fahrplantag';
      case 'operationalDay':
        return 'Produktionstag';
      case 'fpYear':
        return 'Fahrplanjahr';
      default:
        return 'Plan/Produktion';
    }
  }

  originalTimetableRange(item: OrderItem): string | undefined {
    const snapshot = item.originalTimetable;
    if (!snapshot) {
      return undefined;
    }
    if (snapshot.calendar.validTo) {
      return `${snapshot.calendar.validFrom} – ${snapshot.calendar.validTo}`;
    }
    return `${snapshot.calendar.validFrom} (offen)`;
  }

  originalTimetableRoute(item: OrderItem): string | undefined {
    const stops = item.originalTimetable?.stops;
    if (!stops?.length) {
      return undefined;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    return `${first.locationName} → ${last.locationName}`;
  }

  versionLabel(item: OrderItem): string | undefined {
    if (!item.versionPath?.length) {
      return undefined;
    }
    return item.versionPath.join('.');
  }

  parentVersionLabel(item: OrderItem): string | undefined {
    if (!item.versionPath || item.versionPath.length <= 1) {
      return undefined;
    }
    return item.versionPath.slice(0, -1).join('.');
  }

  isChildVersion(item: OrderItem): boolean {
    return !!item.versionPath && item.versionPath.length > 1;
  }

  versionDepthClass(item: OrderItem): string | undefined {
    if (!item.versionPath?.length) {
      return undefined;
    }
    return `version-depth-${item.versionPath.length}`;
  }

  validitySummary(item: OrderItem): string | undefined {
    if (!item.validity?.length) {
      return undefined;
    }
    return item.validity
      .map((segment) => `${segment.startDate}–${segment.endDate}`)
      .join(', ');
  }

  openEditDialog(item: OrderItem, orderId: string) {
    this.dialog.open(OrderItemEditDialogComponent, {
      width: '95vw',
      maxWidth: '1200px',
      maxHeight: '95vh',
      data: {
        orderId,
        item,
      },
    });
  }

  onBusinessCardClick(event: MouseEvent, businessId: string): void {
    const target = event.target as HTMLElement;
    if (target.closest('a, button')) {
      return;
    }
    this.navigateToBusiness(businessId);
  }

  onBusinessCardKeydown(event: KeyboardEvent, businessId: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.navigateToBusiness(businessId);
    }
  }

  private navigateToBusiness(businessId: string): void {
    this.router.navigate(['/businesses'], { fragment: businessId });
  }
}
