export type AssistantContextResource =
  | 'personnelServices'
  | 'vehicleServices'
  | 'personnel'
  | 'vehicles'
  | 'personnelServicePools'
  | 'vehicleServicePools'
  | 'personnelPools'
  | 'vehiclePools'
  | 'homeDepots'
  | 'vehicleTypes'
  | 'vehicleCompositions'
  | 'timetableYears'
  | 'simulations'
  | 'operationalPoints'
  | 'sectionsOfLine'
  | 'personnelSites'
  | 'replacementStops'
  | 'replacementRoutes'
  | 'replacementEdges'
  | 'opReplacementStopLinks'
  | 'transferEdges';

export interface AssistantContextQuery {
  resource: AssistantContextResource;
  poolName?: string;
  poolId?: string;
  timetableYearLabel?: string;
  search?: string;
  limit?: number;
  fields?: string[];
}

export interface AssistantContextResult {
  query: AssistantContextQuery;
  poolLabel?: string;
  total: number;
  items: Array<Record<string, unknown>>;
  truncated: boolean;
  error?: string;
}
