# Codex Prompt: Stammdaten Fahrzeuge (Fahrtyp + Werkseinstellungen)

## Purpose
Make vehicle-type assignment explicit via Fahrtyp and provide practical factory defaults for vehicle types and formations.

## Context
- Related spec: `/specs/stammdaten-fahrzeuge.md` (Rules: R1, R2, R3, R4, R5, R6)

## Instructions
- Add explicit `formationServiceType` on `VehicleType` with allowed values `tractive_unit` and `wagon` (R1).
- Ensure the new field is end-to-end persistent (frontend model, backend API/repository, DB migration, reset defaults) (R2).
- Expose the field in `Stammdaten -> Fahrzeuge -> Fahrzeugtypen` as dropdown `Fahrtyp` with options `Triebfahrzeug` and `Wagen` (R3).
- Make Formation Builder filtering in timetable editor use `formationServiceType` first, with category-based fallback only for legacy data without the new field (R4).
- Extend vehicle factory defaults to include at least 1-2 locos, 2-3 trainset kinds, and 3 wagon types with meaningful technical values (R5).
- Extend composition factory defaults to include at least one loco+wagons consist, one multi-trainset consist, and one double-traction trainset consist (R6).

## Expected Output
- Clear Fahrtyp assignment in master data and predictable filtering in Formation Builder.
- Rich, realistic example defaults loadable via `Werkseinstellungen`.
