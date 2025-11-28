import { CommonModule } from '@angular/common';
import { Component, Inject, inject } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  AutomationCondition,
  AutomationConditionField,
  AutomationConditionOperator,
  BusinessTemplate,
} from '../../core/models/business-template.model';
import { BusinessTemplateService } from '../../core/services/business-template.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PhaseWindowConfig, PhaseWindowUnit } from '../../core/config/ttr-phase-template.config';
import { OrderService, OrderTimelineReference, OrderTtrPhase } from '../../core/services/order.service';
import { TimetablePhase } from '../../core/models/timetable.model';

interface BusinessTemplateEditDialogData {
  template: BusinessTemplate;
  phaseId?: string;
  window?: PhaseWindowConfig;
  timelineReference?: OrderTimelineReference | 'fpYear';
  conditions?: AutomationCondition[];
}

type ConditionFormGroup = FormGroup<{
  id: FormControl<string>;
  field: FormControl<AutomationConditionField>;
  operator: FormControl<AutomationConditionOperator>;
  value: FormControl<string>;
}>;

@Component({
  selector: 'app-business-template-edit-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './business-template-edit-dialog.component.html',
  styleUrl: './business-template-edit-dialog.component.scss',
})
export class BusinessTemplateEditDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly templateService = inject(BusinessTemplateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly orderService = inject(OrderService);

  readonly form: FormGroup;
  readonly supportsWindow: boolean;
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

  constructor(
    private readonly dialogRef: MatDialogRef<BusinessTemplateEditDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: BusinessTemplateEditDialogData,
  ) {
    const template = data.template;
    this.supportsWindow = !!data.phaseId;
    this.ttrPhaseOptions = this.buildTtrPhaseOptions();
    this.timetablePhaseOptions = this.buildTimetablePhaseOptions();
    const initialConditions = this.supportsWindow ? data.conditions ?? [] : [];
    this.form = this.fb.group({
      title: [template.title, [Validators.required, Validators.maxLength(160)]],
      description: [
        template.description,
        [Validators.required, Validators.maxLength(1500)],
      ],
      instructions: [template.instructions ?? '', Validators.maxLength(1200)],
      assignmentType: [template.recommendedAssignment.type, Validators.required],
      assignmentName: [
        template.recommendedAssignment.name,
        [Validators.required, Validators.maxLength(120)],
      ],
      tags: [(template.tags ?? []).join(', ')],
      windowStart: [
        data.window?.start ?? -30,
        this.supportsWindow ? Validators.required : [],
      ],
      windowEnd: [
        data.window?.end ?? -7,
        this.supportsWindow ? Validators.required : [],
      ],
      windowUnit: [
        data.window?.unit ?? 'days',
        this.supportsWindow ? Validators.required : [],
      ],
      timelineReference: [
        data.timelineReference ?? 'fpDay',
        this.supportsWindow ? Validators.required : [],
      ],
      conditions: this.fb.array(
        initialConditions.map((condition) => this.buildConditionGroup(condition)),
      ),
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    const tags = this.normalizeTags(value.tags ?? '');
    const success = this.templateService.updateTemplate(this.data.template.id, {
      title: value.title?.trim(),
      description: value.description?.trim(),
      instructions: value.instructions?.trim()?.length ? value.instructions.trim() : undefined,
      recommendedAssignment: {
        type: value.assignmentType,
        name: value.assignmentName?.trim() ?? '',
      },
      tags,
    });
    if (success) {
      this.snackBar.open('Vorlage aktualisiert.', 'OK', { duration: 2000 });
    }
    if (this.supportsWindow && this.data.phaseId && this.data.window) {
      const unit = (value.windowUnit ?? this.data.window.unit) as PhaseWindowUnit;
      let start = Number(value.windowStart ?? this.data.window.start);
      let end = Number(value.windowEnd ?? this.data.window.end);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        start = this.data.window.start;
        end = this.data.window.end;
      }
      const normalizedStart = Math.min(start, end);
      const normalizedEnd = Math.max(start, end);
      const updatedWindow: PhaseWindowConfig = {
        unit,
        start: normalizedStart,
        end: normalizedEnd,
        bucket: this.data.window.bucket,
        label: this.buildWindowLabel(unit, normalizedStart, normalizedEnd),
      };
      const timelineReference = (value.timelineReference ??
        this.data.timelineReference ??
        'fpDay') as OrderTimelineReference | 'fpYear';
      this.templateService.updatePhaseWindow(this.data.phaseId, {
        window: updatedWindow,
        timelineReference,
      });
      this.templateService.updatePhaseConditions(
        this.data.phaseId,
        this.buildConditionPayload(),
      );
    }
    this.dialogRef.close(true);
  }

  cancel(): void {
    this.dialogRef.close();
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

  private buildWindowLabel(unit: PhaseWindowUnit, start: number, end: number): string {
    const unitLabel = unit === 'weeks' ? 'Wochen' : unit === 'hours' ? 'Stunden' : 'Tage';
    if (start <= 0 && end <= 0) {
      return `${Math.abs(start)}–${Math.abs(end)} ${unitLabel} vor`;
    }
    if (start >= 0 && end >= 0) {
      return `${Math.abs(start)}–${Math.abs(end)} ${unitLabel} nach`;
    }
    return `${start}–${end} ${unitLabel}`;
  }

  get conditionControls(): FormArray<ConditionFormGroup> {
    return this.form.get('conditions') as FormArray<ConditionFormGroup>;
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

  trackCondition(_: number, group: ConditionFormGroup): string {
    return group.controls.id.value;
  }

  private buildConditionGroup(condition?: AutomationCondition): ConditionFormGroup {
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
    return `local-cond-${this.conditionIdCounter}`;
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
}
