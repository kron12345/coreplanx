import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import { AnnualCalendarSelectorComponent } from '../../../shared/annual-calendar-selector/annual-calendar-selector.component';
import { TimetableYearService } from '../../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../../core/models/timetable-year.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-reference-calendar-inline-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AnnualCalendarSelectorComponent, ...MATERIAL_IMPORTS],
  templateUrl: './reference-calendar-inline-form.component.html',
  styleUrl: './reference-calendar-inline-form.component.scss',
})
export class ReferenceCalendarInlineFormComponent implements OnInit, OnDestroy {
  @Input({ required: true }) yearControl!: FormControl;
  @Input({ required: true }) datesControl!: FormControl<string[]>;
  @Input({ required: true }) excludedDatesControl!: FormControl<string[]>;
  @Input() title = 'Referenzkalender';
  @Input() description =
    'Wähle die Verkehrstage dieses Kalenders. Markiere mindestens einen Tag.';
  @Input() hint: string | null =
    'Tipp: Shift + Klick für Bereichsauswahl, Strg/Cmd + Klick um bestehende Auswahl zu erweitern.';
  @Input() exclusionHint =
    'Wähle Tage aus, die trotz Markierung nicht gefahren werden sollen.';

  private yearChangesSub?: Subscription;
  mode: 'include' | 'exclude' = 'include';
  constructor(private readonly timetableYearService: TimetableYearService) {}

  get exclusionCount(): number {
    return this.excludedDatesControl.value?.length ?? 0;
  }

  get effectiveCount(): number {
    const exclude = new Set(this.excludedDatesControl.value ?? []);
    return (this.datesControl.value ?? []).filter((date) => !exclude.has(date)).length;
  }

  get timetableYearOptions(): TimetableYearBounds[] {
    const base = this.timetableYearService.listYearsAround(new Date(), 3, 3);
    const current = this.coerceYearLabel(this.yearControl.value);
    if (current && !base.some((option) => option.label === current)) {
      try {
        base.push(this.timetableYearService.getYearByLabel(current));
      } catch {
        // ignore invalid value
      }
    }
    return base.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  get currentYearBounds(): TimetableYearBounds {
    const value = this.coerceYearLabel(this.yearControl.value);
    if (value) {
      try {
        return this.timetableYearService.getYearByLabel(value);
      } catch {
        // fall through to default
      }
    }
    const fallback = this.timetableYearService.defaultYearBounds();
    this.yearControl.setValue(fallback.label, { emitEvent: false });
    return fallback;
  }

  get yearAllowedDates(): string[] {
    return this.buildAllowedDates(this.currentYearBounds);
  }

  get exclusionSelectableDates(): string[] {
    const allowed = new Set(this.yearAllowedDates);
    return (this.datesControl.value ?? []).filter((date) => allowed.has(date));
  }

  ngOnInit(): void {
    this.ensureYearControl();
    this.onYearChanged();
    this.yearChangesSub = this.yearControl.valueChanges.subscribe(() => this.onYearChanged());
  }

  ngOnDestroy(): void {
    this.yearChangesSub?.unsubscribe();
  }

  setMode(mode: 'include' | 'exclude') {
    if (this.mode !== mode) {
      this.mode = mode;
    }
  }

  onDatesChange(dates: string[]) {
    const normalized = this.normalizeDates(dates);
    this.datesControl.setValue(normalized);
    this.datesControl.markAsDirty();
    this.datesControl.markAsTouched();
    this.syncExclusions(normalized);
  }

  onExcludedDatesChange(dates: string[]) {
    const includeSet = new Set(this.datesControl.value ?? []);
    const normalized = this
      .normalizeDates(dates)
      .filter((date) => includeSet.has(date));
    this.excludedDatesControl.setValue(normalized);
    this.excludedDatesControl.markAsDirty();
    this.excludedDatesControl.markAsTouched();
  }

  private normalizeDates(dates: readonly string[]): string[] {
    return Array.from(
      new Set(
        dates
          .map((date) => date?.trim())
          .filter((date): date is string => !!date),
      ),
    ).sort();
  }

  private syncExclusions(includeDates: readonly string[]) {
    const includeSet = new Set(includeDates);
    const filtered = (this.excludedDatesControl.value ?? []).filter((date) =>
      includeSet.has(date),
    );
    if (filtered.length !== this.excludedDatesControl.value.length) {
      this.excludedDatesControl.setValue(filtered);
    }
  }

  private ensureYearControl() {
    const value = this.coerceYearLabel(this.yearControl.value);
    if (!value) {
      const fallback = this.timetableYearService.defaultYearBounds();
      this.yearControl.setValue(fallback.label, { emitEvent: false });
      return;
    }
    try {
      this.timetableYearService.getYearByLabel(value);
    } catch {
      const fallback = this.timetableYearService.defaultYearBounds();
      this.yearControl.setValue(fallback.label, { emitEvent: false });
    }
  }

  private onYearChanged() {
    const bounds = this.currentYearBounds;
    this.trimDatesToBounds(bounds);
  }

  private trimDatesToBounds(bounds: TimetableYearBounds) {
    const allowed = new Set(this.buildAllowedDates(bounds));
    const include = (this.datesControl.value ?? []).filter((date) => allowed.has(date));
    if (include.length !== (this.datesControl.value ?? []).length) {
      this.datesControl.setValue(include);
    }
    const exclude = (this.excludedDatesControl.value ?? []).filter((date) => allowed.has(date));
    if (exclude.length !== (this.excludedDatesControl.value ?? []).length) {
      this.excludedDatesControl.setValue(exclude);
    }
  }

  private buildAllowedDates(bounds: TimetableYearBounds): string[] {
    const dates: string[] = [];
    const cursor = new Date(bounds.start);
    while (cursor <= bounds.end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  private coerceYearLabel(value: string | number | null | undefined): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return this.formatYearLabel(value);
    }
    const raw = typeof value === 'string' ? value.trim() : '';
    return raw.length ? raw : null;
  }

  private formatYearLabel(decemberYear: number): string {
    const clamped = Math.trunc(decemberYear);
    const end = (clamped + 1) % 100;
    return `${clamped}/${end.toString().padStart(2, '0')}`;
  }
}
