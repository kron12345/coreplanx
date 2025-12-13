import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import {
  OrderItemGeneralFieldsComponent,
  type OrderItemGeneralLabels,
} from '../shared/order-item-general-fields/order-item-general-fields.component';
import {
  OrderItemServiceFieldsComponent,
  type OrderItemServiceFieldConfig,
} from '../shared/order-item-service-fields/order-item-service-fields.component';

@Component({
  selector: 'app-order-position-service-tab',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ...MATERIAL_IMPORTS,
    OrderItemGeneralFieldsComponent,
    OrderItemServiceFieldsComponent,
  ],
  templateUrl: './order-position-service-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderPositionServiceTabComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input({ required: true }) generalLabels!: OrderItemGeneralLabels;
  @Input({ required: true }) generalDescriptions!: Partial<Record<string, string>>;
  @Input({ required: true }) serviceFieldsConfig!: OrderItemServiceFieldConfig;
  @Input({ required: true }) serviceFieldDescriptions!: Partial<Record<string, string>>;
}

