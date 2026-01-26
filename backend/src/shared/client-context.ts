export type ClientRequestContext = {
  userId?: string | null;
  connectionId?: string | null;
  requestId?: string | null;
};

export function parseClientRequestId(value?: string | null): ClientRequestContext {
  if (!value) {
    return {};
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  const [userId, connectionId, requestId] = trimmed.split('|');
  return {
    userId: userId?.trim() || null,
    connectionId: connectionId?.trim() || null,
    requestId: requestId?.trim() || null,
  };
}
