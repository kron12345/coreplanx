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

  readonly periodForm = this.fb.group({
    start: ['', Validators.required],
  });

  readonly specialDayForm = this.fb.group({
    date: ['', Validators.required],
  });

  constructor() {
    this.store.loadTemplates();
    this.route.queryParamMap.subscribe((params) => {
      const template = params.get('template');
      this.templateId.set(template);
      if (template) {
        this.store.selectTemplate(template);
      }
    });

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
    const template = this.selectedTemplate();
    if (template?.periods?.length) {
      return [...template.periods].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    }
    const year = this.defaultYear;
    if (!year) {
      return [];
    }
    return [
      {
        id: 'default-year',
        validFrom: year.startIso,
        validTo: year.endIso,
      },
    ];
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
    if (!startIso) {
      this.periodForm.markAllAsTouched();
      return;
    }
    const current = this.periods();
    const newPeriod: TemplatePeriod = {
      id: `period-${Date.now().toString(36)}`,
      validFrom: startIso,
      validTo: null,
    };
    const next = [...current, newPeriod].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    this.saveTemplate({ periods: next });
    this.periodForm.reset();
  }

  removePeriod(id: string): void {
    const next = this.periods().filter((period) => period.id !== id);
    this.saveTemplate({ periods: next });
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
}
