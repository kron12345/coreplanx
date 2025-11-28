import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AnnualCalendarSelectorComponent } from '../../shared/annual-calendar-selector/annual-calendar-selector.component';
import { TrafficPeriodVariantScope, TrafficPeriodVariantType } from '../../core/models/traffic-period.model';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';

@Component({
  selector: 'app-traffic-period-rule-panel',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    AnnualCalendarSelectorComponent,
    ...MATERIAL_IMPORTS,
  ],
  templateUrl: './traffic-period-rule-panel.component.html',
  styleUrl: './traffic-period-rule-panel.component.scss',
})
export class TrafficPeriodRulePanelComponent {
  @Input({ required: true }) group!: FormGroup;
  @Input({ required: true }) calendarMode: 'include' | 'exclude' = 'include';
  @Input({ required: true })
  variantTypeOptions: { value: TrafficPeriodVariantType; label: string }[] = [];
  @Input({ required: true })
  appliesOptions: { value: TrafficPeriodVariantScope; label: string }[] = [];
  @Input() canRemove = true;
  @Input() disablePrimaryButton = false;

  @Output() primarySelected = new EventEmitter<void>();
  @Output() removeRequested = new EventEmitter<void>();
  @Output() calendarModeChange = new EventEmitter<'include' | 'exclude'>();
  @Output() selectedDatesChange = new EventEmitter<string[]>();
  @Output() excludedDatesChange = new EventEmitter<string[]>();

  get isPrimary(): boolean {
    return !!this.group.get('primary')?.value;
  }

  onCalendarModeChange(mode: 'include' | 'exclude') {
    if (this.calendarMode === mode) {
      return;
    }
    this.calendarModeChange.emit(mode);
  }

  identity<T>(value: T): T {
    return value;
  }
}
