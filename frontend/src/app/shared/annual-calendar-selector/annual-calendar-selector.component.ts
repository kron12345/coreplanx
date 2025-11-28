import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';

interface CalendarCell {
  date: string | null;
  label: string;
  weekday: number | null;
  kind: 'day' | 'leading' | 'trailing';
}

interface CalendarMonthGroup {
  label: string;
  cells: CalendarCell[];
}

@Component({
  selector: 'app-annual-calendar-selector',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  templateUrl: './annual-calendar-selector.component.html',
  styleUrl: './annual-calendar-selector.component.scss',
})
export class AnnualCalendarSelectorComponent implements OnChanges {
  @Input() title = 'Kalender';
  @Input({ required: true }) year!: number;
  @Input() hint: string | null =
    'Tipp: Shift + Klick für Bereichsauswahl, Strg/Cmd + Klick um bestehende Auswahl zu erweitern.';
  @Input() selectedDates: readonly string[] | null = [];
  @Input() allowedDates: readonly string[] | null = null;
  @Input() accentDates: readonly string[] | null = null;
  @Input() rangeStartIso: string | null = null;
  @Input() rangeEndIso: string | null = null;
  @Input() rangeLabel: string | null = null;

  @Output() selectedDatesChange = new EventEmitter<string[]>();

