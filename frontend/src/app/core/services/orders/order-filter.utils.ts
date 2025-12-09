import { OrderSearchTokens } from './order-filters.model';

export function parseSearchTokens(search: string): OrderSearchTokens {
  const tokens: OrderSearchTokens = {
    textTerms: [],
    tags: [],
    responsibles: [],
    customers: [],
  };
  const trimmed = search.trim();
  if (!trimmed.length) {
    return tokens;
  }
  const segments = tokenizeSearch(trimmed);
  segments.forEach((segment) => {
    const lower = segment.toLowerCase();
    if (lower.startsWith('tag:')) {
      const value = stripQuotes(segment.slice(4).trim());
      if (value) {
        tokens.tags.push(value);
      }
      return;
    }
    if (segment.startsWith('#')) {
      const value = stripQuotes(segment.slice(1).trim());
      if (value) {
        tokens.tags.push(value);
      }
      return;
    }
    if (
      lower.startsWith('resp:') ||
      lower.startsWith('responsible:') ||
      segment.startsWith('@')
    ) {
      const suffix = segment.startsWith('@')
        ? segment.slice(1)
        : segment.slice(segment.indexOf(':') + 1);
      const value = stripQuotes(suffix.trim()).toLowerCase();
      if (value) {
        tokens.responsibles.push(value);
      }
      return;
    }
    if (lower.startsWith('cust:') || lower.startsWith('kunde:')) {
      const value = stripQuotes(
        segment.slice(segment.indexOf(':') + 1).trim(),
      ).toLowerCase();
      if (value) {
        tokens.customers.push(value);
      }
      return;
    }
    tokens.textTerms.push(stripQuotes(segment).toLowerCase());
  });

  if (
    !tokens.textTerms.length &&
    !tokens.tags.length &&
    !tokens.responsibles.length &&
    !tokens.customers.length
  ) {
    tokens.textTerms.push(trimmed.toLowerCase());
  }

  return tokens;
}

export function tokenizeSearch(search: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < search.length; i += 1) {
    const char = search[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (/\s/.test(char) && !inQuotes) {
      if (current.trim().length) {
        segments.push(current.trim());
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.trim().length) {
    segments.push(current.trim());
  }
  return segments;
}

export function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value.slice(1, -1);
  }
  return value;
}
