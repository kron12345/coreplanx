# Codex Prompt: Fahrplanmanagement Generic TTT Ordering

## Purpose
Implement a generic, profile-driven TTT ordering flow in Fahrplanmanagement with deterministic state transitions and full traceability.

## Context
- Related spec: `/specs/fahrplanmanagement-generic-ordering.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12)

## Instructions
- Keep FM as single owner of ordering lifecycle state and transitions (R1).
- Implement process-profile based transition logic (country/process profile) instead of hardcoded branches (R2).
- Use canonical event tuple matching: actor + messageType + messageStatus + TOR + TOI (R3).
- Persist state context, transition history, and message-level traceability with correlation identifiers (R4, R5).
- Build a cockpit view that shows current state, allowed/blocked actions, and missing required attributes (R6).
- Provide a counterpart simulator that feeds the same state engine with inbound events (R7).
- Support cross-year cases as one case with multiple operational contexts and aggregated snapshots (R8, R9).
- Reject unknown/unmapped events explicitly without mutating case state (R10).
- Treat duplicate `externalMessageId` per case idempotently without a second transition (R11).
- Add a train-first creation flow from timetable manager to ordering case, prefill train/calendar context, and collect EVU identifiers before create (R12).

## Expected Output
- Deterministic FM ordering engine + APIs + UI flows with end-to-end click-through capability and auditability.
