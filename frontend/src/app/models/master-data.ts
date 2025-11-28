export interface TemporalValue<T = unknown> {
  value: T;
  validFrom: string;
  validTo?: string | null;
}

export interface PersonnelService {
  id: string;
  name: string;
  description?: string;
  requiredQualifications?: string[];
  poolId?: string;
  startTime?: string;
  endTime?: string;
  isNightService?: boolean;
  /**
   * Limit of how often this service may be instantiated per calendar day.
   * Defaults to 1 to satisfy "ein Dienst pro Tag".
   */
  maxDailyInstances?: number;
  /**
   * Number of resources that must/can be assigned per service instance.
   */
  maxResourcesPerInstance?: number;
}

export interface PersonnelServicePool {
  id: string;
  name: string;
  description?: string;
  serviceIds: string[];
  shiftCoordinator?: string;
  contactEmail?: string;
  attributes?: Record<string, unknown>;
}

export interface Personnel {
  id: string;
  firstName: string | TemporalValue<string>[];
  lastName: string;
  preferredName?: string | TemporalValue<string>[];
  qualifications?: string[];
  serviceIds?: string[];
  poolId?: string;
  homeStation?: string;
  availabilityStatus?: string;
  qualificationExpires?: string;
  isReserve?: boolean;
}

export interface PersonnelPool {
  id: string;
  name: string;
  description?: string;
  personnelIds: string[];
  locationCode?: string;
  attributes?: Record<string, unknown>;
}

export interface VehicleService {
  id: string;
  name: string;
  description?: string;
  requiredVehicleTypeIds?: string[];
  poolId?: string;
  startTime?: string;
  endTime?: string;
  isOvernight?: boolean;
  primaryRoute?: string;
  maxDailyInstances?: number;
  maxResourcesPerInstance?: number;
}

export interface VehicleServicePool {
  id: string;
  name: string;
  description?: string;
  serviceIds: string[];
  dispatcher?: string;
  attributes?: Record<string, unknown>;
}

export interface VehicleType {
  id: string;
  label: string;
  category?: string;
  capacity?: number;
  maxSpeed?: number;
  maintenanceIntervalDays?: number;
  energyType?: string;
  manufacturer?: string;
  trainTypeCode?: string;
  lengthMeters?: number;
  weightTons?: number;
  brakeType?: string;
  brakePercentage?: number;
  tiltingCapability?: 'none' | 'passive' | 'active';
  powerSupplySystems?: string[];
  trainProtectionSystems?: string[];
  etcsLevel?: string;
  gaugeProfile?: string;
  maxAxleLoad?: number;
  noiseCategory?: string;
  remarks?: string;
  attributes?: Record<string, unknown>;
}

export interface Vehicle {
  id: string;
  vehicleNumber: string;
  typeId: string;
  depot?: string;
  serviceIds?: string[];
  description?: string;
  poolId?: string;
  hasWifi?: boolean;
  fleetStatus?: string;
  lastInspectionDate?: string;
  rangeKm?: number;
  seatReservation?: boolean;
}

export interface VehiclePool {
  id: string;
  name: string;
  description?: string;
  vehicleIds: string[];
  depotManager?: string;
  attributes?: Record<string, unknown>;
}

export interface VehicleCompositionEntry {
  typeId: string;
  quantity: number;
}

export interface VehicleComposition {
  id: string;
  name: string;
  entries: VehicleCompositionEntry[];
  turnaroundBuffer?: string;
  remark?: string;
  attributes?: Record<string, unknown>;
}
