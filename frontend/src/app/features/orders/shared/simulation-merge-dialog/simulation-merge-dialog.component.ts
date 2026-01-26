import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../../../core/material.imports.imports';
import { OrderItem } from '../../../../core/models/order-item.model';
import { OrderService } from '../../../../core/services/order.service';
import { TrainPlanService } from '../../../../core/services/train-plan.service';

export interface SimulationMergeDialogData {
  orderId: string;
  simulationItem: OrderItem;
}

export interface SimulationMergeDialogResult {
  type: 'updated' | 'created' | 'modification';
  targetId: string;
}

type DiffEntry = { field: string; simulation: string | undefined; productive: string | undefined };

@Component({
    selector: 'app-simulation-merge-dialog',
    imports: [CommonModule, ...MATERIAL_IMPORTS],
    templateUrl: './simulation-merge-dialog.component.html',
    styleUrl: './simulation-merge-dialog.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SimulationMergeDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<SimulationMergeDialogComponent, SimulationMergeDialogResult>>(MatDialogRef);
  private readonly data = inject<SimulationMergeDialogData>(MAT_DIALOG_DATA);
  private readonly orderService = inject(OrderService);
  private readonly planService = inject(TrainPlanService);

  readonly simulation = this.data.simulationItem;
  readonly orderId = this.data.orderId;
  readonly order = this.orderService.getOrderById(this.orderId);
  readonly productive = this.resolveProductive();
  readonly canUpdateProductive = computed(
    () => !!this.productive && (this.productive.timetablePhase ?? 'bedarf') === 'bedarf',
  );
  readonly canCreateModification = computed(
    () => !!this.productive && (this.productive.timetablePhase ?? 'bedarf') !== 'bedarf',
  );
  readonly canCreateNew = computed(() => !this.productive);

  readonly diffs = computed<DiffEntry[]>(() => this.buildDiffs());

  private resolveProductive(): OrderItem | null {
    if (!this.order) {
      return null;
    }
    const groupId = this.simulation.variantGroupId ?? this.simulation.variantOfItemId ?? null;
    const candidates = this.order.items.filter((it) => (it.variantType ?? 'productive') === 'productive');
    if (!groupId) {
      return candidates[0] ?? null;
    }
    return (
      candidates.find((it) => it.variantGroupId === groupId || it.id === this.simulation.variantOfItemId) ?? null
    );
  }

  private buildDiffs(): DiffEntry[] {
    const sim = this.simulation;
    const prod = this.productive;
    const entries: DiffEntry[] = [];
    const add = (field: string, s: string | undefined | null, p: string | undefined | null) => {
      const sVal = (s ?? '').trim();
      const pVal = (p ?? '').trim();
      if (sVal === pVal) {
        return;
      }
      entries.push({ field, simulation: sVal || '—', productive: pVal || '—' });
    };
    add('Name', sim.name, prod?.name);
    add('Verantwortlich', sim.responsible, prod?.responsible);
    add('Bemerkung', sim.deviation, prod?.deviation);
    add('Von', sim.fromLocation, prod?.fromLocation);
    add('Nach', sim.toLocation, prod?.toLocation);
    add('Tags', sim.tags?.join(', '), prod?.tags?.join(', '));
    add('Fahrplanjahr', sim.timetableYearLabel, prod?.timetableYearLabel);
    const simPlan = sim.linkedTrainPlanId ? this.planService.getById(sim.linkedTrainPlanId) : null;
    const prodPlan = prod?.linkedTrainPlanId ? this.planService.getById(prod.linkedTrainPlanId!) : null;
    add('Zug', simPlan?.trainNumber, prodPlan?.trainNumber);
    add('Titel', simPlan?.title, prodPlan?.title);
    add('Referenzkalender', sim.trafficPeriodId, prod?.trafficPeriodId);
    add('Variante', sim.variantLabel, prod?.variantLabel);
    add('Status', sim.timetablePhase, prod?.timetablePhase);
    add('Start', simPlan?.calendar.validFrom ?? sim.start, prodPlan?.calendar.validFrom ?? prod?.start);
    add('Ende', simPlan?.calendar.validTo ?? sim.end, prodPlan?.calendar.validTo ?? prod?.end);
    add('Kalender von', simPlan?.calendar.validFrom, prodPlan?.calendar.validFrom);
    add('Kalender bis', simPlan?.calendar.validTo, prodPlan?.calendar.validTo);
    return entries;
  }

  async merge(): Promise<void> {
    try {
      const result = await this.orderService.mergeSimulationIntoProductive(this.orderId, this.simulation.id);
      this.dialogRef.close({ type: result.type, targetId: result.target.id });
    } catch (error) {
      console.error(error);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
