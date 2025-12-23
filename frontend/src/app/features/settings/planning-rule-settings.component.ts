import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, finalize, take, tap } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { PlanningRulesApiService } from '../../core/api/planning-rules-api.service';
import type { PlanningRuleDto } from '../../core/api/planning-rules-api.types';
import { TimetableYearApiService, type PlanningVariantDto } from '../../core/api/timetable-year-api.service';
import { TimetableYearService } from '../../core/services/timetable-year.service';
import type { PlanningApiContext } from '../../core/api/planning-api-context';
import type { PlanningStageId } from '../planning/planning-stage.model';

@Component({
  selector: 'app-planning-rule-settings',
  imports: [
    CommonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatListModule,
  ],
  templateUrl: './planning-rule-settings.component.html',
  styleUrl: './planning-rule-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanningRuleSettingsComponent {
  private readonly api = inject(PlanningRulesApiService);
  private readonly yearsApi = inject(TimetableYearApiService);
  private readonly yearBounds = inject(TimetableYearService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly stageId: PlanningStageId = 'base';
  protected readonly variants = signal<PlanningVariantDto[]>([]);
  protected readonly selectedVariantId = signal<string>('default');

  protected readonly rules = signal<PlanningRuleDto[]>([]);
  protected readonly selectedRuleId = signal<string | null>(null);
  protected readonly editorValue = signal<string>('');
  private readonly originalValue = signal<string>('');

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly selectedRule = computed(() => {
    const id = this.selectedRuleId();
    return id ? this.rules().find((rule) => rule.id === id) ?? null : null;
  });

  protected readonly isDirty = computed(() => {
    const selected = this.selectedRule();
    if (!selected) {
      return false;
    }
    return this.editorValue() !== this.originalValue();
  });

  protected readonly variantOptions = computed(() =>
    this.variants()
      .filter((variant) => variant.kind === 'productive')
      .sort((a, b) => a.timetableYearLabel.localeCompare(b.timetableYearLabel)),
  );

  constructor() {
    this.loadVariants();
  }

  protected reload(): void {
    this.loadRules();
  }

  protected resetToDefaults(): void {
    if (!this.confirmFactoryReset('Planungsregeln')) {
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.api
      .resetRules(this.stageId, this.apiContext())
      .pipe(
        take(1),
        tap((response) => {
          const items = response?.items ?? [];
          this.rules.set(items);
          const next = items[0]?.id ?? null;
          this.selectedRuleId.set(next);
          const selected = next ? items.find((rule) => rule.id === next) ?? null : null;
          this.editorValue.set(selected?.raw ?? '');
          this.originalValue.set(selected?.raw ?? '');
        }),
        catchError((error) => {
          console.warn('[PlanningRuleSettings] Failed to reset rules', error);
          const message =
            error?.error?.message ?? error?.message ?? 'Regeln konnten nicht zurückgesetzt werden.';
          this.error.set(String(message));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected selectRule(rule: PlanningRuleDto): void {
    this.selectedRuleId.set(rule.id);
    this.editorValue.set(rule.raw ?? '');
    this.originalValue.set(rule.raw ?? '');
    this.error.set(null);
  }

  protected handleVariantChange(variantId: string): void {
    this.selectedVariantId.set(variantId);
    this.loadRules();
  }

  protected save(): void {
    const rule = this.selectedRule();
    if (!rule || !this.isDirty()) {
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    const upsert: PlanningRuleDto = {
      ...rule,
      stageId: this.stageId,
      variantId: this.selectedVariantId(),
      raw: this.editorValue(),
    };

    this.api
      .mutateRules(
        this.stageId,
        { upserts: [upsert] },
        this.apiContext(),
      )
      .pipe(
        take(1),
        tap(() => {
          this.originalValue.set(this.editorValue());
          this.loadRules();
        }),
        catchError((error) => {
          const message = error?.error?.message ?? error?.message ?? 'Regel konnte nicht gespeichert werden.';
          console.warn('[PlanningRuleSettings] Failed to save rule', error);
          this.error.set(String(message));
          return EMPTY;
        }),
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected handleEditorInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    this.editorValue.set(target?.value ?? '');
  }

  private loadVariants(): void {
    this.loading.set(true);
    this.yearsApi
      .listVariants()
      .pipe(
        take(1),
        tap((variants) => {
          this.variants.set(variants ?? []);
          const next = this.pickDefaultVariantId(variants ?? []);
          this.selectedVariantId.set(next);
          this.loadRules();
        }),
        catchError((error) => {
          console.warn('[PlanningRuleSettings] Failed to load variants', error);
          this.error.set('Varianten konnten nicht geladen werden.');
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private loadRules(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api
      .listRules(this.stageId, this.apiContext())
      .pipe(
        take(1),
        tap((response) => {
          const items = response?.items ?? [];
          this.rules.set(items);
          const selectedId = this.selectedRuleId();
          const stillExists = selectedId ? items.some((rule) => rule.id === selectedId) : false;
          const next = stillExists ? selectedId : items[0]?.id ?? null;
          this.selectedRuleId.set(next);
          const selected = next ? items.find((rule) => rule.id === next) ?? null : null;
          this.editorValue.set(selected?.raw ?? '');
          this.originalValue.set(selected?.raw ?? '');
        }),
        catchError((error) => {
          console.warn('[PlanningRuleSettings] Failed to load rules', error);
          const message = error?.error?.message ?? error?.message ?? 'Regeln konnten nicht geladen werden.';
          this.error.set(String(message));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private apiContext(): PlanningApiContext {
    return { variantId: this.selectedVariantId() };
  }

  private pickDefaultVariantId(variants: PlanningVariantDto[]): string {
    const productive = variants.filter((variant) => variant.kind === 'productive');
    if (!productive.length) {
      return variants[0]?.id ?? 'default';
    }
    const desiredYear = this.yearBounds.defaultYearBounds().label;
    const match = productive.find((variant) => variant.timetableYearLabel === desiredYear);
    return match?.id ?? productive[productive.length - 1].id;
  }

  private confirmFactoryReset(scopeLabel: string): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.confirm(
      `${scopeLabel}: Werkseinstellungen wiederherstellen?\n\nAlle Änderungen in diesem Bereich werden überschrieben.`,
    );
  }
}
