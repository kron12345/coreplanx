# Codex Prompt: Timetable Management Phase Authority

## Purpose
Make Fahrplanmanagement the authoritative owner of operational plan contexts and TTT/TTR phase lifecycle.

## Context
- Related spec: `/specs/timetable-management-phase-authority.md` (Rules: R1, R2, R3, R4, R5, R6, R7)

## Instructions
- Keep timetable-year scoping and operational ownership in Fahrplanmanagement (R1).
- Materialize/manage cross-year order positions as multiple operational contexts by year (R2).
- Implement phase computation/transitions only in Fahrplanmanagement (R3).
- Expose read-only phase snapshots for order-side consumers (R4, R5).
- Include audit metadata for phase transitions and traceability (R6).
- Drive phase transitions through canonical message tuples + process profiles, not OM heuristics (R7).

## Expected Output
- Stable FM-owned phase/status APIs with per-year and aggregate outputs.
- No duplicated phase engine in order-management code paths.
