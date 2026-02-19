import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import type { ApplyTimetableOrderingSimulatorPayload } from '../../core/api/timetable-ordering-api.types';
import { TimetableOrderingService } from '../../core/services/timetable-ordering.service';

@Component({
  selector: 'app-timetable-ordering-simulator',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-ordering-simulator.component.html',
  styleUrl: './timetable-ordering-simulator.component.scss',
})
export class TimetableOrderingSimulatorComponent {
  private readonly ordering = inject(TimetableOrderingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly caseControl = new FormControl('', { nonNullable: true });
  readonly responseControl = new FormControl<ApplyTimetableOrderingSimulatorPayload['response']>(
    'receipt',
    { nonNullable: true },
  );
  readonly payloadControl = new FormControl('', { nonNullable: true });

  readonly cases = computed(() => this.ordering.cases());
  readonly selectedCase = computed(() => this.ordering.selectedCase());
  readonly selectedDetails = computed(() => this.ordering.selectedDetails());
  readonly loading = computed(() => this.ordering.loading());
  readonly error = computed(() => this.ordering.error());

  readonly responses: Array<{
    id: ApplyTimetableOrderingSimulatorPayload['response'];
    label: string;
    hint: string;
  }> = [
    { id: 'receipt', label: 'Receipt', hint: 'Empfangsbestätigung' },
    { id: 'draft_offer', label: 'Draft Offer', hint: 'Entwurfsangebot' },
    { id: 'final_offer', label: 'Final Offer', hint: 'Finales Angebot' },
    { id: 'final_offer_changed', label: 'Final Offer (Changed)', hint: 'Geändertes Angebot' },
    { id: 'booked', label: 'Booked', hint: 'Buchungsbestätigung' },
    { id: 'not_available', label: 'Not Available', hint: 'Kein Pfad verfügbar' },
    { id: 'withdrawn', label: 'Withdrawn', hint: 'Rückzug durch IM' },
    { id: 'error', label: 'Error', hint: 'Fehlermeldung' },
  ];

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const caseId = params.get('caseId')?.trim();
      if (!caseId) {
        return;
      }
      this.caseControl.setValue(caseId, { emitEvent: false });
      void this.ordering.selectCase(caseId);
    });

    this.caseControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((caseId) => {
      const trimmed = caseId.trim();
      if (!trimmed) {
        return;
      }
      void this.ordering.selectCase(trimmed);
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { caseId: trimmed },
        queryParamsHandling: 'merge',
      });
    });
  }

  async refreshData(): Promise<void> {
    await this.ordering.refreshCases();
    const selected = this.ordering.selectedCaseId();
    if (selected) {
      this.caseControl.setValue(selected, { emitEvent: false });
    }
  }

  async applyResponse(
    response: ApplyTimetableOrderingSimulatorPayload['response'] = this.responseControl.value,
  ): Promise<void> {
    const caseId = this.caseControl.value.trim();
    if (!caseId) {
      return;
    }

    const payloadText = this.payloadControl.value.trim();
    let payloadObject: Record<string, unknown> | undefined;
    if (payloadText) {
      try {
        const parsed = JSON.parse(payloadText) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payloadObject = parsed as Record<string, unknown>;
        }
      } catch {
        payloadObject = { rawPayload: payloadText };
      }
    }

    await this.ordering.applySimulator(caseId, {
      response,
      payload: payloadObject,
    });
  }

  async quickApply(response: ApplyTimetableOrderingSimulatorPayload['response']): Promise<void> {
    this.responseControl.setValue(response);
    await this.applyResponse(response);
  }
}
