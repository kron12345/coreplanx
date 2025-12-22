export type PlanningRuleKind = 'generator' | 'constraint';
export type PlanningRuleFormat = 'yaml' | 'json';

export interface PlanningRuleDto {
  id: string;
  stageId: string;
  variantId: string;
  timetableYearLabel?: string | null;
  kind: PlanningRuleKind;
  executor: string;
  enabled: boolean;
  format: PlanningRuleFormat;
  raw: string;
  params: Record<string, unknown>;
  definition?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PlanningRuleListResponse {
  items: PlanningRuleDto[];
}

export interface PlanningRuleMutationRequest {
  upserts?: PlanningRuleDto[];
  deleteIds?: string[];
  clientRequestId?: string;
}

export interface PlanningRuleMutationResponse {
  appliedUpserts: string[];
  deletedIds: string[];
}

