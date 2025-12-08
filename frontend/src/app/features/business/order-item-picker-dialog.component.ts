import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { OrderItemOption } from '../../core/services/order.service';
import { OrderItemPickerComponent } from './order-item-picker.component';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';

export interface OrderItemPickerDialogData {
  options: OrderItemOption[];
  selectedIds: string[];
}

@Component({
  selector: 'app-order-item-picker-dialog',
  standalone: true,
  imports: [CommonModule, OrderItemPickerComponent, ...MATERIAL_IMPORTS],
  templateUrl: './order-item-picker-dialog.component.html',
  styleUrl: './order-item-picker-dialog.component.scss',
})
export class OrderItemPickerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<OrderItemPickerDialogComponent>);
  private readonly data = inject<OrderItemPickerDialogData>(MAT_DIALOG_DATA);

  readonly selectedIds = signal<string[]>([...this.data.selectedIds]);
  readonly options = computed(() => this.data.options);

  onSelectionChange(ids: string[]) {
    this.selectedIds.set(ids);
  }

  apply() {
    this.dialogRef.close(this.selectedIds());
  }

  cancel() {
    this.dialogRef.close();
  }
}
