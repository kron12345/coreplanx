import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  MasterDataCategoryConfig,
  MasterDataHierarchyConfig,
} from '../../master-data.types';
import { MasterDataCategoryComponent } from '../master-data-category/master-data-category.component';

@Component({
  selector: 'app-master-data-hierarchy-section',
  standalone: true,
  imports: [CommonModule, MatIconModule, MasterDataCategoryComponent],
  templateUrl: './master-data-hierarchy-section.component.html',
  styleUrl: './master-data-hierarchy-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MasterDataHierarchySectionComponent implements OnChanges {
  @Input({ required: true }) config!: MasterDataHierarchyConfig<any, any>;

  protected readonly parentItems = signal<any[]>([]);
  protected readonly childItems = signal<any[]>([]);
  protected readonly selectedParentId = signal<string | null>(null);
  protected readonly selectedParent = computed<any | null>(() => {
    const id = this.selectedParentId();
    if (!id) {
      return null;
    }
    return this.parentItems().find((item) => item.id === id) ?? null;
  });

  protected readonly parentConfigView = computed<MasterDataCategoryConfig<any> | null>(() => {
    if (!this.config) {
      return null;
    }

    return {
      ...this.config.parent,
      items: this.parentItems(),
    };
  });

  protected readonly childConfigView = computed<MasterDataCategoryConfig<any> | null>(() => {
    if (!this.config) {
      return null;
    }

    const parent = this.selectedParent();
    if (!parent) {
      return null;
    }

    const relationKey = this.config.relationKey;
    const baseChildConfig = this.config.child;
    const filteredChildren = this.childItems().filter(
      (child) => child && child[relationKey] === parent.id,
    );

    const existingDefaultValues = baseChildConfig.defaultValues ?? (() => ({}));

    return {
      ...baseChildConfig,
      items: filteredChildren,
      fields: baseChildConfig.fields.map((field) =>
        field.key === relationKey
          ? {
              ...field,
              readonly: true,
              hint: field.hint ?? 'Wird automatisch über den ausgewählten Pool gesetzt.',
            }
          : field,
      ),
      defaultValues: () => ({
        ...existingDefaultValues(),
        [relationKey]: parent.id,
      }),
      toFormValue: (item: any) => {
        const baseValue = baseChildConfig.toFormValue
          ? baseChildConfig.toFormValue(item)
          : item;
        return {
          ...baseValue,
          [relationKey]: baseValue?.[relationKey] ?? parent.id,
        };
      },
      fromFormValue: (value: Record<string, unknown>, previous?: any | null) => {
        const baseResult = baseChildConfig.fromFormValue
          ? baseChildConfig.fromFormValue(value, previous)
          : { ...(previous ?? {}), ...value };
        return {
          ...baseResult,
          [relationKey]: parent.id,
        };
      },
    };
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] && this.config) {
      this.parentItems.set(this.cloneItems(this.config.parent.items));
      this.childItems.set(this.cloneItems(this.config.child.items));
      const initialParentId = this.config.parent.items[0]?.id ?? null;
      this.selectedParentId.set(initialParentId);
    }
  }

  protected handleParentItemsChange(updated: any[]): void {
    const cloned = this.cloneItems(updated);
    this.parentItems.set(cloned);
    if (this.config.onParentItemsChange) {
      this.config.onParentItemsChange(cloned);
    }
    const currentId = this.selectedParentId();
    if (currentId && updated.some((item) => item.id === currentId)) {
      return;
    }
    const fallbackId = updated[0]?.id ?? null;
    this.selectedParentId.set(fallbackId);
  }

  protected handleParentSelectionChange(selection: any | null): void {
    if (!selection) {
      if (this.selectedParentId() !== null) {
        this.selectedParentId.set(null);
      }
      return;
    }
    if (this.selectedParentId() === selection.id) {
      return;
    }
    const exists = this.parentItems().some((item) => item.id === selection.id);
    this.selectedParentId.set(exists ? selection.id : this.parentItems()[0]?.id ?? selection.id);
  }

  protected handleChildItemsChange(updated: any[]): void {
    const parentId = this.selectedParentId();
    if (!parentId) {
      return;
    }

    const parent = this.parentItems().find((item) => item.id === parentId);
    if (!parent) {
      return;
    }

    const relationKey = this.config.relationKey;
    this.childItems.update((existing) => {
      const others = existing.filter((item) => item[relationKey] !== parent.id);
      return [...others, ...this.cloneItems(updated)];
    });

    if (this.config.parentRelationKey) {
      const parentRelationKey = this.config.parentRelationKey as string;
      const childIds = updated.map((child) => child.id);
      this.parentItems.update((parents) =>
        parents.map((item) =>
          item.id === parentId ? { ...item, [parentRelationKey]: childIds } : item,
        ),
      );
      const refreshedParent = this.parentItems().find((item) => item.id === parentId);
      if (!refreshedParent) {
        const fallbackId = this.parentItems()[0]?.id ?? null;
        this.selectedParentId.set(fallbackId);
      }
    }
    if (this.config.onChildItemsChange) {
      this.config.onChildItemsChange(this.cloneItems(this.childItems()));
    }
  }

  protected parentSelectionLabel(): string {
    const parent = this.selectedParent();
    if (!parent) {
      return 'Kein Pool ausgewählt';
    }
    return `Pool ${parent.name ?? parent.title ?? parent.id}`;
  }

  private cloneItems(items: any[]): any[] {
    return items.map((item) => this.cloneItem(item));
  }

  private cloneItem(item: any): any {
    if (!item || typeof item !== 'object') {
      return item;
    }
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      clone[key] = this.cloneValue(value);
    }
    return clone;
  }

  private cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.cloneValue(entry));
    }
    if (value && typeof value === 'object') {
      return { ...(value as Record<string, unknown>) };
    }
    return value;
  }
}
