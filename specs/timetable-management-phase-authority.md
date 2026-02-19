# Spec: Timetable Management Phase Authority

## Overview
- Problem/goal: Establish `Fahrplanmanagement` as the authoritative domain for operational timetable planning, including cross-year plan materialization and TTT/TTR lifecycle ownership.
- Non-goals: Full UI redesign of Fahrplanmanagement or immediate removal of existing order-management screens.
- Stakeholders: Disposition, Betriebsplanung, Auftragsmanagement users, integration/backend teams.

## Rules
- R1: `Fahrplanmanagement` remains timetable-year based and owns all operational timetable entities.
- R2: If an `Auftragsposition` spans multiple timetable years, `Fahrplanmanagement` must create/manage one operational plan context per affected timetable year.
- R3: TTT and TTR phase computation, transitions, and persistence are owned exclusively by `Fahrplanmanagement`.
- R4: `Auftragsmanagement` must consume TTT/TTR phase data as read-only snapshots from `Fahrplanmanagement`; no duplicate phase engine is allowed in `Auftragsmanagement`.
- R5: APIs must expose both per-plan (per timetable year) phase details and an aggregated view per `Auftragsposition`.
- R6: Phase changes must be auditable (source, timestamp, before/after) and traceable back to operational plan entities.
- R7: TTT/TTR phase transitions in FM must be message-event driven through canonical transition keys (actor + message type/status + TOR/TOI) and process profiles, not OM-side heuristics.

## Behavior
- Inputs:
  - `Auftragsposition` validity (`validFrom`, `validTo`) and linked operational context.
  - Timetable-year boundaries from master data.
  - Process profile definitions and inbound/outbound ordering events.
  - Operational plan/phase events occurring in Fahrplanmanagement.
- Outputs:
  - Operational plan records partitioned by timetable year.
  - Per-plan TTT/TTR phase state.
  - Aggregated phase snapshot for order-facing consumers.
  - Audit trail entries for phase transitions.
- Edge cases:
  - Validity exactly on a timetable-year boundary must not create duplicate day ownership.
  - Missing timetable-year master data blocks materialization with explicit validation errors.
  - Partial failures in cross-year materialization must return a recoverable status (no silent data loss).

## Acceptance Criteria
- AC1: A position spanning multiple timetable years produces operational plan contexts for each affected year (R1, R2).
- AC2: TTT/TTR phase values are persisted and updated only in Fahrplanmanagement services (R3).
- AC3: Auftragsmanagement can read per-year and aggregated phase snapshots without local phase recomputation (R4, R5).
- AC4: Each phase transition can be traced via audit metadata (R6).
- AC5: Boundary dates are assigned deterministically to exactly one timetable-year context (R2).
- AC6: Materialization failures return actionable validation/error states (R2, R5).
- AC7: FM phase progression is reproducible from persisted event tuples + process profile, without OM recomputation (R3, R7).
