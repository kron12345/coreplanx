import type { Activity, ActivityParticipant } from '../models/activity';
import type { ActivityParticipantCategory } from '../models/activity-ownership';
import type { Resource } from '../models/resource';
import type { GanttBar, GanttServiceRange } from './gantt-timeline-row.component';

export interface PreparedActivity extends Activity {
  startMs: number;
  endMs: number;
  ownerResourceId: string | null;
  isPreview?: boolean;
}

export interface PreparedActivitySlot {
  id: string;
  activity: PreparedActivity;
  participant: ActivityParticipant;
  resourceId: string;
  category: ActivityParticipantCategory;
  isOwner: boolean;
  icon: string | null;
  iconLabel: string | null;
}

export interface GanttGroupRow {
  kind: 'group';
  id: string;
  label: string;
  icon: string;
  resourceIds: string[];
  resourceCount: number;
  expanded: boolean;
  category: string | null;
}

export interface GanttResourceRow {
  kind: 'resource';
  id: string;
  resource: Resource;
  bars: GanttBar[];
  services: GanttServiceRange[];
  groupId: string;
  zebra: boolean;
}

export type GanttDisplayRow = GanttGroupRow | GanttResourceRow;

export interface GanttGroupDefinition {
  id: string;
  label: string;
  icon: string;
  category: string | null;
  resources: Resource[];
}

export interface ServiceRangeAccumulator {
  id: string;
  minLeft: number;
  maxRight: number;
  startLeft: number | null;
  endLeft: number | null;
  startMs: number | null;
  endMs: number | null;
  routeFrom: string | null;
  routeTo: string | null;
  routeFromMs: number | null;
  routeToMs: number | null;
}

export type ActivitySelectionMode = 'set' | 'toggle';

export interface ActivitySelectionEventPayload {
  resource: Resource;
  activity: Activity;
  selectionMode: ActivitySelectionMode;
}

export interface ActivityRepositionEventPayload {
  activity: Activity;
  targetResourceId: string;
  start: Date;
  end: Date | null;
  sourceResourceId?: string | null;
  participantCategory?: ActivityParticipantCategory | null;
  participantResourceId?: string | null;
  isOwnerSlot?: boolean;
}

export interface ActivitySlotSelection {
  activityId: string;
  resourceId: string;
}

export interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NormalizedRect extends SelectionBox {
  right: number;
  bottom: number;
}
