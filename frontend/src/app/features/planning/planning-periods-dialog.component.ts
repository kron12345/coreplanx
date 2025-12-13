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
    imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
    templateUrl: './planning-periods-dialog.component.html',
    styleUrl: './planning-periods-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
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
