import type {
  BusinessFilters,
  BusinessSort,
} from '../../core/services/business.service';
import type { SavedFilterPreset } from './business-list.types';

export function createBusinessPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function defaultBusinessPresetName(count: number): string {
  return `Ansicht ${count + 1}`;
}

export function normalizeBusinessFilters(filters?: BusinessFilters): BusinessFilters {
  return {
    search: filters?.search ?? '',
    status: filters?.status ?? 'all',
    dueDate: filters?.dueDate ?? 'all',
    assignment: filters?.assignment ?? 'all',
    tags: filters?.tags ?? [],
  } as BusinessFilters;
}

export function businessFiltersEqual(a: BusinessFilters, b: BusinessFilters): boolean {
  return (
    a.search === b.search &&
    a.assignment === b.assignment &&
    a.status === b.status &&
    a.dueDate === b.dueDate &&
    sameTags(a.tags, b.tags)
  );
}

export function businessPresetMatchesCurrent(
  preset: SavedFilterPreset,
  currentFilters: BusinessFilters,
  currentSort: BusinessSort,
): boolean {
  return (
    businessFiltersEqual(preset.filters, currentFilters) &&
    preset.sort.field === currentSort.field &&
    preset.sort.direction === currentSort.direction
  );
}

export function loadBusinessFilterPresets(storageKey: string): SavedFilterPreset[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as SavedFilterPreset[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((preset) => ({
      ...preset,
      filters: normalizeBusinessFilters(preset.filters as BusinessFilters | undefined),
      sort: { ...preset.sort },
    }));
  } catch (error) {
    console.warn('Filter-Presets konnten nicht geladen werden', error);
    return [];
  }
}

export function persistBusinessFilterPresets(
  storageKey: string,
  presets: SavedFilterPreset[],
): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(presets));
  } catch (error) {
    console.warn('Filter-Presets konnten nicht gespeichert werden', error);
  }
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const normalize = (tags: string[]) =>
    [...tags].map((tag) => tag.toLowerCase()).sort();
  const aSorted = normalize(a);
  const bSorted = normalize(b);
  return aSorted.every((tag, index) => tag === bSorted[index]);
}

