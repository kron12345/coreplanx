# Acceptance Test: Topology List Search & Infinite Scroll

## Related Spec
- `/specs/topology-list-search-scroll.md` (Rules: R1, R2, R3, R4)

## Preconditions
- Topologie-Stammdaten sind importiert.

## Steps
1. Öffne **Stammdaten → Topologie → Operational Points**.
2. Tippe einen Suchbegriff ins Suchfeld.
3. Beobachte Netzwerk-Requests: `query=<suchbegriff>` wird gesendet (R1).
4. Scrolle die Liste nach unten, bis nahe ans Ende.
5. Prüfe, dass weitere Einträge automatisch nachgeladen werden (R2).
6. Ändere den Suchbegriff erneut und prüfe, dass die Liste neu ab Offset 0 lädt (R3).

## Expected Results
- Such-Requests nutzen den `query`-Parameter.
- Es gibt keinen „Mehr laden“-Button; Infinite Scroll lädt nach.
- Die Liste resetet bei Suchwechsel.
- Die UI bleibt responsiv und zeigt die korrekten Zähler (R4).
