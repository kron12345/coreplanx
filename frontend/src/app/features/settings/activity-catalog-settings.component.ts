import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import {
  ActivityCatalogService,
  ActivityDefinition,
  ActivityTemplate,
  ActivityAttributeValue,
} from '../../core/services/activity-catalog.service';
import { ResourceKind } from '../../models/resource';
import { AbstractControl, FormGroup, FormControl } from '@angular/forms';
import { TranslationService } from '../../core/services/translation.service';
import { LayerGroupService, LayerGroup } from '../../core/services/layer-group.service';
import { ActivityTypeService } from '../../core/services/activity-type.service';

const DRAW_AS_OPTIONS = [
  'line-above',
  'line-below',
  'shift-up',
  'shift-down',
  'dot',
  'square',
  'triangle-up',
  'triangle-down',
  'thick',
  'background',
];

@Component({
  selector: 'app-activity-catalog-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatTooltipModule,
    MatTabsModule,
    MatButtonToggleModule,
  ],
  templateUrl: './activity-catalog-settings.component.html',
  styleUrl: './activity-catalog-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityCatalogSettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly catalog = inject(ActivityCatalogService);
  private readonly translationService = inject(TranslationService);
  protected readonly activityTypes = inject(ActivityTypeService);
  private readonly layerGroups = inject(LayerGroupService);
  private readonly activityTypeMap = computed(() => {
    const map = new Map<string, { label: string; category: string }>();
    this.activityTypes.definitions().forEach((t) =>
      map.set(t.id, { label: t.label, category: t.category }),
    );
    return map;
  });

  protected readonly templates = this.catalog.templates;
  protected readonly activities = this.catalog.definitions;
  protected readonly activitySearch = signal('');
  protected readonly templateSearch = signal('');
  protected readonly drawFilter = signal<string | null>(null);
  protected readonly layerFilter = signal<string | null>(null);
  protected readonly layerOptions = computed<LayerGroup[]>(() => this.layerGroups.groups());
  protected readonly sortedTemplates = computed(() =>
    [...this.templates()].sort((a, b) => a.id.localeCompare(b.id, 'de')),
  );
  protected readonly sortedActivities = computed(() =>
    [...this.activities()].sort((a, b) => a.id.localeCompare(b.id, 'de')),
  );
  protected readonly filteredActivities = computed(() => {
    const term = this.activitySearch().toLowerCase();
    const draw = (this.drawFilter() ?? '').toLowerCase();
    const layer = (this.layerFilter() ?? '').toLowerCase();
    return this.sortedActivities().filter((a) => {
      const hay = `${a.id} ${a.activityType} ${this.activityDisplayName(a)}`.toLowerCase();
      if (term && !hay.includes(term)) {
        return false;
      }
      const drawVal = (this.attributeValue(a.attributes, 'draw_as') ?? '').toLowerCase();
      if (draw && drawVal !== draw) {
        return false;
      }
      const layerVal = (this.attributeValue(a.attributes, 'layer_group') ?? '').toLowerCase();
      if (layer && layerVal !== layer) {
        return false;
      }
      return true;
    });
  });
  protected readonly filteredTemplates = computed(() => {
    const term = this.templateSearch().toLowerCase();
    if (!term) {
      return this.sortedTemplates();
    }
    return this.sortedTemplates().filter((t) => {
      const hay = `${t.id} ${t.label} ${t.activityType ?? ''}`.toLowerCase();
      return hay.includes(term);
    });
  });
  private readonly attributePresetMap = computed(() => {
    const map = new Map<string, Record<string, string>>();
    const addPreset = (key: string | null | undefined, meta?: Record<string, string>) => {
      const trimmed = (key ?? '').trim();
      if (!trimmed || map.has(trimmed)) {
        return;
      }
      map.set(trimmed, meta ?? {});
    };
    const seedMeta: Record<string, Record<string, string>> = {
      'field:start': { datatype: 'timepoint', oncreate: 'edit', onupdate: 'edit' },
      'field:end': { datatype: 'timepoint', oncreate: 'edit', onupdate: 'edit' },
      'field:from': { datatype: 'string', oncreate: 'edit', onupdate: 'edit' },
      'field:to': { datatype: 'string', oncreate: 'edit', onupdate: 'edit' },
      'field:remark': { datatype: 'string', oncreate: 'edit', onupdate: 'edit' },
      color: { datatype: 'color', value: '#1976d2' },
      consider_capacity_conflicts: { datatype: 'boolean', value: 'true' },
      is_short_break: { datatype: 'boolean', value: 'true' },
      is_break: { datatype: 'boolean', value: 'true' },
      is_service_start: { datatype: 'boolean', value: 'true' },
      is_service_end: { datatype: 'boolean', value: 'true' },
      is_absence: { datatype: 'boolean', value: 'true' },
      is_reserve: { datatype: 'boolean', value: 'true' },
      draw_as: {
        datatype: 'enum',
        options:
          'line-above,line-below,shift-up,shift-down,dot,square,triangle-up,triangle-down,thick,background',
        oncreate: 'edit',
        onupdate: 'edit',
      },
      layer_group: {
        datatype: 'enum',
        options: this.layerOptions()
          .map((g) => g.id)
          .join(','),
        oncreate: 'edit',
        onupdate: 'edit',
      },
    };
    Object.entries(seedMeta).forEach(([k, v]) => addPreset(k, v));
    this.templates().forEach((tpl) => (tpl.attributes ?? []).forEach((attr) => addPreset(attr.key, attr.meta)));
    this.activities().forEach((def) => (def.attributes ?? []).forEach((attr) => addPreset(attr.key, attr.meta)));
    return map;
  });
  protected readonly attributePresets = computed(() =>
    Array.from(this.attributePresetMap().entries()).map(([key, meta]) => ({ key, meta })),
  );
  protected readonly DRAW_AS_OPTIONS = DRAW_AS_OPTIONS;

  protected readonly templateEditId = signal<string | null>(null);
  protected readonly activityEditId = signal<string | null>(null);
  protected readonly selectedTemplate = computed<ActivityTemplate | null>(() => {
    const id = this.templateEditId();
    return id ? this.templates().find((t) => t.id === id) ?? null : null;
  });
  protected readonly selectedActivity = computed<ActivityDefinition | null>(() => {
    const id = this.activityEditId();
    return id ? this.activities().find((a) => a.id === id) ?? null : null;
  });

  protected readonly templateForm = this.fb.group({
    label: ['', [Validators.required, Validators.maxLength(80)]],
    id: ['', [Validators.required, Validators.maxLength(80)]],
    description: [''],
    activityType: [''],
    defaultDurationMinutes: [null as number | null],
    attributes: this.fb.array([]),
  });

  protected readonly activityForm = this.fb.group({
    label: ['', [Validators.maxLength(80)]],
    id: ['', [Validators.required, Validators.maxLength(80)]],
    activityType: ['', [Validators.required, Validators.maxLength(80)]],
    templateId: [null as string | null],
    attributes: this.fb.array([]),
  });

  private readonly templatesById = computed(() =>
    new Map(this.templates().map((t) => [t.id, t] as const)),
  );

  protected get templateAttributes(): FormArray {
    return this.templateForm.get('attributes') as FormArray;
  }

  protected get activityAttributes(): FormArray {
    return this.activityForm.get('attributes') as FormArray;
  }

  private normalizeAttributes(attrs: ActivityAttributeValue[] | null | undefined): ActivityAttributeValue[] {
    if (!attrs) {
      return [];
    }
    return attrs.map((a) => (a.key === 'layer' ? { ...a, key: 'layer_group' } : a));
  }

  protected attributeValue(attrs: ActivityAttributeValue[] | null | undefined, key: string): string | null {
    let entry = (attrs ?? []).find((a) => a.key === key);
    if (!entry && key === 'layer_group') {
      entry = (attrs ?? []).find((a) => a.key === 'layer');
    }
    const val = entry?.meta?.['value'];
    return typeof val === 'string' ? val : val != null ? String(val) : null;
  }

  protected selectedColor(): string {
    const attr = this.selectedActivity();
    const color = attr ? this.attributeValue(attr.attributes, 'color') : null;
    return color || '#1976d2';
  }

  protected selectedDrawAs(): string {
    const attr = this.selectedActivity();
    return (attr ? this.attributeValue(attr.attributes, 'draw_as') : null) || 'bar';
  }

  protected selectedLayer(): string {
    const attr = this.selectedActivity();
    return (attr ? this.attributeValue(attr.attributes, 'layer_group') : null) || 'default';
  }

  protected typeLabel(typeId: string): string {
    return this.activityTypeMap().get(typeId)?.label ?? typeId;
  }

  protected activityDisplayName(activity: ActivityDefinition): string {
    const typeLabel = this.typeLabel(activity.activityType);
    return (
      this.translationService.translate(`activityType:${activity.activityType}`, typeLabel) ||
      typeLabel
    );
  }

  protected startTemplateEdit(template: ActivityTemplate): void {
    this.templateEditId.set(template.id);
    this.templateForm.reset({
      label: template.label,
      id: template.id,
      description: template.description ?? '',
      activityType: template.activityType ?? '',
      defaultDurationMinutes: template.defaultDurationMinutes ?? null,
    });
    this.setAttributes(this.templateAttributes, this.normalizeAttributes(template.attributes));
  }

  protected newTemplate(): void {
    this.cancelTemplateEdit();
  }

  protected cancelTemplateEdit(): void {
    this.templateEditId.set(null);
    this.templateForm.reset({
      label: '',
      id: '',
      description: '',
      activityType: '',
      defaultDurationMinutes: null,
    });
    this.templateAttributes.clear();
  }

  protected saveTemplate(): void {
    if (this.templateForm.invalid) {
      this.templateForm.markAllAsTouched();
      return;
    }
    const payload = this.buildTemplatePayload();
    const id = this.templateEditId();
    if (id) {
      this.catalog.updateTemplate(id, payload);
    } else {
      this.catalog.addTemplate(payload);
    }
    this.cancelTemplateEdit();
  }

  protected removeTemplate(template: ActivityTemplate): void {
    this.catalog.removeTemplate(template.id);
    if (this.templateEditId() === template.id) {
      this.cancelTemplateEdit();
    }
  }

  protected startActivityEdit(activity: ActivityDefinition): void {
    this.activityEditId.set(activity.id);
    const normalizedAttrs = this.normalizeAttributes(activity.attributes);
    const attrMap = new Map(normalizedAttrs.map((a) => [a.key, a] as const));
    const durationAttr = attrMap.get('default_duration');
    const relevantAttr = attrMap.get('relevant_for');
    const duration =
      durationAttr?.meta?.['value'] && Number(durationAttr.meta['value']) > 0
        ? Number(durationAttr.meta['value'])
        : activity.defaultDurationMinutes ?? null;
    const relevantRaw =
      relevantAttr?.meta?.['value'] && typeof relevantAttr.meta['value'] === 'string'
        ? (relevantAttr.meta['value'] as string)
        : null;
    const relevant =
      relevantRaw?.split(',').map((v) => v.trim()).filter(Boolean) ??
      activity.relevantFor ??
      [];
    this.activityForm.reset({
      label: this.translationService.translate(`activityType:${activity.activityType}`, activity.label),
      id: activity.id,
      activityType: activity.activityType,
      templateId: activity.templateId ?? null,
    });
    this.setAttributes(this.activityAttributes, normalizedAttrs);
    // Falls Attribute fehlen, optional hinzufügen
    if (duration && !attrMap.has('default_duration')) {
      this.addActivityAttributeFromPreset('default_duration');
      const last = this.activityAttributes.at(this.activityAttributes.length - 1) as FormGroup;
      this.metaValueControl(last).setValue(duration.toString());
    }
    if (relevant.length && !attrMap.has('relevant_for')) {
      this.addActivityAttributeFromPreset('relevant_for');
      const last = this.activityAttributes.at(this.activityAttributes.length - 1) as FormGroup;
      this.metaValueControl(last).setValue(relevant.join(','));
    }
  }

  protected newActivity(): void {
    this.cancelActivityEdit();
  }

  protected cancelActivityEdit(): void {
    this.activityEditId.set(null);
    this.activityForm.reset({
      label: '',
      id: '',
      activityType: '',
      templateId: null,
    });
    this.activityAttributes.clear();
  }

  protected saveActivity(): void {
    if (this.activityForm.invalid) {
      this.activityForm.markAllAsTouched();
      return;
    }
    const payload = this.buildActivityPayload();
    const id = this.activityEditId();
    if (id) {
      this.catalog.updateDefinition(id, payload);
    } else {
      this.catalog.addDefinition(payload);
    }
    this.cancelActivityEdit();
  }

  protected removeActivity(activity: ActivityDefinition): void {
    this.catalog.removeDefinition(activity.id);
    if (this.activityEditId() === activity.id) {
      this.cancelActivityEdit();
    }
  }

  protected addTemplateAttribute(): void {
    this.templateAttributes.push(this.buildAttributeGroup());
  }

  protected addActivityAttribute(): void {
    this.activityAttributes.push(this.buildAttributeGroup());
  }

  protected addTemplateMeta(attrGroup: AbstractControl): void {
    const metaArray = this.attributeMetaArray(attrGroup);
    metaArray.push(this.buildMetaGroup());
  }

  protected removeTemplateMeta(attrGroup: AbstractControl, index: number): void {
    this.attributeMetaArray(attrGroup).removeAt(index);
  }

  protected templateMetaControls(attrGroup: AbstractControl) {
    return this.attributeMetaArray(attrGroup).controls;
  }

  protected addActivityMeta(attrGroup: AbstractControl): void {
    const metaArray = this.attributeMetaArray(attrGroup);
    metaArray.push(this.buildMetaGroup());
  }

  protected removeActivityMeta(attrGroup: AbstractControl, index: number): void {
    this.attributeMetaArray(attrGroup).removeAt(index);
  }

  protected activityMetaControls(attrGroup: AbstractControl) {
    return this.attributeMetaArray(attrGroup).controls;
  }

  protected removeTemplateAttribute(index: number): void {
    this.templateAttributes.removeAt(index);
  }

  protected removeActivityAttribute(index: number): void {
    this.activityAttributes.removeAt(index);
  }

  protected addTemplateAttributeFromPreset(presetKey: string | null): void {
    if (!presetKey) {
      return;
    }
    const group = this.buildAttributeGroup();
    this.applyPreset(group, presetKey);
    this.templateAttributes.push(group);
  }

  protected addActivityAttributeFromPreset(presetKey: string | null): void {
    if (!presetKey) {
      return;
    }
    const group = this.buildAttributeGroup();
    this.applyPreset(group, presetKey);
    this.activityAttributes.push(group);
  }

  protected applyTemplateToActivity(templateId: string | null): void {
    if (!templateId) {
      return;
    }
    const template = this.templatesById().get(templateId);
    if (!template) {
      return;
    }
    this.activityForm.patchValue({
      activityType: template.activityType ?? this.activityForm.controls.activityType.value,
    });
    this.setAttributes(this.activityAttributes, template.attributes);
  }

  private buildAttributeGroup(value?: ActivityAttributeValue) {
    return this.fb.group({
      key: [value?.key ?? '', [Validators.required, Validators.maxLength(80)]],
      meta: this.fb.array(
        Object.entries(value?.meta ?? {}).map(([k, v]) =>
          this.buildMetaGroup(k, v),
        ),
      ),
    });
  }

  private buildMetaGroup(key?: string, value?: string) {
    return this.fb.group({
      key: [key ?? '', [Validators.required, Validators.maxLength(80)]],
      value: [value ?? '', [Validators.required, Validators.maxLength(256)]],
    });
  }

  protected attributeMetaArray(attrGroup: AbstractControl): FormArray {
    const fg = attrGroup as FormGroup;
    return fg.get('meta') as FormArray;
  }

  private applyPreset(attrGroup: AbstractControl, presetKey: string): void {
    const preset = this.attributePresetMap().get(presetKey);
    const fg = attrGroup as FormGroup;
    fg.get('key')?.setValue(presetKey);
    if (preset) {
      const metaArray = this.attributeMetaArray(attrGroup);
      metaArray.clear();
      Object.entries(preset).forEach(([k, v]) => {
        metaArray.push(this.buildMetaGroup(k, v));
      });
    }
  }

  private setAttributes(formArray: FormArray, attributes: ActivityAttributeValue[]): void {
    formArray.clear();
    attributes.forEach((attr) => formArray.push(this.buildAttributeGroup(attr)));
  }

  private collectAttributes(formArray: FormArray): ActivityAttributeValue[] {
    return formArray.controls
      .map((ctrl) => ctrl.value as ActivityAttributeValue)
      .filter((entry) => entry && entry.key)
      .map((entry, index) => {
        const metaCtrlArray = (formArray.at(index) as any).get('meta') as FormArray | null;
        const meta =
          metaCtrlArray && metaCtrlArray.value
            ? metaCtrlArray.value
                .filter((m: { key?: string; value?: string }) => m && m.key && m.value)
                .reduce((acc: Record<string, string>, curr: { key: string; value: string }) => {
                  acc[curr.key.trim()] = curr.value.toString().trim();
                  return acc;
                }, {})
            : undefined;
        return {
          key: entry.key.trim(),
          meta: meta && Object.keys(meta).length ? meta : undefined,
        };
      });
  }

  private buildTemplatePayload(): ActivityTemplate {
    const raw = this.templateForm.getRawValue();
    return {
      id: (raw.id ?? '').trim(),
      label: (raw.label ?? '').trim(),
      description: raw.description?.trim() || undefined,
      activityType: raw.activityType?.trim() || undefined,
      defaultDurationMinutes: raw.defaultDurationMinutes ?? null,
      attributes: this.collectAttributes(this.templateAttributes),
    };
  }

  private buildActivityPayload(): ActivityDefinition {
    const raw = this.activityForm.getRawValue();
    const attrs = this.collectAttributes(this.activityAttributes);
    const activityTypeId = (raw.activityType ?? '').trim();
    const fallbackTypeLabel =
      this.activityTypes.definitions().find((type) => type.id === activityTypeId)?.label ??
      activityTypeId;
    const translatedLabel = this.translationService.translate(
      `activityType:${activityTypeId}`,
      fallbackTypeLabel,
    );
    return {
      id: (raw.id ?? '').trim(),
      label: translatedLabel || fallbackTypeLabel,
      activityType: activityTypeId,
      templateId: raw.templateId ?? null,
      defaultDurationMinutes: null,
      relevantFor: [],
      attributes: attrs,
    };
  }

  protected metaValueControl(attrGroup: AbstractControl): FormControl {
    const fg = attrGroup as FormGroup;
    const metaArray = fg.get('meta') as FormArray;
    let ctrl = metaArray.controls.find(
      (c) => (c.get('key')?.value as string)?.trim() === 'value',
    ) as FormGroup | undefined;
    if (!ctrl) {
      ctrl = this.buildMetaGroup('value', '');
      metaArray.push(ctrl);
    }
    return ctrl.get('value') as FormControl;
  }

  protected updateRelevantForMeta(attrGroup: AbstractControl, values: string[]): void {
    const ctrl = this.metaValueControl(attrGroup);
    ctrl.setValue(values.join(','));
  }
}
