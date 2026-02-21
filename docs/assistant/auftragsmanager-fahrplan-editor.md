# Auftragsmanager · Fahrplan-Editor (Route Builder & Timing Editor)

Diese Seite beschreibt den neuen Fahrplan-Editor als Vollseiten-Ansicht.

## Wo finde ich das?

Navigation:

- **Auftragsmanager → Auftragsposition bearbeiten → Fahrplan bearbeiten**
- Es oeffnet sich eine **Vollseite** mit Route Builder und Timing Editor.
- **Auftragsmanager → Auftragsposition hinzufuegen → Fahrplan (Manuell) → Fahrplan-Editor oeffnen**
- Es wird ein neuer TrainPlan aus den manuellen Halten (oder Defaults) erzeugt und der Editor oeffnet sich.
- **Fahrplanmanager → primäre Erstellen-Aktion (Toolbar)**
- Es wird ein neuer, vorbefuellter TrainPlan erzeugt und im selben Vollseiten-Editor geoeffnet.

## Ueberblick

Der Fahrplan-Editor besteht aus drei Schritten:

1. **Bestellkontext** (Bestell-/TTT-Attribute)
2. **Route Builder** (Streckenaufbau)
3. **Timing Editor** (Zuggrafik + Stop-Tabelle)

Die Eingaben werden als **Drafts** gespeichert, so dass bei Abbruechen keine Arbeit verloren geht.

## Bestellkontext (Schritt 1)

Zweck: Vor dem Streckenbau alle bestellrelevanten Zugattribute erfassen.

- Felder beinhalten u. a. `OTN/Name`, `ReasonOfReference`, `Gueltigkeit`, `TrainType`, `TrafficType`, Fahrtyp/Fahrzeugbezug, Debitorencode, Distributionsliste und Grund fuer kostenlose Bearbeitung.
- Alle Felder besitzen ein **Hilfe-Symbol** (Fragezeichen/`help_outline`) mit Tooltip.
- Der lokale Schritt-Header bleibt beim Scrollen in Schritt 1 sticky und zeigt den Pflichtfeld-Fortschritt kompakt an.
- Pflichtfeld-Fortschritt ist in Chips sichtbar (`Stammdaten`, `Formation`, `Abrechnung` mit `offen`/`ok`).
- Auf Full-HD wird in Schritt 1 kein horizontaler Seiten-Scrollbalken mehr erzeugt.
- **OTN/Name-Logik**:
  - Numerisch `1..99999` -> wird als OTN verwendet.
  - Sonst -> wird als Name verwendet; OTN bleibt leer.
- **Gueltigkeit**:
  - Default ist das aktuelle Datum.
  - Klick oeffnet den vorhandenen Jahreskalender (Monate als Zeilen, Wochentage als Spalten).
  - Der Kalender oeffnet als Overlay und bleibt bei einzelnen Tagesklicks offen (Mehrfachauswahl moeglich); geschlossen wird ueber den Schliessen-Button.
  - Datumsauswahl ist auf eine uebergebene Range begrenzt (`validityStart`/`validityEnd` beim Editor-Aufruf).
- **TrafficTypeCode**:
  - Ist als TrainType-abhaengiges Dropdown umgesetzt (z. B. Passenger-nahe Optionen wie S-Bahn); Quick-Buttons wurden entfernt.
  - Es gibt eine Schnell-Loeschen-Aktion, die `TrafficTypeCode` und `TrafficTypeNetwork` in einem Schritt leert.
  - Die Feldanordnung ist im Desktop-Layout klar gegliedert: oben `OTN/Name`, `Grund`, `Gueltigkeit`; darunter `Zugtyp` und `Zugkategorie`.
  - Schritt 1 ist insgesamt dichter gestaltet (kleinere Abstaende und kompaktere Feldhoehen), damit auf Full-HD mehr Inhalt ohne Scrollen sichtbar bleibt.
