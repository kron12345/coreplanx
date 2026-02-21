# Fahrplanmanagement: Generischer Bestellprozess (TTT)

## Ziel
Der Bestellprozess liegt operativ im Fahrplanmanagement und wird profilgesteuert ausgeführt.

MVP-Profile:
- Jahresbestellung (`annual_order`)
- Gelegenheitsverkehr (`occasional_traffic`)

## Kernobjekte
- `Ordering Case`: fachlicher Bestellfall mit Zustand, Pflichtattributen und Cross-Year-Kontexten.
- `Message Log`: eingehende/ausgehende Ereignisse inkl. Event-Tuple.
- `Transition Log`: Zustandswechsel inkl. vorher/nachher, Quelle, Ablehnungsgrund.

## Event-Tuple
Übergänge werden über einen kanonischen Key gematcht:
- `actor`
- `messageType`
- `messageStatus`
- `typeOfRequest`
- `typeOfInformation`

Zusätzlich gilt:
- Doppelte `externalMessageId` pro Fall werden idempotent behandelt (kein zweiter Statuswechsel, Duplikat wird diagnostisch geloggt).

## API (Backend)
Basisroute: `/timetable-ordering`

- `GET /profiles`: verfügbare Prozessprofile inkl. Aktionen/Pflichtattribute.
- `GET /cases`: Liste der Bestellfälle.
- `POST /cases`: neuen Bestellfall anlegen.
- `GET /cases/:caseId`: Detail inkl. Messages und Transitions.
- `GET /cases/:caseId/snapshot`: aggregierter + kontextbezogener Snapshot.
- `POST /cases/:caseId/actions`: Cockpit-Aktion auslösen.
- `POST /cases/:caseId/events`: Inbound-Event verarbeiten.
- `POST /cases/:caseId/simulator`: Gegenstellenantwort simulieren.

OM-spezifische Read-Contracts (über Orders-API):
- `GET /orders/:orderId/phase-snapshot`: aggregierte FM-Überwachung pro Auftrag.
- `GET /orders/:orderId/operational-contexts`: operative Kontexte pro verlinktem FM-Fall.
- `GET /orders/:orderId/traceability`: fallbezogene Korrelationen + letzte Message/Transition für Audit-Nachvollziehbarkeit.
- `GET /orders/:orderId/traceability/:caseId`: vollständige Message-/Transition-Historie eines verlinkten FM-Falls (für OM-Drilldown-Dialog).

## Pflichtattribute (MVP)
Vor `Bestellung senden` müssen alle als required markierten Felder vorhanden sein.
Gemeinsame Pflichtfelder:
- Verknüpfter Fahrplan (`trainPlanId`)
- `pathRequestId`
- `validFrom` / `validTo`
- `responsibleRu`
- `trainNumber`
- Start/Ziel-Betriebsstelle
- Fahrzeugsegmente (`rollingStock.segments`)
- `tttPhase` / `ttrPhase`

Profil-spezifisch:
- Jahresbestellung: `annualRequestWindow`
- Gelegenheitsverkehr: `requestedDepartureTime`

Im Cockpit können Fahrzeugsegmente als JSON-Array oder als kompakte CSV-Liste gepflegt werden.

## Cross-Year
Ein Bestellfall bleibt eine fachliche Einheit, kann aber mehrere operative Kontexte enthalten (pro betroffenem Fahrplanjahr einer).

## Start aus Zug
- Im Fahrplanmanager kann aus einem selektierten Zug direkt ein Bestellfall gestartet werden.
- Der Flow übernimmt Zug-/Kalenderkontext in einen verknüpften Fahrplan (`trainPlanId`) und ergänzt EVU-seitige IDs (mind. `pathRequestId`) vor dem Anlegen.
- Der Dialog zeigt zusätzlich eine Vollständigkeits-Checkliste für die Ordering-Pflichtattribute aus dem Zugkontext (vorhanden/fehlend), damit fehlende Daten gezielt im Fahrplan-Editor (Schritt 1) ergänzt werden können.
- Bei fehlenden Pflichtdaten bietet der Dialog eine direkte Aktion in den Fahrplan-Editor (Schritt 1 / `Bestellkontext`) für denselben Zug inkl. übergebener Validity-Range aus dem Zugkalender.
- Nach erfolgreicher Erstellung wird direkt in das Bestell-Cockpit auf den neuen Fall gewechselt.

## Simulator-Hinweis
- `withdrawn` simuliert einen Gegenstellen-Abbruch (IM) und führt über das Profil-Mapping in einen terminalen `INACTIVE`-Zustand.
