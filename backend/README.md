# CorePlanX Backend (NestJS)

Das Backend von **CorePlanX** ist eine NestJS-API (Fastify) für Planung, Stammdaten, Fahrplan/Varianten und Realtime-Updates (SSE/WebSocket). Alle REST-Endpunkte liegen unter dem Präfix `/api/v1`.

## Voraussetzungen

- Node.js 20+ und npm 10+
- Optional: PostgreSQL (für Persistenz)

## Installation

```bash
cd backend
npm install
```

## Starten

```bash
# Watch
npm run start:dev

# Debug/Watch (Inspector)
npm run start:debug
```

- API: `http://localhost:3000/api/v1`
- Swagger/OpenAPI: `http://localhost:3000/api/docs`
- Kompatibilitäts-Alias: Requests auf `/v1/*` werden serverseitig auf `/api/v1/*` umgeschrieben.

## Datenbank & Migrationen

Die API kann ohne Datenbank laufen (In-Memory, keine Persistenz). Für Persistenz:

- Konfiguration über `DATABASE_URL` **oder** `DB_HOST`, `DB_NAME`, `DB_USER` (+ optional `DB_PASSWORD`, `DB_PORT`, `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`).
- Beim Start werden alle SQL-Migrationen in `backend/sql/migrations` ausgeführt und in `planning_schema_migration` (Dateiname + Checksum) getrackt.
- Falls eine Checksum nicht mehr passt, werden die verwalteten Tabellen gedroppt und anschließend neu aufgebaut.

Manuelles Ausführen (optional):

```bash
npm run migrate
```

## Lizenz

Siehe `LICENSE` im Repository-Root.

