import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SimulationRecord } from '../models/simulation.model';
import { MOCK_SIMULATIONS } from '../mock/mock-simulations.mock';
import { TimetableYearService } from './timetable-year.service';

@Injectable({ providedIn: 'root' })
export class SimulationService {
  private readonly _records = signal<SimulationRecord[]>([]);
  private readonly timetableYears = inject(TimetableYearService);
  private readonly timetableYearBounds = this.timetableYears.managedYearBoundsSignal();

  constructor() {
    // seed mocks plus productive defaults
    this._records.set(this.withProductiveDefaults(MOCK_SIMULATIONS));
    effect(() => {
      // Track timetable years reactively so every year always owns a productive variant.
      const labels = this.timetableYearBounds().map((year) => year.label);
      this._records.update((current) => this.withProductiveDefaults(current, labels));
    });
  }

  readonly records = computed(() => this._records());

  list(): SimulationRecord[] {
    return this._records();
  }

  byTimetableYear(label: string): SimulationRecord[] {
    return this._records().filter(
      (sim) => sim.timetableYearLabel?.toLowerCase() === label.toLowerCase(),
    );
  }

  upsert(record: SimulationRecord): void {
    if (record.productive) {
      // productive entry is normalized to fixed id per year
      record.id = this.productiveId(record.timetableYearLabel);
      record.label = record.label || this.productiveLabel(record.timetableYearLabel);
    }
    const next = this.mergeRecords([record], this._records());
    this._records.set(this.withProductiveDefaults(next));
  }

  remove(ids: string[]): void {
    const protectedIds = new Set(
      this.timetableYears.listManagedYearRecords().map((y) => this.productiveId(y.label ?? '')),
    );
    const set = new Set(ids);
    this._records.update((current) =>
      this.withProductiveDefaults(
        current.filter((record) => !(set.has(record.id) && !protectedIds.has(record.id))),
      ),
    );
  }

  private withProductiveDefaults(
    records: SimulationRecord[],
    timetableYearLabels?: readonly (string | undefined)[],
  ): SimulationRecord[] {
    const yearLabels =
      timetableYearLabels ??
      this.timetableYears.listManagedYearRecords().map((year) => year.label ?? '');
    const existing = new Map(records.map((rec) => [rec.id, rec]));
    yearLabels.forEach((label) => {
      const id = this.productiveId(label ?? '');
      if (!existing.has(id)) {
        existing.set(id, {
          id,
          label: this.productiveLabel(label ?? ''),
          timetableYearLabel: label ?? '',
          description: 'Produktive Variante für dieses Fahrplanjahr.',
          productive: true,
        });
      }
    });
    return Array.from(existing.values());
  }

  private productiveId(yearLabel: string): string {
    return `PROD-${yearLabel || 'unknown'}`;
  }

  private productiveLabel(yearLabel: string): string {
    return `Produktiv ${yearLabel}`;
  }

  private mergeRecords(nextRecords: SimulationRecord[], current: SimulationRecord[]): SimulationRecord[] {
    const map = new Map<string, SimulationRecord>();
    current.forEach((rec) => map.set(rec.id, rec));
    nextRecords.forEach((rec) => map.set(rec.id, rec));
    return Array.from(map.values());
  }
}
