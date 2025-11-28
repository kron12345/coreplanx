import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../../core/material.imports.imports';

@Component({
  selector: 'app-order-item-range-fields',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './order-item-range-fields.component.html',
  styleUrl: './order-item-range-fields.component.scss',
})
export class OrderItemRangeFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() startControl = 'rangeStart';
  @Input() endControl = 'rangeEnd';
}
