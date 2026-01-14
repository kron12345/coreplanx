export interface AssistantConfig {
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaApiKey: string | null;
  ollamaTimeoutMs: number;
  ollamaTemperature: number | null;
  ollamaTopP: number | null;
  ollamaMaxTokens: number | null;
  maxContextMessages: number;
  maxConversations: number;
  conversationTtlMs: number;
  enableSummary: boolean;
  summaryBatchMessages: number;
  summaryMaxChars: number;
  maxDocChars: number;
  maxUiDataChars: number;
  maxContextChars: number;
  docInjectionMode: 'always' | 'on-change' | 'never';
  actionPreviewTtlMs: number;
  actionRetryInvalid: boolean;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  actionRateLimitMax: number;
  actionAuditEnabled: boolean;
  actionAuditLogPath: string;
  actionRoleMap: Record<string, string[]> | null;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toOptionalNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toOptionalInt(value: string | undefined): number | null {
  const parsed = toOptionalNumber(value);
  if (parsed === null) {
    return null;
  }
  const asInt = Math.trunc(parsed);
  return Number.isFinite(asInt) ? asInt : null;
}

function toJsonRecord(
  value: string | undefined,
): Record<string, string[]> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result: Record<string, string[]> = {};
    for (const [key, entry] of Object.entries(parsed ?? {})) {
      if (Array.isArray(entry)) {
        result[key] = entry
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0);
      }
    }
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}

function toDocInjectionMode(
  value: string | undefined,
): 'always' | 'on-change' | 'never' {
  const normalized = (value ?? 'always').trim().toLowerCase();
  switch (normalized) {
    case 'never':
      return 'never';
    case 'on-change':
    case 'onchange':
      return 'on-change';
    default:
      return 'always';
  }
}

export function loadAssistantConfig(): AssistantConfig {
  const maxDocChars = toNumber(process.env.ASSISTANT_MAX_DOC_CHARS, 6000);
  const maxUiDataChars = toNumber(
    process.env.ASSISTANT_MAX_UI_DATA_CHARS,
    2000,
  );
  const maxContextChars = toNumber(
    process.env.ASSISTANT_MAX_CONTEXT_CHARS,
    maxDocChars + maxUiDataChars,
  );
  return {
    ollamaBaseUrl: (
      process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
    ).replace(/\/+$/, ''),
    ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen3:8b',
    ollamaApiKey: process.env.OLLAMA_API_KEY?.trim()
      ? process.env.OLLAMA_API_KEY.trim()
      : null,
    ollamaTimeoutMs: toNumber(process.env.OLLAMA_TIMEOUT_MS, 60_000),
    ollamaTemperature: toOptionalNumber(process.env.OLLAMA_TEMPERATURE),
    ollamaTopP: toOptionalNumber(process.env.OLLAMA_TOP_P),
    ollamaMaxTokens: toOptionalInt(process.env.OLLAMA_MAX_TOKENS),
    maxContextMessages: toNumber(
      process.env.ASSISTANT_MAX_CONTEXT_MESSAGES,
      20,
    ),
    maxConversations: toNumber(process.env.ASSISTANT_MAX_CONVERSATIONS, 200),
    conversationTtlMs: toNumber(
      process.env.ASSISTANT_CONVERSATION_TTL_MS,
      3_600_000,
    ),
    enableSummary: toBoolean(process.env.ASSISTANT_ENABLE_SUMMARY, false),
    summaryBatchMessages: toNumber(
      process.env.ASSISTANT_SUMMARY_BATCH_MESSAGES,
      10,
    ),
    summaryMaxChars: toNumber(process.env.ASSISTANT_SUMMARY_MAX_CHARS, 2000),
    maxDocChars,
    maxUiDataChars,
    maxContextChars,
    docInjectionMode: toDocInjectionMode(
      process.env.ASSISTANT_DOC_INJECTION_MODE,
    ),
    actionPreviewTtlMs: toNumber(
      process.env.ASSISTANT_ACTION_PREVIEW_TTL_MS,
      3_600_000,
    ),
    actionRetryInvalid: toBoolean(
      process.env.ASSISTANT_ACTION_RETRY_INVALID,
      true,
    ),
    rateLimitWindowMs: toNumber(
      process.env.ASSISTANT_RATE_LIMIT_WINDOW_MS,
      60_000,
    ),
    rateLimitMax: toNumber(process.env.ASSISTANT_RATE_LIMIT_MAX, 60),
    actionRateLimitMax: toNumber(
      process.env.ASSISTANT_ACTION_RATE_LIMIT_MAX,
      20,
    ),
    actionAuditEnabled: toBoolean(
      process.env.ASSISTANT_ACTION_AUDIT_ENABLED,
      true,
    ),
    actionAuditLogPath:
      process.env.ASSISTANT_ACTION_AUDIT_LOG_PATH?.trim() ||
      `${process.cwd()}/logs/assistant-actions.ndjson`,
    actionRoleMap: toJsonRecord(process.env.ASSISTANT_ACTION_ROLE_MAP),
  };
}
