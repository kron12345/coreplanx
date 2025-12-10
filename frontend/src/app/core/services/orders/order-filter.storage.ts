import { DEFAULT_ORDER_FILTERS, ORDER_FILTERS_STORAGE_KEY, OrderFilters } from './order-filters.model';

export function detectFilterStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function restoreFilters(storage: Storage | null): OrderFilters | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(ORDER_FILTERS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<OrderFilters>;
    return { ...DEFAULT_ORDER_FILTERS, ...parsed };
  } catch {
    return null;
  }
}

export function persistFilters(storage: Storage | null, filters: OrderFilters): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(ORDER_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore persistence issues
  }
}
