# Acceptance Test: Orders Date Range Supervision

## Related Spec
- `/specs/orders-date-range-supervision.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13)

## Preconditions
- OM und FM sind mit den neuen Datenverträgen lauffähig.
- Mindestens ein Auftrag mit Position über Fahrplanjahrgrenze ist vorhanden.

## Steps
1. Öffne die Auftragserstellung und lege einen Auftrag mit `von`/`bis` an.
2. Lege eine Position mit Datums-Gültigkeit an, die über Fahrplanjahrgrenze läuft.
3. Prüfe die Auftragsliste auf date-range-basierte Filter (nicht Fahrplanjahr-Chips).
4. Filtere nach Datumsüberlappung und verifiziere Treffer/Nicht-Treffer.
5. Öffne die Position und prüfe TTT/TTR-Anzeige sowie Verlinkung zu operativen Fahrplänen.
6. Prüfe, dass die Position in OM als eine Business-Position sichtbar bleibt, auch wenn in FM mehrere operative Kontexte bestehen.
7. Simuliere FM-Snapshot-Fehler und prüfe degradierte Anzeige (ohne lokale Phasenberechnung in OM).
8. Kombiniere Datumsfilter mit mindestens einem Status-/Variant-/Business-Filter und prüfe konsistente Treffermenge.
9. Prüfe in der Position die Anzeige von operativen Referenzen (z. B. TrainPlan/TrafficPeriod/Template und Snapshot-Kontext).
10. Prüfe in der Auftragskarte das FM-Supervision-Panel: aggregierte FM-Zustände/Phasen plus per-Kontext-Zeilen (`Fahrplanjahr`, `von/bis`, `Status`).
11. Rufe die OM-Read-API für den Auftrag auf (`/orders/{id}/phase-snapshot` und `/orders/{id}/operational-contexts`) und prüfe konsistente Daten zur Kartenanzeige.
12. Rufe die OM-Read-API `/orders/{id}/traceability` auf und prüfe je FM-Fall Korrelationen (`pathRequestId`, optional `pathId`) sowie letzte Message-/Transition-Auditdaten.
13. Öffne aus der Auftragskarte den Traceability-Drilldown für einen FM-Fall und prüfe vollständige Message- sowie Transition-Historie.
14. Rufe zusätzlich `/orders/{id}/traceability/{caseId}` auf und verifiziere, dass nur verlinkte Fälle auflösbar sind.

## Expected Results
- Auftrag und Position sind datumsbasiert modelliert (R1, R2).
- Filterlogik basiert auf Datum/Überlappung statt Fahrplanjahr (R3).
- OM verhält sich als Überwacher/Traceability-Layer (R4, R6).
- TTT/TTR stammen aus FM-Snapshots (R5).
- Cross-year Position bleibt fachlich eine Position in OM mit mehreren operativen Referenzen (R7).
- Datumsfilter funktionieren zusammen mit nicht-datumsbezogenen Filtern ohne Rückfall auf Fahrplanjahrlogik (R8).
- Positionen zeigen operative Link-/Snapshot-Kontexte zur Nachvollziehbarkeit (R9).
- Auftragskarte zeigt FM-Supervision mit aggregierter und kontextbezogener Sicht sowie degradiertem Hinweis bei FM-Ausfall (R5, R10).
- OM-Read-APIs liefern auftragsbezogene FM-Read-Models inkl. unresolved-link Hinweisen, ohne clientseitiges Raw-Case-Filtering (R11).
- OM-Read-API `traceability` liefert pro verlinktem FM-Fall auditierbare Korrelationen + letzte Event/Transition und markiert partielle Enrichment-Fehler explizit (R12).
- OM-Dialog für FM-Traceability zeigt volle Message-/Transition-Historie pro verlinktem Fall aus OM-Read-Contract; nicht verlinkte Cases bleiben gesperrt (R13).
