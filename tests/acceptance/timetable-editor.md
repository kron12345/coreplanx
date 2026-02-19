# Acceptance Test: Timetable Editor (Route Builder & Timing Editor)

## Related Spec
- /specs/timetable-editor.md (Rules: R1–R23)

## Preconditions
- Mindestens eine Fahrplan-Position ist mit einem TrainPlan verknuepft.
- Topologie-Operational-Points sind vorhanden (mit Koordinaten).

## Steps
1. Oeffne eine Fahrplan-Position im Auftragsmanagement.
2. Klicke **„Fahrplan bearbeiten“**.
3. Pruefe: Es oeffnet sich eine **Vollseite** mit Route Builder + Timing Editor.
4. Suche eine Operational-Point im Route Builder und setze Origin + Destination.
5. Pruefe: OSM-Karte ist sichtbar, Start/Ziel Eingaben sind im linken Route-Panel; SOL-Route/Marker sichtbar.
6. Schalte die Routing-Option **Link-Abschnitte** um und pruefe, dass die Route neu berechnet wird (andere Linienfuehrung oder gleiche Route bei unveraenderter Geometrie).
7. Setze **Elektrifizierung = Nur elektrifiziert** und pruefe, dass die Route neu berechnet wird.
8. Falls Alternativen verfuegbar sind: waehle eine Alternative und pruefe, dass die Linienfuehrung der Segmente wechselt.
9. Zoom auf der Karte heraus: OP-Marker verschwinden; zoome hinein und pruefe, dass Marker im sichtbaren Bereich geladen werden.
10. Pruefe: Der Route Builder ist links standardmaessig geoeffnet.
11. Fuege ueber das Inline-Stop-Editorfeld zwischen Halten einen Zwischenhalt hinzu und pruefe Art/Dwell.
12. Pruefe: Segmentliste zeigt **SOL-Zwischen-OPs** (IDs und Namen, soweit aufloesbar).
13. Setze eine Abfahrtszeit im Route Builder und pruefe, dass eine **Preview-Tabelle** fuer alle Halte (inkl. Zwischenhalte) mit Zeiten erscheint.
14. Wechsle in den Timing Editor und pruefe, dass die Startzeit/Stop-Zeiten aus den Segment-Reisezeiten uebernommen werden (nicht leer).
15. Wenn die SOL-Route neu berechnet wird (z. B. Alternative), pruefe, dass Timing-Editor Zeiten neu berechnet werden, solange keine manuellen Timing-Edits vorhanden sind.
16. Gehe zurueck in den Route Builder und pruefe, dass der Panelbereich geoeffnet bleibt.
17. Fuege mehrere Zwischenhalte hinzu und pruefe, dass Segmente und Stop-Listen ueber Scrollen erreichbar sind.
18. Waehle einen SOL-Unterwegspunkt und konvertiere ihn zu einem **Halt**; pruefe, dass er als Stop eingefuegt wird.
19. Passe Zeiten in der Stop-Tabelle an.
20. Pruefe: Zeit-Distanz-Graph aktualisiert sich, Warnungen sind sichtbar (non-blocking).
21. Pruefe: Timing Editor zeigt Durchfahrten mit berechneten Zeiten (read-only).
22. Pruefe: Zuggrafik zeigt horizontale Linien pro Betriebsstelle (Y-Achse), Zeit laeuft auf der X-Achse (Origin oben, Destination unten).
23. Klicke einen Durchfahrts-Punkt in der Zuggrafik und pruefe, dass er als **Halt** uebernommen wird.
24. Warte auf Auto-Save, lade die Seite neu.
25. Pruefe: Draft-Daten sind weiterhin vorhanden.
26. Klicke **Uebernehmen** und pruefe, dass die App zur vorherigen Ansicht navigiert.
27. Klicke einen OP-Marker auf der Karte und pruefe, dass ein Zwischenhalt hinzugefuegt wird.

## Steps (Manual-Create Entry)
1. Oeffne **Auftragsposition hinzufuegen**.
2. Wechsle auf den Tab **Fahrplan (manuell)**.
3. Trage eine Zugnummer ein und (optional) stelle Halte ueber **Fahrplan zusammenstellen** bereit.
4. Klicke **Fahrplan-Editor oeffnen**.
5. Pruefe: Ein neuer TrainPlan wird angelegt und der Vollseiten-Editor oeffnet sich.

## Steps (Fahrplanmanager Entry)
1. Oeffne **Fahrplanmanager**.
2. Nutze die primäre Erstellen-Aktion in der Toolbar.
3. Pruefe: Ein neuer TrainPlan wird angelegt und der Vollseiten-Editor oeffnet sich.
4. Pruefe: `returnUrl` zeigt auf den Fahrplanmanager und **Zurueck/Uebernehmen** fuehrt dorthin zurueck.

## Expected Results
- Full-page editor wird geladen, alte Dialog-UI wird ersetzt.
- Route Builder und Timing Editor funktionieren mit Draft-Persistenz.
- Auto-Save ueberlebt Reload; Uebernehmen navigiert zurueck.
- Der Manual-Create Einstieg erzeugt einen neuen TrainPlan und oeffnet den Editor.
- Der Fahrplanmanager-Einstieg nutzt denselben Editor-Flow (inkl. TrainPlan-Seed + returnUrl).
