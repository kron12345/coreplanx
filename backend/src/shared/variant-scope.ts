const PRODUCTIVE_PREFIX = 'PROD-';
const SIMULATION_PREFIX = 'SIM-';
const YEAR_LABEL_PATTERN = /^(\d{4}[/-]\d{2})(?:-|$)/;

export function normalizeVariantId(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length ? trimmed : 'default';
}

export function isProductiveVariantId(variantId: string): boolean {
  return variantId.trim().toUpperCase().startsWith(PRODUCTIVE_PREFIX);
}

export function isSimulationVariantId(variantId: string): boolean {
  return variantId.trim().toUpperCase().startsWith(SIMULATION_PREFIX);
}

export function buildProductiveVariantId(timetableYearLabel: string): string {
  const trimmed = timetableYearLabel.trim();
  if (!trimmed) {
    throw new Error('timetableYearLabel must not be empty');
  }
  return `${PRODUCTIVE_PREFIX}${trimmed}`;
}

export function deriveTimetableYearLabelFromVariantId(
  variantId: string,
): string | null {
  const trimmed = variantId.trim();
  if (!trimmed || trimmed === 'default') {
    return null;
  }
  if (isProductiveVariantId(trimmed)) {
    const label = trimmed.slice(PRODUCTIVE_PREFIX.length).trim();
    return label || null;
  }
  if (isSimulationVariantId(trimmed)) {
    const rest = trimmed.slice(SIMULATION_PREFIX.length).trim();
    const match = YEAR_LABEL_PATTERN.exec(rest);
    return match?.[1] ?? null;
  }
  return null;
}
