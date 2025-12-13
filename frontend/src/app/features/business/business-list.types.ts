import type { Business, BusinessStatus } from '../../core/models/business.model';
import type {
  BusinessFilters,
  BusinessSort,
} from '../../core/services/business.service';

export type BusinessMetricFilterKind = 'active' | 'completed' | 'overdue' | 'dueSoon';

export type TagInsightStat = readonly [tag: string, count: number];

export type AssignmentInsight = {
  name: string;
  type: 'group' | 'person';
  count: number;
};

export type StatusBreakdownEntry = {
  status: BusinessStatus;
  label: string;
  count: number;
};

export type BusinessInsightContext = {
  title: string;
  message: string;
  hint: string;
  icon: string;
};

export type PipelineMetrics = {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  dueSoon: number;
};

export type MetricTrend = {
  active: number | null;
  completed: number | null;
  overdue: number | null;
  dueSoon: number | null;
};

export type DueSoonBusiness = Business;

export interface SortOption {
  value: string;
  label: string;
}

export type BusinessMetric = {
  label: string;
  value: number | string;
  icon: string;
  hint: string;
};

export interface BusinessHighlight {
  icon: string;
  label: string;
  filter?: { kind: 'status' | 'assignment'; value: string };
}

export interface SavedFilterPreset {
  id: string;
  name: string;
  filters: BusinessFilters & { search: string };
  sort: BusinessSort;
}

export type HealthTone = 'critical' | 'warning' | 'ok' | 'done' | 'idle';

export interface HealthBadge {
  tone: HealthTone;
  label: string;
}

export type TimelineState = 'past' | 'current' | 'future' | 'none';

export interface TimelineEntry {
  label: string;
  description: string;
  state: TimelineState;
  date: Date | null;
}

export interface ActivityFeedItem {
  icon: string;
  title: string;
  subtitle: string;
}

export interface SearchSuggestion {
  label: string;
  value: string;
  icon: string;
  description: string;
  kind: 'tag' | 'assignment' | 'status';
}
