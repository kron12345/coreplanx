# Einstellungen · Activity-Editor

Diese Seite beschreibt den Activity-Editor (Activity-Katalog) und dient als Referenz fuer den CorePlanX Assistant.

## Wo finde ich das?

Navigation:

- **Einstellungen → Activity-Editor**

## Ueberblick

Der Activity-Editor verwaltet den **Activity-Katalog**: Templates (Vorlagen) und konkrete Activities.
Activities referenzieren Activity-Types und liefern Standarddauer, Attribute und Relevanz.
Die Daten werden **serverseitig** ueber die Planning-Catalog-API gespeichert, so dass alle Clients
denselben Katalog sehen. „Werkseinstellungen“ setzt den Katalog auf das Default-Set zurueck.

Wichtig: **Neue Activities werden nur hier angelegt.** Activity-Types sind Referenzen und erzeugen
keine Activities automatisch.

## Activity-Editor

### Datenmodell (Templates vs. Activities)

- **Template** (`ActivityTemplate`)
  - `id`, `label`, `description`
  - `activityType` (Typ-Referenz)
  - `defaultDurationMinutes` (Standarddauer)
  - `attributes` (Liste aus `key` + `meta`)
- **Activity** (`ActivityDefinition`)
  - `id`, `label`, `description`
  - `activityType` (Typ-Referenz)
  - `templateId` (optional)
  - `defaultDurationMinutes` (optional, wird ggf. durch Attribute ueberschrieben)
  - `relevantFor` (Ressourcenarten)
  - `attributes` (Liste aus `key` + `meta`)

Templates dienen als Ausgangspunkt; Activities koennen Template-Attribute uebernehmen und gezielt
ergänzen/ueberschreiben.

### Feldlexikon

| Feld | Typ | Zweck | Hinweise |
| --- | --- | --- | --- |
| `id` | string | Technischer Schluessel | slugifiziert (a-z, 0-9, Bindestrich) |
| `label` | string | Anzeige-Label | wird ggf. ueber Uebersetzungen ersetzt |
| `description` | string | Kurzbeschreibung | optional |
| `activityType` | string | Referenz auf Activity-Type | muss existieren |
| `templateId` | string | Referenz auf Template | optional |
| `defaultDurationMinutes` | number | Standarddauer | wird in Attribut `default_duration` gespiegelt |
| `relevantFor` | string[] | Ressourcentypen | `personnel`, `vehicle`, `personnel-service`, `vehicle-service` |
| `attributes` | list | Attribute-Set | `key` + `meta` |

### Attribute & Meta

- Attribute sind **Key/Meta-Paare**.
- `meta` ist frei und unterstuetzt z. B.:
  - `datatype` (z. B. `timepoint`, `number`, `boolean`, `enum`, `color`)
  - `options` (bei `enum`, kommagetrennt)
  - `value` (Default-Wert)
  - `oncreate` / `onupdate` (z. B. `edit`)

### Presets (vordefinierte Attribute)

Der Editor bietet Presets, um typische Attribute schnell anzulegen:

| Preset | Wirkung | Typische Meta |
| --- | --- | --- |
| `field:start` | Startfeld | `datatype: timepoint`, `oncreate: edit` |
| `field:end` | Endfeld | `datatype: timepoint`, `oncreate: edit` |
| `field:from` | Von-Ort | `datatype: string` |
| `field:to` | Nach-Ort | `datatype: string` |
| `field:remark` | Bemerkung | `datatype: string` |
| `from_hidden` | Von-Feld ausblenden | `datatype: boolean`, `value: true/false` |
| `to_hidden` | Nach-Feld ausblenden | `datatype: boolean`, `value: true/false` |
| `from_location_mode` | Von-Autofill | `datatype: enum`, `options: fix,previous,next` |
| `to_location_mode` | Nach-Autofill | `datatype: enum`, `options: fix,previous,next` |
| `color` | Balkenfarbe | `datatype: color`, `value: #1976d2` |
| `draw_as` | Zeichenstil im Gantt | `datatype: enum`, `options: ...` |
| `layer_group` | Zuordnung zu Layer-Gruppe | `datatype: enum`, `options: <ids>` |
| `is_break` | Pause | `datatype: boolean`, `value: true` |
| `is_short_break` | Kurzpause | `datatype: boolean`, `value: true` |
| `is_service_start` | Dienstanfang | `datatype: boolean`, `value: true` |
| `is_service_end` | Dienstende | `datatype: boolean`, `value: true` |
| `is_within_service` | Einordnung in Dienst | `datatype: enum`, `options: yes,no,both` |
| `is_absence` | Abwesenheit | `datatype: boolean`, `value: true` |
| `is_reserve` | Reserve | `datatype: boolean`, `value: true` |
| `consider_capacity_conflicts` | Kapazitaetskonflikte | `datatype: boolean`, `value: true` |
| `consider_location_conflicts` | Ortskonflikte | `datatype: boolean`, `value: true` |

