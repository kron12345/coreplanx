import { BusinessAssignment } from './business.model';

export type AutomationConditionField = 'itemTag' | 'itemType' | 'ttrPhase' | 'timetablePhase';
export type AutomationConditionOperator = 'includes' | 'excludes' | 'equals' | 'notEquals';

export interface AutomationCondition {
  id: string;
  field: AutomationConditionField;
  operator: AutomationConditionOperator;
  value: string;
}

export type BusinessTemplateDueAnchor = 'order_creation' | 'production_start' | 'go_live';

export interface BusinessTemplateDueRule {
  anchor: BusinessTemplateDueAnchor;
  offsetDays: number; // negative = before anchor
  label: string;
}

export interface BusinessTemplateStep {
  id: string;
  title: string;
  description: string;
  dueRule: BusinessTemplateDueRule;
  checklist?: string[];
}

export interface BusinessTemplateDependency {
  fromTemplateId: string;
  toTemplateId: string;
  description: string;
}

export interface BusinessTemplate {
  id: string;
  title: string;
  description: string;
  instructions?: string;
  tags: string[];
  category: 'Frist' | 'Bestellung' | 'Kommunikation' | 'Custom';
  recommendedAssignment: BusinessAssignment;
  dueRule: BusinessTemplateDueRule;
  defaultLeadTimeDays: number;
  automationHint?: string;
  steps?: BusinessTemplateStep[];
  parameterHints?: string[];
}

export interface BusinessTemplateContext {
  targetDate?: Date | null;
  linkedOrderItemIds?: string[];
  note?: string;
  customTitle?: string;
  tags?: string[];
  orderCategory?: string;
  customerPriority?: 'standard' | 'premium';
}

export interface CreateBusinessTemplatePayload {
  title: string;
  description: string;
  instructions?: string;
  assignment: BusinessAssignment;
  tags?: string[];
  dueRule: BusinessTemplateDueRule;
  defaultLeadTimeDays: number;
  category?: BusinessTemplate['category'];
  automationHint?: string;
  steps?: BusinessTemplateStep[];
  parameterHints?: string[];
}

export interface BusinessTemplateWebhookConfig {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  payloadTemplate?: string;
}

export interface BusinessTemplateAutomation {
  id: string;
  templateId: string;
  title: string;
  trigger: string;
  condition: string;
  leadTimeDays: number;
  nextRun?: string;
  active: boolean;
  nextTemplateId?: string;
  webhook?: BusinessTemplateWebhookConfig;
  testMode?: boolean;
  lastRunStatus?: 'idle' | 'success' | 'warning' | 'error';
  lastRunAt?: string;
}

export interface CreateBusinessTemplateAutomationPayload {
  templateId: string;
  title: string;
  trigger: string;
  condition: string;
  leadTimeDays: number;
  nextRun?: Date | null;
  nextTemplateId?: string;
  webhook?: BusinessTemplateWebhookConfig;
  testMode?: boolean;
}

export interface BusinessAutomationExecution {
  id: string;
  ruleId: string;
  templateId: string;
  status: 'success' | 'warning' | 'error';
  timestamp: string;
  message: string;
}

export interface BusinessAutomationTestResult {
  ruleId: string;
  success: boolean;
  message: string;
  simulatedBusinessId?: string;
}
