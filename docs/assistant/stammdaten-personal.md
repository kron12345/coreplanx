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

## Überblick: Datenmodell & Begriffe

CorePlanX trennt die Stammdaten bewusst in „Sammlungen“ (Pools/Typen/Compositions) und „Ressourcen“ (konkrete Services/Personen).
Im Personal-Bereich sind die relevanten Entitäten:

- **Dienstpool** (`PersonnelServicePool`)
  - Gruppiert „Dienste“ (z. B. Schichten/Leistungsarten) für Personal.
  - Optional an ein **Heimdepot** gekoppelt.
- **Dienst** (`PersonnelService`)
  - Ein konkreter Dienst/Service (z. B. Frühschicht, bestimmte Qualifikation etc.).
  - Kann einem Dienstpool zugeordnet werden.
- **Personalpool** (`PersonnelPool`)
  - Gruppiert Mitarbeitende (Personal).
  - Optional an ein **Heimdepot** gekoppelt.
- **Heimdepot** (`HomeDepot`)
  - Beschreibt Start-/Endorte und Pausen-/Übernachtungsorte (i. d. R. verknüpft über „Personnel Sites“ aus der Topologie).
- **Personal** (`Personnel`)
  - Konkrete Person inkl. Qualifikationen und Zuordnung zu Personalpool und (optional) Diensten.

## Dienstpools

Zweck:

- Dienstpools sind eine organisatorische Ebene, um viele Dienste sinnvoll zu bündeln.
- In der UI ist der Dienstpool ein Einstiegspunkt, um nachgelagerte Einträge (Dienste) konsistent zu pflegen.

Wichtige Felder (Basisfelder, erweiterbar durch Custom Attributes):

- `name` (Pflicht)
- `description` (optional)
- `homeDepotId` (optional)

Hinweise zur Konsistenz:

- Beim Löschen von Dienstpools werden zugeordnete Dienste in CorePlanX automatisch „entkoppelt“ (Pool-Zuordnung wird entfernt), damit keine ungültigen Referenzen bleiben.

## Dienste

Zweck:

- Ein Dienst beschreibt ein planungsrelevantes Angebot/Profil (z. B. Dienstzeitfenster, Nachtleistung, Qualifikationsanforderungen).

Wichtige Felder (Basisfelder, erweiterbar durch Custom Attributes):

- `name` (Pflicht)
- `description` (optional)
- `poolId` (optional, Zuordnung zum Dienstpool)
- `startTime`, `endTime` (optional)
- `isNightService` (optional)
- `requiredQualifications` (optional, Liste)
- `maxDailyInstances`, `maxResourcesPerInstance` (optional)

Gruppierung in der UI:

- Dienste können in der UI nach Dienstpool gruppiert angezeigt werden.
- Einträge ohne Pool werden i. d. R. in einer Gruppe „Ohne Pool“ geführt.

## Personalpools

Zweck:

- Personalpools bündeln Mitarbeitende (z. B. Standort-/Team-Zuordnung).

Wichtige Felder (Basisfelder, erweiterbar durch Custom Attributes):

- `name` (Pflicht)
- `description` (optional)
- `homeDepotId` (optional)
- `locationCode` (optional)

Hinweise zur Konsistenz:

- Wenn Personalpools gelöscht werden, kann zugeordnetes Personal „entkoppelt“ werden, damit keine ungültigen Pool-Referenzen bleiben.

## Heimdepots

Zweck:

- Heimdepots referenzieren Orte, die für Start/Ende, Pausen und Übernachtung relevant sind.
- Die Orte kommen typischerweise aus der **Topologie** („Personnel Sites“).

Wichtige Felder (Basisfelder, erweiterbar durch Custom Attributes):

- `name` (Pflicht)
- `description` (optional)
- `siteIds` (Pflicht; Start/Endstellen – „Personnel Sites“)
- `breakSiteIds` (optional; Pausenräume)
- `shortBreakSiteIds` (optional; Kurzpausen)
- `overnightSiteIds` (optional; Übernachtung)

## Personal

Zweck:

- Konkrete Mitarbeitende, die in der Planung als Ressourcen genutzt werden.

Wichtige Felder (Basisfelder, erweiterbar durch Custom Attributes):

- `firstName`, `lastName` (Pflicht)
- `preferredName` (optional)
- `poolId` (Pflicht; Zuordnung zu Personalpool)
- `serviceIds` (optional; Dienste, die diese Person grundsätzlich fahren/ausführen kann)
- `qualifications` (optional; Liste)
- `homeStation`, `availabilityStatus`, `qualificationExpires`, `isReserve` (optional)

Validierung:

- Ohne Vor- und Nachname kann kein Personal gespeichert werden.
- Ohne gültigen Personalpool (`poolId`) kann kein Personal gespeichert werden.

## Werkseinstellungen (Reset)

In der UI gibt es einen Button **„Werkseinstellungen“**.
Dieser setzt die Personal-Stammdaten auf Beispielwerte zurück (Scope „personnel“ im Ressourcen-Snapshot).

## Datenquellen & Persistenz (technisch)

CorePlanX pflegt Personal-Stammdaten über den **Ressourcen-Snapshot**:

- Laden: Backend liefert einen Snapshot mit u. a. `personnelServicePools`, `personnelPools`, `homeDepots`, `personnelServices`, `personnel`.
- Speichern: Änderungen werden als kompletter Snapshot zurückgeschrieben (replace).
- Reset: Backend kann Beispielwerte für „personnel“ liefern.

Wichtig für den Assistant:

- „Was ist aktuell sichtbar?“ kann über eine **kompakte Daten-Zusammenfassung** (Count + Beispiele) als UI-Kontext an das LLM geliefert werden.

## Typische Aufgaben (Beispiele)

- „Ich will einen neuen Dienstpool für Team Berlin anlegen“ → In **Dienstpools** einen Eintrag mit `name` anlegen.
- „Ein Dienst soll zu einem Pool gehören“ → In **Dienste** `poolId` setzen.
- „Personal ist nicht speicherbar“ → Prüfen: Vor-/Nachname + gültiger Personalpool gesetzt?

