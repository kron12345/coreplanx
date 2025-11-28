# OrderManagementMock

Ein Angular-18-Mock, der einen vollständigen Ressourcen- und Aktivitäts-Gantt für Bahn-/SEV-Planung liefert. Das Frontend richtet sich auf eine NestJS-REST-API aus, damit mehrere Disponenten denselben Datenbestand bearbeiten können und Validierungen (Orts-, Kapazitäts-, Arbeitszeit-, Qualifikationskonflikte) serverseitig laufen.

## Inhalt

- [Technologie-Stack](#technologie-stack)
- [Systemvoraussetzungen](#systemvoraussetzungen)
- [Installation & Erstinbetriebnahme](#installation--erstinbetriebnahme)
- [Frontend-Entwicklung](#frontend-entwicklung)
- [Backend-Anbindung (NestJS)](#backend-anbindung-nestjs)
- [Aktueller Funktionsumfang](#aktueller-funktionsumfang)
- [Auftragsmanagement & Automatismen](#auftragsmanagement--automatismen)
- [Masterdatenbereich](#masterdatenbereich)
- [OpenAPI & Datenmodell](#openapi--datenmodell)
- [Tests & bekannte Einschränkungen](#tests--bekannte-einschränkungen)

## Technologie-Stack

- Angular 18 (Standalone Components, Signals, CDK Drag&Drop/Virtual Scroll)
- Angular Material 18
- RxJS 7.8
- Node.js 20 LTS (empfohlen) / npm 10+
- NestJS (geplant) als REST-Backend, angebunden über OpenAPI-Spezifikation

## Systemvoraussetzungen

| Komponente | Version | Hinweis |
| --- | --- | --- |
| Node.js | >= 20.x LTS | Node 25 funktioniert lokal, ist aber nicht LTS. |
| npm | >= 10 | Kommt mit Node 20+. |
| Browser | Chromium/Chrome, Edge, Firefox | Angular dev-server kompiliert im Strict-Modus. |

## Installation & Erstinbetriebnahme

1. Repository klonen oder als ZIP entpacken.
2. Abhängigkeiten installieren:
   ```bash
   npm install
   ```
3. Backend-Endpunkt konfigurieren (optional):
   - Der Dev-Server (`ng serve` auf Port 4200) verbindet sich automatisch mit `http://localhost:3000/api/v1`.
   - Abweichende Umgebungen können per Meta-Tag in `src/index.html` übersteuert werden:
     ```html
     <meta name="order-mgmt-api-base" content="https://staging.example.com/api/v1">
     ```
   - Alternativ lässt sich vor dem Bootstrap ein globales Flag setzen:
     ```html
     <script>window.__ORDER_MGMT_API_BASE__ = 'http://localhost:3333/api/v1';</script>
     ```
   - Als letzte Option kann `API_CONFIG` klassisch überschrieben werden, z. B. in `main.ts`:
     ```ts
     bootstrapApplication(AppComponent, {
       providers: [
         { provide: API_CONFIG, useValue: { baseUrl: 'https://prod.example.com/api/v1' } },
       ],
     });
     ```
4. Frontend starten:
   ```bash
   npm start
   ```
5. Browser öffnen: http://localhost:4200/ und im linken Menü „Planung“ wählen.

Ohne laufendes Backend bleibt der Gantt leer, die Anwendung selbst startet aber fehlerfrei.

## Frontend-Entwicklung

- Dev-Server: `npm start` (alias `ng serve`). Hot Reload und strenge Signals-Checks sind aktiv.
- Build: `npm run build`. Achtung: Fonts werden standardmäßig von Google Fonts geladen; offline Builds benötigen ein lokales Stylesheet.
- Tests: `npm test` (Karma) – deckt Kernlogik wie Tick-Erzeugung ab.
- Codegen/Scaffolding: `ng generate component|service|...`

## Backend-Anbindung (NestJS)

Der aktuelle Stand sieht eine REST-Brücke vor, die alle Activities/Resources verwaltet.

1. NestJS-Projekt anlegen (z. B. `nest new planning-api`).
2. OpenAPI übernehmen: `external_documents/openapi/planning-activities.yaml` importieren (Swagger/`@nestjs/swagger`).
3. Controller anlegen:
   - `GET /planning/stages/:stageId` liefert Ressourcen, Aktivitäten, Timeline & Version.
   - `GET /planning/stages/:stageId/activities` für Filterabfragen.
   - `PUT /planning/stages/:stageId/activities` akzeptiert Batch-Upserts/Deletes (Optimistic Locking optional über `version`).
   - `POST /planning/stages/:stageId/activities:validate` führt Prüfregeln aus (Orts-, Kapazitäts-, Arbeitszeit-, Qualifikationskonflikte; erweiterbar über `rule = custom`).
   - `GET /planning/stages/:stageId/events` stellt einen SSE-Stream bereit. Jede Nachricht ist ein `PlanningStageRealtimeEvent` mit `scope = resources | activities | timeline`. Clients hängen ihren `clientId`-Queryparameter an und senden denselben Wert (präfixiert) in `clientRequestId`, sodass das Backend Echo-Events unterdrücken kann.
4. Datenhaltung: beliebig (Postgres, Mongo, In-Memory). Wichtig ist, dass IDs stabil bleiben, damit mehrere Clients identische Activities sehen.
5. Optional: Authentifizierung (z. B. per JWT) lässt sich über einen HTTP-Interceptor ergänzen.

## Aktueller Funktionsumfang

- **Gantt-Board:**
  - Mehrere Planungsstufen (`base`, `operations`, `dispatch`).
  - Ressourcen-Gruppierung, Zoomlevels von Monat bis 5-Minuten-Raster, Now-Linie, Wochenenden, Drag&Drop.
  - Multi-Selection, Boards, Service-Zuordnung zwischen Ressourcen.
  - REST-basierte Datenquelle (`PlanningDataService` synchronisiert lokale Änderungen sofort mittels `ActivityApiService`).

- **Validierungen (Client-Hooks):**
  - Frontend kann via `requestActivityValidation` gezielt Prüfungen triggern; Ergebnis-Typ `ActivityValidationIssue` deckt Orte, Kapazität, Arbeitszeit, Qualifikationen ab.

- **Masterdatenbereich:**
  - Eigenständiges CRUD für RINF/SEV-Objekte (Operational Points, Sections of Line, Personnel Sites usw.).
  - Speicherung clientseitig via `PlanningStoreService`, sofortige Validierung (z. B. Start≠Ende, Referenzen).

- **Internationalisierung:** UI deutsch, Datenfelder unterstützen Mehrsprachigkeit via `TemporalValue`-Listen.

## Masterdatenbereich

Navigationspfad: „Stammdaten“ → Tab „Topologie“.

Bereiche:

- Operational Points (mit Geo-Koordinaten, Unique IDs)
- Sections of Line (gerichtete Strecken, Längen, Referenzen)
- Personnel Sites
- Replacement Stops, Routes & Edges (SEV)
- OP ↔ Replacement Stop Links
- Transfer Edges (OP ↔ Site ↔ SEV)

Die Komponenten unter `src/app/planning/components/**` sind modular aufgebaut und lassen sich leicht auf weitere Domänen übertragen. Mockdaten stehen in `src/app/shared/planning-mocks.ts` bereit und können per Store geladen oder ersetzt werden.

**Neu:** Personal, Personaldienste, Fahrzeuge und Fahrzeugdienste werden jetzt direkt über das Planning-Backend (`/planning/stages/base/resources`) verwaltet. Zusätzlich lassen sich alle Dienst-/Fahrzeugpools, Fahrzeugtypen und Fahrzeugkompositionen via `/planning/master-data/*` CRUD-Endpunkten pflegen. Sobald Sie im Stammdaten-UI speichern, landen die Änderungen per REST auf `http://localhost:3000/api/v1` (oder der konfigurierten Basis-URL) und stehen unmittelbar in der Planungsansicht zur Verfügung. Ein laufendes Backend ist daher Voraussetzung für persistente Stammdaten. Alle dynamischen Zusatzfelder werden dabei in generischen `attributes`-Objekten gespeichert – das gilt ebenso für Activities – sodass das Backend keine Schema-Updates mehr benötigt.

## Auftragsmanagement & Automatismen

Der Bereich „Aufträge“ deckt die komplette TTR/TTT-Pipeline ab – von KPIs bis zu automatischen Geschäften.

### Pipeline, KPI & Insights

- Hero-Metriken zeigen Aufträge, Positionen, kurzfristige Starts, Auffälligkeiten sowie Rolling-Planning-, Short-Term- und Ad-hoc-Buckets. Ein Klick setzt sofort den passenden Filter (z. B. `ttrPhase = rolling_planning`).
- Wird irgendein Filter aktiv, klappen alle Auftragskarten automatisch auf und zeigen die betroffenen Positionen.
- Team-Insights (Beliebte Tags, Top-Verantwortliche, Kontextkarte) basieren stets auf den aktuell gefilterten Treffern und lassen sich mit einem Klick anwenden.

### Filter, Suche & Presets

- Kombinierte Filterleiste inkl. Pills für Tags, TTR-Phase, Fahrplanfenster, Timeline-Referenz, Status, Business-Verknüpfung, etc.
- Suchfeld akzeptiert Kürzel wie `tag:` oder `resp:` und schlägt passende Werte live vor.
- Filtersets können als Presets gespeichert, dupliziert, umbenannt oder entfernt werden. Beim manuellen Anpassen deaktiviert sich die aktive Ansicht automatisch.

### Order Cards & Positionen

- Positions-Tags werden beim Anlegen/Bearbeiten gepflegt und stehen als Filtergrundlage, in Insights und in der Automationslogik zur Verfügung.
- Cards zeigen Business-/Phasen-Health, ermöglichen Bulk-Linking sowie Statuswechsel und aktualisieren sich live beim Filtern.

### Geschäfts-Automation

- Template-Hub enthält alle Standard-TTR-Phasen und beliebig viele Custom-Phasen (eigene Fenster, Timeline-Referenzen, Zuständigkeiten, Tags).
- Condition-Builder je Phase: `Tag enthält/enthält nicht`, `Positionsart ist/ist nicht`, `Bestellphase (TTT) ist/ist nicht`, `TTR-Phase ist/ist nicht`.
- Automationen bündeln Positionen pro Phase in gemeinsamen Geschäften (Bucket-Tags) und loggen jeden Lauf mit Status/Meldung.
- Eigene Phasen lassen sich kompletterstellen (Business-Vorlage + Automationsregeln) oder löschen; alle Einstellungen werden persistiert.

### Mock-Daten

- `src/app/core/mock/mock-orders.mock.ts` enthält aktualisierte Aufträge inkl. „ORD-TTR-DEMO“, der jede TTR-Phase bedient. So lassen sich sämtliche Automationen ohne Backend testen.

### Echtzeit-Synchronisation

- Server sendet Änderungen über `GET /planning/stages/:stageId/events` als `text/event-stream`. Nachrichten entsprechen `PlanningStageRealtimeEvent` (siehe OpenAPI).
- Client übergibt fortan zwei Kennungen: `userId` (stabil über alle Tabs hinweg) und `connectionId` (pro Browser-Tab). Jede Mutationsanforderung erhält ein Präfix `clientRequestId = <userId>|<connectionId>|...`. Das Backend kann Events der auslösenden Verbindung (`sourceConnectionId`) filtern, während andere Tabs desselben Users die Änderung weiterhin empfangen.
- Empfohlener Payload je Event:
  ```json
  {
    "stageId": "base",
    "scope": "activities",
    "sourceClientId": "user-123",
    "sourceConnectionId": "tab-abc",
    "version": "2025-11-10T10:05:00.000Z",
    "upserts": [{ "...": "..." }],
    "deleteIds": ["..."]
  }
  ```
- Bei Verbindungsabbrüchen sollte der Stream offen gehalten bzw. automatisch neu aufgebaut werden; bei Versionssprüngen (z. B. nach einem verpassten Event) lädt das Frontend einen kompletten Snapshot.

### Plantafel in neuem Fenster

- Jede Plantafel-Registerkarte besitzt rechts oben ein „Open in new window“-Icon. Daraufhin öffnet Angular `/#/planning/external?stage=<stageId>&resources=<comma-separated-ids>`.
- Der externe View lauscht auf dieselben Echtzeit-Streams und zeigt ausschließlich die übergebenen Ressourcen an – ideal für Mehrschirm-Arbeit. Da jede Instanz ihre eigene `connectionId` besitzt, werden Änderungen zwischen den Fenstern synchronisiert, ohne lokale Aktionen doppelt anzuwenden.

## OpenAPI & Datenmodell

- **OpenAPI:** `external_documents/openapi/planning-activities.yaml` dokumentiert alle Endpunkte sowie Schemas für Activities, Resources, Timeline, Validierungsergebnisse.
- **Activity-Modell (`src/app/models/activity.ts`):**
  - Enthält IDs, Zeitfenster, Service-Zuordnung, Ort (`locationId`), Kapazität (`capacityGroupId`), Qualifikationen, Work-Rule-Tags, Client-ID für Mandantenfähigkeit.
  - Die Teilnehmerliste `participants` (inkl. Rollen & Ressourcentypen) bildet sämtliche Zuordnungen ab und ersetzt die früheren Legacy-Felder.
- **Validierung (`src/app/models/activity-validation.ts`):** standardisierte Rules (`location-conflict`, `capacity-conflict`, `working-time`, `qualification`, `custom`).
- **API-Config:** `API_CONFIG` (unter `src/app/core/config/api-config.ts`) definiert die Basis-URL und kann überschrieben werden.

## Tests & bekannte Einschränkungen

- `npm run build` benötigt Onlinezugriff auf Google Fonts oder eine lokale Kopie.
- Ohne Backend keine Activities im Gantt (Designentscheidung, da Mockdaten entfernt wurden).
- Validierungsergebnisse müssen serverseitig umgesetzt werden; Client zeigt momentan nur das Interface an.
- Für produktive Nutzung fehlen Authentifizierung/Autorisierung sowie Persistenzschicht – Fokus liegt aktuell auf der UI-Referenz und API-Vertrag.

## Quick Reference

- Dev-Server: `npm start`
- Build: `npm run build`
- Tests: `npm test`
- Offizielle Angular-Hilfe: `ng help`
