# Acceptance Test: Stammdaten Fahrzeuge (Fahrtyp + Werkseinstellungen)

## Related Spec
- /specs/stammdaten-fahrzeuge.md (Rules: R1-R6)

## Preconditions
- Benutzer ist in der UI angemeldet.
- Zugriff auf `Stammdaten -> Fahrzeuge` ist vorhanden.

## Steps
1. Oeffne `Stammdaten -> Fahrzeuge -> Fahrzeugtypen`.
2. Lege einen neuen Fahrzeugtyp an und setze `Fahrtyp = Triebfahrzeug`.
3. Speichere und lade die Seite neu.
4. Pruefe, dass der gespeicherte Fahrzeugtyp den Fahrtyp weiterhin anzeigt.
5. Lege einen zweiten Fahrzeugtyp mit `Fahrtyp = Wagen` an und speichere.
6. Oeffne `Stammdaten -> Fahrzeuge` und klicke `Werkseinstellungen`.
7. Pruefe in `Fahrzeugtypen`, dass mindestens enthalten sind:
   - 1-2 Loktypen als Triebfahrzeug
   - 2-3 Triebzugtypen als Triebfahrzeug
   - 3 Wagentypen als Wagen
8. Pruefe in `Kompositionen`, dass mindestens enthalten sind:
   - eine Lok+Wagenzug-Formation
   - eine Triebzug-Formation mit mehreren Triebzugarten
   - eine Triebzug-Doppeltraktion
9. Oeffne den Fahrplaneditor und gehe in Schritt `Bestellkontext` zum Formation Builder.
10. Waehle `Fahrtyp = Triebfahrzeug` und pruefe, dass nur Triebfahrzeug-Typen angeboten werden.
11. Waehle `Fahrtyp = Wagen` und pruefe, dass nur Wagentypen angeboten werden.

## Expected Results
- Fahrzeugtypen haben ein explizites, persistiertes Fahrtyp-Feld.
- Werkseinstellungen liefern die geforderten Beispiel-Fahrzeugtypen und Beispiel-Formationen.
- Formation Builder filtert primaer ueber Fahrtyp und zeigt klare, konsistente Zuordnung.
