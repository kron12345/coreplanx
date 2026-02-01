# ERA Topology Schema (Station Areas, Tracks, Platforms, Sidings)

This schema extends CoreplanX topology to support detailed station assets derived from ERA RINF.

## Station Areas
Represents a station area (often 1:1 with an Operational Point).

Fields:
- `stationAreaId` (PK): stable id (suggestion: `SA-<uniqueOpId>`)
- `uniqueOpId`: link to Operational Point
- `name`: display name
- `position`: optional `lat/lng`
- `attributes`: additional metadata

Table: `topology_station_area` (payload JSONB)

## Tracks (Bahnhofsgleise)
Represents a track inside a station area.

Fields:
- `trackKey` (PK): global stable key (suggestion: IRI tail from ERA)
- `trackId`: local track identifier (from ERA `trackId`)
- `uniqueOpId`: owning Operational Point
- `platformEdgeIds`: optional list of platform edges
- `attributes`: technical properties

Table: `topology_track` (payload JSONB)

## Platform Edges (Bahnsteigkanten)
Represents a platform edge belonging to a track.

Fields:
- `platformEdgeId` (PK): stable id (IRI tail)
- `platformId`: platform number/name at station (from ERA)
- `platformKey`: optional grouping key for platform aggregation
- `trackKey`: parent track
- `lengthMeters`: platform edge length
- `platformHeight`: height (label or numeric string)
- `attributes`

Table: `topology_platform_edge` (payload JSONB)

## Platforms (Bahnsteige)
Logical grouping of platform edges by `platformId` within a station area.

Fields:
- `platformKey` (PK): stable composite key (suggestion: `<uniqueOpId>:<platformId>`)
- `platformId`: platform number/name
- `uniqueOpId`: owning Operational Point
- `name`: optional display label
- `lengthMeters`: optional aggregated length
- `platformHeight`: optional representative height
- `platformEdgeIds`: edges belonging to the platform
- `attributes`

Table: `topology_platform` (payload JSONB)

## Sidings (Abstellgleise)
Sidings linked to an Operational Point.

Fields:
- `sidingKey` (PK): stable id (IRI tail)
- `sidingId`: local siding identifier
- `uniqueOpId`: owning Operational Point
- `lengthMeters`
- `gradient`
- `hasRefuelling`
- `hasElectricShoreSupply`
- `hasWaterRestocking`
- `hasSandRestocking`
- `hasToiletDischarge`
- `hasExternalCleaning`
- `attributes`

Table: `topology_siding` (payload JSONB)

## ID Conventions (recommended)
- `stationAreaId`: `SA-<uniqueOpId>`
- `trackKey`: ERA track IRI tail
- `platformEdgeId`: ERA platformEdge IRI tail
- `platformKey`: `<uniqueOpId>:<platformId>`
- `sidingKey`: ERA siding IRI tail
