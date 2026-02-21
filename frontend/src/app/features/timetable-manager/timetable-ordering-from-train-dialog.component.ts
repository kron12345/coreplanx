import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { OrderingProcessProfileId } from '../../core/api/timetable-ordering-api.types';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import type { TimetableHubRecord } from '../../core/services/timetable-hub.service';
import type { Timetable } from '../../core/models/timetable.model';
import type { TimetableOrderingContext } from '../../core/models/timetable-ordering-context.model';

type RequiredOrderingKey =
  | 'otnOrNameInput'
  | 'reasonOfReference'
  | 'validityDate'
  | 'trainType'
  | 'trafficTypeCode'
  | 'serviceType'
  | 'debtorCode'
  | 'distributionList'
  | 'freeProcessingReason';

type RequiredOrderingStatus = {
  key: RequiredOrderingKey;
  label: string;
  value: string;
  present: boolean;
};

const REQUIRED_ORDERING_FIELDS: Array<{
  key: RequiredOrderingKey;
  label: string;
}> = [
  { key: 'otnOrNameInput', label: 'OTN/Name' },
  { key: 'reasonOfReference', label: 'ReasonOfReference' },
  { key: 'validityDate', label: 'Gültigkeit' },
  { key: 'trainType', label: 'TrainType' },
  { key: 'trafficTypeCode', label: 'TrafficTypeCode' },
  { key: 'serviceType', label: 'Fahrtyp' },
  { key: 'debtorCode', label: 'Debitorencode' },
  { key: 'distributionList', label: 'Distributionsliste' },
  { key: 'freeProcessingReason', label: 'Grund kostenlose Bearbeitung' },
];

export interface TimetableOrderingFromTrainDialogData {
  record: TimetableHubRecord;
  timetable: Timetable | null;
  orderingContext?: TimetableOrderingContext | null;
}

type TimetableOrderingFromTrainDialogBaseResult = {
  intent: 'create' | 'open_editor';
  pathRequestId: string;
  pathId?: string;
};

export type TimetableOrderingFromTrainDialogResult =
  | (TimetableOrderingFromTrainDialogBaseResult & {
      intent: 'create';
      profileId: OrderingProcessProfileId;
      title: string;
      description?: string;
      annualRequestWindow?: string;
      requestedDepartureTime?: string;
      tttPhase?: string;
      ttrPhase?: string;
    })
  | (TimetableOrderingFromTrainDialogBaseResult & {
      intent: 'open_editor';
    });

export interface TimetableOrderingFromTrainCreateResult {
  intent: 'create';
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

export interface TimetableOrderingFromTrainOpenEditorResult {
  intent: 'open_editor';
  pathRequestId: string;
  pathId?: string;
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
  readonly orderingRequiredStatus = computed<RequiredOrderingStatus[]>(() =>
    REQUIRED_ORDERING_FIELDS.map((field) => {
      const value = this.readOrderingRequiredValue(
        this.data.orderingContext ?? null,
        field.key,
      );
      return {
        key: field.key,
        label: field.label,
        value,
        present: value.length > 0,
      };
    }),
  );
  readonly missingOrderingRequiredStatus = computed(() =>
    this.orderingRequiredStatus().filter((item) => !item.present),
  );
  readonly missingOrderingRequiredSummary = computed(() =>
    this.missingOrderingRequiredStatus()
      .map((item) => item.label)
      .join(', '),
  );
  readonly orderingRequiredComplete = computed(
    () => this.missingOrderingRequiredStatus().length === 0,
  );
  readonly canOpenEditorForCompletion = computed(
    () => this.missingOrderingRequiredStatus().length > 0,
  );

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

    const result: TimetableOrderingFromTrainCreateResult = {
      intent: 'create',
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

  openEditorForCompletion(): void {
    const value = this.form.getRawValue();
    const pathRequestId =
      value.pathRequestId.trim() || this.defaultPathRequestId().trim();
    if (!pathRequestId) {
      return;
    }
    const result: TimetableOrderingFromTrainOpenEditorResult = {
      intent: 'open_editor',
      pathRequestId,
      pathId: this.normalizeOptional(value.pathId),
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

  private readOrderingRequiredValue(
    context: TimetableOrderingContext | null,
    key: RequiredOrderingKey,
  ): string {
    if (!context) {
      return '';
    }
    if (key === 'validityDate') {
      const dates = (context.validityDates ?? [])
        .map((entry) => entry?.trim())
        .filter((entry): entry is string => !!entry)
        .sort();
      if (dates.length > 1) {
        return `${dates.length} Tage (${dates[0]} – ${dates[dates.length - 1]})`;
      }
      if (dates.length === 1) {
        return dates[0];
      }
      return context.validityDate?.trim() ?? '';
    }
    const value = context[key];
    return typeof value === 'string' ? value.trim() : '';
  }
}
