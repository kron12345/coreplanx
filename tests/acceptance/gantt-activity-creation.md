# Acceptance Test: Gantt Activity Creation (Betriebsplanung)

## Related Spec
- `/specs/gantt-activity-creation.md` (Rules: R1, R2, R3, R4)

## Preconditions
- Betriebsplanung and Gantt view are available.
- Pools exist under Fahrzeugdienste and Personaldienste.

## Steps
1. Navigate to **Planung → Betriebsplanung**.
2. Open Gantt for the current year.
3. Expand a pool under **Fahrzeugdienste** and click a resource/day cell.
4. Verify the activity creation dialog opens.
5. Create a service chain: Dienstanfang → Leistung → Pause → Leistung → Dienstende.
6. Repeat steps 3–5 under **Personaldienste**.

## Expected Results
- The creation dialog opens on click (R1).
- The service chain can be created and saved (R2).
- Works for vehicle and personnel pools (R3).
- UI stays responsive; errors are shown if saving fails (R4).
