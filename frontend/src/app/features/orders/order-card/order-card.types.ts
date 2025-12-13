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

