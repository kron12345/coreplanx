# Acceptance Test: Order List Create Focus And CTA Contrast

## Related Spec
- `/specs/orders-create-focus-and-cta-contrast.md` (Rules: R1, R2, R3, R4, R5)

## Preconditions
- Auftragsseite ist erreichbar.
- Mindestens ein Nutzer kann neue Aufträge anlegen.

## Steps
1. Öffne **Auftragsmanager → Aufträge**.
2. Prüfe den Hero-Button **Neuer Auftrag** auf Lesbarkeit/Kontrast zum blauen Hintergrund.
3. Klicke **Neuer Auftrag**, fülle mindestens das Pflichtfeld **Name** und speichere mit **Anlegen**.
4. Beobachte die Liste direkt nach dem Schließen des Dialogs.
5. Prüfe, ob die neu erzeugte Auftragskarte automatisch sichtbar, möglichst weit oben im sichtbaren Bereich und geöffnet ist.
6. Wiederhole den Flow mit aktivem Such- oder Tag-Filter.
7. Prüfe, dass Filterzustand unverändert bleibt (kein automatisches Zurücksetzen).

## Expected Results
- CTA ist klar sichtbar und hebt sich vom Hero-Hintergrund ab (R1).
- Nach dem Anlegen wird zum neuen Auftrag gescrollt (R2, R3).
- Die neue Auftragskarte ist aufgeklappt und direkt bearbeitbar (R3).
- Bestehende Filter bleiben unverändert (R4).
- Die fokussierte Karte liegt nahe am oberen sichtbaren Rand, sodass darunter möglichst viel Platz für aufgeklappte Positionen bleibt (R5).
