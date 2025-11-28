import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { ControlContainer, FormGroup, FormGroupDirective, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../../core/material.imports.imports';

export interface OrderItemServiceFieldConfig {
  startControl?: string;
  endControl?: string;
  serviceTypeControl?: string;
  fromControl?: string;
  toControl?: string;
  trafficPeriodControl?: string;
}

interface TrafficPeriodOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-order-item-service-fields',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './order-item-service-fields.component.html',
  styleUrl: './order-item-service-fields.component.scss',
  viewProviders: [
    {
      provide: ControlContainer,
      useExisting: FormGroupDirective,
    },
  ],
})
export class OrderItemServiceFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() config: OrderItemServiceFieldConfig = {};
  @Input() trafficPeriods: TrafficPeriodOption[] = [];
  @Input() placeholders: Partial<
    Record<'serviceType' | 'from' | 'to', string>
  > = {};
  @Input() descriptions: Partial<
    Record<'start' | 'end' | 'serviceType' | 'from' | 'to' | 'trafficPeriod', string>
  > = {};
  @Input() timeInputType: 'datetime-local' | 'time' = 'datetime-local';

  controlName(key: keyof OrderItemServiceFieldConfig): string | undefined {
    const name = this.config[key];
    if (!name || !this.form.get(name)) {
      return undefined;
    }
    return name;
  }

  placeholder(key: 'serviceType' | 'from' | 'to'): string | undefined {
    return this.placeholders[key];
  }

  description(
    key: 'start' | 'end' | 'serviceType' | 'from' | 'to' | 'trafficPeriod',
  ): string | undefined {
    return this.descriptions[key];
  }
}
