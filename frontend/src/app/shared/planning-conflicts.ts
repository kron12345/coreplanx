export type ConflictCategory = 'capacity' | 'location' | 'worktime' | 'unknown';

export type ConflictEntry = {
  code: string;
  category: ConflictCategory;
  categoryLabel: string;
  label: string;
  details?: string[];
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
  HOME_DEPOT_NOT_FOUND: { category: 'location', label: 'Heimdepot ist nicht vorhanden.' },
  HOME_DEPOT_NO_SITES: { category: 'location', label: 'Heimdepot hat keine zulässigen Start-/Endstellen.' },
  HOME_DEPOT_SITE_NOT_FOUND: { category: 'location', label: 'Heimdepot verweist auf unbekannte Personnel Sites.' },
  HOME_DEPOT_START_LOCATION_MISSING: { category: 'location', label: 'Start-Ort der ersten Leistung ist nicht gesetzt.' },
  HOME_DEPOT_END_LOCATION_MISSING: { category: 'location', label: 'End-Ort der letzten Leistung ist nicht gesetzt.' },
  HOME_DEPOT_PAUSE_LOCATION_MISSING: { category: 'location', label: 'Pause kann nicht platziert werden (fehlende Ortsangaben).' },
  HOME_DEPOT_OVERNIGHT_LOCATION_MISSING: { category: 'location', label: 'Ort für auswärtige Übernachtung fehlt.' },
  HOME_DEPOT_OVERNIGHT_SITE_FORBIDDEN: { category: 'location', label: 'Ort für auswärtige Übernachtung ist im Heimdepot nicht erlaubt.' },
  HOME_DEPOT_NO_BREAK_SITES: { category: 'location', label: 'Heimdepot hat keine zulässigen Pausenräume.' },
  HOME_DEPOT_NO_SHORT_BREAK_SITES: { category: 'location', label: 'Heimdepot hat keine zulässigen Kurzpausenräume.' },
  WALK_TIME_MISSING_START: { category: 'location', label: 'Wegzeit für Dienstanfang fehlt.' },
  WALK_TIME_MISSING_END: { category: 'location', label: 'Wegzeit für Dienstende fehlt.' },
  WALK_TIME_MISSING_BREAK: { category: 'location', label: 'Wegzeit zur Pause fehlt.' },
  WALK_TIME_MISSING_SHORT_BREAK: { category: 'location', label: 'Wegzeit zur Kurzpause fehlt.' },
  WITHIN_SERVICE_REQUIRED: {
    category: 'unknown',
    label: 'Leistung muss innerhalb eines Dienstes liegen, liegt aber außerhalb.',
  },
  OUTSIDE_SERVICE_REQUIRED: {
    category: 'unknown',
    label: 'Leistung soll außerhalb eines Dienstes liegen, liegt aber innerhalb.',
  },
  MAX_DUTY_SPAN: { category: 'worktime', label: 'Maximale Dienstspanne überschritten.' },
  MAX_WORK: { category: 'worktime', label: 'Maximale Arbeitszeit im Dienst überschritten.' },
  MAX_CONTINUOUS: { category: 'worktime', label: 'Maximale zusammenhängende Arbeitszeit überschritten.' },
  NO_BREAK_WINDOW: { category: 'worktime', label: 'Keine gültige Pause (Mindestdauer) möglich.' },
  AZG_WORK_AVG_7D: { category: 'worktime', label: 'Durchschnittliche Arbeitszeit (7 Arbeitstage) überschritten.' },
  AZG_WORK_AVG_365D: { category: 'worktime', label: 'Durchschnittliche Arbeitszeit (Jahr) überschritten.' },
  AZG_DUTY_SPAN_AVG_28D: { category: 'worktime', label: 'Durchschnittliche Dienstschicht (28 Tage) überschritten.' },
  AZG_REST_MIN: { category: 'worktime', label: 'Mindestruheschicht unterschritten.' },
  AZG_REST_AVG_28D: { category: 'worktime', label: 'Durchschnittliche Ruheschicht (28 Tage) unterschritten.' },
  AZG_BREAK_REQUIRED: { category: 'worktime', label: 'Pause oder Arbeitsunterbrechung fehlt.' },
  AZG_BREAK_MAX_COUNT: { category: 'worktime', label: 'Zu viele Pausen in einer Dienstschicht.' },
  AZG_BREAK_TOO_SHORT: { category: 'worktime', label: 'Pause ist zu kurz (Mindestdauer).' },
  AZG_BREAK_STANDARD_MIN: { category: 'worktime', label: 'Standardpause unterschritten.' },
  AZG_BREAK_FORBIDDEN_NIGHT: { category: 'worktime', label: 'Pause zwischen 23–5 Uhr nicht zulässig.' },
  AZG_BREAK_MIDPOINT: { category: 'worktime', label: 'Pause nicht ungefähr in der Hälfte der Arbeitszeit.' },
  AZG_NIGHT_STREAK_MAX: { category: 'worktime', label: 'Zu viele Nachtdienste hintereinander.' },
  AZG_NIGHT_28D_MAX: { category: 'worktime', label: 'Zu viele Nachtdienste innerhalb von 28 Tagen.' },
  AZG_REST_DAYS_YEAR_MIN: { category: 'worktime', label: 'Zu wenige Ruhetage im Fahrplanjahr.' },
  AZG_REST_SUNDAYS_YEAR_MIN: { category: 'worktime', label: 'Zu wenige Ruhesonntage im Fahrplanjahr.' },
  AZG_WORK_EXCEED_BUFFER: { category: 'worktime', label: 'Höchstarbeitszeit um mehr als 10 Minuten überschritten.' },
  AZG_DUTY_SPAN_EXCEED_BUFFER: { category: 'worktime', label: 'Höchstdienstschicht um mehr als 10 Minuten überschritten.' },
};

