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
import { TimetableResponsibility } from '../../core/models/timetable.model';

interface TimetableResponsibilitiesDialogData {
  responsibilities: TimetableResponsibility[];
  responsibleRu: string;
}

@Component({
  selector: 'app-timetable-responsibilities-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-responsibilities-dialog.component.html',
  styleUrl: './timetable-responsibilities-dialog.component.scss',
})
export class TimetableResponsibilitiesDialogComponent {
  private readonly dialogRef =
    inject<
      MatDialogRef<
        TimetableResponsibilitiesDialogComponent,
        TimetableResponsibility[] | null
      >
    >(MatDialogRef);
  private readonly data = inject<TimetableResponsibilitiesDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  protected readonly scopeOptions = [
    { value: 'calendar', label: 'Kalender' },
    { value: 'rolling_stock', label: 'Fahrzeuge' },
    { value: 'operations', label: 'Betrieb' },
    { value: 'commercial', label: 'Kommerziell' },
    { value: 'integration', label: 'Integration' },
  ] as const;

  protected readonly statusOptions = [
    { value: 'open', label: 'Offen' },
    { value: 'in_progress', label: 'In Arbeit' },
    { value: 'completed', label: 'Abgeschlossen' },
  ] as const;

  protected readonly form = this.fb.group({
    responsibilities: this.fb.array<FormGroup>([]),
  });

  constructor() {
    const items = this.data.responsibilities?.length
      ? this.data.responsibilities
      : [
          {
            id: `resp-${Date.now()}`,
            role: 'Kalenderpflege',
            assignee: this.data.responsibleRu,
            scope: 'calendar' as const,
            status: 'open' as const,
          },
        ];
    items.forEach((resp) => this.responsibilities.push(this.createGroup(resp)));
  }

  protected get responsibilities(): FormArray<FormGroup> {
    return this.form.get('responsibilities') as FormArray<FormGroup>;
  }

  protected addResponsibility(afterIndex?: number): void {
    const group = this.createGroup({
      id: `resp-${Date.now()}`,
      role: '',
      assignee: this.data.responsibleRu,
      scope: 'calendar',
      status: 'open',
    });
    if (
      afterIndex === undefined ||
      afterIndex < 0 ||
      afterIndex >= this.responsibilities.length
    ) {
      this.responsibilities.push(group);
    } else {
      this.responsibilities.insert(afterIndex + 1, group);
    }
  }

  protected removeResponsibility(index: number): void {
    if (index < 0 || index >= this.responsibilities.length) {
      return;
    }
    this.responsibilities.removeAt(index);
  }

  protected moveResponsibility(index: number, delta: number): void {
    const target = index + delta;
    if (
      index < 0 ||
      target < 0 ||
      index >= this.responsibilities.length ||
      target >= this.responsibilities.length
    ) {
      return;
    }
    const entry = this.responsibilities.at(index);
    this.responsibilities.removeAt(index);
    this.responsibilities.insert(target, entry);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const result = this.responsibilities.controls.map((group) => {
      const value = group.getRawValue();
      return {
        id: value.id || `resp-${Date.now()}`,
        role: String(value.role ?? '').trim(),
        assignee: String(value.assignee ?? '').trim(),
        contact: value.contact ? String(value.contact).trim() : undefined,
        scope: value.scope,
        status: value.status ?? undefined,
        dueDate: value.dueDate || undefined,
        notes: value.notes ? String(value.notes).trim() : undefined,
      } as TimetableResponsibility;
    });
    this.dialogRef.close(result);
  }

  private createGroup(responsibility: Partial<TimetableResponsibility>): FormGroup {
    return this.fb.group({
      id: this.fb.nonNullable.control(responsibility.id ?? `resp-${Date.now()}`),
      role: this.fb.nonNullable.control(responsibility.role ?? '', Validators.required),
      assignee: this.fb.nonNullable.control(responsibility.assignee ?? '', Validators.required),
      contact: this.fb.control(responsibility.contact ?? ''),
      scope: this.fb.nonNullable.control<TimetableResponsibility['scope']>(
        responsibility.scope ?? 'calendar',
        Validators.required,
      ),
      status: this.fb.control<TimetableResponsibility['status']>(
        responsibility.status ?? 'open',
      ),
      dueDate: this.fb.control(responsibility.dueDate ?? ''),
      notes: this.fb.control(responsibility.notes ?? ''),
    });
  }
}

