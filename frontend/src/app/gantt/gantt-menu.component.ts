import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule, MatCalendar } from '@angular/material/datepicker';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-gantt-menu',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatCalendar,
  ],
  templateUrl: './gantt-menu.component.html',
  styleUrl: './gantt-menu.component.scss',
})
export class GanttMenuComponent {
  @Input({ required: true }) zoomLabel = '';
  @Input({ required: true }) viewRangeLabel = '';
  @Input() filterText = '';

  @Output() zoomIn = new EventEmitter<void>();
  @Output() zoomOut = new EventEmitter<void>();
  @Output() gotoToday = new EventEmitter<void>();
  @Output() gotoDate = new EventEmitter<Date>();
  @Output() filterChange = new EventEmitter<string>();

  readonly today = new Date();

  onFilterChange(value: string) {
    this.filterChange.emit(value);
  }

  onDatePicked(value: Date | null) {
    if (!value) {
      return;
    }
    this.gotoDate.emit(value);
  }
}
