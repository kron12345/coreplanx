import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { TrafficPeriodForm } from './traffic-period-editor.types';
import { TrafficPeriodType } from '../../core/models/traffic-period.model';

@Component({
  selector: 'app-traffic-period-general-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './traffic-period-general-form.component.html',
  styleUrl: './traffic-period-general-form.component.scss',
})
export class TrafficPeriodGeneralFormComponent {
  @Input({ required: true }) form!: FormGroup<TrafficPeriodForm>;
  @Input({ required: true })
  typeOptions: { value: TrafficPeriodType; label: string }[] = [];
}
