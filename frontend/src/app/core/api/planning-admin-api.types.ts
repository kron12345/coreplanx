export type PlanningAdminClearScope =
  | 'all'
  | 'stages'
  | 'resources'
  | 'activities'
  | 'templates'
  | 'train-runs'
  | 'train-segments';

export interface PlanningAdminSummary {
  generatedAt: string;
  sampleLimit: number;
  totals: {
    stages: number;
    resources: number;
    activities: number;
    templates: number;
    trainRuns: number;
    trainSegments: number;
  };
  byStage: {
    base: { resources: number; activities: number };
    operations: { resources: number; activities: number };
  };
  samples: {
    stages: Array<{
      stageId: string;
      variantId: string;
      timetableYearLabel: string | null;
      version: string | null;
      timelineStart: string;
      timelineEnd: string;
      raw: Record<string, unknown>;
    }>;
    resources: Array<{
      stageId: string;
      variantId: string;
      id: string;
      kind: string;
      name: string;
      raw: Record<string, unknown>;
    }>;
    activities: Array<{
      stageId: string;
      variantId: string;
      id: string;
      type: string | null;
      start: string;
      end: string | null;
      serviceId: string | null;
      serviceRole: string | null;
      raw: Record<string, unknown>;
    }>;
    templateActivities: Array<{
      templateId: string;
      templateName: string;
      tableName: string;
      variantId: string;
      id: string;
      type: string;
      stage: string;
      startTime: string;
      endTime: string | null;
      raw: Record<string, unknown>;
    }>;
    trainRuns: Array<{
      id: string;
      stageId: string;
      variantId: string;
      trainNumber: string;
      timetableId: string | null;
      raw: Record<string, unknown>;
    }>;
    trainSegments: Array<{
      id: string;
      stageId: string;
      variantId: string;
      trainRunId: string;
      sectionIndex: number;
      startTime: string;
      endTime: string;
      fromLocationId: string;
      toLocationId: string;
      raw: Record<string, unknown>;
    }>;
  };
}

export interface PlanningAdminClearResponse {
  clearedAt: string;
  deleted: {
    stages: number;
    resources: number;
    activities: number;
    templates: number;
    trainRuns: number;
    trainSegments: number;
  };
}
