# Spec: Gantt Activity Creation (Betriebsplanung)

## Overview
Ensure that users can create activities/services directly in the Gantt view of Betriebsplanung by clicking on a resource day.

## Rules
- R1: A left-click on a resource/day cell in the Gantt opens the activity creation dialog.
- R2: The dialog supports creating a service chain (Dienstanfang → Leistung → Pause → Leistung → Dienstende).
- R3: The flow works for **Fahrzeugdienste** and **Personaldienste** pools.
- R4: The UI remains responsive and shows errors if creation fails.

## Behavior
- In **Planung → Betriebsplanung**, open the current year Gantt.
- Expand a pool under Fahrzeugdienste or Personaldienste and click a resource/day cell.
- The creation dialog opens and can save a service with multiple activities.

## Acceptance Criteria
- AC1: Clicking a resource/day opens the dialog (R1).
- AC2: A service with start, work, break, work, end can be created and saved (R2).
- AC3: The flow works in both vehicle and personnel pools (R3).
- AC4: No UI lockups; errors are surfaced if saving fails (R4).
