# Stammdaten · Fahrplanjahre

Diese Seite beschreibt die Fahrplanjahre in CorePlanX und die Pflege in der Stammdaten-UI.
Sie ist als Referenz fuer den CorePlanX Assistant gedacht.

## Wo finde ich das?

Navigation:

- **Stammdaten → Fahrplanjahre**

## Überblick

Fahrplanjahre definieren den zeitlichen Rahmen fuer Planung und Varianten.
Sie werden u. a. verwendet fuer:

- **Simulationen/Varianten** (jede Simulation gehoert zu einem Fahrplanjahr)
- **Validierungen** bei Importen (Fahrtage muessen in einem Fahrplanjahr liegen)
- **Filter/Defaults** in Planungs- und Auswahl-Dialogen

## Fahrplanjahre

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `label` | string | Bezeichnung, z. B. `2026/27` | ja |
| `startIso` | date | Beginn (inkl.) im Format `YYYY-MM-DD` | ja |
| `endIso` | date | Ende (inkl.) im Format `YYYY-MM-DD` | ja |
| `description` | string | Freitext | nein |

### Regeln & Validierung

- `label` darf nicht leer sein.
- `startIso` ist Pflicht.
- `endIso` wird auf `startIso` gesetzt, wenn es fehlt.
- Wenn `endIso` vor `startIso` liegt, wird `endIso` auf `startIso` korrigiert.
- Ungueltige Datumsformate werden als leer behandelt und blockieren das Speichern.

### Defaults & Vorschlaege

- Beim Anlegen wird ein Vorschlag aus dem zuletzt bekannten Fahrplanjahr abgeleitet.
- Der Standard orientiert sich am Fahrplanwechsel im Dezember:
  - Start = erster Sonntag ab dem 10.12.
  - Ende = Tag vor dem naechsten Fahrplanjahr.

### Technische IDs

- Datensaetze haben eine technische `id` (z. B. `ty-202627`).
- Die `id` wird automatisch erzeugt; die fachliche Referenz ist das `label`.

## Praxisbeispiele

- **Neues Fahrplanjahr 2026/27**
  - `label=2026/27`, `startIso=2026-12-13`, `endIso=2027-12-11`.
- **Korrektur eines Jahres**
  - `endIso` versehentlich vor `startIso` gesetzt → System korrigiert auf `startIso`.
- **Eintrag fuer interne Tests**
  - `label=Testjahr`, `startIso=2025-01-01`, `endIso=2025-12-31`, `description=QA`.

## Fehlerbilder & Loesungen

- **"Label darf nicht leer sein."**
  - `label` setzen (z. B. `2027/28`).
- **"Beginn ist erforderlich."**
  - `startIso` setzen (ISO-Format).
- **Jahr wird nicht gespeichert**
  - Pruefen: Datum im Format `YYYY-MM-DD`? `endIso` nach `startIso`?

## Kontext-FAQ

- **Warum taucht ein Fahrplanjahr nicht im Backend auf?**
  - Nach dem Speichern erfolgt eine Backend-Synchronisation. Bei Fehlern im Netzwerk oder Backend kann der Sync fehlen.
- **Warum stimmen Start/Ende nicht mit dem Label ueberein?**
  - Das Label ist frei. Die gueltige Zeitspanne kommt aus `startIso`/`endIso`.

## Abhaengigkeiten & Fluss

- Fahrplanjahre → Simulationen/Varianten
- Fahrplanjahre → Import-/Validierungslogik (Fahrtage/Zeitraeume)
- Fahrplanjahre → Default-Auswahl in der Planung

## Datenquellen & Persistenz (technisch)

- **UI-Verwaltung:** lokale Liste (LocalStorage `coreplanx:timetable-years:v1`).
- **Backend-Sync:** Labels werden mit dem Backend abgeglichen:
  - `GET /timetable-years`
  - `POST /timetable-years` (neu)
  - `DELETE /timetable-years?label=...` (entfernen)
- **Refresh-Logik:** Backend-Labels koennen die lokale Liste beim Laden ersetzen/erganzen.
