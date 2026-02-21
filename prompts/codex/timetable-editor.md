# Codex Prompt: Timetable Editor (Route Builder & Timing Editor)

## Purpose
Implement the new full-page timetable editor, replacing the old Auftragsmanagement dialog flow.

## Context
- Related spec: /specs/timetable-editor.md (Rules: R1–R66)

## Instructions
- Follow the spec rules in order: full-page editor, autosave drafts, OSM map, time–distance graph, non-blocking validations, SOL routing, OP map interactions, viewport-based OP loading, routing options (incl. electrified), preview timetable, alternative routes, syncing the Route Builder departure time to the Timing Editor, map-first Route Builder UI (Start/Ziel in left panel, panel open by default), SOL-based intermediate OPs in the segment list, keeping the Route Builder panel open/usable when returning from Timing Editor, pass-through points in the Timing Editor (read-only, computed), converting pass-through points to stops, a graph layout with time on X + OP guide lines on Y, recalculating timing points from segment travel times until the user edits the timing manually, **graph-driven stop creation from pass-through points**, and origin shown at the top of the graph.
- Persist draft data in TrainPlan.routeMetadata.timetableDrafts with a schema version.
- Keep the component reusable (standalone), then wire it into Auftragsmanagement entry points (edit and manual-create) and the Fahrplanmanagement primary create entry.
- Apply compact desktop density in the Route Builder left panel (smaller text + tighter vertical spacing) without changing actions/flow.
- Keep stop-list UX simplified: no separate stop-list title, origin/destination rows without kind/dwell controls, no separator line before inline stop insertion actions, compact and uniform small vertical spacing in the stop-list block, delete action at row end, and automatic start/end role normalization after delete.
- Make Start/Ziel search inputs directly overwritable: clear prefilled label on focus and restore it on blur when no new value was entered.
- Render intermediate stops in a compact single-line form (inline kind/dwell/move/delete) and keep the inline insert trigger visually compact.
- Keep vertical spacing in the stop-list very tight and avoid a dedicated inner stop-list vertical scrollbar.
- Push compactness to the practical minimum, but verify there is no visual overlap/clipping of labels, icons, and controls.
- Make inline intermediate-stop fields (`Art`, `Dwell`) use a smaller text size than regular panel fields.
- Keep compact sizing consistent across fields, icons, and buttons; ensure `Stop`/`Pass` values in `Art` are never right-clipped.
- Keep entries per stop row vertically centered (index, row content, controls, actions) so the row layout looks optically aligned.
- Render intermediate stop identity in two lines (`Name` above `PLC`) and enlarge move/delete symbols by about 40% from the previous compact icon size while preserving alignment and avoiding overlap.
- Ensure compact Route Builder form fields do not reserve empty Material subscript/hint spacer height when no hint/error is shown.
- Keep `mat-select` selected-value typography aligned with neighboring input fields (panel size for regular fields, inline size for compact stop controls).
- Make option text in opened Route Builder select overlays about 60% larger than compact field text for readability, without clipping/overlap.
- Keep segment-row `Speed` field right-aligned and compact; avoid reserving empty route-column space in rows where no route selector is rendered.
- Render segment direction label as stacked `Von` (first line) and `Nach` (second line) text and remove inline arrow separators (`→`) from segment labels.
- Place the segment index (`#1`, `#2`, …) left of the stacked `Von/Nach` block instead of rendering it above those lines.
- Add a new step 1 (`Bestellkontext`) before Route Builder with ordering-relevant fields and per-field help icons/tooltips.
- Implement `OTN/Name` mapping: numeric `1..99999` maps to OTN, otherwise map to Name and keep OTN empty.
- Implement `Gueltigkeit` using the existing annual calendar selector and restrict date selection to a caller-provided range (`validityStart`/`validityEnd` query params).
- Implement `Gueltigkeit` multi-select behavior: keep calendar open during multi-day selection and render it as overlay/dialog layer that closes via explicit close action.
- Render `TrafficTypeCode` as dropdown (`mat-select`) with options depending on selected `TrainType` (including passenger-like options such as S-Bahn), and remove quick-action buttons.
- In step 1 desktop layout, place `Zugtyp` and `Zugkategorie` below the row containing `OTN/Name`, `Grund`, and `Gueltigkeit`.
- Make step 1 (`Bestellkontext`) denser overall: tighter spacing and compact field/control heights while preserving readability and preventing overlap/clipping.
- Add a dedicated `Formation Builder` block in step 1: `Fahrtyp` selection (`Triebfahrzeug`, `Wagen`, `PWG`) controls available vehicles.
- For `Triebfahrzeug`/`Wagen`, source vehicles from master data vehicle types (`vehicleTypes`) using explicit Fahrtyp mapping via `VehicleType.formationServiceType`; keep category-based mapping only as fallback for legacy data without that field. For `PWG`, collect manual aggregate `Länge`, `Gewicht`, `vMax` and add as aggregate unit.
- Add composition-template apply in Formation Builder from master data vehicle compositions (`vehicleCompositions`) as top-level preset action that replaces the current consist with expanded `quantity` entries in template order.
- Arrange Formation Builder with template apply on top (`Formationsvorlage` as primary/overgeordnet action) and manual add controls below (`Fahrtyp` + dependent `Fahrzeug` + `Hinzufügen`) in one grouped block.
- Render the current consist horizontally with meaningful vehicle symbols/cards, support remove per unit, and update summary metrics live.
- Allow drag-and-drop reordering of existing consist units in the horizontal formation preview and persist the resulting order in `orderingContext.vehicleFormation`.
- Persist step-1 ordering attributes on the train (`TrainPlan.routeMetadata`) and include them when creating a bestellfall from a train in Fahrplanmanagement.
- Add a sticky step-1 local header with compact progress/status summary that stays visible while the step content scrolls.
- Add required-progress chips for step-1 blocks (`Stammdaten`, `Formation`, `Abrechnung`) derived from required-field completion.
- Normalize compact sizing of step-1 action buttons (template/apply/add/clear actions) so height, padding, and icon proportions are consistent.
- Show position numbers (`#1/#2/...`) and subtle separators on formation unit cards for quicker order scanning.
- Provide quick clear actions for `TrafficType` values, PWG metrics, and full formation list.
- Add inline required-field validation hints in step 1 that disappear as soon as fields become valid.
- Show micro-feedback after formation drag-and-drop reorder confirming that the new order is applied.
- Ensure step 1 has no page-level horizontal scrollbar on Full-HD: keep outer/page/editor widths with padding inside viewport limits.
- Render formation units as inline SVG shapes with embedded text and clear form distinction by type: `Wagen` rectangle, `Triebfahrzeug` chamfered top-left rectangle, `PWG` distinguishable variant; keep drag/drop and remove interactions unchanged.
- In SVG units, replace name text with compact `L/G/vMax` metrics, provide fully written details via tooltip, make the tractive chamfer more pronounced, and stack position marker + remove action vertically to maximize horizontal unit density.

## Expected Output
- New reusable timetable editor component and route.
- Updated Auftragsmanagement + Fahrplanmanagement actions to open the full-page editor.
- Draft persistence and UI status indicators.
