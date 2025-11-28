import { Injectable, computed, signal } from '@angular/core';
import {
  Timetable,
  TimetableMilestone,
  TimetableSourceInfo,
  TimetableSourceType,
  TimetableStop,
  TimetableStopTiming,
  TimetablePhase,
  TimetableRollingStock,
  TimetableCalendarModification,
  TimetableCalendarVariant,
  TimetableAuditEntry,
  TimetableResponsibility,
} from '../models/timetable.model';
import { TrainPlanCalendar } from '../models/train-plan.model';
import { MOCK_TIMETABLES } from '../mock/mock-timetables.mock';

export interface TimetableFilters {
  search: string;
  status: TimetablePhase | 'all';
  source: TimetableSourceType | 'all';
  responsibleRu: string | 'all';
}

export interface TimetableSort {
  field: 'updatedAt' | 'refTrainId' | 'trainNumber' | 'status';
  direction: 'asc' | 'desc';
}

export interface TimetableStopInput {
  sequence: number;
  type: TimetableStop['type'];
  locationCode: string;
  locationName: string;
  countryCode?: string;
  arrivalTime?: string;
  departureTime?: string;
  arrivalOffsetDays?: number;
  departureOffsetDays?: number;
  dwellMinutes?: number;
  activities: string[];
  platform?: string;
  notes?: string;
}

export interface UpdateOperationalTimingPayload {
  stopId: string;
  arrivalTime?: string;
  arrivalOffsetDays?: number;
  departureTime?: string;
  departureOffsetDays?: number;
  dwellMinutes?: number;
  remarks?: string;
}

export interface AppendAuditEntryPayload {
  actor: string;
  action: string;
  notes?: string;
  relatedEntity?: TimetableAuditEntry['relatedEntity'];
}

export interface CreateTimetablePayload {
  refTrainId: string;
  opn: string;
  title: string;
  trainNumber: string;
  responsibleRu: string;
  calendar: TrainPlanCalendar;
  status?: TimetablePhase;
  source: TimetableSourceInfo;
  stops: TimetableStopInput[];
  notes?: string;
  linkedOrderItemId?: string;
  milestones?: TimetableMilestone[];
  rollingStock?: TimetableRollingStock;
  calendarModifications?: TimetableCalendarModification[];
  calendarVariants?: TimetableCalendarVariant[];
  auditTrail?: TimetableAuditEntry[];
  responsibilities?: TimetableResponsibility[];
}

@Injectable({ providedIn: 'root' })
export class TimetableService {
  private readonly _timetables = signal<Timetable[]>(MOCK_TIMETABLES);
  private readonly _filters = signal<TimetableFilters>({
    search: '',
    status: 'all',
    source: 'all',
    responsibleRu: 'all',
  });
  private readonly _sort = signal<TimetableSort>({
    field: 'updatedAt',
    direction: 'desc',
  });
  private readonly timetableIndex = computed(() => {
    const entries = this._timetables().map((timetable) => [timetable.refTrainId, timetable] as const);
    return new Map<string, Timetable>(entries);
  });

  readonly timetables = computed(() => this._timetables());
  readonly filters = computed(() => this._filters());
  readonly sort = computed(() => this._sort());

  readonly responsibleRus = computed(() =>
    Array.from(
      new Set(this._timetables().map((timetable) => timetable.responsibleRu)),
    ).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' })),
  );

