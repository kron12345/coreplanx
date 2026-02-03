# Auftragsmanager · Fahrplan-Editor (Route Builder & Timing Editor)

Diese Seite beschreibt den neuen Fahrplan-Editor als Vollseiten-Ansicht.

## Wo finde ich das?

Navigation:

- **Auftragsmanager → Auftragsposition bearbeiten → Fahrplan bearbeiten**
- Es oeffnet sich eine **Vollseite** mit Route Builder und Timing Editor.
- **Auftragsmanager → Auftragsposition hinzufuegen → Fahrplan (Manuell) → Fahrplan-Editor oeffnen**
- Es wird ein neuer TrainPlan aus den manuellen Halten (oder Defaults) erzeugt und der Editor oeffnet sich.

## Ueberblick

Der Fahrplan-Editor besteht aus zwei Schritten:

1. **Route Builder** (Streckenaufbau)
2. **Timing Editor** (Zuggrafik + Stop-Tabelle)

Die Eingaben werden als **Drafts** gespeichert, so dass bei Abbruechen keine Arbeit verloren geht.

## Route Builder

Zweck: Streckenverlauf und grobe Zeiten definieren.

- **OSM-Karte**: Vollbild-Ansicht mit schwebender Start/Ziel-Suche (Google-Maps-Stil).
- **Origin/Destination**: Operational Points ueber Suche oder Map-Klick auswaehlen.
- **Route-Panel (links)**: Faehrt aus, sobald Start/Ziel gesetzt sind; bei Rueckkehr aus dem Timing-Editor bleibt es offen.
- **Stops Inline**: Zwischenhalte werden zwischen den Stop-Zeilen eingefuegt (Art + Dwell direkt editierbar). Bei vielen Halten sind Stops/Segmente ueber Scrollen erreichbar.
- **Unterwegspunkte**: SOL-Durchfahrten werden angezeigt; einzelne Punkte koennen in **Halt** umgewandelt werden.
- **Routing-Optionen**: Link-Abschnitte + Elektrifizierung filtern; Alternativen auswaehlen, wenn verfuegbar (Accordion).
- **Segmentliste**: Scrollbarer Bereich, zeigt Segmente + **SOL-Unterwegspunkte** (nicht nur die gesetzten Halte); beim Routing wird ein Loader angezeigt.
- **Preview-Fahrplan**: Abfahrtszeit setzen und Zeiten fuer alle Halte ableiten; die Timing-Ansicht uebernimmt den Start.

## Timing Editor

Zweck: Zeiten im Detail festlegen.

- **Stops Grid**: Ankunft/Abfahrt bearbeiten, Dwell nachvollziehbar. **Durchfahrten** erscheinen als read-only Zeilen mit berechneten Zeiten.
- **Zeit–Distanz-Graph**: Linie zeigt den Laufweg, Punkte sind Halte.
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
