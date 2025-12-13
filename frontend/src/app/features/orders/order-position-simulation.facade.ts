import { DestroyRef, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import type { SimulationMode } from './order-position-dialog.models';
import type { OrderPositionForms } from './order-position-dialog.forms';
import { SimulationService } from '../../core/services/simulation.service';
import { SimulationRecord } from '../../core/models/simulation.model';
import {
  SimulationAssignDialogComponent,
  SimulationAssignDialogResult,
} from './shared/simulation-assign-dialog/simulation-assign-dialog.component';

type SimulationForms = Pick<OrderPositionForms, 'planForm' | 'manualPlanForm' | 'importOptionsForm'>;

@Injectable({ providedIn: 'root' })
export class OrderPositionSimulationFacade {
  constructor(
    private readonly simulationService: SimulationService,
    private readonly dialog: MatDialog,
  ) {}

  setupSimulationReactions(
    mode: SimulationMode,
    forms: SimulationForms,
    timetableYearLabel: string | null | undefined,
    fallbackTimetableYearLabel: string,
    destroyRef: DestroyRef,
  ) {
    const controls = this.simulationControls(mode, forms);
    controls.variant.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe((type) => {
      if (type === 'productive') {
        this.assignProductiveSimulation(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
      } else {
        this.ensureSimulationForYear(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
      }
    });
    controls.calendarYear.valueChanges
      ?.pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() =>
        this.ensureSimulationForYear(mode, forms, timetableYearLabel, fallbackTimetableYearLabel),
      );
  }

  assignProductiveSimulation(
    mode: SimulationMode,
    forms: SimulationForms,
    timetableYearLabel: string | null | undefined,
    fallbackTimetableYearLabel: string,
  ) {
    const year = this.resolveSimulationYear(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
    const candidates = this.simulationService.byTimetableYear(year);
    const record =
      candidates.find((sim) => sim.productive) ??
      candidates[0] ??
      this.simulationService.list().find((sim) => sim.productive);
    if (record) {
      this.applySimulationRecord(mode, forms, record);
    }
  }

  ensureSimulationSelected(
    mode: SimulationMode,
    forms: SimulationForms,
    timetableYearLabel: string | null | undefined,
    fallbackTimetableYearLabel: string,
  ): string | null {
    const controls = this.simulationControls(mode, forms);
    const type = controls.variant.value;
    if (type === 'productive') {
      if (!controls.simulationId.value) {
        this.assignProductiveSimulation(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
      }
      return null;
    }
    const year = this.resolveSimulationYear(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
    const current = this.findSimulation(controls.simulationId.value);
    if (current && !current.productive && this.simulationMatchesYear(current, year)) {
      return null;
    }
    this.openSimulationAssignment(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
    return 'Bitte eine Simulation für dieses Fahrplanjahr auswählen.';
  }

  simulationSelectionLabel(
    mode: SimulationMode,
    forms: SimulationForms,
    timetableYearLabel: string | null | undefined,
    fallbackTimetableYearLabel: string,
  ): string | null {
    const controls = this.simulationControls(mode, forms);
    const label = controls.simulationLabel.value ?? '';
    if (label.trim()) {
      return label.trim();
    }
    const year = this.resolveSimulationYear(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
    const record = this.findSimulation(controls.simulationId.value);
    if (record && this.simulationMatchesYear(record, year)) {
      return record.label;
    }
    return record?.label ?? null;
  }

  openSimulationAssignment(
    mode: SimulationMode,
    forms: SimulationForms,
    timetableYearLabel: string | null | undefined,
    fallbackTimetableYearLabel: string,
  ) {
    const year = this.resolveSimulationYear(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
    const controls = this.simulationControls(mode, forms);
    const dialogRef = this.dialog.open<
      SimulationAssignDialogComponent,
      { timetableYearLabel: string; selectedId?: string | null },
      SimulationAssignDialogResult | undefined
    >(SimulationAssignDialogComponent, {
      width: '520px',
      data: { timetableYearLabel: year, selectedId: controls.simulationId.value },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        if (!controls.simulationId.value) {
          this.assignProductiveSimulation(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
        }
        return;
      }
      controls.simulationId.setValue(result.simulationId, { emitEvent: false });
      controls.simulationLabel.setValue(result.simulationLabel, { emitEvent: false });
      if (controls.variant.value !== result.variantType) {
        controls.variant.setValue(result.variantType, { emitEvent: false });
      }
      if (!controls.variantLabel.value?.trim()) {
        controls.variantLabel.setValue(result.simulationLabel, { emitEvent: false });
      }
    });
  }

  private ensureSimulationForYear(
    mode: SimulationMode,
    forms: SimulationForms,
    timetableYearLabel: string | null | undefined,
    fallbackTimetableYearLabel: string,
  ) {
    const controls = this.simulationControls(mode, forms);
    const year = this.resolveSimulationYear(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
    const current = this.findSimulation(controls.simulationId.value);
    const type = controls.variant.value;

    if (type === 'productive') {
      if (!current || !current.productive || !this.simulationMatchesYear(current, year)) {
        this.assignProductiveSimulation(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
      }
      return;
    }

    if (current && !current.productive && this.simulationMatchesYear(current, year)) {
      return;
    }
    this.openSimulationAssignment(mode, forms, timetableYearLabel, fallbackTimetableYearLabel);
  }

  private simulationControls(mode: SimulationMode, forms: SimulationForms) {
    if (mode === 'plan') {
      return {
        variant: forms.planForm.controls.variantType,
        variantLabel: forms.planForm.controls.variantLabel,
        simulationId: forms.planForm.controls.simulationId,
        simulationLabel: forms.planForm.controls.simulationLabel,
        calendarYear: forms.planForm.controls.calendarYear,
      };
    }
    if (mode === 'manual') {
      return {
        variant: forms.manualPlanForm.controls.variantType,
        variantLabel: forms.manualPlanForm.controls.variantLabel,
        simulationId: forms.manualPlanForm.controls.simulationId,
        simulationLabel: forms.manualPlanForm.controls.simulationLabel,
        calendarYear: forms.manualPlanForm.controls.calendarYear,
      };
    }
    return {
      variant: forms.importOptionsForm.controls.variantType,
      variantLabel: forms.importOptionsForm.controls.variantLabel,
      simulationId: forms.importOptionsForm.controls.simulationId,
      simulationLabel: forms.importOptionsForm.controls.simulationLabel,
      calendarYear: forms.importOptionsForm.controls.calendarYear,
    };
  }

  private resolveSimulationYear(
    mode: SimulationMode,
    forms: SimulationForms,
    timetableYearLabel: string | null | undefined,
    fallbackTimetableYearLabel: string,
  ): string {
    const controls = this.simulationControls(mode, forms);
    const year = controls.calendarYear?.value?.trim();
    return year || timetableYearLabel || fallbackTimetableYearLabel;
  }

  private findSimulation(id: string | null | undefined): SimulationRecord | undefined {
    if (!id) {
      return undefined;
    }
    return this.simulationService.list().find((record) => record.id === id);
  }

  private simulationMatchesYear(record: SimulationRecord | undefined, year: string): boolean {
    if (!record || !year) {
      return false;
    }
    return (record.timetableYearLabel ?? '').toLowerCase() === year.trim().toLowerCase();
  }

  private applySimulationRecord(mode: SimulationMode, forms: SimulationForms, record: SimulationRecord) {
    const controls = this.simulationControls(mode, forms);
    controls.simulationId.setValue(record.id, { emitEvent: false });
    controls.simulationLabel.setValue(record.label, { emitEvent: false });
    const type: 'productive' | 'simulation' = record.productive ? 'productive' : 'simulation';
    if (controls.variant.value !== type) {
      controls.variant.setValue(type, { emitEvent: false });
    }
    if (!controls.variantLabel.value?.trim() || controls.variantLabel.value === 'Produktiv') {
      const label = record.productive ? 'Produktiv' : record.label;
      controls.variantLabel.setValue(label, { emitEvent: false });
    }
  }
}
