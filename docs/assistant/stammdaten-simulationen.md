# Stammdaten · Simulationen

Diese Seite beschreibt Simulationen (Varianten) in CorePlanX und wie du sie in der Stammdaten-UI verwaltest.

## Wo finde ich das?

- **Stammdaten → Simulationen**

## Zweck

Simulationen sind Varianten innerhalb eines Fahrplanjahres.
Sie erlauben es, Planungen zu testen/zu verändern, ohne produktive Daten zu überschreiben.

## Felder (Basisfelder)

Ein Simulationseintrag enthält:

- `label` (Pflicht) – Titel der Simulation
- `timetableYearLabel` (Pflicht) – zugehöriges Fahrplanjahr (z. B. `2030/31`)
- `description` (optional)

## Regeln & Validierung

- Ohne Titel (`label`) ist Speichern nicht möglich.
- Ohne Fahrplanjahr (`timetableYearLabel`) ist Speichern nicht möglich.
- **Fahrplanjahr kann nach dem Anlegen nicht geändert werden.**
  - Wenn sich das Fahrplanjahr ändern soll, muss eine neue Simulation angelegt werden.

## Produktive Variante vs. Simulation

CorePlanX unterscheidet:

- **productive**: produktive Variante (wird i. d. R. systemseitig pro Fahrplanjahr geführt)
- **simulation**: nicht-produktive Variante, die du in der UI anlegst/änderst/löschst

In der Stammdaten-UI werden typischerweise **nur nicht-produktive Simulationen** bearbeitet.

## Datenquellen & Persistenz (technisch)

Simulationen werden über das Backend geladen und verwaltet:

- Liste: `GET /timetable-years/variants`
- Create/Update/Delete: entsprechende Variant-Endpunkte

Hinweis für den Assistant:

- Wenn Simulationen „verschwinden“, zuerst prüfen ob ein Fahrplanjahr-Filter aktiv ist oder ob Backend-Loading/Error vorliegt.

## Typische Aufgaben (Beispiele)

- „Neue Simulation für 2026/27“ → Simulation anlegen, Fahrplanjahr setzen.
- „Fahrplanjahr einer Simulation ändern“ → Nicht möglich → neue Simulation anlegen.

