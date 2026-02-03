# Spec: Topology List Search & Infinite Scroll

## Overview
Improve performance and usability of Topologie-Stammdaten by using server-side search and infinite scrolling for large lists.

## Rules
- R1: Topologie-Listen nutzen server-seitige Suche (query-Param) für Suchbegriffe.
- R2: Topologie-Listen laden weitere Einträge automatisch beim Scrollen (Infinite Scroll) statt per Button.
- R3: Suchwechsel setzt die Liste zurück und lädt ab Offset 0 mit dem Suchbegriff.
- R4: UI zeigt Lade-/Zählerhinweise und bleibt bedienbar bei großen Datenmengen.

## Behavior
- Bei Änderungen im Suchfeld wird ein server-seitiger Query ausgelöst.
- Infinite Scroll triggert `loadMore` wenn der Benutzer nahe ans Listenende scrollt.
- `loadMore` nutzt den aktuellen Suchbegriff.

## Acceptance Criteria
- AC1: Suchfeld löst API-Aufrufe mit `query` aus (R1).
- AC2: Der „Mehr laden“-Button ist entfernt; weitere Einträge erscheinen beim Scrollen (R2).
- AC3: Wechsel des Suchbegriffs lädt die Liste ab Anfang neu (R3).
- AC4: UI bleibt responsiv und zeigt die geladenen/gesamt Einträge (R4).
