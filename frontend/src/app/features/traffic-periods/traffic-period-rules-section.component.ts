import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import {
  CalendarModeGetter,
  RuleReadyChecker,
  TrafficPeriodRuleForm,
} from './traffic-period-editor.types';
import { TrafficPeriodVariantScope, TrafficPeriodVariantType } from '../../core/models/traffic-period.model';
import { TrafficPeriodRulePanelComponent } from './traffic-period-rule-panel.component';

@Component({
  selector: 'app-traffic-period-rules-section',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatExpansionModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    TrafficPeriodRulePanelComponent,
  ],
  templateUrl: './traffic-period-rules-section.component.html',
  styleUrl: './traffic-period-rules-section.component.scss',
})
export class TrafficPeriodRulesSectionComponent {
  @Input({ required: true }) rules!: FormArray<FormGroup<TrafficPeriodRuleForm>>;
  @Input({ required: true })
  variantTypeOptions: { value: TrafficPeriodVariantType; label: string }[] = [];
  @Input({ required: true })
  appliesOptions: { value: TrafficPeriodVariantScope; label: string }[] = [];
  @Input({ required: true }) calendarMode!: CalendarModeGetter;
  @Input({ required: true }) ruleReady!: RuleReadyChecker;
  @Input({ required: true }) primaryRuleReady!: boolean;
  @Input({ required: true }) canAddRule!: boolean;
  @Input() uiWarnings: string[] = [];

  @Output() addRuleRequested = new EventEmitter<void>();
  @Output() setPrimaryRequested = new EventEmitter<number>();
  @Output() removeRuleRequested = new EventEmitter<number>();
  @Output() calendarModeChange = new EventEmitter<{ index: number; mode: 'include' | 'exclude' }>();
  @Output() selectedDatesChange = new EventEmitter<{ index: number; dates: string[] }>();
  @Output() excludedDatesChange = new EventEmitter<{ index: number; dates: string[] }>();

  triggerCalendarModeChange(index: number, mode: 'include' | 'exclude') {
    this.calendarModeChange.emit({ index, mode });
  }

  triggerSelectedDates(index: number, dates: string[]) {
    this.selectedDatesChange.emit({ index, dates });
  }

  triggerExcludedDates(index: number, dates: string[]) {
    this.excludedDatesChange.emit({ index, dates });
  }
}
