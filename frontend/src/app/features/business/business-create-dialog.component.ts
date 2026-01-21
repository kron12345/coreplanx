import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { CreateBusinessPayload } from '../../core/services/business.service';
import { OrderItemOption } from '../../core/services/order.service';
import { BusinessDocument } from '../../core/models/business.model';
import { OrderItemPickerComponent } from './order-item-picker.component';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { MatSnackBar } from '@angular/material/snack-bar';

export interface BusinessCreateDialogData {
  orderItemOptions: OrderItemOption[];
}

@Component({
    selector: 'app-business-create-dialog',
    imports: [CommonModule, ReactiveFormsModule, OrderItemPickerComponent, ...MATERIAL_IMPORTS],
    templateUrl: './business-create-dialog.component.html',
    styleUrl: './business-create-dialog.component.scss'
})
export class BusinessCreateDialogComponent {
  private readonly dialogRef = inject<
    MatDialogRef<BusinessCreateDialogComponent, CreateBusinessPayload>
  >(MatDialogRef);
  private readonly data = inject<BusinessCreateDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);
  private readonly templateService = inject(BusinessTemplateService);
  private readonly snackBar = inject(MatSnackBar);
  readonly templates = this.templateService.templates;

  readonly mode = new FormControl<'manual' | 'template'>('manual', { nonNullable: true });
  readonly form = this.fb.nonNullable.group({
    title: ['', Validators.required],
    description: ['', Validators.required],
    dueDate: new FormControl<Date | null>(null),
    assignmentType: this.fb.nonNullable.control<'group' | 'person'>(
      'group',
      Validators.required,
    ),
    assignmentName: ['', Validators.required],
    documentNames: [''],
    linkedOrderItemIds: this.fb.nonNullable.control<string[]>([]),
  });
  readonly templateForm = this.fb.group({
    templateId: ['', Validators.required],
    targetDate: [''],
    linkedOrderItemId: [''],
    note: ['', Validators.maxLength(280)],
  });

  readonly assignmentOptions = [
    { value: 'group' as const, label: 'Gruppe' },
    { value: 'person' as const, label: 'Person' },
  ];

  get orderItemOptions(): OrderItemOption[] {
    return this.data.orderItemOptions;
  }

  modeIndex(): number {
    return this.mode.value === 'template' ? 1 : 0;
  }

  onTabChange(index: number) {
    const next = index === 1 ? 'template' : 'manual';
    if (this.mode.value !== next) {
      this.mode.setValue(next);
    }
  }

  onLinkedItemsChange(ids: string[]): void {
    this.form.controls.linkedOrderItemIds.setValue(ids);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (this.mode.value === 'template') {
      void this.saveFromTemplate();
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const documents = this.parseDocuments(value.documentNames);
    const payload: CreateBusinessPayload = {
      title: value.title,
      description: value.description,
      dueDate: value.dueDate,
      assignment: {
        type: value.assignmentType,
        name: value.assignmentName,
      },
      documents,
      linkedOrderItemIds: value.linkedOrderItemIds,
    };

    this.dialogRef.close(payload);
  }

  private async saveFromTemplate() {
    if (this.templateForm.invalid) {
      this.templateForm.markAllAsTouched();
      return;
    }
    const value = this.templateForm.getRawValue();
    const targetDate = value.targetDate ? new Date(value.targetDate) : undefined;
    const note = value.note?.trim() || undefined;
    const linked = value.linkedOrderItemId ? [value.linkedOrderItemId] : undefined;
    try {
      await this.templateService.instantiateTemplate(value.templateId!, {
        targetDate,
        note,
        linkedOrderItemIds: linked,
      });
      this.snackBar.open('Geschäft aus Vorlage erstellt.', 'OK', { duration: 2500 });
      this.dialogRef.close();
    } catch (error) {
      this.snackBar.open((error as Error).message, 'Schließen', { duration: 3500 });
    }
  }

  private parseDocuments(value: string | null | undefined):
    | BusinessDocument[]
    | undefined {
    if (!value?.trim()) {
      return undefined;
    }

    const lines = value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return undefined;
    }

    const timestamp = Date.now().toString(36).toUpperCase();
    return lines.map((name, index) => ({
      id: `DOC-${timestamp}-${index + 1}`,
      name,
      url: '#',
    }));
  }
}
