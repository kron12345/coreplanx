import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, Input, computed, effect, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  TrafficPeriodService,
  TrafficPeriodSort,
} from '../../core/services/traffic-period.service';
import {
  TrafficPeriod,
  TrafficPeriodType,
  TrafficPeriodVariantType,
  TrafficPeriodVariantScope,
} from '../../core/models/traffic-period.model';
import { MatDialog } from '@angular/material/dialog';
import { TrafficPeriodEditorComponent } from './traffic-period-editor.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

interface SortOption {
  value: string;
  label: string;
}

interface TrafficPeriodGroup {
  key: string;
  label: string;
  tags: string[];
  items: TrafficPeriod[];
}

@Component({
  selector: 'app-traffic-period-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './traffic-period-list.component.html',
  styleUrl: './traffic-period-list.component.scss',
})
export class TrafficPeriodListComponent {
  private readonly service = inject(TrafficPeriodService);
  private readonly dialog = inject(MatDialog);
  private readonly document = inject(DOCUMENT);
  private readonly highlightPeriodId = signal<string | null>(null);
  private readonly groupedView = signal(true);
  private readonly expandedGroupKeys = signal<Set<string>>(new Set());

  readonly searchControl = new FormControl('', { nonNullable: true });

  readonly filters = computed(() => this.service.filters());
  readonly periods = computed(() => this.service.filteredPeriods());
  readonly sort = computed(() => this.service.sort());
  readonly tags = computed(() => this.service.tags());
  readonly groupedPeriodsView = computed(() => {
    const groups = new Map<string, TrafficPeriodGroup>();
    const ungrouped: TrafficPeriod[] = [];
    const periods = this.periods();

    periods.forEach((period) => {
      const groupInfo = this.resolveGroupInfo(period);
      if (!groupInfo) {
        ungrouped.push(period);
        return;
      }
      const existing = groups.get(groupInfo.key);
      if (existing) {
        existing.items.push(period);
      } else {
        groups.set(groupInfo.key, {
          key: groupInfo.key,
          label: groupInfo.label,
          tags: groupInfo.tags,
          items: [period],
        });
      }
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }),
    );
    const lookup = new Map<string, string>();
    sortedGroups.forEach((group) =>
      group.items.forEach((period) => lookup.set(period.id, group.key)),
    );

    return {
      groups: sortedGroups,
      ungrouped,
      lookup,
    };
  });

  readonly typeOptions: { value: TrafficPeriodType | 'all'; label: string }[] = [
    { value: 'all', label: 'Alle Arten' },
    { value: 'standard', label: 'Standard' },
    { value: 'special', label: 'Sonderverkehr' },
    { value: 'construction', label: 'Bauphase' },
  ];

  readonly sortOptions: SortOption[] = [
    { value: 'updatedAt:desc', label: 'Zuletzt aktualisiert' },
    { value: 'name:asc', label: 'Name A–Z' },
  ];

  private readonly typeLabelMap: Record<TrafficPeriodType, string> = {
    standard: 'Standard',
    special: 'Sonderverkehr',
    construction: 'Bauphase',
  };

  private readonly variantTypeLabels: Record<TrafficPeriodVariantType, string> = {
    series: 'Serie',
    special_day: 'Sondertag',
    block: 'Block/Sperre',
    replacement: 'Ersatztag',
  };

  private readonly appliesLabels: Record<TrafficPeriodVariantScope, string> = {
    commercial: 'Kommerziell',
    operational: 'Betrieb',
    both: 'Beide',
  };
  private readonly monthLabels = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  @Input()
  set highlightId(value: string | null) {
    this.highlightPeriodId.set(value);
    window.setTimeout(() => this.scrollToHighlightedPeriod(), 0);
  }

  constructor() {
    this.searchControl.setValue(this.filters().search, { emitEvent: false });

    this.searchControl.valueChanges
      .pipe(debounceTime(200), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.service.setFilters({ search: value }));

    effect(() => {
      const current = this.filters().search;
      if (this.searchControl.value !== current) {
        this.searchControl.setValue(current, { emitEvent: false });
      }
    });

    effect(() => {
      this.periods();
      window.setTimeout(() => this.scrollToHighlightedPeriod(), 0);
    });

    effect(() => {
      if (!this.groupedView()) {
        this.expandedGroupKeys.set(new Set());
      }
    });
  }

  onTypeChange(value: TrafficPeriodType | 'all') {
    this.service.setFilters({ type: value });
  }

  onTagChange(value: string | 'all') {
    this.service.setFilters({ tag: value });
  }

  onSortChange(value: string) {
    const [field, direction] = value.split(':') as [
      TrafficPeriodSort['field'],
      TrafficPeriodSort['direction'],
    ];
    this.service.setSort({ field, direction });
  }

  sortSelection(sort: TrafficPeriodSort): string {
    return `${sort.field}:${sort.direction}`;
  }

  trackByPeriodId(_: number, period: TrafficPeriod) {
    return period.id;
  }

  trackByRuleId(_: number, rule: TrafficPeriod['rules'][number]) {
    return rule.id;
  }

  periodElementId(id: string): string {
    return `traffic-period-${id}`;
  }

  private resolveGroupInfo(period: TrafficPeriod):
    | { key: string; label: string; tags: string[] }
    | null {
    const tags = period.tags ?? [];
    const archiveTag = tags.find((tag) => tag.startsWith('archive-group:'));
    const labelTag = tags.find((tag) => tag.startsWith('archive-label:'));
    const fallback = period.name;

    if (archiveTag) {
      const label = labelTag ? labelTag.slice('archive-label:'.length).trim() : fallback;
      return {
        key: archiveTag,
        label: label || fallback,
        tags,
      };
    }

    const railMlTag = tags.find((tag) => tag.startsWith('railml:'));
    if (railMlTag) {
      return {
        key: railMlTag,
        label: fallback,
        tags,
      };
    }

    if (period.timetableYearLabel) {
      return {
        key: `year:${period.timetableYearLabel}`,
        label: `Fahrplanjahr ${period.timetableYearLabel}`,
        tags,
      };
    }

    return null;
  }

  groupedViewEnabled(): boolean {
    return this.groupedView();
  }

  onGroupViewChange(checked: boolean) {
    this.groupedView.set(checked);
  }

  groupExpanded(key: string): boolean {
    return this.expandedGroupKeys().has(key);
  }

  onGroupExpanded(key: string) {
    this.expandedGroupKeys.update((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  onGroupCollapsed(key: string) {
    this.expandedGroupKeys.update((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  periodTypeLabel(type: TrafficPeriodType): string {
    return this.typeLabelMap[type] ?? type;
  }

  openCreateDialog() {
    const dialogRef = this.dialog.open(TrafficPeriodEditorComponent, {
      width: '95vw',
      maxWidth: '1200px',
      data: {
        defaultYear: new Date().getFullYear(),
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        if (result.periodId) {
          this.service.updatePeriod(result.periodId, result.payload);
        } else {
          this.service.createPeriod(result.payload);
        }
      }
    });
  }

  editPeriod(period: TrafficPeriod) {
    const firstRule = period.rules[0];
    const defaultYear = firstRule ? this.resolveYear(firstRule) : new Date().getFullYear();

    const dialogRef = this.dialog.open(TrafficPeriodEditorComponent, {
      width: '95vw',
      maxWidth: '1200px',
      data: {
        defaultYear,
        period,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result && result.periodId) {
        this.service.updatePeriod(result.periodId, result.payload);
      }
    });
  }

  deletePeriod(period: TrafficPeriod) {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: 'Referenzkalender löschen',
        message: `"${period.name}" dauerhaft entfernen?`,
        confirmLabel: 'Löschen',
        cancelLabel: 'Abbrechen',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.service.deletePeriod(period.id);
      }
    });
  }

  includesLabel(rule: TrafficPeriod['rules'][number]): string | null {
    return this.formatDateRanges(rule.includesDates);
  }

  excludesLabel(rule: TrafficPeriod['rules'][number]): string | null {
    return this.formatDateRanges(rule.excludesDates);
  }

  variantTypeLabel(rule: TrafficPeriod['rules'][number]): string | undefined {
    if (!rule.variantType) {
      return undefined;
    }
    return this.variantTypeLabels[rule.variantType];
  }

  appliesLabel(rule: TrafficPeriod['rules'][number]): string | undefined {
    if (!rule.appliesTo) {
      return undefined;
    }
    return this.appliesLabels[rule.appliesTo];
  }

  ruleTimeline(rule: TrafficPeriod['rules'][number]) {
    const ranges = this.buildDateRanges(rule.includesDates);
    if (!ranges.length) {
      return [];
    }

    const year = this.resolveYear(rule);
    const months = Array.from({ length: 12 }, (_, idx) => ({
      monthIndex: idx,
      label: this.monthLabels[idx],
      segments: [] as { start: number; end: number }[],
    }));

    for (const range of ranges) {
      let current = new Date(range.start.getTime());
      while (current <= range.end) {
        const month = current.getMonth();
        if (current.getFullYear() !== year || month < 0 || month > 11) {
          current = this.nextDay(current);
          continue;
        }
        const daysInMonth = this.daysInMonth(year, month);
        const startDay = current.getDate();
        const endDay =
          range.end.getFullYear() === year && range.end.getMonth() === month
            ? range.end.getDate()
            : daysInMonth;
        months[month].segments.push({ start: startDay, end: endDay });
        current = new Date(year, month, endDay + 1);
      }
    }

    return months
      .map((month) => ({
        monthIndex: month.monthIndex,
        label: month.label,
        gradient: this.createGradient(month.segments, year, month.monthIndex),
        tooltip: this.createTooltip(month.segments, year, month.monthIndex),
      }))
      .filter((entry) => entry.gradient !== null);
  }

  patternLabel(rule: TrafficPeriod['rules'][number]): string | null {
    if (!rule.daysBitmap) {
      return null;
    }
    const labels = this.weekdayLabelsForBitmap(rule.daysBitmap);
    if (!labels.length) {
      return null;
    }
    if (labels.length === 1 && labels[0] === 'Mo–So') {
      return null;
    }
    return labels.join(', ');
  }

  private buildDateRanges(dates?: string[] | null) {
    if (!dates?.length) {
      return [] as { start: Date; end: Date }[];
    }

    const sorted = [...dates]
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();

    if (!sorted.length) {
      return [] as { start: Date; end: Date }[];
    }

    const ranges: { start: Date; end: Date }[] = [];
    let start = this.parseDate(sorted[0]);
    let prev = start;

    for (let i = 1; i < sorted.length; i++) {
      const current = this.parseDate(sorted[i]);
      if (this.dayDiff(prev, current) > 1) {
        ranges.push({ start, end: prev });
        start = current;
      }
      prev = current;
    }
    ranges.push({ start, end: prev });
    return ranges;
  }

  private formatDateRanges(dates?: string[] | null, limit = 3): string | null {
    const ranges = this.buildDateRanges(dates);
    if (!ranges.length) {
      return null;
    }
    const formatted = ranges.map((range) => this.formatRange(range));
    const shown = formatted.slice(0, limit);
    const remainder = formatted.length - shown.length;
    return remainder > 0
      ? `${shown.join(', ')} (+${remainder})`
      : shown.join(', ');
  }

  private formatShortDate(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}.${month}.`;
  }

  private formatRange(range: { start: Date; end: Date }): string {
    const startStr = this.formatShortDate(range.start);
    const endStr = this.formatShortDate(range.end);
    return startStr === endStr ? startStr : `${startStr}–${endStr}`;
  }

  private scrollToHighlightedPeriod() {
    const highlight = this.highlightPeriodId();
    if (!highlight) {
      return;
    }
    if (this.groupedView()) {
      this.ensureGroupExpandedForPeriod(highlight);
    }
    window.setTimeout(() => {
      const element = this.document.getElementById(this.periodElementId(highlight));
      if (!element) {
        return;
      }
      this.highlightPeriodId.set(null);
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      element.classList.add('period-card--highlight');
      window.setTimeout(() => {
        element.classList.remove('period-card--highlight');
      }, 2000);
    }, 50);
  }

  private ensureGroupExpandedForPeriod(periodId: string) {
    const lookup = this.groupedPeriodsView().lookup;
    const key = lookup.get(periodId);
    if (key) {
      this.onGroupExpanded(key);
    }
  }

  private parseDate(iso: string): Date {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  private dayDiff(a: Date, b: Date): number {
    const diff = b.getTime() - a.getTime();
    return Math.round(diff / 86400000);
  }

  private resolveYear(rule: TrafficPeriod['rules'][number]): number {
    if (rule.validityStart) {
      return Number.parseInt(rule.validityStart.slice(0, 4), 10);
    }
    if (rule.includesDates?.length) {
      return Number.parseInt(rule.includesDates[0].slice(0, 4), 10);
    }
    return new Date().getFullYear();
  }

  private daysInMonth(year: number, monthIndex: number): number {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  private nextDay(date: Date): Date {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + 1);
    return next;
  }

  private createGradient(
    segments: { start: number; end: number }[],
    year: number,
    monthIndex: number,
  ): string | null {
    if (!segments.length) {
      return null;
    }

    const days = this.daysInMonth(year, monthIndex);
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const parts: string[] = [];
    let cursor = 0;

    for (const segment of sorted) {
      const startPercent = ((segment.start - 1) / days) * 100;
      const endPercent = (segment.end / days) * 100;
      if (startPercent > cursor) {
        parts.push(`var(--tp-inactive) ${cursor}% ${startPercent}%`);
      }
      parts.push(`var(--tp-active) ${startPercent}% ${endPercent}%`);
      cursor = endPercent;
    }
    if (cursor < 100) {
      parts.push(`var(--tp-inactive) ${cursor}% 100%`);
    }
    return `linear-gradient(90deg, ${parts.join(', ')})`;
  }

  private createTooltip(
    segments: { start: number; end: number }[],
    year: number,
    monthIndex: number,
  ): string {
    if (!segments.length) {
      return '';
    }
    const ranges = segments
      .map((segment) => {
        const start = new Date(year, monthIndex, segment.start);
        const end = new Date(year, monthIndex, segment.end);
        return this.formatRange({ start, end });
      })
      .join(', ');
    return `${this.monthLabels[monthIndex]}: ${ranges}`;
  }

  private weekdayLabelsForBitmap(bitmap: string): string[] {
    const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const segments: string[] = [];
    let start = -1;

    for (let i = 0; i < Math.min(bitmap.length, 7); i++) {
      const active = bitmap[i] === '1';
      if (active && start === -1) {
        start = i;
      }
      if ((!active || i === 6) && start !== -1) {
        const end = active && i === 6 ? i : i - 1;
        segments.push(this.rangeLabel(labels, start, end));
        start = -1;
      }
    }
    if (!segments.length && bitmap.includes('1')) {
      bitmap.split('').forEach((char, i) => {
        if (char === '1' && i < labels.length) {
          segments.push(labels[i]);
        }
      });
    }
    return segments;
  }

  private rangeLabel(labels: string[], start: number, end: number): string {
    if (start === end) {
      return labels[start];
    }
    if (start === 0 && end === 6) {
      return 'Mo–So';
    }
    return `${labels[start]}–${labels[end]}`;
  }
}
