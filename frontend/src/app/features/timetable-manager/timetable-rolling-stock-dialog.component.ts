import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MATERIAL_IMPORTS } from '../../core/material.imports.imports';
import {
  TimetableRollingStock,
  TimetableRollingStockSegment,
  TimetableRollingStockSegmentRole,
  TimetableRollingStockOperation,
  TimetableStop,
} from '../../core/models/timetable.model';
import { VehicleComposition, VehicleType } from '../../models/master-data';

export interface RollingStockDialogData {
  rollingStock?: TimetableRollingStock;
  vehicleTypes: VehicleType[];
  vehicleCompositions: VehicleComposition[];
  stops: Array<Pick<TimetableStop, 'id' | 'locationName' | 'sequence'>>;
}

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-timetable-rolling-stock-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './timetable-rolling-stock-dialog.component.html',
  styleUrl: './timetable-rolling-stock-dialog.component.scss',
})
export class TimetableRollingStockDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<TimetableRollingStockDialogComponent, TimetableRollingStock | null>>(
      MatDialogRef,
    );
  private readonly data = inject<RollingStockDialogData>(MAT_DIALOG_DATA);
  private readonly fb = inject(FormBuilder);

  private readonly vehicleTypeMap = new Map(
    this.data.vehicleTypes.map((type) => [type.id, type] as const),
  );
  private readonly compositionMap = new Map(
    this.data.vehicleCompositions.map((composition) => [composition.id, composition] as const),
  );

  protected readonly hasInitialRollingStock = !!this.data.rollingStock;

  protected readonly vehicleTypeOptions: SelectOption[] = this.data.vehicleTypes.map((type) => ({
    label: type.label,
    value: type.id,
  }));

  protected readonly compositionOptions: SelectOption[] = this.data.vehicleCompositions.map(
    (composition) => ({
      label: composition.name,
      value: composition.id,
    }),
  );

  protected readonly tractionOptions: SelectOption[] = [
    { label: 'Elektrisch', value: 'Elektrisch' },
    { label: 'Diesel', value: 'Diesel' },
    { label: 'Hybrid', value: 'Hybrid' },
    { label: 'Batterie', value: 'Batterie' },
  ];

  protected readonly tiltingOptions: SelectOption[] = [
    { label: 'Keine', value: 'none' },
    { label: 'Passiv', value: 'passive' },
    { label: 'Aktiv', value: 'active' },
  ];

  protected readonly powerSupplyOptions: SelectOption[] = this.collectOptions((type) =>
    type.powerSupplySystems ?? [],
  );

  protected readonly trainProtectionOptions: SelectOption[] = this.collectOptions((type) =>
    type.trainProtectionSystems ?? [],
  );

  protected readonly etcsLevelOptions: SelectOption[] = this.collectOptions(
    (type) => (type.etcsLevel ? [type.etcsLevel] : []),
    ['Kein ETCS', 'ETCS Level 1', 'ETCS Level 2 Baseline 3'],
  );

  protected readonly gaugeProfileOptions: SelectOption[] = this.collectOptions(
    (type) => (type.gaugeProfile ? [type.gaugeProfile] : []),
    ['G1', 'G2', 'GA', 'GB1', 'GB2', 'S-Bahn Berlin'],
  );

  protected readonly brakeTypeOptions: SelectOption[] = this.collectOptions(
    (type) => (type.brakeType ? [type.brakeType] : []),
    ['KE-GPR-E mZ', 'KE-GPR mZ', 'KE-RA-Mg', 'KE-R-A (S-Bahn)'],
  );

  protected readonly segmentRoleOptions: { value: TimetableRollingStockSegmentRole; label: string }[] =
    [
      { value: 'leading', label: 'Führend' },
      { value: 'intermediate', label: 'Mittelteil' },
      { value: 'powercar', label: 'Triebkopf' },
      { value: 'trailing', label: 'Schiebend' },
    ];

  protected readonly stopOptions: SelectOption[] = this.data.stops
    .map((stop) => ({
      label: `#${stop.sequence} · ${stop.locationName}`,
      value: stop.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }));

  protected readonly operationTypeOptions: {
    value: TimetableRollingStockOperation['type'];
    label: string;
  }[] = [
    { value: 'split', label: 'Flügeln' },
    { value: 'join', label: 'Vereinen' },
    { value: 'reconfigure', label: 'Rekonfiguration' },
  ];

  protected readonly form = this.fb.group({
    compositionId: this.fb.control<string | null>(
      this.data.rollingStock?.compositionId ?? null,
    ),
    designation: this.fb.control<string | null>(
      this.data.rollingStock?.designation ?? null,
    ),
    tractionMode: this.fb.control<string | null>(
      this.data.rollingStock?.tractionMode ?? 'Elektrisch',
    ),
    powerSupplySystems: this.fb.control<string[]>(
      [...(this.data.rollingStock?.powerSupplySystems ?? [])],
    ),
    maxSpeed: this.fb.control<number | null>(
      this.data.rollingStock?.maxSpeed ?? null,
    ),
    lengthMeters: this.fb.control<number | null>(
      this.data.rollingStock?.lengthMeters ?? null,
    ),
    weightTons: this.fb.control<number | null>(
      this.data.rollingStock?.weightTons ?? null,
    ),
    brakeType: this.fb.control<string | null>(
      this.data.rollingStock?.brakeType ?? null,
    ),
    brakePercentage: this.fb.control<number | null>(
      this.data.rollingStock?.brakePercentage ?? null,
    ),
    etcsLevel: this.fb.control<string | null>(
      this.data.rollingStock?.etcsLevel ?? null,
    ),
    trainProtectionSystems: this.fb.control<string[]>(
      [...(this.data.rollingStock?.trainProtectionSystems ?? [])],
    ),
    gaugeProfile: this.fb.control<string | null>(
      this.data.rollingStock?.gaugeProfile ?? null,
    ),
    tiltingCapability: this.fb.control<string | null>(
      this.data.rollingStock?.tiltingCapability ?? null,
    ),
    remarks: this.fb.control<string | null>(
      this.data.rollingStock?.remarks ?? null,
    ),
    segments: this.fb.array<FormGroup>([]),
    operations: this.fb.array<FormGroup>([]),
  });

  protected segmentError = signal<string | null>(null);
  protected operationError = signal<string | null>(null);

  constructor() {
    this.initializeSegments();
  }

  protected get segments(): FormArray<FormGroup> {
    return this.form.get('segments') as FormArray<FormGroup>;
  }

  protected get operations(): FormArray<FormGroup> {
    return this.form.get('operations') as FormArray<FormGroup>;
  }

  protected vehicleTypeLabel(typeId: string): string {
    return this.vehicleTypeMap.get(typeId)?.label ?? typeId;
  }

  protected applyComposition(): void {
    const compositionId = this.form.get('compositionId')?.value as string | null;
    if (!compositionId) {
      return;
    }
    const composition = this.compositionMap.get(compositionId);
    if (!composition) {
      return;
    }

    const groups = composition.entries.map((entry, index) =>
      this.createSegmentGroup({
        position: index + 1,
        vehicleTypeId: entry.typeId,
        count: entry.quantity,
        role:
          index === 0
            ? 'leading'
            : index === composition.entries.length - 1
              ? 'trailing'
              : 'intermediate',
      }),
    );
    if (!groups.length) {
      return;
    }
    this.segments.clear();
    groups.forEach((group) => this.segments.push(group));
    this.segmentError.set(null);
  }

  protected addSegment(afterIndex?: number): void {
    const defaultType = this.vehicleTypeOptions[0]?.value ?? '';
    const segment = this.createSegmentGroup({
      position: this.segments.length + 1,
      vehicleTypeId: defaultType,
      role: 'intermediate' as TimetableRollingStockSegmentRole,
      count: 1,
    });
    if (afterIndex === undefined || afterIndex < 0 || afterIndex >= this.segments.length) {
      this.segments.push(segment);
    } else {
      this.segments.insert(afterIndex + 1, segment);
    }
    this.recalculatePositions();
  }

  protected addOperation(afterIndex?: number): void {
    const operation = this.createOperationGroup();
    if (afterIndex === undefined || afterIndex < 0 || afterIndex >= this.operations.length) {
      this.operations.push(operation);
    } else {
      this.operations.insert(afterIndex + 1, operation);
    }
  }

  protected removeSegment(index: number): void {
    if (index < 0 || index >= this.segments.length) {
      return;
    }
    this.segments.removeAt(index);
    this.recalculatePositions();
  }

  protected removeOperation(index: number): void {
    if (index < 0 || index >= this.operations.length) {
      return;
    }
    this.operations.removeAt(index);
  }

  protected moveSegment(index: number, delta: number): void {
    const target = index + delta;
    if (
      index < 0 ||
      index >= this.segments.length ||
      target < 0 ||
      target >= this.segments.length
    ) {
      return;
    }

    const entry = this.segments.at(index);
    this.segments.removeAt(index);
    this.segments.insert(target, entry);
    this.recalculatePositions();
  }

  protected moveOperation(index: number, delta: number): void {
    const target = index + delta;
    if (
      index < 0 ||
      index >= this.operations.length ||
      target < 0 ||
      target >= this.operations.length
    ) {
      return;
    }
    const entry = this.operations.at(index);
    this.operations.removeAt(index);
    this.operations.insert(target, entry);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected clear(): void {
    this.dialogRef.close(null);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.segmentError.set('Bitte prüfen Sie die Eingaben.');
      return;
    }

    const raw = this.form.getRawValue();
    const rawSegments = Array.isArray(raw.segments)
      ? (raw.segments as Array<Record<string, unknown>>)
      : [];
    if (!rawSegments.length) {
      this.segmentError.set('Mindestens ein Segment angeben.');
      return;
    }

    const segments: TimetableRollingStockSegment[] = rawSegments.map((segment, index) => {
      const numbersRaw = segment['vehicleNumbers'];
      const numbers = Array.isArray(numbersRaw)
        ? (numbersRaw as string[])
        : this.splitList(numbersRaw);
      const roleRaw = segment['role'];
      const role =
        typeof roleRaw === 'string' && roleRaw.length
          ? (roleRaw as TimetableRollingStockSegmentRole)
          : undefined;
      const vehicleTypeId = this.cleanString(segment['vehicleTypeId']) ?? '';
      return {
        position: index + 1,
        role,
        vehicleTypeId,
        count: Number(segment['count'] ?? 1) || 1,
        vehicleNumbers: numbers.length ? numbers : undefined,
        remarks: this.cleanString(segment['remarks']),
        setId: this.cleanString(segment['setId']),
        setLabel: this.cleanString(segment['setLabel']),
        destination: this.cleanString(segment['destination']),
      };
    });

    const rawOperations = Array.isArray(raw.operations)
      ? (raw.operations as Array<Record<string, unknown>>)
      : [];

    const operations = rawOperations
      .map((operation) => {
        const stopId = this.cleanString(operation['stopId']);
        const type = this.cleanString(operation['type']) as
          | TimetableRollingStockOperation['type']
          | undefined;
        if (!stopId || !type) {
          return null;
        }
        const setIds = this.splitList(operation['setIds']);
        return {
          stopId,
          type,
          setIds,
          remarks: this.cleanString(operation['remarks']),
        } as TimetableRollingStockOperation;
      })
      .filter((operation): operation is TimetableRollingStockOperation => operation !== null);

    if (rawOperations.length && !operations.length) {
      this.operationError.set(
        'Bitte vollständige Angaben für Flügel-/Join-Operationen erfassen oder Einträge entfernen.',
      );
      return;
    }

    const payload: TimetableRollingStock = {
      compositionId: this.cleanString(raw.compositionId),
      designation: this.cleanString(raw.designation),
      tractionMode: this.cleanString(raw.tractionMode),
      powerSupplySystems: [...(raw.powerSupplySystems ?? [])],
      maxSpeed: this.cleanNumber(raw.maxSpeed),
      lengthMeters: this.cleanNumber(raw.lengthMeters),
      weightTons: this.cleanNumber(raw.weightTons),
      brakeType: this.cleanString(raw.brakeType),
      brakePercentage: this.cleanNumber(raw.brakePercentage),
      etcsLevel: this.cleanString(raw.etcsLevel),
      trainProtectionSystems: [...(raw.trainProtectionSystems ?? [])],
      gaugeProfile: this.cleanString(raw.gaugeProfile),
      tiltingCapability: this.cleanString(raw.tiltingCapability) as
        | TimetableRollingStock['tiltingCapability']
        | undefined,
      remarks: this.cleanString(raw.remarks),
      segments,
      operations: operations.length ? operations : undefined,
    };

    this.segmentError.set(null);
    this.operationError.set(null);
    this.dialogRef.close(payload);
  }

  private initializeSegments(): void {
    const initialSegments: Array<Partial<TimetableRollingStockSegment>> =
      this.data.rollingStock?.segments?.length
        ? this.data.rollingStock.segments.map((segment) => ({ ...segment }))
        : [
            {
              position: 1,
              role: 'leading' as TimetableRollingStockSegmentRole,
              vehicleTypeId: this.vehicleTypeOptions[0]?.value ?? '',
              count: 1,
            },
          ];

    initialSegments
      .map((segment, index) => ({
        position: segment.position ?? index + 1,
        role:
          (segment.role as TimetableRollingStockSegmentRole | undefined) ??
          ((index === 0 ? 'leading' : 'intermediate') as TimetableRollingStockSegmentRole),
        vehicleTypeId: segment.vehicleTypeId ?? this.vehicleTypeOptions[0]?.value ?? '',
        count: segment.count ?? 1,
        vehicleNumbers:
          Array.isArray(segment.vehicleNumbers) && segment.vehicleNumbers.length
            ? segment.vehicleNumbers
            : undefined,
        remarks: segment.remarks,
        setId: segment.setId,
        setLabel: segment.setLabel,
        destination: segment.destination,
      }))
      .forEach((segment) => this.segments.push(this.createSegmentGroup(segment)));

    const initialOperations =
      this.data.rollingStock?.operations?.map((operation) => ({ ...operation })) ?? [];

    if (!initialOperations.length) {
      this.operations.push(this.createOperationGroup());
    } else {
      initialOperations.forEach((operation) =>
        this.operations.push(this.createOperationGroup(operation)),
      );
    }
  }

  private createSegmentGroup(
    segment: Partial<TimetableRollingStockSegment>,
  ): FormGroup {
    const vehicleNumbers =
      Array.isArray(segment.vehicleNumbers) && segment.vehicleNumbers.length
        ? segment.vehicleNumbers.join(', ')
        : segment.vehicleNumbers && typeof segment.vehicleNumbers === 'string'
          ? segment.vehicleNumbers
          : '';

    return this.fb.group({
      position: this.fb.control<number>(
        segment.position ?? this.segments.length + 1,
        { validators: [Validators.required, Validators.min(1)] },
      ),
      role: this.fb.control<TimetableRollingStockSegmentRole | ''>(
        (segment.role as TimetableRollingStockSegmentRole | undefined) ?? '',
      ),
      vehicleTypeId: this.fb.control<string>(
        segment.vehicleTypeId ?? '',
        { validators: [Validators.required] },
      ),
      count: this.fb.control<number>(
        segment.count ?? 1,
        { validators: [Validators.required, Validators.min(1)] },
      ),
      vehicleNumbers: this.fb.control<string>(vehicleNumbers),
      remarks: this.fb.control<string>(segment.remarks ?? ''),
      setId: this.fb.control<string>(segment.setId ?? ''),
      setLabel: this.fb.control<string>(segment.setLabel ?? ''),
      destination: this.fb.control<string>(segment.destination ?? ''),
    });
  }

  private createOperationGroup(
    operation: Partial<TimetableRollingStockOperation> = {},
  ): FormGroup {
    const setIds = Array.isArray(operation.setIds) ? operation.setIds : [];
    return this.fb.group({
      stopId: this.fb.control<string | null>(operation.stopId ?? null),
      type: this.fb.control<TimetableRollingStockOperation['type'] | null>(
        operation.type ?? null,
      ),
      setIds: this.fb.control<string>(setIds.join(', ')),
      remarks: this.fb.control<string>(operation.remarks ?? ''),
    });
  }

  private recalculatePositions(): void {
    this.segments.controls.forEach((control, index) => {
      const positionControl = control.get('position');
      positionControl?.setValue(index + 1, { emitEvent: false });
    });
  }

  private collectOptions(
    extractor: (type: VehicleType) => string[],
    fallbacks: string[] = [],
  ): SelectOption[] {
    const values = new Set<string>(
      fallbacks.filter((value) => value && value.trim().length > 0),
    );

    this.data.vehicleTypes.forEach((type) => {
      extractor(type)
        .filter((value) => value && value.trim().length > 0)
        .forEach((value) => values.add(value));
    });

    return Array.from(values)
      .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }))
      .map((value) => ({ label: value, value }));
  }

  private splitList(input: unknown): string[] {
    if (!input || typeof input !== 'string') {
      return [];
    }
    return input
      .split(/[\n,;]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private cleanString(input: unknown): string | undefined {
    if (typeof input !== 'string') {
      return undefined;
    }
    const trimmed = input.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private cleanNumber(input: unknown): number | undefined {
    const value = typeof input === 'number' ? input : Number(input);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return value;
  }
}
