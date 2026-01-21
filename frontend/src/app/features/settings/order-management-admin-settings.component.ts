import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { EMPTY } from 'rxjs';
import { catchError, finalize, take, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OrderManagementAdminApiService } from '../../core/api/order-management-admin-api.service';
import type {
  OrderManagementAdminSummary,
} from '../../core/api/order-management-admin-api.types';

@Component({
  selector: 'app-order-management-admin-settings',
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDividerModule,
    MatProgressBarModule,
  ],
  templateUrl: './order-management-admin-settings.component.html',
  styleUrl: './order-management-admin-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderManagementAdminSettingsComponent {
  private readonly api = inject(OrderManagementAdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly summary = signal<OrderManagementAdminSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly totals = computed(() => {
    return (
      this.summary()?.totals ?? {
        customers: 0,
        businesses: 0,
        scheduleTemplates: 0,
        orders: 0,
        orderItems: 0,
      }
    );
  });

  protected confirmation = '';

  protected readonly canExecute = computed(() => {
    return this.confirmation.trim().toUpperCase() === 'DELETE' && !this.busy();
  });

  constructor() {
    this.reload();
  }

  protected reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getSummary()
      .pipe(
        take(1),
        tap((summary) => {
          this.summary.set(summary);
          this.warnings.set([]);
        }),
        catchError((error) => {
          this.error.set(this.describeError(error, 'Auftragsdaten konnten nicht geladen werden.'));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected clearData(): void {
    if (!this.canExecute()) {
      return;
    }
    if (!this.confirmAction('Auftragsdaten wirklich loeschen?')) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.api
      .clearData(this.confirmation.trim().toUpperCase())
      .pipe(
        take(1),
        tap(() => {
          this.confirmation = '';
          this.reload();
        }),
        catchError((error) => {
          this.error.set(this.describeError(error, 'Auftragsdaten konnten nicht geloescht werden.'));
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  protected seedData(): void {
    if (!this.canExecute()) {
      return;
    }
    if (!this.confirmAction('Mockdaten laden und bestehende Daten entfernen?')) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.api
      .seedData(this.confirmation.trim().toUpperCase(), 'replace')
      .pipe(
        take(1),
        tap((response) => {
          this.confirmation = '';
          this.warnings.set(response.warnings ?? []);
          this.reload();
        }),
        catchError((error) => {
          this.error.set(this.describeError(error, 'Mockdaten konnten nicht geladen werden.'));
          return EMPTY;
        }),
        finalize(() => this.busy.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private confirmAction(message: string): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.confirm(message);
  }

  private describeError(error: unknown, fallback: string): string {
    const anyError = error as any;
    return (
      anyError?.error?.message ??
      anyError?.message ??
      fallback
    );
  }
}
