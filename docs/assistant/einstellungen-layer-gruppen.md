# Einstellungen · Layer-Gruppen

Diese Seite beschreibt die Layer-Gruppen und dient als Referenz fuer den CorePlanX Assistant.

## Wo finde ich das?

Navigation:

- **Einstellungen → Layer-Gruppen**

## Ueberblick

Layer-Gruppen steuern die **visuelle Ebenenstruktur** der Activities im Gantt.
Sie legen Reihenfolge, Bezeichnung und Beschreibung fest und werden lokal im Browser gespeichert.

## Layer-Gruppen

### Wie funktioniert es?

- Jede Gruppe hat eine **ID**, ein **Label** und eine **Order** (Sortierung).
- Die Order wird als **z-Index** verwendet: niedrigere Werte liegen optisch darunter.
- Standardgruppen sind geschuetzt und koennen nicht geloescht werden.

Standardgruppen:

- `background` (order 10)
- `default` (order 50)
- `marker` (order 90)

### Feldlexikon

| Feld | Typ | Zweck | Hinweise |
| --- | --- | --- | --- |
| `id` | string | Technischer Schluessel | slugifiziert, eindeutig |
| `label` | string | Anzeige-Label | sichtbar im Editor |
| `order` | number | Sortierreihenfolge | bestimmt z-Index |
| `description` | string | Beschreibung | optional |

### Verknuepfung mit Activities

- Activities bekommen die Gruppe ueber das Attribut `layer_group` (Activity-Editor).
- `layer_group` muss eine **bestehende Gruppen-ID** sein.
- Unbekannte IDs fallen auf die Gruppe `default` zurueck.

## Praxisbeispiele

- **Hintergrund-Layer fuer Sperrzeiten**
  - Neue Gruppe `blocker` mit `order=5` anlegen.
  - Activities mit `layer_group=blocker` und `draw_as=background` markieren.
- **Marker fuer Start/Ende**
  - `layer_group=marker` fuer kurze Events mit `draw_as=triangle-up`.

## Fehlerbilder & Loesungen

- **Gruppe laesst sich nicht loeschen**
  - Standardgruppen (`background`, `default`, `marker`) sind gesperrt.
- **Layer wirkt nicht**
  - `layer_group` in der Activity fehlt oder ist falsch geschrieben.
- **Reihenfolge aendert sich nicht**
  - Order speichern und ggf. per „hoch/runter“ neu sortieren.

## Kontext-FAQ

- **Kann ich beliebig viele Gruppen anlegen?**
  - Ja, die Gruppen sind frei konfigurierbar.
- **Wie wirkt sich die Order aus?**
  - Hoehere Werte werden im Gantt oben gezeichnet.

## Abhaengigkeiten & Fluss

- Layer-Gruppen → Attribut `layer_group` → Gantt-Z-Order
- Activity-Editor nutzt Gruppen-IDs als Preset-Optionen

## Wo wirken die Einstellungen?

- **Gantt/Timeline**: Gruppenreihenfolge beeinflusst die Stapelung der Balken.
- **Activity-Editor**: `layer_group` ist Preset und Filterkriterium.
- **Darstellung**: Zusammen mit `draw_as` entsteht die visuelle Priorisierung.
