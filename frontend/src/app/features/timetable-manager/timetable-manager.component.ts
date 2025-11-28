import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  TimetableHubRecord,
  TimetableHubRouteMetadata,
  TimetableHubSection,
  TimetableHubSectionKey,
  TimetableHubService,
  TimetableHubStopSummary,
  TimetableHubTechnicalSummary,
} from '../../core/services/timetable-hub.service';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';
import { TimetableService } from '../../core/services/timetable.service';
import { MatDialog } from '@angular/material/dialog';
import {
  TimetableTestTrainDialogComponent,
  TimetableTestTrainDialogResult,
} from './timetable-test-train-dialog.component';

type DialogStopValue = TimetableTestTrainDialogResult['stops'][number];

@Component({
  selector: 'app-timetable-manager',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-manager.component.html',
  styleUrl: './timetable-manager.component.scss',
})
export class TimetableManagerComponent {
  private readonly hubService = inject(TimetableHubService);
  private readonly route = inject(ActivatedRoute);
  private readonly yearService = inject(TimetableYearService);
  private readonly dialog = inject(MatDialog);
  private readonly timetableService = inject(TimetableService);

  readonly searchControl = new FormControl('', { nonNullable: true });
  private readonly searchTerm = signal('');
  readonly selectedYearLabel = signal('');
  private readonly activeGroupKey = signal<string | null>(null);
  private readonly expandedStops = signal<Set<string>>(new Set());
  readonly selectedStop = signal<TimetableHubStopSummary | null>(null);

