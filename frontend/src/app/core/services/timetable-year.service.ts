import { Injectable, Signal, computed, signal } from '@angular/core';
import { TimetableYearBounds, TimetableYearRecord } from '../models/timetable-year.model';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STORAGE_KEY = 'order-management.timetable-years';
const DEFAULT_TIMETABLE_YEAR_LABELS = [
  '2023/24',
  '2024/25',
  '2025/26',
  '2026/27',
  '2027/28',
  '2028/29',
  '2029/30',
  '2030/31',
  '2031/32',
];

function toDate(value: Date | number | string): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  if (typeof value === 'string') {
    if (ISO_DATE_PATTERN.test(value)) {
      return new Date(`${value}T00:00:00`);
    }
    return new Date(value);
  }
  throw new Error('Unsupported date value');
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

@Injectable({ providedIn: 'root' })
export class TimetableYearService {
  private readonly managedRecords = signal<TimetableYearRecord[]>(this.loadManagedRecords());
  private readonly managedBoundsSignal = computed(() =>
    this.managedRecords()
      .map((record) => this.recordToBounds(record))
      .filter((value): value is TimetableYearBounds => value !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  );

  /**
   * Returns raw timetable-year records for the Stammdaten UI.
   */
  listManagedYearRecords(): TimetableYearRecord[] {
    return this.cloneRecords(this.managedRecords());
  }

  /**
   * Persists timetable-year records coming from the Stammdaten UI.
   */
  syncManagedYears(records: TimetableYearRecord[]): void {
    const normalized = records.map((record, index) => this.normalizeRecord(record, index));
    this.managedRecords.set(normalized);
    this.persistManagedRecords();
  }

  /**
   * Suggests sensible defaults when the user creates a new timetable year in Stammdaten.
   */
  nextDefaultRecord(): TimetableYearRecord {
    const managed = this.managedBoundsSignal();
    const reference = managed[managed.length - 1] ?? this.getYearBounds(new Date());
    const nextStart = this.addDays(reference.end, 1);
    const candidate = this.buildBoundsFromDate(nextStart);
    return {
      id: this.generateRecordIdForLabel(candidate.label),
      label: candidate.label,
      startIso: candidate.startIso,
      endIso: candidate.endIso,
    };
  }

  /**
   * Returns all valid timetable years defined by the user.
   */
  managedYearBounds(): TimetableYearBounds[] {
    return this.managedBoundsSignal().map((bounds) => this.cloneBounds(bounds));
  }

  managedYearBoundsSignal(): Signal<TimetableYearBounds[]> {
    return computed(() => this.managedBoundsSignal().map((bounds) => this.cloneBounds(bounds)));
  }

  /**
   * Returns the best suited default year for selection controls.
   */
  defaultYearBounds(): TimetableYearBounds {
    const managed = this.managedBoundsSignal();
    if (managed.length) {
      const today = new Date();
      const current =
        managed.find((year) => today >= year.start && today <= year.end) ?? managed[0];
      return this.cloneBounds(current);
    }
    return this.getYearBounds(new Date());
  }

  /**
   * Resolves timetable year bounds for arbitrary dates.
   * Prefers managed definitions when the date lies within a configured year.
   */
  getYearBounds(value: Date | number | string): TimetableYearBounds {
    const date = toDate(value);
    const managedMatch = this.findManagedYearForDate(date);
    if (managedMatch) {
      return this.cloneBounds(managedMatch);
    }
    return this.buildBoundsFromDate(date);
  }

  /**
   * Resolves timetable year bounds for a label such as "2024/25".
   * Checks user-managed definitions before falling back to the calculated calendar.
   */
  getYearByLabel(label: string): TimetableYearBounds {
    const trimmed = label?.trim();
    if (!trimmed) {
      throw new Error(`Ungültiges Fahrplanjahr "${label}". Erwartet wird z. B. 2023/24.`);
    }
    const managed = this.managedBoundsSignal().find((year) => year.label === trimmed);
    if (managed) {
      return this.cloneBounds(managed);
    }
    return this.buildBoundsForLabel(trimmed);
  }

  /**
   * Returns timetable-year options around a reference date (or the managed list, if present).
   */
  listYearsAround(center: Date | number | string, before = 2, after = 2): TimetableYearBounds[] {
    const managed = this.managedBoundsSignal();
    if (managed.length) {
      return managed.map((entry) => this.cloneBounds(entry));
    }
    const centerYear = this.getYearBounds(center);
    const years: TimetableYearBounds[] = [];
    for (let offset = -before; offset <= after; offset += 1) {
      const startYear = centerYear.startYear + offset;
      const bounds = this.buildBoundsForLabel(
        `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`,
      );
      years.push(bounds);
    }
    return years.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /**
   * Returns true if the given date belongs to the timetable year.
   */
  isDateWithinYear(value: Date | number | string, year: TimetableYearBounds): boolean {
    const date = toDate(value);
    return date >= year.start && date <= year.end;
  }

  /**
   * Ensures the provided range lies within a single timetable year and returns its info.
   */
  ensureRangeWithinSingleYear(start: Date, end: Date): TimetableYearBounds {
    const year = this.getYearBounds(start);
    if (end > year.end) {
      throw new Error(
        `Der gewählte Zeitraum ${toIsoDate(start)} – ${toIsoDate(end)} überschreitet das Fahrplanjahr ${year.label}.`,
      );
    }
    return year;
  }

  /**
   * Ensures that the provided ISO dates all fall within the same timetable year.
   * Returns the year information or throws an error otherwise.
   */
  ensureDatesWithinSameYear(dates: readonly string[]): TimetableYearBounds {
    const normalized = dates
      .map((date) => date?.trim())
      .filter((date): date is string => !!date);
    if (!normalized.length) {
      throw new Error('Es wurden keine Fahrtage angegeben.');
    }
    const firstYear = this.getYearBounds(normalized[0]);
    normalized.forEach((date) => {
      if (!this.isDateWithinYear(date, firstYear)) {
        throw new Error(
          `Fahrtag ${date} gehört nicht zum Fahrplanjahr ${firstYear.label}. Bitte pro Fahrplanjahr getrennt importieren.`,
        );
      }
    });
    return firstYear;
  }

  private findManagedYearForDate(date: Date): TimetableYearBounds | null {
    return this.managedBoundsSignal().find(
      (year) => date >= year.start && date <= year.end,
    ) ?? null;
  }

  private buildBoundsFromDate(date: Date): TimetableYearBounds {
    const decYear = this.resolveDecemberYear(date);
    const start = this.buildYearStart(decYear);
    const end = new Date(this.buildYearStart(decYear + 1).getTime() - 1);
    return this.buildBounds(start, end);
  }

  private buildBoundsForLabel(label: string): TimetableYearBounds {
    const trimmed = label.trim();
    const match = /^(\d{4})(?:[/-](\d{2}))?$/.exec(trimmed);
    if (!match) {
      throw new Error(`Ungültiges Fahrplanjahr "${label}". Erwartet wird z. B. 2023/24.`);
    }
    const startYear = Number.parseInt(match[1], 10);
    if (Number.isNaN(startYear)) {
      throw new Error(`Ungültiges Fahrplanjahr "${label}".`);
    }
    const start = this.buildYearStart(startYear);
    const end = new Date(this.buildYearStart(startYear + 1).getTime() - 1);
    return this.buildBounds(start, end);
  }

  private recordToBounds(record: TimetableYearRecord): TimetableYearBounds | null {
    if (!record.startIso || !record.endIso || !record.label?.trim()) {
      return null;
    }
    const start = this.parseIsoDate(record.startIso);
    const end = this.parseIsoDate(record.endIso);
    if (!start || !end) {
      return null;
    }
    const normalizedEnd = end.getTime() < start.getTime() ? start : end;
    const inclusiveEnd = new Date(
      normalizedEnd.getFullYear(),
      normalizedEnd.getMonth(),
      normalizedEnd.getDate(),
      23,
      59,
      59,
      999,
    );
    return {
      label: record.label.trim(),
      start,
      end: inclusiveEnd,
      startIso: toIsoDate(start),
      endIso: toIsoDate(normalizedEnd),
      startYear: start.getFullYear(),
      endYear: inclusiveEnd.getFullYear(),
    };
  }

  private parseIsoDate(value: string): Date | null {
    if (!value || !ISO_DATE_PATTERN.test(value)) {
      return null;
    }
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private normalizeRecord(record: TimetableYearRecord, index: number): TimetableYearRecord {
    const startIso = this.normalizeIsoDate(record.startIso);
    const endIsoRaw = this.normalizeIsoDate(record.endIso);
    const endIso =
      startIso && endIsoRaw && endIsoRaw < startIso ? startIso : endIsoRaw || startIso;
    return {
      id: record.id?.trim().length ? record.id.trim() : this.generateRecordId(),
      label: this.normalizeLabel(record.label, startIso, index),
      startIso,
      endIso,
      description: record.description?.trim() || undefined,
    };
  }

  private normalizeLabel(label: string | undefined, startIso: string, index: number): string {
    const trimmed = label?.trim();
    if (trimmed?.length) {
      return trimmed;
    }
    if (startIso) {
      const year = Number.parseInt(startIso.slice(0, 4), 10);
      if (!Number.isNaN(year)) {
        return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
      }
    }
    return `Fahrplanjahr ${index + 1}`;
  }

  private normalizeIsoDate(value: string | undefined | null): string {
    if (!value) {
      return '';
    }
    const trimmed = value.trim().slice(0, 10);
    return ISO_DATE_PATTERN.test(trimmed) ? trimmed : '';
  }

  private cloneRecords(records: TimetableYearRecord[]): TimetableYearRecord[] {
    return records.map((record) => ({ ...record }));
  }

  private cloneBounds(bounds: TimetableYearBounds): TimetableYearBounds {
    return {
      label: bounds.label,
      start: new Date(bounds.start.getTime()),
      end: new Date(bounds.end.getTime()),
      startIso: bounds.startIso,
      endIso: bounds.endIso,
      startYear: bounds.startYear,
      endYear: bounds.endYear,
    };
  }

  private loadManagedRecords(): TimetableYearRecord[] {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as TimetableYearRecord[];
          if (Array.isArray(parsed)) {
            return parsed.map((entry, index) => this.normalizeRecord(entry, index));
          }
        }
      } catch {
        // ignore malformed storage
      }
    }
    return this.buildDefaultRecords();
  }

