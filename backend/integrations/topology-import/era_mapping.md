# ERA RINF Mapping (DEU/CHE)

This document captures agreed mapping rules for importing ERA RINF data into CoreplanX.

## Operational Points (OP)

### Identity
- `uniqueOpId`: from `era:uopid` (stable, used for deduplication)
- `opId`: derived from `uniqueOpId` (project-specific format), or tail of OP IRI if needed
- `sourceUri` attribute: full OP IRI (optional but recommended for traceability)

### Validity
- Ignore `validityEndDate` (often in the past; not relevant for current operational import)
- `validityStartDate` can be kept as attribute if needed

### OP Type mapping
Map ERA `opType` codes to internal `opType`:

| ERA opType code | Internal opType |
| --- | --- |
| 10 | STATION |
| 20 | SMALL_STATION |
| 30 | PASSENGER_TERMINAL |
| 40 | FREIGHT_TERMINAL |
| 50 | DEPOT_OR_WORKSHOP |
| 60 | TRAIN_TECHNICAL_SERVICES |
| 70 | PASSENGER_STOP |
| 80 | JUNCTION |
| 90 | BORDER_POINT |
| 110 | OTHER |
| 120 | OTHER |
| 140 | OTHER |

### Useful attributes to keep
- `tafTAPCode`
- `lineReference`
- `nationalLineIdentification`
- `track`, `siding` (as references or counts)
- `imCode` (if present)
- `sourceUri`

### Position
Use geometry (WGS84) when available for `position.lat`/`position.lng`.

## Sections of Line (SoL)

### Identity
- `solId`: tail of SoL IRI
- `sourceUri` attribute: full SoL IRI (optional but recommended)

### Validity
- Ignore `validityEndDate`
- `validityStartDate` can be kept as attribute if needed

### SoL Nature mapping
`solNature` codes are not yet defined in this repo:
- Keep `solNature` as attribute for now
- Known codes in DEU/CHE: 10, 20

### Useful attributes to keep
- `lineNationalId`
- `imCode`
- `track`
- `length` (raw)
- `sourceUri`

### Endpoints / length
- `startUniqueOpId`: from `era:opStart`
- `endUniqueOpId`: from `era:opEnd`
- `lengthKm`: from `era:lengthOfSectionOfLine`
