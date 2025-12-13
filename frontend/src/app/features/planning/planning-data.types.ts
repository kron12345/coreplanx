import type { Activity } from '../../models/activity';
import type { Resource } from '../../models/resource';

export interface PlanningVariantContext {
  id: string;
  label: string;
  type: 'productive' | 'simulation';
  timetableYearLabel?: string;
}

export interface PlanningTimelineRange {
  start: Date;
  end: Date;
}

export interface PlanningStageData {
  resources: Resource[];
  activities: Activity[];
  timelineRange: PlanningTimelineRange;
  /** Backend data version (e.g. for optimistic locking). */
  version: string | null;
}

