# Planung · Betriebsplanung (Gantt)

Diese Seite beschreibt die Betriebsplanung mit dem Gantt in CorePlanX.

## Wo finde ich das?

Navigation:

- **Planung → Betriebsplanung**
- Gantt im aktuellen Jahr oeffnen

## Aktivitaeten erstellen

So erstellst du einen Dienst direkt im Gantt:

1. Unter **Fahrzeugdienste** oder **Personaldienste** einen Pool aufklappen.
2. Auf einer Ressource an einem beliebigen Tag **linksklicken**.
3. Der Dialog zum Erstellen der Aktivitaeten oeffnet sich.
4. Beispiel-Workflow: **Dienstanfang → Leistung → Pause → Leistung → Dienstende**.

## Voraussetzungen

- Im **Activity-Editor** muessen **Activity-Definitionen** vorhanden sein; sonst oeffnet sich kein Erstell-Dialog.
- Die Gantt-Ressourcen kommen aus den Stammdaten:
  - **Fahrzeugdienste** aus **Stammdaten → Fahrzeuge → Fahrzeugdienstpools / Fahrzeugdienste**
  - **Personaldienste** aus **Stammdaten → Personal → Dienstpools / Dienste**

## Hinweise

- Der Dialog muss bei Linksklick erscheinen.
- Bei Fehlern wird eine Meldung angezeigt (kein UI-Haengen).

## Fehlerbilder & Loesungen

- **Dialog oeffnet nicht**
  - Pruefen: Im **Activity-Editor** existieren Activity-Definitionen?
  - Loesung: „Werkseinstellungen“ im Activity-Editor nutzen (setzt Default-Katalog).
  - Pruefen: `relevantFor` passt zur Ressource (`personnel-service` oder `vehicle-service`).
- **Keine Ressourcen im Gantt sichtbar**
  - Pruefen: Dienstpools + Dienste in den Stammdaten vorhanden?
  - Loesung: Stammdaten anlegen und Gantt neu laden.
