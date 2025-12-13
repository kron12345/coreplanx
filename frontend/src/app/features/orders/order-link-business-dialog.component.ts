import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { BusinessService } from '../../core/services/business.service';
import { OrderService } from '../../core/services/order.service';
import { Order } from '../../core/models/order.model';
import { OrderItem } from '../../core/models/order-item.model';

export interface OrderLinkBusinessDialogData {
  order: Order;
  items: OrderItem[];
}

@Component({
    selector: 'app-order-link-business-dialog',
    imports: [CommonModule, MatDialogModule, ...MATERIAL_IMPORTS],
    templateUrl: './order-link-business-dialog.component.html',
    styleUrl: './order-link-business-dialog.component.scss'
})
export class OrderLinkBusinessDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<OrderLinkBusinessDialogComponent>);
  private readonly data = inject<OrderLinkBusinessDialogData>(MAT_DIALOG_DATA);
  private readonly businessService = inject(BusinessService);
  private readonly orderService = inject(OrderService);
  private readonly snackBar = inject(MatSnackBar);

  readonly searchTerm = signal('');
  readonly selectedBusinessId = signal<string | null>(null);
  readonly selectedItemIds = signal<Set<string>>(new Set());

  readonly businesses = computed(() => this.businessService.businesses());
  readonly filteredBusinesses = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    return this.businesses()
      .filter((business) => {
        if (!query) {
          return true;
        }
        return (
          business.title.toLowerCase().includes(query) ||
          business.id.toLowerCase().includes(query) ||
          business.assignment.name.toLowerCase().includes(query)
        );
      })
      .slice(0, 25);
  });

  readonly selectableItems = computed(() => this.data.items);

  trackBusiness(_: number, business: { id: string }): string {
    return business.id;
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  selectBusiness(id: string): void {
    this.selectedBusinessId.set(id);
    this.selectedItemIds.set(this.linkedItemsForBusiness(id));
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

  link(): void {
    const businessId = this.selectedBusinessId();
    if (!businessId) {
      return;
    }

    const desired = new Set(this.selectedItemIds());
    const currentlyLinked = this.linkedItemsForBusiness(businessId);
    const toLink = Array.from(desired).filter((id) => !currentlyLinked.has(id));
    const toUnlink = Array.from(currentlyLinked).filter((id) => !desired.has(id));

    toLink.forEach((itemId) => this.orderService.linkBusinessToItem(businessId, itemId));
    toUnlink.forEach((itemId) => this.orderService.unlinkBusinessFromItem(businessId, itemId));

    if (!toLink.length && !toUnlink.length) {
      this.snackBar.open('Keine Änderungen vorgenommen.', 'OK', { duration: 2000 });
      return;
    }

    const parts: string[] = [];
    if (toLink.length) {
      parts.push(`${toLink.length} Position${toLink.length === 1 ? '' : 'en'} verknüpft`);
    }
    if (toUnlink.length) {
      parts.push(`${toUnlink.length} Position${toUnlink.length === 1 ? '' : 'en'} gelöst`);
    }
    this.snackBar.open(`${parts.join(' · ')} (${businessId})`, 'OK', { duration: 2500 });
    this.dialogRef.close();
  }

  close(): void {
    this.dialogRef.close();
  }

  isLinkedToSelectedBusiness(item: OrderItem): boolean {
    const businessId = this.selectedBusinessId();
    if (!businessId) {
      return false;
    }
    return item.linkedBusinessIds?.includes(businessId) ?? false;
  }

  private linkedItemsForBusiness(id: string): Set<string> {
    return new Set(
      this.data.items
        .filter((item) => item.linkedBusinessIds?.includes(id))
        .map((item) => item.id),
    );
  }
}
