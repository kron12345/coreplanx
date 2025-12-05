import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { TemplateTimelineStoreService } from './template-timeline-store.service';
import { TemplatePeriod } from '../../core/api/timeline-api.types';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? trimmed.slice(0, 10) : null;
}

@Component({
  selector: 'app-planning-periods',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule, ReactiveFormsModule],
  templateUrl: './planning-periods.component.html',
  styleUrl: './planning-periods.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanningPeriodsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(TemplateTimelineStoreService);
  private readonly fb = inject(FormBuilder);
  private readonly timetableYearService = inject(TimetableYearService);

  readonly templateId = signal<string | null>(null);
  readonly selectedTemplate = computed(() => this.store.selectedTemplate());
  readonly templates = this.store.templates;
  private readonly defaultYear = this.timetableYearService.defaultYearBounds();
  readonly selectedYear = signal<TimetableYearBounds>(this.defaultYear);
  readonly yearOptions = computed(() => {
    const managed = this.timetableYearService.managedYearBounds();
    if (managed.length) {
      return managed;
    }
    const center = this.selectedYear().start;
    return this.timetableYearService.listYearsAround(center, 2, 2);
  });

  readonly periodForm = this.fb.group({
    start: ['', Validators.required],
    end: [''],
  });

  readonly specialDayForm = this.fb.group({
    date: ['', Validators.required],
  });

  constructor() {
    this.store.loadTemplates();
    this.route.queryParamMap.subscribe((params) => {
      const template = params.get('template');
      const dateParam = normalizeDate(params.get('date'));
      const specialParam = normalizeDate(params.get('special'));
      if (dateParam) {
        try {
          const year = this.timetableYearService.getYearBounds(dateParam);
          this.selectedYear.set(year);
          this.periodForm.patchValue(
            { start: dateParam, end: dateParam },
            { emitEvent: false, onlySelf: true },
          );
        } catch (error) {
          console.warn('[PlanningPeriods] Invalid date param', dateParam, error);
        }
      }
      if (specialParam) {
        this.specialDayForm.patchValue({ date: specialParam }, { emitEvent: false, onlySelf: true });
      }
      this.templateId.set(template);
      if (template) {
        this.store.selectTemplate(template);
      }
    });

    effect(
      () => {
        const year = this.selectedYear();
        const currentStart = this.periodForm.get('start')?.value;
        const currentEnd = this.periodForm.get('end')?.value;
        if (!currentStart && !currentEnd) {
          this.periodForm.patchValue(
            { start: year.startIso, end: year.endIso },
            { emitEvent: false, onlySelf: true },
          );
        }
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        const template = this.selectedTemplate();
        if (!template && this.templates().length > 0) {
          this.store.selectTemplate(this.templates()[0].id);
        }
      },
      { allowSignalWrites: true },
    );
  }

  onTemplateChange(templateId: string | null): void {
    this.store.selectTemplate(templateId || null);
  }

  periods(): TemplatePeriod[] {
    const yearPeriods = this.periodsForYear();
    if (yearPeriods.length) {
      return yearPeriods;
    }
    return [this.buildDefaultYearPeriod(this.selectedYear())];
  }

  specialDays(): string[] {
    const template = this.selectedTemplate();
    if (!template) {
      return [];
    }
    return [...(template.specialDays ?? [])].sort((a, b) => a.localeCompare(b));
  }

  addPeriod(): void {
    const value = this.periodForm.getRawValue();
    const startIso = normalizeDate(value.start);
    const endIso = normalizeDate(value.end);
    if (!startIso) {
      this.periodForm.markAllAsTouched();
      return;
    }
    const year = this.selectedYear();
    const withinStart = this.timetableYearService.isDateWithinYear(startIso, year);
    const withinEnd = this.timetableYearService.isDateWithinYear(endIso ?? startIso, year);
    if (!withinStart || !withinEnd) {
      console.warn(
        `[PlanningPeriods] Zeitraum liegt nicht im gewählten Fahrplanjahr ${year.label}`,
        { startIso, endIso },
      );
      this.periodForm.markAllAsTouched();
      return;
    }
    const current = this.periodsForYear();
    const newPeriod: TemplatePeriod = {
      id: `period-${Date.now().toString(36)}`,
      validFrom: startIso,
      validTo: endIso ?? year.endIso,
    };
    const next = [...current, newPeriod].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    this.saveTemplateForYear(next);
    this.periodForm.reset();
    this.periodForm.patchValue({ start: year.startIso, end: year.endIso });
  }

  removePeriod(id: string): void {
    if (this.isSyntheticDefault(id)) {
      return;
    }
    const next = this.periodsForYear().filter((period) => period.id !== id);
    this.saveTemplateForYear(next);
  }

  addSpecialDay(): void {
    const value = this.specialDayForm.getRawValue();
    const iso = normalizeDate(value.date);
    if (!iso) {
      this.specialDayForm.markAllAsTouched();
      return;
    }
    const next = Array.from(new Set([...this.specialDays(), iso])).sort((a, b) => a.localeCompare(b));
    this.saveTemplate({ specialDays: next });
    this.specialDayForm.reset();
  }

  removeSpecialDay(date: string): void {
    const next = this.specialDays().filter((entry) => entry !== date);
    this.saveTemplate({ specialDays: next });
  }

  onYearChange(label: string): void {
    if (!label) {
      this.selectedYear.set(this.defaultYear);
      return;
    }
    try {
      const year = this.timetableYearService.getYearByLabel(label);
      this.selectedYear.set(year);
      this.periodForm.patchValue(
        { start: year.startIso, end: year.endIso },
        { emitEvent: false, onlySelf: true },
      );
    } catch (error) {
      console.warn('[PlanningPeriods] Unbekanntes Fahrplanjahr', label, error);
      this.selectedYear.set(this.defaultYear);
      this.periodForm.patchValue(
        { start: this.defaultYear.startIso, end: this.defaultYear.endIso },
        { emitEvent: false, onlySelf: true },
      );
    }
  }

  private saveTemplate(patch: Partial<{ periods: TemplatePeriod[]; specialDays: string[] }>): void {
    const template = this.selectedTemplate();
    if (!template) {
      return;
    }
    this.store.updateTemplate({
      ...template,
      periods: patch.periods ?? template.periods,
      specialDays: patch.specialDays ?? template.specialDays,
    });
  }

  private periodsForYear(): TemplatePeriod[] {
    const template = this.selectedTemplate();
    if (!template?.periods?.length) {
      return [];
    }
    const year = this.selectedYear();
    return template.periods
      .filter((period) => this.timetableYearService.isDateWithinYear(period.validFrom, year))
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  }

  private buildDefaultYearPeriod(year: TimetableYearBounds): TemplatePeriod {
    return {
      id: `default-${year.label}`,
      validFrom: year.startIso,
      validTo: year.endIso,
    };
  }

  private saveTemplateForYear(updatedYearPeriods: TemplatePeriod[]): void {
    const template = this.selectedTemplate();
    if (!template) {
      return;
    }
    const year = this.selectedYear();
    const remaining = (template.periods ?? []).filter(
      (period) => !this.timetableYearService.isDateWithinYear(period.validFrom, year),
    );
    const next = [...remaining, ...updatedYearPeriods].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    this.saveTemplate({ periods: next });
  }

  private isSyntheticDefault(periodId: string): boolean {
    return periodId.startsWith('default-');
  }
}
