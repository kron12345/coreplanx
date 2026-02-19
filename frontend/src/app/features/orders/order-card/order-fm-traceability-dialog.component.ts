import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import {
  OrderApiService,
  OrderTraceabilityCaseDetailsDto,
} from '../../../core/api/order-api.service';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';

export interface OrderFmTraceabilityDialogData {
  orderId: string;
  caseId: string;
}

@Component({
  selector: 'app-order-fm-traceability-dialog',
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  templateUrl: './order-fm-traceability-dialog.component.html',
  styleUrl: './order-fm-traceability-dialog.component.scss',
})
export class OrderFmTraceabilityDialogComponent {
  private readonly api = inject(OrderApiService);
  private readonly dialogRef = inject(
    MatDialogRef<OrderFmTraceabilityDialogComponent>,
  );
  private readonly data = inject<OrderFmTraceabilityDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly details = signal<OrderTraceabilityCaseDetailsDto | null>(null);

  readonly hasInitialLoad = computed(() => !!this.details() || !!this.error());

  constructor() {
    void this.load(false);
  }

  close(): void {
    this.dialogRef.close();
  }

  async reload(): Promise<void> {
    await this.load(true);
  }

  trackMessage(
    _: number,
    message: NonNullable<OrderTraceabilityCaseDetailsDto['messages']>[number],
  ): string {
    return message.id;
  }

  trackTransition(
    _: number,
    transition: NonNullable<OrderTraceabilityCaseDetailsDto['transitions']>[number],
  ): string {
    return transition.id;
  }

  trackContext(
    _: number,
    context: NonNullable<OrderTraceabilityCaseDetailsDto['operationalContexts']>[number],
  ): string {
    return `${context.caseId}:${context.timetableYearLabel}:${context.validFrom}:${context.validTo}`;
  }

  formatDateTime(isoValue: string): string {
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) {
      return isoValue;
    }
    return parsed.toISOString().replace('T', ' ').slice(0, 16);
  }

  private async load(force: boolean): Promise<void> {
    if (this.loading() && !force) {
      return;
    }
    this.loading.set(true);
    try {
      const details = await firstValueFrom(
        this.api.getOrderTraceabilityCaseDetails(this.data.orderId, this.data.caseId),
      );
      this.details.set(details ?? null);
      this.error.set(null);
    } catch (error) {
      console.warn('[OrderFmTraceabilityDialog] Failed to load case details', error);
      this.details.set(null);
      this.error.set('Traceability-Details konnten nicht geladen werden.');
    } finally {
      this.loading.set(false);
    }
  }
}
