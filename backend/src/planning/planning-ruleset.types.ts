export type RulesetExpressionOperator =
  | 'and'
  | 'or'
  | 'not'
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in';

export type RulesetOperand =
  | { var: string }
  | { value: string | number | boolean | null | Array<string | number | boolean> };

export type RulesetExpression =
  | { op: 'and' | 'or'; args: RulesetExpression[] }
  | { op: 'not'; arg: RulesetExpression }
  | {
      op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
      left: RulesetOperand;
      right: RulesetOperand;
    };

export interface RulesetInclude {
  id: string;
  version: string;
}

export interface RulesetCondition {
  id: string;
  expr: RulesetExpression;
  description?: string;
}

export interface RulesetConstraintDefinition {
  type: string;
  params?: Record<string, unknown>;
}

export interface RulesetConstraint {
  id: string;
  constraint: RulesetConstraintDefinition;
  when?: RulesetExpression;
  description?: string;
}

export interface RulesetPenalty {
  weight: number;
  maxPenalty?: number;
}

export interface RulesetSoftConstraint extends RulesetConstraint {
  penalty: RulesetPenalty;
}

export interface RulesetObjectiveTerm {
  id: string;
  term: RulesetConstraintDefinition;
  weight: number;
  when?: RulesetExpression;
  description?: string;
}

export type RulesetActionType =
  | 'insert_break'
  | 'insert_travel'
  | 'create_duty'
  | 'split_duty'
  | 'shift_activity'
  | 'set_duty_start_end';

export interface RulesetActionDefinition {
  type: RulesetActionType;
  params?: Record<string, unknown>;
}

export interface RulesetAction {
  id: string;
  action: RulesetActionDefinition;
  when?: RulesetExpression;
  description?: string;
}

export type RulesetTemplateType =
  | 'break'
  | 'travel'
  | 'duty'
  | 'duty_split'
  | 'shift'
  | 'assignment_swap';

export interface RulesetTemplateDefinition {
  type: RulesetTemplateType;
  params?: Record<string, unknown>;
}

export interface RulesetTemplate {
  id: string;
  template: RulesetTemplateDefinition;
  when?: RulesetExpression;
  description?: string;
}

export interface RulesetDocument {
  id: string;
  version: string;
  label?: string;
  description?: string;
  includes?: RulesetInclude[];
  conditions?: RulesetCondition[];
  hardConstraints?: RulesetConstraint[];
  softConstraints?: RulesetSoftConstraint[];
  objectives?: RulesetObjectiveTerm[];
  actions?: RulesetAction[];
  templates?: RulesetTemplate[];
}

export interface RulesetIR {
  id: string;
  version: string;
  label?: string;
  description?: string;
  resolvedIncludes: RulesetInclude[];
  conditions: RulesetCondition[];
  hardConstraints: RulesetConstraint[];
  softConstraints: RulesetSoftConstraint[];
  objectives: RulesetObjectiveTerm[];
  actions: RulesetAction[];
  templates: RulesetTemplate[];
  sourceHash: string;
}
