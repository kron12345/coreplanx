import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { OrderService } from '../../core/services/order.service';

@Component({
  selector: 'app-business-create-from-template',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './business-create-from-template.component.html',
  styleUrl: './business-create-from-template.component.scss',
})
export class BusinessCreateFromTemplateComponent {
  private readonly templateService = inject(BusinessTemplateService);
  private readonly orderService = inject(OrderService);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly templates = this.templateService.templates;
  readonly orderItemOptions = computed(() => this.orderService.orderItemOptions());

  readonly form = this.fb.group({
    templateId: ['', Validators.required],
    targetDate: [''],
    linkedOrderItemId: [''],
    note: ['', Validators.maxLength(280)],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    const templateId = value.templateId!;
    const targetDate = value.targetDate ? new Date(value.targetDate) : undefined;
    const note = value.note?.trim();
    const linked = value.linkedOrderItemId ? [value.linkedOrderItemId] : undefined;
    try {
      this.templateService.instantiateTemplate(templateId, {
        targetDate,
        note,
        linkedOrderItemIds: linked,
      });
      this.form.patchValue({ linkedOrderItemId: '', note: '' });
      this.snackBar.open('Geschäft aus Vorlage erstellt.', 'OK', { duration: 2500 });
    } catch (error) {
      this.snackBar.open((error as Error).message, 'Schließen', { duration: 3500 });
    }
  }
}
