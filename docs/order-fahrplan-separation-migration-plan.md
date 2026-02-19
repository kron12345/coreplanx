# Migration Plan: Auftragsmanagement (Datum) und Fahrplanmanagement (operativ)

## Zielbild
- **Auftragsmanagement (OM)** ist der business-nahe Bereich:
  - Auftrag, Kunde, Geschäftskontext, Verantwortlichkeit, Nachvollziehbarkeit.
  - OM überwacht und erklärt den End-to-End-Status.
- **Fahrplanmanagement (FM)** ist der operative Bereich:
  - Fahrplanjahres-basierte operative Planung.
  - TTT/TTR-Phasenführung, operative Statusübergänge, betriebliche Details.
- **Wichtig:** Eine Auftragsposition kann fachlich **eine** Position in OM bleiben, aber in FM in **mehrere operative Kontexte** (pro betroffenem Fahrplanjahr) aufgeteilt sein.

## Architekturentscheidung (Reihenfolge)
1. **FM zuerst anpassen** (Domäne, APIs, Phase-Engine, Audit).
2. **OM danach umstellen** (Datumsmodell, Filter, Positions-UI, Supervising/Traceability).

Grund: OM darf TTT/TTR nicht selbst rechnen. Ohne stabile FM-Snapshots entstehen doppelte Logik und Inkonsistenzen.

## Scope der Umstellung
- Auftrag: `validFrom`, `validTo` (statt primär `timetableYearLabel`).
- Auftragsposition: datumsbasiert, fahrplanjahrübergreifend möglich.
- TTT/TTR: vollständig in FM geführt; OM liest nur.
- OM-Filter: Datum/Überlappung statt Fahrplanjahr.

## Migrationsphasen

### Phase 0: Fachliches Zielmodell und Verträge
- Ergebnisse:
  - Ziel-Datenmodell freigegeben (OM + FM + Mapping).
  - API-Verträge für Phase-Snapshots und Traceability vereinbart.
  - Fehler-/Degradationsverhalten definiert.
- Exit-Kriterien:
  - Keine offenen Kernfragen zu Ownership von TTT/TTR.
  - Cross-year-Regeln sind testbar beschrieben.

### Phase 1: FM-Domäne als Source of Truth
- Ergebnisse:
  - FM materialisiert pro Auftragsposition die operativen Kontexte je betroffenem Fahrplanjahr.
  - TTT/TTR-Engine läuft ausschließlich in FM.
  - Audit-Trail für Phasenwechsel vorhanden.
- Exit-Kriterien:
  - Cross-year-Position erzeugt mehrere FM-Kontexte korrekt.
  - Phasewechsel sind pro Kontext nachvollziehbar.

### Phase 2: FM-API / Read-Model für OM
- Ergebnisse:
  - API für:
    - per-plan/per-year Snapshot,
    - aggregierten Snapshot pro Auftragsposition,
    - Traceability-Details (Links, Audit, Statushistorie).
- Exit-Kriterien:
  - OM kann alle benötigten Zustände ohne lokale Phasenlogik beziehen.

### Phase 3: OM-Datenmodell auf Datum umstellen
- Ergebnisse:
  - Auftrag erhält Pflichtfelder `validFrom`, `validTo`.
  - Positionen werden datumsbasiert modelliert.
  - Kompatibilitätsschicht für Altdaten (`timetableYearLabel`) aktiv.
- Exit-Kriterien:
  - Neue Aufträge/Positionen laufen datumsbasiert.
  - Bestehende Daten bleiben lesbar.

### Phase 4: OM-UI und Filter umbauen
- Ergebnisse:
  - Erstellung/Editing nutzt Datum statt Fahrplanjahr als primäres Feld.
  - Filter basieren auf Datumsüberlappung und relativen Zeitfenstern.
  - TTT/TTR-Anzeigen lesen FM-Snapshots.
- Exit-Kriterien:
  - Kein produktiver OM-Screen hängt fachlich von lokaler Fahrplanjahr-Phase ab.

### Phase 5: Auftragspositionen neu strukturieren
- Ergebnisse:
  - Position zeigt:
    - business-seitige Identität (eine Position),
    - operative FM-Kontexte (eine bis n Referenzen),
    - aggregierten + detaillierten Status.
  - Traceability-Ansicht von Auftrag bis operativem Plan verfügbar.
- Exit-Kriterien:
  - Nutzer können cross-year Positionen ohne Medienbruch nachvollziehen.

### Phase 6: Backfill, Parallelbetrieb, Cutover
- Ergebnisse:
  - Backfill von Altaufträgen/Altpositionen auf Datum und FM-Kontexte.
  - Dual-Read/Feature-Flags für kontrollierten Übergang.
  - Monitoring für Snapshot-Latenz, Inkonsistenzen, Fehlerquoten.
- Exit-Kriterien:
  - Definierte Qualitätskriterien erreicht (z. B. 0 kritische Mappingfehler).

### Phase 7: Aufräumen
- Ergebnisse:
  - Entfernen alter OM-Phase-Berechnung und year-zentrierter Restlogik.
  - Entfernen temporärer Migrationspfade/Flags.
- Exit-Kriterien:
  - Keine produktive Abhängigkeit mehr von Legacy-Logik.

## Ziel-Datenbeziehungen (fachlich)
- `Order` (OM): business context, `validFrom`, `validTo`.
- `OrderItem` (OM): business position, date validity, owner/accountability.
- `OrderItemOperationalContext` (Link):
  - verweist auf n FM-Kontexte pro Position.
  - enthält Zuordnungs-/Synchronisationsmetadaten.
- `OperationalPlan` (FM): fahrplanjahresbezogene operative Planung.
- `OperationalPhaseState` (FM): TTT/TTR und Statushistorie.

## API-Schnittstellen (fachliche Mindestanforderung)
- `GET /order-items/{id}/operational-contexts`
  - liefert alle FM-Kontexte pro Position.
- `GET /order-items/{id}/phase-snapshot`
  - liefert aggregierte und per-context TTT/TTR-Daten.
- `GET /order-items/{id}/traceability`
  - liefert auditierbare Kette von OM -> FM -> Phasenhistorie.

## Risiken und Gegenmaßnahmen
- Risiko: Doppelte Phasenlogik in OM/FM.
  - Maßnahme: harte Ownership-Regel, automatische Contract-Tests.
- Risiko: Falsches Splitting bei Fahrplanjahrgrenzen.
  - Maßnahme: Boundary-Testmatrix + Backfill-Simulation.
- Risiko: UI-Regression im OM durch Positionsumbau.
  - Maßnahme: gestaffelte Feature-Flags, Golden/Acceptance-Tests.
- Risiko: Snapshot-Latenz.
  - Maßnahme: Sync-Status im UI anzeigen, Retry/Queueing.

## Arbeitsreihenfolge für Umsetzungsteams
1. FM-Domäne + API-Verträge.
2. FM-Phase-Engine + Audit.
3. OM-Datumsmodell + Kompatibilität.
4. OM-Filter/UI/Positionsumbau.
5. Backfill + Cutover + Cleanup.

## Ergebnis für die Fachseite
- Das Auftragsmanagement bleibt der verständliche business-seitige Überwacher.
- Das Fahrplanmanagement bleibt der operative Taktgeber im Fahrplanjahrmodell.
- Cross-year Positionen werden fachlich sauber als ein Auftragselement geführt und operativ korrekt über mehrere Fahrplanjahre abgewickelt.
