# CorePlanX

Ein gemeinsames Arbeitsverzeichnis für einen Angular-21-Client und ein NestJS-Backend zur Planung von Ressourcen, Aktivitäten und Zeitplänen im Bahn-/SEV-Umfeld. Der Backend-Teil liefert REST- und WebSocket-Endpunkte samt automatischen PostgreSQL-Migrationen; der Frontend-Teil visualisiert Gantt-Timelines, Stammdaten und Auftragsprozesse.

## Repository-Übersicht
- `frontend`: Angular 21 App (Material, Signals) mit Gantt-UI, Stammdaten-Editoren und Order-/Template-Hubs. API-Basis wird über `API_CONFIG` oder ein Meta/Script-Flag konfiguriert.
- `backend`: NestJS 11 API mit Fastify, CORS, Socket.IO-Gateway (`/timeline`) und REST-Controller für Planung, Ressourcen, Stammdaten und Validierungen. PostgreSQL-Migrationen liegen unter `backend/sql/migrations` und werden beim Start automatisch angewendet (Checksum-Prüfung).
- `openapi`: YAML-Spezifikationen für Planung (`planning-activities.yaml`) und Timeline (`timeline-asyncapi.yaml`), im Backend unter `/api/docs` eingebunden.
- `docs`: Fachliche Notizen und Guides.
- `.vscode`: Launch-, Task- und Settings-Vorlagen für gleichzeitiges Starten von Frontend + Backend.

## Voraussetzungen
- Node.js 20+ und npm 10+ (Frontend & Backend).
- Optional PostgreSQL (für persistente Daten); ohne DB läuft das Backend im Speicher, Timeline-Abfragen setzen aber eine DB voraus.
- Optional Python 3.x für Import-Skripte in `backend/integrations/topology-import`.

## Installation
- Frontend: `cd frontend && npm install`
- Backend: `cd backend && npm install`

## Backend starten
```bash
cd backend
# Debug/Watch inkl. Inspector (0.0.0.0:3000)
npm run start:debug

# Alternativ nur Watch
npm run start:dev
```
- Basis-URL: `http://localhost:3000/api/v1` (Swagger unter `http://localhost:3000/api/docs`).
- DB-Config: `DATABASE_URL` oder `DB_HOST`, `DB_NAME`, `DB_USER` (+ optional `DB_PASSWORD`, `DB_PORT`, `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`). Ohne Config wird ein In-Memory-Store genutzt; migrations laufen nur mit DB.
- Migrationen: Alle `.sql` in `backend/sql/migrations` werden beim Start in Reihenfolge angewendet; Checksums werden in `planning_schema_migration` gespeichert. Bei Abweichungen werden die verwalteten Tabellen gedroppt und neu aufgebaut.
- Realtime: WebSocket-Gateway unter Namespace `/timeline` (Socket.IO) für Viewport-Updates, Validierung und Activity-Broadcasts.

## Frontend starten
```bash
cd frontend
npm start
# http://localhost:4200/
```
- API-Basis: Standard ist `/api`. Für das Nest-Backend mit Präfix `/api/v1` entsprechend umstellen, z. B. per `API_CONFIG`-Provider oder globalem Flag vor dem Bootstrap:
  ```html
  <script>window.__COREPLANX_API_BASE__ = 'http://localhost:3000/api/v1';</script>
  ```

## Tests
- Frontend: `npm test`
- Backend: `npm test`, `npm run test:e2e`

## Nützliche VS Code-Konfiguration
- Die `.vscode`-Dateien sind bewusst Teil des Repos, damit alle die gleichen Start-/Stop- und Setup-Tasks finden.
- Launch-Compound „Start frontend + backend“ in `.vscode/launch.json` (inkl. Solver-Start).
- Tasks in `.vscode/tasks.json`:
  - `setup: all` (npm + Solver-Venv)
  - `build: all`, `test: all`
  - `solver: start`, `backend: start:debug`, `frontend: start`, `stop: all`
- Empfohlene Extensions/Settings: Angular Language Service, ESLint, Prettier, Python/Pylance (siehe `.vscode/extensions.json`, `.vscode/settings.json`).

## Lizenz
GPLv3 – siehe `LICENSE`.
