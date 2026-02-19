# Spec: Fahrplanmanagement Generic TTT Ordering

## Overview
- Problem/goal: Enable a generic, profile-driven TTT ordering workflow in `Fahrplanmanagement` that can be executed end-to-end (including counterpart responses) for Germany and Switzerland process variants.
- Non-goals: Direct productive CI integration, replacing existing order-management UIs, or implementing country-specific XML transformers in MVP.
- Stakeholders: Betriebsplanung, Disposition, Integrationsentwicklung, Auftragsmanagement users (read-only consumption).

## Rules
- R1: `Fahrplanmanagement` is the single owner of operational ordering lifecycle state (TTT/TTR-related process states and transitions).
- R2: Ordering logic must be configuration-driven by `process profiles` (country + process), not hardcoded UI branches.
- R3: Transition matching must use a canonical message event tuple: `actor`, `messageType`, `messageStatus`, `typeOfRequest`, `typeOfInformation`.
- R4: Every ordering case must persist state machine context (`currentState`, `profile`, `accept/terminal status`) and full transition history (`before`, `after`, event tuple, timestamp, source).
- R5: Every ordering case must persist message-level traceability for inbound/outbound traffic, including correlation identifiers (`pathRequestId`, optional `pathId`, external message id where available).
- R6: The FM UI must provide a `Bestell-Cockpit` that shows current state, allowed next actions, blocked actions with reason, and required missing attributes (e.g. rolling stock, phase data, identifiers).
- R7: A counterpart simulator page must exist and drive the same state engine, allowing confirm/reject/revision/not-available/withdraw/error style responses for click-through testing.
- R8: Cross-year business scope must remain one ordering case with multiple operational contexts (one per affected timetable year) under the same case aggregation.
- R9: FM APIs must expose both per-context and aggregated snapshots for downstream read-only consumers (especially `Auftragsmanagement`).
- R10: Unknown/unmapped events may not mutate state; they must be persisted as rejected events with explicit diagnostics.
- R11: Duplicate `externalMessageId` values per ordering case must be handled idempotently (no second state transition; duplicate must be traceable as rejected/duplicate).
- R12: Users must be able to open a new ordering case directly from a selected train in Fahrplanmanagement; calendar/route/rolling-stock context is prefilled from the train, EVU-owned identifiers are added/confirmed, and the case is created without manual copy-paste between modules.

## Behavior
- Inputs:
  - Case creation payload (`train plan`, validity/date scope, process profile, required operational attributes).
  - Selected train context from timetable manager (`train`, `calendar`, stops, rolling stock).
  - EVU-owned identifiers needed for request initiation (at least `pathRequestId`, optionally `pathId` and profile-specific required attributes).
  - User actions from FM cockpit (send request, accept offer, request revision, reject, cancel/withdraw, etc.).
  - Inbound external/simulated events using the canonical event tuple.
- Outputs:
  - Deterministic next-state transitions per process profile.
  - Persisted message + transition audit trail.
  - Action availability model for UI (allowed/blocked + reason).
  - Snapshot endpoints for OM supervision (aggregated + per operational context).
- Edge cases:
  - Case spans timetable-year boundaries: context split is required without splitting business identity.
  - Duplicate message identifiers: event is idempotently ignored or marked duplicate without double transition.
  - Temporarily missing required operational attributes: transition remains blocked with explicit remediation hints.
  - Unknown event tuple: case remains in current state and logs rejection.

## Acceptance Criteria
- AC1: Users can create an FM ordering case with selected process profile and execute at least one end-to-end happy path from request to booked/terminal state (R1, R2, R3, R4).
- AC2: The engine resolves transitions solely through profile configuration + canonical event tuple, not by UI hardcoding (R2, R3).
- AC3: Each transition persists before/after state, source, timestamp, and tuple; messages remain traceable with correlation identifiers (R4, R5).
- AC4: The cockpit displays current state, allowed actions, and blocking reasons for unavailable actions (R6).
- AC5: The counterpart simulator can trigger inbound events that transition the same case via the same engine (R7).
- AC6: A cross-year case exposes multiple operational contexts and one aggregated case view (R8, R9).
- AC7: Unknown tuples are persisted as rejected/diagnostic entries and do not change state (R10).
- AC8: Duplicate `externalMessageId` on the same case does not create a second state transition and is diagnostically traceable (R11).
- AC9: From a selected train in timetable manager, users can create an ordering case with prefilled train/calendar context and EVU identifier completion; resulting case opens in FM ordering cockpit as active case (R6, R12).

## Notes
- Dependencies:
  - Existing FM building blocks in repository: timetable snapshot/revision infrastructure, train plan persistence, timetable-year master data.
  - Existing local process references: `.tmp/.specs/TTT/Deutschland/...` and `.tmp/.specs/TTT/Schweiz/...`.
- Migration:
  - Start with internal JSON profile definitions and simulator-driven integration.
  - Keep XML/CI adapters as a later outer layer around the canonical event tuple.