  private persistManagedRecords(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(this.managedRecords()),
      );
    } catch {
      // ignore storage failures
    }
  }

  private generateRecordId(): string {
    return `ty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private generateRecordIdForLabel(label: string): string {
    const slug = label.replace(/[^0-9]/g, '');
    return slug.length ? `ty-${slug}` : this.generateRecordId();
  }

  private addDays(date: Date, days: number): Date {
    const clone = new Date(date.getTime());
    clone.setDate(clone.getDate() + days);
    return clone;
  }

  private resolveDecemberYear(date: Date): number {
    const currentYearStart = this.buildYearStart(date.getFullYear());
    if (date >= currentYearStart) {
      return currentYearStart.getFullYear();
    }
    return currentYearStart.getFullYear() - 1;
  }

  private buildYearStart(decemberYear: number): Date {
    const date = new Date(decemberYear, 11, 10, 0, 0, 0, 0);
    while (date.getDay() !== 0) {
      date.setDate(date.getDate() + 1);
    }
    return date;
  }

  private buildBounds(start: Date, end: Date): TimetableYearBounds {
    const startYear = start.getFullYear();
    const label = `${startYear}/${String((startYear + 1) % 100).padStart(2, '0')}`;
    return {
      label,
      start: new Date(start.getTime()),
      end: new Date(end.getTime()),
      startIso: toIsoDate(start),
      endIso: toIsoDate(end),
      startYear,
      endYear: end.getFullYear(),
    };
  }

  private buildDefaultRecords(): TimetableYearRecord[] {
    return DEFAULT_TIMETABLE_YEAR_LABELS.map((label, index) => {
      const bounds = this.buildBoundsForLabel(label);
      return {
        id: this.generateRecordIdForLabel(`${label}-${index}`),
        label: bounds.label,
        startIso: bounds.startIso,
        endIso: bounds.endIso,
      };
    });
  }
}
