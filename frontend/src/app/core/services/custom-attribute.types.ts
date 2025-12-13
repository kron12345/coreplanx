export type CustomAttributePrimitiveType = 'string' | 'number' | 'boolean' | 'date' | 'time';

export interface CustomAttributeDefinition {
  id: string;
  key: string;
  label: string;
  type: CustomAttributePrimitiveType;
  description?: string;
  entityId: string;
  createdAt?: string;
  updatedAt?: string;
  /**
   * Kennzeichnet Attribute, die eine zeitliche Historie haben
   * (z. B. Werte mit Gültig-ab/-bis im Stammdatenformular).
   */
  temporal?: boolean;
  /**
   * Markiert Attribute als Pflichtfeld im Editor.
   */
  required?: boolean;
}

export interface CustomAttributeInput {
  label: string;
  type: CustomAttributePrimitiveType;
  description?: string;
  key?: string;
  temporal?: boolean;
  required?: boolean;
}

export interface CustomAttributeTarget {
  id: string;
  label: string;
  group: 'personal' | 'vehicle' | 'general';
  description: string;
}

export type CustomAttributeState = Record<string, CustomAttributeDefinition[]>;
