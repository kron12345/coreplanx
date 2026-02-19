export interface StatusSummary<T = string> {
  key: string;
  label: string;
  count: number;
  value: T;
}

export interface OrderHealthSnapshot {
  total: number;
  upcoming: number;
  attention: number;
  active: number;
  idle: number;
  tone: 'ok' | 'warn' | 'critical';
  label: string;
  icon: string;
  caption: string;
  pastPercent: number;
  upcomingPercent: number;
  idlePercent: number;
}

export interface FmPhaseSummary {
  label: string;
  count: number;
}

export interface FmOperationalContextRow {
  rowKey: string;
  caseId: string;
  caseTitle: string;
  profileLabel: string;
  caseState: string;
  contextState: string;
  timetableYearLabel: string;
  validFrom: string;
  validTo: string;
  status: 'active' | 'terminal';
}

export interface FmTraceabilityRow {
  rowKey: string;
  caseId: string;
  caseTitle: string;
  profileLabel: string;
  currentState: string;
  correlation: string;
  lastMessage: string;
  lastTransition: string;
  auditCounts: string;
  detailStatus: 'ok' | 'degraded';
  detailError?: string | null;
}

export interface FmSupervisionSnapshot {
  linkedPlanCount: number;
  matchedCaseCount: number;
  terminalCaseCount: number;
  activeCaseCount: number;
  missingOrderItemLinks: number;
  unresolvedPlanIds: string[];
  degradedCaseCount: number;
  stateSummaries: FmPhaseSummary[];
  tttSummaries: FmPhaseSummary[];
  ttrSummaries: FmPhaseSummary[];
  contextRows: FmOperationalContextRow[];
  traceabilityRows: FmTraceabilityRow[];
}
