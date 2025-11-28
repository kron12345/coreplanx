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
import {
  CreateBusinessPayload,
} from '../../core/services/business.service';
import { OrderItemOption } from '../../core/services/order.service';
import { BusinessDocument } from '../../core/models/business.model';

export interface BusinessCreateDialogData {
  orderItemOptions: OrderItemOption[];
}

@Component({
  selector: 'app-business-create-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './business-create-dialog.component.html',
  styleUrl: './business-create-dialog.component.scss',
})
export class BusinessCreateDialogComponent {
  private readonly dialogRef = inject<
    MatDialogRef<BusinessCreateDialogComponent, CreateBusinessPayload>
  >(MatDialogRef);
  private readonly data = inject<BusinessCreateDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

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

  readonly assignmentOptions = [
    { value: 'group' as const, label: 'Gruppe' },
    { value: 'person' as const, label: 'Person' },
  ];

  get orderItemOptions(): OrderItemOption[] {
    return this.data.orderItemOptions;
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
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