  readonly monthNames = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
  ];

  readonly weekdayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  private readonly monthLabelFormatter = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
  });

  private readonly yearSignal = signal<number>(new Date().getFullYear());
  private readonly selected = signal<Set<string>>(new Set());
  private readonly allowed = signal<Set<string> | null>(null);
  private readonly accent = signal<Set<string>>(new Set());
  private readonly customRangeActive = signal(false);
  private readonly customRangeStart = signal<Date>(new Date(new Date().getFullYear(), 0, 1));
  private readonly customRangeEnd = signal<Date>(new Date(new Date().getFullYear(), 11, 31));
  private readonly customRangeLabel = signal<string>('');
  private lastSelectedDate: string | null = null;

  readonly selectedCount = computed(() => this.selected().size);
  readonly weekGroups = computed(() => {
    if (this.customRangeActive()) {
      return this.computeWeeksForRange(
        this.customRangeStart(),
        this.customRangeEnd(),
      );
    }
    return this.computeWeeksForYear(this.yearSignal());
  });
  readonly maxColumnCount = computed(() =>
    this.weekGroups().reduce((max, month) => Math.max(max, month.cells.length), 0),
  );
  readonly headerLabels = computed(() =>
    Array.from({ length: this.maxColumnCount() }, (_, index) =>
      this.weekdayNames[index % this.weekdayNames.length],
    ),
  );

  readonly emptyArrayCache = new Map<number, number[]>();

  ngOnChanges(changes: SimpleChanges): void {
    const rangeChanged =
      'rangeStartIso' in changes || 'rangeEndIso' in changes || 'rangeLabel' in changes;
    if (rangeChanged && this.rangeStartIso && this.rangeEndIso) {
      const start = this.parseIsoDate(this.rangeStartIso);
      const end = this.parseIsoDate(this.rangeEndIso);
      if (start && end && end >= start) {
        this.customRangeStart.set(start);
        this.customRangeEnd.set(end);
        this.customRangeLabel.set(this.rangeLabel ?? `${this.rangeStartIso} – ${this.rangeEndIso}`);
        this.customRangeActive.set(true);
      } else {
        this.customRangeActive.set(false);
      }
    } else if (rangeChanged) {
      this.customRangeActive.set(false);
    }

    if (!this.customRangeActive() && changes['year']) {
      const nextYear = this.normalizeYear(this.year);
      if (this.yearSignal() !== nextYear) {
        this.yearSignal.set(nextYear);
        this.lastSelectedDate = null;
      }
    }

    if (changes['selectedDates']) {
      const incoming = new Set(
        (this.selectedDates ?? []).map((date) => date.trim()).filter(Boolean),
      );
      this.selected.set(incoming);
    }
    if (changes['allowedDates']) {
      const allowedSet = this.allowedDates?.length
        ? new Set(this.allowedDates.map((date) => date.trim()).filter(Boolean))
        : null;
      this.allowed.set(allowedSet);
    }
    if (changes['accentDates']) {
      const accentSet = new Set(
        (this.accentDates ?? []).map((date) => date.trim()).filter(Boolean),
      );
      this.accent.set(accentSet);
    }
  }

  isSelected(date: string | null): boolean {
    if (!date) {
      return false;
    }
    return this.selected().has(date);
  }

  isDisabled(date: string | null): boolean {
    if (!date) {
      return true;
    }
    const allowed = this.allowed();
    if (!allowed) {
      return false;
    }
    return !allowed.has(date);
  }

  isAccent(date: string | null): boolean {
    if (!date) {
      return false;
    }
    return this.accent().has(date);
  }

  currentYear(): number {
    return this.yearSignal();
  }

  toggleCell(cell: CalendarCell, event: MouseEvent) {
    if (!cell.date || cell.kind !== 'day' || this.isDisabled(cell.date)) {
      return;
    }

    const additive = event.ctrlKey || event.metaKey;

    if (event.shiftKey && this.lastSelectedDate) {
      this.applyRangeSelection(this.lastSelectedDate, cell.date, additive);
    } else {
      this.toggleDate(cell.date, additive);
    }

    this.lastSelectedDate = cell.date;
  }

  clearSelection() {
    const next = new Set<string>();
    this.updateSelection(next);
    this.lastSelectedDate = null;
  }

  rangeHeaderLabel(): string {
    if (this.customRangeActive()) {
      return this.customRangeLabel();
    }
    return this.yearSignal().toString();
  }

  selectWorkdays() {
    const next = this.collectByPredicate((weekday) => weekday < 5, false);
    this.updateSelection(next);
  }

  selectWeekends() {
    const next = this.collectByPredicate((weekday) => weekday >= 5, false);
    this.updateSelection(next);
  }

  toggleWeekday(weekday: number) {
    const dates = this.datesForWeekday(weekday);
    if (!dates.length) {
      return;
    }
    const next = new Set(this.selected());
    const allowedDates = dates.filter((date) => !this.isDisabled(date));
    if (!allowedDates.length) {
      return;
    }
    const activate = !allowedDates.every((date) => next.has(date));
    if (activate) {
      allowedDates.forEach((date) => next.add(date));
    } else {
      allowedDates.forEach((date) => next.delete(date));
    }
    this.updateSelection(next);
  }

  weekdaySelected(weekday: number): boolean {
    const dates = this.datesForWeekday(weekday);
    if (!dates.length) {
      return false;
    }
    const selected = this.selected();
    const allowedDates = dates.filter((date) => !this.isDisabled(date));
    if (!allowedDates.length) {
      return false;
    }
    return allowedDates.every((date) => selected.has(date));
  }

  headerLabelsForRender(): string[] {
    return this.headerLabels();
  }

  extraColumns(count: number): number[] {
    if (count <= 0) {
      return [];
    }
    if (!this.emptyArrayCache.has(count)) {
      this.emptyArrayCache.set(count, Array.from({ length: count }, (_, index) => index));
    }
    return this.emptyArrayCache.get(count)!;
  }

  private updateSelection(next: Set<string>) {
    this.selected.set(next);
    this.emitSelection(next);
  }

  private toggleDate(date: string, additive: boolean) {
    if (this.isDisabled(date)) {
      return;
    }
    const next = new Set(this.selected());
    if (next.has(date) && !additive) {
      next.delete(date);
    } else {
      next.add(date);
    }
    this.updateSelection(next);
  }

  private applyRangeSelection(start: string, end: string, additive: boolean) {
    const [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
    const cursor = new Date(rangeStart);
    const target = new Date(rangeEnd);

    const base = additive ? new Set(this.selected()) : new Set<string>();
    if (additive) {
      this.selected().forEach((value) => base.add(value));
    }

    while (cursor <= target) {
      const date = this.formatDateString(cursor);
      if (!this.isDisabled(date)) {
        base.add(date);
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    this.updateSelection(base);
  }

  private collectByPredicate(predicate: (weekday: number) => boolean, additive: boolean): Set<string> {
    const { start, end } = this.rangeBounds();
    const cursor = new Date(start);
    const next = additive ? new Set(this.selected()) : new Set<string>();

    while (cursor <= end) {
      const weekday = (cursor.getDay() + 6) % 7;
      const formatted = this.formatDateString(cursor);
      if (predicate(weekday) && !this.isDisabled(formatted)) {
        next.add(formatted);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return next;
  }

  private datesForWeekday(weekday: number): string[] {
    const { start, end } = this.rangeBounds();
    const cursor = new Date(start);
    const result: string[] = [];
    while (cursor <= end) {
      const current = (cursor.getDay() + 6) % 7;
      if (current === weekday) {
        result.push(this.formatDateString(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }

  private emitSelection(set: Set<string>) {
    this.selectedDatesChange.emit(
      Array.from(set)
        .map((date) => date.trim())
        .filter(Boolean)
        .sort(),
    );
  }

  private computeWeeksForYear(year: number): CalendarMonthGroup[] {
    const months: CalendarMonthGroup[] = [];
    for (let month = 0; month < 12; month++) {
      months.push({
        label: `${this.monthNames[month]} ${year}`,
        cells: this.buildMonthCells(year, month),
      });
    }
    return months;
  }

  private computeWeeksForRange(start: Date, end: Date): CalendarMonthGroup[] {
    const months: CalendarMonthGroup[] = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const limit = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= limit) {
      months.push({
        label: this.monthLabelFormatter.format(cursor),
        cells: this.buildMonthCells(cursor.getFullYear(), cursor.getMonth()),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }

  private buildMonthCells(year: number, month: number): CalendarCell[] {
    const cells: CalendarCell[] = [];
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekCount = Math.ceil((offset + daysInMonth) / 7);
    const totalCells = weekCount * 7;

    for (let index = 0; index < totalCells; index++) {
      const dayNumber = index - offset + 1;
      if (index < offset) {
        cells.push({ date: null, label: '', weekday: null, kind: 'leading' });
      } else if (dayNumber > daysInMonth) {
        cells.push({ date: null, label: '', weekday: null, kind: 'trailing' });
      } else {
        const date = new Date(year, month, dayNumber);
        const iso = this.formatDateString(date);
        const weekday = (date.getDay() + 6) % 7;
        cells.push({
          date: iso,
          label: dayNumber.toString().padStart(2, '0'),
          weekday,
          kind: 'day',
        });
      }
    }

    let lastIndex = cells.length - 1;
    while (lastIndex >= 0 && cells[lastIndex].kind !== 'day') {
      lastIndex--;
    }
    return lastIndex >= 0 ? cells.slice(0, lastIndex + 1) : cells;
  }

  private formatDateString(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private normalizeYear(year: number | undefined | null): number {
    if (!year || Number.isNaN(year)) {
      return new Date().getFullYear();
    }
    return Math.min(2100, Math.max(1900, Math.trunc(year)));
  }

  private rangeBounds(): { start: Date; end: Date } {
    if (this.customRangeActive()) {
      return {
        start: new Date(this.customRangeStart()),
        end: new Date(this.customRangeEnd()),
      };
    }
    const year = this.yearSignal();
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31),
    };
  }

  private parseIsoDate(value: string): Date | null {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
