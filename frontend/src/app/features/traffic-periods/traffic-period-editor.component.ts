import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  TrafficPeriodCreatePayload,
  TrafficPeriodRulePayload,
} from '../../core/services/traffic-period.service';
import {
  TrafficPeriod,
  TrafficPeriodType,
  TrafficPeriodVariantType,
  TrafficPeriodVariantScope,
} from '../../core/models/traffic-period.model';
import { MatButtonModule } from '@angular/material/button';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import {
  CalendarModeGetter,
  RuleReadyChecker,
  TrafficPeriodEditorData,
  TrafficPeriodEditorResult,
  TrafficPeriodForm,
  TrafficPeriodRuleForm,
} from './traffic-period-editor.types';
import { TrafficPeriodGeneralFormComponent } from './traffic-period-general-form.component';
import { TrafficPeriodRulesSectionComponent } from './traffic-period-rules-section.component';

@Component({
  selector: 'app-traffic-period-editor',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ...MATERIAL_IMPORTS,
    MatButtonModule,
    TrafficPeriodGeneralFormComponent,
    TrafficPeriodRulesSectionComponent,
  ],
  templateUrl: './traffic-period-editor.component.html',
  styleUrl: './traffic-period-editor.component.scss',
})
export class TrafficPeriodEditorComponent {
  private readonly dialogRef = inject<
    MatDialogRef<TrafficPeriodEditorComponent, TrafficPeriodEditorResult | undefined>
  >(MatDialogRef);
  private readonly dialog = inject(MatDialog);
  private readonly data =
    inject<TrafficPeriodEditorData>(MAT_DIALOG_DATA, { optional: true }) ??
    ({ defaultYear: new Date().getFullYear() } as TrafficPeriodEditorData);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.group<TrafficPeriodForm>({
    name: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    type: this.fb.nonNullable.control<TrafficPeriodType>('standard'),
    description: this.fb.nonNullable.control(''),
    responsible: this.fb.nonNullable.control(''),
    tags: this.fb.nonNullable.control(''),
    defaultYear: this.fb.nonNullable.control(this.data.defaultYear, {
      validators: [Validators.required, Validators.min(1900), Validators.max(2100)],
    }),
    rules: this.fb.array<FormGroup<TrafficPeriodRuleForm>>([]),
  });

  readonly typeOptions: { value: TrafficPeriodType; label: string }[] = [
    { value: 'standard', label: 'Standard' },
    { value: 'special', label: 'Sonderverkehr' },
    { value: 'construction', label: 'Bauphase' },
  ];

  private readonly existingPeriod = this.data.period;
  readonly isEditMode = !!this.existingPeriod;
  private readonly ruleCalendarModes = signal<Map<number, 'include' | 'exclude'>>(
    new Map(),
  );
  readonly uiWarnings = signal<string[]>([]);

  readonly variantTypeOptions: { value: TrafficPeriodVariantType; label: string }[] = [
    { value: 'series', label: 'Serie' },
    { value: 'special_day', label: 'Sondertag' },
    { value: 'block', label: 'Block/Sperre' },
    { value: 'replacement', label: 'Ersatz' },
  ];

  readonly appliesOptions: { value: TrafficPeriodVariantScope; label: string }[] = [
    { value: 'commercial', label: 'Kommerziell' },
    { value: 'operational', label: 'Betrieb' },
    { value: 'both', label: 'Beides' },
  ];
  readonly calendarModeAccessor: CalendarModeGetter = (index) => this.calendarMode(index);
  readonly ruleReadyAccessor: RuleReadyChecker = (index) => this.ruleReady(index);

