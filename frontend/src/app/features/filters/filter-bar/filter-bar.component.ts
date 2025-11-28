import { Component, EventEmitter, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDatepickerInputEvent } from '@angular/material/datepicker';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import {
  OrderService,
  OrderFilters,
  OrderTtrPhaseFilter,
} from '../../../core/services/order.service';
import { BusinessStatus } from '../../../core/models/business.model';
import { TimetablePhase } from '../../../core/models/timetable.model';
import { BusinessService } from '../../../core/services/business.service';

@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [FormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './filter-bar.component.html',
  styleUrl: './filter-bar.component.scss',
})
export class FilterBarComponent {
  @Output() savePreset = new EventEmitter<void>();
  search = signal('');
  trainNumber = signal('');
  timetableYear = signal<'all' | string>('all');
  fpRangeStart = signal<string | null>(null);
  fpRangeEnd = signal<string | null>(null);
  timelineReference = signal<OrderFilters['timelineReference']>('fpDay');
  ttrPhase = signal<OrderTtrPhaseFilter>('all');

  readonly timeOptions: { value: OrderFilters['timeRange']; label: string }[] = [
    { value: 'all', label: 'Alle Zeiten' },
    { value: 'next4h', label: 'Nächste 4 Stunden' },
    { value: 'next12h', label: 'Nächste 12 Stunden' },
    { value: 'today', label: 'Heute' },
    { value: 'thisWeek', label: 'Diese Woche' },
  ];

  readonly trainStatusOptions: { value: TimetablePhase | 'all'; label: string }[] = [
    { value: 'all', label: 'All phases' },
    { value: 'bedarf', label: 'Draft' },
    { value: 'path_request', label: 'Path Request' },
    { value: 'offer', label: 'Offered' },
    { value: 'contract', label: 'Booked' },
    { value: 'operational', label: 'Used' },
    { value: 'archived', label: 'Cancelled' },
  ];

  readonly businessStatusOptions: { value: BusinessStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'Alle Geschäfte' },
    { value: 'neu', label: 'Neu' },
    { value: 'in_arbeit', label: 'In Arbeit' },
    { value: 'pausiert', label: 'Pausiert' },
    { value: 'erledigt', label: 'Erledigt' },
  ];

  readonly timelineReferenceOptions: {
    value: OrderFilters['timelineReference'];
    label: string;
    caption: string;
  }[] = [
    { value: 'fpDay', label: 'Fahrplantag', caption: 'Planungslogik (TTR-Standard)' },
    { value: 'fpYear', label: 'Fahrplanjahr', caption: 'Jahresfristen / Kapazität' },
    { value: 'operationalDay', label: 'Produktionstag', caption: 'Echtzeit / Ad-hoc' },
  ];

  readonly ttrPhaseOptions: { value: OrderTtrPhaseFilter; label: string; window: string }[] = [
    { value: 'all', label: 'Alle TTR-Phasen', window: 'ohne Einschränkung' },
    { value: 'annual_request', label: 'Annual TT Request', window: '12–7 Monate' },
    { value: 'final_offer', label: 'Final Offer (ENFP)', window: '7–4 Monate' },
    { value: 'rolling_planning', label: 'Rolling Planning', window: '13–3 Wochen' },
    { value: 'short_term', label: 'Short-Term', window: '30–7 Tage' },
    { value: 'ad_hoc', label: 'Ad-hoc / Störung', window: '0–7 Tage (Produktion)' },
    { value: 'operational_delivery', label: 'Operative Begleitung', window: 'laufender Betrieb' },
  ];
  readonly activeTimelineReference = computed(
    () =>
      this.timelineReferenceOptions.find((option) => option.value === this.timelineReference()) ??
      this.timelineReferenceOptions[0],
  );

  readonly activeBusinessFilter = computed(() => {
    const id = this.store.filters().linkedBusinessId;
    if (!id) {
      return null;
    }
    const business = this.businessService.getByIds([id])[0];
    return business ?? { id, title: id };
  });

  constructor(public store: OrderService, private readonly businessService: BusinessService) {
    const filters = this.store.filters();
    this.search.set(filters.search);
    this.trainNumber.set(filters.trainNumber);
    this.timetableYear.set(filters.timetableYearLabel);
    this.fpRangeStart.set(filters.fpRangeStart);
    this.fpRangeEnd.set(filters.fpRangeEnd);
    this.timelineReference.set(filters.timelineReference);
    this.ttrPhase.set(filters.ttrPhase);
  }

  onSearchChange(value: string) {
    this.search.set(value ?? '');
    this.store.setFilter({ search: this.search() });
  }

  onReset() {
    this.search.set('');
    this.trainNumber.set('');
    this.timetableYear.set('all');
    this.fpRangeStart.set(null);
    this.fpRangeEnd.set(null);
    this.timelineReference.set('fpDay');
    this.ttrPhase.set('all');
    this.store.setFilter({
      search: '',
      tag: 'all',
      timeRange: 'all',
      trainStatus: 'all',
      businessStatus: 'all',
      internalStatus: 'all',
      trainNumber: '',
      timetableYearLabel: 'all',
      linkedBusinessId: null,
      fpRangeStart: null,
      fpRangeEnd: null,
      timelineReference: 'fpDay',
      ttrPhase: 'all',
    });
  }

  onSavePreset() {
    this.savePreset.emit();
  }

  onTimeRangeChange(value: OrderFilters['timeRange']) {
    this.store.setFilter({ timeRange: value });
  }

  onTrainStatusChange(value: TimetablePhase | 'all') {
    this.store.setFilter({ trainStatus: value });
  }

  onBusinessStatusChange(value: BusinessStatus | 'all') {
    this.store.setFilter({ businessStatus: value });
  }

  onTrainNumberChange(value: string) {
    this.trainNumber.set(value ?? '');
    this.store.setFilter({ trainNumber: value ?? '' });
  }

  onTimetableYearChange(value: string) {
    this.timetableYear.set(value as string);
    this.store.setFilter({ timetableYearLabel: value as string });
  }

  onTimelineReferenceChange(value: OrderFilters['timelineReference']) {
    this.timelineReference.set(value);
    this.store.setFilter({ timelineReference: value });
  }

  onTtrPhaseChange(value: OrderTtrPhaseFilter) {
    this.ttrPhase.set(value);
    this.store.setFilter({ ttrPhase: value });
  }

  onFpRangeStartChange(event: MatDatepickerInputEvent<Date>) {
    this.fpRangeStart.set(this.formatDate(event.value));
    this.applyFpRange();
  }

  onFpRangeEndChange(event: MatDatepickerInputEvent<Date>) {
    this.fpRangeEnd.set(this.formatDate(event.value));
    this.applyFpRange();
  }

  clearFpRange() {
    this.fpRangeStart.set(null);
    this.fpRangeEnd.set(null);
    this.applyFpRange();
  }

  fpRangeStartDate(): Date | null {
    return this.parseDate(this.fpRangeStart());
  }

  fpRangeEndDate(): Date | null {
    return this.parseDate(this.fpRangeEnd());
  }

  private applyFpRange() {
    this.store.setFilter({
      fpRangeStart: this.fpRangeStart(),
      fpRangeEnd: this.fpRangeEnd(),
    });
  }

  private formatDate(value: Date | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDate(value: string | null): Date | null {
    if (!value) {
      return null;
    }
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  clearBusinessFilter() {
    this.store.clearLinkedBusinessFilter();
  }
}