const CONFLICT_RULE_HINTS: Record<string, string[]> = {
  MAX_DUTY_SPAN: ['Regel: duty.max_duty_span_minutes', 'AZG Art. 6 Abs. 1'],
  MAX_WORK: ['Regel: duty.max_work_minutes', 'AZG Art. 4 Abs. 3'],
  MAX_CONTINUOUS: ['Regel: duty.max_continuous_work_minutes', 'AZG Art. 11 Abs. 4'],
  NO_BREAK_WINDOW: ['Regel: duty.min_break_minutes', 'AZG Art. 7 Abs. 2'],
  AZG_WORK_AVG_7D: ['Regel: azg.work_avg_7d', 'AZG Art. 4 Abs. 3'],
  AZG_WORK_AVG_365D: ['Regel: azg.work_avg_365d', 'AZG Art. 4 Abs. 1'],
  AZG_DUTY_SPAN_AVG_28D: ['Regel: azg.duty_span_avg_28d', 'AZG Art. 6 Abs. 1'],
  AZG_REST_MIN: ['Regel: azg.rest_min', 'AZG Art. 8 Abs. 1'],
  AZG_REST_AVG_28D: ['Regel: azg.rest_avg_28d', 'AZG Art. 8 Abs. 1'],
  AZG_BREAK_REQUIRED: [
    'Regel: azg.break_standard_minutes',
    'Regel: azg.break_interruption',
    'AZG Art. 7 Abs. 1/4',
  ],
  AZG_BREAK_MAX_COUNT: ['Regel: azg.break_max_count', 'AZG Art. 7 Abs. 2'],
  AZG_BREAK_TOO_SHORT: ['Regel: duty.min_break_minutes', 'AZG Art. 7 Abs. 2'],
  AZG_BREAK_STANDARD_MIN: ['Regel: azg.break_standard_minutes', 'AZG Art. 7 Abs. 1 / Art. 11 Abs. 1-2'],
  AZG_BREAK_FORBIDDEN_NIGHT: ['Regel: azg.break_forbidden_night', 'AZG Art. 11 Abs. 3'],
  AZG_BREAK_MIDPOINT: ['Regel: azg.break_midpoint', 'AZG Art. 7 Abs. 1'],
  AZG_NIGHT_STREAK_MAX: ['Regel: azg.night_max_streak', 'AZG Art. 9 Abs. 3'],
  AZG_NIGHT_28D_MAX: ['Regel: azg.night_max_28d', 'AZG Art. 9 Abs. 3'],
  AZG_REST_DAYS_YEAR_MIN: ['Regel: azg.rest_days_year', 'AZG Art. 10 Abs. 1'],
  AZG_REST_SUNDAYS_YEAR_MIN: ['Regel: azg.rest_days_year', 'AZG Art. 10 Abs. 1'],
  AZG_WORK_EXCEED_BUFFER: ['Regel: azg.exceed_buffer_minutes', 'AZG Art. 5 Abs. 3 / Art. 6 Abs. 3'],
  AZG_DUTY_SPAN_EXCEED_BUFFER: ['Regel: azg.exceed_buffer_minutes', 'AZG Art. 5 Abs. 3 / Art. 6 Abs. 3'],
};

