import { Injectable, inject, signal } from '@angular/core';
import { TimetableService } from './timetable.service';
import { Timetable } from '../models/timetable.model';
import { TimetableRollingStock } from '../models/timetable.model';
import { TimetableYearService } from './timetable-year.service';
import { TimetableYearBounds } from '../models/timetable-year.model';

export type TimetableHubSectionKey = 'commercial' | 'operational' | 'actual';

export interface TimetableHubStopSummary {
  sequence: number;
  locationName: string;
  type: 'origin' | 'intermediate' | 'destination';
  arrivalTime?: string;
  departureTime?: string;
  commercialArrivalTime?: string;
  commercialDepartureTime?: string;
  operationalArrivalTime?: string;
  operationalDepartureTime?: string;
  hasRollingStockChange?: boolean;
  holdReason: string;
  responsibleRu: string;
  vehicleInfo: string;
}

export interface TimetableHubSection {
  key: TimetableHubSectionKey;
  label: string;
  description: string;
  stops: TimetableHubStopSummary[];
  notes?: string;
}

export interface TimetableHubTechnicalSummary {
  trainType?: string;
  maxSpeed?: number;
  lengthMeters?: number;
  weightTons?: number;
  traction?: string;
  energyType?: string;
  brakeType?: string;
  etcsLevel?: string;
}

export interface TimetableHubRouteMetadata {
  originBorderPoint?: string;
  destinationBorderPoint?: string;
  borderNotes?: string;
}

export interface TimetableHubRecord {
  refTrainId: string;
  trainNumber: string;
  title: string;
  timetableYearLabel: string;
  calendarDays: string[];
  calendarBitmap: string;
  calendarRangeLabel: string;
  vehicles?: TimetableRollingStock;
  technical?: TimetableHubTechnicalSummary;
  routeMetadata?: TimetableHubRouteMetadata;
  commercial: TimetableHubSection;
  operational: TimetableHubSection;
  actual: TimetableHubSection;
}

export interface TimetableHubPlanUpdate {
  refTrainId: string;
  trainNumber: string;
  title: string;
  timetableYearLabel: string;
  calendarDays: string[];
  section: TimetableHubSectionKey;
  stops: TimetableHubStopSummary[];
  notes?: string;
  vehicles?: TimetableRollingStock;
  technical?: TimetableHubTechnicalSummary;
  routeMetadata?: TimetableHubRouteMetadata;
}

type InternalRecord = {
  record: TimetableHubRecord;
  daySets: Record<TimetableHubSectionKey, Set<string>>;
};

@Injectable({ providedIn: 'root' })
export class TimetableHubService {
  private readonly timetableService = inject(TimetableService);
  private readonly timetableYearService = inject(TimetableYearService);
  private readonly recordMapSignal = signal<Map<string, InternalRecord>>(new Map());

  constructor() {
    this.bootstrapFromTimetables();
  }

  records(): TimetableHubRecord[] {
    return Array.from(this.recordMapSignal().values())
      .map((entry) => this.cloneRecord(entry.record))
      .sort((a, b) => a.refTrainId.localeCompare(b.refTrainId));
  }

  findByRefTrainId(refTrainId: string): TimetableHubRecord | undefined {
    return this.records().find((record) => record.refTrainId === refTrainId);
  }

  registerPlanUpdate(update: TimetableHubPlanUpdate): void {
    this.applyUpdate(update);
  }

  private bootstrapFromTimetables() {
    this.timetableService.timetables().forEach((tt) => {
      const update: TimetableHubPlanUpdate = {
        refTrainId: tt.refTrainId,
        trainNumber: tt.trainNumber,
        title: tt.title,
        timetableYearLabel: this.timetableYearService.getYearBounds(tt.calendar.validFrom).label,
        calendarDays: this.expandCalendarDays(tt.calendar.validFrom, tt.calendar.validTo ?? tt.calendar.validFrom, tt.calendar.daysBitmap ?? '1111111'),
        section: 'commercial',
        stops: this.toStopSummaries(tt.stops, tt.rollingStock),
        notes: tt.notes,
        vehicles: tt.rollingStock,
        technical: this.technicalFromRollingStock(tt.rollingStock),
      };
      this.applyUpdate(update);
    });
  }

  private applyUpdate(update: TimetableHubPlanUpdate): void {
    const map = new Map(this.recordMapSignal());
    const entry =
      map.get(update.refTrainId) ?? this.createInternalRecord(update.refTrainId, update);

    entry.record.trainNumber = update.trainNumber;
    entry.record.title = update.title;
    entry.record.timetableYearLabel = update.timetableYearLabel;
    if (update.vehicles) {
      entry.record.vehicles = update.vehicles;
    }
    if (update.technical) {
      entry.record.technical = { ...update.technical };
    }
    if (update.routeMetadata) {
      entry.record.routeMetadata = { ...update.routeMetadata };
    }

    entry.record[update.section] = {
      ...entry.record[update.section],
      stops: [...update.stops],
      notes: update.notes ?? entry.record[update.section].notes,
    };

    const normalizedDays = Array.from(new Set(update.calendarDays)).sort();
    entry.daySets[update.section] = new Set(normalizedDays);

    Object.entries(entry.daySets).forEach(([key, set]) => {
      if (key !== update.section) {
        normalizedDays.forEach((day) => set.delete(day));
      }
    });

    const union = new Set<string>();
    Object.values(entry.daySets).forEach((set) => set.forEach((day) => union.add(day)));
    entry.record.calendarDays = Array.from(union).sort();

    const yearBounds = this.timetableYearService.getYearByLabel(update.timetableYearLabel);
    entry.record.calendarBitmap = this.buildYearBitmap(yearBounds, entry.record.calendarDays);
    entry.record.calendarRangeLabel = this.buildCalendarRangeLabel(yearBounds);

    map.set(update.refTrainId, entry);
    this.recordMapSignal.set(map);
  }

