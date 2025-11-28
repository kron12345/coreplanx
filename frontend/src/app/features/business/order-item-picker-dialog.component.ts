import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { OrderItemOption } from '../../core/services/order.service';
import { OrderItem } from '../../core/models/order-item.model';

export interface OrderItemPickerDialogData {
  options: OrderItemOption[];
  selectedIds: string[];
}

@Component({
  selector: 'app-order-item-picker-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './order-item-picker-dialog.component.html',
  styleUrl: './order-item-picker-dialog.component.scss',
})
export class OrderItemPickerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<OrderItemPickerDialogComponent>);
  private readonly data = inject<OrderItemPickerDialogData>(MAT_DIALOG_DATA);

  readonly search = signal('');
  readonly typeFilter = signal<'all' | OrderItem['type']>('all');
  readonly orderFilter = signal<'all' | string>('all');
  readonly selectedIds = signal<Set<string>>(new Set(this.data.selectedIds));
  readonly optionSignal = signal<OrderItemOption[]>([...this.data.options]);

  readonly typeOptions = computed(() =>
    Array.from(
      new Set<OrderItem['type']>(this.optionSignal().map((option) => option.type)),
    ).sort(),
  );

  readonly orderOptions = computed(() =>
    Array.from(
      this.optionSignal().reduce((map, option) => map.set(option.orderId, option.orderName), new Map<string, string>()),
    ).map(([id, name]) => ({ id, name })),
  );

  readonly filteredOptions = computed(() => {
    const term = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const orderId = this.orderFilter();

    return this.optionSignal().filter((option) => {
      if (term) {
        const haystack = `${option.orderName} ${option.itemName} ${option.serviceType ?? ''}`.toLowerCase();
        if (!haystack.includes(term)) {
          return false;
        }
      }
      if (type !== 'all' && option.type !== type) {
        return false;
      }
      if (orderId !== 'all' && option.orderId !== orderId) {
        return false;
      }
      return true;
    });
  });

  updateSearch(value: string) {
    this.search.set(value ?? '');
  }

  updateType(value: 'all' | OrderItem['type']) {
    this.typeFilter.set(value);
  }

  updateOrder(value: 'all' | string) {
    this.orderFilter.set(value);
  }

  toggleSelection(itemId: string) {
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  isSelected(itemId: string): boolean {
    return this.selectedIds().has(itemId);
  }

  selectionLabel(option: OrderItemOption): string {
    return `${option.orderName} · ${option.itemName}`;
  }

  apply() {
    this.dialogRef.close(Array.from(this.selectedIds()));
  }

  cancel() {
    this.dialogRef.close();
  }
}
