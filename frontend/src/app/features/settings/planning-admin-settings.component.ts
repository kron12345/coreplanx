import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { EMPTY } from 'rxjs';
import { catchError, finalize, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PlanningAdminApiService } from '../../core/api/planning-admin-api.service';
import type { PlanningAdminClearScope, PlanningAdminSummary } from '../../core/api/planning-admin-api.types';

type SampleCategory = keyof PlanningAdminSummary['samples'];

type SelectedSample = {
  key: string;
  category: SampleCategory;
  label: string;
  raw: Record<string, unknown>;
};

@Component({
  selector: 'app-planning-admin-settings',
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule,
    MatListModule,
    MatProgressBarModule,
  ],
  templateUrl: './planning-admin-settings.component.html',
  styleUrl: './planning-admin-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanningAdminSettingsComponent {
  private readonly api = inject(PlanningAdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly summary = signal<PlanningAdminSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly clearing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedSample = signal<SelectedSample | null>(null);
  protected readonly selectedSampleJson = computed(() => {
    const selected = this.selectedSample();
    if (!selected) {
      return '';
    }
    const raw = selected.raw;
    const payload =
      raw && typeof raw === 'object'
        ? raw
        : {
            category: selected.category,
            label: selected.label,
            raw,
          };
    return this.safeStringify(payload);
  });
  protected readonly selectedSampleTitle = computed(() => {
    const selected = this.selectedSample();
    if (!selected) {
      return '';
    }
    return `${this.categoryLabel(selected.category)}: ${selected.label}`;
  });

  protected sampleLimit = 30;
  protected confirmation = '';

  protected canClear(): boolean {
    const token = this.confirmation.trim().toUpperCase();
    return token === 'DELETE' && !this.clearing();
  }

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getPlanningDataSummary(this.effectiveLimit())
      .pipe(
        take(1),
        tap((summary) => {
          this.summary.set(summary);
          this.selectedSample.set(null);
        }),
        catchError((error) => {
          this.error.set(this.describeError(error, 'Planungsdaten konnten nicht geladen werden.'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected clearPlanningData(scope: PlanningAdminClearScope): void {
    if (!this.canClear()) {
      return;
    }
    if (!this.confirmDestructiveAction(scope)) {
      return;
    }
    this.clearing.set(true);
    this.error.set(null);
    const confirmation = this.confirmation.trim().toUpperCase();
    this.api
      .clearPlanningData(scope, confirmation)
      .pipe(
        take(1),
        tap(() => {
          this.confirmation = '';
          this.reload();
        }),
        catchError((error) => {
          this.error.set(this.describeError(error, 'Planungsdaten konnten nicht geloescht werden.'));
          return EMPTY;
        }),
        finalize(() => this.clearing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected selectSample(category: SampleCategory, key: string, label: string, raw: Record<string, unknown>): void {
    if (this.selectedSample()?.key === key) {
      this.selectedSample.set(null);
      return;
    }
    this.selectedSample.set({ key, category, label, raw });
  }

  protected isSelected(key: string): boolean {
    return this.selectedSample()?.key === key;
  }

  protected buildSampleKey(category: SampleCategory, primary: string, variantId?: string | null): string {
    return `${category}:${primary}:${variantId ?? ''}`;
  }

  private confirmDestructiveAction(scope: PlanningAdminClearScope): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const lines = [
      'Planungsdaten wirklich loeschen?',
      '',
      `Bereich: ${this.scopeLabel(scope)}.`,
    ];
    const note = this.scopeNote(scope);
    if (note) {
      lines.push('', note);
    }
    return window.confirm(
      lines.join('\n'),
    );
  }

  private effectiveLimit(): number {
    const raw = Number(this.sampleLimit);
    if (!Number.isFinite(raw)) {
      return 30;
    }
    return Math.min(40, Math.max(1, Math.round(raw)));
  }

  private describeError(error: unknown, fallback: string): string {
    const anyError = error as any;
    return (
      anyError?.error?.message ??
      anyError?.message ??
      fallback
    );
  }

  private safeStringify(value: unknown): string {
    try {
      const text = JSON.stringify(
        value,
        (_key, current) => (typeof current === 'bigint' ? current.toString() : current),
        2,
      );
      return text ?? '';
    } catch (error) {
      console.warn('Failed to stringify sample row for admin view.', error);
      return String(value);
    }
  }

  private scopeLabel(scope: PlanningAdminClearScope): string {
    switch (scope) {
      case 'all':
        return 'alle Planungsdaten (Basis/Betrieb, alle Varianten)';
      case 'stages':
        return 'Stages';
      case 'resources':
        return 'Ressourcen';
      case 'activities':
        return 'Aktivitaeten';
      case 'templates':
        return 'Basis-Templates';
      case 'train-runs':
        return 'Train Runs';
      case 'train-segments':
        return 'Train Segments';
    }
  }

  private scopeNote(scope: PlanningAdminClearScope): string {
    if (scope === 'stages') {
      return 'Stages entfernen auch Ressourcen, Aktivitaeten, Train Runs und Train Segments.';
    }
    if (scope === 'train-runs') {
      return 'Train Runs entfernen auch Train Segments.';
    }
    if (scope === 'templates') {
      return 'Basis-Templates entfernen die Basisplanung (Template-Timeline) inkl. der hinterlegten Tabellen.';
    }
    return '';
  }

  private categoryLabel(category: SampleCategory): string {
    switch (category) {
      case 'stages':
        return 'Stages';
      case 'resources':
        return 'Ressourcen';
      case 'activities':
        return 'Aktivitaeten';
      case 'templateActivities':
        return 'Template-Aktivitaeten';
      case 'trainRuns':
        return 'Train Runs';
      case 'trainSegments':
        return 'Train Segments';
    }
  }
}
