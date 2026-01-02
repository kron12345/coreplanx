# Einstellungen · Attribut-Editor

Diese Seite beschreibt den Attribut-Editor unter Einstellungen und ist als Referenz fuer den CorePlanX Assistant gedacht.

## Wo finde ich das?

Navigation:

- **Einstellungen → Attribut-Editor**

## Ueberblick

Der Attribut-Editor verwaltet zusaetzliche (Custom) Attribute fuer Stammdaten-Objekte.
Damit lassen sich Felder ergaenzen, die in den Standardformularen nicht vorhanden sind.
Die Definitionen bestehen aus Label, technischem Schluessel, Datentyp sowie Flags fuer Pflichtfeld und Zeitabhaengigkeit.
Die Aenderungen sind aktuell **nur im Frontend-Status** und werden beim Reload aus Defaults geladen.

## Attribut-Editor

### Wie funktioniert es?

- Zuerst den **Bereich** waehlen (z. B. Personaldienstpools, Fahrzeuge, Topologie-Eintraege).
- Bestehende Attribute erscheinen als Karten und koennen bearbeitet oder geloescht werden.
- Neue Attribute werden ueber das Formular am Seitenende angelegt.

### Bereiche (Targets)

Diese Bereiche sind vordefiniert:

- Personal
  - Personaldienstpools
  - Personaldienste
  - Personalpools
  - Mitarbeitende
- Fahrzeuge
  - Fahrzeugdienstpools
  - Fahrzeugdienste
  - Fahrzeugpools
  - Fahrzeuge
  - Fahrzeugtypen
  - Fahrzeugkompositionen
- Topologie
  - Betriebsstellen (Operational Points)
  - Streckenabschnitte (Sections of Line)
  - Personaleinsatzstellen (Personnel Sites)
  - Ersatzhaltestellen (Replacement Stops)
  - Ersatzlinien (Replacement Routes)
  - Ersatzkanten (Replacement Edges)
  - OP↔SEV-Verknuepfungen
  - Transferkanten

### Feldlexikon

| Feld | Typ | Zweck | Hinweise |
| --- | --- | --- | --- |
| `label` | string | Anzeigename | Pflichtfeld |
| `key` | string | Technischer Schluessel | slugifiziert, eindeutig |
| `type` | string | Datentyp | `string`, `number`, `boolean`, `date`, `time` |
| `description` | string | Beschreibung | optional |
| `temporal` | boolean | Zeitabhaengig | Historie/Geltung | 
| `required` | boolean | Pflichtfeld | verhindert Speichern ohne Wert |

### Technischer Schluessel (Key)

- Der Key wird **slugifiziert** (a-z, 0-9, Bindestriche).
- Keys werden pro Bereich eindeutig gehalten; bei Kollisionen wird automatisch ein Suffix vergeben.
- Der Key ist der Feldname in den Datenstrukturen.

### Datentypen

Unterstuetzte Typen:

- `string` (Text)
- `number` (Zahl)
- `boolean` (Ja/Nein)
- `date` (Datum)
- `time` (Zeit)

### Flags

- **Zeitabhaengig**: das Attribut fuehrt eine Historie mit Gueltigkeiten (z. B. gueltig ab/bis).
- **Pflichtfeld**: verhindert das Speichern im Editor, wenn der Wert fehlt.

## Praxisbeispiele

- **Personalpool um Standortcode ergaenzen**
  - Target: Personalpools
  - Key: `standort-code`, Type: `string`, Required: true
- **Fahrzeuge mit WLAN markieren**
  - Target: Fahrzeuge
  - Key: `has-wifi`, Type: `boolean`
- **Topologie: Ersatzhalt mit Shelter-Info**
  - Target: Ersatzhaltestellen
  - Key: `shelter`, Type: `string`, Temporal: true

## Fehlerbilder & Loesungen

- **Speichern nicht moeglich**
  - Pflichtfelder oder invalides Key-Format pruefen.
- **Attribut taucht im Editor nicht auf**
  - Target korrekt gewaehlt? Custom-Attribute in Stammdaten anzeigen?
- **Key doppelt**
  - System erzeugt automatisch Suffix, ggf. manuell umbenennen.

## Kontext-FAQ

- **Warum sind Aenderungen nach Reload weg?**
  - Custom-Attribute liegen derzeit nur lokal im Frontend-State.
- **Kann ich Custom-Attribute exportieren?**
  - Derzeit nicht direkt; spaeter Persistenz geplant.

## Abhaengigkeiten & Fluss

- Attribut-Editor → Custom-Attribute-Store → Stammdaten-Editoren

## Wo wirken die Einstellungen?

- Die Attribute erscheinen in den jeweiligen **Stammdaten-Editoren** als zusaetzliche Felder.
- Pflichtfelder blockieren das Speichern im UI.
- Zeitabhaengige Attribute werden in den Formularen als gueltigkeitsbasierte Felder behandelt.
