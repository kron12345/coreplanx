import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  CreateOrderPayload,
  OrderService,
} from '../../core/services/order.service';
import { CustomerService } from '../../core/services/customer.service';
import { Customer } from '../../core/models/customer.model';
import { TimetableYearService } from '../../core/services/timetable-year.service';

@Component({
  selector: 'app-order-create-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './order-create-dialog.component.html',
  styleUrl: './order-create-dialog.component.scss',
})
export class OrderCreateDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<OrderCreateDialogComponent>);
  private readonly orderService = inject(OrderService);
  private readonly customerService = inject(CustomerService);
  private readonly timetableYearService = inject(TimetableYearService);
  private readonly defaultTimetableYear = this.timetableYearService.defaultYearBounds();

  readonly fieldDescriptions = {
    id: 'Optionale manuelle Kennung. Leer lassen, wenn das System eine ID vergeben soll.',
    name: 'Pflichtfeld. Der Name erscheint in der Auftragsübersicht.',
    customerId: 'Verknüpft den Auftrag mit einem gepflegten Kunden inklusive Projektdaten und Kontakten.',
    customer: 'Nur verwenden, wenn kein Kunde ausgewählt wurde oder ein individueller Anzeigename nötig ist.',
    tags: 'Kommagetrennte Schlagwörter, damit der Auftrag leichter gefiltert werden kann.',
    comment: 'Interne Hinweise oder Zusatzinformationen zum Auftrag.',
    timetableYearLabel: 'Fahrplanjahr, in dem der Auftrag läuft. Auftragspositionen dürfen dieses Jahr nicht verlassen.',
  } as const;

  readonly form = this.fb.group({
    id: [''],
    name: ['', Validators.required],
    customerId: [''],
    customer: [''],
    tags: [''],
    comment: [''],
    timetableYearLabel: [this.defaultTimetableYear.label, Validators.required],
  });

  readonly customers = this.customerService.customers;
  get timetableYearOptions() {
    return this.timetableYearService.listYearsAround(new Date(), 3, 3);
  }

  cancel() {
    this.dialogRef.close();
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const payload: CreateOrderPayload = {
      id: value.id?.trim() || undefined,
      name: value.name!,
      customerId: value.customerId?.trim() || undefined,
      customer: value.customer?.trim() || undefined,
      tags: this.parseTags(value.tags),
      comment: value.comment?.trim() || undefined,
      timetableYearLabel: value.timetableYearLabel ?? undefined,
    };

    const order = this.orderService.createOrder(payload);
    this.dialogRef.close(order);
  }

  private parseTags(value: string | null | undefined): string[] | undefined {
    if (!value?.trim()) {
      return undefined;
    }
    const tags = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    return tags.length ? Array.from(new Set(tags)) : undefined;
  }

  selectedCustomer(): Customer | undefined {
    const id = this.form.controls.customerId.value;
    return this.customerService.getById(id ?? undefined);
  }
}
