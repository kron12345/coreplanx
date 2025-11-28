import { Injectable, computed, inject } from '@angular/core';
import { PlanningDataService } from '../planning/planning-data.service';
import { Personnel, PersonnelService, TemporalValue, Vehicle, VehicleService } from '../../models/master-data';
import { ResourceSnapshotDto } from '../../core/api/planning-resource-api.service';

@Injectable({ providedIn: 'root' })
export class MasterDataResourceStoreService {
  private readonly planning = inject(PlanningDataService);
  private readonly snapshotSignal = this.planning.resourceSnapshot();

  readonly personnelServices = computed<PersonnelService[]>(() =>
    this.cloneList(this.snapshotSignal()?.personnelServices ?? []),
  );

  readonly personnel = computed<Personnel[]>(() => this.cloneList(this.snapshotSignal()?.personnel ?? []));

  readonly vehicleServices = computed<VehicleService[]>(() =>
    this.cloneList(this.snapshotSignal()?.vehicleServices ?? []),
  );

  readonly vehicles = computed<Vehicle[]>(() => this.cloneList(this.snapshotSignal()?.vehicles ?? []));

  syncPersonnelServices(services: PersonnelService[]): void {
    const normalized = services.map((service) => this.normalizePersonnelService(service));
    this.persistSnapshot((snapshot) => ({
      ...snapshot,
      personnelServices: normalized,
    }));
  }

  syncPersonnel(personnel: Personnel[]): void {
    const normalized = personnel.map((person) => this.normalizePersonnel(person));
    this.persistSnapshot((snapshot) => ({
      ...snapshot,
      personnel: normalized,
    }));
  }

  syncVehicleServices(services: VehicleService[]): void {
    const normalized = services.map((service) => this.normalizeVehicleService(service));
    this.persistSnapshot((snapshot) => ({
      ...snapshot,
      vehicleServices: normalized,
    }));
  }

  syncVehicles(vehicles: Vehicle[]): void {
    const normalized = vehicles.map((vehicle) => this.normalizeVehicle(vehicle));
    this.persistSnapshot((snapshot) => ({
      ...snapshot,
      vehicles: normalized,
    }));
  }

  private persistSnapshot(updater: (snapshot: ResourceSnapshotDto) => ResourceSnapshotDto): void {
    this.planning.updateResourceSnapshot(updater);
  }

  private normalizePersonnelService(service: PersonnelService): PersonnelService {
    const normalized = this.normalizeEntity(service, 'personnelService');
    return {
      ...normalized,
      requiredQualifications: [...(normalized.requiredQualifications ?? [])],
    };
  }

  private normalizePersonnel(person: Personnel): Personnel {
    const normalized = this.normalizeEntity(person, 'personnel');
    return {
      ...normalized,
      firstName: this.cloneTemporalRequired(normalized.firstName),
      preferredName: this.cloneTemporalOptional(normalized.preferredName),
      serviceIds: [...(normalized.serviceIds ?? [])],
      qualifications: [...(normalized.qualifications ?? [])],
    };
  }

  private normalizeVehicleService(service: VehicleService): VehicleService {
    const normalized = this.normalizeEntity(service, 'vehicleService');
    return {
      ...normalized,
      requiredVehicleTypeIds: [...(normalized.requiredVehicleTypeIds ?? [])],
    };
  }

  private normalizeVehicle(vehicle: Vehicle): Vehicle {
    const normalized = this.normalizeEntity(vehicle, 'vehicle');
    return {
      ...normalized,
      serviceIds: [...(normalized.serviceIds ?? [])],
    };
  }

  private normalizeEntity<T extends { id?: string }>(entity: T, prefix: string): T & { id: string } {
    const clone = this.clone(entity);
    const id =
      clone.id && String(clone.id).trim().length > 0
        ? String(clone.id).trim()
        : this.generateId(prefix);
    return {
      ...clone,
      id,
    };
  }

  private generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private cloneTemporalRequired(value: string | TemporalValue<string>[]): string | TemporalValue<string>[] {
    if (Array.isArray(value)) {
      return value.map((entry) => ({ ...entry }));
    }
    return value ?? '';
  }

  private cloneTemporalOptional(
    value: string | TemporalValue<string>[] | undefined,
  ): string | TemporalValue<string>[] | undefined {
    if (value === undefined) {
      return undefined;
    }
    return Array.isArray(value) ? value.map((entry) => ({ ...entry })) : value;
  }

  private cloneList<T>(items: T[]): T[] {
    return items.map((item) => this.clone(item));
  }

  private clone<T>(value: T): T {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
