import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import {
  MasterDataCategoryConfig,
  MasterDataFieldConfig,
  MasterDataTemporalValue,
} from '../../master-data.types';

@Component({
  selector: 'app-master-data-category',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    MatSlideToggleModule,
  ],
  templateUrl: './master-data-category.component.html',
  styleUrl: './master-data-category.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MasterDataCategoryComponent<T extends { id: string }> implements OnChanges {
  @Input({ required: true }) config!: MasterDataCategoryConfig<T>;
  @Output() readonly selectionChange = new EventEmitter<T | null>();
  @Output() readonly itemsChange = new EventEmitter<T[]>();

  protected readonly items = signal<T[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected form!: FormGroup;
  private lastConfigId: string | null = null;
  private lastFieldsSignature: string | null = null;
  private temporalFieldKeys = new Set<string>();
  protected readonly temporalHistoryVisibility = signal<Record<string, boolean>>({});

  protected readonly displayedColumns = computed(() => [
    ...this.config.columns.map((column) => column.key),
    'actions',
  ]);

  protected readonly selectedItem = computed(() => {
    const id = this.selectedId();
    if (!id) {
      return null;
    }

    return this.items().find((item) => item.id === id) ?? null;
  });

  constructor(private readonly fb: FormBuilder) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config']) {
      const currentConfig = this.config;

      const currentFieldsSignature = this.createFieldsSignature(currentConfig.fields);
      this.temporalFieldKeys = new Set(
        currentConfig.fields.filter((field) => field.temporal).map((field) => field.key),
      );
      this.temporalHistoryVisibility.set({});
      const shouldRebuildForm =
        !this.form ||
        this.lastConfigId !== currentConfig.id ||
        this.lastFieldsSignature !== currentFieldsSignature;

      if (shouldRebuildForm) {
        this.buildForm();
        this.lastConfigId = currentConfig.id;
        this.lastFieldsSignature = currentFieldsSignature;
      }

      this.items.set(this.cloneItems(currentConfig.items));

      const currentSelection = this.selectedId();
      const hasSelection =
        !!currentSelection &&
        currentConfig.items.some((item) => item.id === currentSelection);

      const nextSelection = hasSelection
        ? currentSelection
        : currentConfig.items[0]?.id ?? null;

      this.selectedId.set(nextSelection);
      this.patchForm(nextSelection);
      this.emitSelection();
    }
  }

  protected handleSelect(id: string): void {
    this.selectedId.set(id);
    this.patchForm(id);
    this.emitSelection();
  }

  protected handleCreate(): void {
    const pendingId = this.generateItemId();
    const emptyItem = this.createEmptyItem(pendingId);
    const defaults = this.config.defaultValues?.() ?? {};
    const newItem = { ...emptyItem, ...defaults, id: emptyItem.id } as T;
    this.items.update((current) => [...current, newItem]);
    this.selectedId.set(newItem.id);
    this.patchForm(newItem.id);
    this.emitItems();
    this.emitSelection();
  }

  protected handleSave(): void {
    if (!this.form || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const rawValue = this.form.getRawValue() as Record<string, unknown>;
    const normalized = this.normalizeFormValue(rawValue);
    const currentItem = this.selectedItem();
    const updatedBase = this.config.fromFormValue
      ? this.config.fromFormValue(normalized, currentItem)
      : ({ ...currentItem, ...normalized } as T);
    const updated = this.applyCustomAttributes(updatedBase, normalized);

    this.items.update((current) =>
      current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
    );
    this.emitItems();
  }

  protected handleDelete(): void {
    if (!this.config || this.config.allowDelete === false) {
      return;
    }
    const selection = this.selectedItem();
    if (!selection) {
      return;
    }
    this.items.update((current) => current.filter((item) => item.id !== selection.id));
    const updatedItems = this.items();
    const nextSelectionId = updatedItems[0]?.id ?? null;
    this.selectedId.set(nextSelectionId);
    this.patchForm(nextSelectionId);
    this.emitItems();
    this.emitSelection();
  }

  protected displayCell(row: T, columnKey: string): string {
    const column = this.config.columns.find((col) => col.key === columnKey);
    if (!column) {
      return '';
    }

    if (column.valueAccessor) {
      return column.valueAccessor(row);
    }

    const value = (row as Record<string, unknown>)[columnKey];
    if (this.temporalFieldKeys.has(columnKey) && Array.isArray(value)) {
      return this.formatTemporalValue(value as MasterDataTemporalValue[]);
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (typeof value === 'boolean') {
      return value ? 'Ja' : 'Nein';
    }
    if (value == null) {
      return '—';
    }
    return String(value);
  }

  protected fieldOptions(field: MasterDataFieldConfig) {
    return field.options ?? [];
  }

  protected canClearField(field: MasterDataFieldConfig): boolean {
    if (field.temporal || field.readonly || field.type === 'boolean') {
      return false;
    }
    const control = this.form?.get(field.key);
    return !!control;
  }

  protected isFieldEmpty(field: MasterDataFieldConfig): boolean {
    const control = this.form?.get(field.key);
    if (!control) {
      return true;
    }
    const value = control.value;
    if (field.type === 'multiselect') {
      return !Array.isArray(value) || value.length === 0;
    }
    if (field.type === 'number') {
      return value === null || value === undefined || value === '';
    }
    if (field.type === 'boolean') {
      return value === null || value === undefined;
    }
    return value === null || value === undefined || String(value).length === 0;
  }

  protected clearField(field: MasterDataFieldConfig): void {
    const control = this.form?.get(field.key);
    if (!control) {
      return;
    }

    let nextValue: unknown;
    switch (field.type) {
      case 'multiselect':
        nextValue = [];
        break;
      case 'number':
        nextValue = null;
        break;
      case 'date':
      case 'time':
      case 'text':
      case 'textarea':
      case 'select':
        nextValue = '';
        break;
      default:
        nextValue = this.defaultValueForField(field);
        break;
    }

    control.setValue(nextValue);
    control.markAsDirty();
    control.markAsTouched();
  }

  protected trackById(_index: number, item: T): string {
    return item.id;
  }

  protected isTemporalField(field: MasterDataFieldConfig): boolean {
    return !!field.temporal;
  }

  protected temporalControls(fieldKey: string): FormArray<FormGroup> {
    const control = this.form?.get(fieldKey);
    if (control instanceof FormArray) {
      return control as FormArray<FormGroup>;
    }
    throw new Error(`Temporal control for "${fieldKey}" not found.`);
  }

  protected temporalInputType(field: MasterDataFieldConfig): 'text' | 'number' {
    return field.type === 'number' ? 'number' : 'text';
  }

  protected addTemporalEntry(field: MasterDataFieldConfig): void {
    const controls = this.temporalControls(field.key);
    controls.insert(0, this.createTemporalEntryGroup(field));
    this.markTemporalArrayValidities(field.key);
  }

  protected removeTemporalEntry(fieldKey: string, index: number): void {
    const controls = this.temporalControls(fieldKey);
    if (controls.length <= 1) {
      const group = controls.at(index);
      if (group instanceof FormGroup) {
        group.reset({ value: '', validFrom: '', validTo: '' });
      }
      this.markTemporalArrayValidities(fieldKey);
      return;
    }
    controls.removeAt(index);
    this.markTemporalArrayValidities(fieldKey);
    if (controls.length <= 1) {
      this.hideTemporalHistory(fieldKey);
    }
  }

  protected trackByIndex(index: number): number {
    return index;
  }

  protected isTemporalHistoryVisible(fieldKey: string): boolean {
    return !!this.temporalHistoryVisibility()[fieldKey];
  }

  protected toggleTemporalHistory(fieldKey: string): void {
    this.temporalHistoryVisibility.update((current) => ({
      ...current,
      [fieldKey]: !current[fieldKey],
    }));
  }

  private buildForm(): void {
    const groupConfig: Record<string, unknown> = {
      id: [''],
    };

    for (const field of this.config.fields) {
      if (field.temporal) {
        groupConfig[field.key] = this.createTemporalFormArray(field);
      } else {
        groupConfig[field.key] = this.fb.control({
          value: this.defaultValueForField(field),
          disabled: field.readonly ?? false,
        });
      }
    }

    this.form = this.fb.group(groupConfig);
  }

  private createEmptyItem(id: string): T {
    const empty = this.config.fields.reduce<Record<string, unknown>>((acc, field) => {
      if (field.temporal) {
        acc[field.key] = [];
      } else {
        acc[field.key] = this.defaultValueForField(field);
      }
      return acc;
    }, {});
    if (this.config.fields.some((field) => field.custom)) {
      empty['attributes'] = {};
    }

    return { id, ...empty } as T;
  }

  private cloneItems(items: T[]): T[] {
    return items.map((item) => this.cloneItem(item));
  }

  private patchForm(id: string | null): void {
    if (!this.form) {
      return;
    }
    if (!id) {
      this.form.reset();
      this.resetTemporalFields();
      return;
    }
    const item = this.items().find((entry) => entry.id === id);
    if (!item) {
      this.form.reset();
      this.resetTemporalFields();
      return;
    }
    const formValue = this.config.toFormValue
      ? this.config.toFormValue(item)
      : (item as Record<string, unknown>);
    this.form.get('id')?.setValue(formValue['id'] ?? id, { emitEvent: false });

    for (const field of this.config.fields) {
      if (field.temporal) {
        this.setTemporalFormArray(
          field,
          formValue[field.key] as MasterDataTemporalValue[] | undefined,
        );
        continue;
      }

      const control = this.form.get(field.key);
      if (!control) {
        continue;
      }

      const sourceValue = this.resolveFieldValue(field, formValue, item);
      const normalized = this.normalizeControlValue(field, sourceValue);
      control.setValue(normalized, { emitEvent: false });
      if (field.readonly) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    }
  }

  private emitSelection(): void {
    const selection = this.selectedItem();
    const clonedSelection = selection ? (this.cloneItem(selection) as T) : null;
    this.selectionChange.emit(selection);
    if (this.config.onSelectionChange) {
      this.config.onSelectionChange(clonedSelection);
    }
  }

  private emitItems(): void {
    const snapshot = this.cloneItems(this.items());
    this.itemsChange.emit(snapshot);
    if (this.config.onItemsChange) {
      this.config.onItemsChange(snapshot);
    }
  }

  private resetTemporalFields(): void {
    for (const field of this.config.fields) {
      if (field.temporal) {
        this.setTemporalFormArray(field, []);
      }
    }
  }

  private createTemporalFormArray(
    field: MasterDataFieldConfig,
    values?: MasterDataTemporalValue[] | undefined,
  ): FormArray<FormGroup> {
    const array = new FormArray<FormGroup>([]);
    const sortedValues = values && values.length > 0 ? this.sortTemporalEntries(values) : [];
    const entries = sortedValues.length > 0 ? sortedValues : [undefined];

    for (const entry of entries) {
      array.push(this.createTemporalEntryGroup(field, entry as MasterDataTemporalValue | undefined));
    }

    return array;
  }

  private createTemporalEntryGroup(
    field: MasterDataFieldConfig,
    entry?: MasterDataTemporalValue,
  ): FormGroup {
    const initialValue = this.initialTemporalInputValue(field, entry?.value);
    const group = this.fb.group(
      {
        value: [{ value: initialValue, disabled: field.readonly ?? false }, Validators.required],
        validFrom: [entry?.validFrom ?? '', Validators.required],
        validTo: [entry?.validTo ?? ''],
      },
      {
        validators: (group: AbstractControl): ValidationErrors | null =>
          this.validateTemporalEntry(group as FormGroup),
      },
    );
    group.valueChanges.subscribe(() => this.markTemporalArrayValidities(field.key));
    return group;
  }

  private validateTemporalEntry(group: FormGroup): ValidationErrors | null {
    if (!group) {
      return null;
    }
    const value = group.get('value')?.value;
    const validFrom = group.get('validFrom')?.value;
    const validTo = group.get('validTo')?.value;

    if (value == null || value === '' || !validFrom) {
      return null;
    }

    if (validTo && validTo < validFrom) {
      return { invalidRange: true };
    }

    return null;
  }

  private hideTemporalHistory(fieldKey: string): void {
    this.temporalHistoryVisibility.update((current) => {
      if (!current[fieldKey]) {
        return current;
      }
      const { [fieldKey]: _, ...rest } = current;
      return rest;
    });
  }

  private markTemporalArrayValidities(fieldKey: string): void {
    const array = this.temporalControls(fieldKey);
    const field = this.getFieldConfig(fieldKey);
    for (let index = 0; index < array.length; index += 1) {
      array.at(index).updateValueAndValidity({ emitEvent: false });
    }
    if (!field) {
      array.setErrors(null, { emitEvent: false });
      return;
    }

    const rawEntries = array.controls.map((ctrl) => ctrl.getRawValue() as Record<string, unknown>);
    const normalizedEntries = rawEntries
      .map((entry) => {
        const value = this.normalizeTemporalValue(field, entry['value']);
        const validFrom = this.normalizeDate(entry['validFrom']);
        const validTo = this.normalizeDate(entry['validTo']) || null;
        return { value, validFrom, validTo };
      })
      .filter((entry) => entry.value !== null && entry.value !== '');

    const errors: ValidationErrors = {};

    const hasMissingStart = normalizedEntries.some((entry) => !entry.validFrom);
    if (hasMissingStart) {
      errors['missingStart'] = true;
    }

    const hasInvalidRange = array.controls.some((ctrl) => ctrl.hasError('invalidRange'));
    if (hasInvalidRange) {
      errors['invalidRange'] = true;
    }

    const sorted = normalizedEntries
      .filter((entry) => entry.validFrom)
      .sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''));

    let hasOverlap = false;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];
      if (!current.validTo) {
        hasOverlap = true;
        break;
      }
      if (current.validTo >= next.validFrom!) {
        hasOverlap = true;
        break;
      }
    }

    if (hasOverlap) {
      errors['overlap'] = true;
    }

    const hasErrors = Object.keys(errors).length > 0;
    array.setErrors(hasErrors ? errors : null, { emitEvent: false });
  }

  private getFieldConfig(fieldKey: string): MasterDataFieldConfig | undefined {
    return this.config.fields.find((field) => field.key === fieldKey);
  }

  private initialTemporalInputValue(field: MasterDataFieldConfig, value: unknown): unknown {
    if (field.type === 'number') {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  }

  private setTemporalFormArray(
    field: MasterDataFieldConfig,
    values: MasterDataTemporalValue[] | undefined,
  ): void {
    this.hideTemporalHistory(field.key);
    const nextArray = this.createTemporalFormArray(field, values);
    this.form.setControl(field.key, nextArray, { emitEvent: false });
    if (nextArray.length <= 1) {
      this.hideTemporalHistory(field.key);
    }
    this.markTemporalArrayValidities(field.key);
  }

  private normalizeControlValue(field: MasterDataFieldConfig, value: unknown): unknown {
    if (field.type === 'multiselect') {
      return Array.isArray(value) ? [...(value as unknown[])] : [];
    }
    if (field.type === 'number') {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    if (field.type === 'boolean') {
      return !!value;
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  }

  private normalizeFormValue(rawValue: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = { ...rawValue };

    for (const field of this.config.fields) {
      const value = rawValue[field.key];
      if (field.temporal) {
        const entries = Array.isArray(value) ? (value as unknown[]) : [];
        const normalizedEntries = entries
          .map((entry) => this.normalizeTemporalFormEntry(field, entry as Record<string, unknown>))
          .filter((entry): entry is MasterDataTemporalValue => entry !== null);
        normalized[field.key] = this.sortTemporalEntries(normalizedEntries);
        continue;
      }

      normalized[field.key] = this.normalizeControlValue(field, value);
    }

    return normalized;
  }

  private resolveFieldValue(
    field: MasterDataFieldConfig,
    formValue: Record<string, unknown>,
    item: T | null,
  ): unknown {
    if (field.custom) {
      if (Object.prototype.hasOwnProperty.call(formValue, field.key)) {
        return formValue[field.key];
      }
      const attributes = this.extractAttributes(item);
      if (attributes && Object.prototype.hasOwnProperty.call(attributes, field.key)) {
        return attributes[field.key];
      }
    }
    return formValue[field.key];
  }

  private extractAttributes(source: unknown): Record<string, unknown> | undefined {
    if (!source || typeof source !== 'object') {
      return undefined;
    }
    const attributes = (source as Record<string, unknown>)['attributes'];
    if (!attributes || typeof attributes !== 'object') {
      return undefined;
    }
    return attributes as Record<string, unknown>;
  }

  private applyCustomAttributes(item: T, normalizedFormValue: Record<string, unknown>): T {
    const customKeys = this.customFieldKeys();
    if (customKeys.length === 0) {
      return item;
    }
    const base = item as Record<string, unknown>;
    const currentAttributes: Record<string, unknown> = {
      ...(this.extractAttributes(base) ?? {}),
    };
    let changed = false;

    for (const key of customKeys) {
      if (!Object.prototype.hasOwnProperty.call(normalizedFormValue, key)) {
        continue;
      }
      const value = normalizedFormValue[key];
      if (this.isEmptyCustomValue(value)) {
        if (key in currentAttributes) {
          delete currentAttributes[key];
          changed = true;
        }
      } else {
        currentAttributes[key] = value;
        changed = true;
      }
      if (key in base) {
        delete base[key];
      }
    }

    if (changed) {
      if (Object.keys(currentAttributes).length > 0) {
        base['attributes'] = currentAttributes;
      } else {
        delete base['attributes'];
      }
    }
    return base as T;
  }

  private customFieldKeys(): string[] {
    return this.config.fields.filter((field) => field.custom).map((field) => field.key);
  }

  private isEmptyCustomValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    if (typeof value === 'string') {
      return value.trim().length === 0;
    }
    return false;
  }

  private normalizeTemporalFormEntry(
    field: MasterDataFieldConfig,
    entry: Record<string, unknown>,
  ): MasterDataTemporalValue | null {
    if (!entry) {
      return null;
    }

    const normalizedValue = this.normalizeTemporalValue(field, entry['value']);
    if (normalizedValue === null || normalizedValue === '') {
      return null;
    }

    const validFrom = this.normalizeDate(entry['validFrom']);
    if (!validFrom) {
      return null;
    }
    const validToRaw = this.normalizeDate(entry['validTo']);

    return {
      value: normalizedValue,
      validFrom,
      validTo: validToRaw || null,
    };
  }

  private normalizeTemporalValue(field: MasterDataFieldConfig, value: unknown): unknown {
    if (field.type === 'number') {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value).trim();
  }

  private normalizeDate(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (!value) {
      return '';
    }
    return String(value);
  }

  private sortTemporalEntries(entries: MasterDataTemporalValue[]): MasterDataTemporalValue[] {
    return [...entries].sort((a, b) => (b.validFrom ?? '').localeCompare(a.validFrom ?? ''));
  }

  private formatTemporalValue(entries: MasterDataTemporalValue[]): string {
    if (!Array.isArray(entries) || entries.length === 0) {
      return '—';
    }

    const normalized = entries.filter((entry) => {
      if (!entry) {
        return false;
      }
      if (entry.value === null || entry.value === undefined) {
        return false;
      }
      const label = `${entry.value}`.trim();
      return label.length > 0;
    });

    if (normalized.length === 0) {
      return '—';
    }

    const today = this.today();
    const active = normalized.find((entry) => this.isDateInRange(today, entry.validFrom, entry.validTo));
    const sorted = this.sortTemporalEntries(normalized);
    const current = active ?? sorted[0];
    const label = String(current.value);
    return label;
  }

  private isDateInRange(date: string, from?: string | null, to?: string | null): boolean {
    const afterStart = !from || date >= from;
    const beforeEnd = !to || date <= to;
    return afterStart && beforeEnd;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  protected temporalEntryControl(
    fieldKey: string,
    index: number,
    control: 'value' | 'validFrom' | 'validTo',
  ): AbstractControl | null {
    const array = this.temporalControls(fieldKey);
    const group = array.at(index);
    if (group instanceof FormGroup) {
      return group.get(control);
    }
    return null;
  }

  protected temporalEntryControlHasError(
    fieldKey: string,
    index: number,
    control: 'value' | 'validFrom' | 'validTo',
    error: string,
  ): boolean {
    const ctrl = this.temporalEntryControl(fieldKey, index, control);
    if (!ctrl) {
      return false;
    }
    return !!(ctrl.hasError(error) && (ctrl.dirty || ctrl.touched));
  }

  protected temporalEntryHasGroupError(fieldKey: string, index: number, error: string): boolean {
    const array = this.temporalControls(fieldKey);
    const group = array.at(index);
    if (!(group instanceof FormGroup)) {
      return false;
    }
    return !!(group.hasError(error) && (group.dirty || group.touched));
  }

  private cloneItem(item: T): T {
    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      clone[key] = this.cloneValue(value);
    }
    return clone as T;
  }

  private cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.cloneValue(entry));
    }
    if (value && typeof value === 'object') {
      return { ...(value as Record<string, unknown>) };
    }
    return value;
  }

  private createFieldsSignature(fields: MasterDataFieldConfig[]): string {
    return fields
      .map((field) => [
        field.key,
        field.type,
        field.placeholder ?? '',
        field.hint ?? '',
        field.readonly ? '1' : '0',
        field.temporal ? '1' : '0',
        Array.isArray(field.options)
          ? field.options.map((option) => `${option.value}:${option.label}`).join('|')
          : '',
      ])
      .join(';');
  }

  private defaultValueForField(field: MasterDataFieldConfig): unknown {
    switch (field.type) {
      case 'multiselect':
        return [];
      case 'number':
        return null;
      case 'boolean':
        return false;
      default:
        return '';
    }
  }

  private generateItemId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `md-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
