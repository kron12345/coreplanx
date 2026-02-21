# Acceptance Test: Fahrplanmanagement Generic TTT Ordering

## Related Spec
- `/specs/fahrplanmanagement-generic-ordering.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16)

## Preconditions
- FM ordering engine with at least one configured process profile is deployed.
- FM cockpit and counterpart simulator page are reachable.
- Test train plan data (including rolling stock and validity) exists.

## Steps
1. Lege einen neuen Bestellfall im FM-Cockpit mit definiertem Prozessprofil an.
2. Prüfe den Initialzustand, erlaubte Aktionen und fehlende Pflichtattribute.
3. Führe die Aktion „Bestellung senden“ aus und prüfe den Statuswechsel.
4. Öffne den Gegenstellen-Simulator und sende eine passende Antwort (z. B. Angebot/Bestätigung) mit Event-Tuple.
5. Prüfe den Statuswechsel im Cockpit inklusive Transition-Historie (vorher/nachher, Zeit, Quelle, Event-Key).
6. Sende ein nicht gemapptes Event-Tuple und prüfe, dass der Status unverändert bleibt.
7. Sende ein bereits verarbeitetes Event erneut mit identischer `externalMessageId` und prüfe idempotentes Verhalten.
8. Lege einen Fall mit Gültigkeit über Fahrplanjahrgrenze an und prüfe die operativen Kontexte pro Jahr + aggregierte Sicht.
9. Lies den Snapshot für OM-Konsum (per Kontext + aggregiert) über API oder UI.
10. Öffne im Fahrplanmanager einen Zug und starte daraus „Bestellfall eröffnen“.
11. Prüfe, dass Kalender-/Zugkontext übernommen ist, EVU-IDs ergänzt werden können und der Fall im Bestell-Cockpit direkt als aktiver Fall erscheint.
12. Prüfe im Cockpit die Pflichtattribute für `send_request`: die Ordering-Felder (`OTN/Name`, `ReasonOfReference`, `Gültigkeit`, `TrainType`, `TrafficTypeCode`, `Fahrtyp`, `Debitorencode`, `Distributionsliste`, `Grund kostenlose Bearbeitung`) werden als required geführt und sind bei train-first Eröffnung aus Zug-Metadaten vorbefüllt (falls am Zug vorhanden).
13. Wenn der Zug Formation-Builder-Daten hat, prüfe in Case-Details/Snapshot `providedAttributes`, dass `vehicleFormation` sowie optionale PWG-Werte (`pwgLengthMeters`, `pwgWeightTons`, `pwgMaxSpeedKph`) und `tractionOrPwg` mitgeführt werden.
14. Prüfe im Dialog „Bestellfall aus Zug eröffnen“, dass für die Ordering-Pflichtattribute eine Vollständigkeits-Checkliste mit `vorhanden/fehlend` sichtbar ist und fehlende Felder zusammengefasst ausgewiesen werden.
15. Wenn Felder fehlen, nutze im Dialog die Aktion zum Fahrplan-Editor und prüfe, dass der Editor für denselben Zug in Schritt 1 (`Bestellkontext`) mit übergebener Validity-Range geöffnet wird.

## Expected Results
- FM bleibt alleiniger Owner des Ordering-Lifecycles (R1).
- Prozessprofil + Event-Tuple steuern Übergänge deterministisch (R2, R3).
- State + Message Traceability sind vollständig persistiert (R4, R5).
- Cockpit zeigt Zustand, erlaubte Aktionen und Blockierungsgründe (R6).
- Simulator arbeitet gegen denselben Engine-Pfad wie echte Inbound-Events (R7).
- Cross-year Fälle erzeugen mehrere operative Kontexte unter einem Fall (R8, R9).
- Unbekannte Events ändern den State nicht und werden diagnostisch protokolliert (R10).
- Doppelte `externalMessageId` erzeugt keinen zweiten State-Wechsel und ist als Duplikat nachvollziehbar (R11).
- Der Zug-zu-Bestellfall-Flow erstellt ohne manuelle Doppelpflege einen validen Fall mit übernommenem Kontext und EVU-ID-Ergänzung (R12).
- Der Request-Start berücksichtigt die erweiterten Ordering-Pflichtattribute; fehlende Werte blockieren `send_request`, vorbefüllte Zug-Metadaten reduzieren manuelle Nachpflege (R13).
- Der Zug-zu-Bestellfall-Flow übernimmt zusätzlich detaillierte Formationsdaten in die Case-Attribute, sodass die Formation im Cockpit/Snapshot nachvollziehbar bleibt (R14).
- Der Zug-zu-Bestellfall-Dialog zeigt vor dem Erstellen transparent, welche Ordering-Pflichtattribute bereits vorhanden sind und welche noch im Fahrplaneditor ergänzt werden müssen (R15).
- Bei fehlenden Pflichtdaten führt der Dialog direkt in den Fahrplan-Editor (Schritt 1) des betroffenen Zuges, inklusive Validity-Range aus dem Zugkalender (R16).
