import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { TimetableStop } from '../../core/models/timetable.model';
import { UpdateOperationalTimingPayload } from '../../core/services/timetable.service';

export interface TimetableOperationalDialogData {
  stop: TimetableStop;
}

@Component({
  selector: 'app-timetable-operational-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-operational-dialog.component.html',
  styleUrl: './timetable-operational-dialog.component.scss',
})
export class TimetableOperationalDialogComponent {
  private readonly dialogRef = inject<
    MatDialogRef<
      TimetableOperationalDialogComponent,
      UpdateOperationalTimingPayload | undefined
    >
  >(MatDialogRef);
  private readonly data = inject<TimetableOperationalDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  readonly stop = this.data.stop;

  readonly form: FormGroup = this.fb.group({
    arrivalTime: [this.stop.operational.arrivalTime ?? ''],
    arrivalOffsetDays: [
      this.stop.operational.arrivalOffsetDays?.toString() ?? '',
    ],
    departureTime: [this.stop.operational.departureTime ?? ''],
    departureOffsetDays: [
      this.stop.operational.departureOffsetDays?.toString() ?? '',
    ],
    dwellMinutes: [this.stop.operational.dwellMinutes?.toString() ?? ''],
    remarks: [this.stop.operational.remarks ?? ''],
  });

  cancel() {
    this.dialogRef.close();
  }

  submit() {
    const raw = this.form.value;
    const payload: UpdateOperationalTimingPayload = {
      stopId: this.stop.id,
      arrivalTime: this.normalizeString(raw['arrivalTime']),
      departureTime: this.normalizeString(raw['departureTime']),
      arrivalOffsetDays: this.toNumber(raw['arrivalOffsetDays']),
      departureOffsetDays: this.toNumber(raw['departureOffsetDays']),
      dwellMinutes: this.toNumber(raw['dwellMinutes']),
      remarks: this.normalizeString(raw['remarks']),
    };
    this.dialogRef.close(payload);
  }

  private normalizeString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private toNumber(value: unknown): number | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed.length) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
}
