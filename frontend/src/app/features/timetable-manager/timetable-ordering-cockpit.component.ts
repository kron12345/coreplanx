import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import type {
  OrderingActionAvailabilityDto,
  OrderingProcessProfileId,
  TimetableOrderingCaseDto,
} from '../../core/api/timetable-ordering-api.types';
import { TimetableOrderingService } from '../../core/services/timetable-ordering.service';
import { TrainPlanService } from '../../core/services/train-plan.service';

interface OrderingPatchValue {
  pathRequestId: string;
  pathId: string;
  responsibleRu: string;
  trainNumber: string;
  originLocationCode: string;
  destinationLocationCode: string;
  rollingStockSegments: string;
  tttPhase: string;
  ttrPhase: string;
  annualRequestWindow: string;
  requestedDepartureTime: string;
}

@Component({
  selector: 'app-timetable-ordering-cockpit',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-ordering-cockpit.component.html',
  styleUrl: './timetable-ordering-cockpit.component.scss',
})
export class TimetableOrderingCockpitComponent {
  private readonly ordering = inject(TimetableOrderingService);
  private readonly trainPlans = inject(TrainPlanService);
  private readonly route = inject(ActivatedRoute);

  readonly searchControl = new FormControl('', { nonNullable: true });

  readonly createForm = new FormGroup({
    profileId: new FormControl<OrderingProcessProfileId>('annual_order', {
      nonNullable: true,
    }),
    title: new FormControl('', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    trainPlanId: new FormControl('', { nonNullable: true }),
    validFrom: new FormControl(this.todayIso(), { nonNullable: true }),
    validTo: new FormControl(this.addDaysIso(90), { nonNullable: true }),
    pathRequestId: new FormControl('', { nonNullable: true }),
    pathId: new FormControl('', { nonNullable: true }),
    responsibleRu: new FormControl('', { nonNullable: true }),
    trainNumber: new FormControl('', { nonNullable: true }),
    originLocationCode: new FormControl('', { nonNullable: true }),
    destinationLocationCode: new FormControl('', { nonNullable: true }),
    rollingStockSegments: new FormControl('', { nonNullable: true }),
    tttPhase: new FormControl('path_request', { nonNullable: true }),
    ttrPhase: new FormControl('annual_request', { nonNullable: true }),
    annualRequestWindow: new FormControl('', { nonNullable: true }),
    requestedDepartureTime: new FormControl('', { nonNullable: true }),
  });

  readonly patchForm = new FormGroup({
    pathRequestId: new FormControl('', { nonNullable: true }),
    pathId: new FormControl('', { nonNullable: true }),
    responsibleRu: new FormControl('', { nonNullable: true }),
    trainNumber: new FormControl('', { nonNullable: true }),
    originLocationCode: new FormControl('', { nonNullable: true }),
    destinationLocationCode: new FormControl('', { nonNullable: true }),
    rollingStockSegments: new FormControl('', { nonNullable: true }),
    tttPhase: new FormControl('', { nonNullable: true }),
    ttrPhase: new FormControl('', { nonNullable: true }),
    annualRequestWindow: new FormControl('', { nonNullable: true }),
    requestedDepartureTime: new FormControl('', { nonNullable: true }),
  });

  readonly loading = computed(() => this.ordering.loading());
  readonly error = computed(() => this.ordering.error());
  readonly profiles = computed(() => this.ordering.profiles());
  readonly cases = computed(() => this.ordering.cases());
  readonly selectedDetails = computed(() => this.ordering.selectedDetails());
  readonly selectedCase = computed(() => this.selectedDetails()?.case ?? null);
  readonly selectedCaseId = computed(() => this.ordering.selectedCaseId());
  readonly trainPlanOptions = computed(() => this.trainPlans.plans());

  readonly filteredCases = computed(() => {
    const term = this.searchControl.value.trim().toLowerCase();
    const entries = this.cases();
    if (!term) {
      return entries;
    }
    return entries.filter((entry) => {
      const haystack = `${entry.id} ${entry.title} ${entry.profileLabel} ${entry.currentState}`.toLowerCase();
      return haystack.includes(term);
    });
  });

  readonly requiredMissingCount = computed(() => {
    const active = this.selectedCase();
    if (!active) {
      return 0;
    }
    return active.requiredAttributes.filter((entry) => entry.missing).length;
  });

  readonly profileSpecificHint = computed(() => {
    const profileId = this.createForm.controls.profileId.value;
    if (profileId === 'annual_order') {
      return 'Jahresbestellung: annualRequestWindow pflegen.';
    }
    return 'Gelegenheitsverkehr: requestedDepartureTime pflegen.';
  });

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => {
        const caseId = params.get('caseId')?.trim();
        if (!caseId) {
          return;
        }
        void this.ordering.selectCase(caseId);
      });

