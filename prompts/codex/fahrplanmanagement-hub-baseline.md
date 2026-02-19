# Codex Prompt: Fahrplanmanagement Hub Baseline

## Purpose
Preserve and validate the currently implemented Fahrplanmanagement hub behavior as documented baseline.

## Context
- Related spec: `/specs/fahrplanmanagement-hub-baseline.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9)

## Instructions
- Keep grouped record behavior by RefTrainID root and aggregate/per-variant views (R1).
- Preserve deterministic year + search filtering semantics (R2).
- Maintain detail cards for calendar, technical, route, and stop attributes (R3).
- Keep variant creation flow focused on immediate follow-up by selecting newly created records (R4).
- Preserve calendar expansion and timetable-year resolution logic (R5).
- Keep current TTT sync export/import payload scope and audit note behavior (R6).
- Keep timetable snapshot/revision/service-part backend capabilities available for FM workflows (R7).
- Keep direct handover from selected train record to FM ordering case creation available in the detail header (R8).
- Ensure the primary toolbar create action uses the shared full-page timetable editor flow by creating a seeded TrainPlan and navigating with returnUrl back to timetable manager (R9).

## Expected Output
- No regression in existing timetable manager behavior while extending FM functionality.