  readonly filteredTimetables = computed(() => {
    const filters = this._filters();
    const sort = this._sort();
    const search = filters.search.trim().toLowerCase();

    const filtered = this._timetables().filter((timetable) => {
      if (search) {
        const haystack = [
          timetable.refTrainId,
          timetable.opn,
          timetable.title,
          timetable.trainNumber,
          timetable.responsibleRu,
          timetable.source.pathRequestId,
          timetable.source.externalSystem,
          timetable.notes,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      if (filters.status !== 'all' && timetable.status !== filters.status) {
        return false;
      }
      if (filters.source !== 'all' && timetable.source.type !== filters.source) {
        return false;
      }
      if (
        filters.responsibleRu !== 'all' &&
        timetable.responsibleRu !== filters.responsibleRu
      ) {
        return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => this.compareTimetables(a, b, sort));
  });

  setFilters(patch: Partial<TimetableFilters>) {
    this._filters.update((current) => ({ ...current, ...patch }));
  }

  setSort(sort: Partial<TimetableSort>) {
    this._sort.update((current) => ({ ...current, ...sort }));
  }

  resetFilters() {
    this._filters.set({
      search: '',
      status: 'all',
      source: 'all',
      responsibleRu: 'all',
    });
  }

  getByRefTrainId(refTrainId: string): Timetable | undefined {
    return this.timetableIndex().get(refTrainId);
  }

  createTimetable(payload: CreateTimetablePayload): Timetable {
    if (this.getByRefTrainId(payload.refTrainId)) {
      throw new Error(
        `Ein Fahrplan mit der RefTrainID ${payload.refTrainId} existiert bereits.`,
      );
    }

    const timestamp = new Date().toISOString();
    const stops = payload.stops.map((stop) =>
      this.toTimetableStop(payload.refTrainId, stop),
    );
    if (!stops.length) {
      throw new Error('Für den Fahrplan werden mindestens zwei Halte benötigt.');
    }

    const timetable: Timetable = {
      refTrainId: payload.refTrainId,
      opn: payload.opn,
      title: payload.title,
      trainNumber: payload.trainNumber,
      responsibleRu: payload.responsibleRu,
      calendar: payload.calendar,
      status: payload.status ?? 'bedarf',
      source: payload.source,
      milestones:
        payload.milestones?.length
          ? payload.milestones
          : this.defaultMilestones(payload.source.type),
      stops,
      createdAt: timestamp,
      updatedAt: timestamp,
      linkedOrderItemId: payload.linkedOrderItemId,
      notes: payload.notes,
      rollingStock: payload.rollingStock,
      calendarModifications: payload.calendarModifications,
      calendarVariants: payload.calendarVariants,
      auditTrail: payload.auditTrail ?? this.defaultAuditTrail(payload.responsibleRu),
      responsibilities: payload.responsibilities ?? this.defaultResponsibilities(payload.responsibleRu),
    };

    this._timetables.update((current) => [timetable, ...current]);
    return timetable;
  }

  replaceStops(refTrainId: string, stops: TimetableStopInput[]): Timetable {
    const existing = this.getByRefTrainId(refTrainId);
    if (!existing) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    if (!stops.length) {
      throw new Error('Der Fahrplan benötigt mindestens zwei Halte.');
    }

    const updatedStops = stops.map((stop) =>
      this.toTimetableStop(refTrainId, stop),
    );

    const updated = {
      ...existing,
      stops: updatedStops,
      updatedAt: new Date().toISOString(),
    };
    this._timetables.update((current) =>
      current.map((item) => (item.refTrainId === refTrainId ? updated : item)),
    );
    return updated;
  }

  updateRollingStock(
    refTrainId: string,
    rollingStock: TimetableRollingStock | null | undefined,
  ): Timetable {
    const existing = this.getByRefTrainId(refTrainId);
    if (!existing) {
      throw new Error('Fahrplan nicht gefunden.');
    }

    const updated: Timetable = {
      ...existing,
      rollingStock: rollingStock ?? undefined,
      updatedAt: new Date().toISOString(),
    };

    this._timetables.update((current) =>
      current.map((item) => (item.refTrainId === refTrainId ? updated : item)),
    );

    return updated;
  }

  updateCalendarVariants(
    refTrainId: string,
    variants: TimetableCalendarVariant[],
  ): Timetable {
    const updated = this.mutateTimetable(refTrainId, (timetable) => ({
      ...timetable,
      calendarVariants: variants,
    }));
    if (!updated) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    return updated;
  }

  updateResponsibilities(
    refTrainId: string,
    responsibilities: TimetableResponsibility[],
  ): Timetable {
    const updated = this.mutateTimetable(refTrainId, (timetable) => ({
      ...timetable,
      responsibilities,
    }));
    if (!updated) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    return updated;
  }

  appendAuditEntry(
    refTrainId: string,
    payload: AppendAuditEntryPayload,
  ): Timetable {
    const updated = this.mutateTimetable(refTrainId, (timetable) => {
      const auditTrail = [
        {
          id: `audit-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actor: payload.actor?.trim() || 'Unbekannt',
          action: payload.action?.trim() || 'Aktualisierung',
          notes: payload.notes?.trim() || undefined,
          relatedEntity: payload.relatedEntity ?? 'other',
        },
        ...(timetable.auditTrail ?? []),
      ] as TimetableAuditEntry[];
      return {
        ...timetable,
        auditTrail,
      };
    });
    if (!updated) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    return updated;
  }

  updateCalendarModifications(
    refTrainId: string,
    modifications: TimetableCalendarModification[],
  ): Timetable {
    const updated = this.mutateTimetable(refTrainId, (timetable) => ({
      ...timetable,
      calendarModifications: modifications,
    }));
    if (!updated) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    return updated;
  }

  updateOperationalTimings(
    refTrainId: string,
    updates: UpdateOperationalTimingPayload[],
  ): Timetable {
    if (!updates.length) {
      const current = this.getByRefTrainId(refTrainId);
      if (!current) {
        throw new Error('Fahrplan nicht gefunden.');
      }
      return current;
    }

    const updatedTimetable = this.mutateTimetable(refTrainId, (timetable) => {
      const map = new Map(
        updates.map((update) => [update.stopId, update] as const),
      );
      const stops = timetable.stops.map((stop) => {
        const update = map.get(stop.id);
        if (!update) {
          return stop;
        }
        const operational: TimetableStopTiming = {
          ...stop.operational,
          ...this.cleanTimingPayload(update),
        };
        return {
          ...stop,
          operational,
        };
      });
      return { ...timetable, stops };
    });

    if (!updatedTimetable) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    return updatedTimetable;
  }

  updateMilestones(
    refTrainId: string,
    milestones: TimetableMilestone[],
  ): Timetable {
    if (!milestones.length) {
      throw new Error('Mindestens ein Meilenstein ist erforderlich.');
    }
    const updated = this.mutateTimetable(refTrainId, (timetable) => ({
      ...timetable,
      milestones,
    }));
    if (!updated) {
      throw new Error('Fahrplan nicht gefunden.');
    }
    return updated;
  }

  private mutateTimetable(
    refTrainId: string,
    mutator: (timetable: Timetable) => Timetable,
  ): Timetable | undefined {
    let result: Timetable | undefined;
    this._timetables.update((current) =>
      current.map((item) => {
        if (item.refTrainId !== refTrainId) {
          return item;
        }
        result = {
          ...mutator(item),
          updatedAt: new Date().toISOString(),
        };
        return result;
      }),
    );
    return result;
  }

  private compareTimetables(
    a: Timetable,
    b: Timetable,
    sort: TimetableSort,
  ): number {
    let factor = sort.direction === 'asc' ? 1 : -1;
    switch (sort.field) {
      case 'refTrainId':
        return a.refTrainId.localeCompare(b.refTrainId) * factor;
      case 'trainNumber':
        return a.trainNumber.localeCompare(b.trainNumber) * factor;
      case 'status':
        return a.status.localeCompare(b.status) * factor;
      default:
        factor = sort.direction === 'asc' ? 1 : -1;
        return (
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        ) * factor;
    }
  }

  private toTimetableStop(
    refTrainId: string,
    stop: TimetableStopInput,
  ): TimetableStop {
    const id =
      stop.sequence && stop.sequence > 0
        ? `${refTrainId}-STOP-${stop.sequence.toString().padStart(3, '0')}`
        : `${refTrainId}-STOP-${Math.random().toString(36).slice(2, 8)}`;

    const commercial: TimetableStopTiming = {
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
      remarks: stop.notes,
    };

    const operational: TimetableStopTiming = {
      arrivalTime: stop.arrivalTime,
      departureTime: stop.departureTime,
      arrivalOffsetDays: stop.arrivalOffsetDays,
      departureOffsetDays: stop.departureOffsetDays,
      dwellMinutes: stop.dwellMinutes,
    };

    return {
      id,
      sequence: stop.sequence,
      type: stop.type,
      locationCode: stop.locationCode,
      locationName: stop.locationName,
      countryCode: stop.countryCode,
      activities: stop.activities.length ? [...stop.activities] : ['0001'],
      platform: stop.platform,
      commercial,
      operational,
      notes: stop.notes,
    };
  }

  private cleanTimingPayload(
    payload: UpdateOperationalTimingPayload,
  ): TimetableStopTiming {
    const sanitized: TimetableStopTiming = {};
    if (payload.arrivalTime !== undefined) {
      sanitized.arrivalTime = payload.arrivalTime || undefined;
    }
    if (payload.departureTime !== undefined) {
      sanitized.departureTime = payload.departureTime || undefined;
    }
    if (payload.arrivalOffsetDays !== undefined) {
      sanitized.arrivalOffsetDays = Number.isFinite(payload.arrivalOffsetDays)
        ? payload.arrivalOffsetDays
        : undefined;
    }
    if (payload.departureOffsetDays !== undefined) {
      sanitized.departureOffsetDays = Number.isFinite(
        payload.departureOffsetDays,
      )
        ? payload.departureOffsetDays
        : undefined;
    }
    if (payload.dwellMinutes !== undefined) {
      sanitized.dwellMinutes = Number.isFinite(payload.dwellMinutes)
        ? payload.dwellMinutes
        : undefined;
    }
    if (payload.remarks !== undefined) {
      sanitized.remarks = payload.remarks || undefined;
    }
    return sanitized;
  }

  private defaultMilestones(sourceType: TimetableSourceType): TimetableMilestone[] {
    switch (sourceType) {
      case 'ttt_path_request':
        return [
          {
            id: 'bedarf',
            label: 'Bedarf erfassen',
            status: 'completed',
            relatedProcess: 'anmeldung',
          },
          {
            id: 'ttt-request',
            label: 'TTT-Trassenerstanmeldung',
            status: 'open',
            relatedProcess: 'anmeldung',
          },
          {
            id: 'offer',
            label: 'Trassenangebot prüfen',
            status: 'open',
            relatedProcess: 'offer',
          },
          {
            id: 'booking',
            label: 'Buchungsbestätigung',
            status: 'open',
            relatedProcess: 'contract',
          },
        ];
      case 'framework_agreement':
        return [
          {
            id: 'capacity',
            label: 'RVK abstimmen',
            status: 'open',
            relatedProcess: 'contract',
          },
          {
            id: 'ops-start',
            label: 'Betriebsübergabe',
            status: 'open',
            relatedProcess: 'operation',
          },
        ];
      case 'imported':
      case 'manual':
      default:
        return [
          {
            id: 'validation',
            label: 'Fahrplan prüfen',
            status: 'open',
            relatedProcess: 'anmeldung',
          },
        ];
    }
  }

  private defaultResponsibilities(responsibleRu: string): TimetableResponsibility[] {
    return [
      {
        id: `${responsibleRu}-calendar`,
        role: 'Kalenderprüfung',
        assignee: responsibleRu,
        scope: 'calendar',
        status: 'in_progress',
        dueDate: new Date().toISOString().split('T')[0],
        notes: 'Regelbetriebstage mit Sonder- und Sperrtagen abstimmen.',
      },
      {
        id: `${responsibleRu}-operations`,
        role: 'Betrieb & Infrastrukturabstimmung',
        assignee: 'InfraGO Leitstelle',
        contact: 'leitstelle@infrago-demo.de',
        scope: 'operations',
        status: 'open',
        notes: 'ETCS-Level und Trassenkapazitäten prüfen.',
      },
    ];
  }

  private defaultAuditTrail(responsibleRu: string): TimetableAuditEntry[] {
    const timestamp = new Date().toISOString();
    return [
      {
        id: `audit-${Date.now()}`,
        timestamp,
        actor: responsibleRu,
        action: 'Fahrplananlage erstellt',
        relatedEntity: 'other',
      },
    ];
  }
}