    effect(() => {
      const active = this.selectedCase();
      if (!active) {
        return;
      }
      this.patchForm.setValue({
        pathRequestId: active.pathRequestId ?? '',
        pathId: active.pathId ?? '',
        responsibleRu: this.readString(active.providedAttributes, 'responsibleRu'),
        trainNumber: this.readString(active.providedAttributes, 'trainNumber'),
        originLocationCode: this.readString(active.providedAttributes, 'originLocationCode'),
        destinationLocationCode: this.readString(active.providedAttributes, 'destinationLocationCode'),
        rollingStockSegments: this.formatRollingStockSegments(active.providedAttributes),
        tttPhase: this.readString(active.providedAttributes, 'tttPhase'),
        ttrPhase: this.readString(active.providedAttributes, 'ttrPhase'),
        annualRequestWindow: this.readString(active.providedAttributes, 'annualRequestWindow'),
        requestedDepartureTime: this.readString(active.providedAttributes, 'requestedDepartureTime'),
      });
    });
  }

  async refreshData(): Promise<void> {
    await this.ordering.refreshProfiles();
    await this.ordering.refreshCases();
  }

  async selectCase(entry: TimetableOrderingCaseDto): Promise<void> {
    await this.ordering.selectCase(entry.id);
  }

  async createCase(): Promise<void> {
    const value = this.createForm.getRawValue();
    const title = value.title.trim();
    if (!title) {
      return;
    }
    const trainPlanId = value.trainPlanId.trim();
    const payload = {
      profileId: value.profileId,
      title,
      description: this.normalizeOptional(value.description),
      trainPlanId: trainPlanId || undefined,
      validFrom: value.validFrom,
      validTo: value.validTo,
      pathRequestId: this.normalizeOptional(value.pathRequestId),
      pathId: this.normalizeOptional(value.pathId),
      providedAttributes: this.buildProvidedAttributes(value),
    } as const;

    const details = await this.ordering.createCase(payload);
    if (!details) {
      return;
    }
    this.createForm.controls.title.setValue('');
  }

  async applyAction(action: OrderingActionAvailabilityDto): Promise<void> {
    if (action.blocked) {
      return;
    }
    const active = this.selectedCase();
    if (!active) {
      return;
    }
    const patch = this.buildPatchAttributes(this.patchForm.getRawValue());
    const payload: Record<string, unknown> = {};
    const patchValue = this.patchForm.getRawValue();
    const pathRequestId = this.normalizeOptional(patchValue.pathRequestId);
    const pathId = this.normalizeOptional(patchValue.pathId);
    if (pathRequestId) {
      payload['pathRequestId'] = pathRequestId;
    }
    if (pathId) {
      payload['pathId'] = pathId;
    }

    await this.ordering.applyAction(active.id, {
      actionId: action.id,
      source: 'cockpit',
      providedAttributesPatch: patch,
      payload: Object.keys(payload).length ? payload : undefined,
    });
  }

  actionReasonLabel(action: OrderingActionAvailabilityDto): string {
    if (!action.reasons.length) {
      return '';
    }
    return action.reasons.join(' | ');
  }

  stopEvent(event: Event): void {
    event.stopPropagation();
  }

  trackCase(_: number, entry: TimetableOrderingCaseDto): string {
    return entry.id;
  }

  trackAction(_: number, entry: OrderingActionAvailabilityDto): string {
    return entry.id;
  }

  private buildProvidedAttributes(value: {
    responsibleRu: string;
    trainNumber: string;
    originLocationCode: string;
    destinationLocationCode: string;
    rollingStockSegments: string;
    tttPhase: string;
    ttrPhase: string;
    annualRequestWindow: string;
    requestedDepartureTime: string;
  }): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    this.pushIfValue(result, 'responsibleRu', value.responsibleRu);
    this.pushIfValue(result, 'trainNumber', value.trainNumber);
    this.pushIfValue(result, 'originLocationCode', value.originLocationCode);
    this.pushIfValue(result, 'destinationLocationCode', value.destinationLocationCode);
    const rollingStockSegments = this.parseRollingStockSegments(value.rollingStockSegments);
    if (rollingStockSegments?.length) {
      result['rollingStock'] = { segments: rollingStockSegments };
    }
    this.pushIfValue(result, 'tttPhase', value.tttPhase);
    this.pushIfValue(result, 'ttrPhase', value.ttrPhase);
    this.pushIfValue(result, 'annualRequestWindow', value.annualRequestWindow);
    this.pushIfValue(result, 'requestedDepartureTime', value.requestedDepartureTime);
    return result;
  }

  private buildPatchAttributes(value: OrderingPatchValue): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    this.pushIfValue(result, 'responsibleRu', value.responsibleRu);
    this.pushIfValue(result, 'trainNumber', value.trainNumber);
    this.pushIfValue(result, 'originLocationCode', value.originLocationCode);
    this.pushIfValue(result, 'destinationLocationCode', value.destinationLocationCode);
    const rollingStockSegments = this.parseRollingStockSegments(
      value.rollingStockSegments,
    );
    if (rollingStockSegments?.length) {
      result['rollingStock'] = { segments: rollingStockSegments };
    }
    this.pushIfValue(result, 'tttPhase', value.tttPhase);
    this.pushIfValue(result, 'ttrPhase', value.ttrPhase);
    this.pushIfValue(result, 'annualRequestWindow', value.annualRequestWindow);
    this.pushIfValue(result, 'requestedDepartureTime', value.requestedDepartureTime);
    return result;
  }

  private pushIfValue(target: Record<string, unknown>, key: string, value: string): void {
    const normalized = this.normalizeOptional(value);
    if (normalized) {
      target[key] = normalized;
    }
  }

  private normalizeOptional(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    return trimmed;
  }

  private readString(source: Record<string, unknown>, key: string): string {
    const value = source[key];
    if (typeof value !== 'string') {
      return '';
    }
    return value;
  }

  private formatRollingStockSegments(source: Record<string, unknown>): string {
    const rollingStock = source['rollingStock'];
    if (!rollingStock || typeof rollingStock !== 'object' || Array.isArray(rollingStock)) {
      return '';
    }
    const segments = (rollingStock as Record<string, unknown>)['segments'];
    if (!Array.isArray(segments) || !segments.length) {
      return '';
    }
    try {
      return JSON.stringify(segments, null, 2);
    } catch {
      return '';
    }
  }

  private parseRollingStockSegments(
    raw: string,
  ): Array<Record<string, unknown>> | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const segments = parsed
          .map((entry, index) => {
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
              return entry as Record<string, unknown>;
            }
            if (typeof entry === 'string' && entry.trim()) {
              return {
                position: index + 1,
                vehicleTypeId: entry.trim(),
                count: 1,
              } as Record<string, unknown>;
            }
            return null;
          })
          .filter((entry): entry is Record<string, unknown> => !!entry);
        if (segments.length) {
          return segments;
        }
      }
    } catch {
      // Fallback to compact CSV-like input for quick cockpit usage.
    }

    const vehicleIds = trimmed
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (!vehicleIds.length) {
      return undefined;
    }
    return vehicleIds.map((vehicleTypeId, index) => ({
      position: index + 1,
      vehicleTypeId,
      count: 1,
    }));
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private addDaysIso(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }
}
