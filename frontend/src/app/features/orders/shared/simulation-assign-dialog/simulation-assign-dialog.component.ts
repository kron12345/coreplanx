import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioChange, MatRadioModule } from '@angular/material/radio';
import { MATERIAL_IMPORTS } from '../../../../core/material.imports.imports';
import { SimulationRecord } from '../../../../core/models/simulation.model';
import { SimulationService } from '../../../../core/services/simulation.service';

export interface SimulationAssignDialogData {
  timetableYearLabel: string;
  selectedId?: string | null;
  title?: string;
  allowProductive?: boolean;
}

export interface SimulationAssignDialogResult {
  simulationId: string;
  simulationLabel: string;
  variantType: 'productive' | 'simulation';
}

@Component({
    selector: 'app-simulation-assign-dialog',
    imports: [
        CommonModule,
        MatDialogModule,
        MatButtonModule,
        MatIconModule,
        MatRadioModule,
        ...MATERIAL_IMPORTS,
    ],
    templateUrl: './simulation-assign-dialog.component.html',
    styleUrl: './simulation-assign-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SimulationAssignDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<SimulationAssignDialogComponent, SimulationAssignDialogResult>>(MatDialogRef);
  private readonly data = inject<SimulationAssignDialogData>(MAT_DIALOG_DATA);
  private readonly simulations = inject(SimulationService);

  readonly title = this.data.title ?? 'Simulation oder Produktiv zuordnen';
  readonly yearLabel = this.data.timetableYearLabel;
  readonly records = computed<SimulationRecord[]>(() => {
    const list = this.simulations.byTimetableYear(this.data.timetableYearLabel);
    return list
      .slice()
      .sort((a, b) => {
        if (!!a.productive !== !!b.productive) {
          return a.productive ? -1 : 1;
        }
        return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
      })
      .filter((rec) => (this.data.allowProductive === false ? !rec.productive : true));
  });

  readonly selectedId = signal<string | null>(this.data.selectedId ?? null);

  constructor() {
    effect(() => {
      const current = this.selectedId();
      const available = this.records();
      if (!available.length) {
        this.selectedId.set(null);
        return;
      }
      const fallback = available[0].id;
      if (!current || !available.some((rec) => rec.id === current)) {
        this.selectedId.set(this.data.selectedId ?? fallback);
      }
    });
  }

  select(change: MatRadioChange | string) {
    const next = typeof change === 'string' ? change : change.value;
    this.selectedId.set(next);
  }

  confirm() {
    const record = this.records().find((rec) => rec.id === this.selectedId());
    if (!record) {
      this.dialogRef.close();
      return;
    }
    const result: SimulationAssignDialogResult = {
      simulationId: record.id,
      simulationLabel: record.label,
      variantType: record.productive ? 'productive' : 'simulation',
    };
    this.dialogRef.close(result);
  }

  cancel() {
    this.dialogRef.close();
  }
}
