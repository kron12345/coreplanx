import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { OrderingProcessProfileId } from '../../core/api/timetable-ordering-api.types';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import type { TimetableHubRecord } from '../../core/services/timetable-hub.service';
import type { Timetable } from '../../core/models/timetable.model';

export interface TimetableOrderingFromTrainDialogData {
  record: TimetableHubRecord;
  timetable: Timetable | null;
}

export interface TimetableOrderingFromTrainDialogResult {
  profileId: OrderingProcessProfileId;
  title: string;
  description?: string;
  pathRequestId: string;
  pathId?: string;
  annualRequestWindow?: string;
  requestedDepartureTime?: string;
  tttPhase?: string;
  ttrPhase?: string;
}

@Component({
  selector: 'app-timetable-ordering-from-train-dialog',
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-ordering-from-train-dialog.component.html',
  styleUrl: './timetable-ordering-from-train-dialog.component.scss',
})
export class TimetableOrderingFromTrainDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<
      TimetableOrderingFromTrainDialogComponent,
      TimetableOrderingFromTrainDialogResult | undefined
    >,
  );
  readonly data = inject<TimetableOrderingFromTrainDialogData>(MAT_DIALOG_DATA);

  readonly profileOptions: Array<{ id: OrderingProcessProfileId; label: string }> = [
    { id: 'annual_order', label: 'Jahresbestellung' },
    { id: 'occasional_traffic', label: 'Gelegenheitsverkehr' },
  ];

  readonly form = new FormGroup({
    profileId: new FormControl<OrderingProcessProfileId>('annual_order', {
      nonNullable: true,
    }),
    title: new FormControl(this.defaultTitle(), { nonNullable: true }),
    description: new FormControl(this.defaultDescription(), { nonNullable: true }),
    pathRequestId: new FormControl(this.defaultPathRequestId(), { nonNullable: true }),
    pathId: new FormControl('', { nonNullable: true }),
    annualRequestWindow: new FormControl(this.defaultAnnualWindow(), {
      nonNullable: true,
    }),
    requestedDepartureTime: new FormControl(this.defaultRequestedDepartureTime(), {
      nonNullable: true,
    }),
    tttPhase: new FormControl(this.defaultTttPhase(), { nonNullable: true }),
    ttrPhase: new FormControl(this.defaultTtrPhase('annual_order'), {
      nonNullable: true,
    }),
  });

  readonly selectedProfile = computed(() => this.form.controls.profileId.value);
  readonly validityLabel = computed(() => {
    const calendar = this.data.timetable?.calendar;
    if (calendar?.validFrom) {
      const end = calendar.validTo ?? calendar.validFrom;
      return `${calendar.validFrom} – ${end}`;
    }
    const days = this.data.record.calendarDays;
    if (!days.length) {
      return 'nicht verfügbar';
    }
    return `${days[0]} – ${days[days.length - 1] ?? days[0]}`;
  });

  cancel(): void {
    this.dialogRef.close(undefined);
  }

  submit(): void {
    const value = this.form.getRawValue();
    const title = value.title.trim();
    const pathRequestId = value.pathRequestId.trim();
    if (!title || !pathRequestId) {
      return;
    }

    if (value.profileId === 'annual_order' && !value.annualRequestWindow.trim()) {
      return;
    }
    if (
      value.profileId === 'occasional_traffic' &&
      !value.requestedDepartureTime.trim()
    ) {
      return;
    }

    const result: TimetableOrderingFromTrainDialogResult = {
      profileId: value.profileId,
      title,
      description: this.normalizeOptional(value.description),
      pathRequestId,
      pathId: this.normalizeOptional(value.pathId),
      annualRequestWindow:
        value.profileId === 'annual_order'
          ? this.normalizeOptional(value.annualRequestWindow)
          : undefined,
      requestedDepartureTime:
        value.profileId === 'occasional_traffic'
          ? this.normalizeOptional(value.requestedDepartureTime)
          : undefined,
      tttPhase: this.normalizeOptional(value.tttPhase),
      ttrPhase:
        this.normalizeOptional(value.ttrPhase) ??
        this.defaultTtrPhase(value.profileId),
    };
    this.dialogRef.close(result);
  }

  private defaultTitle(): string {
    return `${this.data.record.trainNumber} · ${this.data.record.title}`;
  }

  private defaultDescription(): string {
    return `Bestellfall aus Fahrplan ${this.data.record.refTrainId}`;
  }

  private defaultPathRequestId(): string {
    const existing = this.data.timetable?.source.pathRequestId?.trim();
    if (existing) {
      return existing;
    }
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
    return `PR-${this.data.record.refTrainId}-${stamp}`;
  }

  private defaultAnnualWindow(): string {
    return `AW-${this.data.record.timetableYearLabel}`;
  }

  private defaultRequestedDepartureTime(): string {
    const timetable = this.data.timetable;
    if (!timetable?.stops?.length) {
      return '';
    }
    const origin =
      timetable.stops.find((stop) => stop.type === 'origin') ?? timetable.stops[0];
    const sourceTime =
      origin?.commercial.departureTime ??
      origin?.commercial.arrivalTime ??
      origin?.operational.departureTime ??
      origin?.operational.arrivalTime;
    if (!sourceTime) {
      return '';
    }
    if (!sourceTime.includes('T')) {
      return sourceTime.slice(0, 5);
    }
    const parsed = new Date(sourceTime);
    if (Number.isNaN(parsed.getTime())) {
      return sourceTime.slice(11, 16);
    }
    return parsed.toISOString().slice(11, 16);
  }

  private defaultTttPhase(): string {
    return this.data.timetable?.status ?? 'path_request';
  }

  private defaultTtrPhase(profileId: OrderingProcessProfileId): string {
    return profileId === 'annual_order' ? 'annual_request' : 'short_term';
  }

  private normalizeOptional(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }
}
