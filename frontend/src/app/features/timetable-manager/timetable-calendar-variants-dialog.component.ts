import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  TimetableCalendarVariant,
  TimetableCalendarVariantType,
} from '../../core/models/timetable.model';
import { Timetable } from '../../core/models/timetable.model';

interface TimetableCalendarVariantsDialogData {
  variants: TimetableCalendarVariant[];
  calendar: Timetable['calendar'];
}

@Component({
  selector: 'app-timetable-calendar-variants-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-calendar-variants-dialog.component.html',
  styleUrl: './timetable-calendar-variants-dialog.component.scss',
})
export class TimetableCalendarVariantsDialogComponent {
  private readonly dialogRef =
    inject<
      MatDialogRef<
        TimetableCalendarVariantsDialogComponent,
        TimetableCalendarVariant[] | null
      >
    >(MatDialogRef);
  private readonly data = inject<TimetableCalendarVariantsDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  protected readonly typeOptions: { value: TimetableCalendarVariantType; label: string }[] = [
    { value: 'series', label: 'Serie' },
    { value: 'special_day', label: 'Sondertag' },
    { value: 'block', label: 'Sperrtag' },
    { value: 'replacement', label: 'Ersatztag' },
  ];

  protected readonly appliesOptions = [
    { value: 'commercial', label: 'Kommerziell' },
    { value: 'operational', label: 'Betrieblich' },
    { value: 'both', label: 'Beide' },
  ];

  protected readonly daysOfWeekOptions = [
    { value: 'MO', label: 'Montag' },
    { value: 'DI', label: 'Dienstag' },
    { value: 'MI', label: 'Mittwoch' },
    { value: 'DO', label: 'Donnerstag' },
    { value: 'FR', label: 'Freitag' },
    { value: 'SA', label: 'Samstag' },
    { value: 'SO', label: 'Sonntag' },
  ];

  protected readonly form = this.fb.group({
    variants: this.fb.array<FormGroup>([]),
  });

  constructor() {
    const variants = this.data.variants?.length
      ? this.data.variants
      : [
          {
            id: `var-${Date.now()}`,
            type: 'series' as const,
            description: 'Neue Serie',
            validFrom: this.data.calendar.validFrom,
            validTo: this.data.calendar.validTo,
            daysOfWeek: ['MO', 'DI', 'MI', 'DO', 'FR'],
            appliesTo: 'both' as const,
          },
        ];
    variants.forEach((variant) => this.variants.push(this.createGroup(variant)));
  }

  protected get variants(): FormArray<FormGroup> {
    return this.form.get('variants') as FormArray<FormGroup>;
  }

  protected addVariant(afterIndex?: number): void {
    const group = this.createGroup({
      id: `var-${Date.now()}`,
      type: 'series',
      description: '',
      validFrom: this.data.calendar.validFrom,
      validTo: this.data.calendar.validTo,
      appliesTo: 'both' as const,
    });
    if (afterIndex === undefined || afterIndex < 0 || afterIndex >= this.variants.length) {
      this.variants.push(group);
    } else {
      this.variants.insert(afterIndex + 1, group);
    }
  }

  protected removeVariant(index: number): void {
    if (index < 0 || index >= this.variants.length) {
      return;
    }
    this.variants.removeAt(index);
  }

  protected moveVariant(index: number, delta: number): void {
    const target = index + delta;
    if (index < 0 || target < 0 || index >= this.variants.length || target >= this.variants.length) {
      return;
    }
    const entry = this.variants.at(index);
    this.variants.removeAt(index);
    this.variants.insert(target, entry);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const result = this.variants.controls.map((group) => {
      const value = group.getRawValue();
      const normalizedDates = this.toStringArray(value.dates);
      const normalizedDays = Array.isArray(value.daysOfWeek) ? value.daysOfWeek : [];

      return {
        id: value.id || `var-${Date.now()}`,
        type: value.type,
        description: String(value.description ?? '').trim(),
        validFrom: value.validFrom || undefined,
        validTo: value.validTo || undefined,
        daysOfWeek: normalizedDays.length ? normalizedDays : undefined,
        dates: normalizedDates.length ? normalizedDates : undefined,
        appliesTo: value.appliesTo ?? 'both',
        reason: value.reason ? String(value.reason).trim() : undefined,
      } as TimetableCalendarVariant;
    });

    this.dialogRef.close(result);
  }

  private createGroup(variant: Partial<TimetableCalendarVariant>): FormGroup {
    return this.fb.group({
      id: this.fb.nonNullable.control(variant.id ?? `var-${Date.now()}`),
      type: this.fb.nonNullable.control<TimetableCalendarVariantType>(
        variant.type ?? 'series',
        Validators.required,
      ),
      description: this.fb.nonNullable.control(variant.description ?? '', Validators.required),
      validFrom: this.fb.control(variant.validFrom ?? ''),
      validTo: this.fb.control(variant.validTo ?? ''),
      daysOfWeek: this.fb.control<string[]>(variant.daysOfWeek ?? []),
      dates: this.fb.control(
        Array.isArray(variant.dates) ? variant.dates.join(', ') : variant.dates ?? '',
      ),
      appliesTo: this.fb.control<'commercial' | 'operational' | 'both'>(
        variant.appliesTo ?? 'both',
      ),
      reason: this.fb.control(variant.reason ?? ''),
    });
  }

  private toStringArray(input: unknown): string[] {
    if (!input) {
      return [];
    }
    if (Array.isArray(input)) {
      return input.map((item) => String(item).trim()).filter((item) => item.length > 0);
    }
    return String(input)
      .split(/[\n,;]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
}
