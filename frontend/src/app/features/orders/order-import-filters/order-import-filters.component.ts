import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ScheduleTemplate } from '../../../core/models/schedule-template.model';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-order-import-filters',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './order-import-filters.component.html',
  styleUrl: './order-import-filters.component.scss',
})
export class OrderImportFiltersComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input({ required: true }) descriptions!: Record<string, string>;
  @Input({ required: true }) taktTemplates: ScheduleTemplate[] = [];
  @Output() reset = new EventEmitter<void>();

  onReset() {
    this.reset.emit();
  }
}
