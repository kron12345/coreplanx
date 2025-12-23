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

