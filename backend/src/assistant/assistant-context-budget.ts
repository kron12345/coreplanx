import type { AssistantUiContextDto } from './assistant.dto';

export type AssistantSystemMessage = { role: 'system'; content: string };

const TRUNCATE_SUFFIX = '\n\n... (gekuerzt)';
const DEFAULT_LINE_CHARS = 120;
const MIN_SUMMARY_LINES = 3;

function limitLines(value: string, maxLines: number): string {
  const trimmed = value.trim();
  if (!trimmed || maxLines <= 0) {
    return '';
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length <= maxLines) {
    return lines.join('\n');
  }
  return [...lines.slice(0, maxLines), '...'].join('\n');
}

export function truncateText(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= TRUNCATE_SUFFIX.length) {
    return value.slice(0, maxChars).trimEnd();
  }
  return `${value
    .slice(0, Math.max(0, maxChars - TRUNCATE_SUFFIX.length))
    .trimEnd()}${TRUNCATE_SUFFIX}`;
}

export function applyMessageBudget(
  messages: AssistantSystemMessage[],
  maxChars: number,
): AssistantSystemMessage[] {
  let remaining = Math.max(0, maxChars);
  const result: AssistantSystemMessage[] = [];
  for (const message of messages) {
    if (remaining <= 0) {
      break;
    }
    const content = truncateText(message.content, remaining);
    if (!content) {
      continue;
    }
    result.push({ ...message, content });
    remaining -= content.length;
  }
  return result;
}

export function buildUiContextMessage(
  uiContext: AssistantUiContextDto | undefined,
  options: { maxDataChars: number; lineChars?: number; minLines?: number },
): string | null {
  if (!uiContext) {
    return null;
  }

  const route = uiContext.route?.trim();
  const breadcrumbs = (uiContext.breadcrumbs ?? [])
    .map((entry) => entry?.trim?.() ?? '')
    .filter((entry) => entry.length > 0);

  let dataSummary = '';
  const dataSummaryRaw = uiContext.dataSummary?.trim();
  if (dataSummaryRaw && options.maxDataChars > 0) {
    const lineChars = Math.max(40, options.lineChars ?? DEFAULT_LINE_CHARS);
    const minLines = Math.max(1, options.minLines ?? MIN_SUMMARY_LINES);
    const maxLines = Math.max(minLines, Math.floor(options.maxDataChars / lineChars));
    dataSummary = truncateText(limitLines(dataSummaryRaw, maxLines), options.maxDataChars);
  }

  const lines: string[] = [];
  if (breadcrumbs.length) {
    lines.push(`Breadcrumb: ${breadcrumbs.join(' > ')}`);
  }
  if (route) {
    lines.push(`Route: ${route}`);
  }
  if (dataSummary) {
    lines.push(`Daten (Ausschnitt):\n${dataSummary}`);
  }

  if (!lines.length) {
    return null;
  }

  return `UI-Kontext:\n- ${lines.join('\n- ')}`;
}
