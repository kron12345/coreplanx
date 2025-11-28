import { ScheduleTemplate } from '../../../core/models/schedule-template.model';

export interface PlanGenerationPreview {
  ready: boolean;
  warnings: string[];
  totalDepartures: number;
  durationMinutes: number;
  durationLabel?: string;
  firstDeparture?: string;
  lastDeparture?: string;
  sampleDepartures: string[];
  otnRange?: string;
}

export interface PlanTemplateStats {
  origin: string;
  destination: string;
  stopCount: number;
  travelMinutes?: number;
  travelLabel?: string;
  stopNames: string[];
}

export interface PlanPreviewInput {
  template?: ScheduleTemplate;
  stats: PlanTemplateStats | null;
  preview: PlanGenerationPreview | null;
}
