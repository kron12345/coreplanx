# Acceptance Test: Fahrplanmanagement Generic TTT Ordering

## Related Spec
- `/specs/fahrplanmanagement-generic-ordering.md` (Rules: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12)

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
