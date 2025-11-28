export type ResourceKind = 'personnel-service' | 'vehicle-service' | 'personnel' | 'vehicle';

export interface Resource {
  id: string;
  name: string;
  kind: ResourceKind;
  /**
   * Maximum number of service assignments this resource may cover per day.
   * Personnel are typically limited to 2, vehicles to a higher value.
   */
  dailyServiceCapacity?: number;
  attributes?: Record<string, unknown>;
}
