# Stammdaten · Personal

Diese Seite beschreibt die Personal-Stammdaten in CorePlanX und wie sie in der UI gepflegt werden.
Sie ist so geschrieben, dass der CorePlanX Assistant sie als Referenz nutzen kann.

## Wo finde ich das?

Navigation:

- **Stammdaten → Personal**
- Im Personal-Bereich gibt es oben einen Umschalter (Toggle), mit dem du zwischen den Unteransichten wechselst:
  - **Dienstpools**
  - **Dienste**
  - **Personalpools**
  - **Heimdepots**
  - **Personal**
  - **System** (System-Pools fuer geloeschte Eintraege)

## Überblick

CorePlanX trennt die Stammdaten bewusst in „Sammlungen“ (Pools) und „Ressourcen“ (konkrete Services/Personen).
Im Personal-Bereich sind die relevanten Entitaeten:

- **Dienstpool** (`PersonnelServicePool`) gruppiert Personaldienste.
- **Dienst** (`PersonnelService`) beschreibt eine konkrete Dienstart (z. B. Frueh-/Spaetdienst).
- **Personalpool** (`PersonnelPool`) gruppiert Mitarbeitende.
- **Heimdepot** (`HomeDepot`) referenziert Personnel Sites aus der Topologie.
- **Personal** (`Personnel`) ist eine konkrete Person mit Qualifikationen.

## Dienstpools

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Anzeigename | ja |
| `description` | string | Beschreibung | nein |
| `homeDepotId` | string | Referenz auf Heimdepot | nein |
| `shiftCoordinator` | string | Schichtkoordination | nein |
| `contactEmail` | string | Kontakt | nein |

### Regeln & Validierung

- `name` darf nicht leer sein.
- Beim Loeschen werden zugeordnete Dienste entkoppelt (Pool-ID wird entfernt).

## Dienste

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Dienstname | ja |
| `description` | string | Beschreibung | nein |
| `poolId` | string | Zugehoeriger Dienstpool | nein |
| `startTime` | time | Startzeit | nein |
| `endTime` | time | Endzeit | nein |
| `isNightService` | boolean | Nachtleistung | nein |
| `requiredQualifications` | string | Qualifikationen (kommagetrennt) | nein |
| `maxDailyInstances` | number | Anzahl Einsaetze pro Tag | nein |
| `maxResourcesPerInstance` | number | Ressourcen pro Einsatz | nein |

### Regeln & Validierung

- `name` ist Pflicht.
- Dienste ohne Pool erscheinen in der Gruppe **Ohne Pool**.

## Personalpools

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Poolname | ja |
| `description` | string | Beschreibung | nein |
| `homeDepotId` | string | Referenz auf Heimdepot | nein |
| `locationCode` | string | Standortcode | nein |

### Regeln & Validierung

- `name` ist Pflicht.
- Beim Loeschen werden zugeordnete Personen entkoppelt.

## Heimdepots

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `name` | string | Heimdepot-Name | ja |
| `description` | string | Beschreibung | nein |
| `siteIds` | string | Start/Endstellen (Personnel Sites) | ja |
| `breakSiteIds` | string | Pausenraeume | nein |
| `shortBreakSiteIds` | string | Kurzpausenraeume | nein |
| `overnightSiteIds` | string | Uebernachtung | nein |

### Regeln & Validierung

- `siteIds` muessen gueltige Personnel Site IDs enthalten.
- Heimdepots verwenden **Topologie → Personnel Sites** als Quelle.

## Personal

### Feldlexikon

| Feld | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `firstName` | string | Vorname | ja |
| `lastName` | string | Nachname | ja |
| `preferredName` | string | Rufname | nein |
| `qualifications` | string | Qualifikationen (kommagetrennt) | nein |
| `serviceIds` | string | Dienste (kommagetrennt) | nein |
| `poolId` | string | Personalpool | ja |
| `homeStation` | string | Heimatbahnhof | nein |
| `availabilityStatus` | string | Status | nein |
| `qualificationExpires` | date | Qualifikation gueltig bis | nein |
| `isReserve` | boolean | Reserve | nein |

### Regeln & Validierung

- Vor- und Nachname sind Pflicht.
- `poolId` muss auf einen bestehenden Personalpool zeigen.

## System (geloeschte Ressourcen)

- Es gibt System-Pools fuer geloeschte **Dienste** und **Personal**.
- Eintraege lassen sich per Drag & Drop wieder einem normalen Pool zuordnen.
- System-Pools sind getrennt vom normalen Pool-Listing.

## Praxisbeispiele

- **Personaldienstpool Olten anlegen**
  - Dienstpool mit `name=Olten` erstellen.
  - Danach 10 Dienste (z. B. „Fruehdienst 100–104“, „Spaetdienst 105–109“) im Pool anlegen.
- **Personalpool „Team Olten“ mit Mitarbeitenden**
  - Personalpool erstellen, dann Personal mit `poolId=Team Olten` anlegen.
- **Heimdepot Olten mit Pausenorten**
  - Personnel Sites in der Topologie pflegen und im Heimdepot referenzieren.

## Fehlerbilder & Loesungen

- **Speichern nicht moeglich**
  - Pruefen: Pflichtfelder gesetzt? Pool-IDs gueltig?
- **Dienst/Person erscheint unter „Ohne Pool“**
  - `poolId` fehlt oder zeigt auf einen geloeschten Pool.
- **Heimdepot kann nicht gespeichert werden**
  - `siteIds` fehlen oder verweisen auf nicht existierende Personnel Sites.

## Kontext-FAQ

- **Wie finde ich die richtige Pool-ID?**
  - In der Pool-Liste den Eintrag oeffnen, ID wird im Formular angezeigt.
- **Warum sehe ich geloeschte Eintraege?**
  - Im System-Tab koennen geloeschte Ressourcen wiederhergestellt werden.

## Abhaengigkeiten & Fluss

- Topologie (Personnel Sites) → Heimdepots
- Heimdepots → Dienstpools / Personalpools
- Dienstpools → Dienste
- Personalpools → Personal
- Personal/Dienste → Planung (Ressourcenverwendung)

## Datenquellen & Persistenz (technisch)

CorePlanX pflegt Personal-Stammdaten ueber den **Ressourcen-Snapshot**:

- Laden: Backend liefert `personnelServicePools`, `personnelPools`, `homeDepots`, `personnelServices`, `personnel`.
- Speichern: Aenderungen werden als kompletter Snapshot zurueckgeschrieben (replace).
- Reset: Backend liefert Beispielwerte fuer „personnel“.

## Werkseinstellungen (Reset)

In der UI gibt es den Button **„Werkseinstellungen“**.
Dieser setzt die Personal-Stammdaten auf Beispielwerte zurueck (Scope „personnel“).
