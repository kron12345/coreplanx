# Spec: Orders Date Range Supervision

## Overview
- Problem/goal: Move `Auftragsmanagement` from timetable-year centric modeling to date-range based modeling while clarifying its role as business-facing supervision and traceability layer.
- Non-goals: Replacing operational planning screens in Fahrplanmanagement or redefining timetable-year master data.
- Stakeholders: Business/Vertrieb users, Auftragsdisposition, operations planners, reporting/audit teams.

## Rules
- R1: An `Auftrag` must have an explicit validity range (`validFrom`, `validTo`).
- R2: Every `Auftragsposition` must be modeled via date validity (single range or equivalent normalized validity segments), not by a direct timetable-year key.
- R3: Order-side filters must switch from `Fahrplanjahr` to date-range filtering (`from/to`, relative windows, overlap logic).
- R4: `Auftragsmanagement` acts as supervision layer: it monitors status/progress and provides end-to-end traceability, but does not own operational phase state transitions.
- R5: TTT/TTR display in `Auftragsmanagement` must be sourced from `Fahrplanmanagement` snapshots (per-plan + aggregate).
- R6: Business context stays in `Auftragsmanagement` (customer/business intent, commercial framing, accountability) and links to operational plan contexts in `Fahrplanmanagement`.
- R7: Cross-year positions must remain a single business position in `Auftragsmanagement`, even if represented by multiple operational plan contexts in `Fahrplanmanagement`.
- R8: Date-range filtering must coexist with existing operational/business dimensions (`train status`, `business status`, `internal status`, `variant type`, `linked business`) without forcing fallback to year-centric filtering.
- R9: Position-level traceability in OM must include linked operational references (train plan, traffic period, template/source metadata) and original timetable snapshot context where available.
- R10: Order cards must expose an FM supervision panel that aggregates linked FM ordering cases and also lists per-context operational snapshots (`timetableYearLabel`, `validFrom`, `validTo`, context status) for linked train plans.
- R11: OM backend must provide dedicated read-only supervision endpoints per order (`phase-snapshot`, `operational-contexts`) so OM UIs consume a stable contract instead of filtering raw FM case lists client-side.
- R12: OM backend must provide a dedicated order-scoped traceability endpoint (`traceability`) with linked FM case correlations (`pathRequestId`, optional `pathId`, external message reference where available), latest message/transition audit, and explicit degraded indicators if case-detail enrichment is partial.
- R13: OM must support case-level traceability drilldown via dedicated read contract (`traceability/{caseId}`) and UI dialog so users can inspect full FM message and transition history for a linked case without leaving Auftragssicht.

## Behavior
- Inputs:
  - Order validity (`validFrom`, `validTo`).
  - Position validity and traceability links to operational plans.
  - Phase snapshots delivered by Fahrplanmanagement.
- Outputs:
  - Date-range based order and position views.
  - Filters and KPIs based on overlap in calendar dates.
  - Monitoring view that aggregates operational phase states without mutating them.
  - Order-scoped FM traceability read model for OM supervision and audit follow-up.
  - Traceability from order -> position -> linked operational references -> phase/audit history.
- Edge cases:
  - Positions partially outside order range must produce explicit validation/warning handling (configured policy).
  - Date overlap filters must handle open-ended or sparse validity segments consistently.
  - If FM phase snapshots are temporarily unavailable, order UI shows stale indicator/degraded mode instead of local fallback computation.

## Acceptance Criteria
- AC1: Users can create/update orders with required `validFrom` and `validTo` (R1).
- AC2: Position management no longer depends on `timetableYearLabel` as primary classification (R2).
- AC3: Order list filters work by date overlap and relative date windows, not by timetable-year filter chips (R3).
- AC4: TTT/TTR values shown in order views are read from Fahrplanmanagement data contracts (R4, R5).
- AC5: A cross-year position remains one business entity in order management and links to multiple operational contexts where needed (R6, R7).
- AC6: Traceability view lets users follow status from business order to operational plan contexts (R4, R6).
- AC7: Date filtering works together with existing non-date filters (status/variant/business linkage) without reintroducing timetable-year dependency (R3, R8).
- AC8: Position cards/views expose operational link context and snapshot metadata needed for audit-friendly supervision (R4, R6, R9).
- AC9: The FM supervision panel in OM shows both aggregated FM state/phase counters and per-context operational rows for linked train plans, including degraded/stale hint when FM data cannot be loaded (R5, R10).
- AC10: OM APIs expose order-scoped read models (`phase-snapshot`, `operational-contexts`) that match linked train plans and report unresolved links explicitly (R9, R11).
- AC11: OM APIs expose an order-scoped `traceability` read model containing per-case correlation ids and latest message/transition audit metadata, including partial/degraded enrichment indicators when details are unavailable (R4, R9, R12).
- AC12: Users can open a case-level traceability dialog from the FM supervision panel and inspect full FM message + transition history from OM using `traceability/{caseId}`; access is limited to cases linked to the order (R4, R12, R13).
