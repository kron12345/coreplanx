# Spec: Timetable Editor (Route Builder & Timing Editor)

## Overview
- Problem/goal: Replace the existing timetable edit dialog in Auftragsmanagement with a reusable, full-page timetable editor that supports a two-step workflow (Route Builder → Timing Editor) and persists drafts so work survives session loss.
- Non-goals: Multi-train conflict resolution, official PCS/TAF-TAP export, automatic overtaking/capacity solver, full routing engine (OSRM/GraphHopper) in MVP.
- Stakeholders: Disposition, Betriebsplanung, Auftragsmanagement, Fahrplanmanager.

## Rules
- R1: The Timetable Editor is a **full-page** view with explicit **Uebernehmen** (save + return) and **Zurueck** actions, and can be opened from Auftragsmanagement.
- R2: Draft data must **auto-save** to the backend (debounced) so unexpected session ends do not lose work.
- R3: Route Builder uses a **live OSM map** (open-source tiles) and operational points from topology search; selecting stops generates segments with distance and estimated travel time.
- R4: Timing Editor provides a **time–distance graph** and a **stops grid**; edits update the draft and show warnings (non-blocking) for minimum dwell / minimum travel time.
- R5: Pattern/Takt data is captured in the draft as preview metadata (no persistent run generation in MVP).
- R6: In **Auftragsposition hinzufuegen → Fahrplan (manuell)**, a **Fahrplan-Editor oeffnen** action creates a new TrainPlan (seeded from the manual stops or defaults) and opens the full-page editor; the order item is **not created** until the dialog is saved.
- R7: Route Builder computes a **railway route** using **Sections of Line (SOL)** as graph edges; the default is the **shortest route** by distance (no road routing).
- R8: The map shows **Operational Points (OPs)** at suitable zoom levels; clicking an OP adds it as a stop (origin, destination, or intermediate).
- R9: OP markers are loaded **by map viewport** (bbox query) and capped by a limit; zoomed-out views show no OPs to protect performance.
- R10: Route Builder exposes **routing options** (e.g. include LINK sections) and uses them in SOL routing requests (future filters extend this).
- R11: Route Builder allows setting a **departure time** and shows a **preview timetable** for all stops (including intermediate) using segment travel times + dwell.
- R12: Changing the Route Builder departure time **updates the Timing Editor start time** by shifting all timetable points.
- R13: Route Builder shows **alternative SOL routes** (if available) and allows selection; routing filters include **electrified** constraints.
- R14: Route Builder uses a **map-first layout** with the **Start/Ziel inputs inside the left panel**; the Route Builder panel is **open by default**, uses an **inline stop editor** (add between stops), collapsible options, and a **segment area with loading** while routing.
- R15: The segment area lists **all SOL-based intermediate Operational Points** along the selected route (not only user stops); names are resolved via OP lookup where available.
- R16: Returning from Timing Editor reopens the Route Builder panel when a route exists, and the panel layout keeps **segments reachable** even with many stops (scrolling/sections).
- R17: The Timing Editor includes **pass-through points** (Durchfahrten) derived from SOL paths, with computed times based on segment travel time; they are read-only by default.
- R18: Route Builder allows converting a pass-through point into a **real stop** (kind `stop`), inserted at the correct route position.
- R19: The time–distance graph uses **time on the X-axis** and **operational points on the Y-axis**; each OP has a horizontal guide line to make reading the timetable straightforward.
- R20: When the route/segment travel times change and the Timing Editor has not been manually edited yet, timetable points are **recomputed from the Route Builder preview start time** so the Timing Editor and graph are populated with segment-based times.
- R21: The Timing Editor allows **creating stops from pass-through points directly in the graph** (click pass-through point → convert to stop) and keeps the graph editable (drag to change times).
- R22: The time–distance graph places the **origin at the top** of the Y-axis and the **destination at the bottom** (route direction top → bottom).

## Behavior
- Inputs:
  - `trainPlanId` (required)
  - optional `orderId`/`itemId` for context
  - optional `returnUrl` to navigate back
- Outputs:
  - Drafts stored in `TrainPlan.routeMetadata.timetableDrafts` (schema versioned).
  - Updated TrainPlan on auto-save and on explicit Uebernehmen.
- Edge cases:
  - Missing plan → show error state, no editing.
  - Missing op coordinates → stop can still be added, but map/graph uses available points.
  - Network failure on save → show status + retry on next edit.
  - Manual creation entry: missing train number or too few stops → show error, do not create plan.
  - No SOL route available → fall back to straight-line segments with warning/neutral UI.
  - Departure time missing → preview timetable stays hidden or shows placeholders.

## Acceptance Criteria
- AC1: Clicking **Fahrplan bearbeiten** from Auftragsmanagement opens the full-page editor and displays plan context.
- AC2: Selecting origin/destination from topology search draws a route line on the OSM map and populates a segment list with distance + estimated time.
- AC3: Editing times in the stops grid updates the time–distance graph; dragging a stop on the graph adjusts its times.
- AC4: Draft changes auto-save and persist across reloads (routeMetadata contains the draft bundle).
- AC5: Uebernehmen returns to the previous view (returnUrl or default) and keeps saved draft data.
- AC6: In **Fahrplan (manuell)**, clicking **Fahrplan-Editor oeffnen** creates a TrainPlan draft from the current manual input and navigates to the full-page editor.
- AC7: Selecting origin/destination triggers SOL-based routing; the map shows the routed polyline (not just a straight line).
- AC8: Clicking an OP marker on the map adds it as a stop (origin if empty, destination if missing, otherwise intermediate).
- AC9: OP markers refresh by viewport (bbox) and disappear when zoomed out.
- AC10: Routing options (e.g. include LINK sections) affect the SOL route request.
- AC11: Setting a departure time shows a preview timetable for all stops with computed times.
- AC12: After changing the departure time in Route Builder, the Timing Editor reflects the shifted start time and updated stop times.
- AC13: When alternatives are available, the user can select one and the segment geometry updates accordingly; electrified-only filtering reduces routes to electrified SOLs.
- AC14: The map is full-screen with a left Route Builder panel; Start/Ziel inputs live inside the panel, the inline stop editor allows insertion between stops, options are collapsible, and the segment list shows a loading indicator while routing.
- AC15: The segment list shows intermediate OPs along each SOL segment (IDs and resolved names where possible), and the aggregated Unterwegspunkte reflect the SOL path, not only the draft stops.
- AC16: When returning from the Timing Editor, the Route Builder panel is open if a route exists; the stop list and segment list remain accessible via scrolling when many stops exist.
- AC17: The Timing Editor shows pass-through points with computed times (read-only), so the timetable is complete.
- AC18: Clicking **Als Halt** on a pass-through point converts it into a stop and updates the route + timing preview.
- AC19: The graph renders horizontal guide lines aligned to each operational point, with time plotted on X and OP order on Y.
- AC20: When the SOL route/segments update and no manual timing edits exist yet, the Timing Editor times and graph are recalculated from segment travel times.
- AC21: Clicking a pass-through point in the graph converts it into a stop (and the timetable updates accordingly).
- AC22: The graph renders with the route direction top → bottom (origin above destination).

## Notes
- Dependencies: Leaflet (map), OSM tile layer, topology search API.
- Migration: Drafts are stored in JSON (routeMetadata) with schemaVersion for future migration.
