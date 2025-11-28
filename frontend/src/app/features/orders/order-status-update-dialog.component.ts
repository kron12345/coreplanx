import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { Order } from '../../core/models/order.model';
import { OrderItem, InternalProcessingStatus } from '../../core/models/order-item.model';
import { TimetablePhase } from '../../core/models/timetable.model';
import { OrderService } from '../../core/services/order.service';

export interface OrderStatusUpdateDialogData {
  order: Order;
  items: OrderItem[];
}

@Component({
  selector: 'app-order-status-update-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, ...MATERIAL_IMPORTS],
  templateUrl: './order-status-update-dialog.component.html',
  styleUrl: './order-status-update-dialog.component.scss',
})
export class OrderStatusUpdateDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<OrderStatusUpdateDialogComponent>);
  readonly data = inject<OrderStatusUpdateDialogData>(MAT_DIALOG_DATA);
  private readonly orderService = inject(OrderService);
  private readonly snackBar = inject(MatSnackBar);

  readonly selectedPhase = signal<TimetablePhase>('bedarf');
  readonly selectedItemIds = signal<Set<string>>(new Set(this.data.items.map((item) => item.id)));
  readonly selectedInternalStatus = signal<InternalProcessingStatus | null>(null);
  readonly phaseOptions: { value: TimetablePhase; label: string; icon: string }[] = [
    { value: 'bedarf', label: 'Draft', icon: 'lightbulb' },
    { value: 'path_request', label: 'Path Request', icon: 'directions_subway' },
    { value: 'offer', label: 'Offered', icon: 'description' },
    { value: 'contract', label: 'Booked', icon: 'assignment_turned_in' },
    { value: 'operational', label: 'Used', icon: 'play_circle' },
    { value: 'archived', label: 'Cancelled', icon: 'inventory_2' },
  ];
  readonly internalStatusOptions: { value: InternalProcessingStatus; label: string; hint: string }[] = [
    { value: 'in_bearbeitung', label: 'In Bearbeitung', hint: 'Position ist in Arbeit.' },
    { value: 'freigegeben', label: 'Freigegeben', hint: 'An nächste Stelle/Team übergeben.' },
    { value: 'ueberarbeiten', label: 'Überarbeiten', hint: 'Zurück an vorherige Stelle.' },
    { value: 'uebermittelt', label: 'Übermittelt', hint: 'Path Request ist technisch gesendet.' },
    { value: 'beantragt', label: 'Beantragt', hint: 'Request ist bestätigt, Entscheid PIM offen.' },
    { value: 'abgeschlossen', label: 'Abgeschlossen', hint: 'Fachlich abgeschlossen.' },
    { value: 'annulliert', label: 'Annulliert', hint: 'Bestellung wurde storniert.' },
  ];

  constructor() {
    const firstPhase = this.data.items.find((item) => item.timetablePhase)?.timetablePhase;
    if (firstPhase) {
      this.selectedPhase.set(firstPhase);
    }
  }

  selectPhase(phase: TimetablePhase): void {
    this.selectedPhase.set(phase);
  }

  selectInternalStatus(status: InternalProcessingStatus | null): void {
    this.selectedInternalStatus.set(status);
  }

  toggleItem(itemId: string): void {
    this.selectedItemIds.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  save(): void {
    const phase = this.selectedPhase();
    const internalStatus = this.selectedInternalStatus();
    const items = Array.from(this.selectedItemIds());
    if (!items.length) {
      return;
    }

    if (internalStatus === 'freigegeben' || internalStatus === 'ueberarbeiten') {
      const missingBusiness = this.data.items.filter(
        (item) =>
          items.includes(item.id) &&
          (!item.linkedBusinessIds || item.linkedBusinessIds.length === 0),
      );
      if (missingBusiness.length) {
        this.snackBar.open(
          `${missingBusiness.length} Position${
            missingBusiness.length === 1 ? '' : 'en'
          } ohne verknüpftes Geschäft. Bitte zuerst ein Geschäft zuweisen.`,
          'OK',
          { duration: 3500 },
        );
        return;
      }
    }

    items.forEach((itemId) => {
      this.orderService.setItemTimetablePhase(itemId, phase);
      if (internalStatus) {
        this.orderService.setItemInternalStatus(itemId, internalStatus);
      }
    });
    const phaseLabel = this.labelForPhase(phase);
    const statusLabel = internalStatus
      ? this.internalStatusOptions.find((s) => s.value === internalStatus)?.label ?? internalStatus
      : null;
    const messageParts = [`Fahrplanstatus auf ${phaseLabel}`];
    if (statusLabel) {
      messageParts.push(`Bearbeitungsstatus auf ${statusLabel}`);
    }
    this.snackBar.open(
      `${items.length} Position${items.length === 1 ? '' : 'en'} aktualisiert (${messageParts.join(
        ' · ',
      )}).`,
      'OK',
      { duration: 3000 },
    );
    this.dialogRef.close();
  }

  close(): void {
    this.dialogRef.close();
  }

  labelForPhase(phase: TimetablePhase): string {
    const option = this.phaseOptions.find((entry) => entry.value === phase);
    return option?.label ?? phase;
  }
}
