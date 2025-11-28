import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  CustomAttributeDefinition,
  CustomAttributeInput,
  CustomAttributePrimitiveType,
  CustomAttributeService,
  CustomAttributeTarget,
} from '../../core/services/custom-attribute.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

const ATTRIBUTE_FORM_DEFAULTS = {
  label: 'Beispiel-Attribut',
  key: 'beispiel-attribut',
  type: 'string' as CustomAttributePrimitiveType,
  description: 'z. B. zusätzliche Referenznummer',
  temporal: false,
  required: false,
};

@Component({
  selector: 'app-attribute-definition-editor',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    MatCardModule,
    MatSlideToggleModule,
  ],
  templateUrl: './attribute-definition-editor.component.html',
  styleUrl: './attribute-definition-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttributeDefinitionEditorComponent implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly customAttributes = inject(CustomAttributeService);

  protected readonly targets = this.customAttributes.getTargets();
  protected readonly selectedTargetId = signal<string>(this.targets[0]?.id ?? '');
  protected readonly activeTarget = computed<CustomAttributeTarget | null>(() => {
    const id = this.selectedTargetId();
    return this.targets.find((target) => target.id === id) ?? null;
  });
  protected readonly definitions = computed<CustomAttributeDefinition[]>(() => {
    const map = this.customAttributes.definitions();
    const id = this.selectedTargetId();
    return map[id] ?? [];
  });
  protected readonly isDirty = this.customAttributes.isDirty;

  protected readonly newAttributeForm = this.fb.group({
    label: [ATTRIBUTE_FORM_DEFAULTS.label, [Validators.required, Validators.maxLength(64)]],
    key: [ATTRIBUTE_FORM_DEFAULTS.key, [Validators.required, Validators.maxLength(64)]],
    type: [ATTRIBUTE_FORM_DEFAULTS.type, Validators.required],
    description: [ATTRIBUTE_FORM_DEFAULTS.description],
    temporal: [ATTRIBUTE_FORM_DEFAULTS.temporal],
    required: [ATTRIBUTE_FORM_DEFAULTS.required],
  });

  protected readonly editForm = this.fb.group({
    label: ['', [Validators.required, Validators.maxLength(64)]],
    key: ['', [Validators.required, Validators.maxLength(64)]],
    type: ['string' as CustomAttributePrimitiveType, Validators.required],
    description: [''],
    temporal: [false],
    required: [false],
  });

  protected readonly editingId = signal<string | null>(null);

  private readonly autoKeyEffect = effect(() => {
    const label = this.newAttributeForm.controls.label.value ?? '';
    const keyControl = this.newAttributeForm.controls.key;
    if (keyControl.dirty) {
      return;
    }
    keyControl.setValue(this.slugify(label), { emitEvent: false });
  });

  private readonly editAutoKeyEffect = effect(() => {
    const id = this.editingId();
    if (!id) {
      return;
    }
    const label = this.editForm.controls.label.value ?? '';
    const keyControl = this.editForm.controls.key;
    if (keyControl.dirty) {
      return;
    }
    keyControl.setValue(this.slugify(label), { emitEvent: false });
  });

  ngOnDestroy(): void {
    this.autoKeyEffect.destroy();
    this.editAutoKeyEffect.destroy();
  }

  protected handleTargetChange(entityId: string): void {
    this.selectedTargetId.set(entityId);
    this.editingId.set(null);
    this.newAttributeForm.reset(ATTRIBUTE_FORM_DEFAULTS);
  }

  protected startEdit(definition: CustomAttributeDefinition): void {
    this.editingId.set(definition.id);
    this.editForm.reset({
      label: definition.label,
      key: definition.key,
      type: definition.type,
      description: definition.description ?? '',
      temporal: !!definition.temporal,
      required: !!definition.required,
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editForm.reset({
      label: '',
      key: '',
      type: 'string',
      description: '',
      temporal: false,
      required: false,
    });
  }

  protected saveEdit(): void {
    const id = this.editingId();
    if (!id || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    const entityId = this.selectedTargetId();
    const raw = this.editForm.getRawValue();
    const input = this.mapToInput(raw as Partial<CustomAttributeInput>);
    this.customAttributes.update(entityId, id, input);
    this.cancelEdit();
  }

  protected remove(definition: CustomAttributeDefinition): void {
    this.customAttributes.remove(definition.entityId, definition.id);
    if (this.editingId() === definition.id) {
      this.cancelEdit();
    }
  }

  protected create(): void {
    if (this.newAttributeForm.invalid) {
      this.newAttributeForm.markAllAsTouched();
      return;
    }
    const entityId = this.selectedTargetId();
    const raw = this.newAttributeForm.getRawValue();
    const mapped = this.mapToInput(raw as Partial<CustomAttributeInput>);
    this.customAttributes.add(entityId, mapped);
    this.newAttributeForm.reset(ATTRIBUTE_FORM_DEFAULTS);
  }

  protected attributeTypeLabel(value: CustomAttributePrimitiveType): string {
    switch (value) {
      case 'string':
        return 'Text';
      case 'number':
        return 'Zahl';
      case 'boolean':
        return 'Ja/Nein';
      case 'date':
        return 'Datum';
      case 'time':
        return 'Zeit';
      default:
        return value;
    }
  }

  private mapToInput(value: Partial<CustomAttributeInput>): CustomAttributeInput {
    return {
      label: value?.label?.trim() ?? '',
      key: value?.key?.trim() ?? '',
      type: (value?.type as CustomAttributePrimitiveType) ?? 'string',
      temporal: !!value?.temporal,
      required: !!value?.required,
      description: value?.description?.trim() || undefined,
    };
  }

  private slugify(raw: string): string {
    return (raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }
}
