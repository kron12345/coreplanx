export type ActivityValidationRule =
  | 'location-conflict'
  | 'capacity-conflict'
  | 'working-time'
  | 'qualification'
  | 'custom';

export interface ActivityValidationIssue {
  /** Deterministic identifier for deduplicating issues on the client. */
  id: string;
  rule: ActivityValidationRule;
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** Activities that are affected by the issue (for highlighting). */
  activityIds: string[];
  /** Optional backend-provided metadata such as thresholds or rule details. */
  meta?: Record<string, unknown>;
}
