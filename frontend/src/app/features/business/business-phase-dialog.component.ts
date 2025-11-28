import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PhaseWindowConfig, PhaseWindowUnit } from '../../core/config/ttr-phase-template.config';
import {
  AutomationCondition,
  AutomationConditionField,
  AutomationConditionOperator,
} from '../../core/models/business-template.model';
import { OrderService, OrderTtrPhase } from '../../core/services/order.service';
import { TimetablePhase } from '../../core/models/timetable.model';

type PhaseConditionFormGroup = FormGroup<{
  id: FormControl<string>;
  field: FormControl<AutomationConditionField>;
  operator: FormControl<AutomationConditionOperator>;
  value: FormControl<string>;
}>;

@Component({
  selector: 'app-business-phase-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './business-phase-dialog.component.html',
  styleUrl: './business-phase-dialog.component.scss',
})
export class BusinessPhaseDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<BusinessPhaseDialogComponent>);
  private readonly templateService = inject(BusinessTemplateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly orderService = inject(OrderService);

  readonly form: FormGroup = this.fb.group({
    label: ['', [Validators.required, Validators.maxLength(120)]],
    summary: ['', [Validators.required, Validators.maxLength(400)]],
    timelineReference: ['fpDay', Validators.required],
    windowStart: [-30, Validators.required],
    windowEnd: [-7, Validators.required],
    windowUnit: ['days', Validators.required],
    autoCreate: [false],
    title: ['', [Validators.required, Validators.maxLength(160)]],
    description: ['', [Validators.required, Validators.maxLength(1500)]],
    instructions: ['', Validators.maxLength(1200)],
    assignmentType: ['group', Validators.required],
    assignmentName: ['', [Validators.required, Validators.maxLength(120)]],
    tags: [''],
    dueAnchor: ['production_start', Validators.required],
    dueOffset: [-7, Validators.required],
    conditions: this.fb.array([]),
  });
  readonly fieldOptions: ReadonlyArray<{ value: AutomationConditionField; label: string }> = [
    { value: 'itemTag', label: 'Tag' },
    { value: 'itemType', label: 'Positionsart' },
    { value: 'timetablePhase', label: 'Bestellphase (TTT)' },
    { value: 'ttrPhase', label: 'TTR-Phase' },
  ];
  readonly itemTypeOptions: ReadonlyArray<{ value: 'Leistung' | 'Fahrplan'; label: string }> = [
    { value: 'Leistung', label: 'Leistung' },
    { value: 'Fahrplan', label: 'Fahrplan' },
  ];
  readonly ttrPhaseOptions: ReadonlyArray<{ value: OrderTtrPhase; label: string }>;
  readonly timetablePhaseOptions: ReadonlyArray<{ value: TimetablePhase; label: string }>;
  private readonly operatorOptionsMap: Record<
    AutomationConditionField,
    ReadonlyArray<{ value: AutomationConditionOperator; label: string }>
  > = {
    itemTag: [
      { value: 'includes', label: 'enthält' },
      { value: 'excludes', label: 'enthält nicht' },
    ],
    itemType: [
      { value: 'equals', label: 'ist' },
      { value: 'notEquals', label: 'ist nicht' },
    ],
    ttrPhase: [
      { value: 'equals', label: 'ist' },
      { value: 'notEquals', label: 'ist nicht' },
    ],
    timetablePhase: [
      { value: 'equals', label: 'ist' },
      { value: 'notEquals', label: 'ist nicht' },
    ],
  };
  private readonly allTtrPhases: ReadonlyArray<OrderTtrPhase> = [
    'annual_request',
    'final_offer',
    'rolling_planning',
    'short_term',
    'ad_hoc',
    'operational_delivery',
  ];
  private readonly allTimetablePhases: ReadonlyArray<TimetablePhase> = [
    'bedarf',
    'path_request',
    'offer',
    'contract',
    'operational',
    'archived',
  ];
  private conditionIdCounter = 0;

  constructor() {
    this.ttrPhaseOptions = this.buildTtrPhaseOptions();
    this.timetablePhaseOptions = this.buildTimetablePhaseOptions();
  }

  get conditionControls(): FormArray<PhaseConditionFormGroup> {
    return this.form.get('conditions') as FormArray<PhaseConditionFormGroup>;
  }

  addCondition(): void {
    this.conditionControls.push(this.buildConditionGroup());
  }

  removeCondition(index: number): void {
    this.conditionControls.removeAt(index);
  }

  operatorOptions(field: AutomationConditionField): ReadonlyArray<{
    value: AutomationConditionOperator;
    label: string;
  }> {
    return this.operatorOptionsMap[field];
  }

  onConditionFieldChange(index: number): void {
    const control = this.conditionControls.at(index);
    const field = control.controls.field.value;
    const allowed = this.operatorOptions(field).map((option) => option.value);
    if (!allowed.includes(control.controls.operator.value)) {
      control.controls.operator.setValue(this.operatorOptions(field)[0].value);
    }
    if (field === 'itemType') {
      control.controls.value.setValue(this.itemTypeOptions[0].value);
    } else if (field === 'ttrPhase') {
      control.controls.value.setValue(this.ttrPhaseOptions[0]?.value ?? '');
    } else if (field === 'timetablePhase') {
      control.controls.value.setValue(this.timetablePhaseOptions[0]?.value ?? '');
    } else {
      control.controls.value.setValue('');
    }
  }

  trackCondition(_: number, group: PhaseConditionFormGroup): string {
    return group.controls.id.value;
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    const window = this.buildWindowConfig(
      value.windowUnit as PhaseWindowUnit,
      Number(value.windowStart),
      Number(value.windowEnd),
    );
    const timelineReference = value.timelineReference as 'fpYear' | 'fpDay' | 'operationalDay';
    if (timelineReference === 'fpYear') {
      window.bucket = 'year';
    }

    this.templateService.createCustomPhaseTemplate({
      label: value.label!.trim(),
      summary: value.summary!.trim(),
      timelineReference,
      window,
      autoCreate: value.autoCreate ?? false,
      conditions: this.buildConditionPayload(),
      template: {
        title: value.title!.trim(),
        description: value.description!.trim(),
        instructions: value.instructions?.trim(),
        assignment: {
          type: value.assignmentType,
          name: value.assignmentName!.trim(),
        },
        tags: this.normalizeTags(value.tags ?? ''),
        dueRule: {
          anchor: value.dueAnchor,
          offsetDays: Number(value.dueOffset),
          label: this.buildDueLabel(value.dueAnchor, Number(value.dueOffset)),
        },
        defaultLeadTimeDays: Math.abs(Number(value.dueOffset)),
      },
    });
    this.snackBar.open('Eigene Phase gespeichert.', 'OK', { duration: 2000 });
    this.dialogRef.close(true);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  private buildConditionGroup(condition?: AutomationCondition): PhaseConditionFormGroup {
    const field = condition?.field ?? 'itemTag';
    const operatorCandidates = this.operatorOptions(field).map((option) => option.value);
    const operator =
      condition?.operator && operatorCandidates.includes(condition.operator)
        ? condition.operator
        : this.operatorOptions(field)[0].value;
    const defaultValue =
      field === 'itemType'
        ? this.itemTypeOptions[0].value
        : field === 'ttrPhase'
          ? this.ttrPhaseOptions[0]?.value ?? ''
          : field === 'timetablePhase'
            ? this.timetablePhaseOptions[0]?.value ?? ''
            : '';
    return this.fb.group({
      id: this.fb.nonNullable.control(condition?.id ?? this.localConditionId()),
      field: this.fb.nonNullable.control(field),
      operator: this.fb.nonNullable.control(operator),
      value: this.fb.nonNullable.control(condition?.value ?? defaultValue, {
        validators: [Validators.required],
      }),
    });
  }

  private buildConditionPayload(): AutomationCondition[] {
    return this.conditionControls.controls.map((group) => ({
      id: group.controls.id.value,
      field: group.controls.field.value,
      operator: group.controls.operator.value,
      value: group.controls.value.value.trim(),
    }));
  }

  private localConditionId(): string {
    this.conditionIdCounter += 1;
    return `phase-cond-${this.conditionIdCounter}`;
  }

  private buildTtrPhaseOptions(): ReadonlyArray<{ value: OrderTtrPhase; label: string }> {
    return this.allTtrPhases.map((phase) => ({
      value: phase,
      label: this.orderService.getTtrPhaseMeta(phase).label,
    }));
  }

  private buildTimetablePhaseOptions(): ReadonlyArray<{ value: TimetablePhase; label: string }> {
    const labels: Record<TimetablePhase, string> = {
      bedarf: 'Draft',
      path_request: 'Path Request',
      offer: 'Offered',
      contract: 'Booked',
      operational: 'Used',
      archived: 'Cancelled',
    };
    return this.allTimetablePhases.map((phase) => ({
      value: phase,
      label: labels[phase],
    }));
  }

  private buildWindowConfig(
    unit: PhaseWindowUnit,
    startRaw: number,
    endRaw: number,
  ): PhaseWindowConfig {
    const start = Number.isFinite(startRaw) ? startRaw : -30;
    const end = Number.isFinite(endRaw) ? endRaw : -7;
    const bucket = unit === 'weeks' ? 'week' : unit === 'hours' ? 'hour' : 'day';
    return {
      unit,
      start: Math.min(start, end),
      end: Math.max(start, end),
      bucket,
      label: this.describeWindow(unit, start, end),
    };
  }

  private describeWindow(unit: PhaseWindowUnit, start: number, end: number): string {
    const unitLabel = unit === 'weeks' ? 'Wochen' : unit === 'hours' ? 'Stunden' : 'Tage';
    return `${Math.abs(start)}–${Math.abs(end)} ${unitLabel} ${
      end <= 0 ? 'vor' : start >= 0 ? 'nach' : ''
    }`;
  }

  private buildDueLabel(anchor: string, offset: number): string {
    const abs = Math.abs(offset);
    const direction = offset < 0 ? 'vor' : 'nach';
    const anchorLabel =
      anchor === 'order_creation'
        ? 'Auftrag'
        : anchor === 'go_live'
          ? 'Go-Live'
          : 'Produktion';
    return `${abs} Tage ${direction} ${anchorLabel}`;
  }

  private normalizeTags(input: string): string[] {
    if (!input.trim()) {
      return [];
    }
    return input
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length)
      .map((entry) => (entry.startsWith('#') ? entry : `#${entry}`));
  }
}
