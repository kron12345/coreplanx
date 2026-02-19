# Acceptance Test: Fahrplanmanagement Hub Baseline

## Related Spec
- `/specs/fahrplanmanagement-hub-baseline.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9)

## Preconditions
- Timetable manager is populated with multiple train records/variants.
- Timetable-year master data is available.
- TTT sync dialog is enabled.

## Steps
1. Öffne den Fahrplanmanager und prüfe Gruppierung nach RefTrainID-Root.
2. Klappe eine Gruppe auf und prüfe Varianteneinträge, dann Aggregatansicht.
3. Setze Jahrfilter + Suchbegriff und prüfe die Treffer.
4. Wähle einen Eintrag und prüfe Detailkarten (Kalender, Technik, Strecke, Halteattribute).
5. Nutze die primäre Erstellen-Aktion in der Toolbar und prüfe, dass der Vollseiten-Fahrplan-Editor mit neuem TrainPlan geöffnet wird.
6. Wechsle per „Zurück“/„Übernehmen“ zurück und prüfe, dass der Rücksprung in den Fahrplanmanager erfolgt.
7. Erstelle eine Variante zu einem bestehenden Eintrag und prüfe Fokus + Suchkontext.
8. Öffne den TTT-Sync-Dialog, exportiere Payload und importiere ein gültiges Payload.
9. Prüfe über API oder Tools, dass Snapshot-/Revision-/Service-Part-Endpunkte funktionieren.
10. Wähle einen konkreten Zug (nicht Aggregat), starte „Bestellfall eröffnen“, ergänze EVU-ID(s) und prüfe den Wechsel ins Bestell-Cockpit.

## Expected Results
- Gruppierung/Variantenansicht verhalten sich wie definiert (R1).
- Jahr- und Suchfilter arbeiten deterministisch auf den spezifizierten Feldern (R2).
- Detailbereich zeigt die erwarteten Attributblöcke (R3).
- Neue Varianten bleiben fokussiert für direkte Weiterarbeit (R4).
- Kalender-/Jahresauflösung bleibt konsistent (R5).
- TTT Sync Import/Export funktioniert inkl. Audit-Notiz (R6).
- Snapshot-/Revision-/Service-Part-Funktionen sind stabil nutzbar (R7).
- Der direkte Zug-zu-Bestellfall-Flow ist aus dem Detailheader verfügbar, öffnet den Dialog ohne Laufzeitfehler und übergibt den selektierten Zugkontext korrekt (R8).
- Die primäre Toolbar-Erstellen-Aktion nutzt den geteilten Vollseiten-Fahrplan-Editor und erzeugt dafür einen neuen TrainPlan mit Rücksprung in den Fahrplanmanager (R9).
