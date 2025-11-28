import { Injectable, Signal, computed, signal } from '@angular/core';

export interface TranslationEntry {
  label?: string;
  abbreviation?: string;
}

type LocaleBucket = Record<string, TranslationEntry>;
type TranslationState = Record<string, LocaleBucket>;

const STORAGE_KEY = 'app-translations.v1';
const LOCALE_KEY = 'app-translations.locale';
const DEFAULT_LOCALE = 'de';
const LEGACY_ACTIVITY_KEY = 'activity-type-i18n.v2';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly state = signal<TranslationState>({});
  private readonly activeLocaleSignal = signal<string>(DEFAULT_LOCALE);

  readonly activeLocale: Signal<string> = computed(() => this.activeLocaleSignal());
  readonly translations: Signal<LocaleBucket> = computed(
    () => this.state()[this.activeLocaleSignal()] ?? {},
  );
  readonly availableLocales: Signal<string[]> = computed(() => {
    const locales = new Set<string>([this.activeLocaleSignal()]);
    Object.keys(this.state()).forEach((loc) => locales.add(loc));
    return Array.from(locales);
  });

  constructor() {
    this.load();
  }

  setActiveLocale(locale: string): void {
    const cleaned = this.normalizeLocale(locale);
    this.activeLocaleSignal.set(cleaned);
    this.persistLocale(cleaned);
  }

  translate(key: string | null | undefined, fallback?: string, locale?: string): string {
    return this.getValue(key, 'label', fallback, locale);
  }

  translateAbbreviation(key: string | null | undefined, fallback?: string, locale?: string): string {
    return this.getValue(key, 'abbreviation', fallback, locale);
  }

  setLabel(key: string, value: string | null | undefined, locale?: string): void {
    this.setEntryValue(key, 'label', value, locale);
  }

  setAbbreviation(key: string, value: string | null | undefined, locale?: string): void {
    this.setEntryValue(key, 'abbreviation', value, locale);
  }

  clearKey(key: string, locale?: string): void {
    if (!key) {
      return;
    }
    const targetLocale = this.normalizeLocale(locale);
    this.state.update((current) => {
      const next = { ...current };
      const bucket = { ...(next[targetLocale] ?? {}) };
      delete bucket[key];
      if (Object.keys(bucket).length === 0) {
        delete next[targetLocale];
      } else {
        next[targetLocale] = bucket;
      }
      this.persist(next);
      return next;
    });
  }

  clearLocale(locale?: string): void {
    const targetLocale = this.normalizeLocale(locale);
    if (this.state()[targetLocale]) {
      const next = { ...this.state() };
      delete next[targetLocale];
      this.state.set(next);
      this.persist(next);
    }
  }

  clearAll(): void {
    this.state.set({});
    this.persist({});
  }

  private getValue(
    key: string | null | undefined,
    entryKey: keyof TranslationEntry,
    fallback?: string,
    locale?: string,
  ): string {
    if (!key) {
      return fallback ?? '';
    }
    const targetLocale = this.normalizeLocale(locale);
    const candidate = this.state()[targetLocale]?.[key]?.[entryKey];
    if (candidate && candidate.trim().length > 0) {
      return candidate.trim();
    }
    return fallback ?? '';
  }

  private setEntryValue(
    key: string,
    entryKey: keyof TranslationEntry,
    value: string | null | undefined,
    locale?: string,
  ): void {
    if (!key) {
      return;
    }
    const targetLocale = this.normalizeLocale(locale);
    const cleaned = (value ?? '').trim();
    this.state.update((current) => {
      const next = { ...current };
      const bucket = { ...(next[targetLocale] ?? {}) };
      const existing = bucket[key] ?? {};

      if (!cleaned) {
        const updated = { ...existing };
        delete updated[entryKey];
        if (Object.keys(updated).length === 0) {
          delete bucket[key];
        } else {
          bucket[key] = updated;
        }
      } else {
        bucket[key] = { ...existing, [entryKey]: cleaned };
      }

      if (Object.keys(bucket).length === 0) {
        delete next[targetLocale];
      } else {
        next[targetLocale] = bucket;
      }
      this.persist(next);
      return next;
    });
  }

  private normalizeLocale(locale?: string): string {
    return (locale || this.activeLocaleSignal() || DEFAULT_LOCALE).trim().toLowerCase() || DEFAULT_LOCALE;
  }

  private load(): void {
    try {
      const savedLocale = localStorage.getItem(LOCALE_KEY);
      if (savedLocale) {
        this.activeLocaleSignal.set(savedLocale);
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.state.set(parsed as TranslationState);
          return;
        }
      }
    } catch {
      // ignore parse/storage errors
    }

    // Migration from legacy activity-type store
    this.migrateLegacyActivityStore();
  }

  private migrateLegacyActivityStore(): void {
    try {
      const raw = localStorage.getItem(LEGACY_ACTIVITY_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      const bucket: LocaleBucket = {};
      Object.entries(parsed as Record<string, any>).forEach(([id, value]) => {
        if (typeof value === 'string') {
          bucket[`activityType:${id}`] = { label: value };
        } else if (value && typeof value === 'object') {
          const entry: TranslationEntry = {};
          if (typeof value.label === 'string') {
            entry.label = value.label;
          }
          if (typeof value.abbreviation === 'string') {
            entry.abbreviation = value.abbreviation;
          }
          bucket[`activityType:${id}`] = entry;
        }
      });
      if (Object.keys(bucket).length) {
        const next: TranslationState = { [this.activeLocaleSignal()]: bucket };
        this.state.set(next);
        this.persist(next);
      }
    } catch {
      // ignore
    }
  }

  private persist(state: TranslationState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  }

  private persistLocale(locale: string): void {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // ignore
    }
  }
}
