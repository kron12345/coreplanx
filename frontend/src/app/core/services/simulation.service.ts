import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { EMPTY, Observable, forkJoin, of } from 'rxjs';
import { catchError, finalize, map, take, tap } from 'rxjs/operators';
import { TimetableYearApiService } from '../api/timetable-year-api.service';
import { SimulationRecord } from '../models/simulation.model';
import type { TimetableYearBounds } from '../models/timetable-year.model';
import { TimetableYearService } from './timetable-year.service';

@Injectable({ providedIn: 'root' })
export class SimulationService {
  private readonly api = inject(TimetableYearApiService);
  private readonly _records = signal<SimulationRecord[]>([]);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private readonly timetableYears = inject(TimetableYearService);
  private readonly timetableYearBounds = this.timetableYears.managedYearBoundsSignal();
  private readonly refreshThrottleMs = 1000;
  private lastRefreshAt = 0;
  private refreshQueued = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBoundsSignature: string | null = null;

  constructor() {
    effect(() => {
      // Refresh variants when timetable years change (productives are created per year).
      const signature = this.boundsSignature(this.timetableYearBounds());
      if (signature === this.lastBoundsSignature) {
        return;
      }
      this.lastBoundsSignature = signature;
      this.refresh();
    });
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
      this.refreshQueued = true;
      return;
    }
    const now = Date.now();
    const cooldown = this.refreshThrottleMs - (now - this.lastRefreshAt);
    if (cooldown > 0) {
      this.refreshQueued = true;
      this.scheduleRefresh(cooldown);
      return;
    }
    this.clearRefreshTimer();
    this.refreshQueued = false;
    this.lastRefreshAt = now;
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
        finalize(() => {
          this.loadingSignal.set(false);
          if (this.refreshQueued) {
            this.refreshQueued = false;
            this.refresh();
          }
        }),
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

  private boundsSignature(bounds: TimetableYearBounds[]): string {
    if (!bounds.length) {
      return '';
    }
    return bounds
      .map((entry) => `${entry.label}|${entry.startIso}|${entry.endIso}`)
      .join('||');
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.refreshTimer !== null) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, Math.max(0, delayMs));
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer === null) {
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}