  readonly records = computed(() => this.hubService.records());
  readonly filteredRecords = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const selectedYear = this.selectedYearLabel().trim();
    let items = this.records();
    if (!term && selectedYear) {
      items = items.filter((record) => record.timetableYearLabel === selectedYear);
    }
    if (!term) {
      return items;
    }
    return items.filter((record) => {
      const haystack = `${record.refTrainId} ${record.trainNumber} ${record.title}`.toLowerCase();
      return haystack.includes(term);
    });
  });
  readonly activeRecord = signal<TimetableHubRecord | null>(null);
  readonly activeSection = signal<TimetableHubSectionKey>('commercial');
  private readonly collapsedGroups = signal<Set<string>>(new Set());

  readonly activeGroupRecord = computed<TimetableHubRecord | null>(() => {
    const groupKey = this.activeGroupKey();
    if (!groupKey) {
      return null;
    }
    const groups = this.groupedRecords();
    const group = groups.find((entry) => entry.headRefTrainId === groupKey);
    if (!group || !group.records.length) {
      return null;
    }
    const calendarDays = [...group.calendarDays].sort();
    const yearLabel = group.timetableYearLabel || this.yearService.defaultYearBounds().label;
    const yearBounds = this.yearService.getYearByLabel(yearLabel);
    const calendarBitmap = this.buildGroupYearBitmap(yearBounds, calendarDays);
    const calendarRangeLabel = `${yearBounds.startIso} – ${yearBounds.endIso}`;
    const base = group.records[0];
    const buildSection = (key: TimetableHubSectionKey): TimetableHubSection => {
      const stops = this.aggregateSectionStops(group.records, key);
      const labels: Record<TimetableHubSectionKey, string> = {
        commercial: 'Kommerzieller Fahrplan (Aggregat)',
        operational: 'Betrieblicher Fahrplan (Aggregat)',
        actual: 'Ist-Fahrdaten (Aggregat)',
      };
      const descriptions: Record<TimetableHubSectionKey, string> = {
        commercial:
          'Aggregierte Sicht über alle Varianten. Zeigt die kommerziellen Halte der Varianten kombiniert.',
        operational:
          'Aggregierte Sicht über alle Varianten. Enthält alle betrieblichen Halte aus den Varianten.',
        actual: 'Aggregierte Ist-Daten, sofern vorhanden.',
      };
      return {
        key,
        label: labels[key],
        description: descriptions[key],
        stops,
      };
    };
    return {
      refTrainId: group.headRefTrainId,
      trainNumber: base.trainNumber,
      title: base.title,
      timetableYearLabel: yearLabel,
      calendarDays,
      calendarBitmap,
      calendarRangeLabel,
      vehicles: base.vehicles,
      technical: base.technical,
      routeMetadata: base.routeMetadata,
      commercial: buildSection('commercial'),
      operational: buildSection('operational'),
      actual: buildSection('actual'),
    };
  });

  readonly activeDisplayRecord = computed<TimetableHubRecord | null>(() => {
    const groupRecord = this.activeGroupRecord();
    if (groupRecord) {
      return groupRecord;
    }
    return this.activeRecord();
  });

  readonly isAggregateView = computed(() => this.activeGroupRecord() !== null);

  openVariantDialog(base: TimetableHubRecord) {
    const ref = this.dialog.open(TimetableTestTrainDialogComponent, {
      width: '720px',
      data: {
        yearOptions: this.yearOptions(),
        sectionTabs: this.sectionTabs,
        defaultYearLabel:
          base.timetableYearLabel ||
          this.selectedYearLabel() ||
          this.yearService.defaultYearBounds().label,
        initialTrainNumber: base.trainNumber,
        initialTitle: base.title,
      },
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed())
      .subscribe((result?: TimetableTestTrainDialogResult) => {
        if (result) {
          this.createVariantFromDialog(base, result);
        }
      });
  }

  readonly groupedRecords = computed(() => {
    const items = this.filteredRecords();
    const groups = new Map<
      string,
      { headRefTrainId: string; records: TimetableHubRecord[]; calendarDays: Set<string> }
    >();
    items.forEach((record) => {
      const key = this.groupKey(record.refTrainId);
      let group = groups.get(key);
      if (!group) {
        group = { headRefTrainId: key, records: [], calendarDays: new Set<string>() };
        groups.set(key, group);
      }
      group.records.push(record);
      record.calendarDays.forEach((day) => group.calendarDays.add(day));
    });
    return Array.from(groups.values())
      .map((group) => ({
        headRefTrainId: group.headRefTrainId,
        records: group.records.sort((a, b) => a.refTrainId.localeCompare(b.refTrainId)),
        calendarDays: Array.from(group.calendarDays).sort(),
        timetableYearLabel: group.records[0]?.timetableYearLabel ?? '',
      }))
      .sort((a, b) => a.headRefTrainId.localeCompare(b.headRefTrainId));
  });

  readonly sectionTabs: { key: TimetableHubSectionKey; label: string }[] = [
    { key: 'commercial', label: 'Planfahrplan' },
    { key: 'actual', label: 'Ist-Fahrdaten' },
  ];
  constructor() {
    this.searchControl.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.searchTerm.set(value));

    const defaultYearLabel = this.yearService.defaultYearBounds().label;
    this.selectedYearLabel.set(defaultYearLabel);

    const initialSearch = this.route.snapshot.queryParamMap.get('search');
    if (initialSearch) {
      this.searchControl.setValue(initialSearch);
      this.searchTerm.set(initialSearch);
    }

    effect(() => {
      const list = this.filteredRecords();
      const current = this.activeRecord();
      const groupKey = this.activeGroupKey();
      if (groupKey) {
        return;
      }
      if (!list.length) {
        this.activeRecord.set(null);
        return;
      }
      if (!current || !list.some((record) => record.refTrainId === current.refTrainId)) {
        this.activeRecord.set(list[0]);
        this.activeSection.set('commercial');
      }
    });
  }

  selectRecord(record: TimetableHubRecord) {
    if (this.activeRecord()?.refTrainId === record.refTrainId) {
      return;
    }
    this.activeGroupKey.set(null);
    this.activeRecord.set(record);
    this.activeSection.set('commercial');
    this.selectedStop.set(null);
  }

  selectStop(record: TimetableHubRecord, stop: TimetableHubStopSummary) {
    const currentRecord = this.activeRecord();
    const currentStop = this.selectedStop();
    if (currentRecord?.refTrainId === record.refTrainId && currentStop?.sequence === stop.sequence) {
      this.selectedStop.set(null);
      return;
    }
    this.activeGroupKey.set(null);
    this.activeRecord.set(record);
    this.activeSection.set('commercial');
    this.selectedStop.set(stop);
  }

  selectSection(section: TimetableHubSectionKey) {
    this.activeSection.set(section);
  }

  clearSearch() {
    if (!this.searchControl.value) {
      return;
    }
    this.searchControl.setValue('');
    this.searchTerm.set('');
  }

  setSelectedYear(label: string) {
    if (!label || this.selectedYearLabel() === label) {
      return;
    }
    this.selectedYearLabel.set(label);
  }

  isGroupExpanded(key: string): boolean {
    return this.collapsedGroups().has(key);
  }

  toggleGroup(key: string) {
    const current = new Set(this.collapsedGroups());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.collapsedGroups.set(current);
    this.activeGroupKey.set(key);
    this.activeRecord.set(null);
    this.selectedStop.set(null);
    this.activeSection.set('commercial');
  }

  isRecordStopsExpanded(record: TimetableHubRecord): boolean {
    return this.expandedStops().has(record.refTrainId);
  }

  toggleRecordStops(record: TimetableHubRecord, event?: MouseEvent) {
    event?.stopPropagation();
    const current = new Set(this.expandedStops());
    const key = record.refTrainId;
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.expandedStops.set(current);
  }

  private groupKey(refTrainId: string): string {
    const match = /^(.+?)([A-Z])$/.exec(refTrainId);
    if (match) {
      return match[1];
    }
    return refTrainId;
  }

  trackRecord(_: number, record: TimetableHubRecord): string {
    return record.refTrainId;
  }

  calendarPreview(record: TimetableHubRecord): string[] {
    return record.calendarDays.slice(0, 8);
  }

  calendarOverflow(record: TimetableHubRecord): number {
    return Math.max(record.calendarDays.length - 8, 0);
  }

  activeSectionData = computed(() => {
    const record = this.activeDisplayRecord();
    if (!record) {
      return null;
    }
    switch (this.activeSection()) {
      case 'operational':
        return record.operational;
      case 'actual':
        return record.actual;
      default:
        return record.commercial;
    }
  });

  stopTimeLabel(stop: TimetableHubStopSummary): string {
    if (stop.arrivalTime && stop.departureTime) {
      return `${this.formatClock(stop.arrivalTime)} / ${this.formatClock(stop.departureTime)}`;
    }
    if (stop.arrivalTime) {
      return this.formatClock(stop.arrivalTime);
    }
    if (stop.departureTime) {
      return this.formatClock(stop.departureTime);
    }
    return '—';
  }

  formatClock(value: string | undefined): string {
    if (!value) {
      return '—';
    }
    if (!value.includes('T')) {
      return value.length ? value : '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value.length >= 5 ? value.slice(0, 5) : '—';
    }
    return date.toISOString().slice(11, 16);
  }

  trainAttributes(record: TimetableHubRecord | null): { label: string; value: string }[] {
    if (!record) {
      return [];
    }
    const timetable = this.timetableService.getByRefTrainId(record.refTrainId);
    const rows: { label: string; value: string }[] = [];
    rows.push({ label: 'RefTrainID', value: record.refTrainId });
    rows.push({ label: 'Zugnummer', value: record.trainNumber });
    rows.push({ label: 'Titel', value: record.title });
    rows.push({ label: 'Fahrplanjahr', value: record.timetableYearLabel });
    rows.push({ label: 'Fahrtage (Anzahl)', value: `${record.calendarDays.length}` });
    rows.push({ label: 'Kalenderbereich', value: record.calendarRangeLabel });
    if (timetable) {
      rows.push({ label: 'OPN', value: timetable.opn });
      rows.push({ label: 'Verantwortliche EVU', value: timetable.responsibleRu });
      rows.push({ label: 'Status (Phase)', value: timetable.status });
      if (timetable.source?.type) {
        rows.push({ label: 'Quelle', value: timetable.source.type });
      }
      if (timetable.source?.pathRequestId) {
        rows.push({ label: 'Path Request ID', value: timetable.source.pathRequestId });
      }
      if (timetable.source?.frameworkAgreementId) {
        rows.push({ label: 'Rahmenvertrag-ID', value: timetable.source.frameworkAgreementId });
      }
      if (timetable.source?.externalSystem) {
        rows.push({ label: 'Externes System', value: timetable.source.externalSystem });
      }
      if (timetable.source?.referenceDocumentId) {
        rows.push({ label: 'Referenzdokument', value: timetable.source.referenceDocumentId });
      }
    }
    return rows.filter((row) => row.value && row.value.toString().trim().length > 0);
  }

  yearOptions(): string[] {
    const managed = this.yearService.managedYearBounds();
    if (managed.length) {
      return managed.map((year) => year.label);
    }
    const labels = new Set<string>();
    this.records().forEach((record) => labels.add(record.timetableYearLabel));
    if (!labels.size) {
      labels.add(this.yearService.defaultYearBounds().label);
    }
    return Array.from(labels).sort();
  }

  openCreationDialog() {
    const ref = this.dialog.open(TimetableTestTrainDialogComponent, {
      width: '720px',
      data: {
        yearOptions: this.yearOptions(),
        sectionTabs: this.sectionTabs,
        defaultYearLabel: this.selectedYearLabel() || this.yearService.defaultYearBounds().label,
      },
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed())
      .subscribe((result?: TimetableTestTrainDialogResult) => {
        if (result) {
          this.createPlanFromDialog(result);
        }
      });
  }

  private expandDateRange(startIso: string, endIso: string): string[] {
    if (!startIso || !endIso) {
      return [];
    }
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return [];
    }
    const result: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end && result.length <= 1096) {
      result.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  private createVariantFromDialog(
    base: TimetableHubRecord,
    result: TimetableTestTrainDialogResult,
  ) {
    const calendarDays = this.expandDateRange(result.calendarStart, result.calendarEnd);
    if (!calendarDays.length) {
      return;
    }
    const stops = this.buildStopsFromDialog(result.stops, calendarDays[0]);
    if (!stops.length) {
      return;
    }
    const refTrainId = this.generateVariantRefTrainId(base.refTrainId, result.timetableYearLabel);
    this.hubService.registerPlanUpdate({
      refTrainId,
      trainNumber: result.trainNumber.trim(),
      title: result.title.trim(),
      timetableYearLabel: result.timetableYearLabel,
      calendarDays,
      section: result.section,
      stops,
      notes: 'Variante erstellt im Fahrplanmanager',
      technical: result.technical,
      routeMetadata: result.routeMetadata,
    });
    const newlyCreated = this.hubService.findByRefTrainId(refTrainId);
    if (newlyCreated) {
      this.selectRecord(newlyCreated);
      this.activeSection.set(result.section);
      this.searchControl.setValue(refTrainId);
      this.searchTerm.set(refTrainId);
    }
  }

  private buildGroupYearBitmap(
    yearBounds: TimetableYearBounds,
    activeDates: readonly string[],
  ): string {
    const active = new Set(activeDates);
    const result: string[] = [];
    const cursor = new Date(yearBounds.start);
    const end = new Date(yearBounds.end);
    while (cursor.getTime() <= end.getTime()) {
      const iso = cursor.toISOString().slice(0, 10);
      result.push(active.has(iso) ? '1' : '0');
      cursor.setDate(cursor.getDate() + 1);
    }
    return result.join('');
  }

  private aggregateSectionStops(
    records: TimetableHubRecord[],
    key: TimetableHubSectionKey,
  ): TimetableHubStopSummary[] {
    const allStops: TimetableHubStopSummary[] = [];
    records.forEach((record) => {
      record[key].stops.forEach((stop) => {
        allStops.push({ ...stop });
      });
    });
    return allStops.sort((a, b) => a.sequence - b.sequence);
  }

  private generateRefTrainId(yearLabel: string): string {
    const yearDigits = yearLabel.replace(/\D/g, '').slice(0, 4) || '0000';
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TT-${yearDigits}-${random}`;
  }

  private generateVariantRefTrainId(
    baseRefTrainId: string,
    yearLabel: string,
  ): string {
    const root = this.groupKey(baseRefTrainId);
    const records = this.records();
    const groupIds = records
      .map((record) => record.refTrainId)
      .filter((id) => this.groupKey(id) === root);
    let maxCode = 64;
    groupIds.forEach((id) => {
      const match = /^.+?([A-Z])$/.exec(id);
      if (match) {
        const code = match[1].charCodeAt(0);
        if (code > maxCode) {
          maxCode = code;
        }
      }
    });
    let suffix = 'A';
    if (maxCode >= 65) {
      const nextCode = maxCode + 1;
      if (nextCode <= 90) {
        suffix = String.fromCharCode(nextCode);
      } else {
        return this.generateRefTrainId(yearLabel);
      }
    }
    const candidate = `${root}${suffix}`;
    if (!records.some((record) => record.refTrainId === candidate)) {
      return candidate;
    }
    return this.generateRefTrainId(yearLabel);
  }

  hasTechnicalData(record: TimetableHubRecord | null): boolean {
    const technical = record?.technical;
    if (!technical) {
      return false;
    }
    const numericFields = [technical.maxSpeed, technical.lengthMeters, technical.weightTons];
    if (numericFields.some((value) => value !== null && value !== undefined && !Number.isNaN(value))) {
      return true;
    }
    return Boolean(
      (technical.trainType ?? '').trim() ||
        (technical.traction ?? '').trim() ||
        (technical.energyType ?? '').trim() ||
        (technical.brakeType ?? '').trim() ||
        (technical.etcsLevel ?? '').trim(),
    );
  }

  technicalValue(value: number | null | undefined, unit?: string): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '—';
    }
    return unit ? `${value} ${unit}` : `${value}`;
  }

  textValue(value?: string | null): string {
    return value?.trim() || '—';
  }

  hasRouteMetadata(record: TimetableHubRecord | null): boolean {
    const metadata = record?.routeMetadata;
    if (!metadata) {
      return false;
    }
    return Boolean(
      (metadata.originBorderPoint ?? '').trim() ||
        (metadata.destinationBorderPoint ?? '').trim() ||
        (metadata.borderNotes ?? '').trim(),
    );
  }

  routePointLabel(
    metadata: TimetableHubRouteMetadata | undefined,
    key: 'originBorderPoint' | 'destinationBorderPoint',
  ): string {
    if (!metadata) {
      return '—';
    }
    return metadata[key]?.trim() || '—';
  }

  routeNotes(metadata: TimetableHubRouteMetadata | undefined): string {
    if (!metadata) {
      return '—';
    }
    return metadata.borderNotes?.trim() || '—';
  }

  private createPlanFromDialog(result: TimetableTestTrainDialogResult) {
    const calendarDays = this.expandDateRange(result.calendarStart, result.calendarEnd);
    if (!calendarDays.length) {
      return;
    }
    const stops = this.buildStopsFromDialog(result.stops, calendarDays[0]);
    if (!stops.length) {
      return;
    }
    const refTrainId = this.generateRefTrainId(result.timetableYearLabel);
    this.hubService.registerPlanUpdate({
      refTrainId,
      trainNumber: result.trainNumber.trim(),
      title: result.title.trim(),
      timetableYearLabel: result.timetableYearLabel,
      calendarDays,
      section: result.section,
      stops,
      notes: 'Manuell erstellt im Fahrplanmanager',
      technical: result.technical,
      routeMetadata: result.routeMetadata,
    });
    const newlyCreated = this.hubService.findByRefTrainId(refTrainId);
    if (newlyCreated) {
      this.selectRecord(newlyCreated);
      this.activeSection.set(result.section);
      this.searchControl.setValue(refTrainId);
      this.searchTerm.set(refTrainId);
    }
  }

  private buildStopsFromDialog(
    stops: DialogStopValue[],
    referenceDay: string,
  ): TimetableHubStopSummary[] {
    return stops.map((stop, index) => ({
      sequence: index + 1,
      locationName: stop.locationName.trim(),
      type: stop.type,
      arrivalTime: this.combineDateWithTime(referenceDay, stop.arrivalTime),
      departureTime: this.combineDateWithTime(referenceDay, stop.departureTime),
      commercialArrivalTime: this.combineDateWithTime(referenceDay, stop.arrivalTime),
      commercialDepartureTime: this.combineDateWithTime(referenceDay, stop.departureTime),
      operationalArrivalTime: this.combineDateWithTime(referenceDay, stop.arrivalTime),
      operationalDepartureTime: this.combineDateWithTime(referenceDay, stop.departureTime),
      holdReason: 'Planhalt',
      responsibleRu: 'TTT',
      vehicleInfo: 'n/a',
    }));
  }

  private combineDateWithTime(date: string, time?: string | null): string | undefined {
    if (!time) {
      return undefined;
    }
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
    if (!match) {
      return undefined;
    }
    const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
    if ([year, month, day].some((value) => Number.isNaN(value))) {
      return undefined;
    }
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    const composed = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return Number.isNaN(composed.getTime()) ? undefined : composed.toISOString();
  }
}
