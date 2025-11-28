import { PlanningStageId } from '../../features/planning/planning-stage.model';

export type TimelineLod = 'activity' | 'service';

export interface TimelineQuery {
  from: string;
  to: string;
  stage?: PlanningStageId;
  lod?: TimelineLod;
  resourceIds?: string[];
}

export interface TimelineActivityResourceAssignmentDto {
  resourceId: string;
  resourceType: 'personnel' | 'vehicle' | 'personnel-service' | 'vehicle-service';
  role?: string | null;
  lineIndex?: number | null;
}

export interface TimelineActivityDto {
  id: string;
  stage: PlanningStageId;
  type: string;
  start: string;
  end?: string | null;
  isOpenEnded: boolean;
  status?: string | null;
  serviceRole?: 'start' | 'segment' | 'end' | null;
  from?: string | null;
  to?: string | null;
  remark?: string | null;
  label?: string | null;
  serviceId?: string | null;
  resourceAssignments: TimelineActivityResourceAssignmentDto[];
  attributes?: Record<string, unknown> | null;
  version?: number | null;
}

export interface TimelineServiceDto {
  id: string;
  type: 'SERVICE' | 'ABSENCE';
  stage: PlanningStageId;
  resourceId: string;
  start: string;
  end?: string | null;
  isOpenEnded: boolean;
  status?: string | null;
  label?: string | null;
  attributes?: Record<string, unknown>;
}

export interface TimelineResponseDto {
  lod: TimelineLod;
  activities?: TimelineActivityDto[];
  services?: TimelineServiceDto[];
}

export interface TemplateSetDto {
  id: string;
  name: string;
  description?: string | null;
  tableName?: string;
  createdAt: string;
  updatedAt: string;
  periods?: TemplatePeriod[];
  specialDays?: string[];
  attributes?: Record<string, unknown>;
}

export interface TemplatePeriod {
  id: string;
  validFrom: string;
  validTo: string | null;
}