- **Formation Builder**:
  - Eigener Bereich in Schritt 1 zur Fahrzeug-Formation.
  - Die **Formationsvorlage** steht oben als uebergeordneter Schritt und ersetzt die aktuelle Formation direkt in der Vorlagen-Reihenfolge.
  - Darunter folgt der manuelle Builder: `Fahrtyp` steuert im selben Block die Auswahl im Feld `Fahrzeug`, danach wird mit `+` hinzugefuegt.
  - `Fahrtyp` steuert die Auswahl (`Triebfahrzeug`, `Wagen`, `PWG`).
  - Bei `Triebfahrzeug`/`Wagen` werden passende Fahrzeuge aus den Fahrzeug-Stammdaten (`vehicleTypes`) ueber `formationServiceType` gefiltert (Legacy-Fallback ueber Kategorie moeglich).
  - Zusätzlich können Formationsvorlagen aus den Stammdaten (`vehicleCompositions`) ausgewählt und direkt in den Zugverband übernommen werden.
  - Bei `PWG` werden `Länge`, `Gewicht`, `vMax` pauschal erfasst und als Einheit zur Formation hinzugefügt.
  - Für PWG gibt es eine Schnell-Loeschen-Aktion zum Zuruecksetzen der drei PWG-Metriken.
  - Ein `+` fuegt Fahrzeuge zur Formation hinzu; in der horizontalen Zugverbandsansicht kann jede Einheit per Muellimer entfernt werden.
  - Die Reihenfolge im Zugverband kann per Drag&Drop (horizontal ziehen) direkt geändert werden; danach erscheint ein kurzes Feedback zur uebernommenen Reihenfolge.
  - Jede Einheit zeigt ihre Position (`#1/#2/...`) zusammen mit dem Muellimer vertikal gestapelt in einer kompakten Seiten-Spalte.
  - Einheiten werden als SVG-Zugformen dargestellt: Wagen als Rechteck, Triebfahrzeug mit deutlich laengerer abgeschraegter linker oberer Ecke, PWG als eigene Variante.
  - In der Form steht kompakter Technik-Text (`L/G/vMax`) statt Name; ein Tooltip zeigt die Werte mit ausgeschriebenen Feldnamen.
  - Die komplette Formation kann ueber eine Schnell-Loeschen-Aktion mit einem Klick geleert werden.
  - Summenwerte (z. B. Gesamtlaenge/Gesamtgewicht) werden live aktualisiert.
- Werte werden zusammen mit den Drafts auf dem Zug (`TrainPlan.routeMetadata`) gespeichert und beim Bestellfall-Start aus dem Zug wiederverwendet.
- Pflichtfelder zeigen in Schritt 1 direkte Inline-Hinweise, bis gueltige Werte gesetzt sind.

## Route Builder

Zweck: Streckenverlauf und grobe Zeiten definieren.

- **OSM-Karte**: Map-first Layout, Start/Ziel Eingaben liegen im linken Panel.
- **Origin/Destination**: Operational Points ueber Suche oder Map-Klick auswaehlen.
- **Route-Panel (links)**: Standardmaessig offen; bei Rueckkehr aus dem Timing-Editor bleibt es offen.
- **Kompakte Dichte (Desktop)**: Linkes Route-Panel nutzt kleinere Schrift und geringere vertikale Abstaende, damit auf Full-HD mehr Halte/Segmente sichtbar sind.
- **Vereinfachte Stop-Liste**: Keine separate Stop-Ueberschrift; Start/Ziel erscheinen reduziert ohne Art/Dwell-Controlzeile.
- **Start/Ziel schneller editieren**: Beim Klick/Fokus in Start oder Ziel wird der vorausgefuellte Text geleert; bleibt das Feld leer, wird der bisherige Wert bei Fokusverlust wieder angezeigt.
- **Visuelle Trennung reduziert**: Zwischen Start/Ziel-Zeilen und dem Inline-Button **+ Zwischenhalt einfuegen** gibt es keinen Trennstrich.
- **Abstaende kompakt**: Vertikale Abstaende in der Stop-Liste (Zeile, Zwischenhalt-Einfuegen) sind gleichmaessig klein gehalten.
- **Zwischenhalte platzsparend**: Zwischenhalte zeigen Art/Dwell/Bewegen/Loeschen direkt kompakt in einer Zeile; der Einfuege-Trigger ist als kleine Inline-Aktion dargestellt.
- **Kein separater Stop-Scroll**: Die Stop-Liste zeigt keinen eigenen vertikalen Scrollbalken; Darstellung bleibt trotzdem dicht.
- **Max-Kompakt ohne Ueberlagerung**: Dichte wurde weiter erhoeht; Texte, Icons und Felder bleiben ohne sichtbare Ueberschneidung.
- **Inline-Felder kleiner**: Bei Zwischenhalten sind `Art` und `Dwell` mit kleinerer Schrift als normale Panel-Felder dargestellt.
- **Stop/Pass lesbar**: Werte im Feld `Art` sind nicht abgeschnitten; Groessen von Feldern, Buttons und Icons sind einheitlich auf kompakte Bedienung abgestimmt.
- **Zeilen vertikal ausgerichtet**: Inhalte je Stop-Zeile (Index, Text/Felder, Controls) sind in der Hoehe zentriert und wirken dadurch optisch sauber ausgerichtet.
- **Zwischenhalt-Label zweizeilig**: Zwischenhalte zeigen den Namen in der ersten Zeile und die PLC-Info in der zweiten Zeile.
- **Aktionssymbole vergroessert**: Hoch/Runter/Loeschen in Zwischenhalt-Zeilen sind deutlich groesser (ca. +40%) fuer bessere Sichtbarkeit.
- **Kein leerer Subscript-Spacer**: Bei Route-Builder-Feldern ohne Hint/Fehler wird kein zusaetzlicher Material-Subscript-Abstand reserviert.
- **Select-Typografie angeglichen**: Sichtbarer Text in Select-Feldern nutzt dieselbe kompakte Groesse wie benachbarte Eingabefelder (inkl. Inline-Zwischenhalt-Selects).
- **Groessere Dropdown-Optionen**: In geoeffneten Select-Listen sind Optionen deutlich groesser (ca. +60% ggü. kompakter Feldschrift) fuer bessere Lesbarkeit.
- **Segment-Speed rechtsbuendig**: `Speed` in Segment-Zeilen ist rechts ausgerichtet und kompakter; ohne Route-Select wird kein leerer rechter Spaltenplatz reserviert.
- **Segmentrichtung zweizeilig**: Segment-Labels zeigen `Von` (oben) und `Nach` (unten); der Pfeilseparator entfällt.
- **Segmentnummer davor**: `#1/#2/...` steht links vor dem `Von/Nach`-Block und nicht als Zeile darueber.
- **Zeilen-Loeschen**: Papierkorb liegt direkt an der Zeile; nach Loeschen wird Start/Ziel automatisch aus erster/letzter Zeile neu bestimmt.
- **Stops Inline**: Zwischenhalte werden zwischen den Stop-Zeilen eingefuegt (Art + Dwell direkt editierbar). Bei vielen Halten sind Stops/Segmente ueber Scrollen erreichbar.
- **Unterwegspunkte**: SOL-Durchfahrten werden angezeigt; einzelne Punkte koennen in **Halt** umgewandelt werden.
- **Routing-Optionen**: Link-Abschnitte + Elektrifizierung filtern; Alternativen auswaehlen, wenn verfuegbar (Accordion).
- **Segmentliste**: Scrollbarer Bereich, zeigt Segmente + **SOL-Unterwegspunkte** (nicht nur die gesetzten Halte); beim Routing wird ein Loader angezeigt.
- **Preview-Fahrplan**: Abfahrtszeit setzen und Zeiten fuer alle Halte ableiten; die Timing-Ansicht uebernimmt den Start.

