import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { PlanningCatalogApiService, type TranslationState } from '../api/planning-catalog-api.service';

export interface TranslationEntry {
  label?: string | null;
  abbreviation?: string | null;
}

type LocaleBucket = Record<string, TranslationEntry>;

const STORAGE_KEY = 'app-translations.v1';
const LOCALE_KEY = 'app-translations.locale';
const DEFAULT_LOCALE = 'de';
const LEGACY_ACTIVITY_KEY = 'activity-type-i18n.v2';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly api = inject(PlanningCatalogApiService);
  private readonly state = signal<TranslationState>({});
  private readonly activeLocaleSignal = signal<string>(DEFAULT_LOCALE);
  private loadingPromise: Promise<void> | null = null;

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
    this.loadLocale();
    void this.init();
  }

  async init(): Promise<void> {
    await this.loadFromApi();
  }

  async refresh(): Promise<void> {
    await this.loadFromApi(true);
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
      return next;
    });
    void this.persist();
  }

  clearLocale(locale?: string): void {
    const targetLocale = this.normalizeLocale(locale);
    if (this.state()[targetLocale]) {
      const next = { ...this.state() };
      delete next[targetLocale];
      this.state.set(next);
      void this.persist();
    }
  }

  clearAll(): void {
    this.state.set({});
    void this.persist();
  }

  resetToDefaults(): void {
    this.activeLocaleSignal.set(DEFAULT_LOCALE);
    this.persistLocale(DEFAULT_LOCALE);
    this.state.set({});
    void this.persist();
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
      return next;
    });
    void this.persist();
  }

  private normalizeLocale(locale?: string): string {
    return (locale || this.activeLocaleSignal() || DEFAULT_LOCALE).trim().toLowerCase() || DEFAULT_LOCALE;
  }

  private async loadFromApi(force = false): Promise<void> {
    if (this.loadingPromise) {
      const pending = this.loadingPromise;
      await pending;
      if (!force) {
        return;
      }
    }
    this.loadingPromise = (async () => {
      try {
        const state = await this.api.getTranslations();
        if (state && Object.keys(state).length) {
          this.state.set(state);
          return;
        }
        const legacy = this.loadLegacyState();
        if (legacy) {
          this.state.set(legacy);
          await this.persist();
          return;
        }
        this.state.set({});
      } catch {
        const legacy = this.loadLegacyState();
        if (legacy) {
          this.state.set(legacy);
        }
      } finally {
        this.loadingPromise = null;
      }
    })();
    await this.loadingPromise;
  }

  private loadLocale(): void {
    try {
      const savedLocale = localStorage.getItem(LOCALE_KEY);
      if (savedLocale) {
        this.activeLocaleSignal.set(savedLocale);
      }
    } catch {
      // ignore
    }
  }

  private loadLegacyState(): TranslationState | null {
    const fromStorage = this.readTranslationStorage();
    if (fromStorage && Object.keys(fromStorage).length) {
      return fromStorage;
    }
    const legacy = this.readLegacyActivityStore();
    return legacy && Object.keys(legacy).length ? legacy : null;
  }

  private readTranslationStorage(): TranslationState | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as TranslationState;
      }
    } catch {
      // ignore parse/storage errors
    }
    return null;
  }

  private readLegacyActivityStore(): TranslationState | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const raw = localStorage.getItem(LEGACY_ACTIVITY_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
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
        return { [this.activeLocaleSignal()]: bucket };
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async persist(): Promise<void> {
    try {
      await this.api.replaceTranslations(this.state());
    } catch {
      // API-Fehler werden ignoriert, in-memory State bleibt bestehen.
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
