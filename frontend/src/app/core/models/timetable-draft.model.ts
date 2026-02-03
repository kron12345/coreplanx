export type OpRef = {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
};

export type StopRefs = {
  osm?: { type: 'node' | 'way' | 'relation'; id: number };
  location?: { country: string; primaryCode: string; uic?: string };
  infra?: { rinfOpId?: string; imCode?: string };
};

export type RouteStop = {
  stopId: string;
  op?: OpRef;
  kind: 'origin' | 'stop' | 'destination' | 'pass';
  dwellSeconds?: number;
  refs?: StopRefs;
};

export type RouteSegment = {
  segmentId: string;
  fromStopId: string;
  toStopId: string;
  distanceMeters: number;
  assumedSpeedKph?: number;
  estimatedTravelSeconds?: number;
  geometry: number[][];
};

export type RouteSegmentOpPath = {
  startUniqueOpId: string;
  endUniqueOpId: string;
  lengthKm?: number | null;
};

export type RouteDraft = {
  draftId: string;
  trainPlanId: string;
  stops: RouteStop[];
  segments: RouteSegment[];
  segmentOpPaths?: Record<string, RouteSegmentOpPath[]>;
  routeOps?: OpRef[];
  assumptions: {
    defaultSpeedKph: number;
    defaultDwellSeconds: number;
  };
  routingOptions?: {
    includeLinkSections?: boolean;
    allowedNatures?: Array<'REGULAR' | 'LINK'>;
    attributeFilters?: Array<{ key: string; values?: string[] }>;
    maxAlternatives?: number;
  };
  previewStartTimeIso?: string;
  createdAtIso: string;
  updatedAtIso: string;
};

export type TimingPoint = {
  stopId: string;
  arrivalIso?: string;
  departureIso?: string;
};

export type TimetableDraft = {
  draftId: string;
  routeDraftId: string;
  startTimeIso: string;
  points: TimingPoint[];
};

export type PatternDefinition = {
  patternId: string;
  baseTimetableDraftId: string;
  headwayMinutes: number;
  startTimeIso: string;
  endTimeIso: string;
};

export type TimetableDraftBundle = {
  schemaVersion: 1;
  routeDraft?: RouteDraft;
  timetableDraft?: TimetableDraft;
  patternDefinition?: PatternDefinition;
  updatedAtIso: string;
};