## Timing Editor

Zweck: Zeiten im Detail festlegen.

- **Stops Grid**: Ankunft/Abfahrt bearbeiten, Dwell nachvollziehbar. **Durchfahrten** erscheinen als read-only Zeilen mit berechneten Zeiten.
- **Zeit-Übernahme**: Solange keine manuellen Timing-Edits vorliegen, werden Zeiten aus der Route-Ansicht (Abfahrtszeit + Segment-Reisezeiten) automatisch uebernommen.
- **Zuggrafik-Edit**: Zeiten koennen per Drag im Graph angepasst werden; Durchfahrten lassen sich im Graph per Klick zu **Halten** machen.
- **Achsen**: Origin oben, Destination unten (Route laeuft von oben nach unten).
- **Zeit–Distanz-Graph**: Zeit auf X-Achse, Betriebsstellen auf Y-Achse; horizontale Linien helfen beim Lesen.
- **Interaktionen**: Zeiten anpassen (Grid oder via Graph).
- **Validierungen**: Warnungen bei zu kurzen Dwell/Travel-Zeiten (non-blocking).

## Drafts & Auto-Save

- Aenderungen werden automatisch gespeichert (debounced).
- Drafts liegen im verknuepften TrainPlan (Route-Metadata).
- Nach Reload werden vorhandene Drafts wieder geladen.

## Aktionen

- **Uebernehmen**: Speichern + zurueck zur vorherigen Ansicht.
- **Zurueck**: Ohne neue Aenderungen uebernehmen zurueck (Draft bleibt erhalten).

## Fehlerbilder & Loesungen

- **Karte leer**
  - Pruefen: Origin/Destination gesetzt? Operational Points mit Koordinaten vorhanden?
- **Kein Ergebnis in der OP-Suche**
  - Pruefen: Topologie-Operational-Points wurden importiert.
- **OP-Marker fehlen**
  - Pruefen: Zoomstufe ausreichend? Marker laden nur im sichtbaren Bereich (Viewport).
- **Auto-Save Fehler**
  - Pruefen: Backend erreichbar? Bei Fehlern wird erneut versucht.
