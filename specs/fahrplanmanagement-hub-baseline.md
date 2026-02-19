# Spec: Fahrplanmanagement Hub Baseline

## Overview
- Problem/goal: Document existing Fahrplanmanagement behavior already implemented in code but not yet captured as formal spec.
- Non-goals: Introducing new business behavior or redesigning the current timetable manager UX in this baseline spec.
- Stakeholders: Fahrplanmanager users, QA, assistant/documentation maintainers.

## Rules
- R1: The timetable manager list groups train records by a shared `RefTrainID` root and supports aggregate group view plus per-variant record view.
- R2: Filtering in the list uses year selection + search term, where search checks `RefTrainID`, `trainNumber`, and `title`.
- R3: Selecting a record exposes operational detail cards including calendar bitmap/range, technical attributes, route metadata, and stop-level attributes.
- R4: Variant creation via dialog must create/update hub records and keep the newly created variant focused for immediate follow-up.
- R5: Hub records are derived from timetable data using `calendar.validFrom/validTo/daysBitmap` expansion and timetable-year resolution.
- R6: Existing TTT sync dialog supports payload export/import for calendar variants, calendar modifications, and responsibilities, including audit annotation on import.
- R7: Backend timetable infrastructure supports snapshot replacement, revision history, and train service part operations (rebuild, split, merge, link).
- R8: From a selected non-aggregate train record, users can trigger direct creation of an FM ordering case with inherited train/calendar context.
- R9: The primary create action in timetable manager toolbar must open the shared full-page timetable editor flow (same as order-position manual flow) by creating a seeded TrainPlan and navigating to `/fahrplan-editor/:planId`.

## Behavior
- Inputs:
  - Timetable list data from FM services.
  - User interactions in list/detail/collapse/create actions.
  - Optional sync payload JSON in TTT sync dialog.
- Outputs:
  - Grouped/filtered list and detail rendering with section tabs.
  - Variant creation with immediate focus handover to created record.
  - Toolbar create action creates a seeded TrainPlan draft and opens the shared full-page editor.
  - Optional import/export sync payload processing.
  - Timetable snapshot versioning + service-part operations via backend APIs.
- Edge cases:
  - Empty result set must show explicit empty state.
  - Seeded create action fails to persist TrainPlan: show error and remain in timetable manager.
  - Invalid import payloads show validation errors and do not mutate timetable data.

## Acceptance Criteria
- AC1: Records are shown grouped by `RefTrainID` root and can be expanded into variants (R1).
- AC2: Search and year filter narrow the list deterministically by defined fields (R2).
- AC3: Detail pane shows calendar/technical/route/stop attributes from selected record (R3).
- AC4: Creating a variant focuses the created record and prepares immediate editing flow (R4).
- AC5: Calendar day expansion and timetable-year label resolution are consistent with timetable-year boundaries (R5).
- AC6: TTT sync export/import covers variants/modifications/responsibilities and appends audit note on successful import (R6).
- AC7: Timetable APIs support snapshot revisions and service-part operations without requiring order-management paths (R7).
- AC8: Detail header for a selected train offers direct handover into FM ordering case creation and opens the resulting case in ordering cockpit (R8).
- AC9: Toolbar primary create action opens the shared full-page timetable editor by creating a seeded TrainPlan and forwarding `returnUrl` to timetable manager (R9).

## Notes
- Dependencies:
  - Frontend modules under `frontend/src/app/features/timetable-manager` and `frontend/src/app/core/services/timetable-hub.service.ts`.
  - Backend APIs under `backend/src/timetable/*`.
- Migration:
  - This baseline spec is a guardrail for later generic ordering extensions.
