# Codex Prompt: Gantt Activity Creation (Betriebsplanung)

## Purpose
Restore the ability to create activities in the Betriebsplanung Gantt.

## Context
- Related spec: `/specs/gantt-activity-creation.md` (Rules: R1, R2, R3, R4)

## Instructions
- Ensure a left-click on a resource/day cell opens the creation dialog (R1).
- Support a service chain: start → work → break → work → end (R2).
- Validate in both Fahrzeugdienste and Personaldienste pools (R3).
- Keep UI responsive and surface errors (R4).

## Expected Output
- Functional Gantt activity creation in Betriebsplanung.
