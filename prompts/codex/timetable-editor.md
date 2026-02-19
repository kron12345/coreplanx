# Codex Prompt: Timetable Editor (Route Builder & Timing Editor)

## Purpose
Implement the new full-page timetable editor, replacing the old Auftragsmanagement dialog flow.

## Context
- Related spec: /specs/timetable-editor.md (Rules: R1–R23)

## Instructions
- Follow the spec rules in order: full-page editor, autosave drafts, OSM map, time–distance graph, non-blocking validations, SOL routing, OP map interactions, viewport-based OP loading, routing options (incl. electrified), preview timetable, alternative routes, syncing the Route Builder departure time to the Timing Editor, map-first Route Builder UI (Start/Ziel in left panel, panel open by default), SOL-based intermediate OPs in the segment list, keeping the Route Builder panel open/usable when returning from Timing Editor, pass-through points in the Timing Editor (read-only, computed), converting pass-through points to stops, a graph layout with time on X + OP guide lines on Y, recalculating timing points from segment travel times until the user edits the timing manually, **graph-driven stop creation from pass-through points**, and origin shown at the top of the graph.
- Persist draft data in TrainPlan.routeMetadata.timetableDrafts with a schema version.
- Keep the component reusable (standalone), then wire it into Auftragsmanagement entry points (edit and manual-create) and the Fahrplanmanagement primary create entry.

## Expected Output
- New reusable timetable editor component and route.
- Updated Auftragsmanagement + Fahrplanmanagement actions to open the full-page editor.
- Draft persistence and UI status indicators.
