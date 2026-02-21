# Acceptance Test: Timetable Editor (Route Builder & Timing Editor)

## Related Spec
- /specs/timetable-editor.md (Rules: R1–R66)

## Preconditions
- Mindestens eine Fahrplan-Position ist mit einem TrainPlan verknuepft.
- Topologie-Operational-Points sind vorhanden (mit Koordinaten).

## Steps
1. Oeffne eine Fahrplan-Position im Auftragsmanagement.
2. Klicke **„Fahrplan bearbeiten“**.
3. Pruefe: Es oeffnet sich eine **Vollseite** mit drei Schritten: Bestellkontext, Route Builder, Timing Editor.
4. Pruefe in Schritt 1 (Bestellkontext): Hilfe-Icons sind an allen relevanten Feldern vorhanden und zeigen erklaerende Tooltips.
5. Trage bei `OTN/Name` einen numerischen Wert (z. B. `4711`) ein und pruefe in der Zuordnungsvorschau, dass OTN gesetzt wird.
6. Trage bei `OTN/Name` stattdessen Text (z. B. `Alpen-Express`) ein und pruefe, dass Name gesetzt und OTN geleert wird.
7. Klicke in `Gueltigkeit` und pruefe, dass der bekannte Jahreskalender als Overlay geoeffnet wird; waehle mehrere Tage innerhalb der erlaubten Range und pruefe, dass das Overlay nach einzelnen Klicks offen bleibt.
8. Schliesse den Kalender ueber den vorhandenen Schliessen-Button und pruefe, dass die Auswahl erhalten bleibt.
9. Waehle `TrainType = Passenger train` und pruefe, dass `TrafficTypeCode` als Dropdown passende Optionen (z. B. S-Bahn) anbietet; pruefe, dass die frueheren Quick-Buttons nicht mehr vorhanden sind.
10. Pruefe im Desktop-Layout in Schritt 1: In der ersten Reihe stehen `OTN/Name`, `Grund` und `Gueltigkeit`; `Zugtyp` und `Zugkategorie` liegen darunter.
11. Pruefe in Schritt 1 auf Full-HD: Abstaende, Feldhoehen und Buttonhoehen sind insgesamt kompakter als zuvor, ohne dass Texte/Icons abgeschnitten oder ueberlagert werden.
12. Pruefe den neuen Bereich `Formation Builder`: `Formationsvorlage` steht oben als eigener, uebergeordneter Block; darunter befindet sich der manuelle Builder mit `Fahrtyp` und abhaengigem `Fahrzeug`.
13. Waehle im manuellen Builder `Fahrtyp = Triebfahrzeug`; pruefe, dass die angebotenen Fahrzeuge aus den Stammdaten (`vehicleTypes`) kommen und ueber den expliziten Fahrtyp am Fahrzeugtyp (`formationServiceType`) gefiltert werden.
14. Wechsle auf `Fahrtyp = Wagen`, fuege mindestens einen Wagen hinzu und pruefe, dass die Formation live erweitert wird.
15. Wechsle auf `Fahrtyp = PWG`, gib `Länge`, `Gewicht`, `vMax` ein, klicke `+` und pruefe, dass die PWG-Einheit zur Formation hinzugefuegt wird.
16. Entferne eine Einheit ueber den Muellimer in der Formation und pruefe, dass Darstellung und Summenwerte sofort aktualisieren.
17. Waehle eine Formationsvorlage aus den Stammdaten (`vehicleCompositions`) und pruefe, dass deren Einträge mit korrekter Anzahl (`quantity`) und Reihenfolge die aktuelle Formation ersetzen.
18. Ziehe eine Formationseinheit horizontal an eine andere Position und pruefe, dass die sichtbare Reihenfolge nach dem Loslassen sofort aktualisiert.
19. Pruefe in Schritt 1 beim Scrollen: Der Bereichs-Header bleibt sticky und zeigt weiterhin eine kompakte Fortschrittsanzeige.
20. Pruefe die Status-Chips (`Stammdaten`, `Formation`, `Abrechnung`): Zu Beginn sind unvollständige Bereiche als `offen` markiert; nach vollständiger Eingabe wechseln sie auf `ok`.
21. Pruefe Step-1-Buttons (`Vorlage übernehmen`, `Hinzufügen`, `PWG hinzufügen`, Clear-Aktionen): einheitliche kompakte Höhe/Padding/Icongröße.
22. Pruefe im Zugverband: Jede Einheit zeigt eine Positionsnummer (`#1/#2/...`) und ist durch dezente Trenner klar abgrenzbar.
23. Nutze die Schnell-Löschen-Aktionen:
24. `TrafficType` leeren -> `TrafficTypeCode` + `TrafficTypeNetwork` werden sofort geleert.
25. `PWG-Werte` leeren -> Länge/Gewicht/vMax sind sofort leer.
26. `Formation leeren` -> alle Formationseinheiten werden sofort entfernt.
27. Pruefe Inline-Validierung in Schritt 1: leere Pflichtfelder zeigen direkt einen kurzen Hinweis; bei gueltiger Eingabe verschwindet der Hinweis sofort.
28. Ziehe erneut eine Formationseinheit und pruefe: Es erscheint ein kurzes Mikro-Feedback zur erfolgreichen Umordnung.
29. Pruefe in Schritt 1 auf Full-HD: Es erscheint kein horizontaler Seiten-Scrollbalken am unteren Rand.
30. Pruefe die Formationsdarstellung: Einheiten sind als SVG-Formen dargestellt; Wagen als Rechteck, Triebfahrzeug mit deutlich abgeschraegter linker oberer Ecke, PWG als optisch unterscheidbare Variante.
31. Pruefe die Textzeilen in der Form: statt Name werden `L/G/vMax`-Metriken angezeigt.
32. Fahre mit der Maus ueber eine Einheit und pruefe: Tooltip zeigt ausgeschriebene Angaben (`Länge`, `Gewicht`, `vMax` usw.).
33. Pruefe die Einheit-Controls: Platznummer (`#...`) und Muellimer sind vertikal untereinander in einer kompakten Seiten-Spalte.
34. Wechsle zu Schritt 2 (Route Builder).
20. Suche eine Operational-Point im Route Builder und setze Origin + Destination.
19. Pruefe: OSM-Karte ist sichtbar, Start/Ziel Eingaben sind im linken Route-Panel; SOL-Route/Marker sichtbar.
20. Schalte die Routing-Option **Link-Abschnitte** um und pruefe, dass die Route neu berechnet wird (andere Linienfuehrung oder gleiche Route bei unveraenderter Geometrie).
21. Setze **Elektrifizierung = Nur elektrifiziert** und pruefe, dass die Route neu berechnet wird.
22. Falls Alternativen verfuegbar sind: waehle eine Alternative und pruefe, dass die Linienfuehrung der Segmente wechselt.
23. Zoom auf der Karte heraus: OP-Marker verschwinden; zoome hinein und pruefe, dass Marker im sichtbaren Bereich geladen werden.
24. Pruefe: Der Route Builder ist links standardmaessig geoeffnet.
25. Fuege ueber das Inline-Stop-Editorfeld zwischen Halten einen Zwischenhalt hinzu und pruefe Art/Dwell.
26. Pruefe: Segmentliste zeigt **SOL-Zwischen-OPs** (IDs und Namen, soweit aufloesbar).
27. Setze eine Abfahrtszeit im Route Builder und pruefe, dass eine **Preview-Tabelle** fuer alle Halte (inkl. Zwischenhalte) mit Zeiten erscheint.
28. Wechsle in den Timing Editor und pruefe, dass die Startzeit/Stop-Zeiten aus den Segment-Reisezeiten uebernommen werden (nicht leer).
29. Wenn die SOL-Route neu berechnet wird (z. B. Alternative), pruefe, dass Timing-Editor Zeiten neu berechnet werden, solange keine manuellen Timing-Edits vorhanden sind.
30. Gehe zurueck in den Route Builder und pruefe, dass der Panelbereich geoeffnet bleibt.
31. Fuege mehrere Zwischenhalte hinzu und pruefe, dass Segmente und Stop-Listen ueber Scrollen erreichbar sind.
32. Waehle einen SOL-Unterwegspunkt und konvertiere ihn zu einem **Halt**; pruefe, dass er als Stop eingefuegt wird.
33. Passe Zeiten in der Stop-Tabelle an.
34. Pruefe: Zeit-Distanz-Graph aktualisiert sich, Warnungen sind sichtbar (non-blocking).
35. Pruefe: Timing Editor zeigt Durchfahrten mit berechneten Zeiten (read-only).
36. Pruefe: Zuggrafik zeigt horizontale Linien pro Betriebsstelle (Y-Achse), Zeit laeuft auf der X-Achse (Origin oben, Destination unten).
37. Klicke einen Durchfahrts-Punkt in der Zuggrafik und pruefe, dass er als **Halt** uebernommen wird.
38. Warte auf Auto-Save, lade die Seite neu.
39. Pruefe: Draft-Daten sind weiterhin vorhanden (inkl. Schritt-1-Werte).
40. Klicke **Uebernehmen** und pruefe, dass die App zur vorherigen Ansicht navigiert.
41. Klicke einen OP-Marker auf der Karte und pruefe, dass ein Zwischenhalt hinzugefuegt wird.
42. Pruefe auf Desktop (z. B. Full-HD), dass das linke Route-Panel kompakter ist (kleinere Schrift + geringere vertikale Abstaende), ohne dass Felder/Aktionen verloren gehen.
43. Klicke in Start und Ziel und pruefe: Der vorausgefuellte Text verschwindet direkt beim Fokus, so dass sofort getippt werden kann; bei leerem Feld nach Fokusverlust wird der vorherige Wert wieder angezeigt.
44. Pruefe in der Stop-Liste: keine separate Ueberschrift; Start/Ziel-Zeilen ohne Art/Dwell-Controlzeile; Zwischenhalte erscheinen kompakt einzeilig mit Art/Dwell/Bewegen/Loeschen in der Zeile; kein Trennstrich zwischen Start/Ziel und dem Inline-Button **+ Zwischenhalt**; vertikale Abstaende zwischen Zeile und Inline-Einfuegen sind sehr klein; Loeschen an der Zeile moeglich und Start/Ziel werden nach Loeschen automatisch neu bestimmt.
45. Pruefe, dass die Stop-Liste selbst keinen separaten vertikalen Scrollbalken mehr zeigt.
46. Pruefe in dichter Ansicht mit mehreren Zwischenhalten, dass keine Labels/Icons/Formfelder visuell ueberlappen oder abgeschnitten sind.
47. Pruefe bei Zwischenhalten, dass die Schriftgroesse in `Art` und `Dwell` kleiner ist als in den normalen Panel-Feldern.
48. Pruefe bei Zwischenhalten in `Art`, dass `Stop` und `Pass` vollstaendig sichtbar sind (kein rechter Anschnitt), und dass Feld-/Button-/Icon-Groessen im linken Panel einheitlich wirken.
49. Pruefe in Start/Ziel- und Zwischenhalt-Zeilen, dass Index, Texte und Controls je Zeile in der Hoehe sichtbar mittig ausgerichtet sind (kein nach oben/unten verschobener Eindruck).
50. Pruefe bei Zwischenhalten: Zeile 1 zeigt den Namen, Zeile 2 zeigt die PLC-Info; Symbole fuer Hoch/Runter/Loeschen sind deutlich groesser (ca. +40% ggü. vorheriger kompakter Groesse), ohne Ueberlappung.
51. Pruefe bei kompakten Route-Builder-Feldern ohne Hint/Fehlertext, dass kein leerer Material-Subscript-Abstand unter dem Feld reserviert wird (keine zusaetzliche Spacer-Zeile).
52. Pruefe in allen Route-Builder-Selects (z. B. `Art`, `Elektrifizierung`, `Alternativen`): sichtbarer Select-Werttext ist gleich gross wie benachbarte Feldtexte und wirkt nicht groesser.
53. Oeffne Route-Builder-Selects und pruefe in der Dropdown-Liste: Optionen sind deutlich groesser (ca. +60% ggü. kompakter Feldschrift), bleiben aber ohne Clipping/Ueberlappung lesbar.
54. Pruefe in Segment-Zeilen: `Speed` sitzt rechtsbuendig und kompakter; wenn keine Route-Auswahl vorhanden ist, bleibt kein leerer Route-Spaltenplatz und Label/Meta davor haben sichtbar mehr Breite.
55. Pruefe in Segment-Zeilen: Segmentrichtung wird zweizeilig als `Von` (oben) und `Nach` (unten) angezeigt; der Pfeil `→` wird dort nicht mehr verwendet.
56. Pruefe in Segment-Zeilen: `#1/#2/...` steht links vor dem zweizeiligen `Von/Nach`-Block und nicht als eigene Zeile darueber.

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
- Schritt 1 (`Bestellkontext`) ist vor Route/Timing vorhanden und speichert OTN/Name-Logik korrekt.
- `Gueltigkeit` unterstuetzt Mehrfachauswahl im Overlay-Kalender ohne Auto-Close nach Einzelklick; Schliessen erfolgt kontrolliert ueber den Schliessen-Button.
- `TrafficTypeCode` ist als TrainType-abhaengiges Dropdown umgesetzt (inkl. Passenger-Beispielen wie S-Bahn); Quick-Buttons sind entfernt.
- Die Schritt-1-Feldanordnung ist auf Desktop klar strukturiert: `OTN/Name`, `Grund`, `Gueltigkeit` oben; `Zugtyp` und `Zugkategorie` darunter.
- Schritt 1 (`Bestellkontext`) ist insgesamt kompakter (engere Abstaende und geringere Feldhoehen), bleibt aber sauber lesbar ohne Overlap/Clipping.
- Formation Builder ist in Schritt 1 vorhanden: `Formationsvorlage` steht oben als uebergeordneter Block, darunter steuert `Fahrtyp` die verfügbaren Fahrzeuge aus den Stammdaten (`vehicleTypes`) ueber `formationServiceType` (Legacy-Fallback ueber Kategorie bleibt moeglich), `+` fuegt Einheiten hinzu, Muellimer entfernt Einheiten, und der Zugverband wird horizontal inkl. Live-Summen dargestellt.
- Formationsvorlagen aus Stammdaten (`vehicleCompositions`) koennen als uebergeordneter Preset-Schritt ausgewaehlt werden und ersetzen die aktuelle Formationseinheitenliste in der Vorlagen-Reihenfolge.
- Formationseinheiten im horizontalen Zugverband lassen sich per Drag&Drop umsortieren; die neue Reihenfolge ist sofort sichtbar und wird gespeichert.
- Der Schritt-1-Header bleibt beim Scrollen sticky und zeigt den Fortschritt weiterhin kompakt an.
- Status-Chips fuer `Stammdaten`, `Formation` und `Abrechnung` zeigen den Pflichtfeld-Fortschritt je Block (`offen`/`ok`).
- Step-1-Aktionsbuttons sind in kompaktem Stil einheitlich (Höhe, Padding, Icon-Proportionen).
- Formationseinheiten zeigen Positionsnummern (`#...`) und dezente Trenner fuer schnelle Reihenfolge-Erkennung.
- Schnell-Löschen-Aktionen funktionieren fuer `TrafficType`, PWG-Werte und komplette Formation.
- Pflichtfelder in Schritt 1 zeigen Inline-Hinweise bei leerem Zustand und entfernen diese direkt nach gueltiger Eingabe.
- Nach Drag&Drop erscheint ein kurzes UI-Feedback zur erfolgreich angewendeten Reihenfolge.
- In Schritt 1 gibt es auf Full-HD keinen horizontalen Seiten-Scrollbalken mehr.
- Formationseinheiten werden als SVG-Zugformen mit Text im Shape dargestellt; Wagen/Triebfahrzeug/PWG sind anhand der Form sofort unterscheidbar.
- In den SVG-Einheiten werden technische Kurzmetriken (`L/G/vMax`) statt Name gezeigt; Tooltip liefert ausgeschriebene Feldnamen/Werte.
- Die Schräge bei Triebfahrzeug-Einheiten ist deutlich länger/sichtbarer.
- Platznummer und Muellimer sind in einer vertikalen Seiten-Spalte gestapelt, wodurch horizontal mehr Einheiten sichtbar sind.
- Route Builder und Timing Editor funktionieren mit Draft-Persistenz.
- Auto-Save ueberlebt Reload; Uebernehmen navigiert zurueck.
- Der Manual-Create Einstieg erzeugt einen neuen TrainPlan und oeffnet den Editor.
- Der Fahrplanmanager-Einstieg nutzt denselben Editor-Flow (inkl. TrainPlan-Seed + returnUrl).
- Das linke Route-Panel ist auf Desktop kompakter (Typografie/Spacing), bleibt aber funktional und responsiv.
- Stop-Listen-UX ist vereinfacht (ohne Kopfzeile, reduzierte Start/Ziel-Zeilen, ohne Trennstrich vor Inline-Zwischenhalt-Einfuegen, mit gleichmaessig kleinen vertikalen Abstaenden, Zeilen-Loeschen mit automatischer Start/Ziel-Normalisierung).
- Start/Ziel-Felder sind direkt ueberschreibbar (prefill leert sich bei Fokus) und stellen bei leerem Verlassen den vorherigen Wert wieder her.
- Zwischenhalte sind platzsparend als kompakte Ein-Zeilen-Bedienung dargestellt; der Einfuege-Trigger zwischen Halten ist ebenfalls kompakt.
- Die Stop-Liste hat sehr kleine vertikale Abstaende und keinen eigenen vertikalen Scrollbalken.
- Auch in maximal kompakter Darstellung gibt es keine sichtbaren Ueberlappungen von Texten/Icons/Feldern.
- `Art`/`Dwell` in Zwischenhalten sind typografisch kleiner als Standardfelder und bleiben lesbar.
- `Stop`/`Pass` in `Art` sind nicht abgeschnitten; kompakte Groessen von Feldern/Buttons/Icons sind konsistent.
- Stop-Listen-Zeilen wirken vertikal sauber ausgerichtet; Eintraege je Zeile sind in der Hoehe zentriert.
- Zwischenhalte zeigen Name/PLC zweizeilig; Hoch/Runter/Loeschen-Symbole sind sichtbar vergroessert und bleiben sauber ausgerichtet.
- Kompakte Route-Builder-Felder reservieren ohne Hint/Fehler keinen leeren Subscript-Spacer unterhalb des Feldinhalts.
- Route-Builder-Selectwerte nutzen dieselbe kompakte Typografie wie benachbarte Eingabefelder (kein sichtbar groesserer Select-Text).
- Geoeffnete Route-Builder-Select-Optionen sind signifikant groesser (ca. +60%) und trotzdem sauber lesbar.
- Segment-`Speed` ist rechtsbuendig und kompakter; Segmentzeilen ohne Route-Select verlieren keinen leeren rechten Spaltenplatz.
- Segmentrichtung in der Segmentliste ist als zweizeiliges `Von`/`Nach`-Label dargestellt (ohne Pfeilseparator).
- Segmentnummer steht links vor dem `Von/Nach`-Block (nicht oberhalb).
