import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
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
import { TimetableAuditEntry } from '../../core/models/timetable.model';

export interface TimetableAuditDialogData {
  defaultActor: string;
}

export interface TimetableAuditDialogResult {
  actor: string;
  action: string;
  notes?: string;
  relatedEntity?: TimetableAuditEntry['relatedEntity'];
}

@Component({
  selector: 'app-timetable-audit-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-audit-dialog.component.html',
  styleUrl: './timetable-audit-dialog.component.scss',
})
export class TimetableAuditDialogComponent {
  private readonly dialogRef =
    inject<
      MatDialogRef<TimetableAuditDialogComponent, TimetableAuditDialogResult | undefined>
    >(MatDialogRef);
  private readonly data = inject<TimetableAuditDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  protected readonly entityOptions: { value: TimetableAuditEntry['relatedEntity']; label: string }[] =
    [
      { value: 'calendar', label: 'Kalender' },
      { value: 'rolling_stock', label: 'Fahrzeuge' },
      { value: 'operations', label: 'Betrieb' },
      { value: 'milestone', label: 'Meilensteine' },
      { value: 'responsibility', label: 'Aufgaben' },
      { value: 'other', label: 'Allgemein' },
    ];

  protected readonly form: FormGroup = this.fb.group({
    actor: this.fb.nonNullable.control(this.data.defaultActor ?? '', Validators.required),
    action: this.fb.nonNullable.control('', Validators.required),
    relatedEntity: this.fb.control<TimetableAuditEntry['relatedEntity']>('other'),
    notes: this.fb.control(''),
  });

  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.dialogRef.close({
      actor: String(value.actor ?? '').trim(),
      action: String(value.action ?? '').trim(),
      notes: value.notes ? String(value.notes).trim() : undefined,
      relatedEntity: value.relatedEntity ?? 'other',
    });
  }
}