  private createInternalRecord(
    refTrainId: string,
    update: TimetableHubPlanUpdate,
  ): InternalRecord {
    const record: TimetableHubRecord = {
      refTrainId,
      trainNumber: update.trainNumber,
      title: update.title,
      timetableYearLabel: update.timetableYearLabel,
      calendarDays: [],
      calendarBitmap: '',
      calendarRangeLabel: '',
      vehicles: update.vehicles,
      technical: update.technical,
      routeMetadata: update.routeMetadata,
      commercial: this.buildSection('commercial'),
      operational: this.buildSection('operational'),
      actual: this.buildSection('actual'),
    };
    const daySets: Record<TimetableHubSectionKey, Set<string>> = {
      commercial: new Set(),
      operational: new Set(),
      actual: new Set(),
    };
    return { record, daySets };
  }

  private buildSection(key: TimetableHubSectionKey): TimetableHubSection {
    const labels: Record<TimetableHubSectionKey, { label: string; description: string }> = {
      commercial: {
        label: 'Kommerzieller Fahrplan',
        description:
          'Vertragsrelevanter Laufweg (TTT). Enthält nur die vom Infrastrukturbetreiber bestätigten Halte.',
      },
      operational: {
        label: 'Betrieblicher Fahrplan',
        description: 'Detailierter Laufweg inklusive aller Unterwegsbetriebsstellen.',
      },
      actual: {
        label: 'Ist-Fahrdaten',
        description: 'Ist-Daten wurden noch nicht übermittelt.',
      },
    };
    return {
      key,
      label: labels[key].label,
      description: labels[key].description,
      stops: [],
    };
  }

  private toStopSummaries(
    stops: Timetable['stops'],
    rollingStock?: TimetableRollingStock,
  ): TimetableHubStopSummary[] {
    const changeStopIds = new Set<string>(
      (rollingStock?.operations ?? []).map((op) => op.stopId),
    );
    let lastHold = 'Regulärer Halt';
    let lastResponsible = 'TTT';
    let lastVehicles = 'n/a';
    return stops.map((stop) => {
      const commercialArrivalTime = stop.commercial.arrivalTime;
      const commercialDepartureTime = stop.commercial.departureTime;
      const operationalArrivalTime = stop.operational.arrivalTime;
      const operationalDepartureTime = stop.operational.departureTime;
      const holdReason = stop.notes?.trim() || lastHold;
      const responsible = lastResponsible;
      const vehicles = stop.activities?.length ? stop.activities.join(', ') : lastVehicles;
      lastHold = holdReason;
      lastResponsible = responsible;
      lastVehicles = vehicles;
      return {
        sequence: stop.sequence,
        locationName: stop.locationName ?? stop.locationCode ?? 'Unbekannt',
        type: stop.type,
        arrivalTime: commercialArrivalTime ?? operationalArrivalTime,
        departureTime: commercialDepartureTime ?? operationalDepartureTime,
        commercialArrivalTime,
        commercialDepartureTime,
        operationalArrivalTime,
        operationalDepartureTime,
        hasRollingStockChange: changeStopIds.has(stop.id),
        holdReason,
        responsibleRu: responsible,
        vehicleInfo: vehicles,
      };
    });
  }

  private expandCalendarDays(validFrom: string, validTo: string, daysBitmap: string): string[] {
    const start = new Date(validFrom);
    const end = new Date(validTo);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return [];
    }
    const normalizedBitmap = daysBitmap.padEnd(7, '1').slice(0, 7);
    const days: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end && days.length <= 1096) {
      const weekday = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1;
      if (normalizedBitmap[weekday] === '1') {
        days.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  private buildCalendarRangeLabel(yearBounds: TimetableYearBounds): string {
    return `${yearBounds.startIso} – ${yearBounds.endIso}`;
  }

  private buildYearBitmap(
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

  private cloneRecord(record: TimetableHubRecord): TimetableHubRecord {
    return {
      ...record,
      calendarDays: [...record.calendarDays],
      commercial: {
        ...record.commercial,
        stops: record.commercial.stops.map((stop) => ({ ...stop })),
      },
      operational: {
        ...record.operational,
        stops: record.operational.stops.map((stop) => ({ ...stop })),
      },
      actual: {
        ...record.actual,
        stops: record.actual.stops.map((stop) => ({ ...stop })),
      },
      technical: record.technical ? { ...record.technical } : undefined,
      routeMetadata: record.routeMetadata ? { ...record.routeMetadata } : undefined,
    };
  }

  private technicalFromRollingStock(
    rollingStock?: TimetableRollingStock,
  ): TimetableHubTechnicalSummary | undefined {
    if (!rollingStock) {
      return undefined;
    }
    const summary: TimetableHubTechnicalSummary = {
      maxSpeed: rollingStock.maxSpeed,
      lengthMeters: rollingStock.lengthMeters,
      weightTons: rollingStock.weightTons,
      traction: rollingStock.tractionMode,
      etcsLevel: rollingStock.etcsLevel,
      brakeType: rollingStock.brakeType,
    };
    const hasValue = Object.values(summary).some((value) => value !== undefined && value !== null && value !== '');
    return hasValue ? summary : undefined;
  }
}
