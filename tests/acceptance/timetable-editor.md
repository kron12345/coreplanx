# Acceptance Test: Timetable Editor (Route Builder & Timing Editor)

## Related Spec
- /specs/timetable-editor.md (Rules: R1–R11)

## Preconditions
- Mindestens eine Fahrplan-Position ist mit einem TrainPlan verknuepft.
- Topologie-Operational-Points sind vorhanden (mit Koordinaten).

## Steps
1. Oeffne eine Fahrplan-Position im Auftragsmanagement.
2. Klicke **„Fahrplan bearbeiten“**.
3. Pruefe: Es oeffnet sich eine **Vollseite** mit Route Builder + Timing Editor.
4. Suche eine Operational-Point im Route Builder und setze Origin + Destination.
5. Pruefe: OSM-Karte ist Vollbild, Start/Ziel Suche schwebt oben; SOL-Route/Marker sichtbar.
6. Schalte die Routing-Option **Link-Abschnitte** um und pruefe, dass die Route neu berechnet wird (andere Linienfuehrung oder gleiche Route bei unveraenderter Geometrie).
7. Setze **Elektrifizierung = Nur elektrifiziert** und pruefe, dass die Route neu berechnet wird.
8. Falls Alternativen verfuegbar sind: waehle eine Alternative und pruefe, dass die Linienfuehrung der Segmente wechselt.
9. Zoom auf der Karte heraus: OP-Marker verschwinden; zoome hinein und pruefe, dass Marker im sichtbaren Bereich geladen werden.
10. Pruefe: Beim ersten Setzen von Start/Ziel oeffnet sich links der Route Builder (Slide-In).
11. Fuege ueber das Inline-Stop-Editorfeld zwischen Halten einen Zwischenhalt hinzu und pruefe Art/Dwell.
12. Pruefe: Segmentliste zeigt **SOL-Zwischen-OPs** (IDs und Namen, soweit aufloesbar).
13. Setze eine Abfahrtszeit im Route Builder und pruefe, dass eine **Preview-Tabelle** fuer alle Halte (inkl. Zwischenhalte) mit Zeiten erscheint.
14. Wechsle in den Timing Editor und pruefe, dass die Startzeit/Stop-Zeiten entsprechend verschoben wurden.
15. Gehe zurueck in den Route Builder und pruefe, dass der Panelbereich geoeffnet bleibt.
16. Fuege mehrere Zwischenhalte hinzu und pruefe, dass Segmente und Stop-Listen ueber Scrollen erreichbar sind.
17. Waehle einen SOL-Unterwegspunkt und konvertiere ihn zu einem **Halt**; pruefe, dass er als Stop eingefuegt wird.
17. Passe Zeiten in der Stop-Tabelle an.
18. Pruefe: Zeit-Distanz-Graph aktualisiert sich, Warnungen sind sichtbar (non-blocking).
19. Pruefe: Timing Editor zeigt Durchfahrten mit berechneten Zeiten (read-only).
20. Warte auf Auto-Save, lade die Seite neu.
21. Pruefe: Draft-Daten sind weiterhin vorhanden.
22. Klicke **Uebernehmen** und pruefe, dass die App zur vorherigen Ansicht navigiert.
23. Klicke einen OP-Marker auf der Karte und pruefe, dass ein Zwischenhalt hinzugefuegt wird.

## Steps (Manual-Create Entry)
1. Oeffne **Auftragsposition hinzufuegen**.
2. Wechsle auf den Tab **Fahrplan (manuell)**.
3. Trage eine Zugnummer ein und (optional) stelle Halte ueber **Fahrplan zusammenstellen** bereit.
4. Klicke **Fahrplan-Editor oeffnen**.
5. Pruefe: Ein neuer TrainPlan wird angelegt und der Vollseiten-Editor oeffnet sich.

## Expected Results
- Full-page editor wird geladen, alte Dialog-UI wird ersetzt.
- Route Builder und Timing Editor funktionieren mit Draft-Persistenz.
- Auto-Save ueberlebt Reload; Uebernehmen navigiert zurueck.
- Der Manual-Create Einstieg erzeugt einen neuen TrainPlan und oeffnet den Editor.
