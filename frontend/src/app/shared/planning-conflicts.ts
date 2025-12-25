export type ConflictCategory = 'capacity' | 'location' | 'worktime' | 'unknown';

export type ConflictEntry = {
  code: string;
  category: ConflictCategory;
  categoryLabel: string;
  label: string;
};

export const CONFLICT_CATEGORY_LABELS: Record<ConflictCategory, string> = {
  capacity: 'Kapazität',
  location: 'Ort',
  worktime: 'Arbeitszeit',
  unknown: 'Konflikt',
};

export const CONFLICT_DEFINITIONS: Record<string, { category: ConflictCategory; label: string }> = {
  CAPACITY_OVERLAP: { category: 'capacity', label: 'Leistungen überlappen sich.' },
  LOCATION_SEQUENCE: { category: 'location', label: 'Ortsabfolge ist nicht konsistent.' },
  MAX_DUTY_SPAN: { category: 'worktime', label: 'Maximale Dienstspanne überschritten.' },
  MAX_WORK: { category: 'worktime', label: 'Maximale Arbeitszeit im Dienst überschritten.' },
  MAX_CONTINUOUS: { category: 'worktime', label: 'Maximale zusammenhängende Arbeitszeit überschritten.' },
  NO_BREAK_WINDOW: { category: 'worktime', label: 'Keine gültige Pause (Mindestdauer) möglich.' },
  AZG_WORK_AVG_7D: { category: 'worktime', label: 'Durchschnittliche Arbeitszeit (7 Arbeitstage) überschritten.' },
  AZG_WORK_AVG_365D: { category: 'worktime', label: 'Durchschnittliche Arbeitszeit (Jahr) überschritten.' },
  AZG_DUTY_SPAN_AVG_28D: { category: 'worktime', label: 'Durchschnittliche Dienstschicht (28 Tage) überschritten.' },
  AZG_REST_MIN: { category: 'worktime', label: 'Mindestruheschicht unterschritten.' },
  AZG_REST_AVG_28D: { category: 'worktime', label: 'Durchschnittliche Ruheschicht (28 Tage) unterschritten.' },
  AZG_BREAK_MAX_COUNT: { category: 'worktime', label: 'Zu viele Pausen in einer Dienstschicht.' },
  AZG_BREAK_TOO_SHORT: { category: 'worktime', label: 'Pause ist zu kurz (Mindestdauer).' },
  AZG_BREAK_FORBIDDEN_NIGHT: { category: 'worktime', label: 'Pause zwischen 23–5 Uhr nicht zulässig.' },
  AZG_NIGHT_STREAK_MAX: { category: 'worktime', label: 'Zu viele Nachtdienste hintereinander.' },
  AZG_NIGHT_28D_MAX: { category: 'worktime', label: 'Zu viele Nachtdienste innerhalb von 28 Tagen.' },
  AZG_REST_DAYS_YEAR_MIN: { category: 'worktime', label: 'Zu wenige Ruhetage im Fahrplanjahr.' },
  AZG_REST_SUNDAYS_YEAR_MIN: { category: 'worktime', label: 'Zu wenige Ruhesonntage im Fahrplanjahr.' },
  AZG_WORK_EXCEED_BUFFER: { category: 'worktime', label: 'Höchstarbeitszeit um mehr als 10 Minuten überschritten.' },
  AZG_DUTY_SPAN_EXCEED_BUFFER: { category: 'worktime', label: 'Höchstdienstschicht um mehr als 10 Minuten überschritten.' },
};

export function extractConflictCodes(attributes: Record<string, unknown> | null | undefined): string[] {
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const raw = attrs['service_conflict_codes'];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (entry ?? '').toString().trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

export function extractConflictCodesForOwner(
  attributes: Record<string, unknown> | null | undefined,
  ownerId: string | null | undefined,
): string[] {
  const trimmedOwner = (ownerId ?? '').trim();
  if (!trimmedOwner) {
    return extractConflictCodes(attributes);
  }
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const rawMap = attrs['service_by_owner'];
  if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
    const entry = (rawMap as Record<string, any>)[trimmedOwner];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const rawCodes = (entry as any).conflictCodes;
      if (Array.isArray(rawCodes)) {
        return rawCodes
          .map((code) => (code ?? '').toString().trim())
          .filter((code) => code.length > 0);
      }
    }
  }
  return extractConflictCodes(attributes);
}

export function mapConflictCodes(attributes: Record<string, unknown> | null | undefined): ConflictEntry[] {
  const codes = extractConflictCodes(attributes);
  if (!codes.length) {
    return [];
  }
  const entries = codes.map((code) => {
    const normalized = code.trim();
    const def = CONFLICT_DEFINITIONS[normalized];
    const category = def?.category ?? 'unknown';
    return {
      code: normalized,
      category,
      categoryLabel: CONFLICT_CATEGORY_LABELS[category],
      label: def?.label ?? normalized,
    } satisfies ConflictEntry;
  });
  return entries.sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.label.localeCompare(b.label));
}

export function mapConflictCodesForOwner(
  attributes: Record<string, unknown> | null | undefined,
  ownerId: string | null | undefined,
): ConflictEntry[] {
  const codes = extractConflictCodesForOwner(attributes, ownerId);
  if (!codes.length) {
    return [];
  }
  const entries = codes.map((code) => {
    const normalized = code.trim();
    const def = CONFLICT_DEFINITIONS[normalized];
    const category = def?.category ?? 'unknown';
    return {
      code: normalized,
      category,
      categoryLabel: CONFLICT_CATEGORY_LABELS[category],
      label: def?.label ?? normalized,
    } satisfies ConflictEntry;
  });
  return entries.sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.label.localeCompare(b.label));
}
