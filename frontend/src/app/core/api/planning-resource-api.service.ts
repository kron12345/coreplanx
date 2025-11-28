import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_CONFIG } from '../config/api-config';
import {
  Personnel,
  PersonnelPool,
  PersonnelService,
  PersonnelServicePool,
  Vehicle,
  VehiclePool,
  VehicleService,
  VehicleServicePool,
  VehicleType,
  VehicleComposition,
} from '../../models/master-data';

export interface ResourceSnapshotDto {
  personnel: Personnel[];
  personnelServices: PersonnelService[];
  personnelServicePools: PersonnelServicePool[];
  personnelPools: PersonnelPool[];
  vehicles: Vehicle[];
  vehicleServices: VehicleService[];
  vehicleServicePools: VehicleServicePool[];
  vehiclePools: VehiclePool[];
  vehicleTypes: VehicleType[];
  vehicleCompositions: VehicleComposition[];
}

@Injectable({ providedIn: 'root' })
export class PlanningResourceApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(API_CONFIG);

  fetchSnapshot(): Observable<ResourceSnapshotDto> {
    return this.http.get<ResourceSnapshotDto>(`${this.baseUrl()}/planning/resources`);
  }

  replaceSnapshot(snapshot: ResourceSnapshotDto): Observable<ResourceSnapshotDto> {
    return this.http.put<ResourceSnapshotDto>(`${this.baseUrl()}/planning/resources`, snapshot);
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }
}
