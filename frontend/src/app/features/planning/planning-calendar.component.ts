import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { TemplateTimelineStoreService } from './template-timeline-store.service';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';
import { TemplatePeriod } from '../../core/api/timeline-api.types';
import { PlanningStageId } from './planning-stage.model';
import { Router } from '@angular/router';
import { PlanningPeriodsDialogComponent } from './planning-periods-dialog.component';

interface CalendarMonthHeader {
  key: string;
  label: string;
  month: number;
  year: number;
}

interface CalendarCell {
  iso: string;
  day: number;
  monthKey: string;
  isSpecial: boolean;
  isInPeriod: boolean;
  weekday: string;
  isSaturday: boolean;
  isSunday: boolean;
  periodIndex: number | null;
  periodColor: string | null;
}

interface CalendarRow {
  day: number;
  cells: (CalendarCell | null)[];
}

@Component({
    selector: 'app-planning-calendar',
    imports: [
        CommonModule,
        MatCardModule,
        MatButtonModule,
        MatButtonToggleModule,
        MatIconModule,
        MatDialogModule,
    ],
    templateUrl: './planning-calendar.component.html',
    styleUrl: './planning-calendar.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PlanningCalendarComponent {
  private readonly store = inject(TemplateTimelineStoreService);
  private readonly timetableYearService = inject(TimetableYearService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  readonly templates = this.store.templates;
  readonly selectedTemplate = computed(() => this.store.selectedTemplateWithFallback());
  readonly selectedYear = signal<TimetableYearBounds>(
    this.timetableYearService.defaultYearBounds(),
  );
  readonly stage = signal<PlanningStageId>('base');
  readonly selectedDate = signal<string | null>(null);
  readonly periodStart = signal<string>('');
  readonly periodEnd = signal<string>('');
  readonly specialDayInput = signal<string>('');
  readonly rangeSelectionMode = signal<'start' | 'end'>('start');
  readonly actionMessage = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly selectionRange = computed(() => {
    const rawStart = this.periodStart().trim();
    const rawEnd = this.periodEnd().trim();
    if (!rawStart && !rawEnd) {
      return null;
    }
    let start = rawStart || rawEnd;
    let end = rawEnd || rawStart;
    if (end < start) {
      [start, end] = [end, start];
    }
    return { start, end };
  });

  readonly yearOptions = computed(() => {
    const managed = this.timetableYearService.managedYearBounds();
    if (managed.length) {
      return managed;
    }
    const center = this.selectedYear().start;
    return this.timetableYearService.listYearsAround(center, 2, 2);
  });

  readonly monthHeaders = computed<CalendarMonthHeader[]>(() =>
    this.buildMonthHeaders(this.selectedYear()),
  );

  readonly calendarRows = computed<CalendarRow[]>(() => {
    const year = this.selectedYear();
    const template = this.selectedTemplate();
    const periods = template?.periods ?? [];
    const specialDays = new Set((template?.specialDays ?? []).map((d) => d.trim()));
    const headers = this.monthHeaders();
    const rows: CalendarRow[] = [];
    for (let day = 1; day <= 31; day += 1) {
      const cells = headers.map((header) => this.buildCell(header, day, year, periods, specialDays));
      rows.push({ day, cells });
    }
    return rows;
  });

  readonly gridTemplateColumns = computed(
    () => `60px repeat(${this.monthHeaders().length}, minmax(80px, 1fr))`,
  );

  constructor() {
    this.store.loadTemplates();
    effect(
      () => {
        const template = this.selectedTemplate();
        if (!template) {
          const templates = this.templates();
          if (templates.length > 0) {
            this.store.selectTemplate(templates[0].id);
          }
        }
        const tpl = this.selectedTemplate();
        // If still no template, create a synthetic default in memory so UI works.
        if (!tpl) {
          const year = this.selectedYear();
          this.store.setSyntheticTemplate({
            id: 'default',
            name: 'Default',
            description: 'Standard-Fahrplanjahr',
            tableName: 'template_default',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            periods: [
              {
                id: `default-${year.label}`,
                validFrom: year.startIso,
                validTo: year.endIso,
              },
            ],
            specialDays: [],
          });
        }
      },
      { allowSignalWrites: true },
    );
    // Initial defaults
    const year = this.selectedYear();
    this.periodStart.set(year.startIso);
    this.periodEnd.set(year.startIso);
    this.specialDayInput.set(year.startIso);
  }

  openPeriodsDialog(): void {
    const template = this.selectedTemplate();
    if (!template) {
      this.setActionError('Kein Template geladen.');
      return;
    }
    const ref = this.dialog.open(PlanningPeriodsDialogComponent, {
      data: {
        template,
        year: this.selectedYear(),
      },
      width: '480px',
    });
    ref.afterClosed().subscribe((result?: { periodId?: string; specialDay?: string }) => {
      if (result?.periodId) {
        this.removePeriod(result.periodId);
      }
      if (result?.specialDay) {
        this.removeSpecialDay(result.specialDay);
      }
    });
  }

  private removePeriod(periodId: string): void {
    const template = this.selectedTemplate();
    if (!template) {
      this.setActionError('Kein Template geladen.');
      return;
    }
    const year = this.selectedYear();
    const filtered = (template.periods ?? []).filter((p) => p.id !== periodId);
    const normalized = this.ensureCoverage(filtered, year);
    this.store.updateTemplate({
      ...template,
      periods: normalized,
    });
    this.setActionMessage('Zeitraum entfernt.');
  }

  private removeSpecialDay(dateIso: string): void {
    const template = this.selectedTemplate();
    if (!template) {
      this.setActionError('Kein Template geladen.');
      return;
    }
    const filtered = (template.specialDays ?? []).filter((d) => d !== dateIso);
    this.store.updateTemplate({
      ...template,
      specialDays: filtered,
    });
    this.setActionMessage(`Spezialtag ${dateIso} entfernt.`);
  }

  trackCell = (_: number, cell: CalendarCell | null) => cell?.iso ?? _;

  isInSelectionRange(iso: string | undefined | null): boolean {
    if (!iso) {
      return false;
    }
    const range = this.selectionRange();
    if (!range) {
      return false;
    }
    return iso >= range.start && iso <= range.end;
  }

  isRangeStart(iso: string | undefined | null): boolean {
    if (!iso) {
      return false;
    }
    const range = this.selectionRange();
    return !!range && iso === range.start;
  }

  isRangeEnd(iso: string | undefined | null): boolean {
    if (!iso) {
      return false;
    }
    const range = this.selectionRange();
    return !!range && iso === range.end;
  }

  onTemplateChange(templateId: string | null): void {
    this.store.selectTemplate(templateId || null);
  }

  onYearChange(label: string): void {
    if (!label) {
      this.selectedYear.set(this.timetableYearService.defaultYearBounds());
      return;
    }
    try {
      const year = this.timetableYearService.getYearByLabel(label);
      this.selectedYear.set(year);
      this.selectedDate.set(null);
      this.periodStart.set(year.startIso);
      this.periodEnd.set(year.startIso);
      this.specialDayInput.set(year.startIso);
      this.rangeSelectionMode.set('start');
    } catch (error) {
      console.warn('[PlanningCalendar] Unknown timetable year label', label, error);
      this.selectedYear.set(this.timetableYearService.defaultYearBounds());
      const fallback = this.selectedYear();
      this.periodStart.set(fallback.startIso);
      this.periodEnd.set(fallback.startIso);
      this.specialDayInput.set(fallback.startIso);
      this.rangeSelectionMode.set('start');
    }
  }

  onStageChange(stage: PlanningStageId): void {
    this.stage.set(stage);
  }

  onDayClick(cell: CalendarCell): void {
    this.selectedDate.set(cell.iso);
    this.specialDayInput.set(cell.iso);
    const mode = this.rangeSelectionMode();
    if (mode === 'start') {
      this.periodStart.set(cell.iso);
      this.periodEnd.set(cell.iso);
      this.rangeSelectionMode.set('end');
    } else {
      const currentStart = this.periodStart().trim() || cell.iso;
      let start = currentStart;
      let end = cell.iso;
      if (end < start) {
        [start, end] = [end, start];
      }
      this.periodStart.set(start);
      this.periodEnd.set(end);
      this.rangeSelectionMode.set('start');
    }
  }

  onPeriodStartInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value?.trim() ?? '';
    this.periodStart.set(value);
  }

  onPeriodEndInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value?.trim() ?? '';
    this.periodEnd.set(value);
  }

  onSpecialDayInput(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value?.trim() ?? '';
    this.specialDayInput.set(value);
  }

  addPeriodInline(): void {
    const template = this.selectedTemplate();
    if (!template) {
      this.setActionError('Kein Template geladen.');
      return;
    }
    const start = this.periodStart().trim();
    const endRaw = this.periodEnd().trim();
    if (!start) {
      this.setActionError('Bitte Startdatum wählen.');
      return;
    }
    let end = endRaw || start;
    if (end < start) {
      end = start;
    }
    const year = this.selectedYear();
    const inYearStart = this.timetableYearService.isDateWithinYear(start, year);
    const inYearEnd = this.timetableYearService.isDateWithinYear(end, year);
    if (!inYearStart || !inYearEnd) {
      this.setActionError('Zeitraum liegt nicht im gewählten Fahrplanjahr.');
      return;
    }
    const current = template.periods ?? [
      {
        id: `default-${year.label}`,
        validFrom: year.startIso,
        validTo: year.endIso,
      },
    ];
    const next = this.splitPeriodsWithRange(current, start, end, year);
    this.store.updateTemplate({
      ...template,
      periods: next,
    });
    this.setActionMessage(`Zeitraum gespeichert (${start} – ${end}).`);
  }

  addSpecialDayInline(): void {
    const template = this.selectedTemplate();
    if (!template) {
      this.setActionError('Kein Template geladen.');
      return;
    }
    const date = this.specialDayInput().trim();
    if (!date) {
      this.setActionError('Bitte Datum für Spezialtag wählen.');
      return;
    }
    const year = this.selectedYear();
    if (!this.timetableYearService.isDateWithinYear(date, year)) {
      this.setActionError('Spezialtag liegt nicht im gewählten Fahrplanjahr.');
      return;
    }
    const set = new Set(template.specialDays ?? []);
    set.add(date);
    this.store.updateTemplate({
      ...template,
      specialDays: Array.from(set).sort(),
    });
    this.setActionMessage(`Spezialtag gespeichert (${date}).`);
  }

  openGantt(): void {
    const year = this.selectedYear();
    const from = year.startIso;
    const to = year.endIso;
    const stage = this.stage();
    this.router.navigate(['/planning/board'], {
      queryParams: {
        stage,
        from,
        to,
      },
    });
  }

  private buildMonthHeaders(year: TimetableYearBounds): CalendarMonthHeader[] {
    const headers: CalendarMonthHeader[] = [];
    const cursor = new Date(year.start.getFullYear(), year.start.getMonth(), 1);
    const end = new Date(year.end.getFullYear(), year.end.getMonth(), 1);
    while (cursor <= end) {
      headers.push({
        key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        label: this.formatMonth(cursor),
        month: cursor.getMonth(),
        year: cursor.getFullYear(),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return headers;
  }

  private buildCell(
    header: CalendarMonthHeader,
    day: number,
    year: TimetableYearBounds,
    periods: TemplatePeriod[],
    specialDays: Set<string>,
  ): CalendarCell | null {
    const date = new Date(header.year, header.month, day);
    if (date.getMonth() !== header.month || date.getFullYear() !== header.year) {
      return null; // invalid day for month
    }
    if (date < year.start || date > year.end) {
      return null;
    }
    const iso = this.toIso(date);
    const periodIndex = this.findPeriodIndex(iso, periods);
    const isInPeriod = periodIndex !== null;
    const isSpecial = specialDays.has(iso);
    const weekdayIndex = date.getDay();
    return {
      iso,
      day,
      monthKey: header.key,
      isSpecial,
      isInPeriod,
      weekday: this.formatWeekday(date),
      isSaturday: weekdayIndex === 6,
      isSunday: weekdayIndex === 0,
      periodIndex,
      periodColor: periodIndex !== null ? this.colorForIndex(periodIndex) : null,
    };
  }

  private isWithinPeriod(iso: string, period: TemplatePeriod): boolean {
    const start = period.validFrom?.trim();
    if (!start) {
      return false;
    }
    const end = period.validTo?.trim() || '9999-12-31';
    return iso >= start && iso <= end;
  }

  private findPeriodIndex(iso: string, periods: TemplatePeriod[]): number | null {
    for (let i = 0; i < periods.length; i += 1) {
      if (this.isWithinPeriod(iso, periods[i])) {
        return i;
      }
    }
    return null;
  }

  private formatMonth(date: Date): string {
    const monthNames = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  }

  private formatWeekday(date: Date): string {
    const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    return names[date.getDay()];
  }

  private toIso(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  buildBackground(cell: CalendarCell): string {
    const rangeColor = 'rgba(63, 113, 255, 0.55)';
    const base = cell.isSunday ? '#ffeaea' : cell.isSaturday ? '#e9f2ff' : '#ffffff';
    const layers: string[] = [base];
    // Period shading removed; we use only the dot + optional outline.
    if (this.isInSelectionRange(cell.iso)) {
      layers.push(`linear-gradient(${rangeColor}, ${rangeColor})`);
    }
    return layers.join(', ');
  }

  private colorForIndex(index: number): string {
    const palette = ['#4c6fff', '#2eb88a', '#f2a541', '#c95ff2', '#f26b6b', '#3ab0ff'];
    return palette[index % palette.length];
  }

  private toRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private splitPeriodsWithRange(
    periods: TemplatePeriod[],
    start: string,
    end: string,
    year: TimetableYearBounds,
  ): TemplatePeriod[] {
    const sorted = [...periods].sort((a, b) => a.validFrom.localeCompare(b.validFrom));

    const result: TemplatePeriod[] = [];
    let inserted = false;

    for (const period of sorted) {
      const pStart = period.validFrom;
      const pEnd = period.validTo ?? year.endIso;
      // If new range lies completely before current period and not inserted yet
      if (!inserted && end < pStart) {
        result.push({
          id: `period-${Date.now().toString(36)}`,
          validFrom: start,
          validTo: end,
        });
        inserted = true;
      }

      // If new range overlaps this period, split it
      const overlaps =
        (start >= pStart && start <= pEnd) ||
        (end >= pStart && end <= pEnd) ||
        (start <= pStart && end >= pEnd);

      if (overlaps) {
        // before part
        if (start > pStart) {
          const beforeEnd = this.addDaysIso(start, -1);
          if (beforeEnd >= pStart) {
            result.push({
              id: `${period.id}-before`,
              validFrom: pStart,
              validTo: beforeEnd,
            });
          }
        }
        // new part
        if (!inserted) {
          result.push({
            id: `period-${Date.now().toString(36)}`,
            validFrom: start,
            validTo: end,
          });
          inserted = true;
        }
        // after part
        if (end < pEnd) {
          const afterStart = this.addDaysIso(end, 1);
          if (afterStart <= pEnd) {
            result.push({
              id: `${period.id}-after`,
              validFrom: afterStart,
              validTo: pEnd,
            });
          }
        }
      } else {
        result.push(period);
      }
    }

    if (!inserted) {
      result.push({
        id: `period-${Date.now().toString(36)}`,
        validFrom: start,
        validTo: end,
      });
    }

    // Ensure within year bounds
    return result
      .map((p) => ({
        ...p,
        validFrom: p.validFrom < year.startIso ? year.startIso : p.validFrom,
        validTo: p.validTo && p.validTo > year.endIso ? year.endIso : p.validTo,
      }))
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  }

  private ensureCoverage(periods: TemplatePeriod[], year: TimetableYearBounds): TemplatePeriod[] {
    const newId = () => `period-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    if (!periods.length) {
      return [
        {
          id: newId(),
          validFrom: year.startIso,
          validTo: year.endIso,
        },
      ];
    }
    const normalized = periods
      .map((p) => ({
        id: p.id ?? newId(),
        validFrom: p.validFrom < year.startIso ? year.startIso : p.validFrom,
        validTo: p.validTo && p.validTo > year.endIso ? year.endIso : p.validTo,
      }))
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));

    const result: TemplatePeriod[] = [];
    let current: TemplatePeriod = normalized[0];
    // ensure start at year start
    if (current.validFrom > year.startIso) {
      current = { ...current, validFrom: year.startIso };
    }

    for (let i = 1; i < normalized.length; i += 1) {
      const next = normalized[i];
      const currentEnd = current.validTo ?? year.endIso;
      const nextStart = next.validFrom;
      if (nextStart > this.addDaysIso(currentEnd, 1)) {
        // gap: extend current up to day before next
        current = { ...current, validTo: this.addDaysIso(nextStart, -1) };
      } else if (nextStart <= this.addDaysIso(currentEnd, 1)) {
        // overlap or touch: merge
        const nextEnd = next.validTo ?? year.endIso;
        const mergedEnd = nextEnd > currentEnd ? nextEnd : currentEnd;
        current = { ...current, validTo: mergedEnd };
        continue;
      }
      result.push(current);
      current = next;
    }
    result.push(current);

    const last = result[result.length - 1];
    const lastEnd = last.validTo ?? year.endIso;
    if (lastEnd < year.endIso) {
      result[result.length - 1] = { ...last, validTo: year.endIso };
    }

    // Reassign ids to keep them unique/clean after merges
    return result.map((p) => ({
      id: p.id ?? newId(),
      validFrom: p.validFrom,
      validTo: p.validTo,
    }));
  }

  private addDaysIso(iso: string, delta: number): string {
    const [y, m, d] = iso.split('-').map((part) => parseInt(part, 10));
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + delta);
    const yr = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${yr}-${mo}-${day}`;
  }

  private setActionMessage(message: string): void {
    this.actionMessage.set(message);
    this.actionError.set(null);
  }

  private setActionError(message: string): void {
    this.actionError.set(message);
    this.actionMessage.set(null);
  }
}