### Darstellung im Gantt

Der Gantt-Renderer wertet Attribute aus, um Darstellung und Ebenen zu steuern:

- **Farbe**: `color` (alternativ `bar_color`, `display_color`, `main_color`).
- **Zeichenstil**: `draw_as` mit Optionen:
  - `line-above`, `line-below` (Linie oberhalb/unterhalb)
  - `shift-up`, `shift-down` (vertikale Verschiebung)
  - `dot`, `square`, `triangle-up`, `triangle-down` (Markerformen)
  - `thick` (dicker Balken)
  - `background` (Hintergrundfuellung)
- **Layer**: `layer_group` bestimmt die visuelle Ebene (z-Index ueber die Layer-Reihenfolge).

### Ortslogik (Von/Nach)

Die Felder `from_hidden`, `to_hidden`, `from_location_mode`, `to_location_mode` steuern,
wie Start-/Zielorte vorgeschlagen oder ausgeblendet werden:

- **fix**: Ort bleibt manuell (keine automatische Vervollstaendigung)
- **previous**: Ort wird aus der vorherigen Leistung uebernommen
- **next**: Ort wird aus der naechsten Leistung uebernommen
- **Ortsunveraenderlich** (Praxisregel): `from_location_mode=previous`, `to_location_mode=previous`, `to_hidden=true`

### Relevanz & Dauer

- `relevant_for` (Attribut mit `meta.value` als kommagetrennte Liste) kann die Ressourcenauswahl
  fuer eine Activity einschränken.
- `default_duration` (Attribut mit `meta.value`) kann die Standarddauer ueberschreiben.

### Validierung & IDs

- IDs werden automatisch **slugifiziert** (nur a-z, 0-9, Bindestriche).
- `id`, `label` und `activityType` sind Pflichtangaben.
- Fehlende Referenzen (z. B. Activity-Type geloescht) fuehren zu „toten“ Katalogeintraegen.

## Praxisbeispiele

- **Neue Pause mit eigener Farbe**
  - Template: `label=Pause 45`, `activityType=break`, `defaultDurationMinutes=45`
  - Attribute: Preset `color` auf `#ffb74d` setzen.
- **Activity mit Marker-Ebene**
  - Activity: `draw_as=triangle-up`, `layer_group=marker`.
- **Spezialisierte Service-Activity**
  - Activity: `relevant_for=personnel-service,vehicle-service`
  - `default_duration=30` fuer schnelle An-/Abfahrtsaufgaben.

## Fehlerbilder & Loesungen

- **Activity taucht nicht im Board auf**
  - Pruefen: `activityType` existiert? `relevant_for` passt zur Ressource?
- **Gantt-Stil wird nicht angewandt**
  - Pruefen: `draw_as` exakt gesetzt? `layer_group` existiert?
- **Farbe fehlt**
  - Pruefen: `color` oder `bar_color` gesetzt?
- **Dauer ignoriert**
  - Pruefen: `default_duration`-Attribut in Minuten vorhanden?

## Kontext-FAQ

- **Wo kommt `layer_group` her?**
  - Aus den Layer-Gruppen unter Einstellungen.
- **Warum sehe ich zwei Dauerwerte?**
  - `defaultDurationMinutes` und `default_duration` koennen parallel existieren; `default_duration` hat Vorrang.
- **Wie uebersetze ich Labels?**
  - Uebersetzungen verwenden `activityType:<id>` fuer Typ-Labels.

## Abhaengigkeiten & Fluss

- Activity-Katalog → Planungsboard → Gantt-Renderer
- Layer-Gruppen → Attribut `layer_group` → Gantt-Z-Order

## Wo wirken die Einstellungen?

- **Planung / Board**: Activities steuern Auswahl, Quick-Buttons und Standarddauer beim Anlegen.
- **Gantt/Timeline**: Attribute wie `draw_as`, `layer_group` und `color` beeinflussen Darstellung und Ebene.
- **Uebersetzungen**: Activity-Types werden ueber `activityType:<id>` uebersetzt.
