# Codex Prompt: Fahrplanmanagement Generic TTT Ordering

## Purpose
Implement a generic, profile-driven TTT ordering flow in Fahrplanmanagement with deterministic state transitions and full traceability.

## Context
- Related spec: `/specs/fahrplanmanagement-generic-ordering.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16)

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
- Enforce the ordering-required attribute set (`otnOrNameInput`, `reasonOfReference`, `validityDate`, `trainType`, `trafficTypeCode`, `serviceType`, `debtorCode`, `distributionList`, `freeProcessingReason`) for request initiation and prefill it from train metadata where available (R13).
- Forward detailed formation payload from train ordering context (`vehicleFormation`, PWG aggregate values, `tractionOrPwg`) into case `providedAttributes` in train-first creation (R14).
- In the train-first creation dialog, render a readiness checklist for the ordering-required attribute set, explicitly marking present/missing values before case creation (R15).
- If train-first checklist has missing required attributes, provide a direct action from the dialog to open the same train in timetable editor step 1 (`Bestellkontext`) with validity range context (R16).

## Expected Output
- Deterministic FM ordering engine + APIs + UI flows with end-to-end click-through capability and auditability.
