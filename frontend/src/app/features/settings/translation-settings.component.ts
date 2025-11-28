import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslationService } from '../../core/services/translation.service';
import { ActivityTypeService } from '../../core/services/activity-type.service';
import { map, startWith } from 'rxjs/operators';
import { Observable } from 'rxjs';

interface TranslationRow {
  key: string;
  label?: string;
  abbreviation?: string;
  hint?: string;
}

@Component({
  selector: 'app-translation-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    MatSelectModule,
    MatAutocompleteModule,
  ],
  templateUrl: './translation-settings.component.html',
  styleUrl: './translation-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TranslationSettingsComponent {
  private readonly i18n = inject(TranslationService);
  private readonly activityTypes = inject(ActivityTypeService);
  private readonly fb = inject(FormBuilder);

  protected readonly activeLocale = this.i18n.activeLocale;
  protected readonly availableLocales = this.i18n.availableLocales;
  protected readonly translations = this.i18n.translations;
  protected newLocaleValue = 'de';

  protected readonly knownKeys: string[] = [];
  protected filteredKnownKeys$: Observable<string[]>;

  protected readonly presets = computed(() => {
    return this.activityTypes
      .definitions()
      .map((type) => ({
        key: `activityType:${type.id}`,
        label: type.label,
        hint: 'Activity Type',
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'de'));
  });

  protected readonly rows = computed<TranslationRow[]>(() => {
    const entries = this.translations();
    const list: TranslationRow[] = Object.entries(entries).map(([key, entry]) => ({
      key,
      label: entry.label,
      abbreviation: entry.abbreviation,
    }));
    return list.sort((a, b) => a.key.localeCompare(b.key, 'de'));
  });

  protected readonly newEntryForm = this.fb.group({
    key: ['', [Validators.required, Validators.maxLength(120)]],
    label: ['', [Validators.maxLength(120)]],
    abbreviation: ['', [Validators.maxLength(40)]],
  });

  constructor() {
    // build list of known keys (current locale + presets)
    const presetKeys = new Set(this.presets().map((p) => p.key));
    const localeKeys = Object.keys(this.translations());
    localeKeys.forEach((k) => presetKeys.add(k));
    this.knownKeys = Array.from(presetKeys).sort();

    this.filteredKnownKeys$ = this.newEntryForm.controls.key.valueChanges.pipe(
      startWith(''),
      map((value) => this.filterKnownKeys(value ?? '')),
    );
  }

  protected filteredKnownKeys(): string[] {
    // fallback for template without async pipe in case we need sync access
    return this.filterKnownKeys(this.newEntryForm.controls.key.value ?? '');
  }

  private filterKnownKeys(raw: string): string[] {
    const term = (raw ?? '').toLowerCase();
    if (!term) {
      return this.knownKeys.slice(0, 20);
    }
    return this.knownKeys.filter((key) => key.toLowerCase().includes(term)).slice(0, 20);
  }

  protected translationFor(key: string): string {
    return this.translations()[key]?.label ?? '';
  }

  protected abbreviationFor(key: string): string {
    return this.translations()[key]?.abbreviation ?? '';
  }

  protected updateTranslation(key: string, value: string): void {
    this.i18n.setLabel(key, value);
  }

  protected updateAbbreviation(key: string, value: string): void {
    this.i18n.setAbbreviation(key, value);
  }

  protected clearKey(key: string): void {
    this.i18n.clearKey(key);
  }

  protected changeLocale(locale: string): void {
    if (!locale) {
      return;
    }
    this.i18n.setActiveLocale(locale);
    this.newLocaleValue = locale;
  }

  protected addLocale(): void {
    const locale = (this.newLocaleValue || '').trim().toLowerCase();
    if (!locale) {
      return;
    }
    this.changeLocale(locale);
  }

  protected clearLocale(): void {
    this.i18n.clearLocale(this.activeLocale());
  }

  protected applyPreset(key: string | null): void {
    if (!key) {
      return;
    }
    const preset = this.presets().find((p) => p.key === key);
    if (!preset) {
      return;
    }
    this.i18n.setLabel(preset.key, preset.label);
  }

  protected saveNewEntry(): void {
    if (this.newEntryForm.invalid) {
      this.newEntryForm.markAllAsTouched();
      return;
    }
    const raw = this.newEntryForm.getRawValue();
    const key = (raw.key ?? '').trim();
    if (!key) {
      return;
    }
    this.i18n.setLabel(key, raw.label ?? '');
    this.i18n.setAbbreviation(key, raw.abbreviation ?? '');
    this.newEntryForm.reset({
      key: '',
      label: '',
      abbreviation: '',
    });
  }
}
