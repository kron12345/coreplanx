import { Activity } from '../../models/activity';
import { ActivityValidationIssue } from '../../models/activity-validation';
import { Resource } from '../../models/resource';

export interface ActivityBatchMutationRequest {
  upserts?: Activity[];
  deleteIds?: string[];
  skipAutopilot?: boolean;
  clientRequestId?: string;
}

export interface ActivityBatchMutationResponse {
  appliedUpserts: string[];
  deletedIds: string[];
  upserts?: Activity[];
  version?: string | null;
  clientRequestId?: string;
}

export interface ResourceBatchMutationRequest {
  upserts?: Resource[];
  deleteIds?: string[];
  clientRequestId?: string;
}

export interface ResourceBatchMutationResponse {
  appliedUpserts: string[];
  deletedIds: string[];
  version?: string | null;
  clientRequestId?: string;
}

export interface ActivityValidationRequest {
  /**
   * Optional subset of activity IDs for targeted validations. If omitted the
   * backend validates the entire stage.
   */
  activityIds?: string[];
  /** ISO timestamp range to limit validation scope. */
  windowStart?: string;
  windowEnd?: string;
  /** Restrict validation to specific resources. */
  resourceIds?: string[];
  /** Allow clients to group validation responses by intent. */
  clientRequestId?: string;
}

export interface ActivityValidationResponse {
  generatedAt: string;
  issues: ActivityValidationIssue[];
}

export interface PlanningStageViewportSubscriptionRequest {
  from: string;
  to: string;
  resourceIds?: string[];
  userId: string;
  connectionId: string;
}

export interface PlanningStageViewportSubscriptionResponse {
  ok: true;
}

export interface OperationsSnapshotRequest {
  templateId: string;
  replaceExisting?: boolean;
}

export interface OperationsSnapshotResponse {
  variantId: string;
  templateId: string;
  created: number;
  deleted: number;
  version?: string | null;
}
