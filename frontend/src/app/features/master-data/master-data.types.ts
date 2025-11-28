import { Type } from '@angular/core';
import { TemporalValue } from '../../models/master-data';

export type MasterDataFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'date'
  | 'time';
export type MasterDataTemporalValue<T = unknown> = TemporalValue<T>;

export interface MasterDataOption {
  label: string;
  value: string;
}

export interface MasterDataFieldConfig {
  key: string;
  label: string;
  type: MasterDataFieldType;
  placeholder?: string;
  hint?: string;
  readonly?: boolean;
  options?: MasterDataOption[];
  temporal?: boolean;
  custom?: boolean;
}

export interface MasterDataTableColumn<T extends Record<string, unknown> = Record<string, unknown>> {
  key: string;
  label: string;
  valueAccessor?: (item: T) => string;
}

export interface MasterDataCategoryConfig<T extends { id: string }> {
  id: string;
  icon?: string;
  title: string;
  description: string;
  entityLabel: string;
  columns: MasterDataTableColumn<T>[];
  fields: MasterDataFieldConfig[];
  items: T[];
  toFormValue?: (item: T) => Record<string, unknown>;
  fromFormValue?: (value: Record<string, unknown>, previous?: T | null) => T;
  defaultValues?: () => Partial<T>;
  onItemsChange?: (items: T[]) => void;
  onSelectionChange?: (selection: T | null) => void;
  allowDelete?: boolean;
}

export interface MasterDataHierarchyConfig<P extends { id: string }, C extends { id: string }> {
  id: string;
  title: string;
  description?: string;
  relationKey: keyof C & string;
  parentRelationKey?: keyof P & string;
  parent: MasterDataCategoryConfig<P>;
  child: MasterDataCategoryConfig<C>;
  onParentItemsChange?: (items: P[]) => void;
  onChildItemsChange?: (items: C[]) => void;
}

export interface MasterDataSectionBase {
  id: string;
  title?: string;
  description?: string;
}

export interface MasterDataCategorySection extends MasterDataSectionBase {
  type: 'category';
  config: MasterDataCategoryConfig<any>;
}

export interface MasterDataHierarchySection extends MasterDataSectionBase {
  type: 'hierarchy';
  config: MasterDataHierarchyConfig<any, any>;
}

export interface MasterDataComponentSection extends MasterDataSectionBase {
  type: 'component';
  component: Type<unknown>;
  inputs?: Record<string, unknown>;
}

export type MasterDataSection =
  | MasterDataCategorySection
  | MasterDataHierarchySection
  | MasterDataComponentSection;

export interface MasterDataTabConfig {
  id: string;
  icon?: string;
  title: string;
  description: string;
  sections: MasterDataSection[];
}
