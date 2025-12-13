import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { OrderItemOption } from '../../core/services/order.service';
import { OrderItem } from '../../core/models/order-item.model';

@Component({
    selector: 'app-order-item-picker',
    imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS],
    templateUrl: './order-item-picker.component.html',
    styleUrl: './order-item-picker.component.scss'
})
export class OrderItemPickerComponent {
  private readonly optionSignal = signal<OrderItemOption[]>([]);
  private readonly selectedIdsSignal = signal<Set<string>>(new Set());
  private preferredOrderIdValue: string | null = null;
  private preferredTypeValue: OrderItem['type'] | null = null;

  readonly search = signal('');
  readonly typeFilter = signal<'all' | OrderItem['type']>('all');
  readonly orderFilter = signal<'all' | string>('all');
  readonly sortField = signal<'order' | 'name' | 'type' | 'start'>('order');

  @Input()
  set options(value: OrderItemOption[] | null | undefined) {
    this.optionSignal.set(value ? [...value] : []);
    this.applyPreferredFilters();
  }

  @Input()
  set selectedIds(value: string[] | ReadonlyArray<string> | null | undefined) {
    this.selectedIdsSignal.set(new Set(value ?? []));
  }

  @Input()
  set preferredOrderId(value: string | null | undefined) {
    this.preferredOrderIdValue = value ?? null;
    this.applyPreferredFilters();
  }

  @Input()
  set preferredType(value: OrderItem['type'] | null | undefined) {
    this.preferredTypeValue = value ?? null;
    this.applyPreferredFilters();
  }

  get preferredOrderId(): string | null {
    return this.preferredOrderIdValue;
  }

  get preferredType(): OrderItem['type'] | null {
    return this.preferredTypeValue;
  }

  @Output()
  readonly selectionChange = new EventEmitter<string[]>();

  readonly preferredOrderLabel = computed(() => {
    if (!this.preferredOrderId) {
      return null;
    }
    return (
      this.optionSignal().find((option) => option.orderId === this.preferredOrderId)?.orderName ??
      this.preferredOrderId
    );
  });

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
    }).sort((a, b) => this.sortOptions(a, b, this.sortField()));
  });

  readonly selectedCount = computed(() => this.selectedIdsSignal().size);
  readonly selectedOptions = computed(() => {
    const map = new Map(this.optionSignal().map((option) => [option.itemId, option]));
    return Array.from(this.selectedIdsSignal())
      .map((id) => map.get(id))
      .filter((option): option is OrderItemOption => !!option);
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

  updateSort(value: 'order' | 'name' | 'type' | 'start') {
    this.sortField.set(value);
  }

  toggleSelection(itemId: string) {
    this.selectedIdsSignal.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
    this.selectionChange.emit(Array.from(this.selectedIdsSignal()));
  }

  clearSelection() {
    if (!this.selectedIdsSignal().size) {
      return;
    }
    this.selectedIdsSignal.set(new Set());
    this.selectionChange.emit([]);
  }

  isSelected(itemId: string): boolean {
    return this.selectedIdsSignal().has(itemId);
  }

  selectionLabel(option: OrderItemOption): string {
    return `${option.orderName} · ${option.itemName}`;
  }

  private applyPreferredFilters() {
    const options = this.optionSignal();
    if (
      this.orderFilter() === 'all' &&
      this.preferredOrderId &&
      options.some((o) => o.orderId === this.preferredOrderId)
    ) {
      this.orderFilter.set(this.preferredOrderId);
    }
    if (
      this.typeFilter() === 'all' &&
      this.preferredType &&
      options.some((o) => o.type === this.preferredType)
    ) {
      this.typeFilter.set(this.preferredType);
    }
  }

  private sortOptions(
    a: OrderItemOption,
    b: OrderItemOption,
    field: 'order' | 'name' | 'type' | 'start',
  ): number {
    switch (field) {
      case 'name':
        return a.itemName.localeCompare(b.itemName, 'de', { sensitivity: 'base' });
      case 'type':
        return a.type.localeCompare(b.type, 'de', { sensitivity: 'base' }) || a.itemName.localeCompare(b.itemName, 'de', { sensitivity: 'base' });
      case 'start': {
        const aStart = a.start ?? '';
        const bStart = b.start ?? '';
        if (aStart && bStart) {
          const diff = aStart.localeCompare(bStart);
          if (diff !== 0) {
            return diff;
          }
        } else if (aStart || bStart) {
          return aStart ? -1 : 1;
        }
        return a.itemName.localeCompare(b.itemName, 'de', { sensitivity: 'base' });
      }
      case 'order':
      default:
        return (
          a.orderName.localeCompare(b.orderName, 'de', { sensitivity: 'base' }) ||
          a.itemName.localeCompare(b.itemName, 'de', { sensitivity: 'base' })
        );
    }
  }
}
