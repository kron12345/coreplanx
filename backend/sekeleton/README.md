# Planning Backend (NestJS Skeleton)

Dieses Verzeichnis enthält ein minimales NestJS-Skelett für das Gantt-Backend gemäß der beschriebenen Spezifikation:

- PostgreSQL als Persistenz (`activities`-Tabelle mit JSONB-Versionen).
- REST-Endpunkt `/api/timeline` mit LOD (activity | service).
- WebSocket-Gateway für Viewport- und Update-Events.
- Asynchrone Validierungs-Pipeline (BullMQ-Stub).

## Ordnerstruktur

- `src/main.ts` – Nest-Bootstrap
- `src/app.module.ts` – Root-Module
- `src/activities` – Entity/Repository/DTOs für Activities und Services
- `src/timeline` – REST-Controller/Service für Timeline-Ladung
- `src/gateway` – WebSocket-Gateway inkl. Client-Context-Verwaltung
- `src/validation` – Queue-Module & Processor-Stub für asynchrone Validierung
- `src/shared` – gemeinsame Typen/Nachrichten
- `src/resources` – getrennte Tabellen für Personnel, Vehicles, Services und Pools

## Abhängigkeiten (Vorschlag)

```bash
npm install @nestjs/core @nestjs/common @nestjs/platform-express @nestjs/websockets @nestjs/platform-socket.io
npm install reflect-metadata rxjs class-transformer class-validator
npm install pg typeorm @nestjs/typeorm
npm install bullmq @nestjs/bullmq
npm install uuid
```

## Hinweise

- Die Repositories sind als Stubs angelegt; Queries sind angedeutet, aber nicht voll implementiert.
- Validation-Processor ist ein Stub; füge deine Regeln dort ein.
- Layer-Gruppen und Übersetzungen sind als optionale Daten in den DTOs vorgesehen.
- Für produktiven Einsatz: Config-Module ergänzen (DB-URL, Redis-URL), Migrations anlegen, Security (Auth/Scopes) hinzufügen.
