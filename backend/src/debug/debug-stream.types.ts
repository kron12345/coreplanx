export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type DebugLogTopic =
  | 'planning'
  | 'solver'
  | 'assistant'
  | 'db'
  | 'rules'
  | 'system';

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  level: DebugLogLevel;
  topic: DebugLogTopic;
  message: string;
  context?: Record<string, unknown>;
  userId?: string;
  connectionId?: string;
  stageId?: string;
}

export interface DebugStreamOptions {
  userId?: string;
  connectionId?: string;
  levels?: DebugLogLevel[];
  topics?: DebugLogTopic[];
  includeHistory?: boolean;
  historySize?: number;
}
