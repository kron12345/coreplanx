import { Injectable, computed, inject } from '@angular/core';
import {
  PersonnelPool,
  PersonnelServicePool,
  VehicleComposition,
  VehiclePool,
  VehicleServicePool,
  VehicleType,
} from '../../models/master-data';
import { PlanningDataService } from '../planning/planning-data.service';
import { ResourceSnapshotDto } from '../../core/api/planning-resource-api.service';

type CollectionKey =
  | 'personnelServicePools'
  | 'personnelPools'
  | 'vehicleServicePools'
  | 'vehiclePools'
  | 'vehicleTypes'
  | 'vehicleCompositions';

interface MasterDataCollectionsState {
  personnelServicePools: PersonnelServicePool[];
  personnelPools: PersonnelPool[];
  vehicleServicePools: VehicleServicePool[];
  vehiclePools: VehiclePool[];
  vehicleTypes: VehicleType[];
  vehicleCompositions: VehicleComposition[];
}

const INITIAL_STATE: MasterDataCollectionsState = {
  personnelServicePools: [],
  personnelPools: [],
  vehicleServicePools: [],
  vehiclePools: [],
  vehicleTypes: [],
  vehicleCompositions: [],
};

@Injectable({ providedIn: 'root' })
export class MasterDataCollectionsStoreService {
  private readonly planning = inject(PlanningDataService);
  private readonly snapshot = this.planning.resourceSnapshot();

  readonly personnelServicePools = computed(() => this.snapshot()?.personnelServicePools ?? INITIAL_STATE.personnelServicePools);
  readonly personnelPools = computed(() => this.snapshot()?.personnelPools ?? INITIAL_STATE.personnelPools);
  readonly vehicleServicePools = computed(() => this.snapshot()?.vehicleServicePools ?? INITIAL_STATE.vehicleServicePools);
  readonly vehiclePools = computed(() => this.snapshot()?.vehiclePools ?? INITIAL_STATE.vehiclePools);
  readonly vehicleTypes = computed(() => this.snapshot()?.vehicleTypes ?? INITIAL_STATE.vehicleTypes);
  readonly vehicleCompositions = computed(() => this.snapshot()?.vehicleCompositions ?? INITIAL_STATE.vehicleCompositions);

  syncPersonnelServicePools(entries: PersonnelServicePool[]): void {
    this.persist('personnelServicePools', entries);
  }

  syncPersonnelPools(entries: PersonnelPool[]): void {
    this.persist('personnelPools', entries);
  }

  syncVehicleServicePools(entries: VehicleServicePool[]): void {
    this.persist('vehicleServicePools', entries);
  }

  syncVehiclePools(entries: VehiclePool[]): void {
    this.persist('vehiclePools', entries);
  }

  syncVehicleTypes(entries: VehicleType[]): void {
    this.persist('vehicleTypes', entries);
  }

  syncVehicleCompositions(entries: VehicleComposition[]): void {
    this.persist('vehicleCompositions', entries);
  }

  private persist<K extends CollectionKey>(key: K, entries: MasterDataCollectionsState[K]): void {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return;
    }
    const next: ResourceSnapshotDto = {
      ...snapshot,
      [key]: this.clone(entries),
    };
    this.planning.updateResourceSnapshot(() => next);
  }

  private clone<T>(value: T): T {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
