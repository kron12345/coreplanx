import type { Activity } from '../../models/activity';

export interface RulesetSelectionRequestDto {
  rulesetId?: string;
  rulesetVersion?: string;
  activityIds?: string[];
  templateId?: string;
  timelineRange?: { start: string; end: string };
}

export type PlanningCandidateType = 'break' | 'travel' | 'duty' | 'duty_split';

export interface PlanningCandidateDto {
  id: string;
  templateId: string;
  type: PlanningCandidateType;
  params: Record<string, unknown>;
}

export interface PlanningCandidateBuildStatsDto {
  breakTemplates: number;
  travelTemplates: number;
  dutyTemplates: number;
  dutySplitTemplates: number;
  candidateCount: number;
}

export interface PlanningCandidateBuildResponseDto {
  rulesetId: string;
  rulesetVersion: string;
  candidates: PlanningCandidateDto[];
  stats: PlanningCandidateBuildStatsDto;
}

export interface PlanningSolverResponseDto {
  rulesetId: string;
  rulesetVersion: string;
  summary: string;
  upserts: Activity[];
  deletedIds: string[];
  candidatesUsed: PlanningCandidateDto[];
  stats: PlanningCandidateBuildStatsDto;
}
