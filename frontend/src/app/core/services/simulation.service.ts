import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { EMPTY, Observable, forkJoin, of } from 'rxjs';
import { catchError, finalize, map, take, tap } from 'rxjs/operators';
import { TimetableYearApiService } from '../api/timetable-year-api.service';
import { SimulationRecord } from '../models/simulation.model';
import { TimetableYearService } from './timetable-year.service';

@Injectable({ providedIn: 'root' })
export class SimulationService {
  private readonly api = inject(TimetableYearApiService);
  private readonly _records = signal<SimulationRecord[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly timetableYears = inject(TimetableYearService);
  private readonly timetableYearBounds = this.timetableYears.managedYearBoundsSignal();

  constructor() {
    effect(() => {
      // Refresh variants when timetable years change (productives are created per year).
      this.timetableYearBounds();
      this.refresh();
    });
    this.refresh();
  }

  readonly records = computed(() => this._records());
  readonly loading = computed(() => this.loadingSignal());
  readonly error = computed(() => this.errorSignal());

  list(): SimulationRecord[] {
    return this._records();
  }

  byTimetableYear(label: string): SimulationRecord[] {
    const needle = label?.trim().toLowerCase();
    if (!needle) {
      return [];
    }
    return this._records().filter((sim) => sim.timetableYearLabel?.toLowerCase() === needle);
  }

  refresh(): void {
    if (this.loadingSignal()) {
      return;
    }
    this.loadingSignal.set(true);
    this.api
      .listVariants()
      .pipe(
        take(1),
        map((variants) => variants.map((variant) => this.mapVariant(variant))),
        tap((records) => {
          this._records.set(records);
          this.errorSignal.set(null);
        }),
        catchError((error) => {
          console.warn('[SimulationService] Failed to load variants', error);
          this.errorSignal.set('Simulationen konnten nicht geladen werden.');
          return EMPTY;
        }),
        finalize(() => this.loadingSignal.set(false)),
      )
      .subscribe();
  }

  create(payload: { timetableYearLabel: string; label: string; description?: string }): Observable<SimulationRecord> {
    return this.api
      .createVariant({
        timetableYearLabel: payload.timetableYearLabel,
        label: payload.label,
        description: payload.description ?? null,
      })
      .pipe(
        take(1),
        map((variant) => this.mapVariant(variant)),
        tap(() => this.refresh()),
      );
  }

  update(id: string, payload: { label?: string; description?: string }): Observable<SimulationRecord> {
    return this.api
      .updateVariant(id, { label: payload.label, description: payload.description ?? null })
      .pipe(
        take(1),
        map((variant) => this.mapVariant(variant)),
        tap(() => this.refresh()),
      );
  }

  remove(ids: string[]): Observable<void> {
    if (!ids.length) {
      return of(undefined);
    }
    const recordMap = new Map(this._records().map((record) => [record.id, record] as const));
    const targets = ids
      .map((id) => recordMap.get(id))
      .filter((record): record is SimulationRecord => !!record)
      .filter((record) => !record.productive)
      .map((record) => record.id);
    if (!targets.length) {
      return of(undefined);
    }

    return forkJoin(targets.map((id) => this.api.deleteVariant(id))).pipe(
      take(1),
      tap(() => this.refresh()),
      map(() => undefined),
    );
  }

  private mapVariant(variant: {
    id: string;
    timetableYearLabel: string;
    kind: 'productive' | 'simulation';
    label: string;
    description?: string | null;
  }): SimulationRecord {
    return {
      id: variant.id,
      label: variant.label,
      timetableYearLabel: variant.timetableYearLabel,
      description: variant.description ?? undefined,
      productive: variant.kind === 'productive',
    };
  }
}