  constructor() {
    if (this.existingPeriod) {
      this.patchFromExisting(this.existingPeriod);
    } else {
      this.addRule({
        primary: true,
        name: `Kalender ${this.form.controls.defaultYear.value}`,
        year: this.form.controls.defaultYear.value ?? new Date().getFullYear(),
      });
    }

    this.form.controls.defaultYear.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((year) => {
        this.rulesArray.controls.forEach((rule) => {
          if (!rule.controls.selectedDates.value?.length) {
            rule.controls.year.setValue(year ?? new Date().getFullYear());
          }
        });
      });

    this.rulesArray.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.updateWarnings();
    });
  }

  get rulesArray(): FormArray<FormGroup<TrafficPeriodRuleForm>> {
    return this.form.controls.rules;
  }

  get primaryRuleIndex(): number {
    return this.rulesArray.controls.findIndex((ctrl) => ctrl.controls.primary.value);
  }

  get primaryRule(): FormGroup<TrafficPeriodRuleForm> | null {
    const idx = this.primaryRuleIndex;
    return idx >= 0 ? this.rulesArray.at(idx) : null;
  }

  primaryRuleReady(): boolean {
    const rule = this.primaryRule;
    return !!rule && this.effectiveSelectedDates(rule).length > 0;
  }

  ruleReady(index: number): boolean {
    const rule = this.rulesArray.at(index);
    return rule ? this.effectiveSelectedDates(rule).length > 0 : false;
  }

  canAddRule(): boolean {
    return this.primaryRuleReady();
  }

  addRule(initial?: Partial<TrafficPeriodRulePayload> & { selectedDates?: string[]; excludedDates?: string[] }) {
    const group = this.createRuleGroup(initial);
    this.rulesArray.push(group);
    const index = this.rulesArray.length - 1;
    if (initial?.primary) {
      this.setPrimaryRule(index);
    } else if (!this.rulesArray.controls.some((ctrl) => ctrl.controls.primary.value)) {
      group.controls.primary.setValue(true);
    }
    this.updateCalendarMode(index, 'include');
    this.updateWarnings();
  }

  removeRule(index: number) {
    if (this.rulesArray.length <= 1) {
      return;
    }
    const group = this.rulesArray.at(index);
    const wasPrimary = group.controls.primary.value;
    this.rulesArray.removeAt(index);
    this.reindexCalendarModes();
    if (wasPrimary && this.rulesArray.length) {
      this.rulesArray.at(0).controls.primary.setValue(true);
    }
    this.updateWarnings();
  }

  setPrimaryRule(index: number) {
    this.rulesArray.controls.forEach((ctrl, idx) => {
      ctrl.controls.primary.setValue(idx === index);
    });
    this.updateWarnings();
  }

  onRuleSelectedDatesChange(index: number, dates: string[]) {
    const rule = this.rulesArray.at(index);
    if (rule) {
      const previous = new Set(rule.controls.selectedDates.value ?? []);
      rule.controls.selectedDates.setValue(dates);
      rule.controls.selectedDates.markAsDirty();
      const added = dates.filter((date) => !previous.has(date));
      if (!rule.controls.primary.value && added.length) {
        this.handlePrimaryOverlap(added);
      }
    }
    this.updateWarnings();
  }

  onRuleExcludedDatesChange(index: number, dates: string[]) {
    const rule = this.rulesArray.at(index);
    if (rule) {
      rule.controls.excludedDates.setValue(dates);
      rule.controls.excludedDates.markAsDirty();
    }
    this.updateWarnings();
  }

  calendarMode(index: number): 'include' | 'exclude' {
    return this.ruleCalendarModes().get(index) ?? 'include';
  }

  setCalendarMode(index: number, mode: 'include' | 'exclude') {
    this.updateCalendarMode(index, mode);
  }

  private updateCalendarMode(index: number, mode: 'include' | 'exclude') {
    this.ruleCalendarModes.update((current) => {
      const next = new Map<number, 'include' | 'exclude'>(current);
      next.set(index, mode);
      return next;
    });
  }

  private reindexCalendarModes() {
    const next = new Map<number, 'include' | 'exclude'>();
    this.rulesArray.controls.forEach((_ctrl, idx) => {
      next.set(idx, 'include');
    });
    this.ruleCalendarModes.set(next);
  }

  private updateWarnings() {
    const warnings: string[] = [];
    if (this.primaryRuleIndex === -1) {
      warnings.push('Bitte markiere genau einen Hauptkalender.');
    }
    if (!this.primaryRuleReady()) {
      warnings.push('Der Hauptkalender benötigt ausgewählte Verkehrstage.');
    }
    const rules = this.rulesArray.controls;
    const seenDates = new Map<string, number>();
    rules.forEach((rule, idx) => {
      const effectiveDates = this.effectiveSelectedDates(rule);
      effectiveDates.forEach((date) => {
        const otherIdx = seenDates.get(date);
        if (otherIdx !== undefined && otherIdx !== idx) {
          warnings.push(`Kalender #${idx + 1} teilt sich den Tag ${date} mit Kalender #${otherIdx + 1}.`);
        } else {
          seenDates.set(date, idx);
        }
      });
      if (effectiveDates.length === 0) {
        warnings.push(`Kalender #${idx + 1} hat keine Verkehrstage.`);
      }
    });
    this.uiWarnings.set(Array.from(new Set(warnings)));
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }

    const value = this.form.getRawValue();
    const rulesPayload: TrafficPeriodRulePayload[] = this.rulesArray.controls.map((group, index) => ({
      id: group.controls.id.value ?? undefined,
      name: group.controls.name.value?.trim() || `Kalender ${index + 1}`,
      year: group.controls.year.value ?? value.defaultYear,
      selectedDates: group.controls.selectedDates.value ?? [],
      excludedDates: group.controls.excludedDates.value ?? [],
      variantType: group.controls.variantType.value ?? 'series',
      appliesTo: group.controls.appliesTo.value ?? 'both',
      variantNumber: this.normalizeVariantNumber(group.controls.variantNumber.value),
      reason: group.controls.reason.value?.trim() || undefined,
      primary: group.controls.primary.value ?? false,
    }));

    if (!rulesPayload.length || rulesPayload.some((rule) => !rule.selectedDates.length)) {
      return;
    }

    if (!rulesPayload.some((rule) => rule.primary)) {
      rulesPayload[0].primary = true;
    }

    const payload: TrafficPeriodCreatePayload = {
      name: value.name!,
      type: value.type,
      description: value.description ?? undefined,
      responsible: value.responsible ?? undefined,
      tags: this.parseTags(value.tags),
      year: value.defaultYear,
      rules: rulesPayload,
    };

    const result: TrafficPeriodEditorResult = {
      periodId: this.existingPeriod?.id,
      payload,
    };

    this.dialogRef.close(result);
  }

  private parseTags(value: string | null | undefined): string[] | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    return tags.length ? Array.from(new Set(tags)) : undefined;
  }

  private patchFromExisting(period: TrafficPeriod) {
    const firstRuleYear = period.rules[0]?.validityStart
      ? Number.parseInt(period.rules[0].validityStart.slice(0, 4), 10)
      : this.data.defaultYear;

    this.form.patchValue(
      {
        name: period.name,
        type: period.type,
        description: period.description ?? '',
        responsible: period.responsible ?? '',
        tags: period.tags?.join(', ') ?? '',
        defaultYear: firstRuleYear,
      },
      { emitEvent: false },
    );

    period.rules.forEach((rule, index) => {
      const year = rule.validityStart
        ? Number.parseInt(rule.validityStart.slice(0, 4), 10)
        : this.form.controls.defaultYear.value ?? this.data.defaultYear;
      this.addRule({
        id: rule.id,
        name: rule.name,
        year,
        variantType: rule.variantType ?? 'series',
        appliesTo: rule.appliesTo ?? 'both',
        variantNumber: rule.variantNumber ?? '00',
        reason: rule.reason,
        selectedDates: rule.includesDates ?? [],
        excludedDates: rule.excludesDates ?? [],
        primary: rule.primary ?? index === 0,
      });
    });

    if (!this.rulesArray.length) {
      this.addRule({ primary: true, name: `Kalender ${this.form.controls.defaultYear.value}` });
    }
  }

  private createRuleGroup(
    initial?: Partial<TrafficPeriodRulePayload> & { selectedDates?: string[]; excludedDates?: string[] },
  ): FormGroup<TrafficPeriodRuleForm> {
    return this.fb.group<TrafficPeriodRuleForm>({
      id: this.fb.control(initial?.id ?? null),
      name: this.fb.nonNullable.control(initial?.name ?? '', { validators: [Validators.required] }),
      year: this.fb.nonNullable.control(
        initial?.year ?? this.form.controls.defaultYear.value ?? this.data.defaultYear,
        { validators: [Validators.required, Validators.min(1900), Validators.max(2100)] },
      ),
      variantType: this.fb.nonNullable.control(initial?.variantType ?? 'series'),
      appliesTo: this.fb.nonNullable.control(initial?.appliesTo ?? 'both'),
      variantNumber: this.fb.nonNullable.control(initial?.variantNumber ?? '00', {
        validators: [Validators.required, Validators.maxLength(8)],
      }),
      reason: this.fb.nonNullable.control(initial?.reason ?? ''),
      primary: this.fb.nonNullable.control(initial?.primary ?? false),
      selectedDates: this.fb.nonNullable.control(initial?.selectedDates ?? [], {
        validators: [Validators.required],
      }),
      excludedDates: this.fb.nonNullable.control(initial?.excludedDates ?? []),
    });
  }

  private normalizeVariantNumber(value: string | null | undefined): string {
    const trimmed = value?.trim();
    if (!trimmed) {
      return '00';
    }
    return trimmed.toUpperCase();
  }

  private handlePrimaryOverlap(newDates: string[]) {
    const primary = this.primaryRule;
    if (!primary) {
      return;
    }
    const primaryDates = new Set(this.effectiveSelectedDates(primary));
    const overlap = newDates.filter((date) => primaryDates.has(date));
    if (!overlap.length) {
      return;
    }
    const preview = overlap.slice(0, 5).join(', ');
    const message =
      overlap.length > 5
        ? `${overlap.length} Tage überschneiden sich mit dem Hauptkalender (z. B. ${preview}). Sollen diese als Ausschlüsse übernommen werden?`
        : `Folgende Tage überschneiden sich mit dem Hauptkalender: ${preview}. Sollen diese als Ausschlüsse übernommen werden?`;
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: 'Tage als Ausschlüsse übernehmen?',
          message,
          confirmLabel: 'Ja, ausschließen',
          cancelLabel: 'Nein',
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) {
          this.moveDatesToPrimaryExclusions(overlap);
        }
      });
  }

  private moveDatesToPrimaryExclusions(dates: string[]) {
    const primary = this.primaryRule;
    if (!primary) {
      return;
    }
    const selected = new Set(primary.controls.selectedDates.value ?? []);
    const excluded = new Set(primary.controls.excludedDates.value ?? []);
    dates.forEach((date) => {
      excluded.add(date);
    });
    primary.controls.selectedDates.setValue(Array.from(selected));
    primary.controls.excludedDates.setValue(Array.from(excluded));
    this.updateWarnings();
  }

  private effectiveSelectedDates(rule: FormGroup<TrafficPeriodRuleForm>): string[] {
    const selected = rule.controls.selectedDates.value ?? [];
    const exclusions = new Set(rule.controls.excludedDates.value ?? []);
    return selected.filter((date) => !exclusions.has(date));
  }
}
