import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormArray, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MATERIAL_IMPORTS } from '../../../core/material.imports.imports';
import type { ScheduleTemplate } from '../../../core/models/schedule-template.model';
import type { TimetableYearBounds } from '../../../core/models/timetable-year.model';
import type { TrafficPeriod } from '../../../core/models/traffic-period.model';
import type {
  ImportedRailMlTrain,
  ImportedTemplateStopComparison,
  ImportedRailMlStop,
} from '../../../core/services/order.service';
import { OrderImportFiltersComponent } from '../order-import-filters/order-import-filters.component';
import {
  VehicleCompositionFormComponent,
  type CompositionBaseVehicleForm,
  type CompositionChangeEntryForm,
} from '../shared/vehicle-composition-form/vehicle-composition-form.component';

@Component({
  selector: 'app-order-position-import-tab',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ...MATERIAL_IMPORTS,
    VehicleCompositionFormComponent,
    OrderImportFiltersComponent,
  ],
  templateUrl: './order-position-import-tab.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderPositionImportTabComponent {
  @Input() importError: string | null = null;
  @Input({ required: true }) importedTrainsLength!: number;
  @Input({ required: true }) filteredTrains!: ImportedRailMlTrain[];
  @Input({ required: true }) selectedTrainIds!: Set<string>;
  @Input({ required: true }) expandedTrainIds!: Set<string>;
  @Input({ required: true }) hasTaktTemplates!: boolean;

  @Input({ required: true }) importOptionsForm!: FormGroup;
  @Input({ required: true }) trafficPeriods!: TrafficPeriod[];
  @Input({ required: true }) managedTimetableYears!: TimetableYearBounds[];
  @Input({ required: true }) importOptionsDescriptions!: Record<string, string>;
  @Input() simulationSelectionLabel: string | null = null;

  @Input({ required: true }) requiresRollingStock!: boolean;
  @Input({ required: true }) baseVehicles!: FormArray<CompositionBaseVehicleForm>;
  @Input({ required: true }) changeEntries!: FormArray<CompositionChangeEntryForm>;
  @Input() baseVehicleFactory?: (
    seed?: { vehicleType?: string; count?: number; note?: string | null },
  ) => CompositionBaseVehicleForm;

  @Input({ required: true }) importFilters!: FormGroup;
  @Input({ required: true }) importFilterDescriptions!: Record<string, string>;
  @Input() taktTemplates: ScheduleTemplate[] = [];

  @Output() railMlFileSelected = new EventEmitter<Event>();
  @Output() clearImportedDataRequested = new EventEmitter<void>();
  @Output() simulationAssignmentRequested = new EventEmitter<void>();
  @Output() importFiltersResetRequested = new EventEmitter<void>();
  @Output() selectAllFilteredRequested = new EventEmitter<boolean>();
  @Output() trainSelectionToggled = new EventEmitter<{ id: string; selected: boolean }>();
  @Output() trainExpansionToggled = new EventEmitter<{ id: string; event?: Event }>();

  isTrainSelected(id: string): boolean {
    return this.selectedTrainIds.has(id);
  }

  isTrainExpanded(id: string): boolean {
    return this.expandedTrainIds.has(id);
  }

  hasDeviation(value: number | null | undefined): boolean {
    return typeof value === 'number' && Math.abs(value) > 0.01;
  }

  stopHasDeviation(comparison: ImportedTemplateStopComparison): boolean {
    return (
      this.hasDeviation(comparison.arrivalDeviationMinutes) ||
      this.hasDeviation(comparison.departureDeviationMinutes)
    );
  }

  stopTimeLabel(stop: ImportedRailMlStop, type: 'arrival' | 'departure'): string {
    const earliest =
      type === 'arrival' ? stop.arrivalEarliest : stop.departureEarliest;
    const latest =
      type === 'arrival' ? stop.arrivalLatest : stop.departureLatest;
    if (earliest && latest && earliest !== latest) {
      return `${earliest} · ${latest}`;
    }
    return earliest ?? latest ?? '—';
  }
}