const mergeDetailLines = (details?: string[], hints?: string[]): string[] | undefined => {
  const combined = [...(details ?? []), ...(hints ?? [])]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (!combined.length) {
    return undefined;
  }
  return Array.from(new Set(combined));
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

export function extractConflictDetails(attributes: Record<string, unknown> | null | undefined): Record<string, string[]> {
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const raw = attrs['service_conflict_details'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([code, value]) => {
    if (!Array.isArray(value)) {
      return;
    }
    const normalized = `${code ?? ''}`.trim();
    if (!normalized) {
      return;
    }
    const list = value
      .map((entry) => (entry ?? '').toString().trim())
      .filter((entry) => entry.length > 0);
    if (!list.length) {
      return;
    }
    result[normalized] = list;
  });
  return result;
}

export function extractConflictDetailsForOwner(
  attributes: Record<string, unknown> | null | undefined,
  ownerId: string | null | undefined,
): Record<string, string[]> {
  const trimmedOwner = (ownerId ?? '').trim();
  if (!trimmedOwner) {
    return extractConflictDetails(attributes);
  }
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const rawMap = attrs['service_by_owner'];
  if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
    const entry = (rawMap as Record<string, any>)[trimmedOwner];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const rawDetails = (entry as any).conflictDetails;
      if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
        const result: Record<string, string[]> = {};
        Object.entries(rawDetails as Record<string, unknown>).forEach(([code, value]) => {
          if (!Array.isArray(value)) {
            return;
          }
          const normalized = `${code ?? ''}`.trim();
          if (!normalized) {
            return;
          }
          const list = value
            .map((detail) => (detail ?? '').toString().trim())
            .filter((detail) => detail.length > 0);
          if (!list.length) {
            return;
          }
          result[normalized] = list;
        });
        return result;
      }
    }
  }
  return extractConflictDetails(attributes);
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
  const details = extractConflictDetails(attributes);
  const entries = codes.map((code) => {
    const normalized = code.trim();
    const def = CONFLICT_DEFINITIONS[normalized];
    const category = def?.category ?? 'unknown';
    const mergedDetails = mergeDetailLines(details[normalized], CONFLICT_RULE_HINTS[normalized]);
    return {
      code: normalized,
      category,
      categoryLabel: CONFLICT_CATEGORY_LABELS[category],
      label: def?.label ?? normalized,
      details: mergedDetails,
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
  const details = extractConflictDetailsForOwner(attributes, ownerId);
  const entries = codes.map((code) => {
    const normalized = code.trim();
    const def = CONFLICT_DEFINITIONS[normalized];
    const category = def?.category ?? 'unknown';
    const mergedDetails = mergeDetailLines(details[normalized], CONFLICT_RULE_HINTS[normalized]);
    return {
      code: normalized,
      category,
      categoryLabel: CONFLICT_CATEGORY_LABELS[category],
      label: def?.label ?? normalized,
      details: mergedDetails,
    } satisfies ConflictEntry;
  });
  return entries.sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.label.localeCompare(b.label));
}
