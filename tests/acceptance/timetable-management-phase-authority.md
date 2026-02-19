# Acceptance Test: Timetable Management Phase Authority

## Related Spec
- `/specs/timetable-management-phase-authority.md` (Rules: R1, R2, R3, R4, R5, R6, R7)

## Preconditions
- Fahrplanjahre sind in Stammdaten gepflegt.
- Eine Auftragsposition mit Datumsbereich über mindestens zwei Fahrplanjahre ist vorhanden.
- FM-API für Plan-/Phasensnapshots ist verfügbar.

## Steps
1. Erzeuge oder aktualisiere eine Position mit Gültigkeit über zwei Fahrplanjahre.
2. Starte/prüfe die Materialisierung im Fahrplanmanagement.
3. Prüfe, dass für beide betroffenen Fahrplanjahre jeweils ein operativer Planungskontext existiert.
4. Ändere TTT/TTR-Phasen in Fahrplanmanagement für einen oder mehrere dieser Kontexte.
5. Rufe die Order-seitige Snapshot-Sicht ab (per-year + aggregiert).
6. Prüfe Auditdaten zu den Phasewechseln (Zeitpunkt, Quelle, vorher/nachher).
7. Prüfe, dass ein reproduzierbarer Event-Key (Actor + MessageType/Status + TOR/TOI + Profil) für die Transition gespeichert ist.

## Expected Results
- Cross-year Positionen werden in FM pro Fahrplanjahr operationalisiert (R1, R2).
- TTT/TTR werden nur in FM geführt und geändert (R3).
- OM liest nur Snapshots, rechnet keine Phase lokal nach (R4, R5).
- Phasewechsel sind vollständig nachvollziehbar (R6).
- Phasefortschritt ist über gespeicherte Event-Tuples + Profil deterministisch nachvollziehbar (R7).
