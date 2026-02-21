# Spec: Stammdaten Fahrzeuge (Fahrtyp + Werkseinstellungen)

## Overview
- Problem/goal: Fahrzeugtypen brauchen ein explizites Feld fuer den Fahrtyp (`Triebfahrzeug` oder `Wagen`), damit Formationsaufbau und Zuordnung in Fahrplanmanagement eindeutig funktionieren.
- Non-goals: Keine neue betriebliche Fahrzeugdisposition; keine automatische Formationsoptimierung.
- Stakeholders: Fachbereich Auftragsmanagement, Fahrplanmanagement, Stammdatenpflege.

## Rules
- R1: `VehicleType` muss ein explizites Feld `formationServiceType` haben. Zulaessige Werte sind `tractive_unit` (Triebfahrzeug) und `wagon` (Wagen).
- R2: Das Feld `formationServiceType` muss im gesamten Ressourcen-Snapshot durchgaengig gespeichert und geladen werden (Frontend-Modelle, Backend-API, Persistenz/DB, Werkseinstellungen-Reset).
- R3: In `Stammdaten -> Fahrzeuge -> Fahrzeugtypen` muss `formationServiceType` als waehlbares Feld `Fahrtyp` sichtbar sein (Dropdown: `Triebfahrzeug`, `Wagen`).
- R4: Fahrplaneditor-Formationsaufbau muss Fahrzeugtypen primaer ueber `formationServiceType` filtern. Die bisherige Kategorie-Mappinglogik bleibt nur als Legacy-Fallback fuer bestehende Alt-Daten ohne `formationServiceType`.
- R5: Werkseinstellungen fuer Fahrzeuge muessen mindestens folgende Fahrzeugtypen liefern:
  - 1-2 Loktypen (`Triebfahrzeug`)
  - 2-3 Triebzugtypen (`Triebfahrzeug`)
  - 3 Wagentypen (`Wagen`)
- R6: Werkseinstellungen fuer Fahrzeugkompositionen muessen mindestens enthalten:
  - eine Lok+Wagenzug-Formation
  - eine Triebzug-Formation mit mehreren Triebzugarten
  - eine Triebzug-Doppeltraktions-Formation

## Behavior
- Inputs:
  - Fahrzeugtyp-Pflege in Stammdaten
  - Werkseinstellungen-Reset fuer Fahrzeug-Scope
  - Fahrplaneditor Formation Builder
- Outputs:
  - Persistierte Fahrzeugtypen mit explizitem Fahrtyp
  - Nutzbare Beispiel-Fahrzeugtypen und -Formationen nach Reset
  - Eindeutige Filterung im Formation Builder ohne implizite Kategorie-Annahme
- Edge cases:
  - Alt-Datensaetze ohne `formationServiceType` bleiben nutzbar ueber Kategorie-Fallback.
  - Ungueltige Fahrtyp-Werte werden nicht als gueltige Zuordnung interpretiert.

## Acceptance Criteria
- AC1: In Fahrzeugtypen ist ein Feld `Fahrtyp` vorhanden und speicherbar (`Triebfahrzeug`/`Wagen`).
- AC2: Nach Reload bleiben gespeicherte Fahrtyp-Werte erhalten.
- AC3: Nach `Werkseinstellungen` sind die geforderten Mindestmengen an Lok-/Triebzug-/Wagentypen vorhanden.
- AC4: Nach `Werkseinstellungen` sind die geforderten drei Formationsarten vorhanden (Lok+Wagen, Multi-Triebzug, Doppeltraktion).
- AC5: Im Fahrplaneditor werden Fahrzeuge im Formation Builder anhand von `formationServiceType` gefiltert.
- AC6: Bei Fahrzeugtypen ohne `formationServiceType` greift Legacy-Fallback ueber Kategorie, damit bestehende Alt-Daten weiterhin zugeordnet werden.

## Notes
- Dependencies: Ressourcen-Snapshot (`vehicleTypes`, `vehicleCompositions`), Fahrzeug-Stammdateneditor, Fahrplaneditor Formation Builder.
- Migration: DB erweitert `vehicle_type` um `formation_service_type`; Bestandsdaten bleiben gueltig (nullable).
