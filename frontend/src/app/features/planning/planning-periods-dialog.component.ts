import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TemplateSetDto, TemplatePeriod } from '../../core/api/timeline-api.types';
import { TimetableYearBounds } from '../../core/models/timetable-year.model';

interface DialogData {
  template: TemplateSetDto;
  year: TimetableYearBounds;
}

@Component({
  selector: 'app-planning-periods-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <h2 mat-dialog-title>Zeiträume verwalten</h2>
    <div mat-dialog-content>
      <p class="muted">Fahrplanjahr {{ data.year.label }} ({{ data.year.startIso }} – {{ data.year.endIso }})</p>
      <div class="period-list" *ngIf="periods.length; else empty">
        <div class="period" *ngFor="let period of periods; let i = index">
          <div>
            <strong>{{ period.validFrom }}</strong>
            <span>bis {{ period.validTo || 'offen' }}</span>
          </div>
          <button
            mat-icon-button
            color="warn"
            (click)="onDelete(period.id, i)"
            [disabled]="i === 0"
            [matTooltip]="i === 0 ? 'Erster Zeitraum kann nicht gelöscht werden' : 'Zeitraum löschen'"
          >
            <mat-icon fontIcon="delete"></mat-icon>
          </button>
        </div>
      </div>
      <ng-template #empty>
        <p class="muted">Keine Zeiträume definiert.</p>
      </ng-template>
      <h3 class="section-title">Spezialtage</h3>
      <div class="special-list" *ngIf="specialDays.length; else noSpecials">
        <div class="special" *ngFor="let day of specialDays">
          <span>{{ day }}</span>
          <button
            mat-icon-button
            color="warn"
            (click)="onDeleteSpecial(day)"
            matTooltip="Spezialtag löschen"
          >
            <mat-icon fontIcon="delete"></mat-icon>
          </button>
        </div>
      </div>
      <ng-template #noSpecials>
        <p class="muted">Keine Spezialtage definiert.</p>
      </ng-template>
    </div>
    <div mat-dialog-actions align="end">
      <button mat-stroked-button (click)="dialogRef.close()">Schließen</button>
    </div>
  `,
  styles: [
    `
      .period-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
      }
      .period {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 6px;
      }
      .muted {
        color: #666;
        font-size: 13px;
      }
      .section-title {
        margin-top: 16px;
        margin-bottom: 4px;
        font-size: 14px;
      }
      .special-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .special {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px;
        border: 1px solid #ddd;
        border-radius: 6px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanningPeriodsDialogComponent {
  protected readonly dialogRef = inject(MatDialogRef<PlanningPeriodsDialogComponent>);
  protected readonly data = inject<DialogData>(MAT_DIALOG_DATA);

  protected readonly periods: TemplatePeriod[] = [...(this.data.template.periods ?? [])].sort((a, b) =>
    a.validFrom.localeCompare(b.validFrom),
  );
  protected readonly specialDays: string[] = [...(this.data.template.specialDays ?? [])].sort();

  protected onDelete(id: string, index: number): void {
    if (index === 0) {
      return;
    }
    this.dialogRef.close({ periodId: id });
  }

  protected onDeleteSpecial(dateIso: string): void {
    this.dialogRef.close({ specialDay: dateIso });
  }
}
