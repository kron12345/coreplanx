import {
  AbstractControl,
  FormBuilder,
  FormControl,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { OrderPositionMode } from './order-position-dialog.models';

export function nonEmptyDates(control: AbstractControl<string[] | null>): ValidationErrors | null {
  const value = control.value;
  if (Array.isArray(value) && value.length > 0) {
    return null;
  }
  return { required: true };
}

export function createOrderPositionForms(
  fb: FormBuilder,
  defaultTimetableYearLabel: string,
) {
  const modeControl = new FormControl<OrderPositionMode>('service', { nonNullable: true });

  const serviceForm = fb.group({
    serviceType: ['', Validators.required],
    fromLocation: ['', Validators.required],
    toLocation: ['', Validators.required],
    start: ['', Validators.required],
    end: ['', Validators.required],
    calendarYear: fb.nonNullable.control(defaultTimetableYearLabel, {
      validators: [Validators.required],
    }),
    calendarDates: fb.nonNullable.control<string[]>([], {
      validators: [nonEmptyDates],
    }),
    calendarExclusions: fb.nonNullable.control<string[]>([]),
    deviation: [''],
    name: [''],
    tags: [''],
  });

  const planForm = fb.group({
    templateId: ['', Validators.required],
    startTime: ['04:00', Validators.required],
    endTime: ['23:00', Validators.required],
    intervalMinutes: [30, [Validators.required, Validators.min(1)]],
    namePrefix: [''],
    responsible: [''],
    otn: [''],
    otnInterval: [1, [Validators.min(1)]],
    variantType: fb.nonNullable.control<'productive' | 'simulation'>('productive'),
    variantLabel: [''],
    simulationId: [''],
    simulationLabel: [''],
    calendarYear: fb.nonNullable.control(defaultTimetableYearLabel, {
      validators: [Validators.required],
    }),
    calendarDates: fb.nonNullable.control<string[]>([], {
      validators: [nonEmptyDates],
    }),
    calendarExclusions: fb.nonNullable.control<string[]>([]),
    tags: [''],
  });

  const manualPlanForm = fb.group({
    trainNumber: ['', Validators.required],
    name: [''],
    responsible: [''],
    tags: [''],
    variantType: fb.nonNullable.control<'productive' | 'simulation'>('productive'),
    variantLabel: [''],
    simulationId: [''],
    simulationLabel: [''],
    calendarYear: fb.nonNullable.control(defaultTimetableYearLabel, {
      validators: [Validators.required],
    }),
    calendarDates: fb.nonNullable.control<string[]>([], {
      validators: [nonEmptyDates],
    }),
    calendarExclusions: fb.nonNullable.control<string[]>([]),
  });

  const importFilters = fb.group({
    search: [''],
    start: [''],
    end: [''],
    templateId: [''],
    irregularOnly: [false],
    minDeviation: [0],
    deviationSort: ['none'],
  });

  const importOptionsForm = fb.group({
    trafficPeriodId: [''],
    namePrefix: [''],
    responsible: [''],
    tags: [''],
    variantType: fb.nonNullable.control<'productive' | 'simulation'>('productive'),
    variantLabel: [''],
    simulationId: [''],
    simulationLabel: [''],
    calendarYear: fb.nonNullable.control(defaultTimetableYearLabel, {
      validators: [Validators.required],
    }),
  });

  const businessForm = fb.group({
    mode: fb.nonNullable.control<'none' | 'existing' | 'template'>('none'),
    existingBusinessId: [''],
    templateId: [''],
    customTitle: ['', [Validators.maxLength(120)]],
    note: ['', [Validators.maxLength(400)]],
    targetDate: [''],
    enableAutomations: fb.nonNullable.control(true),
    automationRuleIds: fb.nonNullable.control<string[]>([]),
  });

  return {
    modeControl,
    serviceForm,
    planForm,
    manualPlanForm,
    importFilters,
    importOptionsForm,
    businessForm,
  };
}

export type OrderPositionForms = ReturnType<typeof createOrderPositionForms>;
