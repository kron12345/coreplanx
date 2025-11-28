import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import {
  ActivityFieldKey,
  ActivityTypeDefinition,
  ActivityTypeInput,
  ActivityTypeService,
  ActivityCategory,
  ActivityTimeMode,
} from '../../core/services/activity-type.service';
import { ResourceKind } from '../../models/resource';

interface FieldOption {
  key: ActivityFieldKey;
  label: string;
  description: string;
  disabled?: boolean;
}

interface ResourceOption {
  value: ResourceKind;
  label: string;
}

@Component({
  selector: 'app-activity-type-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
  ],
  templateUrl: './activity-type-settings.component.html',
  styleUrl: './activity-type-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityTypeSettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly activityTypes = inject(ActivityTypeService);

  protected readonly definitions = this.activityTypes.definitions;
  protected readonly editingId = signal<string | null>(null);

  protected readonly resourceOptions: ResourceOption[] = [
    { value: 'personnel', label: 'Personal' },
    { value: 'vehicle', label: 'Fahrzeug' },
    { value: 'personnel-service', label: 'Personaldienst' },
    { value: 'vehicle-service', label: 'Fahrzeugdienst' },
  ];

  protected readonly fieldOptions: FieldOption[] = [
    { key: 'start', label: 'Startzeit', description: 'Zeitpunkt des Beginns', disabled: true },
    { key: 'end', label: 'Endzeit', description: 'Zeitpunkt des Endes', disabled: true },
    { key: 'from', label: 'Von', description: 'Startort oder Quelle' },
    { key: 'to', label: 'Nach', description: 'Zielort' },
    { key: 'remark', label: 'Bemerkung', description: 'Freitextfeld' },
  ];

  protected readonly categoryOptions: Array<{ value: ActivityCategory; label: string }> = [
    { value: 'service', label: 'Dienst & Pause' },
    { value: 'movement', label: 'Rangieren & Wege' },
    { value: 'rest', label: 'Freitage' },
    { value: 'other', label: 'Sonstige' },
  ];

  protected readonly timeModeOptions: Array<{ value: ActivityTimeMode; label: string }> = [
    { value: 'duration', label: 'Dauerbasiert' },
    { value: 'range', label: 'Start & Ende (manuell)' },
    { value: 'point', label: 'Zeitpunkt (ohne Ende)' },
  ];

  protected readonly newTypeForm = this.fb.group({
    label: ['', [Validators.required, Validators.maxLength(80)]],
    id: ['', [Validators.required, Validators.maxLength(80)]],
    relevantFor: this.fb.control<ResourceKind[]>(['personnel']),
    category: ['service' as ActivityCategory],
    timeMode: ['duration' as ActivityTimeMode],
    defaultDurationMinutes: [60, [Validators.required, Validators.min(1)]],
    description: [''],
    fieldFrom: [false],
    fieldTo: [false],
    fieldRemark: [false],
  });

  protected readonly editTypeForm = this.fb.group({
    label: ['', [Validators.required, Validators.maxLength(80)]],
    id: ['', [Validators.required, Validators.maxLength(80)]],
    relevantFor: this.fb.control<ResourceKind[]>([]),
    category: ['service' as ActivityCategory],
    timeMode: ['duration' as ActivityTimeMode],
    defaultDurationMinutes: [60, [Validators.required, Validators.min(1)]],
    description: [''],
    fieldFrom: [false],
    fieldTo: [false],
    fieldRemark: [false],
  });

  constructor() {
    this.newTypeForm.controls.label.valueChanges.subscribe((label) => {
      const control = this.newTypeForm.controls.id;
      if (control.dirty) {
        return;
      }
      control.setValue(this.slugify(label ?? ''), { emitEvent: false });
    });
    this.editTypeForm.controls.label.valueChanges.subscribe((label) => {
      if (!this.editingId()) {
        return;
      }
      const control = this.editTypeForm.controls.id;
      if (control.dirty) {
        return;
      }
      control.setValue(this.slugify(label ?? ''), { emitEvent: false });
    });
  }

  protected createType(): void {
    if (this.newTypeForm.invalid) {
      this.newTypeForm.markAllAsTouched();
      return;
    }
    const definition = this.buildInputFromForm(this.newTypeForm.getRawValue());
    this.activityTypes.add(definition);
    this.newTypeForm.reset({
      label: '',
      id: '',
      relevantFor: ['personnel'],
      category: 'service',
      timeMode: 'duration',
      defaultDurationMinutes: 60,
      description: '',
      fieldFrom: false,
      fieldTo: false,
      fieldRemark: false,
    });
  }

  protected startEdit(definition: ActivityTypeDefinition): void {
    this.editingId.set(definition.id);
    this.editTypeForm.reset({
      label: definition.label,
      id: definition.id,
      relevantFor: definition.relevantFor,
      category: definition.category,
      timeMode: definition.timeMode,
      defaultDurationMinutes: definition.defaultDurationMinutes,
      description: definition.description ?? '',
      fieldFrom: definition.fields.includes('from'),
      fieldTo: definition.fields.includes('to'),
      fieldRemark: definition.fields.includes('remark'),
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editTypeForm.reset({
      label: '',
      id: '',
      relevantFor: [],
      category: 'service',
      timeMode: 'duration',
      defaultDurationMinutes: 60,
      description: '',
      fieldFrom: false,
      fieldTo: false,
      fieldRemark: false,
    });
  }

  protected saveEdit(): void {
    const id = this.editingId();
    if (!id) {
      return;
    }
    if (this.editTypeForm.invalid) {
      this.editTypeForm.markAllAsTouched();
      return;
    }
    const input = this.buildInputFromForm(this.editTypeForm.getRawValue());
    this.activityTypes.update(id, input);
    this.cancelEdit();
  }

  protected remove(definition: ActivityTypeDefinition): void {
    this.activityTypes.remove(definition.id);
    if (this.editingId() === definition.id) {
      this.cancelEdit();
    }
  }

  protected resetToDefaults(): void {
    this.activityTypes.reset();
    this.cancelEdit();
  }

  protected resourceLabel(value: ResourceKind): string {
    return this.resourceOptions.find((option) => option.value === value)?.label ?? value;
  }

  protected categoryLabel(value: ActivityCategory): string {
    return this.categoryOptions.find((option) => option.value === value)?.label ?? value;
  }

  protected fieldList(definition: ActivityTypeDefinition): string {
    const labels = definition.fields.map((field) => this.fieldOptions.find((option) => option.key === field)?.label ?? field);
    return labels.join(', ');
  }

  protected trackDefinition(_: number, definition: ActivityTypeDefinition): string {
    return definition.id;
  }

  protected controlNameForField(field: ActivityFieldKey): string | null {
    switch (field) {
      case 'from':
        return 'fieldFrom';
      case 'to':
        return 'fieldTo';
      case 'remark':
        return 'fieldRemark';
      default:
        return null;
    }
  }

  private buildInputFromForm(value: {
    label?: string | null;
    id?: string | null;
    relevantFor?: (ResourceKind | string | null)[] | null;
    category?: ActivityCategory | null;
    timeMode?: ActivityTimeMode | null;
    defaultDurationMinutes?: number | null;
    description?: string | null;
    fieldFrom?: boolean | null;
    fieldTo?: boolean | null;
    fieldRemark?: boolean | null;
  }): ActivityTypeInput {
    const fields: ActivityFieldKey[] = [];
    if (value?.fieldFrom) {
      fields.push('from');
    }
    if (value?.fieldTo) {
      fields.push('to');
    }
    if (value?.fieldRemark) {
      fields.push('remark');
    }
    const relevantFor = this.normalizeResourceKinds(value?.relevantFor);
    return {
      id: value.id ?? '',
      label: value.label ?? '',
      description: value.description ?? '',
      appliesTo: relevantFor,
      relevantFor,
      category: value.category ?? 'service',
      timeMode: value.timeMode ?? 'duration',
      fields,
      defaultDurationMinutes: value.defaultDurationMinutes ?? 60,
    };
  }

  private normalizeResourceKinds(values: (ResourceKind | string | null)[] | null | undefined): ResourceKind[] {
    const allowed: ResourceKind[] = ['personnel', 'vehicle', 'personnel-service', 'vehicle-service'];
    const list = Array.from(new Set(values ?? []));
    const filtered = list.filter((value): value is ResourceKind => allowed.includes(value as ResourceKind));
    return filtered.length > 0 ? filtered : ['personnel'];
  }

  private slugify(value: string): string {
    return (value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
