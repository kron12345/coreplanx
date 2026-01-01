# Stammdaten · Fahrplanjahre

Diese Seite beschreibt, wie CorePlanX Fahrplanjahre verwaltet und wie du sie in der Stammdaten-UI pflegst.

## Wo finde ich das?

- **Stammdaten → Fahrplanjahre**

## Zweck

Fahrplanjahre sind der fachliche Rahmen, in dem weitere Daten (z. B. Simulationen/Varianten) strukturiert werden.
Viele Auswahldialoge und Import-/Planungsfunktionen benötigen ein gültiges Fahrplanjahr.

## UI: Editor

Die Stammdaten-UI zeigt eine Liste von Fahrplanjahren und erlaubt:

- Anlegen
- Bearbeiten
- Löschen

## Felder (Basisfelder)

Ein Fahrplanjahr ist als Record modelliert und enthält mindestens:

- `label` (Pflicht) – z. B. `2025/26`
- `startIso` (Pflicht) – Beginn (inkl.) als `YYYY-MM-DD`
- `endIso` (Pflicht) – Ende (inkl.) als `YYYY-MM-DD`
- `description` (optional)

Validierungslogik:

- `label` darf nicht leer sein.
- `startIso` ist erforderlich.
- Wenn `endIso` leer ist, wird es auf `startIso` gesetzt.
- Wenn `endIso < startIso`, wird `endIso` auf `startIso` korrigiert.

## Defaults / Komfortfunktionen

Beim Erstellen eines neuen Fahrplanjahres werden Vorschläge generiert:

- Standardmäßig wird das nächste Jahr hinter dem letzten bekannten Jahr vorgeschlagen.

## Datenquellen & Persistenz (technisch)

CorePlanX nutzt zwei Ebenen:

1) **User-managed Liste (UI/LocalStorage)**
   - Die Stammdaten-UI pflegt eine Liste verwalteter Fahrplanjahre.
2) **Backend-Sync**
   - Die UI synchronisiert Fahrplanjahre/Varianten zusätzlich mit dem Backend.

Hinweis für den Assistant:

- Beim Support ist wichtig zu unterscheiden, ob ein Fahrplanjahr „nur lokal“ existiert oder bereits im Backend synchronisiert wurde.

## Typische Aufgaben (Beispiele)

- „Neues Fahrplanjahr 2026/27 anlegen“ → Label + Start/Ende setzen.
- „Fehler: Zeitraum überschreitet Fahrplanjahr“ → Range prüfen und ggf. in zwei Fahrplanjahre splitten.

