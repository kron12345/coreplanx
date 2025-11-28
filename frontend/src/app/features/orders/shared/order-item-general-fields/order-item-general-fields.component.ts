import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { ControlContainer, FormGroup, FormGroupDirective, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../../core/material.imports.imports';

type FieldKey = 'name' | 'responsible' | 'deviation' | 'tags';
export type OrderItemGeneralLabels = Record<FieldKey, string>;

@Component({
  selector: 'app-order-item-general-fields',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './order-item-general-fields.component.html',
  styleUrl: './order-item-general-fields.component.scss',
  viewProviders: [
    {
      provide: ControlContainer,
      useExisting: FormGroupDirective,
    },
  ],
})
export class OrderItemGeneralFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() nameControl: string | null = 'name';
  @Input() responsibleControl: string | null = 'responsible';
  @Input() deviationControl: string | null = 'deviation';
  @Input() tagsControl: string | null = 'tags';
  @Input() labels: OrderItemGeneralLabels = {
    name: 'Name',
    responsible: 'Verantwortung',
    deviation: 'Abweichung',
    tags: 'Tags (optional)',
  };
  @Input() hints: Partial<Record<FieldKey, string>> = {};
  @Input() placeholders: Partial<Record<FieldKey, string>> = {};
  @Input() descriptions: Partial<Record<FieldKey, string>> = {};

  label(key: FieldKey): string {
    return this.labels[key];
  }

  placeholder(key: FieldKey): string | undefined {
    return this.placeholders[key];
  }

  description(key: FieldKey): string | undefined {
    return this.descriptions[key];
  }

  hasControl(controlName: string | null | undefined): boolean {
    if (!controlName) {
      return false;
    }
    return !!this.form.get(controlName);
  }
}
