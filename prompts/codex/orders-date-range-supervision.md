# Codex Prompt: Orders Date Range Supervision

## Purpose
Refactor Auftragsmanagement from timetable-year logic to date-range supervision and traceability.

## Context
- Related spec: `/specs/orders-date-range-supervision.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13)

## Instructions
- Add/require order validity (`validFrom`, `validTo`) and date-based position validity (R1, R2).
- Replace year-centric filters with date overlap and date window filters (R3).
- Keep Auftragsmanagement as monitoring/traceability layer, not operational phase authority (R4).
- Source TTT/TTR state from Fahrplanmanagement contracts only (R5).
- Preserve business context in order management and link to FM operational contexts (R6, R7).
- Keep existing non-date filter dimensions active alongside date filtering (R8).
- Surface position-level operational link and snapshot metadata for audit-friendly supervision (R9).
- Show an FM supervision panel in order cards with aggregated counters and per-context snapshot rows for linked train plans (R10).
- Provide dedicated OM read-only endpoints for order-scoped FM supervision contracts (`phase-snapshot`, `operational-contexts`) (R11).
- Provide an order-scoped OM traceability read endpoint (`traceability`) with per-case correlation ids and latest message/transition audit metadata, including degraded-detail indicators (R12).
- Add case-level traceability drilldown (`traceability/{caseId}`) and wire order-card dialog to show full FM message/transition history for linked cases only (R13).

## Expected Output
- Date-range based order flows and filters.
- Clear separation: business supervision in OM, operational lifecycle in FM.
